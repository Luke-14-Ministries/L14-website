-- 0116: horseback riding gets its own waiver, signed per rider (21 Oct 2026).
--
-- 0041 left the open question with staff: horseback is run by volunteers and
-- friends of the camp, not an outfitter with a form of its own, so there was
-- no provider link to send families to -- and no waiver at all. The answer is
-- the ministry's own: a Tennessee equine-activity warning (T.C.A. 44-20-103,
-- which requires the sponsor to give it) and a release, signed on the site by
-- the rider or the person signing for them, like every other agreement.
--
-- The schema has carried this since 0001 and never used it: an
-- agreement_requirements row is EITHER a condition of attending the event
-- (event_id) OR a condition of doing one activity (activity_id). The event-
-- level rows are what the registration wizard reads; this is the first
-- activity-level row, and the Activities page is what reads it -- ticking the
-- activity opens the waiver, and the signup is saved only with the signature.
-- Signatures land in agreement_signatures as signed_here, per person, with
-- the registration they belong to, exactly as the wizard writes the others.
--
-- The requirement is attached BY NAME to every 'Horseback riding' activity on
-- an event that is not archived -- two today (Camp Celebrate 2027, weeks 1 and
-- 2). A horseback activity created for a later event needs its own row: there
-- is no Setup screen for requirements yet, and create_event() (0083) copies
-- only the rows scoped to the source EVENT, so an activity-scoped row is not
-- carried across. Until one of those exists, the row is a one-line insert
-- modelled on the one below. Both inserts are safe to re-run.

insert into public.agreements (key, version, title, delivery, external_url, active, body)
select 'horseback_waiver', 1, 'Horseback Riding Waiver', 'internal_document', null, true,
       'WARNING' || E'\n' ||
       'Under Tennessee law, an equine activity sponsor, an equine professional, or any other person is not liable for an injury to or the death of a participant resulting from the inherent risks of equine activities (Tennessee Code Annotated, title 44, chapter 20, § 44-20-103). Luke 14 Ministries is an equine activity sponsor.' || E'\n\n' ||
       'I understand that horses, even gentle ones led by a handler, are large, unpredictable animals and that riding and being near them can cause serious injury or death: a horse can startle, bolt, kick, bite, stumble or fall, and a rider can be thrown, stepped on or crushed. I (and the rider I am signing for) take part voluntarily and accept those risks. To the fullest extent Tennessee law allows, I release and agree not to sue Luke 14 Ministries, its officers, directors, employees and volunteers, the owners and handlers of the horses, and the owner of the grounds for any injury, death or loss arising from horseback riding at {{event}}, including injury caused by their ordinary negligence. The rider will follow the riding staff''s instructions and not approach a horse without staff present. My Emergency Consent and Hold Harmless Agreement for {{event}} apply to this activity.'
where not exists (select 1 from public.agreements where key = 'horseback_waiver' and version = 1);

-- One requirement per horseback activity on a live event. Per participant
-- (the rider is signed for, not the household), required, scoped to the
-- activity and not the event -- the check constraint allows exactly one.
insert into public.agreement_requirements (agreement_id, event_id, activity_id, applies_to, is_required)
select a.id, null, act.id, 'participant', true
  from public.agreements a
  join public.activities act on act.name = 'Horseback riding'
  join public.events e on e.id = act.event_id and e.archived_at is null
 where a.key = 'horseback_waiver' and a.version = 1
   and not exists (select 1 from public.agreement_requirements r
                    where r.agreement_id = a.id and r.activity_id = act.id);
