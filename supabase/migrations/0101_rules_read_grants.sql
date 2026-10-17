-- 0101_rules_read_grants.sql
--
-- THE GRANTS MODEL, STEPS 3 AND 4 (Luke14-Access-Model-Plan; build plan item
-- 16): the rules read the grants, and the role check retires.
--
-- Until now every staff policy and guard asked is_registrar() /
-- is_coordinator() / is_admin() and the three tick-box functions. From here
-- they ask has_grant(area, level) (0100). This migration rewrites them IN
-- PLACE rather than restating sixty policies by hand: each policy's
-- expression is taken from pg_policies, the role token is replaced with the
-- grant for that table, and the policy is altered. The mapping table below
-- IS the decision, and it is the thing to read:
--
--   registration (write)  people, households, household_members, person_consents,
--                         person_caregivers, registrations, registration_participants,
--                         volunteer_applications, cancellation requests, family messages,
--                         data-deletion requests, change-log review;
--                         newsletter list read = registration read
--   payments (write/read) payments, refunds, plans, installments, schedules, coupons,
--                         redemptions, discount rules, scholarships; their staff READ
--                         is payments read (an operations helper sees no money)
--   giving                can_manage_giving() = giving write; reading gifts = giving read
--   background_checks     can_view_background_checks() = background_checks WRITE: the
--                         table (Checkr ids, verdict words) and its log are the
--                         administrator's; everyone reads the three facts through the
--                         clearance_status view (0091)
--   sensitive             can_view_sensitive() = sensitive read; writing person_support
--                         and camper photos = sensitive write; reading photos = sensitive read
--   setup (write)         events, event_options, agreements, agreement_requirements,
--                         seasons, programs, transaction_categories (were is_admin), and the
--                         DEFINITIONS of activities, activity_slots and lodgings (were
--                         is_coordinator -- plan §2b: definitions are Setup)
--   activities (write)    activity_signups, and the capacity guards' override
--   rooming (write)       lodging_assignments
--   buddies (write)       buddy_assignments
--   programs (write)      place_in_program()
--   is_admin() STAYS      staff, staff_grants, staff_access_log, program_leaders (naming a
--                         leader), event_medical_access (the doctor's dated grant), and the
--                         admin_* account functions: granting is the administrator's alone,
--                         and that is the one thing staff.role still says
--   is_staff() STAYS      "an active staff row": every preset reads registration info, so
--                         the broad staff reads are unchanged
--
-- Functions that guard money or state follow the same table. At the end the
-- migration checks that nothing in a policy, a function or a view still
-- names is_registrar() or is_coordinator(), and drops both -- step 4. The
-- role column stays: 'admin' is still read by is_admin(); 'registrar' and
-- 'coordinator' are now labels only, and Staff & Access says so.

-- ---- 1. The three tick-box functions become grant reads ------------------------------
create or replace function public.can_view_sensitive()
returns boolean language sql stable security definer set search_path = ''
as $$ select public.has_grant('sensitive', 'read'); $$;

create or replace function public.can_manage_giving()
returns boolean language sql stable security definer set search_path = ''
as $$ select public.has_grant('giving', 'write'); $$;

create or replace function public.can_view_background_checks()
returns boolean language sql stable security definer set search_path = ''
as $$ select public.has_grant('background_checks', 'write'); $$;

-- ---- 2. Policies: replace the role token with the area grant, per table ----------------
do $$
declare
  r record;
  m record;
  q text;
  w text;
  n int := 0;
begin
  for r in
    select tablename, policyname, cmd, qual, with_check
    from pg_policies where schemaname = 'public'
  loop
    q := r.qual;
    w := r.with_check;
    for m in
      select * from (values
        -- (table, policy or null for any, token, replacement)
        -- payments: staff writes and staff reads
        ('payments',            null, 'is_registrar()',  'public.has_grant(''payments'', ''write'')'),
        ('payments',            null, 'is_staff()',      'public.has_grant(''payments'', ''read'')'),
        ('payment_refunds',     null, 'is_registrar()',  'public.has_grant(''payments'', ''write'')'),
        ('payment_refunds',     null, 'is_staff()',      'public.has_grant(''payments'', ''read'')'),
        ('payment_plans',       null, 'is_registrar()',  'public.has_grant(''payments'', ''write'')'),
        ('payment_plans',       null, 'is_staff()',      'public.has_grant(''payments'', ''read'')'),
        ('payment_installments',null, 'is_registrar()',  'public.has_grant(''payments'', ''write'')'),
        ('payment_installments',null, 'is_staff()',      'public.has_grant(''payments'', ''read'')'),
        ('payment_schedules',   null, 'is_registrar()',  'public.has_grant(''payments'', ''write'')'),
        ('coupons',             null, 'is_registrar()',  'public.has_grant(''payments'', ''write'')'),
        ('coupon_redemptions',  null, 'is_registrar()',  'public.has_grant(''payments'', ''write'')'),
        ('coupon_redemptions',  null, 'is_staff()',      'public.has_grant(''payments'', ''read'')'),
        ('discount_rules',      null, 'is_registrar()',  'public.has_grant(''payments'', ''write'')'),
        ('scholarships',        null, 'is_registrar()',  'public.has_grant(''payments'', ''write'')'),
        ('scholarships',        null, 'is_staff()',      'public.has_grant(''payments'', ''read'')'),
        -- giving
        ('gifts',   'gifts_select', 'can_manage_giving()', 'public.has_grant(''giving'', ''read'')'),
        -- sensitive: photos and the support row
        ('person_photos',       null, 'is_registrar()',  'public.has_grant(''sensitive'', ''write'')'),
        ('person_photos',       null, 'is_staff()',      'public.has_grant(''sensitive'', ''read'')'),
        ('person_support', 'person_support_write', 'can_view_sensitive()', 'public.has_grant(''sensitive'', ''write'')'),
        -- registration read
        ('newsletter_preference_log', null, 'is_registrar()', 'public.has_grant(''registration'', ''read'')'),
        -- setup: the definitions
        ('events',                 null, 'is_admin()',       'public.has_grant(''setup'', ''write'')'),
        ('event_options',          null, 'is_admin()',       'public.has_grant(''setup'', ''write'')'),
        ('agreements',             null, 'is_admin()',       'public.has_grant(''setup'', ''write'')'),
        ('agreement_requirements', null, 'is_admin()',       'public.has_grant(''setup'', ''write'')'),
        ('seasons',                null, 'is_admin()',       'public.has_grant(''setup'', ''write'')'),
        ('programs',               null, 'is_admin()',       'public.has_grant(''setup'', ''write'')'),
        ('transaction_categories', null, 'is_admin()',       'public.has_grant(''setup'', ''write'')'),
        ('activities',             null, 'is_coordinator()', 'public.has_grant(''setup'', ''write'')'),
        ('activity_slots',         null, 'is_coordinator()', 'public.has_grant(''setup'', ''write'')'),
        ('lodgings',               null, 'is_coordinator()', 'public.has_grant(''setup'', ''write'')'),
        -- the placements
        ('activity_signups',    null, 'is_coordinator()', 'public.has_grant(''activities'', ''write'')'),
        ('lodging_assignments', null, 'is_coordinator()', 'public.has_grant(''rooming'', ''write'')'),
        ('buddy_assignments',   null, 'is_coordinator()', 'public.has_grant(''buddies'', ''write'')'),
        -- everything else a registrar wrote is registration info
        ('*', null, 'is_registrar()', 'public.has_grant(''registration'', ''write'')')
      ) as t(tbl, pol, tok, rep)
      where (t.tbl = r.tablename or t.tbl = '*')
        and (t.pol is null or t.pol = r.policyname)
      order by case when t.tbl = '*' then 2 else 1 end
    loop
      q := replace(q, m.tok, m.rep);
      w := replace(w, m.tok, m.rep);
    end loop;

    if q is distinct from r.qual or w is distinct from r.with_check then
      execute format(
        'alter policy %I on public.%I %s %s',
        r.policyname, r.tablename,
        case when q is not null and r.cmd <> 'INSERT' then 'using (' || q || ')' else '' end,
        case when w is not null and r.cmd not in ('SELECT', 'DELETE') then 'with check (' || w || ')' else '' end
      );
      n := n + 1;
    end if;
  end loop;
  raise notice '0101: % policies rewritten', n;
end;
$$;

-- ---- 3. Functions and guards: the same replacement, by name --------------------------
do $$
declare
  f record;
  def text;
  n int := 0;
begin
  for f in
    select p.oid, p.proname, t.tok, t.rep
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    join (values
      ('guard_awaiting_family',          'is_registrar()',   'has_grant(''registration'', ''write'')'),
      ('guard_registration_hold',        'is_registrar()',   'has_grant(''registration'', ''write'')'),
      ('admin_newsletter_list',          'is_registrar()',   'has_grant(''registration'', ''read'')'),
      ('guard_deposit_waiver',           'is_registrar()',   'has_grant(''payments'', ''write'')'),
      ('guard_participant_money',        'is_registrar()',   'has_grant(''payments'', ''write'')'),
      ('waive_deposit',                  'is_registrar()',   'has_grant(''payments'', ''write'')'),
      ('build_plan_installments',        'is_registrar()',   'has_grant(''payments'', ''write'')'),
      ('place_in_program',               'is_coordinator()', 'has_grant(''programs'', ''write'')'),
      ('activity_signups_capacity_guard','is_coordinator()', 'has_grant(''activities'', ''write'')'),
      ('activity_slot_capacity_guard',   'is_coordinator()', 'has_grant(''activities'', ''write'')'),
      ('recalc_event_discounts',         'is_admin()',       'has_grant(''setup'', ''write'')'),
      ('admin_create_event',             'is_admin()',       'has_grant(''setup'', ''write'')')
    ) as t(fname, tok, rep) on t.fname = p.proname
    where ns.nspname = 'public' and p.prokind = 'f'
  loop
    def := pg_get_functiondef(f.oid);
    -- Qualified first, then bare: both end up as public.has_grant(...), which
    -- is right whatever the function's search_path says.
    def := replace(def, 'public.' || f.tok, 'public.' || f.rep);
    def := replace(def, f.tok, 'public.' || f.rep);
    execute def;
    n := n + 1;
  end loop;
  raise notice '0101: % functions rewritten', n;
end;
$$;

-- ---- 4. Nothing may still name the two role checks; then they go ---------------------
do $$
declare
  leftover text;
begin
  select string_agg(what, ', ') into leftover from (
    select 'policy ' || tablename || '.' || policyname as what
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'is_(registrar|coordinator)\(\)'
    union all
    select 'function ' || p.proname
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.prokind = 'f'   -- plain functions: pg_get_functiondef refuses aggregates
      and p.proname not in ('is_registrar', 'is_coordinator')
      and pg_get_functiondef(p.oid) ~ 'is_(registrar|coordinator)\(\)'
    union all
    select 'view ' || viewname
    from pg_views
    where schemaname = 'public' and definition ~ 'is_(registrar|coordinator)\(\)'
  ) s;
  if leftover is not null then
    raise exception '0101: still reading a role: %', leftover;
  end if;
end;
$$;

drop function if exists public.is_registrar();
drop function if exists public.is_coordinator();

comment on column public.staff.role is
  'Since 0101 only ''admin'' is read (is_admin(): granting, accounts, leaders, the doctor''s grant). ''registrar'' and ''coordinator'' are labels; what a person may do is staff_grants.';
