-- 0127_undo_deposit_waiver.sql
--
-- A deposit waiver can be undone (Lawrence, 26 Oct 2026: "why can't waive
-- deposit be undone? it is an administrative tick -- suppose it was done in
-- error??").
--
-- What waive_deposit() (0096, 0103, restated 0114) does, and so what undoing
-- it has to take back:
--   * stamps registrations.deposit_waived_at / _by / _reason;
--   * for each fee-paying person holding less than the per-person deposit
--     (and with no pending request), sets participant_money.scholarship_cents
--     to least(deposit, fee) -- OVERWRITING any smaller scholarship they had --
--     and writes the scholarships row: granted, staff_note 'Deposit waived[:
--     reason]', reviewed_by / reviewed_at;
--   * re-runs the family and early-registration discount rules.
--
-- undo_deposit_waiver(registration, reason) reverses that:
--
--   * Who: can_decide_scholarships() -- Payments AND Registration write, the
--     same as waiving (0102). A reason is required: undoing a decision is a
--     decision, and the note it leaves says why.
--   * Which people: those whose scholarship is still the waiver's -- the
--     scholarships row is 'granted' with a staff_note starting 'Deposit
--     waived' AND participant_money.scholarship_cents still equals that row's
--     granted_cents. A person whose scholarship staff have decided since (the
--     amount moved, or the row was rewritten by the editor or the
--     Scholarships page, which write their own note) is left exactly as it
--     is: that later decision is not the waiver's to take back.
--   * What it restores: the scholarship the person had just before the
--     waiver, read from money_change_log (0111/0114), which records every
--     participant_money write as a before/after diff. The waiver's own write
--     is the participant_money UPDATE whose after.scholarship_cents is the
--     waived amount, at or before the scholarships row's reviewed_at -- the
--     waiver stamped reviewed_at = now() in the same transaction as that
--     write, so the two timestamps are equal. We take the latest such entry
--     and its BEFORE value. Anchoring on reviewed_at rather than on
--     deposit_waived_at matters when the deposit was waived twice: the
--     second waiver re-stamps deposit_waived_at but skips anyone already
--     holding the deposit, so nothing of theirs is logged after it. No entry
--     (a waiver from before the log covered participant_money, 0114) means 0.
--   * The scholarships row: restored > 0 stays 'granted' at the restored
--     amount; restored = 0 becomes 'declined' with granted_cents 0. Not
--     'withdrawn': in this codebase withdrawn means the FAMILY took a request
--     back (setAdjustments, 0048 notes; the Scholarships page prints it
--     "Withdrawn by family"), and staff zeroing a grant is recorded as
--     declined ("Not granted"). Either way staff_note becomes 'Deposit
--     waiver undone: <reason>' with the caller and the time. The row's note
--     from before the waiver is not recoverable (scholarships is not in the
--     money log); the amount is what matters and that is restored.
--   * Clears deposit_waived_at / _by / _reason, then re-runs
--     recalc_family_discount and recalc_early_registration_discount in the
--     order waive_deposit() runs them.
--   * Nobody is un-approved. A person confirmed on the strength of the
--     waiver stays confirmed; registration_review simply reads the real
--     deposit again (No full deposit yet / deposit short), which is the
--     honest state of the registration.
--   * Returns how many people's scholarship it changed (0 is fine: a waiver
--     that granted nothing, or whose grants staff have all decided since,
--     still has its mark cleared).
--
-- guard_deposit_waiver() (0096, rewritten by 0101 to has_grant('payments',
-- 'write')) needs no change. It is a definer trigger, so current_user inside
-- it is the owner -- but it never asks current_user: it asks has_grant(),
-- which reads the CALLER's identity from auth.uid(). That is why
-- waive_deposit() can set the columns, and the same holds for this function:
-- can_decide_scholarships() implies Payments write. A post-check below pins
-- the guard's test so a later rewrite that changes it is noticed here.
--
-- Every money write still lands in money_change_log: the function updates
-- participant_money, whose AFTER trigger participant_money_money_log (0114)
-- runs log_money_change() for any writer. The harness checks the row.
--
-- pg-safeupdate (CLAUDE.md): every UPDATE below has a WHERE.
--
-- Not applied to the production project yet; the lead applies.

comment on column public.registrations.deposit_waived_at is
  'Set by waive_deposit(): a registrar decided the deposit is not required of this family. Review treats the registration as deposit-received. Cleared by undo_deposit_waiver() (0127).';

create or replace function public.undo_deposit_waiver(p_registration_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason    text := nullif(btrim(coalesce(p_reason, '')), '');
  v_waived_at timestamptz;
  v_note      text;
  v_restore   integer;
  n           integer := 0;
  rec         record;
begin
  if not public.can_decide_scholarships() then
    raise exception 'Undoing a deposit waiver is a scholarship decision: it needs Payments and Registration write.'
      using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Say why the waiver is being undone.';
  end if;

  -- Lock the registration so two presses cannot undo the same waiver twice.
  select r.deposit_waived_at into v_waived_at
    from public.registrations r
   where r.id = p_registration_id
   for update;
  if not found then
    raise exception 'No such registration.';
  end if;
  if v_waived_at is null then
    raise exception 'The deposit on this registration is not waived.';
  end if;

  v_note := 'Deposit waiver undone: ' || v_reason;

  -- The people whose scholarship is still the waiver's (see the header).
  for rec in
    select rp.id as participant_id, s.id as scholarship_id, s.granted_cents,
           coalesce(s.reviewed_at, v_waived_at) as granted_at
      from public.registration_participants rp
      join public.participant_money pm on pm.participant_id = rp.id
      join public.scholarships s on s.registration_participant_id = rp.id
     where rp.registration_id = p_registration_id
       and s.status = 'granted'
       and s.staff_note like 'Deposit waived%'
       and pm.scholarship_cents = s.granted_cents
       for update of pm, s
  loop
    -- What the waiver overwrote: the BEFORE side of its own write.
    select (l.before ->> 'scholarship_cents')::integer into v_restore
      from public.money_change_log l
     where l.table_name = 'participant_money'
       and l.row_id = rec.participant_id
       and l.op = 'UPDATE'
       and l.after ? 'scholarship_cents'
       and (l.after ->> 'scholarship_cents')::integer = rec.granted_cents
       and l.changed_at <= rec.granted_at
     order by l.changed_at desc, l.id desc
     limit 1;
    v_restore := coalesce(v_restore, 0);
    -- The waiver only ever raised a scholarship; anything else is not its
    -- write, so fall back to none rather than restore a larger figure.
    if v_restore < 0 or v_restore >= rec.granted_cents then
      v_restore := 0;
    end if;

    update public.participant_money
       set scholarship_cents = v_restore, updated_at = now()
     where participant_id = rec.participant_id;

    update public.scholarships
       set granted_cents = v_restore,
           status        = case when v_restore > 0 then 'granted' else 'declined' end,
           staff_note    = v_note,
           reviewed_by   = auth.uid(),
           reviewed_at   = now()
     where id = rec.scholarship_id;

    n := n + 1;
  end loop;

  update public.registrations
     set deposit_waived_at = null,
         deposit_waived_by = null,
         deposit_waived_reason = null
   where id = p_registration_id;

  -- Same order as waive_deposit(): family first, then early (CLAUDE.md, Money).
  perform public.recalc_family_discount(p_registration_id);
  perform public.recalc_early_registration_discount(p_registration_id);
  return n;
end;
$$;

comment on function public.undo_deposit_waiver(uuid, text) is
  'Takes back waive_deposit(): restores each person''s scholarship from before the waiver (money_change_log) where it is still the waiver''s, and clears the mark. Payments and Registration write; a reason is required. Nobody is un-approved. 0127.';

revoke all on function public.undo_deposit_waiver(uuid, text) from public, anon;
grant execute on function public.undo_deposit_waiver(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Post-checks
-- ---------------------------------------------------------------------------
do $$
declare
  def text := pg_get_functiondef('public.undo_deposit_waiver(uuid, text)'::regprocedure);
begin
  if not (select prosecdef from pg_proc where oid = 'public.undo_deposit_waiver(uuid, text)'::regprocedure) then
    raise exception '0127: undo_deposit_waiver must run as its owner';
  end if;
  if position('can_decide_scholarships()' in def) = 0
     or position('money_change_log' in def) = 0
     or position('recalc_family_discount' in def) = 0
     or position('recalc_early_registration_discount' in def) = 0 then
    raise exception '0127: undo_deposit_waiver is missing its check, its log read or a recalc';
  end if;
  if not has_function_privilege('authenticated', 'public.undo_deposit_waiver(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.undo_deposit_waiver(uuid, text)', 'execute') then
    raise exception '0127: undo_deposit_waiver grants are wrong';
  end if;
  -- The guard lets this function clear the mark because it asks the caller's
  -- Payments write (auth.uid()), not current_user. If a rewrite changes that,
  -- undoing (and waiving) needs looking at again.
  if position('has_grant(''payments'', ''write'')' in
              pg_get_functiondef('public.guard_deposit_waiver()'::regprocedure)) = 0 then
    raise exception '0127: guard_deposit_waiver no longer asks has_grant(payments, write)';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.participant_money'::regclass
                    and tgfoid = 'public.log_money_change()'::regprocedure
                    and tgenabled <> 'D') then
    raise exception '0127: participant_money writes are not logged to money_change_log';
  end if;
end;
$$;
