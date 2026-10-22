# CLAUDE.md — Luke 14 Ministries website & registration platform

The standing brief for any Claude session in this repository. Read it before touching anything; it
outranks habits carried in from other Next.js projects. **Its numbers drift — check them (see
*Working rules*) before relying on one.** History and reasons live in `DECISIONS.md`; this file
says what is true now and what not to break.

---

## What this project is

Luke 14 Ministries is a disability ministry in Morristown, Tennessee — a registered 501(c)(3).
This repository is the ministry's public website **and** its own camp registration platform.

The financial case: Campsite costs the ministry about **7.4% all-in** (July 2026 statement: a 4%
software fee, ~3% card processing and ~$41/month flat — Implementation Plan §3c). Replacing it is
the whole case. Vendors carry only the real risk: payments (Stripe), database and auth (Supabase),
hosting (Vercel), edge protection now and DNS plus the domain registration from launch day
(Cloudflare), identity and documents (Microsoft 365).

Two constraints shape every decision:

1. **A volunteer built this, and a volunteer has to be able to maintain it.** Prefer the boring,
   well-documented option over the clever one. Explain *why* in comments and in `DECISIONS.md`.
2. **It must be live before next camp season's registration opens**, and the maintainer's
   availability drops sharply once the academic semester starts. Front-load. Do not start
   architectural rewrites in October.

---

## Where things stand — 18 October 2026

**Phase 3: built, in staff testing** on the preview site, Stripe in test mode. **Testing Script 6**
is the current script (SharePoint, `01 Plans and Decisions`; Script 5 is kept as the record). The
working checklist is `DO-THIS-NEXT.md`; open policy questions are in `Luke14-Staff-Questions.md` §1.

**Database.** Supabase project `luke14-prod` (ref `nnbcxqxwkivadzognpno`). Migrations run through
**`0118`**. **Never edit a migration that has been run; new work takes the next number.** The CLI
ledger begins at `0012` (`0001`–`0011` predate it) and some files are more than one ledger row
(`0023`, `0028`, `0032`, `0059`, `0070`) — both expected, neither is drift.

**The RLS harness.** `supabase/migrations/rls_test.sql` seeds personas (families, staff at several
grant levels, the camp doctor, an anonymous visitor) and must end `ALL CHECKS PASSED`. Run it
locally — PostgreSQL 16 is on the build machine: `bash supabase/tests/run_rls_local.sh` builds a
fresh database from every migration and runs it. The other suites in `supabase/tests/`
(`payment_plans_rules.sql`, `staff_answers_rules.sql`, `refunds_rules.sql`) run the same way. Run the harness after any
access change; `L14_DB=<name>` gives a second copy when two runs overlap.

**Auth** works end to end: sign-up → confirmation → session → dashboard, with
`handle_new_user()` creating the `public.profiles` row; login, logout, password reset, two-factor.
The two-factor page steps the session up to AAL2 before adding or removing a device.

**Emailed links survive mail scanners and work across devices because of the button page.**
Sign-up and reset emails point at `/auth/confirm/?token_hash=…`; pressing the button verifies the
token server-side with `verifyOtp()`, so a scanner that fetches the page spends nothing and no code
verifier is needed. Template wording: `supabase/EMAIL-TEMPLATE-SNIPPETS.md` (auth mail sends through
Resend from `registration@luke14ministries.net`). Tokens still start `pkce_` — `@supabase/ssr`
forces PKCE regardless, so there is no flow setting to protect. **Protect the templates:** pointed
back at `/auth/callback` with `{{ .ConfirmationURL }}`, links become `?code=` links tied to one
browser again.

**Still open in the code:** the balance-reminder buttons in `app/admin/payments/page.jsx` are
`disabled` placeholders. The public newsletter page links out to a Google Form (whether to replace it
with an on-site sign-up is a design question). Reminder-email wording waits on staff.

**Next, in order (go-live, Phase 4 — detail in DO-THIS-NEXT W51/W22):**

1. **Purge ALL test data** from production. Everything after depends on it.
2. **Live Stripe keys**, and **all three** live-mode webhooks — `stripe-webhook`,
   `stripe-refund-webhook` and `stripe-plans-webhook` (with `STRIPE_PLANS_WEBHOOK_SECRET` and
   `CRON_SECRET` set; the plans endpoint refuses everything until then). Test endpoints do not
   carry over; a missed refund webhook fails silently (migration `0054`). Stripe payouts are
   automatic, daily, no minimum balance (W44, 20 Oct).
3. ~~Vercel Pro~~ — done, 20 Oct 2026 (see *Hosting*).
4. Domain pointed and transferred to Cloudflare in one session; the four preview switches reversed
   together; **archive the 2026 Retreat on Setup.** Board approval gates all of it.

---

## Traps already fallen into — rules for code

- **Every new table needs explicit role grants alongside its RLS policies** — RLS without
  `grant ... to authenticated` is permission denied. Since 30 October 2026 Supabase grants nothing
  automatically to new tables, so this is the rule for every migration, not a habit. The one table
  without a grant, `mfa_trusted_sessions`, is reached only through its functions, on purpose.
- **Never swallow a query error, and never turn one into an empty list.** `/admin/search` returned
  "Nothing matches" for every query for weeks because it did.
- **`/account/*` "my data" queries scope by household membership explicitly** — never rely on RLS
  alone; staff RLS is broad.
- **PostgREST embeds with two foreign keys to one table are refused (PGRST201).** `people ↔
  households` has two paths since `0037`: name the key (`households!people_household_id_fkey`) on
  every such embed, or use separate simple lookups.
- **Never define a component inside another component's body** — React remounts it every render
  (it silently emptied the staff table's job-title boxes). Hoist it to module level; pass props.
- **Adding a column to `person_support` is not finished until `log_family_change()` is
  redefined** to include it.
- **Never "the first published option".** `event_options.find((o) => o.published)` became a money
  bug once an event had two options. Use `enrollmentOption()` in `lib/events.js`.
- **Every event read that feeds a due date must select `events.balance_due_on`.**
- **Supabase refuses every login without a captcha token**, so Claude's own browser cannot sign in
  on localhost as things stand. For a bot round, Lawrence switches Supabase's captcha off
  (Authentication → Attack Protection) and back on afterwards, and resets two-factor on the staff
  bots, which re-enrol on first login (Script 4 and Script 5 rounds). Bots never solve the widget.
- **A `SECURITY DEFINER` view must filter its own rows.** `program_roster`, `clearance_status` and
  `registration_review` are definer on purpose; each carries its own `where`. `0098` recreated
  `registration_review` without one and any family could read every registration's flags (fixed in
  `0102`/`0103`). `CREATE OR REPLACE VIEW` keeps the column list but not the intent — the harness
  checks a family sees no rows from each.
- **A `SECURITY DEFINER` trigger sees `current_user` as its owner.** A guard that asks "is the caller
  staff / a family?" inside one never fires; `0105`'s guards are invoker functions for that reason
  (the harness caught it).
- **A `need` with a colon is split into level and area by `can()`.** `decide:scholarships` is handled
  before the split; it was refused for everyone until 18 Oct. A new compound need goes there too.
- **A function rewritten in place must check the rewrite took.** Python on Windows writes CRLF, and a
  multi-line `replace()` on `pg_get_functiondef()` then silently matches nothing; `0102` caught it with
  a post-check. Prefer restating a function in full.

**One function, one answer** — use these, do not re-derive:

| Question | Use |
|---|---|
| Is this event current? (to two weeks after it ends, a year ahead, never archived) | `isCurrentEventRow()` in `lib/events.js`; pages use the shared `EventFilter` (Check-In's dated pills, Rosters' search-only and the Overview's jump pills are deliberate exceptions) |
| When is the balance due? | `balanceDueOn()` (`lib/events.js`) / `balance_due_on()` (SQL) — both read the event's column |
| How is a stored timestamp printed? (ministry time, never the raw UTC string) | `whenInMorristown()` (a moment) / `dayInMorristown()` (a day) in `lib/events.js` |
| Agreement text for an event | `agreementText()` in `lib/events.js` (fills `{{event}}`) |
| Background-check status shown | `clearancePill()` in `lib/format.js` |
| Is a date of birth real? | `dobProblem()` in `lib/format.js` (a trigger on `people` refuses before 1900 or in the future) |
| Are the support details complete? | `supportProblems()` in `lib/support.js` (browser and `submitFamilyRegistration`) |
| Is a volunteer application complete? | `volunteerApplicationProblem()` in `lib/volunteer.js` (browser and `submitVolunteerApplication`) |
| How are allergies printed? | `allergenWords()` / `allergySummary()` in `lib/support.js` |
| What refund to suggest | `refundSuggestion()` in `lib/payments.js` — a suggestion, never a lock |
| Must a family choose a payment route? | `requiresPaymentChoice()` in `lib/plans.js` — returns `false` |
| May this staff member…? | `can(staff, 'read:<area>' \| 'write:<area>')`, vocabulary in `lib/grants.js` |
| May they decide a scholarship, a hand-set discount or a deposit waiver? | `can(staff, 'decide:scholarships')` / `can_decide_scholarships()` — Payments **and** Registration write (`0102`) |

---

## Access control — read before touching a policy

**Staff access needs a strong session** (`0104`, `0106`): `is_staff()`, `is_admin()`, `has_grant()`,
`leads_program()` and the doctor's access all require `session_is_strong()` — a code-verified
session (`aal2`) or one registered from a remembered browser (`mark_session_trusted()`; 30 days for
families, 7 for staff). A password alone reaches nothing staff can see. **When probing the live
database by hand, a staff persona's JWT claims need `"aal":"aal2"`.** `getStaff().strong` mirrors it
in the app; the middleware holds every signed-in page and server action to the code step.

**Grants, not roles** (`0100`, `0101`). `staff_grants` holds (profile, area, read|write); every
change is logged in `staff_access_log` as `grant:<area>`. Policies and guards ask
`has_grant(area, level)`; **read `0101`'s mapping table before touching a policy** — it is the
decision. Definitions of activities, slots and rooms are Setup write (an administrator);
placements are their own areas; money reads need `payments` read. The role column means one thing,
`admin` (`is_admin()`: granting, accounts, naming a leader, the doctor's dated grant); `registrar`
and `coordinator` are labels. Old names `sensitive`, `giving`, `background_checks` are aliases
(`read:sensitive`, `read:giving`, `write:background_checks`); `registrar` / `coordinator` / `door`
return false. Presets on Staff & Access set ticks; Giving is never in a preset.

**Scholarship decisions are a family act** (`0102`): they need Payments write *and* Registration
write, so Finance (payments write, registration read) records money but does not decide.
`registration_review` is money: rows only for Payments read (`0103`) — it stays definer, because as
an invoker view a reviewer without Payments read would see every family as "neither". Publishing
buddies or rooms goes through `set_event_publication()` (`0103`), which checks Buddies or Rooming
write; the stamps live on `events`, whose own policy needs Setup write. Program leaders stay a grant
on the Programs page; the preset Lawrence wanted (16 Oct) is not built.

**Since `0113`:** a family's new participant row is `draft` or `submitted`, never confirmed, and
`submitted_at` is set by the database; attaching a login to a household is the administrator's,
through `admin_link_login_to_household()`; confirming an agreement signature is Registration write;
`message_log` is read-only for staff; `pay_in_full_amount()` needs Payments read or your own
registration. The money columns left `registration_participants` for `participant_money` the same
day (`0114`, see *Money*).

**Rule of thumb for any access question (Lawrence):** when it is not obvious what a role or person
should have, default to **read**; write is granted on top, for a named person, and logged.

**Program placement is coordination** (`0090`): through `place_in_program()`, a definer function
that touches only `program_id`; the participants table's UPDATE policy is not opened. Naming a
leader is administrator-only, in the database as well as the app.

**Registrar-guarded states on `registrations`:** waiting on the family (`awaiting_family_since`,
`awaiting_family_reason`, `0089`) and on hold (`hold_since`, `hold_reason`, `hold_by`, `0098` —
confirmed and waitlisted people go back to `submitted`; approve, waitlist or "lift" clears it).
`registration_review` carries `on_hold`; the review queue's badge counts only *waiting on staff*.
Staff idle logout is 60 minutes.

**Background checks** (`0091`–`0095`). `person_clearances.verdict` is the ministry's word (`ok`,
`follow_up`, `not_permitted`), set by a holder of the background-checks write grant; who and when
are stamped by trigger, the check date is required once paperwork is on file, expiry follows from
`clearance_interval_months()` (**12** — annual Basic Plus), and every change lands in
`clearance_review_log`. The `clearance_status` definer view gives all staff three facts: on file,
current, verdict. Adults only — under 18 shows "Under 18 — not screened". Screening reads the
household's email and phone where the person has none. The Checkr bulk file's header is their
"bulk order with SMS" template, verbatim; `0093` lets the invited email stand in for a candidate id.

### Program leaders are not staff — a second kind of person reaches `/admin`

A **program leader** has **no row in `staff`**, no role, and none of the permissions in
`lib/staff.js`. What they have is a grant in `program_leaders` naming one program at one event, and
the only thing it buys is the right to read the `program_roster` **view**, filtered to that program.
One leader per program may be marked **lead** (`0071`/`0072`) — a label, not a permission.

- **The view is the permission.** `program_roster` carries names, ages, a buddy, and *flags* for
  allergies and support needs — never the narrative columns. `0061` deliberately adds **no** policy
  to `registration_participants`, `people` or `person_support`: a leader who can select the
  participant row can select every column on it.
- **`program_roster` is a `SECURITY DEFINER` view, and that is intended.** A leader holds no read on
  the tables underneath; the view's own `where public.is_staff() or public.leads_program(...)` is the
  row filter. Supabase's advisor reports it as an ERROR; the acceptance is in `DECISIONS.md`,
  30 August. **Do not "fix" it by switching to `SECURITY INVOKER`** — that silently empties every
  leader's roster.
- **Leaders are held to the two-factor rule too**, in `app/admin/layout.jsx` — what they see is a
  list of disabled children's first names.

---

## Money — read before touching it

- **Discounts are rules recomputed from stored facts, each in its own column, each capped at what
  the person owes:** both weeks `discount_cents` (`recalc_multi_week_discount()`, `0070`), early
  registration `early_discount_cents` (`recalc_early_registration_discount()`, `0080`), family
  `family_discount_cents` (`recalc_family_discount()`, `0081`; run before the early recalc —
  `recalcEarly()` does both). Each recalc **touches only discounts carrying its own
  `discount_reason`**; a manual staff discount is invisible to it. Amounts are event settings
  (`family_discount_cents`, `family_discount_from_person`, `multi_week_discount_percent`, `0096`);
  `recalc_event_discounts()` re-runs them after Setup saves. Whether volunteering must cover both
  weeks is still with staff — named constants at the top of `recalc_multi_week_discount()`.
- **"Deposit received" means the whole deposit** — $50 per fee-paying person, or a waiver (`0109`); a
  short payment is *No full deposit yet* with the `deposit_short` flag. The camp's medical contact
  is `event_medical_contacts` (`0109`): staff, leaders and households registered for the event only.
- **Due date** is `events.balance_due_on` (July 1 for the camp weeks, set on Setup, `0096`).
- **Submitting needs nothing paid; approval needs the deposit** ($50 per person) or a full-scholarship
  request. `registration_review` gives three classes (deposit received — `succeeded` money only;
  full scholarship requested — what the family **asked** for, or what staff granted, never a
  grant read as a request (`0112`); neither) and flags (deposit short, photo permission declined, Creed
  not affirmed). Someone who may decide scholarships can **waive the deposit** (`waive_deposit()`:
  the mark plus a per-person deposit scholarship, a pending request left pending — `0103`; the view
  then reads `deposit_paid` with `deposit_waived`, and no page asks the family for it).
- **One role per person per event** (`0086`); the wizard does not offer a second and the database
  refuses it.
- **Payment plans** (`0080`): created only by `stripe-plans-webhook`; families read, never write; the
  daily `charge-payment-plans` function shares logic with the webhook via
  `supabase/functions/_shared/`. Families cannot edit money columns on `registration_participants`.
  **Not live until `supabase/PAYMENT-PLANS-SETUP.md` is done.** Plans and pay-in-full are offered at
  `/account/finish/[registrationId]` ("Ways to pay"; `registration_payment_routes` view).
- **A person's money lives in `participant_money`** (`0114`, one row per participant:
  `fee_cents`, `scholarship_cents`, `discount_cents`, `discount_reason`, `early_discount_cents`,
  `family_discount_cents`), **not on `registration_participants`** — those columns are gone. Read it
  through the embed `participant_money ( … )` on any participants select; the row is visible to the
  family it belongs to and to Payments read, and **null means "not yours to see", never zero**.
  Nobody signed in writes it: the fee is filled by a definer trigger from the event option (and
  re-copied when the option changes); staff decisions go through
  `set_participant_adjustments(participant, scholarship, discount, reason)` (Payments **and**
  Registration write; capped at the fee; the reason is written verbatim, so pass the current one
  back when only the scholarship changes); the discount rules and `waive_deposit()` run as owner.
  `registration_balances` joins it and so **returns no row** to staff without Payments read — a
  `.maybeSingle()` caller shows "—", never 0, and the deposit check asks for the full deposit.
- **The money audit trail** (`0111`): every write to `payments`, `payment_refunds`, `payment_plans`,
  `coupons`, `coupon_redemptions` and `participant_money` lands in `money_change_log` (administrators read it). A
  refund row is edited only while pending and its money never changes; a payment with a refund on
  file stays with its family; `payments.status` follows the refunds on file. **Plans are created
  only by Stripe's webhook** — staff change status, the early-discount decision, the cancel stamps
  and the note. **Coupons have no signed-in writer** until a screen exists. Scholarship plus
  hand-set discount is capped at the fee in the database. The discount rules (`recalc_*`) run for
  staff, the family's own registration or a server-side caller; the "both weeks" volunteer
  discount needs volunteer rows staff have **confirmed**. `registration_paid_cents()` is the
  deposit question for any staff member (the balances view runs with the caller's rights).
- **Refunds:** `charge.refunded` → `supabase/functions/stripe-refund-webhook/`; per-family refunds via
  `refundPayment` in `app/admin/registrations/[id]/actions.js`; the over-refund guard and
  pending-refund accounting are `0038`/`0044`/`0053`/`0054`. Since `0107` the row is reserved before
  Stripe is called (the guard locks the payment), each form sends a one-time `request_key`, and the
  webhook fills the reserved row (`metadata.refund_row_id`). A payment's status never moves back to
  processing once received, refunded or failed.
- **Agreements are signed per person:** one `agreement_signatures` row per person per agreement,
  `signer_role` = `self` | `parent_guardian` | `legal_guardian` | `authorized_adult` (the last needs
  the signer's explicit affirmation). Written by `app/register/family/actions.js`, not the RPC;
  people added later are signed for then; old household-wide rows still cover whoever was on the
  registration when signed. The scholarship and pay-by-check agreements are retired. The Creed
  agreement is at version 3 (`0088`). An agreement can also be a condition of **one activity**
  (`agreement_requirements.activity_id`, first used in `0116` for the Horseback Riding Waiver): the
  Activities page opens it when the rider is ticked onto the activity and saves the signup only with
  the signature (`app/account/activities/actions.js`, scoped to the caller's household). Staff set an
  activity's waiver on the Activities page editor's **Waiver** block (`0117`, 21 Oct): none, the
  outside provider's form (`provider_name`/`provider_url`), or the ministry's own — reused from
  another activity at its current version, or written there. New text is **version n+1 of the same
  key, never an edit in place**; the old version is retired only once no activity points at it, and
  only the edited activity moves. `admin_create_event()` copies activity-scoped requirements since
  `0117` (0083 filtered on `event_id`, which an activity row never has).

**Registration details.** A camper's support and medical details are asked inside the wizard
(card 4) and are a condition of submitting (`0097`; `submitFamilyRegistration` writes
`person_support` and stamps `details_saved_at`); `components/SupportDetailsFields.jsx` serves the
wizard and the dashboard form. Allergens are a tick list (`person_support.allergens`, fixed
vocabulary, `allergy_other`; `allergy_detail` means "what happens"); rows saved before `0097` show
"Other: …" until re-saved. Outside-provider waivers need an uploaded confirmation (`0087`, private
bucket `waiver-confirmations`). Volunteers arrive a day early (`events.volunteer_arrives_on`).
Data-deletion requests: `/account/delete-data` → `/admin/deletion-requests`; nothing is deleted
automatically.

---

## Stack

Next.js 16 (App Router, **JavaScript — not TypeScript**), Tailwind CSS 4 (CSS-first: the brand
colours and fonts are `@theme` tokens in `app/globals.css`, `lib/` is scanned by its `@source` line,
there is no `tailwind.config.js`), Vercel; Supabase (Postgres +
Auth); Stripe. The request-time hook is `proxy.js` (Next 16's name for `middleware.js`; comments
saying "the middleware" mean it). `app/` routes, `components/` shared UI, `lib/` helpers, `public/`
static assets. `.github/workflows/build.yml` lints and builds every push to `main`.

---

## Blocking facts — read these before writing code

- **`output: 'export'` is gone — do not put it back.** It disables all server code. `next.config.mjs`
  carries `trailingSlash: true` and the security headers (the content security policy is
  report-only until a test round shows no reports); **`trailingSlash` stays** (removing it turns
  `/about/` into `/about` across every link). Anything calling this site a "static export" is out of
  date.
- **GitHub Pages is retired — do not revive it.** Hosting is Vercel only, through its GitHub
  integration. The repository is `https://github.com/luke-14-ministries/website.git` (formerly
  `luke-14-ministries.github.io`; GitHub redirects). The `Production` environment under Settings →
  Environments is **Vercel's** — leave it alone. **`build.yml` is not a deploy workflow**; if it
  ever grows a step that uploads, publishes or deploys, something has gone wrong.
- **`NEXT_PUBLIC_BASE_PATH` must stay unset on Vercel.** Setting it breaks every link and image and
  looks like a CSS problem. `asset()` in `lib/site.js` still reads it and returns paths unchanged —
  known dead weight in 16 files, not a bug to fix.
- **The site is deliberately hidden from search engines — do not "fix" this.** Four switches:
  `public/robots.txt` (`Disallow: /`); `app/layout.jsx` `robots: { index: false, follow: false }`;
  the `"(Preview Build)"` title suffix in `app/layout.jsx`; `components/PreviewBanner.jsx`.
  **All four are reversed together in Phase 4, at launch, and only with board approval.** One early
  publishes a mock-up; one forgotten fails silently for months. Treat them as one checklist item.

### What is in DNS *(verified 7 August 2026)*

`luke14ministries.net`:

- **Nameservers** `ns01`–`ns04.squarespacedns.com`; the public site is **Squarespace, not
  WordPress** (older documents are wrong).
- **The registrar is Squarespace until launch day**, when the domain transfers to Cloudflare
  Registrar in the same DNS session that points it at Vercel. Until then nobody edits the registrant
  contact at Squarespace (60-day transfer lock). Steps: DO-THIS-NEXT W51.
- **Mail is Microsoft 365** — MX `luke14ministries-net.mail.protection.outlook.com`, plus an `MS=`
  verification token.
- **SPF is `v=spf1 include:spf.protection.outlook.com -all`** — a *hard* fail. Adding a sender means
  editing this exact line; an error silently breaks every staff email. Change it carefully, with
  someone watching, and never as the last task of a session.
- **DMARC exists but does nothing**: `v=DMARC1; p=none`, no `rua=` reporting address.
- **No Mailchimp or other bulk sender is authorised on this domain.**

---

## Security rules — non-negotiable

These are the ministry's rules, agreed at board level. Do not relax them for convenience.

- **No secret ever enters this repository, OneDrive, or SharePoint.** Not in a commit, not in a
  comment, not "temporarily." Keys live in Vercel's environment variables plus the shared
  password vault. `.env.local` is gitignored; `.env.example` is the committed template and
  contains names only, never values.
- **Test keys only until launch.** Fake money, throwaway data. Live Stripe keys appear once, at
  go-live, and only in Vercel's environment settings.
- **The Supabase `service_role` / secret key bypasses row-level security entirely.** It never
  goes in the browser, in this repository, in SharePoint, or in a chat transcript. Server-side
  only, from an environment variable, and only where genuinely required.
- **Row-level security is enforced at the database level**, not in application code. Every table
  holding family data gets RLS policies. A query that works because the app "wouldn't ask for
  that row" is not secured.
- **No real family data in the preview.** It is a mock-up, and mock-ups leak.
- **No Social Security number, and no report content, ever enters this system.** That is the
  principle, and it holds. What is actually stored has grown: alongside
  `background_check_on_file`, `background_check_date` and `expires_on`, migration `0029` added a
  `volunteer_clearances` table with Checkr integration columns — `provider`,
  `checkr_candidate_id`, `checkr_invitation_id`, `checkr_report_id`, `checkr_package`,
  `checkr_status`, `adjudication`, `invitation_sent_at`, `report_completed_at`, `last_synced_at`.
  These are identifiers, a status and timestamps: pointers into Checkr, never the screening data
  itself. Checkr's **hosted invitation** flow is what keeps it that way — the volunteer types
  their SSN and date of birth into Checkr's own form, and we receive only pass/fail. It cannot
  leak from us because we never have it. **`0029` was a placeholder and no longer is** — corrected
  30 August, having said "nothing writes them yet" for four days after it stopped being true.
  `0056`–`0060` built the flow out and `app/admin/volunteers/screening/actions.js` writes
  `person_clearances` today: `provider`, `checkr_status`, `checkr_report_id`,
  `checkr_candidate_id`, `checkr_package`, and a `screening_results` jsonb holding one verdict
  WORD per screening. The guarantee is unchanged and is the reason the file-based flow was chosen
  over the API — verdict words and pointers, never report content, and no SSN at any point. The
  underlying paperwork still lives in a
  permission-restricted SharePoint folder. Never in email, never in the app. A future flow that
  would collect PII into this table is a board decision, not a pull request.
- **Never paste a key, token, or camper's personal information into a Claude conversation.** A
  secret that appears in a transcript is compromised and must be rotated.
- **Two-factor authentication on every account** — GitHub, Vercel, Supabase, Stripe, Microsoft.
  Prefer authenticator-app (TOTP) over passkeys on shared ministry accounts: a passkey is bound
  to one device and cannot be shared between two admins; a TOTP seed can live in the vault.

---

## Working rules

- **Never let OneDrive or SharePoint sync this repository.** It corrupts `.git`. The working copy
  lives at `C:\dev\luke14`. Documents go to SharePoint; code does not.
- **Ownership is the ministry's, not a person's.** Production accounts are created under
  `admin@luke14ministries.net`. Never bind a ministry account to a personal GitHub login, and
  never add `admin@` as a verified email on a personal GitHub account.
- **Do not point the domain.** `luke14ministries.net` serves the ministry's **Squarespace** site;
  pointing it retires that site — a board decision, Phase 4, and on that day the registration moves
  to Cloudflare in the same session (DO-THIS-NEXT W51).
- **Record decisions in `DECISIONS.md`** — one short entry per real choice, written when it is made,
  newest at the bottom. Dated narrative goes there, not here.
- **Check this file's numbers before trusting them, and fix any that are wrong in the same
  session.** The hand-edited document drifts; the regenerated ones do not. Two commands settle most
  of it:

  ```powershell
  (Get-ChildItem supabase\migrations -Filter '0*.sql').Name | Select-Object -Last 2  # the real high-water mark
  git log -1 --date=short --format=%ad                                              # how old "where things stand" is
  ```

  The filter matters: `README.md` and `rls_test.sql` in that folder sort after every numbered file.
  A claim about what is *built* cannot be checked this way and goes stale hardest.
- **SharePoint documents: edit the Markdown, regenerate the PDF** with `md files\render.py`
  (`render_checklist.py` for testing scripts). **The ink guard:** a PDF changed by a person since the
  script last wrote it (ink, comments) is not overwritten. Copy it to
  `00 Comments and Critiques\Testing notes` under a dated name **before** re-running with `--force`.
- **Commit in small, described steps.** The commit log is documentation for a future volunteer.
- **Ask before adding a dependency.** Every package is something someone has to keep updated.
- Commit identity is the ministry account, not a personal address. Check `git config user.email`
  if commits start showing up attributed oddly.

---

## Phase roadmap

- **Phase 0** — accounts, ownership, vault, register, governance. Done except printed recovery codes.
- **Phases 1–2** — the core (schema with RLS, sign-up, wizard, Stripe test mode) and the full staff
  admin. **Complete.**
- **Phase 3 — now.** Review by real people on the preview URL. Test keys, no real families.
- **Phase 4 — launch.** Vercel Pro, live Stripe keys, domain pointed, all four preview switches
  reversed together. Board approval gates it.

---

## Hosting

Vercel is on **Pro** since 20 October 2026, with tax-exempt status applied. Hobby was legitimate for
Phases 1–3 only: it is non-commercial (Vercel counts donations as commerce) and one seat. Pro is
$20 per developer seat per month; viewer seats are free, so the second administrator can be added
without cost. Implementation Plan §8.

---

## Where the documentation lives

SharePoint library *Luke 14 Ministries Team Site — Website* (Markdown in each folder's `md files\`):

- `GLOSSARY.md` (root `md files\`) — the project's words in plain English. When a non-technical team
  member asks what a word means, answer in its terms and point them at `Luke14-Glossary.pdf`.
- `IMPLEMENTATION-PLAN.md` — why, and the phase plan (`01 Plans and Decisions`).
- `Luke14-Staff-Questions.md` — open questions (§1) and what staff decided (`01`).
- `Luke14-Access-Model-Plan.md`, `Luke14-Build-Plan-2026-10-16.md` — the grants model; the
  16 October build list (`01`).
- `Luke14-Testing-Script-6.md` — the current test script; `Luke14-Testing-Script-5.md` is the
  record (`01`).
- `DO-THIS-NEXT.md` — the ordered working checklist (`02 Accounts and Setup`).
- `Luke14-Account-Register.xlsx` — every account, owner and second admin; no passwords, ever (`02`).
- `Luke14-Web-Admin-Handbook.md` — procedures, for the second admin (root).

Repository: `CONTRIBUTING.md` (conventions), `DECISIONS.md` (the decision log),
`supabase/PAYMENT-PLANS-SETUP.md`, `supabase/EMAIL-TEMPLATE-SNIPPETS.md`.
