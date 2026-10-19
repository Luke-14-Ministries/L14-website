-- 0103_review_fixes.sql
--
-- Defects proven by the Script 5 review of 18 Oct 2026 (state-changing items
-- tested in rolled-back transactions):
--
--   1. registration_review is money: rows only for Payments read. 0102 gave it a
--      row filter on Registration read, which still showed an operations
--      helper (no payment information at all, Access-Model plan note 3) who
--      had paid what. The view stays definer on purpose -- as an invoker view
--      a reviewer without Payments read would see every family as "neither".
--   2. Publishing buddies or rooms is the Buddies / Rooming area's act (plan
--      §2b: "pairings, publishing them"), but the publication stamps live on
--      events, whose writes need Setup write -- so a coordinator's Publish
--      matched 0 rows and the page said it had worked. One definer function
--      checks the right area and reports whether the event exists.
--   3. waive_deposit() turned a family's PENDING scholarship request into a
--      granted $50 decided by the registrar. A requested row is the family's
--      ask and stays pending; the waiver still marks the registration
--      deposit-received, and that person's request is decided as usual.

-- ---- 1 --------------------------------------------------------------------------
do $$
declare def text;
begin
  def := pg_get_viewdef('public.registration_review'::regclass, true);
  if position('has_grant(''registration''::text, ''read''::text)' in def) = 0 then
    raise exception '0103: registration_review does not carry the 0102 filter';
  end if;
  def := replace(def, 'has_grant(''registration''::text, ''read''::text)', 'has_grant(''payments''::text, ''read''::text)');
  execute 'create or replace view public.registration_review as ' || def;
  if position('payments' in pg_get_viewdef('public.registration_review'::regclass, true)) = 0 then
    raise exception '0103: registration_review was not rewritten';
  end if;
end;
$$;

-- ---- 2 --------------------------------------------------------------------------
create or replace function public.set_event_publication(p_event_id uuid, p_kind text, p_publish boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind = 'buddies' then
    if not public.has_grant('buddies', 'write') then
      raise exception 'Publishing buddy assignments needs Buddies write.' using errcode = '42501';
    end if;
    update public.events
       set buddy_assignments_published_at = case when p_publish then now() else null end
     where id = p_event_id;
  elsif p_kind = 'lodging' then
    if not public.has_grant('rooming', 'write') then
      raise exception 'Publishing room assignments needs Rooming write.' using errcode = '42501';
    end if;
    update public.events
       set lodging_assignments_published_at = case when p_publish then now() else null end
     where id = p_event_id;
  else
    raise exception 'Unknown publication: %', p_kind;
  end if;
  return found;
end;
$$;
revoke all on function public.set_event_publication(uuid, text, boolean) from public;
grant execute on function public.set_event_publication(uuid, text, boolean) to authenticated;

-- ---- 3 --------------------------------------------------------------------------
create or replace function public.waive_deposit(p_registration_id uuid, p_reason text default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_deposit integer;
  n integer := 0;
  rec record;
  v_note text;
begin
  if not public.can_decide_scholarships() then
    raise exception 'Waiving a deposit is a scholarship decision: it needs Payments and Registration write.';
  end if;
  select e.deposit_cents into v_deposit
    from public.registrations r join public.events e on e.id = r.event_id
   where r.id = p_registration_id;
  if v_deposit is null then
    raise exception 'No such registration.';
  end if;

  update public.registrations
     set deposit_waived_at = now(),
         deposit_waived_by = auth.uid(),
         deposit_waived_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_registration_id;

  v_note := 'Deposit waived' || case when nullif(btrim(coalesce(p_reason, '')), '') is null
                                     then '' else ': ' || btrim(p_reason) end;

  for rec in
    select rp.id, rp.fee_cents, rp.scholarship_cents
      from public.registration_participants rp
     where rp.registration_id = p_registration_id
       and rp.status <> 'cancelled'
       and rp.fee_cents > 0
       and rp.scholarship_cents < least(v_deposit, rp.fee_cents)
       -- 0103: a family's pending request is theirs to have decided, not
       -- answered by the waiver.
       and not exists (select 1 from public.scholarships s
                        where s.registration_participant_id = rp.id
                          and s.status = 'requested')
  loop
    update public.registration_participants
       set scholarship_cents = least(v_deposit, rec.fee_cents)
     where id = rec.id;
    update public.scholarships
       set granted_cents = least(v_deposit, rec.fee_cents), status = 'granted',
           staff_note = v_note, reviewed_by = auth.uid(), reviewed_at = now()
     where registration_participant_id = rec.id;
    if not found then
      insert into public.scholarships
        (registration_participant_id, granted_cents, status, staff_note, reviewed_by, reviewed_at)
      values (rec.id, least(v_deposit, rec.fee_cents), 'granted', v_note, auth.uid(), now());
    end if;
    n := n + 1;
  end loop;

  perform public.recalc_family_discount(p_registration_id);
  perform public.recalc_early_registration_discount(p_registration_id);
  return n;
end;
$function$;
