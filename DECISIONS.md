# Decisions

One short entry per real choice, written when the choice is made. In six months this is the only
record of why anything is the way it is — including the things that look odd and are deliberate.

**How to use it.** Add new entries at the bottom, newest last. Each entry gets a date, a one-line
title, what was decided, and — the part that actually matters — *why*, and what the alternative was.
An entry that only records what was decided is half an entry: the next person needs to know whether
the reasoning still holds before they undo it.

Decisions that carry a real risk of being "fixed" by someone who does not know the reason are
marked **Do not reverse without reading this.**

The first several entries below were made between late July and 4 August 2026 and were written up
together on 4 August, which is why they share a date.

---

## 2026-08-04 — Build the registration platform rather than continue renting one

The ministry pays Campsite 6% on every transaction. On camp registration volume that is the single
largest avoidable cost in the operation, and it recurs every season forever. Building the platform
replaces that with Stripe's per-transaction rate — 2.9% + 30¢ on cards, or 0.8% capped at $5 by
bank transfer — plus roughly $45/month of hosting and database at launch. *(This entry originally
said 2.2% on Stripe's nonprofit rate. That was wrong; see the entry below dated the same day.)*

Vendors are still used, but only where they carry risk the ministry should not: payments (Stripe),
database and authentication (Supabase), hosting (Vercel), DNS and edge protection (Cloudflare),
identity and documents (Microsoft 365). The rule is that we do not hand-roll anything that would
make us liable for other people's money or other people's children's data.

*Alternative considered:* staying on Campsite. Cheaper in effort, and it stays cheaper right up
until you multiply 6% by the number of seasons remaining.

---

## 2026-08-04 — Production accounts are created under `admin@luke14ministries.net`

`admin@` is a Microsoft 365 distribution group forwarding to `lawrence@` and `larry@`. It has no
mailbox, no password, and no shared login. Every vendor account — Vercel, Supabase, Cloudflare,
Stripe — is registered to it.

The reason is ownership. An account created under a personal address belongs to that person, and
recovering it later means asking that person, who may by then have left, changed email, or lost the
phone. With `admin@`, a password-reset email arrives in both admins' inboxes and either one can
complete a recovery without the other.

The corollary is that a reset email nobody requested is an alarm rather than spam, and that
two-factor on `lawrence@` and `larry@` themselves matters as much as two-factor on the vendors —
either mailbox is enough to take over any vendor account.

**Never sign up with "Sign in with GitHub."** Vercel and Supabase both offer it and it is the faster
path, but it quietly binds the account to a personal GitHub login, which is the exact problem this
address exists to solve.

---

## 2026-08-04 — Two-factor uses authenticator apps (TOTP), not passkeys, on shared accounts

A passkey is bound to one device and cannot be shared between two admins. A TOTP seed can live in
the shared vault, where both admins can generate codes from it. On accounts the ministry owns
jointly, that difference decides it.

This is also why setting up the password vault is a genuinely blocking task rather than a tidy-up
one: until it exists, each vendor's authenticator seed sits on exactly one phone, and the printed
recovery codes are the only way back in if that phone is lost. Save those codes at the moment each
account is created.

SMS two-factor is not an option here either — there is no phone number attached to `admin@` to
share. And email-code two-factor is actively wrong on these accounts, because the code would arrive
in the same inbox as the login link.

---

## 2026-08-04 — The site is hosted on Vercel; GitHub Pages is being retired

GitHub Pages serves static files only. Every item in Phase 1 — family sign-up, login, storing a
registration, taking a payment — needs server-side code, which Pages cannot run at all. Vercel runs
the same Next.js application with the server side intact, rebuilds on every push, and costs nothing
during development.

This leaves the repository with a Pages-shaped name, `luke-14-ministries.github.io`. That name is a
Pages *instruction* rather than a description: a repository named `<org>.github.io` is served at the
organization root, which is also the reason `basePath` exists in the Next config. The repository
will be renamed to something ordinary once Pages is switched off, in that order — renaming it first
turns Pages off abruptly.

*Carried out on 5 August 2026 exactly in that order. See the entry of that date for what was done
and what was checked first.*

---

## 2026-08-04 — The preview URL is `luke14-ministries.vercel.app`, and it is public

**Do not reverse without reading this.**

There have been two preview addresses in circulation, which is confusing enough to be worth
recording. The Vercel production address is the one to share.

Vercel's deployment protection is switched on and its label — "all except custom domains" — reads as
though the production address is behind a login. It is not. Tested in a private browser window on
4 August 2026: `luke14-ministries.vercel.app` loads for anyone with the link. What deployment
protection actually gates is the *per-deployment* URLs, the long ones generated for each individual
build and each branch.

Two consequences follow. The board can be sent the production address directly. And during Phase 1,
a reviewer who is not a paid Vercel seat cannot open a branch preview at all — they can only see
what has been merged to `main`. On the free Hobby plan there is one seat, so that reviewer is
everyone except Lawrence. It resolves at launch, when Pro's viewer seats (free) become available.

The site stays out of search results because of the noindex switches, not because of any password.

---

## 2026-08-04 — The site is deliberately hidden from search engines until launch

**Do not reverse without reading this.**

Four switches, all intentional while this is a preview: `Disallow: /` in `public/robots.txt`;
`robots: { index: false, follow: false }` in `app/layout.jsx`; the `"(Preview Build)"` title suffix
in the same file; and the red banner in `components/PreviewBanner.jsx`.

They are one four-part checklist item, reversed together at launch in Phase 4, and only with board
approval. Reversing any of them early publishes a mock-up as if it were the finished site.
Forgetting one at launch fails *silently* — the site simply never appears in search results, and
nobody notices for months.

---

## 2026-08-04 — Vercel stays on the free Hobby plan until go-live, then moves to Pro

Hobby is the right plan for building and is legitimate for Phases 1 through 3. It is not legitimate
at launch: Vercel's fair-use terms restrict Hobby to non-commercial use and count "any method of
requesting or processing payment from visitors of the site," adding explicitly that asking for
donations counts too. Being a 501(c)(3) does not change it — the test is what the site *does*, not
what the organization is.

Hobby is also a single seat, which conflicts with the two-admins-on-everything rule.

The trigger for upgrading is therefore the moment live Stripe keys go in, not a date. Pro is $20 per
developer seat per month; viewer seats are free.

---

## 2026-08-04 — `NEXT_PUBLIC_BASE_PATH` stays unset on Vercel

**Do not reverse without reading this.**

The variable exists so GitHub Pages can serve the site from a subfolder. Setting it on Vercel breaks
every internal link and every image — and it fails in a way that looks like a broken stylesheet
rather than a configuration mistake, which is how it costs an afternoon. It is deliberately absent
from Vercel's environment variables rather than set to an empty string, so there is nothing there to
be "corrected" later.

---

## 2026-08-04 — The ministry's Cloudflare account is `Admin@luke14ministries.net's Account`

**Do not reverse without reading this.**

Cloudflare creates a personal default account for every user automatically at signup. So
`Lawrence@luke14ministries.net's Account` exists alongside the ministry's, was not created on
purpose, and cannot be tidily deleted. It is empty and should stay empty.

The risk is specific: "Add a site" drops the domain into whichever account happens to be selected.
If that is the personal one, the ministry's DNS ends up under a personal identity — exactly the
failure mode `admin@` exists to prevent, and unpleasant to unwind once nameservers point at it.

The rule: the ministry's zone, when it eventually exists, belongs to
`Admin@luke14ministries.net's Account`. The personal accounts are ignored.

Cloudflare's "Organizations" layer is a beta feature for companies managing many accounts. It adds
nothing here and is not used.

---

## 2026-08-04 — Both Cloudflare admins get Super Administrator, not a narrower role

Cloudflare's free plan offers a full catalogue of scoped roles, so least privilege was available and
was considered. It was rejected on purpose.

Least privilege protects against a compromised or careless *account*. The failure mode this project
actually faces is different: one of two admins being unreachable when something needs doing. A
narrower role does not reduce that risk, it increases it, because the remaining admin discovers the
gap at the worst possible moment. The audit-log benefit people usually want from scoped roles —
knowing *who* did something — is fully preserved here by each admin having their own login rather
than sharing `admin@`.

Note that Cloudflare's list contains read-only roles with names nearly identical to the full ones.
The role to select reads **Super Administrator — All Privileges**.

A third volunteer, if one appears, is a different case: a scoped read-only role would suit them, and
those are free.

---

## 2026-08-04 — The domain is not pointed, and Cloudflare's "Add a site" is not run

**Do not reverse without reading this.**

`luke14ministries.net` still serves the existing Squarespace site. Pointing it retires that site,
which is a board decision rather than a technical step, and it happens in Phase 4.

Worth stating separately because it does not look like the same decision: Cloudflare's "Add a site"
flow *is* pointing the domain. It ends at "change your nameservers at your registrar." The
Cloudflare account therefore stays empty — no zone — until Phase 4.

It is also possible the domain is already on Cloudflare via the current site host, in which
case the eventual move is a zone transfer between accounts rather than a fresh add. That depends on
the still-outstanding question of which registrar holds the domain.

---

## 2026-08-04 — Password vault: Bitwarden Families is the working choice, not yet committed

Bitwarden Families, $47.88/year, up to six users with premium features for every member. The
requirement that decides it is that *both* admins must be able to generate a two-factor code
without phoning the other one. Bitwarden Free has no built-in authenticator at all; Bitwarden
Premium at $19.80/year covers exactly one user, which is the same single point of failure in a
nicer wrapper. 1Password Families is comparable at $53.88/year with no free tier; its nonprofit
program is real but commits to nothing specific in writing.

**Emergency Access is not the reason to buy either one.** It sounds like the answer to "what if one
admin is unreachable," and it is not: Bitwarden's Emergency Access reaches only the grantor's
*personal* vault, not the shared organization collection where the ministry's credentials live.
Bitwarden's own answer for shared credentials is organization account recovery, a Teams/Enterprise
feature and out of scope.

*Corrected 29 August 2026 in DO-THIS-NEXT, recorded here 1 September: the claim above is wrong in
the case that applies. Emergency Access **Takeover** hands the contact the grantor's whole account —
and an Owner's ownership of the organisation goes with it. So it is not too small for this job; it is
far too large, and granting it is a succession decision for the board, not a setting. The practical
conclusion is unchanged: two owners holding the collection live, printed recovery codes offline in two
places, and a periodic encrypted export on offline media.*

Resilience comes from three ordinary things instead: both admins holding the shared collection live
as owners; each account's recovery codes printed and stored offline in two separate places; and a
periodic encrypted vault export on offline media — **never** in OneDrive or SharePoint, because an
encrypted export is still a secret.

Whichever is chosen is billed to the ministry, on `admin@`, and recorded in the account register.

---

## 2026-08-04 — Secrets never enter this repository, OneDrive, or SharePoint

**Do not reverse without reading this.**

Keys live in Vercel's environment variables plus the shared password vault. `.env.local` is
gitignored; `.env.example` is the committed template and contains names only, never values.

Everything is built with Stripe **test** keys and fake data until launch. Live keys appear once, at
go-live, and only in Vercel's environment settings.

The Supabase `service_role` / secret key bypasses row-level security entirely. Server-side only,
from an environment variable, and only where genuinely required — never in the browser, the
repository, SharePoint, or a chat transcript. A secret that appears in a transcript is compromised
and must be rotated.

Row-level security is enforced at the database level rather than in application code. A query that
returns the right rows because the application "would not ask for that row" is not secured.

Background-check paperwork never touches this system: the database stores a boolean and a date, and
the documents live in a permission-restricted SharePoint folder.

---

## 2026-08-04 — Stripe's nonprofit rate does not apply to camp registration

**Do not reverse without reading this.** Recorded because someone will otherwise "discover" the
nonprofit rate and re-run the same dead end.

Stripe's discounted rate of 2.2% + 30¢ is for **donations**. Eligibility requires that more than
**80% of the account's payment volume be tax-deductible gifts**, and Stripe explicitly names
registration fees, tuition and ticket sales as not qualifying. A camp registration is a fee for a
service the family receives, so a registration account fails the test. Applying would waste the
review and return a refusal. Square publishes no nonprofit rate at all.

**The planning number for registration is therefore 2.9% + 30¢.** The project's case is unharmed —
still under half of Campsite's 6% — but the plan should not quote a rate the ministry will never be
charged.

**PayPal's confirmed-charity rate is a genuinely open question**, and the reason is set out in the
5 August processor entry below: its terms exclude some "Payment Types" without publishing a list,
and "Payment Type" means PayPal's products rather than the nature of the income. The open item is
to ask PayPal in writing.

---

## 2026-08-04 — Stripe for registration; PayPal keeps donations; Square keeps in-person

The ministry already used PayPal and Square, so adding Stripe needed a reason better than developer
preference. On price there is barely a reason at all: on a $300 registration Stripe's card fee is
$9.00 and PayPal's Advanced Checkout is $8.96. Anyone claiming a decisive price win either way is
rounding in their own favour.

Stripe was chosen for **registration** on everything other than rate: it is built to be embedded in
someone else's application, which is precisely what this project is; its webhooks are what let the
roster mark itself paid without staff reconciling anything; it has a complete test mode with fake
money, which is the single feature that makes it safe for one volunteer to build a payment flow;
and its documentation is good enough that the next maintainer has a chance. It also offers **bank
transfer at 0.8% capped at $5** in the same checkout — $2.40 on a $300 registration against $18.00
on Campsite — which is the largest saving available anywhere in this project and larger than any
difference between card processors.

**PayPal keeps donations.** Its charity rate of 1.99% + 49¢ genuinely beats Stripe on gifts, and
donors already have accounts and trust the button. Moving gifts to a processor that charges more
for them would be a mistake.

**Square keeps in-person.** At 2.6% + 15¢ it beats every online rate here and the hardware is
already bought, though it is not the cheapest card-present option available — see the PayPal POS
entry below. Square's online rate of 3.3% + 30¢ on the free plan is the worst in the comparison,
which is why it is not the answer for registration.

*Cost of this decision, stated plainly:* three sets of deposits to reconcile rather than one. It is
kept manageable only by the discipline of one purpose per processor. Taking registrations on PayPal
some season because it was quicker is what turns three tidy streams into a reconciliation problem.

*Alternative considered:* consolidating everything onto one processor for the treasurer's sake and
accepting a worse rate somewhere. That is a legitimate board choice and it remains available — but
it should be made deliberately, not by drift.

Reasoning in full: Implementation Plan §3b.

---

## 2026-08-04 — The working copy lives at `C:\dev\luke14`, outside OneDrive

**Do not reverse without reading this.**

OneDrive and SharePoint sync corrupts `.git`. The repository was moved out of OneDrive for exactly
this reason and must not be moved back, and no clone should be made inside a synced folder.

Documents go to SharePoint. Code does not.

---

## 2026-08-05 — The registrar never goes inside the hosting account; Cloudflare is deferred, not rejected

**Do not reverse without reading this.**

The question was whether the registrar line can be absorbed by a vendor already on the list.
Checked 5 August 2026: **GitHub does not sell domains at all.** **Vercel does**, passing registry
pricing through, but provides no email service for domains registered with it. **Cloudflare
Registrar does**, genuinely at cost — Cloudflare states it "does not mark up domain prices at all"
— which for `.net` is about $11/year against WordPress.com's $14 and a typical registrar's $15–20.

Consolidating would therefore save roughly **$3 to $9 a year**, against a project whose financial
case is measured in thousands of dollars of transaction fees. That is not a number worth optimising,
and two arguments run the other way.

**The registrar is the vendor you need reachable when another vendor fails.** The domain is the
lever that lets the ministry move: if Vercel has an outage, a billing dispute, or an account
lockout, the recovery is to re-point the domain elsewhere. If the domain lives inside the locked
account, that recovery is gone. **And the domain outlives every technical decision here** — hosting,
database and framework may all change over a decade; `luke14ministries.net` should not have to move
each time.

There is also a timing trap worth recording. **Transferring to Cloudflare Registrar requires the
domain to use Cloudflare for authoritative DNS first** — Cloudflare's documentation is explicit that
you must add the domain to Cloudflare before you can transfer it. Adding the domain means changing
nameservers, which *is* pointing the domain away from the current Squarespace site. **A registrar
transfer to Cloudflare is the domain switch wearing a different hat**, and the domain switch is a
board decision in Phase 4. Anyone who treats it as tidy-up housekeeping will retire the ministry's
live website by accident.

*Alternative considered:* moving to Cloudflare Registrar at Phase 4, when the domain is being
pointed anyway and the nameserver requirement costs nothing extra. That remains genuinely open and
is a reasonable thing to do — it is only the *sequencing* that is decided here.

**One distinction to keep straight, because the two vendors sit in different positions.** The rule
is that the domain must not live inside **the account that hosts the site** — Vercel. Cloudflare is
not the host; it is DNS and edge protection, the place you would re-point *toward*, not away from,
and its at-cost registrar is perfectly defensible on the principle above. The only thing standing
in the way today is the nameserver sequencing described just above.

**Named independent alternative, if one is ever wanted: Porkbun** — `.net` at $12.52 for both
registration and renewal, free WHOIS privacy, SSL and email forwarding, and no relationship to any
other vendor in this stack. Namecheap ($18.58) is the more conservative, better-known option. This
only becomes relevant if the domain turns out to sit somewhere the ministry cannot reach, in which
case moving it to a neutral registrar is a clean step that touches neither DNS nor the live
Squarespace site.

*What is not decided:* where the domain currently is. Tracing that, and getting the ministry onto
that account on `admin@` with 2FA, is Phase 0 work and blocks GitHub domain verification and the
launch DNS change. Reasoning in full: Implementation Plan §8.

---

## 2026-08-05 — Background checks are an open question, not a requirement

The project's documentation treats volunteer background checks as settled, with a design rule
attached: the database stores only `background_check_on_file` and `background_check_date`, while the
paperwork lives in a permission-restricted SharePoint folder. That rule appears in the
Implementation Plan, `CLAUDE.md`, `CONTRIBUTING.md`, the board packet and the phase roadmap.

Traced back, the requirement comes from **one line in the July 2026 decision brief** —
"volunteer applications: application form, the $495/week volunteer fee, and coordination with
background-check paperwork" — plus a second line about sensitive paperwork belonging in
access-controlled storage. Nobody at the ministry has confirmed that Luke 14 runs background checks
today or intends to. An assumption load-bearing in five documents should not rest on one line of an
early brief.

**Decided:** the design rule is kept — it is the right answer *if* checks exist, and it costs
nothing to hold in reserve — but it is now labelled unconfirmed everywhere it appears, and **Phase 2
builds the volunteer application without a background-check field unless the ministry confirms
otherwise.** The question is on the open list (Implementation Plan §11, question 7).

*Why this matters beyond the field itself:* building storage for a compliance process the ministry
does not actually run creates an appearance of compliance that nobody is maintaining, which is worse
than not having the field.

---

## 2026-08-05 — Campsite's cost is two-part, and the fixed half is the larger half

Every earlier version of the plan justified this project on Campsite's **6% transaction rate**
alone. Checked 5 August 2026 across **GetApp, Software Advice, Capterra and Software Finder**, all
four independently list Campsite at **$249 per month**, flat, with no free tier and no free trial.
Software Finder adds implementation at $500–$3,000, migration at $200–$1,000 and custom development
at $100–$200/hr.

**The consequence:** Campsite's fixed cost is roughly **$2,988 a year**, against about **$540 a
year** for everything we are building. The ministry is about **$2,448 a year** better off before a
single registration is processed. Total annual cost at $300 average registrations: at $25,000 of
volume, $4,488 versus $1,290 by card or $740 by bank transfer; at $50,000, $5,988 versus $2,040 or
$941; at $100,000, $8,988 versus $3,540 or $1,340.

**Why this is recorded as a decision and not just a fact:** it changes how the project is
justified. The 6%-only framing made the saving proportional to volume, which implied a quiet
threshold below which the build was not worth doing. A fixed annual platform fee removes that
threshold — the project pays for itself at essentially any volume, including a season with none.
Anyone presenting this to the board should lead with the fixed cost, not the percentage.

**The honest limit on all of it:** none of the four sources is Campsite's own price list, and
Campsite does not publish one. Directory listings go stale and cannot show a legacy or negotiated
rate. **$249/month is a working figure until the ministry's invoice confirms it**, and getting that
invoice is now an item in Do This Next. If the 6% turns out to be all-inclusive, the earlier
framing was right and this entry should be amended rather than deleted.

*Alternative considered:* waiting for the invoice before writing any of it down. Rejected — four
sources agreeing is enough to plan against, and an unrecorded finding is one that gets rediscovered
from scratch in three months.

---

## 2026-08-05 — GitHub Pages is retired, the repository is renamed `website`, and the static export is gone

**Do not reverse without reading this.**

Three things happened in one sitting on 5 August 2026, and they are recorded together because
they are one decision, not three. GitHub Pages is unpublished and its deploy workflow deleted.
The repository is renamed from `luke-14-ministries.github.io` to **`website`**. And
`output: 'export'`, `basePath` and `images: { unoptimized: true }` are removed from
`next.config.mjs`.

**Why they are one decision.** Publishing to GitHub Pages requires compiling the site to flat
HTML — a static export — and a static export has no server behind it, so it cannot query a
database, run an API route, or talk to Stripe. That single setting blocked every item in
Phase 1. It also could not be removed in isolation: take it out and the Pages workflow starts
failing on every push. The coupling is the whole point. Doing Pages-off first and the config
later would have left a window where the project had two broken halves; doing both together
means the coupling simply stops existing.

**The order was deliberate and should be understood before anyone repeats it.** Confirm Vercel
renders. Unpublish Pages. Delete the workflow — skip this and a workflow keeps running and
failing; skip the unpublish and a frozen copy of the site lives at the `github.io` address
indefinitely. Delete the leftover `github-pages` environment. **Rename last**, because
`<org>.github.io` is a Pages *instruction* rather than a label: renaming while Pages was still
live would have stopped the site abruptly instead of gracefully. Only then the config commit.

**What was checked rather than assumed.** The three usual hazards of removing an export config
were all verified absent in the code first: nothing uses `next/image`, so the image-optimiser
setting was inert; nothing calls `generateStaticParams` or any other export-specific API; and
the `asset()` helper reads `NEXT_PUBLIC_BASE_PATH` at runtime rather than depending on the
config's `basePath`, so removing `basePath` could not break it. An earlier draft of this plan
recommended deferring the config change on general caution. That recommendation did not survive
checking the actual code, and was reversed.

**`trailingSlash: true` stays.** It is a URL preference, not a hosting accommodation. Removing
it would turn `/about/` into `/about` across every link in the site.

**No DNS was touched.** The Pages settings screen showed an empty Custom domain field, which is
what made it certain that unpublishing could not affect `luke14ministries.net`. That domain
still serves the existing Squarespace site, and pointing it remains a Phase 4 board decision.

*Alternative considered:* Pages-off and rename now, config change later in the sprint. Rejected
once the code was actually inspected — the risks it guarded against were not present, and the
only reason the Pages retirement was urgent at all was the coupling to the export setting.

---

## 2026-08-05 — `asset()` in `lib/site.js` is left in place as known dead weight

`lib/site.js` exports `asset(p)`, which prefixes a path with `NEXT_PUBLIC_BASE_PATH`. That
variable is unset on Vercel and must stay unset, so the helper now returns every path unchanged.
It is, functionally, a no-op.

It is used in 16 files that otherwise did not need touching on 5 August. Removing it would mean
16 edits across pages nobody was working on, for zero functional gain, with a real chance of a
typo in a file that is currently correct.

So it stays, and this entry exists so that the next person who finds it knows it is deliberate
rather than overlooked. It is fair to remove during unrelated work in those files. It is not
worth a commit of its own.

*Alternative considered:* removing it in the same pass as the config change. Rejected — a
cleanup commit that touches 16 files is exactly the kind of change that hides a real mistake in
a wall of diff.

---

## 2026-08-05 — Stripe keeps registration on approval timing, not on rate

**Do not reverse without reading this.** The processor question was put again — should the ministry
drop Square, and even Stripe, for PayPal? — and answered against PayPal's published fee schedule
(last updated 15 July 2026), its User Agreement, its Confirmed Charity terms and its developer
documentation. The outcome is unchanged; the reason is sharper.

**On rate, Stripe does not win.** On cards the two are a tie ($9.00 against $8.96 on a $300
registration), and if PayPal grants its charity rate — **2.19% + 29¢** on embedded card fields, not
the widely-quoted 1.99% + 49¢ wallet rate — PayPal is cheaper by about $2.14, worth roughly
**$300–600 a season**. Ask in writing; it remains unconfirmed.

**Stripe wins on being able to go live on a date we choose.** PayPal will not process a live card
through Expanded Checkout — the embedded product carrying the good rates — until its underwriting
approves the account. Until then live mode returns `NOT_ENABLED_FOR_CARD_PROCESSING` while
**sandbox works fine**, so the whole flow can be built, tested and demonstrated and still be unable
to take a real card, and **no timeline is published**. Four separate approvals would be needed in
total: Expanded Checkout, ACH Services, POS and the charity rate. Stripe needs none. Against a fixed
registration-opening date and a maintainer whose availability collapses in September, an unbounded
approval queue on the critical path is the wrong risk.

**PayPal cannot put a cheap bank payment in a checkout.** Its ACH Services at 0.80% capped $5 is
rate-identical to Stripe but sits behind its own approval and **does not appear in PayPal's Checkout
SDK at all**; Pay by Bank at 1% capped $10 is **invoicing only**; and a family funding an ordinary
PayPal payment from their bank is charged the ordinary card rate under the fee schedule's E-check
section, saving the ministry nothing. Braintree offers 0.75% but is excluded from its own drop-in UI
and gated behind sales. Stripe's 0.8%/$5 sits in the same checkout as the cards.

**Stripe's bank payment carries caveats that must be designed around**, and the plan previously
understated them: it is a *delayed notification* method confirming in **up to four business days**
(two for eligible accounts), first-time payers verify by bank login or by microdeposits with a
**ten-day** window to complete, and **new accounts carry weekly volume limits** that Stripe does not
publish. A registration season is exactly the volume burst those limits exist to catch. Action:
open the Stripe account early, season it with test volume, and request a limit increase before
registration opens.

**The webhook cannot be rehearsed on PayPal.** Its simulator events cannot be verified through the
production signature path, and the code that marks a registration paid is the riskiest in the
system.

*Checked and closed:* using PayPal *inside* Stripe's Payment Element is not available to US
merchants (eligibility is the EU except Hungary, Liechtenstein, Norway, the UK and Switzerland).
Worth re-checking before Phase 2; nothing should be planned on it.

*On fund holds:* **both** vendors name prepaid goods with long delivery windows and volume spikes as
reserve triggers. Stripe is not immune. The mitigation is the same either way — the ministry's own
database, not the processor, is the authoritative record of who has paid.

**What would reverse this:** PayPal confirming charity pricing on registration *in writing* **and**
granting Expanded Checkout approval, both before mid-September; or Stripe declining or restricting
the account. Even a favourable answer in November is an off-season migration for the following year
— a rate saving that arrives after registration has run is worth nothing.

Reasoning in full: Implementation Plan §3b.

---

## 2026-08-05 — Square is displaced on price by PayPal POS, and nothing is being done about it yet

Recorded so that the next person does not have to rediscover it, and so that "Square keeps
in-person" above is not read as a finding that Square is the cheapest option.

PayPal's own point-of-sale product is **2.29% + $0.09** card-present, with a **$29** first reader
(additional readers $79) and **no monthly or setup fee**. Square is **2.6% + 15¢**. On a $40 sale
that is $1.01 against $1.19. PayPal wins, plainly.

**No change is being made.** On perhaps $5,000 of in-person volume across a hundred sales the
difference is about **$21 a year**, against the cost of a new account, new hardware, a fourth
statement for the treasurer to reconcile, and an August afternoon that is needed elsewhere. The
correct time to act on this is when a Square reader needs replacing, or if in-person volume grows
enough to matter.

*Alternative considered:* switching now while the comparison is fresh. Rejected on the arithmetic
above — $21 does not buy a distraction during the one month the maintainer is actually available.

---

## 2026-08-05 — Zeffy is not the registration platform, and a dated fallback trigger is set

Zeffy charges nonprofits nothing — no monthly fee, no percentage — and it is not a trick. The
ministry would hold **its own Stripe Connected Account** underneath, staying merchant of record and
keeping its payment history if it left. It was taken seriously because it is the only option raised
that could make this project unnecessary.

**It is rejected for registration on four grounds, in order of weight.**

*The cost moves onto families rather than disappearing.* Zeffy lives on a **pre-selected** tip added
on top — roughly 17–22% on small amounts, 11–15% on large — prompted **twice** in the flow, with a
documented case of a $400 registration defaulting to add over $40. On roughly $45,000 of season
volume that is about **$1,100 a year** asked of families who are not asked for it today. Zeffy's own
users requested a $0 default; the request drew **224 votes** and was **closed 11 March 2026 without
being granted**, so it is deliberate design rather than a backlog item.

*There is a documented accessibility failure on the opt-out control.* Users report **screen readers
did not work with the dropdown used to reduce or remove the tip.** For a disability ministry, a
payment page whose assistive-technology failure lands exactly on the control for declining an
optional charge is close to disqualifying on its own.

*It cannot do the job.* No instalments, no waivers or e-signature, no file upload, no waitlist, and
a **read-only API** — so no front end can be built on it. The ministry would be sending families to
Zeffy's forms instead of its own site, which is the thing this project exists to stop doing. Camps
using Zeffy in the wild take **deposits** on it and handle the rest elsewhere.

*Vendor durability.* About $4.5M raised, last verified round November 2021, on thin margins. Not a
prediction of failure — a reason not to make it the only registration system.

**The arithmetic, stated honestly**, on roughly $45,000 of season volume: Campsite costs the
ministry about $5,700/yr (if the $249/month fee is real) and families nothing; Zeffy costs the
ministry $0 and families about $1,100/yr; the platform being built costs the ministry about
$1,600/yr all-in and families nothing. **Zeffy therefore undercuts about $1,600 a year of the
financial case for building — not the case itself.**

**Two things follow.** Zeffy for the *donation* page is a reasonable thing to look at separately and
on its own timetable, since a gift page has none of the four problems above except the tip, and on a
gift an optional tip is an ordinary ask. And a fallback is set now rather than in a panic: **if by
1 February 2027 the registration platform is not taking test payments end to end, Zeffy becomes the
season's fallback for taking deposits** while the build continues.

Reasoning in full: Implementation Plan §3b.

---

## 2026-08-06 — Migrations are plain SQL files in the repository, pasted into the SQL Editor

`supabase/migrations/` holds numbered `.sql` files. They are run by opening the Supabase dashboard,
going to SQL Editor, and pasting the file in. Nothing is installed, nothing is generated, and there
is no state held anywhere except the files themselves and the database.

The Supabase CLI is the tool that would normally do this. It was rejected because it adds Docker, a
linked project reference, a login token, and a shadow database — four things that can be in a wrong
state, on a machine that may not be the same machine next August. The paste-in workflow has one
failure mode, and it is visible: the query either ran or it did not.

**The rule that makes this work: a migration is never edited after it has been run.** The file
records what was done to the database, not what we wish it looked like. A change is always a new
numbered file. Break this and the repository stops describing the real database, which is the only
thing it is for.

---

## 2026-08-06 — Phase 1 schema: what is stored, and what is deliberately not

`0001_core_schema.sql` creates sixteen tables. The decisions inside it that are not obvious from
reading it:

**Whether a family has paid is never stored on the registration.** `registrations.status` is
lifecycle only — draft, submitted, waitlisted, confirmed, cancelled. Money is answered by the
`payments` table through the `registration_balances` view, and by nothing else. Two places that both
claim to know whether a fee arrived is how a family gets chased for money they already sent, and it
is the single most common way a registration system loses a family's trust.

**Bank payments are slow, and the schema says so.** `payments.status` includes `processing`, and the
table carries `expected_settlement_on`. Stripe's ACH debit is a delayed-notification method — up to
four business days before success or failure is known. A registration sitting in `processing` is
normal, not a problem to chase. Had this been discovered after launch it would have been a schema
change during registration week.

**Support needs live in their own table, not on the person.** `person_support` is separate from
`people` so it can carry a stricter policy than the row it describes. The fields are free text on
purpose; structure gets added only if the Campsite inventory shows staff genuinely sorting on one.

**Staff notes live in their own table.** Row-level security controls which *rows* are visible, not
which *columns*. A `staff_notes` column on the registration was written first, and the test harness
caught families reading it — a table-level `grant select` covers every column and a column-level
`revoke` does not take it back. `registration_notes` cannot be got wrong by forgetting, and it
carries authorship and history as a side benefit.

**Agreements are versioned and signatures cannot be edited.** "She signed the waiver" is worth
nothing if nobody can say which waiver. `agreement_signatures` has insert policies and no update or
delete policy at all.

**Background checks stay a flag and a date.** `volunteer_clearances` holds
`background_check_on_file`, `background_check_date` and an expiry. No documents, no findings, no
vendor reference numbers. If a column is ever proposed here that would hold the *content* of a
check, the answer is no.

**Age is not stored.** `date_of_birth` is, and age is derived against the session start date. A
stored age is wrong within a year and nobody notices.

Text columns with `CHECK` constraints are used instead of Postgres `ENUM` types throughout: altering
an enum is a migration with transaction restrictions attached, changing a `CHECK` is one plain
statement a volunteer can write. Money is integer cents everywhere, never a float.

---

## 2026-08-06 — Row-level security is proved by a test harness, not by a clean migration

`supabase/migrations/rls_test.sql` seeds four personas — two parents in different households, a
registrar, and a stranger belonging to no household — and asserts forty-two times that each sees
exactly what they should. It runs against a throwaway local Postgres, never the real project.

It exists because a migration that runs without error proves the SQL parsed, and nothing else. Both
of the ways row-level security fails silently — a table with RLS switched off, and a table with RLS
on but no policy at all, which denies everyone including staff — look identical to a successful
migration. The schema file ends with a self-check that raises on either. The harness covers the
harder question of whether the policies that *do* exist are the right ones.

On its first run it found a real hole. That is the argument for keeping it.

---

## 2026-08-06 — Match Campsite's information architecture, not its interface

The existing Campsite portal is being walked and written down before more of the registration flow
is built, using `Luke14-Portal-Inventory.xlsx` (SharePoint, `02 Accounts and Setup`).

**What is being copied:** what a family is asked, in what order, which answers are required, what
the dropdown choices are, what states a registration can be in, which emails fire and when, and what
staff see on the other side. This is where an omission costs a season — a field nobody remembered is
a field a hundred families have to be emailed about in July.

**What is not being copied:** the interface. Campsite's is a PHP-era design and accessibility is the
one dimension where a disability ministry should beat the incumbent rather than tie it.

*Constraint on the exercise:* the workbook records structure only — labels, choices, screen order.
No camper names, no medical details, no addresses, no payment records, and none of that into a chat
transcript either. The portal holds real family data; the inventory must not.

---

## 2026-08-06 — Authentication is Supabase Auth, with the session refreshed in middleware

Families and volunteers log in with an email address and a password, held by Supabase Auth. No
password ever reaches this codebase; nothing about a login is stored in our own tables except the
profile row that a database trigger creates.

Three Supabase clients exist, and using the wrong one is the mistake this note is here to prevent:

- `lib/supabase/client.js` — for components with `'use client'`. Runs in the browser.
- `lib/supabase/server.js` — for pages without `'use client'`, route handlers, and server actions.
  Built fresh per request from that request's cookies, because one shared client would leak one
  visitor's session into another's page.
- `lib/supabase/middleware.js` — used only by `middleware.js` at the repository root.

**Server code asks `getUser()`, never `getSession()`.** `getSession()` reads the cookie and believes
it. `getUser()` asks Supabase to verify the token. On the server, where the answer decides what data
someone sees, only the verified one is worth having.

**`middleware.js` is not optional and must stay at the repository root.** A Supabase access token
expires after an hour, and nothing in the browser can refresh a cookie for a server-rendered page
that is already being requested. The refresh happens in middleware, before any page runs. Delete it
and the site works for about an hour, then people begin getting logged out mid-form, with no error
and no pattern anyone can reproduce. Next.js finds this file by location, not by import: move it
into `app/` or `lib/` and it silently stops running.

**Middleware redirects, row-level security protects.** The redirect on `/account/dashboard` is a
courtesy so anonymous visitors see a login screen instead of an empty page. It is not the security
boundary — the policies in `0001_core_schema.sql` are. If middleware were deleted tomorrow, nobody
could read another family's data.

**Log out is a POST, not a link.** A GET that logs you out can be fired by anything that makes a
browser fetch a URL — an image tag in an email, a link on another site. That is how people end up
mysteriously logged out halfway through a registration.

**Wrong-password and unknown-email give the same message.** Supabase tells the difference; the form
deliberately does not repeat it. Otherwise the login page becomes a way of finding out which
families have accounts here. The forgot-password form ignores its result for the same reason.

**Email confirmation stays on.** It is what stops someone registering a family under an address they
do not own. The consequence is that `signUp()` returns no session, so nothing can be written to the
database on the signing-up person's behalf until they click the link — which is why the profile row
is created by a trigger running as the database owner rather than by the app.

**Emailed links all land on `/auth/callback/`**, which handles both link shapes Supabase can send
(`?code=` and `?token_hash=&type=`) so that editing an email template later cannot silently break
confirmation for every new family. It only ever redirects to a path on this site; taking a full URL
from the query string is the open-redirect bug.

The alternative considered was server actions rather than browser-side calls in the form components.
Browser-side won because it leaves the existing form files the same shape — a volunteer reading the
diff sees the same file with the fake submit replaced by a real one — and because inline error
messages need no extra plumbing.

---

## 2026-08-06 — `handle_new_user()` also copies the phone number

`0001_core_schema.sql` was amended before it had been run anywhere, which is the only time a
migration may be edited. The trigger now writes `phone` into `public.profiles` alongside the two
names.

It matters because there is no other moment to do it. With email confirmation on there is no session
immediately after `signUp()`, so a follow-up write from the app would be refused by row-level
security — correctly. The three metadata keys `first_name`, `last_name` and `phone` are set in
`app/account/signup/SignupForm.jsx` and read in the trigger; rename one on either side and nothing
errors, the profile simply comes out blank.

---

## 2026-08-07 — Automated email goes through Resend, from the ministry's own domain

Every message the system sends — email confirmation, password reset, registration received, balance
due, forms outstanding — is sent by Resend from `registration@luke14ministries.net`.

Free to 3,000 messages a month on one verified domain, with a 100-a-day cap; $20/month lifts both,
which we will want the first time anyone emails every family at once.

Postmark was the alternative and is the better-known name, but its free plan is 100 messages a
month — an evaluation sandbox, not a usable tier. Resend gives the ministry a functional free tier
at our volume and is built for the same Next.js ecosystem this site is written in, which is one
less unfamiliar thing for a future volunteer. Switching later is an API key and a template port.

This is not optional infrastructure. Supabase's built-in sender is explicitly for development, so
sign-up confirmation and password-reset messages need a real sender before launch regardless of
whether a single reminder is ever sent.

Setup means SPF, DKIM and DMARC records at the registrar. Those are TXT records; they do **not**
move where `luke14ministries.net` points, so this can be done before Phase 4 without touching the
Squarespace site. It does need coordinating with whoever administers the Microsoft 365 mail — a
careless SPF edit breaks the ministry's existing email.

Every message sent is logged: recipient, template, timestamp, and what it referred to. "We told you
on the first" needs to be answerable from a record.

---

## 2026-08-07 — Payment plans are billed as statements, not pre-authorised charges

Installments are emailed as a statement with a button to pay that exact amount. The ministry does
not store a card and draw on it.

The reason is the blast radius of a mistake. When the ministry can initiate a charge, every bug,
mis-set date and duplicated row is capable of taking money out of a family's account with nobody
present — which has already happened once under CampSite, where an unauthorised draft bounced and
cost more to unpick than the payment was worth. A wrong number in a statement email is embarrassing
and fixable by apologising. A wrong number in an automatic draft is somebody's rent.

It is also less work, which is the rare case where the safer option is the cheaper one. Automatic
collection is four features, not one: storing a card under a compliant agreement, charging it
off-session, handling the substantial share that fail on expired cards or bank authentication, and
chasing the family back online. That last part is most of the effort.

It can be layered on later without rework, because the schedule and the amounts are already
calculated. It should be a deliberate decision with real numbers in hand, not a Phase 2 default.

---

## 2026-08-07 — Pricing arithmetic lives in our database; Stripe is handed a settled figure

Fees, early-bird rates, coupon codes, scholarships and discounts are calculated in Postgres. Stripe
collects one number.

Stripe can do this work — its promotion codes support single-use and multi-use redemption limits,
expiry dates, minimum amounts and codes tied to one customer — so this is a decision, not an
oversight.

Two reasons against using it. Cost: Stripe adds 0.4% per invoice for its invoicing product and 0.7%
of volume for subscription billing, and this project exists to get fees down from 6%. And the
books: what a family owes must be answerable from one place. Two pricing engines eventually
disagree, and that is the day the treasurer cannot reconcile the year.

---

## 2026-08-18 — Stripe's nonprofit rate was applied for anyway, and granted

**Supersedes 2026-08-04, "Stripe's nonprofit rate does not apply to camp registration."** That
entry carried "Do not reverse without reading this." It was read, and reversed on evidence.

The application was submitted and **Stripe granted the discounted nonprofit rate on 18 August
2026**. The planning number for registration is no longer 2.9% + 30c.

**Be fair to the original entry, because most of it was right.** Its reading of the published
policy was accurate: the rate is written for donations, the 80%-of-volume test is real, and Stripe
does name registration fees and tuition as non-qualifying. Anyone reasoning from the documentation
alone would have reached the same conclusion, and the entry was written to stop the same dead end
being rediscovered. That was a sensible thing to want.

**What it got wrong was the step from "the policy says no" to "do not ask."** The account is the
ministry's whole payment relationship, not the camp line item alone, and eligibility was assessed
against a registered 501(c)(3) as a whole rather than against a single product. The published test
turned out to be the starting point of a review, not a gate applied mechanically. The cost of
asking was one form and some waiting; the entry priced that as wasted effort, and it was not.

*The general lesson, which is worth more than the rate:* a published eligibility rule is evidence
about the likely answer, not the answer. Where the downside is a form and the upside is a
permanent rate reduction on every transaction the ministry will ever take, ask. Record the
refusal if it comes.

*Housekeeping:* anywhere the plan quotes 2.9% + 30c as the registration rate now understates the
project's case rather than overstating it, which is the safe direction to be stale in. Correct it
when touching those documents; do not go hunting.

---

## 2026-08-24 — The ministry can give money back, and a refund is its own record

Migrations `0038` and `0044`. The board's position, relayed 24 August: the site must be able to
return money, not only credit it against a future balance. Until then "we'll put it toward next
year" was the only answer available to a family whose circumstances had changed.

**A refund is a row in `payment_refunds`, not a negative `payments` row.** The negative-row trick
makes the balance arithmetic fall out for free and is wrong three times over: `amount_cents` is
CHECKed greater than zero (settled in `0001`); "money arrived" and "money left" would become
indistinguishable in every list, export and receipt; and a refund has facts of its own — which
payment it reverses, who authorised it, Stripe's refund id — with nowhere to live on a payment row.

**Partial refunds are the normal case**, not the exception — one child of three withdraws, or a
deposit is forfeited and the balance returned. So many refunds may point at one payment, and
`0044` adds the database trigger that stops their total exceeding it. The server action checks
this in JavaScript too; that check is a courtesy, not a boundary, because two registrars on two
screens or one impatient double-click both defeat it. Without the trigger a slipped decimal could
refund $500 against a $50 payment and invent a credit the ministry never received, on a screen
families read as authoritative. Headroom counts the payment plus its `fee_cover_cents` — that
money did arrive — and excludes `failed` and `canceled` refunds, because a refund that did not
happen must not consume the room for one that should.

**Fee cover is refunded deliberately or not at all.** Stripe does not return its cut, so refunding
the ~3% a family added costs the ministry real money. Staff can still choose to, because "you
can't have your $2 back" is a bad conversation — but it stays a separate, visible number rather
than something that happens silently.

---

## 2026-08-24 — An external waiver is acknowledged, never signed

Migration `0039`. Horseback stables and rafting outfitters run their own paperwork on their own
websites. The ministry cannot sign for a family, and this site cannot know whether they did.

So the column records the only thing we can honestly assert: that we told them, and when they said
they understood. It is called `waiver_acknowledged_at`.

**The naming is the decision.** A column called `waiver_signed_at` would eventually be read as
proof, in the one conversation where proof matters — after someone is hurt. The database must not
be able to claim something the ministry never obtained.

---

## 2026-08-24 — Capacity counts come from a counts-only function, not from readable rows

Migration `0040`. A family may only select their own `activity_signups`, which is right — who else
is going riding is nobody's business. That makes "4 places left" unanswerable from the client,
because counting requires reading rows the caller cannot see.

A `SECURITY DEFINER` function is the narrow, deliberate exception. It returns **counts only** —
never a name, never a row — which is exactly the amount of other people's data a capacity number
has to reveal. Widening it later to return anything row-shaped is a different decision and should
be recorded as one.

---

## 2026-08-24 — Horseback is volunteer-run, and its provider is null on purpose

Migration `0041`. The `0039` seed guessed "Local stable partner". Lawrence corrected it on 24
August: the horses have historically come from volunteers and friends of the camp, and whether any
waiver applies is unknown.

**Null is not missing data here; it is the honest value.** `provider_name` is what makes the family
screen say the provider's own form has to be completed and demand an acknowledgement tick. A
guessed provider would have the site instructing families to go and complete paperwork that may
not exist — asserting a fact nobody has established.

*Open question for staff:* does volunteer-run horseback need a waiver of its own, and if so is it
the ministry's or the owner's? It is on the Staff Questions log and stays there until answered.

---

## 2026-08-24 — Lodging is one self-referencing table, and `accessible` is first-class

Migrations `0042` (the table and assignments) and `0043` (placeholder cabins). The one part of the
system `0001` did not model, so the shape is a decision rather than a discovery.

**Why lodgings nest via `parent_id`.** Lawrence, 24 August: "in some cases, especially for
volunteers, room assignments are just cabin assignments." Both are true at once — a volunteer goes
in Cabin 3 and that is the whole answer, while a family goes in a particular room inside the
lodge. Two tables, `cabins` and `rooms`, would force every query to ask which kind it is dealing
with and force staff to pick the right screen before doing the obvious thing. One self-referencing
table lets a cabin *be* somewhere you assign a person and also *contain* somewhere you assign a
person. Occupancy of a cabin is then its own assignments plus its children's, which is how a camp
director counts beds.

**`accessible` is not a nicety.** This is a camp for people affected by disability. A bed
assignment that ignores wheelchair access is a failure, not an inconvenience, so the flag is
first-class and the assignment screen warns when someone with mobility notes lands somewhere not
marked accessible. `0043`'s seed marks accessibility honestly rather than optimistically — an
unmarked cabin reads as "not known to be accessible", which is the safe direction to be wrong in.

*The seeded names and capacities are invented and meant to be corrected by staff.* What matters is
that the shape is right.

---

## 2026-08-25 — A family asks to cancel; staff decide and act

Migration `0045`. Cancelling had been blocked on the board's refund rule. It is not blocked, once
the two are separated: **a family can ask to cancel with no refund policy in existence.** Staff
receive the request and settle the money by whatever policy applies. That unblocks the thing
families actually need — a way to say "we can't come" — without the site inventing a rule nobody
has made.

It is also the safer shape. Cancelling releases a place and may forfeit money. That is not an
action to hand a family behind a confirm dialog at eleven at night; a request is reversible right
up until staff act on it.

**`participant_ids` empty means the whole registration.** Families cancel one child far more often
than the whole family, and a request that cannot say "just Sarah" would be answered by a phone
call instead — which is the thing this exists to avoid.

---

## 2026-08-25 — A change to who someone is gets logged, staff included

Migration `0046`. `log_family_change` exists to show staff what *families* changed, so it skips
edits made by staff themselves. Sensible for its purpose, and wrong for one narrow case.

First name, last name and date of birth are not ordinary fields. Rosters, check-in lists and
signed agreements all carry the name, and `submit_family_registration` **matches returning people
by name and date of birth** — so changing either silently detaches someone from their own history
and produces a duplicate at the next registration.

Families are now blocked from editing these while a live registration exists, and told to ask
staff. That advice pointed straight at the one path with neither a guard nor a record: staff could
do the same thing more easily and nothing anywhere would show it had happened. The trigger closes
the record half; an explicit confirmation on the staff screen closes the other.

**Everything else keeps the old behaviour.** Staff edits stay out of the log, because Recent
Changes is a review queue for family activity, not an audit of the ministry's own staff.

---

## 2026-08-25 — Camp weeks move to 2027, and the dates are NOT confirmed with the venue

Migration `0047`. **Do not reverse without reading this.**

The two Camp Celebrate weeks were seeded at July 2026. That season has happened, so every family
dashboard showed both weeks greyed as "past" while the Adult Adventure Retreat sat above them as
the only upcoming thing. The sort was right; the data was stale. The season the platform is
actually being built for is 2027.

    Adult Adventure Retreat 2026   29 Oct 2026        (genuinely next, unchanged)
    Camp Celebrate 2027 - Week 1   19-23 Jul 2027
    Camp Celebrate 2027 - Week 2   26-30 Jul 2027

Week 2 has always immediately followed Week 1, Monday to Friday then the next Monday to Friday,
and 2027 lines up on the same weekdays — so this is a straight shift of the same shape by 364
days, not a new pattern.

**These dates are a mechanical shift, not a confirmed booking.** Carson Springs has to give the
ministry its 2027 weeks before any of this goes public. If they come back different, change them
here or in Setup; nothing downstream hardcodes them. Publishing an unconfirmed camp date is how
families book flights around a week that does not exist.

---

## 2026-08-25 — The family's own words and the registrar's note are different columns

Migration `0048`. `scholarships.family_statement` is the family's own account of why the fee is
hard — the single most useful thing on the record when somebody in the office picks up the phone.

`setAdjustments` had been overwriting it. The staff "Note (kept with the scholarship record)"
field wrote straight into `family_statement`, so the moment a registrar granted an award the
family's explanation was replaced by "Board-approved hardship scholarship" and was gone. Nothing
warned anybody, because the note that replaced it looked like a note.

One column fixes it. These are two different claims by two different people and should never have
shared a home: `family_statement` is what the family told us, never edited by staff; `staff_note`
is what staff decided and why.

**No backfill is possible.** The overwritten statements are not recoverable and none is attempted.

---

## 2026-08-25 — A signature typed on this site must name the household contact

Migration `0049`. Testing found a registration for two people — an adult and a seven-year-old —
whose six signed agreements all read "Alberto Gonzales", a name belonging to nobody in the
household. A release has to name the person accountable for it.

The form and the server action both refuse that now, and **neither is a boundary.**
`submit_family_registration` is `SECURITY INVOKER` (correct — RLS applies to everything it writes)
with EXECUTE granted to `authenticated`, so any signed-in person can post to it directly with a
payload of their choosing, and a rule living only in JavaScript would not be there. The same is
true of the scholarship agreement. The trigger is where the rule actually lives.

**It applies to `signed_here` and to nothing else.** `self_reported`, `paper_on_file` and
`confirmed_external` are staff recording a signature that happened elsewhere — a form brought to
camp, a release posted in. Who may sign one of those is a policy question for the board, it is on
the staff questions list, and until they answer it staff judgment governs. A database trigger must
not pre-empt that answer. It also fires only where there is something to check against: a
household with no primary contact recorded yet cannot contradict anybody.

---

## 2026-08-25 — The seeded activities are replaced with what camp actually does

Migration `0050`. The eleven seeded activities were placeholders written from the schema rather
than from camp. Five corrections, each from a line of the testing notes: horseback is **not**
capacity limited (a cap camp does not have is worse than no cap — it turns families away from
something that had room); swimming and arts and crafts need no sign-up and now say so; white water
rafting runs on the Wednesday of camp and was missing from both camp weeks; pontoon runs on the
Tuesday and needs a boarding time, which is a build and not a data change; zip line and hiking come
off the retreat, set **inactive rather than deleted** so nothing about who already asked for them
is destroyed.

**The tone rule is part of the decision.** Camp exists to make it possible for everyone to do
everything — wheelchair users go down the river and up the climbing wall. Activity copy reads as
an invitation and a practical note, never as a list of conditions.

---

## 2026-08-25 — A narrow set of safety fields is logged whoever changes it

Migration `0051`. Testing, 25 August: a staff account edited a camper's description of her
seizures, it changed in staff view, and nothing appeared in the review queue.

The change log was working as written — `log_family_change()` skips staff edits on every table
except `people`. That is a correct diagnosis and the wrong rule for this field. `0046` already
carved out identity fields for the same reason: some changes matter regardless of who makes them,
because the question the record answers is not "who is editing without permission" but **"does
anyone know this changed"**. A seizure description is the clearest case in the schema — the camp
nurse's list, the buddy's briefing and the medication plan are all built from it, and a staff
member correcting it at eleven at night is exactly the circumstance in which nobody else finds out.

**The set is deliberately narrow:** seizures, rescue medication, allergies, medications. Everything
else on `person_support` keeps the staff skip. A registrar tidying a dietary note should not fill
the review queue, and a queue that fills with housekeeping is a queue nobody reads.

---

## 2026-08-25 — Activity time slots are wall-clock, not `timestamptz`

Migration `0052`. The pontoon goes out four times on the Tuesday and the salon takes one person at
a time, so "who is on the 2 o'clock boat" is the question the day is run from. `activity_slots` has
existed since `0001`, unused and holding zero rows, which meant it could be shaped properly rather
than worked around.

**"Tuesday at 2pm" at camp means 2pm at camp.** It does not shift because the coordinator setting
it up is sitting in Mountain time, and it does not shift if the clocks change between now and July.
`timestamptz` is an instant on the world's timeline — the right type for a payment, the wrong one
for this. Storing an instant forces every read and write through a timezone conversion, and the
failure mode is silent: a boarding time an hour out, discovered at the dock.

So the columns are a date and two times, meaning exactly what they say at the place the activity
happens. Nothing converts, so nothing can convert wrongly. The old `timestamptz` columns are kept
but made optional — unused and unpopulated, they cost nothing to leave, and dropping a column
other code might reach for costs a migration.

---

## 2026-08-26 — A pending refund is not money the family has back

Migration `0053`. `registration_balances` subtracted **pending** refunds from `paid_cents` — money
that had not left the ministry was being counted as already returned. Found in testing on a real
registration: $960 in fees, a $240 scholarship, $960 received across two payments, and $470 of
refunds both still pending. The page said "Paid $490 - Balance $230" and offered a "Pay $230.00"
button. The ministry was holding all $960 of the family's money and asking for $230 more, at a
moment when the family was $240 **in credit**.

The end state was right — once both refunds land, $490 net against $720 owed really is a $230
balance. **The error is one of timing, and timing is the whole point of a balance: it is what is
true now.** So `paid_cents` counts only refunds that have succeeded, and refunds in flight get
their own column, so a screen can say "a $470 refund is on its way" without that sentence silently
moving what somebody owes.

**Not changed:** `payment_refundable` from `0044` still counts pending refunds against what is left
to refund, and must. That view answers "how much of this payment could I still send back", and
money already in flight is not available to send twice. The two views count differently because
they answer different questions — which is worth remembering before anyone "fixes" the
inconsistency.

---

## 2026-08-26 — The payer is snapshotted on the payment, and service_role gets an explicit GRANT

Migration `0054`. Two findings from one afternoon's testing, both about a payment record that
cannot answer a question asked later.

**The refund webhook was being refused at the table.** A $10 refund issued in the Stripe dashboard
never appeared on the site. Stripe delivered the event, the function returned 200, and nothing was
written: `permission denied for table payment_refunds`. `service_role` bypasses RLS; it does
**not** bypass table GRANTs, and `payment_refunds` had none — only `payments` and `gifts` were ever
granted, back in `0006` when the payment webhook was built. Every other table is closed to
`service_role`, which is the right default and stays; this grants exactly the one table the refund
webhook touches and exactly the three verbs it uses. No DELETE — a refund record is history.

*The failure mode is the part worth keeping.* The webhook logs the error and returns 200
deliberately, because a non-200 makes Stripe retry the same doomed call for days. So a permission
problem here is **silent from the outside**: Stripe says delivered, the site shows nothing, and the
two disagree with no error anywhere a person would look. For the next edge function, check GRANTs
first, not signatures.

**Payments now carry a payer snapshot.** A family paid $50 and then changed their contact email;
Stripe showed the address used at checkout, the portal showed the new one, and nothing joined them.
`payments` had no payer identity at all — it leaned on registration to household to current contact
details, which is a **live** lookup: it tells you who the family is today, never who handed over
the money in March. The snapshot is written once when the payment is recorded and never updated.
It is deliberately not a foreign key and deliberately not kept in step with the household —
drifting apart is the entire point. If the two differ, both facts are true: this is who paid, that
is who the family is now. Grandparents, churches and friends pay for camp too, so this was never
reliably the household's email even before anybody edited anything.

---

## 2026-08-26 — `search_path` is pinned on the last two functions; the other 60 advisor warnings are left alone

Migration `0055`. Supabase's security advisor flagged two functions with a mutable `search_path` —
`set_updated_at` from `0001` and `agreement_signature_names_contact` from `0049`. Everything else
in the schema already pins it.

**Why this one matters.** A `SECURITY DEFINER` function runs with its owner's rights. Without a
pinned `search_path` it resolves unqualified names using the **caller's** search path, so a caller
able to create a schema can put their own `people` table ahead of ours and have a function running
as the owner read it instead. That is a real escalation shape, and pinning closes it outright.

**Why the other 60 notices are deliberately left.** Postgres grants EXECUTE on every new function
to PUBLIC, so `grant execute ... to authenticated` never removed anon's access, and every
`SECURITY DEFINER` function shows up as anon-callable. Each was checked by hand. Every `admin_*`
function guards itself. The six with no internal role check are `activity_availability` and
`activity_slot_availability` (counts only, built to be callable), `buddies_published` and
`lodging_published` (a boolean about an event), `can_touch_person_photo` (scoped through
`my_household_ids()`, so a logged-out caller gets false), and `rls_auto_enable` (an event trigger,
not reachable as RPC at all).

**Revoking those grants would break RLS.** The `is_*` and `my_*` helpers are called from inside
policy expressions, and a policy expression runs as the querying role — revoke EXECUTE from anon
and the policy **fails** rather than returning false. Tidying it safely means checking every policy
first, and that is not a change to make in the week before go-live to silence a warning. A green
advisor dashboard is not the goal; a correct one is.

---

## 2026-08-26 — Background-check storage was built after all, and the original question is still open

**Supersedes 2026-08-05, "Background checks are an open question, not a requirement."** That entry
decided that Phase 2 would build the volunteer application **without** a background-check field
unless the ministry confirmed it runs checks.

Migration `0029` built `volunteer_clearances` anyway: a table with Checkr integration columns —
`provider`, `checkr_candidate_id`, `checkr_invitation_id`, `checkr_report_id`, `checkr_package`,
`checkr_status`, `adjudication`, `invitation_sent_at`, `report_completed_at`, `last_synced_at` —
alongside the original `background_check_on_file` and `background_check_date`. It is a **placeholder
by its own header**: the columns are real, no API key has been issued, no webhook handler exists
and nothing writes them.

**What the reversal bought.** The design is genuinely better than what it replaces. CampSite's
volunteer form asks for a Social Security number in a plain required text field, which means the
vendor stores it and staff can read it. Checkr's hosted invitation flow means we create a candidate
with an email address and nothing else, Checkr collects the SSN and date of birth on its own form,
and a webhook returns pass or fail. Luke 14 never receives, transmits or stores the number. It
cannot leak from us because we never have it, and staff cannot read it because it is not here. That
promise is written into the table comment as a rule: a future self-hosted flow collecting PII into
this table needs a board decision, not a pull request. The integration carries no separate fee — it
saves no money, it removes a liability.

**What has not changed is the thing the original entry was actually about.** Nobody has recorded
that the ministry confirmed it runs background checks, or intends to. The 2026-08-05 entry traced
the requirement to a single line in the July 2026 decision brief and put it on the open list as
Implementation Plan section 11, question 7. **That question has still not been answered anywhere in
this repository or in SharePoint**, and the absence of an answer is itself the finding: storage now
exists for a compliance process nobody has confirmed the ministry operates.

The original entry's warning was that building storage for a process the ministry does not run
"creates an appearance of compliance that nobody is maintaining." Empty placeholder columns are
exactly that appearance. The reversal is accepted — the shape is right and costs nothing to hold in
reserve — but **the open question is re-raised, not closed**, and it must be answered before
anything writes to this table or before the volunteer application implies to anyone that a check
will happen.

---

## 2026-08-26 — This log lapsed for nineteen days, and migration headers became the record

Between 2026-08-07 and today, nothing was written here. In the same nineteen days the project
shipped the volunteer application, Turnstile on the account forms, refunds end to end, cancellation
requests, lodging, activities, the payer snapshot and eighteen migrations. Every one of those
decisions was argued and written down — in the **header comment of the migration that made it**.

Those headers are good. They are long, they state the alternative, and several of them are better
written than the entries above. That is exactly the problem, and it is worth naming rather than
quietly fixing:

- **A migration header is filed by the change, not by the question.** "Why does a pending refund
  not count as paid?" is answerable only by someone who already knows to open `0053`. This log is
  the index; the headers are not.
- **Headers record decisions that touched the database.** Turnstile, the Vercel plan, the Stripe
  nonprofit application and the state of the contact form left no migration and therefore left no
  record at all until today.
- **A header cannot supersede anything.** The two reversals above — the Stripe rate and the
  background-check field — were decided in an application form and a migration respectively, and
  the entries they overturned sat here unmarked for weeks, one of them still reading "Do not
  reverse without reading this."

The nineteen entries above this one are a backfill, written on 26 August from the migration headers
and from the state of the repository. **A backfill is not the same thing as a contemporaneous
record** — it is written by someone who already knows how the story turned out, which is precisely
the bias this log exists to avoid — so they should be read as reconstruction, and where a date came
from a header's "APPLIED on" line rather than from a commit, that is the best available and not a
certainty.

**Restarting the practice.** The rule from the top of this file has not changed and did not need
changing: one short entry per real choice, written when the choice is made. The migration header
stays where it is — it is the right place for the detail, and it travels with the code — but any
decision worth a header is worth three lines here on the same day, and a decision that touches no
migration is worth them more, not less. `CLAUDE.md` was corrected on the same day and had drifted
in eight separate places over the same nineteen days, which is the second-order cost of a log
nobody is writing to.

---

## 2026-08-29 — Stripe's agent and AI tooling was considered and declined

Stripe's "Agents and AI" page was reviewed. Almost none of it applies: agentic commerce, product
feeds, the Stripe Directory and LLM token billing are built for businesses whose *customers* are
software. Ours are families. Nothing on the page solves a problem we currently have.

Two items are parked rather than dismissed. The **Stripe CLI** (`stripe listen`, `stripe trigger`)
would have shortened the refund-webhook hunt, where the endpoint returned 200 while failing
silently, and it is the right way to prove live-mode webhooks at go-live without moving real money
— a go-live note, not a task for now. The **Stripe MCP server** would need read-only, test-mode
scoping before it went anywhere near this project, and offers nothing the dashboard doesn't.

Revisit only if a concrete need appears. Vendor pages of this kind are written to make a small
operation feel behind; being behind on something you have no use for is not a cost.

---

## 2026-08-29 — Sending as an alias works after all, and the earlier entry was written too soon

On 27 August this project concluded, in writing and in three places, that Exchange rewrites the From
address on a shared mailbox to the mailbox's primary — so choosing `registration@` or `camp@` in the
From dropdown would still arrive as `info@`. The tenant setting meant to allow it
(`SendFromAliasEnabled`) had been turned on that morning and repeated tests showed no change. The
conclusion was recorded as a design constraint: one outbound identity, treat it as the design.

It was wrong. The setting took roughly **two days** to take effect. A test on 29 August arrived as
**Luke 14 Ministries `<registration@luke14ministries.net>`**. Alias sending works; the display name
stays *Luke 14 Ministries* either way, which is what we wanted — one voice, with the address saying
which door a reply should come back through.

Corrected in `lib/site.js`, the Web Admin Handbook §10.1 and the account register.

**The generalisable part, which is why this is an entry and not just an edit.** A tenant change that
has not propagated is indistinguishable from a tenant change that does not work. Two days of
confident testing produced a confident, wrong, *written* conclusion — and a written conclusion is
worse than no conclusion, because the next person inherits it as fact. When a setting is toggled and
the behaviour does not change: wait a day, test again, and only then write down a limitation.

---

## 2026-08-29 — A program leader is not staff, and the view is the whole permission

*Written 30 August, a day after the fact. Flagged as late rather than dated back: the entry above
this one exists because a decision recorded late is recorded by someone who already knows how it
turned out.*

Camp needed the person running archery to know who is in archery. The obvious implementation — a
fourth staff role — was rejected, because every role in `lib/staff.js` is a set of *table*
permissions, and a leader who can select a participant row can select every column on it. "Which
columns" was the entire question.

So a program leader has **no row in `staff`**, no role, and none of the staff permissions. They
hold a grant in `program_leaders` naming one program at one event, and that grant buys exactly one
thing: the right to read `public.program_roster`, a view carrying names, ages, a buddy, and
**flags** for allergies and support needs. None of the narrative columns — disabilities,
medications, behaviour triggers — is in it, and none should be added. The intended failure mode is
that a leader learns to ask the coordinator.

An earlier draft of `0061` added a policy on `registration_participants`. It was removed. There is
deliberately **no** new policy on `registration_participants`, `people` or `person_support`: a
leader gets no direct read of any table, only the view.

Two consequences worth knowing before touching this. A leader reaches `/admin`, which had been a
staff-only area — `app/admin/layout.jsx` now builds their navigation *separately* rather than
filtering `NAV` down, so that adding a page to `NAV` can never accidentally hand it to a leader.
And leaders are held to the same two-factor enrolment rule as staff. That is real friction for a
volunteer at camp, and it was chosen anyway: what is behind the door is a list of disabled
children's first names, and a password alone is not enough of a door in front of that. If it
proves too much, it is one line in the layout — but revisit it deliberately.

---

## 2026-08-30 — `program_roster` is a SECURITY DEFINER view, and the ERROR advisory is accepted

Supabase's security advisor reports exactly one ERROR against this project:
the view `public.program_roster` is defined with the SECURITY DEFINER property. It is accepted, and
this entry is the answer somebody will want at go-live when they open that list and find a red row.

**It has to be SECURITY DEFINER.** A program leader holds no read on
`registration_participants`, `people` or `person_support` — that is the point of `0061`, decided
in the entry above. A view running as the *invoker* would therefore return nothing to the only
people it exists for.

**The safety is the view's own row filter**, not the definer property:

    where public.is_staff() or public.leads_program(rp.program_id, r.event_id)

Staff see every program, a leader sees only the program they lead at the event they lead it at,
and everyone else — including a signed-in family — sees nothing. The grant is `select` only, to
`authenticated` and `service_role`.

**Do not silence it by switching to `security_invoker = true`.** That would satisfy the advisor
and empty every leader's roster, and it would do so with no error — the page would render, with
nothing on it. This is the exact shape of failure this project keeps meeting, so it is written
down here rather than left to be rediscovered.

The advisor also reports 69 warnings: 68 `security_definer_function_executable` (the same category
accepted on 2026-08-26, for the same reason) and `auth_leaked_password_protection`, which is a
Pro-plan feature and arrives with the upgrade already planned for go-live — see `DO-THIS-NEXT.md`,
which asks for the free-plan substitute (a longer minimum password) in the meantime.

**The generalisable part.** An accepted advisory is only accepted if the acceptance is written
down. The 26 August entry covered the warnings that existed *then*; this ERROR arrived three days
later and would have read, to anyone opening the dashboard cold, as an unreviewed security hole in
the newest code in the system. A vendor's warning list is a document other people read without us.

---

## 2026-08-31 — one person, two roles at one camp: the second role is free, not discounted

A parent who is also volunteering is rare and real. The ministry charges such a person **once**.

**The accounting choice, which is invisible from the screen and is why it is written here.** The
second role carries **`fee_cents = 0`** rather than a full fee cancelled by a matching discount.
The parent row holds the real fee; the volunteer row holds nothing.

Everything downstream then keeps working with no change at all: the balance view, the deposit
(which multiplies fee-bearing heads), the statements, the CSV exports, refunds. There is no second
charge anywhere that has to be reconciled against a second credit. **A zero is easier to audit than
two numbers that must always cancel** — and a discount that silently stops matching its fee is
the kind of error nobody notices until a family is invoiced twice.

**No schema change was needed, which is worth recording on its own.** The unique on
`registration_participants` is `(registration_id, person_id, event_option_id)` — `person_id` is
not unique by itself — and `event_options` has always carried a nullable `participant_role`, with
`0001` noting that "the retreat publishes two options, one per role". Two roles for one person was
designed in from the start and never used. Migration `0069` only publishes the second option.

**The trap it created, and closed.** Publishing a second option per event broke an assumption four
places were quietly making: `event_options.find((o) => o.published)` — take whichever comes back
first. That was fragile the day it was written and became a **money bug** the moment two options
existed, because a bad draw returns the zero-fee volunteer option and sets the price shown on the
chooser page and the fee written onto every participant. A family could have been registered at
$0.

All four now call `enrollmentOption()` in `lib/events.js`, which selects on `participant_role is
null` — the field that actually means "this option does not decide the role". The generalisable
part: adding a row to a lookup table is a code change wherever the code assumed there would only
ever be one row.

**Still open:** the both-weeks discount (E11) is a different mechanism and a different decision.
That one is a genuine discount on a second registration, and its amount is not yet known — see
Q7 on the reviewer ledger.

---

## 2026-09-01 — Claude runs on a ministry Team organisation; connectors live at organisation level, Vercel excepted

Anthropic approved nonprofit pricing on Claude Team on 1 September 2026. The organisation is owned by
`lawrence@luke14ministries.net`, with `admin@luke14ministries.net` added the same day as a second
owner that holds no seat — the ministry's master key, as on every other vendor, at no cost. Two
seats: Premium ($40, the build seat) and Standard ($8).
Claude Code on the build machine is signed in as the ministry account from today; the platform had
been built on a personal subscription until now, which was a live breach of the ministry-ownership
rule.

**Every Team seat includes Claude Code.** The tiers differ in usage quota, roughly five to one, not
in features. Two documents said Larry's Standard seat would be "without Code" and were corrected.
He needs it: a second web admin who cannot pull, build and push is not a second web admin.

**Connectors are placed at organisation level wherever the vendor allows it.** Stripe, Supabase,
Resend and Microsoft 365 are claude.ai connectors on the organisation, so every seat sees the same
four, each person authorises with their own vendor login, and access is revoked centrally on
offboarding. A local `claude mcp add` was tried first and worked, but it lives in one person's
`~/.claude.json` on one machine — exactly the shape of single-point failure the rest of this log
argues against. The local copies were removed so that Claude does not carry two of every tool.

**Vercel is the exception, and it is Vercel's constraint, not ours.** Its claude.ai connector does
not reach Claude Code, so it is a local plugin (`vercel@claude-plugins-official`) per machine, and it
only works for someone who holds a Vercel seat. On Hobby that is one person. A second admin can still
build and push without it — deploys are triggered by GitHub — but cannot read runtime logs when
production fails. That is the real reason Vercel Pro may need to move from "at go-live" to "now",
and it is a decision for Lawrence and Larry rather than for this log.

*What was given up:* the local Supabase server carried `read_only=true` and a `project_ref` pin, and
the organisation connector carries neither. Read/write was accepted deliberately; the project pin is
a small loss, since the ministry has one Supabase project.

*Alternative considered:* keep everything local, on the grounds that it worked and was already
scoped tightly. Rejected for the reason above — it made Claude's access to five vendors depend on
one laptop.

*Corrected the same day.* Vercel's organisation connector **does** reach Claude Code — it appeared
once the session was restarted, which the first check did not do. So Vercel is not an exception
after all; it lives on the organisation with the other four, and the local plugin is optional and
duplicative. What has not changed: a connector only works for someone the vendor itself recognises,
and on Vercel Hobby that is one person.

---

## 2026-09-05 — The password vault exists: Bitwarden Families, owned by `admin@`, with personal accounts as Owners

Set up by Larry and Lawrence on 5 September 2026. **Bitwarden Families Premium, $48 a year, paid
through the ministry's PayPal account** — a ministry payment method, so the rule that the vault is
billed to the ministry and not to a person is met. Three of six seats in use: `admin@`, Lawrence,
Larry. The owning Bitwarden account is
`admin@luke14ministries.net`, secured with Larry's authenticator app; its recovery key is printed and
held offline. That account is the root and is not used day to day. Lawrence and Larry are Owners of
the organisation from their **own personal Bitwarden accounts** (`llaplue@outlook.com` and
`laplue@hotmail.com`).

**Why personal accounts rather than new ministry-address logins.** Both already live in Bitwarden
with their own app-based two-factor. A second Bitwarden login per person would be one more master
password, one more authenticator entry and one more recovery code to lose, protecting nothing the
existing login does not. The ministry's ownership is carried by the `admin@` root account and by the
organisation itself, not by which login each human uses to reach it.

**What this commits us to.** Offboarding either admin is one step: remove that account from the
organisation, then rotate anything they could have copied (Handbook §9.1). Each person's own Bitwarden
two-factor is now a gate on the ministry's keys, so it stays app-based — never SMS, never email.
And neither personal account may grant Bitwarden Emergency Access takeover to anyone without the
board knowing, because an Owner's ownership travels with the account (entry of 4 August, as corrected).

**What remains is the filling.** The `admin@` mailbox password, each vendor's `admin@` password and
each TOTP seed that today lives on one phone move into the shared collection one at a time, with the
account register's *In vault?* column ticked as each lands. An encrypted export goes on offline media
at each milestone snapshot — never in OneDrive or SharePoint.

*Alternative considered:* Bitwarden Teams, about $190/year for four seats, for its administrator
account-recovery. Rejected: two Owners plus a printed recovery key cover the same risk at this size,
and $48 is the figure already in the board packet.

---

## 2026-09-08 — Emergency Access: Lawrence and Larry hold takeover on each other's personal Bitwarden accounts

Granted on 8 September 2026, both directions, with Takeover. The 4 August entry (as corrected on
29 August) explains what this does: after the waiting period the contact can set a new master
password on the grantor's account, which carries the grantor's Owner role in the ministry
organisation with it. So this is the vault's succession path, made deliberately, between the two
people who already hold the organisation as Owners — not a quiet technical setting.

**Why it is acceptable.** Both are already Owners, so neither gains ministry access they lack; the
grant matters only when one of them is dead, incapacitated or unreachable, which is the case the
whole vault exists for. The grantor is emailed when a takeover is requested and can reject it
during the waiting period, so it cannot be used against someone who is reachable.

**What it also does, knowingly.** Takeover reaches the grantor's *personal* vault as well — bank
logins and the rest. Both accepted that as a personal matter between them; it is recorded here
because the ministry's keys ride along.

**Conditions.** The waiting period stays at seven days or more. Each person's own Bitwarden
two-factor stays app-based. Each person's own Bitwarden recovery code is on paper and not in any
vault. If either grant is ever revoked or moved to a third person, that is a new entry here and a
note to the board.

**Recorded the same day:** claude.ai and Checkr offer no authenticator option, and Vercel offers
only a passkey beside its emailed code, so for those three the `admin@` mailbox is the second
factor — which makes Larry's own Authenticator registration on `admin@` (done 5 September) the
single most important two-factor on the ministry's books.


---

## 2026-09-16 — Next.js 15 → 16, done for one reason: the last two `npm audit` findings had no other fix

Upgraded on 16 September 2026, from 15.5.25 to 16.3.5, with `eslint-config-next` moved with it
and React from 19.0 to 19.3. A fresh clone that day showed five audit findings. Plain
`npm audit fix` (never `--force`; see `CONTRIBUTING.md` §6) cleared three. The remaining two —
postcss, high, and Next itself, moderate — were the same finding seen twice: Next 15 carries its
*own* copy of postcss 8.4.31 under `node_modules/next/node_modules/`, older than the 8.4.49 this
project installs, and the only release that replaces it is Next 16. No lockfile change could reach
it. The postcss advisories are about source-map path traversal and a `</style>` escaping gap, and
postcss runs here at build time on our own CSS, so the practical risk was low. It was still a
"critical" on the audit report a volunteer would read, and the honest fix was a major version.

**Why it was safe to do now, in September.** The one truly breaking change in 16 — synchronous
`params` and `searchParams` are gone — was already handled: all 35 pages that read them were
awaiting them. Node 24 is above the new floor of 20.9. There is no webpack config, so Turbopack
becoming the default builder changed nothing. No AMP, no runtime config, no PPR, no `next lint`.
The build passed first time.

**What changed in the repository, in full:**

- `middleware.js` is now `proxy.js`, and the export is `proxy`. Next 16 renamed the convention;
  the old name is deprecated. Nothing it does changed. `lib/supabase/middleware.js` **kept its
  name** — it is our helper, not a Next.js convention, and the 6 August entry and a dozen comments
  point at it. Older text that says "the middleware" means `proxy.js`. One real difference: `proxy`
  runs on the Node.js runtime, where middleware ran on Edge. `updateSession` never depended on Edge.
- `eslint.config.mjs` imports `eslint-config-next/core-web-vitals` directly. `eslint-config-next`
  16 ships flat config, so `FlatCompat` and the `@eslint/eslintrc` package it came from are removed.
- `eslint-config-next` 16 pulls in `eslint-plugin-react-hooks` 7, which adds the React Compiler's
  analysis as lint rules and flagged **40 places in 23 files** that had passed lint the day before.
  **Those six rules are set to `warn`, not `error`,** in `eslint.config.mjs`, with the reasoning in
  the comment there. Short version: they are advice worth taking one file at a time with a browser
  open, not a thing to rewrite across the login form and the two-factor page inside a dependency
  bump. The count is visible in every lint run so it is a decision somebody makes, not a warning
  somebody deleted.

*Alternative considered:* stay on 15 and accept the two findings. Rejected because 15 is now the
previous major, the fixes only ever land in 16, and the gap to 16 was small *today* — every month
on 15 makes it wider, and the maintainer's time gets scarcer from here. *Also considered:* fixing
the 40 lint findings in the same change. Rejected for the reason above.

**Do not `npm audit fix --force`.** It is still the thing that downgraded Next by six major versions
once. The same page of `CONTRIBUTING.md` still applies.

---

## 2026-09-16 — The 40 React Hooks 7 warnings are cleared, and the preset's errors apply again

Same day as the Next 16 entry above, in five commits after it. The temporary block in
`eslint.config.mjs` that held six rules at `warn` is deleted; they are errors again, as the preset
ships them, and `npm run lint` reports none.

**What the warnings turned out to be, in order of what they were worth.**

- **One latent bug**, in `app/admin/staff/StaffManager.jsx`. `Table`, `Row` and `SortTh` were
  defined *inside* the component, which makes each a brand-new component type on every render, so
  React unmounted and remounted the whole table each time any state changed — one keystroke in the
  filter box was enough. The job-title box in each row is uncontrolled (`defaultValue` + `onBlur`),
  so anything typed there and not yet blurred was silently discarded. Nobody had reported it. All
  three now live at module level with their state passed in.
- **Twelve copies of the same arithmetic.** Eight admin pages and `EventFilter` each computed
  "current events = ended less than 30 days ago, starting within twelve months" by hand. They now
  call `eventWindow()` in `lib/events.js`, so the pill row and a page's default event come from one
  function. `dateISO`, `sinceISO` and `yearsSince` cover the other three clock reads.
- **Two places where the browser's answer was fetched after mount** (`AdminNav`'s open/closed
  preference in localStorage; `PhotoUpload`'s "is this a touch device" from matchMedia). Both now
  use `useSyncExternalStore`, React's hook for state that lives outside React: the server snapshot
  renders first, the browser's real answer replaces it at hydration, no correcting render.
- **The rest were housekeeping**: four more inner components hoisted, Turnstile's refs updated from
  an effect instead of during render, a `useMemo` in `EventFilter` that never held removed, the login
  form's `finish` moved above the effect that calls it, and the idle timer's start stamp initialised
  to 0 instead of the clock.

**One warning is silenced, not fixed, and it is labelled.** `SecurityManager.jsx` line 130 calls
`loadFactors()` from an effect. `loadFactors` is async and every `setState` in it follows an
`await`, which is exactly what the rule wants; the lint cannot see through the `useCallback` to know
that. The `eslint-disable-next-line` carries the reason. That file is the two-factor flow hand-fixed
on 8 September and was not going to be restructured for a linter.

**What was verified, and what was not.** Lint and build after every group. In a browser, against the
live Supabase project (with the two public keys in `.env.local` — see the note in that file), the
login page renders and a wrong-password attempt produces the deliberately vague message. **Not
exercised in a browser:** every staff page, the two-factor page, the photo uploader and the payment
panel, all of which sit behind a login this session did not have credentials for. Testing Script 3
covers them; the next person through it is the real check on this work.

---

## 2026-09-29 — Emailed links: the `/auth/confirm/` button page is the cross-device fix, and the `implicit` flow setting is removed because it never applied

**What was believed.** Since 21 August, `lib/supabase/client.js` passed `flowType: 'implicit'`, with
a long comment saying that is what lets a sign-up or reset link requested on one device be opened on
another. `/account/link-expired` and `CLAUDE.md` repeated it, and `CLAUDE.md` still listed "switch the
email templates to `token_hash`" as open.

**What is true, checked 29 September from a real password-reset email.** The link was
`/auth/confirm/?token_hash=pkce_…&type=recovery`, so the templates had been switched already, and
the token was still a PKCE one. The reason is in `@supabase/ssr` 0.12.4:
`createBrowserClient` spreads the caller's `auth` options first and then writes
`flowType: "pkce"` after them, so no option can change it. The setting was dead from the day it was
added.

The links work across devices anyway, because of the page, not the flow. `/auth/confirm/` renders a
button, and the button's server action calls `verifyOtp({ type, token_hash })`. Verifying a token
hash on the server needs no code verifier — only the `?code=` exchange does — so the verifier that
PKCE leaves in the requesting browser is simply never used. That is also the shape Supabase's own
server-side-auth guide uses. The same page is the scanner fix: SafeLinks and spam filters send GETs,
the page spends nothing on a GET, and the token is still there for the person's POST.

**Tested the same day, across devices.** The reset was requested from Edge on Windows and the
emailed link opened, through SafeLinks, in Edge on Android. The card rendered; pressing its button
produced a `POST /verify` 200 from our server (logged as an `otp` login), and the phone went
straight to the two-factor prompt. That last part is correct and worth knowing: **a reset link does
not skip two-factor** on an account that has it — email access alone is not enough to get in.

**Changed:** the option is removed from `lib/supabase/client.js` and its comment rewritten to say
the above; the `link-expired` note and the `CLAUDE.md` paragraph are corrected. No behaviour changes —
the removed line was already being overridden.

**The thing to protect is the two Supabase email templates** (Confirm sign up, Reset password),
whose text is in `supabase/EMAIL-TEMPLATE-SNIPPETS.md`. If either is ever reset to Supabase's
default `{{ .ConfirmationURL }}`, links go back through `/auth/callback` as `?code=`, and those are
tied to the requesting browser and spendable by scanners. `app/auth/callback/route.js` still
accepts them so an old email keeps working, but it is the fallback, not the design.

*Alternative considered:* force the implicit flow by building the browser client with
`@supabase/supabase-js`'s own `createClient` instead of `@supabase/ssr`. Rejected: it would give up
the cookie session storage the server pages read, to fix a problem the button page already solves.


## 2026-09-29 — Testing Script 3, run by bots: eight defects, two money, one that had switched off program leaders

Five Playwright bots (Claude, in a Cowork cloud session, supervised by Lawrence) ran Testing Script 3
against the preview with six purpose-made bot accounts; 128 items, 114 passed. The report with the
per-item evidence is on the team site (`00 Comments and Critiques\Testing notes\2026-09-29 - Claude
bots - …`). What changed in the repository, and why:

- **Checkout charged the old per-event deposit (§12.2).** `app/account/dashboard/pay/actions.js` still
  read `events.deposit_cents`; the 31 August per-person correction had reached every *display* of the
  deposit and not the action that creates the Stripe session, so the panel said $150 and Stripe opened
  at $50. It now uses `registrationDepositCents` like everything else.
- **Deposit heads are counted by person, not by participant row (§14.3).** A parent who also volunteers
  holds two rows (0069) and one place; the row count charged a family of two a deposit for three.
  `registrationHeads()` in `lib/payments.js`, used by the dashboard, Checkout, the staff confirm-gate
  and the staff registration screen.
- **`people.profile_id` was never set, so no program leader could be named (§5.3).** The 31 August
  "must be registered for this event" check reads it; 0 of 28 rows carried it. Migration `0074` adopts
  the rule the site already assumes — the household owner's login is the household's primary-contact
  person — backfills it, and keeps it true by trigger. `grantProgramLeader` applies the same rule as a
  fallback.
- **The Apostles' Creed affirmation was never recorded (§3.5), and the rule around it changed.** The
  insert carried no `signer_name`, the 0049 trigger refused it, the action swallowed the refusal, and
  volunteers were asked again on every edit with nothing on file. Migration `0073` lets a `self`
  signature name the person rather than the household contact, and the action signs with the
  volunteer's own name. Separately, **the board's decision, relayed by Lawrence the same day: the
  affirmation is asked of everyone but does not block the application.** Somebody not comfortable with
  it leaves the box unticked and is told to speak with Larry (`larry@luke14ministries.net`); the
  Volunteers review page then shows a red "Creed not affirmed — speak with Larry" pill on that person
  until a signature exists. The gap is meant to be loud at review, not a wall on the form.
- Smaller: Staff & Access opened registrars-first (§20.9); Manage household lost unsaved edits on its
  own "Back" link (§19.4, same-site links now ask); reopened registrations showed blank preferred
  names (§20.1); activity sheets printed raw `HH:MM:SS` sittings; the staff registration screen printed
  "$247.5"; a missing space in the person page's hidden-information banner.

**Two limits the bots ran into, recorded so the next round does not rediscover them.** Cloudflare
Turnstile never issues a token inside the sandbox, so Supabase's captcha check was switched off for
the round and the bots logged in through the Auth API with the session cookie injected (turn captcha
back on when the round ends). And migrations could not be applied from the session — Lawrence applies
them from the Supabase SQL editor; `0073` and `0074` are in the repository before they are in the
database, which is the opposite of the usual order and worth knowing if a page misbehaves in between.

**Three rulings, given by Lawrence the same evening, and built:**

- **"Home church (optional)" stays** on the family wizard's household card. It is a household field,
  not the per-volunteer faith question §3.4 is about; the script's wording was broader than the intent.
- **Parents, guardians and caregivers are never listed on the Buddy board.** They are the support, not
  the supported. Campers are listed by default (the 31 Aug rule stands). **Siblings are listed and may
  be paired when a volunteer is free, but a sibling's buddy is a preference, never a promise** — the
  board tags them "sibling — if available", and the family dashboard says the same under each
  sibling, with the registration@ address for a family whose sibling has particular needs. The
  support form still does not ask about buddies (31 Aug).
- **Staff with the Sensitive grant may set or correct allergy severity** on Dietary & Allergies, from
  an amber select beside each allergy pill (`app/admin/dietary/SeverityPicker.jsx`, `actions.js`).
  The warning is non-blocking by design — a standing note on the page and on the control, not a
  dialog — and says the value must come from the family or the camp doctor, never from a reading of
  the text. The 0068 change log records every such edit, whoever makes it.

## 2026-09-29 — The docs-only build skip compares against the last DEPLOYED commit, not the last commit

**What happened.** The git watcher pushed the Testing Script 3 fixes as six commits, code first and the
`DECISIONS.md` entry last. Vercel builds one deployment per push, from the head commit, and
`vercel.json`'s `ignoreCommand` was `git diff --quiet HEAD^ HEAD -- ':!*.md' ':!LICENSE'` — the head
commit against its parent. That diff was Markdown only, so Vercel cancelled the deployment and the five
code commits underneath never went live. Nothing said so; the site simply stayed on the previous build.

**The fix.** Vercel sets `VERCEL_GIT_PREVIOUS_SHA` to the commit of the last successful deployment,
which is the right base: "has anything other than docs changed since what is live?" The command is now
`git diff --quiet ${VERCEL_GIT_PREVIOUS_SHA:-HEAD^} HEAD -- ':!*.md' ':!LICENSE'`, falling back to the
old behaviour on a first deployment where the variable is unset. The same command was also set as the
project's Ignored Build Step in the Vercel dashboard, but `vercel.json` wins whenever it is present —
which is why a dashboard-only change did nothing and this file is the one that counts.

**Rule for anyone grouping commits.** Docs-last is still fine. What is not fine is assuming the push
deployed: check Vercel, or the site, before reporting a fix as live.

## 2026-09-29 — Wave 2 of the bot round: leaders were being named and never shown, and a leader at `/admin` looped

Two more from Testing Script 3, found once program leaders could be named again (0074):

- **The Program leaders cards never showed anybody (§5.3, §5.6, §7.5).** `program_leaders` has two
  foreign keys to `profiles` — the leader and the administrator who granted — so PostgREST refuses a
  bare `profiles ( … )` embed as ambiguous (PGRST201). The page dropped the error and rendered "No
  leader named" on every card while the grants sat in the database, which is also why Alastair's
  31 August grant "was reported twice" in ProgramBoard's comments. The embed now names the constraint,
  `profiles!program_leaders_profile_id_fkey`, and the error is logged.
- **A program leader who typed `/admin`, or any staff URL, got ERR_TOO_MANY_REDIRECTS (§6.2, §7.1–7.2).**
  The layout admits leaders, every page then did `redirect('/account/?next=<page>')` for non-staff,
  and `/account/` sends a signed-in person straight back to `?next=`. Nothing leaked — the loop is
  the browser giving up, not a page rendering — but a leader's first visit ended on an error. All
  27 pages now call `bounceNonStaff(nextPath)` in `lib/staff.js`: a leader lands on My Program,
  anyone else still goes to log in with `?next=`.
- Also: the staff registration header counted rows, not people ("3 people" for a parent-plus-
  volunteer and a camper); it now uses the same `registrationHeads` as the deposit.

**Still to settle after this deploys:** the lead badge and remove control (§5.6, §7.5) could not be
exercised because the cards were empty; the stored Creed agreement text (the `agreements` row, not
code) still says the affirmation is "required … as a condition of participating", one paragraph above
the new "speak with Larry" note — the body wants rewording to match the ruling; and unticking the
Creed after signing is accepted but does not withdraw the signature, which is probably right (an
affirmation once given stays on record) but is a ruling, not a given.

## 2026-09-29 — Evening: an untick re-flags the Creed, two loops closed, and the real rooms at Carson Springs

- **Unticking the Creed re-flags the application (`0075`).** Families cannot change or delete a
  signature row, deliberately, so a volunteer who affirmed and later re-saved with the box unticked
  still read "affirmed" at review. Lawrence's ruling: it must re-flag. The application now carries
  `creed_affirmed`, the answer as last given; the signature stays as history. Review shows three
  states — *affirmed*, *affirmation withdrawn — speak with Larry*, *not affirmed — speak with Larry*
  — and the form reopens the box as it was last saved. The stored agreement text is unchanged: the
  ruling is that the wording may keep its emphasis towards affirming.
- **Any signed-in family account that typed `/admin` looped (§7.5, wave 3).** Same class as the
  leader loop fixed earlier in the day, one layer up: the layout sent a non-staff, non-leader to the
  login page, which sent a signed-in person straight back. The layout and `bounceNonStaff` now send
  a signed-in person to their dashboard and only a logged-out visitor to `/account/?next=`.
- **Removing a leader clears the lead badge.** `revokeProgramLeader` set `active = false` and left
  `is_lead`, so re-naming the same person later brought the badge back unasked.
- **Rooms & Cabins now holds the venue's real rooms, and staff can change them (`0076`).** Larry's
  Carson Springs list (and CampSite's board for comparison) gave the buildings, rooms and beds:
  Lodge 101–112/201–212/301–312 (only the rooms on the list — 111 and 207 are not invented), Ginn
  114–120, Maple 121–128, Cedar 1–3, Dogwood 1–7, Pine 1–6, Carson Hall's nurse's room, RV sites
  1–11 and an Off Campus place, for both Camp Celebrate 2027 weeks; the 0043 placeholders are
  retired, not deleted. `beds` (the venue's words) and an optional `staff_capacity` are new columns;
  `building` and `rv` are new kinds. Only Lodge 101 and 102 are marked accessible, because only they
  were described so. The page gains **Set up rooms** (add, edit, retire — refused while anyone is
  placed there — restore, and copy another event's inventory into an empty one), a **printable room
  list** with tick boxes that carries names, roles, ages and households only, bed descriptions on
  the cards, and a light sex tint on occupant chips as CampSite has. The Adult Adventure Retreat
  keeps its placeholders: different venue, no list yet.

**Questions for Larry, recorded here so they are not lost:** which rooms besides Lodge 101/102 are
step-free with an accessible bathroom; whether Lodge 111 and 207 exist; the nurse's room's capacity
and who it is for; whether camp wants a separate staff count per room (CampSite's "0 / 3 staff") or
one number; what CampSite's red dot beside a name meant; and how many people an RV site counts as.

## 2026-09-29 — Late: a family could never see where they were staying

Found by the bots on Testing Script 4 §11.10, on the first end-to-end publish of a room assignment
to a family, and older than anything else found today — it has been true since `0042`. Two faults,
either one enough. The `lodging_assignments` family policy asked "is this event published?" with a
subquery on `lodgings`, and a policy's subquery runs under the other table's policy for the same
person; `lodgings_select` was staff-only, so the subquery found nothing and the family's own
assignment was invisible, published or not. And the dashboard embedded the room and building names
from `lodgings` with a constraint-name hint PostgREST refuses, dropping the error. `0077` adds two
SECURITY DEFINER helpers (`lodging_published_for`, `my_visible_lodging_ids`), rewrites the assignment
policy on the first and gives families a `lodgings` policy on the second — their own bed and its
building, on a published event, nothing else — and the dashboard uses `parent:parent_id ( name )`
and logs errors. Verified against the API as a family: empty before publish, the room after, empty
again after unpublish, and no other room visible at any point. **Rule for anyone writing a policy:**
a subquery inside a policy does not get staff's view of the other table; go through a definer
helper, as `my_participant_ids()` already does.

## 2026-09-29 — Checking in reveals the room, the campus map and the building plan (`0078`)

Lawrence, after seeing "Staying in" work for the first time: the venue's page publishes a campus
map and a floor plan per lodge; a family arriving at camp needs the room, the map and the plan on
their phone, and **check-in is the trigger**. Built: `events.campus_map_url` and
`lodgings.schematic_url` (on the building; rooms inherit), seeded from tnbaptist.org for both Camp
Celebrate weeks — Maple, Pine (the Hickory/Pine/Laurel plan), Ginn, Dogwood and Cedar. The Lodge
(rooms 101–312), Carson Hall, the RV sites and Off Campus have no plan on the venue's page and show
the map only; the Lodge's plan is a question for Larry. A checked-in person's bed is visible to
their family whether or not staff have published (the 0042 publish gate still reveals rooms ahead of
time for everyone on the event); the map and plan links appear only after check-in. The room label
no longer repeats the building — "Lodge 103", not "Lodge — Lodge 103" — since the venue names rooms
with the building in them; a room named without it still gets the building in front. The set-up
editor gained the *Floor plan link* box so staff can fill in the Lodge's when it turns up.

## 2026-09-29 — Lodge 111 and 207 exist; check-in reveal verified end to end

Lawrence, late evening: the main Lodge is three floors of twelve hotel-style rooms, 36 in all; the two
missing from Larry's sheet were an omission. `0079` adds Lodge 111 and 207 for both weeks (Staff
Questions §11.2 is answered; §11.3, the Lodge's floor plan, is still open). The bots then ran the
check-in reveal on the deployed build: assigned but unpublished and not checked in → nothing on the
family dashboard; Ada checked in → "Staying in: Maple 121 · Campus map · Building plan" under Ada only,
with the venue's two PDFs; published → the room under all four, the links still only under Ada; moved
to Lodge 111 → "Lodge 111 · Campus map" and no plan link; un-checked, unpublished, removed → nothing.
Six of six.

## 2026-09-30 — A camp week's balance is due two weeks before that week starts

Larry's rule. It is computed from `events.starts_on` by `balanceDueOn()` in `lib/events.js` rather
than stored, so it cannot drift from the camp dates and nobody has to enter it. Each week is its
own event and gets its own date. Camp weeks (`event_type = 'camp_week'`) only; retreats, dinners
and other events return null and keep the "staff will be in touch about the due date" wording.
The lead time (`BALANCE_DUE_DAYS_BEFORE`) and the event types are two constants in that file.

Shown on the wizard's confirmation card, the dashboard (balance pill and deposit box), both
printable statements ("Due by"), the confirmation email, and a Due column on Event Payments,
marked Overdue once Morristown's calendar passes the date with a balance still owed. Nothing is
enforced — no late fee, no automatic reminder (the reminder buttons are still placeholders).

This replaces the 29 September ruling not to build due dates because each event's date was
unknown: a rule makes a per-event date unnecessary.

## 2026-09-30 — Payment plans, a payment choice to finish registering, and the early-registration discount

Larry's rules. For camp weeks, a registration is **not finished** until the family either
pays in full, sets up a payment plan, or requests a scholarship. Early registration earns a flat
amount off per person (Camp Celebrate: $50) for people registered by the event's early date,
**when the family pays in full or is on a plan**; a scholarship request alone does not earn it.
A plan charges a saved card or bank account automatically: the deposit is the first payment, and
the rest is split monthly or twice a month (the family chooses), with the last charge on the due
date. Built in migration `0080`, `app/account/finish/`, `stripe-plans-webhook`,
`charge-payment-plans` and `supabase/functions/_shared/`. The steps to switch it on are in
`supabase/PAYMENT-PLANS-SETUP.md`.

The choices under it:

- **A daily charger, not Stripe subscriptions.** Stripe Billing adds a percentage on top of the
  normal fees (the fee saving is the whole case for this platform). Its fixed amounts go stale the
  moment a scholarship or discount changes a balance, and it cannot do "the 1st and 15th". Each
  charge here is worked out on the day as what is still owed divided by the charges left, so a
  plan always ends on exactly $0.
- **"Finished" is worked out, not stored.** The `registration_payment_routes` view decides it from
  what happened: a plan that got past its deposit, a paid balance, or a scholarship request. A
  stored "chose a plan" flag could be true with no plan behind it.
- **Plans come into existence only from Stripe.** Families read their plan and never write it. The
  webhook creates the plan when the deposit and saved payment method are confirmed.
- **The early discount is a rule recomputed from stored facts**, the same pattern as `0070`, and
  sits in its own column (`early_discount_cents`) so the two rules can never overwrite each
  other. The old per-option early-bird *price* is retired.
- **Failures:** retried after 3 days, 3 tries in all, then the plan stops as `failed` and staff are
  emailed. **Staff decide** whether a failed or cancelled plan keeps the early discount. It keeps
  it until a registrar unticks the box.
- **A separate webhook endpoint** for plans, following `stripe-refund-webhook`'s reasoning: the
  payment webhook only gained one call, to recompute the discount after any payment.

Found and fixed along the way: **a family could change their own fee through the database API**
(proved on a scratch copy: an ordinary family login set a camper's fee to $0). A trigger now
refuses any family-side change to fees, discounts or scholarships. Separately, the Setup page's
price box could have re-priced the zero-fee volunteer option instead of the camp fee; it now
targets the enrollment option only.

---

## 2026-09-30 — Lawrence's answers to the staff questions (migration `0081`)

These come from the staff questions PDF and are recorded in full in the project doc
`claude/decisions-2026-09-30-lawrence.md`.

- **Refunds.** A registrar or an admin can issue one. Withdrawing a registration never refunds
  automatically. The code already worked this way: `refundPayment` is registrar-level, and the
  cancellation queue moves no money.
- **Reminder emails.** Open. Ellen and Katie will decide.
- **2027 pricing.** $495 a person, camper or volunteer. Three automatic discounts stack:
  - the 3rd and later family member gets $50 off;
  - a volunteer staying both weeks gets 50% off the 2nd week (`0070`, with
    `c_require_vol_both = true`, which answers that function's open Q7);
  - early registration, $50 (`0080`).

  Each discount has its own column, so no rule can overwrite another's, and each is capped at
  what the person still owes.
- **The deposit is needed for approval, not to submit.** It is not needed if the family requests
  a full scholarship. This **replaces** the 30 Sep "not finished until you choose how to pay"
  flow; plans and pay-in-full stay available. Staff sort registrations into three classes:
  1. deposit received, where only confirmed money counts and a bank transfer still clearing does
     not;
  2. full scholarship requested;
  3. neither, where nothing needs reviewing yet but the details are kept.

  A first payment of any size puts a registration in class 1, and a shortfall against $50 a
  person is shown as a flag. *Why:* treating a family that paid $50 for three people as
  "nothing to review" would hide a family who is clearly coming.
- **Going public is gated on Stripe paying out to the bank.** On 30 Sep a Truist account was
  linked but the payout schedule was manual. It must be set to automatic.
- **Agreements are signed per person.**
  - Each adult signs for themselves. A parent or guardian signs for minors and for adults in
    their guardianship. Signing for another adult needs an explicit affirmation that they gave
    permission.
  - Anyone added later is signed for when they are added. A signature is never re-taken.
  - Agreements name the event, filled in automatically ("Camp Celebrate, July 19–23, 2027").
  - The scholarship and payment-by-check agreements are retired. Scholarship wording carries
    no dates and no named person's email.
- **Apostles' Creed.** It has Lawrence's wording, and "please contact Larry" if uncomfortable.
  Not affirming flags the registration for staff and never blocks it.
- **Photos.** The box starts ticked. Unticking flags the registration for staff review, with
  "please contact Larry" alongside. **Directory:** the box starts ticked, with the same
  encouragement pop-up on unticking. That was already how the site worked.
- **Data retention.** The proposed policy stands, with 2 years changed to **3 years**. It is not
  published. Families can request deletion from their dashboard, and staff act on it by hand,
  because payments, releases and background checks must be kept.
- **2027 dates** are confirmed. Volunteers arrive one day earlier, for orientation.
- **The shared mailbox.** `info@` is an M365 shared mailbox owned by Lawrence, Larry, Ellen and
  Katie. Each of them must add it in Outlook and remember to check it, because its new-mail
  indicator is easy to miss. A forwarding group would be easier to notice, but could lose its
  use as a "send from" address for the site's automatic emails.



---

## 2026-10-14 — The review queue is one page; Event Payments is money again

Lawrence, 14 October, answering the question "where does the review happen?" The 30 September
answer put the three review classes and every flag on Event Payments; a fortnight of use said that
a registrar sorting money does not want the Creed and photo flags in that column, and that there
was no single place to see everything a reviewer needs.

- **`/admin/review` — "Awaiting review"** — is that place: every registration with somebody
  still *submitted*, by event, each row carrying the deposit / scholarship class, every flag
  (deposit short, photo permission declined, Creed not affirmed), paid and balance, and a link to
  the registration where the decision is made. The Overview's amber "37" links to it, and it is the
  second item in the sidebar. `?show=all` lists every live registration.
- **Event Payments keeps only the money flag** (deposit short). Its "Flagged" filter is now
  "Deposit short". Scholarship requests sit beside it as a tab, and directly under it in the
  sidebar, because a scholarship decision is a money decision.
- **Sidebar order**: Roster first (renamed "Roster: Campers & Families"), then Volunteers and
  Recent Changes, then the camp-week tools, then Event Payments with Scholarship requests under
  it. The order is an explicit list in `app/admin/layout.jsx` so the item comments stay put.
- **The legend under the sidebar** read as a broken counter ("n waiting for review · n activity")
  to more than one person. It now says it is a key to the two badge colours.
- **Rosters' event column** shows "CC 2027 · Wk 2" / "AAR 2026" with the full name on hover; it
  was wrapping to four lines.


---

## 2026-10-14 — Activities are chosen for campers; the sheets print one at a time

Lawrence, 14 October, with Ellen's notes. **Only campers choose activities** — the family page
lists campers alone, and a registration with no camper shows no "Choose activities" button. The
buddy goes along with their camper; a volunteer picking horseback riding for themselves was never
the idea. (The seats the area leaders count are campers' seats.)

**The activity sheets print one activity at a time** as well as all together (`?activity=`), and
the column that read "Notes" is "Support": it is a flag about the person, so it reads the same
on every sheet they appear on — Katie Pratt2 carried "ask the coordinator" on every activity
because she carries a support flag, not because each activity has a note. Per-activity notes
would be a new field; not asked for.

**Wording:** the activity editor's examples said "boat" for every activity that runs in sittings,
which read oddly on the Salon. They now say "trip" and "sitting". The Salon's own sitting,
"Landing 1" on 15 July, is data Ellen entered while setting activities up and is hers to correct
on the Activities page.


---

## 2026-10-14 — Buddy sheets carry the pairing notes and the allergy; a Newsletter page lists, it does not send

**Buddy sheets** (`/admin/buddies/print`), one page per buddy for orientation, print the camper's
name and what they go by, age at camp, household, program, room once published, the five pairing
notes the board already shows (communication, getting around, personal care, what is harder, what
helps), and the safety facts: allergy with its severity and what it is, seizures, rescue medication.
They do **not** print medications, diagnoses, behaviour history or the emergency contact. The room
list's rule — paper gets left on a table — still holds; the difference is that the buddy is the one
adult beside this camper all week and needs these facts in their pocket. The footer says to hand the
sheet back. If staff decide the sheet should carry less, the two detail lines are marked in the file.
The CSV of pairings carries names, roles, households and the background-check word only.

**Newsletter** (`/admin/newsletter`, migration `0085`): who has "Ministry news & updates" on,
who joined or left in the last 30 days (logged from today by a trigger on `profiles.email_news`),
and a CSV. It does not send: newsletters stay in Resend's own tools until a later decision, and
people who signed up through the public Google Form are not on this list.


---

## 2026-10-14 — Required answers, the volunteer form trimmed, and the 2026 retreat stays on CampSite

**Required answers** — Ellen and Katie's position, adopted by Lawrence on 14 October, which closes
the open staff question "which details fields should block saving" the other way from the 24 August
default. The boxes that decide what staff do must be filled in: a camper's disability or diagnosis;
what the allergies are and how serious, when allergies are ticked; the seizure and rescue-medication
detail when those are ticked. On the volunteer application every question except skills. A
scholarship request needs a sentence. **"None" and "N/A" are accepted** — they are what a reviewer
follows up on, which is the point of asking. A reviewer sees them on the person page and the
registration; a flag in the review queue for placeholder answers is a possible later step and is not
built. The photo and the emergency contact keep their strong prompts.

**The volunteer form no longer asks** about diagnosis, communication, getting around or personal
care — those are camper questions (Ellen). Anyone who is not a camper keeps allergies, medications,
seizures, sleep and rooming. Text already entered in the removed boxes stays visible.

**"Where would you like to serve?"** says that a preference is a preference and the camp team makes
placements (Katie).

**Adult Adventure Retreat 2026 registers on CampSite** (Ellen, for the organisation). The public
retreat page sends people to the ministry's existing site, where the CampSite links are; this
platform's first retreat is the next one. The wizard links are kept in a comment for then.


---

## 2026-10-14 — One role per person per event, superseding "a parent who also volunteers"

Lawrence, with Ellen's Script 4 feedback: a person registers for an event **either** as a volunteer
**or** as a camper / family member, never both. This supersedes the 29 August rule (`0069`: a
parent who also volunteers, as a second zero-fee row). The wizard no longer offers "is also
volunteering"; the server pins that flag to false; and migration `0086` adds a trigger that refuses
a second live row for the same person at the same event however it arrives. Existing double rows
from `0069`'s own testing are left for the purge — the trigger runs only on a new row, a moved
row, or a row brought back from cancelled, so confirming or editing old data is never blocked.
The zero-fee volunteer option stays on the events for history; nothing writes to it now.

Also today, from the same conversation: the buddy picker's box is **"Hide paired"** and is on by
default; the sibling note on the family dashboard carries Lawrence's wording ("Camp Celebrate
commits to matching up a buddy for every camper…"); the wizard's "$50 deposit per person" line
reads the event's own deposit; the review flag "Deposit short of $50 a person" no longer names a
figure; the newsletter is on **Mailchimp** for now (Ellen), cost still unknown, Resend later.
The medical contact was already admin-only on both the page and the action.


---

## 2026-10-14 — The sidebar in sections, a search box on every staff page, Volunteers by event

Lawrence asked for a review of the left-hand navigation's hierarchy. It now reads: the two queues
(Overview, Awaiting review); **People** (Roster, Volunteers, Search, Recent Changes); **Camp week**
(Check-In, Dietary, Medical, Activities, Buddies, Rooms, Programs — the one group that folds);
**Requests** (Cancellations, Deletion requests); **Money** (Event Payments, Scholarship requests,
Giving); **Admin** (Newsletter, Setup, Accounts, Staff & Access). The sections are one list in
`app/admin/layout.jsx`.

**Search** (`/admin/search`, and a box in the staff header on every page) finds people and families
by name or email and links to the person page and each registration — the answer to "the person
page is not readily accessible". **Volunteers** filters by event with the same pills as every other
staff page and has a printable list (`/admin/volunteers/print`).


---

## 2026-10-14 — An outside provider's waiver needs proof, not a tick

Lawrence: "Do not accept word of mouth confirmation of rafting waiver." A provider-run activity
(rafting, horseback) now carries a **link to the provider's own form** (the activity's provider
URL, already on the editor) and an **upload** of the provider's confirmation — a screenshot, a
photo of the signed page, or the PDF — by the family for each signed-up camper, and by each
volunteer for themselves, since a buddy goes where their camper goes and the provider wants the
buddy's form too. Volunteers can do this after camp starts, once pairings are known. Staff see
"confirmation ✓" (opens the file) or "no confirmation" beside every name on Activities, a
"Volunteer confirmations" line for buddies, and the same mark on the printed activity sheet. The
old "told / not told" acknowledgement stays as what it is: a record that we said so. Migration
`0087`: a private bucket, one file per person per activity under the participant's id, the same
household check as every other family-facing table.

---

## 2026-10-15 — The build-skip command must fall back to "build" when it cannot see the last deployed commit

Every push from the evening of 14 October to the morning of 15 October ended as a Vercel deployment
in ERROR, and production kept serving the 4 October commit. Nothing was wrong with the code: CI built
every push, and so did the local machine. The failure was the `ignoreCommand` in `vercel.json`
(29 September), which runs `git diff` against `VERCEL_GIT_PREVIOUS_SHA`, the last *deployed* commit.
Vercel clones only the last few commits, so once fifteen pushes separated the two, that commit was not
in the clone, git said `fatal: bad object`, and Vercel treats any exit code other than 0 or 1 as a
build error rather than as "go ahead and build". The 29 September entry assumed the opposite.

The command now checks the commit exists first and otherwise exits 1 — the "build" answer — so the
skip only ever applies when it can actually see what changed. The rule itself is unchanged: a push
that touches only Markdown and LICENSE still does not build.

Also noticed the same morning: the repository is now `L14-website` (renamed on GitHub); the Vercel link
followed the rename. Nothing in the repository refers to the old name except history.

---

## 2026-10-15 — The registration page is about the family; the review is a decision, not a dropdown

Lawrence, from the staff registration page: the event name was the title and the family was a
breadcrumb, which reads backwards when a family is at two events. The page now opens with the
**family** — name, the people on this registration as links to their person pages, and every event
the household is registered for as a link to that registration — then the event, then the money.

**The money is explained, not listed.** "Fees $960 − $240 · Paid $950 · Credit $230 · $470 refund
on its way" was five true facts with no arithmetic between them. The block now runs fees, less
scholarships and discounts, amount due, paid (net of refunds already completed), balance today —
and a paragraph for a refund in flight that does the sum: it is not yet taken off "paid" (0053),
and once it clears the family will have paid X and owe Y. Same view as Event Payments and the
family dashboard, so the three cannot disagree.

**Approve, waitlist, or send it back.** The review queue's number only ever dropped when a
registrar changed each person's status in "People on this week", and "send it back for more
information" was a note with nothing recording that it had been sent. A **Review** card at the top
of the page now approves or waitlists everyone still submitted in one click (the deposit guard
from 31 August still asks first) or asks the family for more information: that writes the ask as
a note on their dashboard **and** marks the registration as waiting on the family (migration
`0089`, two columns on `registrations` that only a registrar may move). The queue separates
*waiting on staff* from *waiting on the family*, the nav badge counts only the first, and the
family sees the ask in amber on their dashboard. It clears when staff say the family has
answered, or when everyone is confirmed or waitlisted. Nothing is emailed automatically.

**Program placement is coordination, not registration** (migration `0090`). Buddies, rooming and
activities belong to the coordinator; placing people into programs needed a registrar, because
the write lands on the participants table and that table's update rule is the registrar's. Larry
and Lawrence, reading the access-model note: odd, the coordinator makes sense. Opening the whole
participants row to coordinators would open fees and status too, so the placement goes through a
function that changes one column and checks the role itself. Naming or removing a program leader
stays an administrator's act, and the database now says so as well as the page. Registrars lose
the Programs page unless they are also administrators; nobody active today is affected.

**A background check gets a verdict, and the verdict gets a name** (migration `0091`). The chain
was: order in Checkr's dashboard, import the CSV, and only a "clear" report set "on file"; a
"consider" waited for a person, who cleared it by ticking *Paperwork on file* on the volunteer's
record — and nothing said who ticked it, when, or what they concluded. Now the record carries the
ministry's own verdict in three words — *OK to serve*, *needs a follow-up conversation*, *not
permitted to attend* — set by whoever holds the Background-checks grant; the database stamps who
and when, requires the check date once paperwork is on file, works the expiry out from it (36
months, one function, until the board picks an interval — W21), and logs every change the way
grant changes are logged. Everyone on staff sees three facts — on file, current, verdict — through
a definer view, so the Buddy board stops telling coordinators without the grant that nobody has
been checked. Larry's "not permitted" is red wherever a name appears.

## 2026-10-18 — Campsite's real cost: the July statement, not the directories

The 5 August entry framed Campsite as "6% plus about $249 a month, the fixed half the larger half"
from four directory listings, and said to amend it when the ministry's own invoice arrived. The July
2026 merchant statement (Implementation Plan §3c) is that evidence: **$862.62 on $11,628.40 across 39
transactions — 7.42% all-in**: a 4.0% software fee on volume, about 3.0% card processing, and about
**$41 a month flat**. The fixed costs are a wash against ours, so **the whole saving is the rate**,
and there is still no minimum season size before the switch pays. The 5 August reasoning about a
fixed fee removing the threshold does not hold; its conclusion (the project pays at any volume)
still does, for the rate's sake. CLAUDE.md said "$249/month" until today.

## 2026-10-18 — Carried over from CLAUDE.md when it was trimmed

CLAUDE.md was rewritten from dated update paragraphs into a current-state brief (6,252 → about 3,600
words). These four paragraphs were the only history it held that this log did not, so they are kept
here word for word.

**Built 31 August — migrations `0062`–`0070`; `0071` and `0072` followed on 1 September (the program-lead flag, and the definer function that lets co-leaders see each other's names), and the high-water mark is now `0072`.** Volunteers
affirm the Apostles' Creed on the volunteer application (`0062`, `0063`). Allergies carry a
severity, in the only three terms that change what somebody does (`0064`). Program leaders got
their table comment corrected — a second, assistant leader always worked (`0065`). Every camper is
treated as needing a one-to-one buddy until a coordinator says otherwise, which needed a tri-state
because "nobody decided" and "decided no" had been the same value (`0066`). Rooming preferences and
likes/dislikes are collected (`0067`), and `0068` put those and `allergy_severity` into the change
log — **adding a column to `person_support` is not finished until `log_family_change()` is
redefined**, which `0064` missed and is the trap to remember.

`0069` and `0070` are the two to read before touching money. `0069` publishes a **second, zero-fee
`event_option` per event** so one person can hold two roles at one camp (a parent who also
volunteers, charged once). That broke an assumption four files were making —
`event_options.find((o) => o.published)` — which became a money bug the moment an event had two
options, because a bad draw returns the zero-fee one and sets the price. Use `enrollmentOption()`
in `lib/events.js`; never "the first published option". `0070` adds
`recalc_multi_week_discount()`, which applies the both-weeks discount as a **rule recomputed from
stored facts** rather than something the wizard works out, and which **only ever touches discounts
carrying its own `discount_reason`** — a manual staff discount is invisible to it. Whether
volunteering must cover both weeks or just one is still with staff; the rule is three named
constants at the top of that function.

**Next, in order:**

1. **Purge ALL test data** from the production project. Everything after this depends on it.
2. **Live Stripe keys**, and **both** live-mode webhooks — `stripe-webhook` *and*
   `stripe-refund-webhook`. Test-mode endpoints do not carry over; a missed refund webhook fails
   silently (see migration `0054`).
3. **Vercel Pro.** Required the moment live keys are in — Hobby is non-commercial only. See the
   Hosting note below.
4. ~~**Spam protection on the contact and newsletter forms.**~~ **Half done, half moot** *(corrected
   1 Sep)*: the contact form got Turnstile with server-side verification on 30 August
   (`app/contact/actions.js`, `lib/turnstile.js`); the newsletter page only links out to a Google
   Form, so there is nothing to protect. What remains is a *design* question — replace that link
   with an on-site sign-up that writes to Resend contacts, or keep the Google Form.

**Done 1 September, from Lawrence's read of Testing Script 3:** buddy pills now say *buddy
assigned — name*, *no buddy assigned* and *buddy not needed* (the words camp uses); a program can
have one **lead** among its leaders (`0071` + `0072`, a label not a permission, shown on Programs and at the
top of My Program); and the registration wizard says "family or group" so a group home or church
group is not told it is in the wrong place (the data model always allowed it — a household needs no
family relationship and a person can carry their own address).

**Done 8 September:** the two-factor page (`app/account/security/SecurityManager.jsx`) steps the
session up before adding or removing a device. Supabase requires AAL2 for both, and a browser
remembered at login sits at AAL1, so both buttons used to fail with Supabase's raw "AAL2 required"
text — found by Lawrence while moving codes into Bitwarden. The page now asks for a current code
inline and then continues. Testing Script 3, item 20.10.

**Done since that update:** the volunteer application (17 Aug); Turnstile on the public account
forms (live on sign-up, login and password reset); and refunds end to end — `charge.refunded`
handled by `supabase/functions/stripe-refund-webhook/`, per-family refunds through `refundPayment`
in `app/admin/registrations/[id]/actions.js`, with the over-refund guard and the pending-refund
accounting in migrations `0038`/`0044`/`0053`/`0054`.

## 2026-10-18 — PostgreSQL 16 on the build machine; the harness runs again

Installed through winget at Lawrence's request, as a local service on port 5432, with the
superuser password in the standard psql password file rather than anywhere in the repository.
`supabase/tests/run_rls_local.sh` builds a throwaway database from the Supabase stubs and every
migration, then runs a test. **First run: all 101 migrations build cleanly from nothing**, which
had not been checked since the ledger began at `0012`. The harness and the payment-plan seed
had drifted — a view dropped in `0092`, the second role `0086` retired, staff with no grants
after `0101`, anonymous counts thrown off by seeded events — and were brought up to date; the
harness gained a section proving the grants decide (a payments read opens money and nothing
else, a deactivated row holds nothing, the role functions are gone). `rls_test.sql`,
`payment_plans_rules.sql` and `staff_answers_rules.sql` all pass. The in-transaction probing on
the live database stays useful for one-off questions; the harness is the regression check.

## 2026-10-17, early — The rules read the grants; the role check retires (0101)

Build plan item 16, steps 3 and 4 of the access-model plan, the morning after step 1 and 2.
**Rather than restating sixty policies by hand, the migration rewrites them in place from a
mapping table**: each policy's expression is read back from the catalogue, the role token is
replaced with the grant for that table, and the policy is altered; the same for twelve guard and
helper functions, by name. The mapping is the decision and sits at the head of the file —
registration, payments (write, and now *read*: an operations helper sees no money at all),
giving, background checks (the table is write-only; the three facts stay a view every staff
member reads), sensitive (reads; writing the support row and photos needs write), setup (every
definition, including activities, slots and rooms, which coordinators used to define), and the
four placements. **Two things the role still does**: `is_admin()` (granting, accounts, naming a
leader, the doctor's dated grant) and `is_staff()` (an active row, for the broad reads every
preset includes). A final block refuses the migration if anything still names a role function,
then drops both. **Verification without a scratch database**: no Postgres on the build machine
(installing `psql` is sensible and is noted), so each bot persona was impersonated inside a
rolled-back transaction on the live database — the registrar saw money and not medical detail,
the coordinator the reverse, the administrator everything, the family only its own rows — and
the harness's personas now seed grants so `rls_test.sql` means what it says when it is next run.
**The three tick boxes on Staff & Access are gone**: since the database no longer reads those
columns, a tick there would have done nothing; Sensitive, Giving and Background checks are three
of the ten areas under *Grants*.

## 2026-10-16, night — The grants model lands, roles kept (0100)

Build plan item 16, steps 1 and 2 of the access-model plan. **The grants are recorded before
they are enforced.** One migration adds the ten areas as read/write rows per staff member and
fills them in from each person's role and ticks — faithfully, not aspirationally: an
administrator without the Sensitive tick stays without it, everyone on staff reads the three
background-check facts, registrars and coordinators each read what the other writes, as the
policies already behave. Presets on Staff & Access set the ticks in one click and are adjusted
underneath; Giving is never set by a preset; every change is in the same access log as the old
tick boxes. **The role still decides what the database allows**, and the page says so: a preset
therefore also sets the closest role and the legacy ticks, which is the price of landing the
model without a flag day. Step 3 — the rules read `has_grant()` instead of `is_registrar()`,
one area at a time, each batch verified by the test harness with the new personas — is the
work that remains, and the reason the role column is not yet a label. Nothing a family sees
changed.

## 2026-10-16, late — QuickBooks CSVs; a Mailchimp import CSV

Build plan items 14 and 15 (the call, 3:30–3:33 pm). **QuickBooks**: Event Payments and Giving
each gain a second download in the column order QuickBooks Online takes — Date, Name, Memo,
Account, Amount — in whatever scope the page is showing. Only money that moved: succeeded
payments, succeeded refunds as negative rows, gifts that arrived. A processing fee the payer
covered is its own row with its transaction, which is how Larry and David book it (fee covers,
§1.4). Gross per payment; Stripe's own fee is not in this system and comes from Stripe's payout
report. **The account names are placeholders** ("Camp registration fees", "Processing fees
covered", "Donations — <fund>") until the treasurer confirms the chart of accounts; QuickBooks
maps them on import, so a wrong guess costs a dropdown, not a re-export. A second format follows
if the first does not import cleanly. **Mailchimp**: the Newsletter page's list is also offered
in Mailchimp's import layout (Email Address, First Name, Last Name, Tags = *website*), so Ellen
can sync the audience by upload until the Mailchimp-or-Resend question is settled.

## 2026-10-16, late — One event filter everywhere; "current" is two weeks; an archive mark (0099)

Build plan item 12 (the ink; the call, 3:11–3:13 pm; Lawrence, 16 Oct: review every staff page
so event filtering is consistent, or clearly motivate a deviation). **One rule for "current"**:
`isCurrentEventRow()` — until two weeks after the event ends (30 days before today; follow-up
after a week is real but short), a year ahead, and never an archived event. Ten pages had their
own copy of the comparison and two had drifted; now they share one, so no two pill rows can
disagree. **The shared `EventFilter` on every page that is about an event**: Medical and Event
Payments lose their hand-rolled pill rows, Awaiting review gains pills that narrow the queue.
**Two deviations, each said on screen or in the code**: Check-In keeps its own pills with dates
on them, because it is used standing at a door on a phone where "Week 1" and "Week 2" are
identical without the dates and a search box is the wrong control; the Overview's table shows
every current event at once, so its pills jump to a row and the page says so. Rosters keeps the
search-only shape of the same component, which the 25 Aug decision already motivated. Search is
about people, not events, and gets no filter. **An archive mark on Setup** (`archived_at`) is the
one human override of the rule: a cancelled week or a duplicate drops out of every pill row now
and can never be open for registration; it stays in history and in every search box. At launch
the 2026 Retreat is archived there rather than deleted.

## 2026-10-16, late — A hold, the refund rule, the named allergen list, buddies many-to-many (0098)

Build plan items 6, 7, 9, 10 and 11, with a finding on 8. **A hold** (Larry and Ellen's ink;
the call, 3:04–3:06 pm): when a family changes something after approval, staff want the
registration back in front of a reviewer. "Waiting on the family" (0089) is the wrong state for
that — it is the family's move — so a hold is its own: three columns a registrar sets, everyone
confirmed or waitlisted goes back to *submitted* (the queue and the badge count them again),
the reason is shown to the family in amber, and approving, waitlisting or lifting clears it.
Offered where the reviewer is: on the Review card, and beside every row of Recent Changes with
the reason prefilled from the change. No automatic email — by hand from Outlook, as agreed.
**The refund rule on the form** (call, 3:36 pm): the per-person deposit is kept, the rest is
refunded in full until 30 days before the event and half after. The form opens on that
arithmetic, shown in full for this payment and today's date, and the registrar may type any
other amount with a reason: a suggestion, never a lock, because the board decides exceptions and
a form that cannot express the board's decision gets worked around. **Allergies by allergen,
with names** (Ellen's ink): now that allergens are a list, a Sensitive-gated page groups people
by allergen with their severity, anaphylaxis first, for the cook and the nurse; the no-names
tally stays for the kitchen door. **Buddies are many-to-many** (call, 3:01 pm): the database
always allowed it; the two "already has a buddy" confirms are gone, because the board shows
every pairing and each volunteer's count, and the buddy sheet prints one page per pairing so a
sheet can travel with the camper. **Lodging facts** (call, 2:52–2:54 pm): the nurse's room holds
one family (capacity 2 plus young children, noted); the RV sites already carried their amperage.

**Item 8, "a recant re-flags" — finding, not a fix.** The six family agreements are signed once
per person with a date, and the site offers no way to un-tick one afterwards; a recant arrives by
email. So there is nothing to test, and the mechanism for it is the hold above: a registrar puts
the registration back in front of a reviewer with the reason. (The Creed on the volunteer
application is different — it is asked on every edit and the Volunteers page flags an
unaffirmed one, as 0062 built it.)

## 2026-10-16, night — Support details before submit; allergens as a list (0097)

Build plan items 1 and 2. **A camper's support and medical details are collected in the
registration wizard, before submit** (Larry and Ellen's ink, 15 Oct; Larry on the call:
"that's correct"; Lawrence: "in the wizard — details are required before submit"). From 24
August the wizard asked no medical questions and the details form on the dashboard was
optional, which left staff planning support, meals and medical cover from forms that arrived
the week of camp or never. Now card 4 asks per person; for a camper the marked boxes, the
three safety yes/no questions and an emergency contact are required, with "N/A" accepted in
any box and no "nothing to report" tick (Lawrence, 16 Oct: the point is that somebody looked).
Volunteers and other adults keep the short version. The server applies the same rule, so a
stale tab cannot skip it, and writes `person_support` after the people exist. The dashboard
form stays for edits and for the photo, which is still urged rather than blocked. One
component and one rules module serve both forms, so they cannot drift apart.

**Allergens are a fixed tick list** (the call, 3:02 pm): eight major food allergens, sesame,
latex, insect stings, medications, synthetic food dyes (Lawrence's question, kept), and
"other" with a box. Stored as a list the database checks, so the kitchen list counts "peanut"
once however families spell it, and the buddy sheet, the Dietary page, the person page and
Recent Changes print the same words. One severity per person, as before. **Existing rows are
not backfilled**: guessing codes out of free text would put words in a family's mouth on a
list a kitchen cooks from, so the old text shows as "Other: ..." until the family saves again,
and the form tells them why they are being asked to tick.

## 2026-10-16, evening — Due date, discounts and the deposit waiver become settings (0096)

Build plan items 3, 4 and 5. **The balance is due July 1** for both camp weeks — Larry: "we
publish July 1 as the due date", knowing the policy is not enforced — so the due date is now a
date on the event, edited on Setup, and the fourteen-days-before rule from 30 September is gone
from both the SQL and the JavaScript. Every sentence that said "two weeks before camp starts" now
just gives the date. **The family discount and the both-weeks volunteer discount are event
settings** read by the same recalc functions, because Larry's 2027 numbers are still being worked
out and "probably bigger than $50" must not wait on a code change; saving them re-applies both to
everyone already registered, which is what a rule recomputed from stored facts should do. **A
registrar may waive the deposit** with one click: each fee-paying person is granted a scholarship
of the per-person deposit (Larry's "we can grant you a $50 scholarship and that goes towards the
deposit"), the registration records who and why, review treats it as deposit-received, and the
approve guard steps aside. Awaiting review gains a *No deposit yet* filter so those families are
worked as a group.

## 2026-10-16, afternoon — Lawrence's answers to the build plan's questions

Program leaders see **flags only** ("less is more"; revisit if they need more) and become a **Staff
& Access preset**, held to two-factor like every staff login. The support and medical details are
asked **inside the registration wizard**, before submit. The deposit waiver is a **$50 scholarship**
granted after submission. The allergen checklist starts with the FDA's nine major allergens plus
latex, insect stings, medications and **synthetic food dyes**, then "Other". "Current" means two
weeks after an event ends, **on every staff page alike, with one shared event filter** — pills for
current events, a search box for the archive, the 25 August design, extended to the pages that grew
their own. The horseback waiver text Larry sent is incomplete (it stops inside the disclaimer) and is
not entered until whole. Resend's nonprofit approval came the same afternoon; the account is on its
first paid tier, with Mailchimp still carrying the newsletter for now.

## 2026-10-16 — The whole staff-questions document, read through by Lawrence and Larry

Recorded by Granola; summary and transcript filed under *Testing notes*. The decisions, in the
document's order, are transcribed into `Luke14-Staff-Questions.md` §3 (16 October), and every
build they imply is in `Luke14-Build-Plan-2026-10-16.md` with an order and a size. The ones that
change the model: **support and medical details are required before a registration submits**
("N/A" accepted, no checkbox); **allergens become a checklist** with an "Other" box, so the
kitchen list and buddy sheet can name people by allergen and severity; **the balance is due July 1**
for both weeks, a published date rather than an enforced one, replacing the two-weeks-before rule;
**prices and the two discounts become Setup settings** so Larry's 2027 numbers never wait on code;
**a family submits without the deposit**, approval waits on it, a registrar may waive it by granting
the $50; **a reviewer puts a hold on from Recent Changes**, and only a role change flips a person
automatically; **two volunteers may share a camper and one volunteer several campers**, with the
volunteers covering their own shifts; **an event is current for two weeks after it ends**, then
archived behind a toggle; **Week 1 and Week 2 only at launch**, the Retreat switched off;
**bookkeeping is QuickBooks Online**, exports native or CSV; **data retention has no policy and
that is the policy** until one is written; **the refund rule stands** and the people who may issue
one are those with payments write. Settled for good: the Campsite contract, the invitation flow for
background checks, address lookup (leave as built), parent and guardian as one role, Stripe's
second administrator, the Carson Springs room facts (Lodge 101–102 accessible; nurse's room one
family; 11 RV sites, 6 at 30 A and 5 at 50 A). Still waiting on people: the buddy sheet (Katie
and Ellen), what a program leader sees (Larry), the newsletter numbers (Ellen), who monitors the
shared mailbox (a call), fee covers (David), Larry's prices.

**Larry and Ellen's read-through of the staff questions, inked, 15 October** (the ink is kept as
`00 Comments and Critiques\Testing notes\2026-10-15 - Larry & Ellen - Staff Questions annotated.pdf`;
transcribed into `Luke14-Staff-Questions.md` §3). Decided: reminder emails are automatic (wording and
schedule to come from Katie and Ellen); the Campsite contract carries no expected charge; volunteer
applications are reviewed by whoever manages registration; support and medical details are due at
initial registration; two buddies may be paired with one camper, so the board's confirm-prompt stays a
prompt; the kitchen list must name people with their severity (three peanut allergies may be two
contact-tolerant and one anaphylactic); a registrar initiates re-review by hand, and a hold follows
several failed payments; parent and guardian stay one role; the two-caregiver model is right;
**background checks are annual, Basic Plus** (migration `0095`: a check is current for 12 months,
was 36); returning registrants keep their details; events should rise to the top by date and be
archivable at the year's turn; fee covers and giving funds go to David through Larry; **bookkeeping is
QuickBooks**, Mailchimp holds contact information for now; a periodic export to the newsletter list is
fine; and the Retreat banner is top-aligned (Lawrence, from two screenshots). Each build item is on
DO-THIS-NEXT as W52.

**The domain moves to Cloudflare Registrar on launch day, not before** (Lawrence, 16 Oct). The
transfer changes the nameservers, and that is the change the launch makes anyway, so the two
happen in one watched DNS session; at cost, on the existing Cloudflare account under `admin@`.
The saving over Squarespace is two or three dollars a year; the reason is one vendor fewer. Vercel's
"free domain with Pro" is declined: a second name on an auto-renewing card, for nothing. The step
list, mail records first, is DO-THIS-NEXT W51.

**The render scripts refuse to overwrite a PDF somebody has written on.** The inked staff questions
were overwritten by a render an hour after the read-through and recovered from SharePoint's version
history. `render.py` and `render_checklist.py` now stamp each PDF they write and keep, rather than
replace, any PDF modified by hand since; `--force` overrides once the ink has been copied to Testing
notes under a dated name.

**The rule of thumb for access: default to read, grant write by name.** Lawrence, 15 Oct, for
the access-model plan and for any question before it is built: when it is not obvious what a
role or a person should have, they read; write is added for a named person when the job needs
it, and the grant is logged. The plan's tables are read under that rule.

**Screening is the administrator's, and the screening page tells the truth.** Read and write of
the background-check record — ordering, importing, the verdict — sit with administrators; every
other staff member sees on file / current / verdict. The page had said "nobody is due" above a
list of eleven people it could not order, each "no email on file": none of the fifteen volunteers
carries an email of their own, every household does, so the household address (and phone, for
Checkr's SMS template) stands in and the row says so. The Checkr export can be chosen as a file
as well as pasted; the file is read in the browser and never stored. And the one button that
matters -- download the bulk file and record the batch as sent -- had never once succeeded:
0029's check constraint demanded a Checkr candidate id on any row past not_started, which the
file flow cannot have until the export comes back. Migration `0093` lets the invited email stand
as the match, which is what the import matches on. Larry recalls SSNs being
entered by hand for the recent checks — a staff question for Ellen, because if that is the
process, the page's instructions and the no-SSN rule need re-examining before go-live.

**Background checks are for adults only, and a date of birth must be real** (migration `0094`).
A volunteer was on file as born 0014-02-24 — a two-digit year typed into a date box — so every
age check read a child as an adult and queued a background check for her. Three layers now refuse
a date before 1900 or after today: the date boxes carry min and max, every server action that
writes a date of birth says "not a real date of birth — check the year (four digits)" in words,
and a trigger on `people` refuses it from any path. It deliberately does not guess: "14" could
be 2014 or 1914, and "65" two plausible adults. A volunteer under 18 shows *Under 18 — not
screened* and is not counted as missing a background check, on the page, on the Buddy board or on
the sidebar; Checkr does not screen minors and 0056 refuses to order for them.

**Two people on one email address.** A couple on the household address each get their own row in
Checkr's bulk file and their own invitation, to the same inbox; the screening row says so. On
import, an address invited for more than one person is settled by the name on the row or listed
for a human — it used to attach to whichever person was last in the lookup.

**A sent batch can be downloaded again, or taken back.** Re-download rebuilds the same file from
the addresses invited and changes nothing; *Mark as not sent* returns rows still "invited" to
never checked and is logged per person, for a press on the wrong day or a file that never reached
Checkr. The first bot batch (11 people, 15 Oct) was taken back the same day.

**Staff idle logout is an hour, not fifteen minutes** (Lawrence, 15 Oct). Staff were being logged
out mid-task; the two-minute warning stays, and families stay at thirty.

**Refunds stay on the registration page.** Asked whether money should live only under Event
Payments: a refund goes back against one payment, and the registration page is the one place
that shows the payment, the person and the event it belongs to. Event Payments is the list across
families and links in. Kept where it is.

**Smaller rulings the same day.** The scholarship request's explanation is no longer labelled
optional and no longer blocks the form: the form says that no details usually means no
scholarship, and the reviewer sees an empty statement for what it is. The Buddy Assignments badge
counted every non-volunteer (parents and caregivers included) while the board counts campers and
siblings, so the nav said 19 against 4 + 7; the badge now counts what the board counts. A
dropdown beside a pill saying the same word ("mild allergy [Mild ▾]") is now one control: the
dropdown wears the pill's colours, on Dietary & Allergies and on each person's status. The
bottom card of the registration page has a title and folds like the others. Giving's summary
cards say what period they cover (all time unless From/To is set); Newsletter no longer counts
the opted-out; Medical & Support links to Check-In where a medical contact is missing.

**A defect, not a decision, recorded because of its lesson.** Search (`/admin/search`, 14 Oct) had
never returned a result: the `people → households` embed has two paths since `0037`, PostgREST
refused it (PGRST201), and the page logged the error and showed "Nothing matches". Two rules
restated: name the foreign key on any people↔households embed, and a query error is thrown, never
rendered as an empty list.

## 2026-10-18 — Scholarship decisions, review rows and family write guards (0102, 0103, 0105)

**Deciding a scholarship is a family act** (`0102`): it needs Payments write *and* Registration
write. Finance (Payments write, Registration read) records money but does not decide. The same
rule covers a hand-set discount and a deposit waiver. **`registration_review` is money** (`0103`):
it returns rows only to Payments read and stays a definer view, with its own `where`. `0098` had
recreated it without one, and any family could read every registration's flags. Publishing
buddies or rooms goes through `set_event_publication()`.

**What a family may write is now written down in triggers** (`0105`, from the audit's database
pass, each hole proven on a rolled-back transaction first). A family cannot join another
household, set staff columns on a registration, register for an unpublished, closed or archived
event, move a registration to another household, edit staff decisions on scholarships,
volunteer applications or cancellations, or point a person at someone else's login. A trap
recorded for the next person: **a `SECURITY DEFINER` trigger sees `current_user` as its owner**, so
the guards were silent until the harness caught it. They are invoker functions.

## 2026-10-18 — Staff access needs a code-verified session; a week's remembered browser; a yearly password (0104, 0106)

A stolen staff password used directly against the API used to be enough: the code step lived only
in the pages. Now `is_staff()`, `is_admin()`, `has_grant()`, `leads_program()` and the doctor's
dated access all require `session_is_strong()`. That means a session that entered a code (`aal2`),
or one the database registered from a remembered browser (`mark_session_trusted()`). With a
password alone the person is a signed-in family member with no household.

Lawrence's choices the same evening: **a remembered browser lasts 30 days for families and 7 for
staff, program leaders and the doctor**, enforced in the database; **staff change their password
once a year**, dated from `profiles.password_changed_at`. Resetting someone's two-factor moved from
an edge function into `admin_reset_mfa()`: it needs a code-verified session, refuses your own
account and is logged. For anyone probing the live database by hand, a staff persona's claims
need `"aal":"aal2"` or it sees nothing.

## 2026-10-18 — The security audit's fixes (0107)

Three audits ran on 18 Oct (code, database, policies; DO-THIS-NEXT W57). Fixed the same night,
each proven:

- **Money.** A refund could be paid twice on a double click. The row is now reserved before Stripe
  is called, the guard locks the payment row, each refund form carries a one-time key, and Stripe
  gets an idempotency key. Fee cover is capped across refunds. The refund webhook fills the
  reserved row and splits a dashboard refund into refund and fee cover. A payment never moves back
  to *processing* once received, refunded or failed, whatever order Stripe's events arrive in.
- **Access.** `can(staff, 'decide:scholarships')` had always returned false: the read/write split
  caught the colon first. No administrator could set a scholarship (Script 5, 13.4). The access
  log never had a select grant, so Access changes always failed. Families who turned two-factor on
  were only held to it on four paths. The rule now covers every signed-in page and every server
  action.
- **The browser.** Security headers (no framing, nosniff, a referrer policy, a permissions policy)
  and a content security policy in report-only mode until a test round shows no reports. The
  `?next=` check refuses control characters and backslashes. Every CSV cell starting `= + - @` is
  prefixed so Excel shows it as text. Gifts over $50,000 are refused online, and the giving form
  has the *I am human* check. Analytics no longer report staff or family pages. Next.js went to
  16.3.8, a patch release.

Left for go-live (W57): Supabase auth settings (leaked-password check, length, redirect list,
point-in-time recovery), the live Stripe key in Production only, rate limits on the contact and
giving forms (Vercel firewall), DMARC reporting, and enforcing the content security policy.

## 2026-10-18, night — Lawrence's answers: the nurse's number, the whole deposit, duplicates (0109)

- **The camp's medical contact is for the people at that event.** It lived on `events`, which
  anyone can read for a published event through the public API. It is now
  `event_medical_contacts`, read by staff, an active leader at the event, or a household with
  someone registered and not cancelled. Those families see it on their dashboard.
- **"Deposit received" means the whole deposit**: $50 per fee-paying person, or a waiver. A part
  payment reads *No full deposit yet* and keeps the *Deposit short* flag. Two test registrations
  changed class.
- **Staff "Add a person" offers a possible duplicate** (same first and last name in the household,
  unless both dates of birth are known and differ) instead of creating a second person.
- **A failing payment plan is not held automatically.** Lawrence was unsure; the default stands,
  as recommended: three failed tries stop the plan and email staff and family, and a reviewer
  holds the registration by hand when it warrants. It is in Staff Questions §1.1 for Larry.

## 2026-10-20 — The adversarial audit: nobody outside can move money; the insider paths close (0110, 0111)

Lawrence asked for a "think like a hacker" round after a talk: unconventional use, injection in the
login fields, and above all whether anyone, malicious or careless, could reach real money. Three
testers worked from the database and the code (the captcha was on, so no screens); each finding
had to be proven on a rolled-back probe, a response code, or a line plus the input that breaks it.

**What held.** Every cross-family read and write was refused. A staff password alone reaches
nothing. Every webhook refuses unsigned input. Amounts are computed on the server. The refund
guards from `0107` refused over-refunds by a cent, duplicate submits, refunds of failed payments.

**What a family could tilt, now closed (`0111`).** The discount rules could be run by anyone on
anyone's registration (deterministic, but the caller chose when); the "both weeks" volunteer
discount counted a volunteer the family had named before staff approved one; a declined
scholarship request could be re-opened. Now the rules run for staff, the family's own registration
or a server-side caller; the volunteer discount needs confirmed volunteer rows; a decided request
stays decided.

**What an insider could do through the API with no screen and no log, now closed.** Cancel a
succeeded Stripe refund (the money had gone; the balance forgot it); rewrite a refund's amount;
move a payment to another family; insert a payment plan naming another family's saved card, which
the daily charger would have charged; set a scholarship above the fee; write coupons. Refund rows
are now edited only while pending and their money never changes; a payment with a refund stays
put; plans come only from Stripe's webhook; the cap is in the database; coupons have no signed-in
writer until a screen exists; and `money_change_log` records every write to payments, refunds,
plans and coupons with who made it. **The principle:** a right the screens never use is still a
right, and it gets a guard and a log like any other.

**Two defects found on the way.** A card payment refunded in full stayed "received" (the staff
client may not update card rows, so the flip silently did nothing): payments.status now follows
the refunds on file for every writer. Staff without Payments read saw "$0 paid" on every family
and were told to confirm twice: `registration_paid_cents()` answers the deposit question for any
staff member, and the review and roster pages show money only to Payments read.

**Smaller.** Gifts never move back from received, and a gift refunded in full is marked so. A
checkout page expires after 30 minutes (two tabs could both be paid). The sign-up form no longer
says whether an address has an account. A household with people can never be self-claimed
(`0110`). The login-email change speaks in our own words.

**Not built, recorded.** `stripe-plans-webhook` runs without its signing secret on the test
project, so it refuses everything: expected until `PAYMENT-PLANS-SETUP.md` is done, and now on the
go-live list beside the refund webhook. The content security policy stays report-only until a
clean test round. The firewall rate limit on the contact and giving forms is set in Vercel's
dashboard (the API refuses a project with no saved configuration).

## 2026-10-20, late — A grant is not a request (0112); the rate limit is on

The screen test of the new Script 5 items found the one thing the database probes could not: a
$1 scholarship granted by staff to a person whose family had never asked turned the registration
into *Full scholarship requested*, which approves without a deposit. The review view had read a
scholarship row with no requested amount as a request for everything owed. A requested row now
counts what was asked for; a granted row counts what was granted; nothing else counts.

The contact and giving forms are rate-limited at Vercel's edge, five posts a minute per address,
the floor under a Turnstile that fails open. Set in the dashboard (the API refuses a project with
no saved configuration) and proven: the sixth post in a minute is refused.

## 2026-10-21 — The privilege sweep: the matrix, and what it moved (0113)

The third tester did what nobody had: enumerated every table, policy, grant and function, then
built an empirical matrix of what ten kinds of person (anonymous; two families; a volunteer; a
coordinator, a registrar and an administrator, each with and without a code-verified session)
could actually read, change, add and delete, cell by cell, in rolled-back transactions. The
boundary held: no cross-family read or write anywhere, nothing at all for staff without a code,
anonymous visitors see the public catalogue only. Where the cells disagreed with 0101's mapping,
`0113` moved them:

- **A family's new participant is never born confirmed.** The UPDATE path had been guarded since
  0105; INSERT was not, so a family could add a child already "confirmed" and skip review.
- **Attaching a login to a household is the administrator's**, through the logged, populated-
  household-refusing `admin_link_login_to_household()`; Registration write no longer does it by
  hand. Nothing in the site used that path.
- **Confirming an agreement signature is Registration write**, not any staff member.
- A family cannot stamp its own support row as reviewed, or back-date its submission.
- `message_log` is read-only for staff; the edge functions write it.
- `pay_in_full_amount()` answers for Payments read or your own registration; it had run as owner
  for any staff member and so leaked a family's real balance to staff who may not see payments.
- Six helper functions are no longer callable by anonymous visitors.

**A question the sweep raised, for Lawrence (Staff Questions §1.1).** Every active staff member
can read the money columns on the participants table and the balance views, whatever their
Payments grant; a coordinator sees fees and scholarships, and a "paid" figure of $0 because the
payments themselves are hidden. 0101 says an operations helper sees no money. Hiding those
columns from staff without Payments read is a column-level change on the busiest table; the
pages already show "—" to them. Left as it is until he answers.

**Advisors.** Beyond the three accepted definer views, the security advisor lists only generic
"definer function callable" notes and the leaked-password switch (W20, Lawrence's). The
performance advisor's four per-row `auth.uid()` policies are fixed; the 60 unindexed foreign
keys and 11 unused indexes wait for real traffic to say which matter.

## 2026-10-21 — Staff money columns stay where they are; a Supabase deadline that needs nothing

**Lawrence, on the sweep's question:** a rewrite is fine if it is the best long-run answer, and
leaving it is fine if the current state is secure. It is secure where it counts: nobody can move
money, and nobody reaches children's data they should not. What remains is that a staff member
without Payments read (today, only the Operations helper preset) could read fee and scholarship
amounts through the API, though every page shows them "—". The clean fix, a separate money
table with its own rules, touches every page that prints a fee; CLAUDE.md says no architectural
rewrites in October, and this is one. **Decided: leave it, revisit after launch.** Written down so
the next audit does not re-find it.

**Supabase's 30 October change** (new tables in `public` no longer get Data API grants
automatically) needs nothing here. Every migration since the first has granted explicitly, and
the one table without a grant, `mfa_trusted_sessions`, is reached only through its functions by
design. CLAUDE.md's first trap already says it; the date is now on it.

## 2026-10-21 — Staff & Access: one Administrator tick, no role radios

Lawrence, looking at the page: three role radios (Registrar, Coordinator, Administrator) beside
five presets read as two competing ways to set access. Since `0101` the grants are the access and
the role column means one thing, administrator. The page now says so: one **Administrator** tick
per row and the grants panel; the Need-to-know column, which repeated the grants summary, is
gone; adding a staff member asks only whether they are an administrator, and the preset is
applied on the row that appears. The role column keeps a harmless label for everyone else.

## 2026-10-21, overnight — A person's money gets its own table (0114)

Lawrence, on the sweep's finding that any staff member could read fees and scholarships whatever
their Payments grant: "a big rewrite is ok if best, long run." It is the best long-run answer, so
it was built overnight on the branch `money-table` for his review in the morning, not merged.

**What changed.** The six money columns leave `registration_participants` for
`participant_money`, one row per participant, with one rule: readable by the family it belongs to
and by Payments read, written by nobody who is signed in. The fee is filled by a trigger from the
event option, and re-copied when the option changes (refused if the new fee is below what has
already been granted: a decision is never erased silently). Staff decisions go through one
function, `set_participant_adjustments()`, which needs Payments and Registration write, caps at the
fee, writes the discount reason verbatim, logs to the money log and re-runs the family and early
discount rules. The balances view joins the new table, so a staffer without Payments read now gets
no row at all, and every page that read a fee reads the embed instead — 26 files, built by three
builders against one written contract, with every SQL suite green on a fresh local build.

**Why a table and not column privileges.** Postgres column grants are per role, not per person;
there is one signed-in role. Row-level rules are the only per-person rules the database has, and
rows are what a table gives. The old columns were also the busiest thing in the schema to reason
about: the 0105 and 0111 guards existed to stop families and insiders writing them. With no
signed-in writer at all, those branches are gone.

## 2026-10-21 — Stripe library 22 → 23, Dependabot's first pull request

Reviewed before merging: the breaking changes are to Node 18 (we build on 24), to Payment Intent
parameters the site does not use (it uses Checkout Sessions and Refunds), to V2 money-management
types, and to a webhook helper the edge functions never called; the pinned API version moves to
Stripe's 2026-09-30 release, and the fields the site reads from a session and a refund (`url`,
`id`, `status`) are unchanged. Lint and build pass. Taken on main rather than through the pull
request, which Dependabot closes itself. The edge functions import Stripe separately (Deno) and
are untouched. The other open Dependabot requests, Tailwind 4 and ESLint 10, are major rewrites
of tooling and wait for a quiet week.

## 2026-10-21 — ESLint 10, with npm's peer check switched off

ESLint 9.39 → 10.13 with `eslint-config-next` 16.4.2 (whose typescript-eslint accepts ESLint 10; the
16.3.8 preset crashed with `scopeManager.addGlobals is not a function`) and `typescript` 6 listed as
a devDependency. Two plugins the preset pulls in, `eslint-plugin-import` 2.32 and
`eslint-plugin-jsx-a11y` 6.10, declare a peer range that stops at ESLint 9, so `npm ci` refuses;
`.npmrc` sets `legacy-peer-deps=true`, which installs what the lock file says and stops npm checking
peer ranges for every package. Accepted because both plugins were proved to run under 10
(`import/no-anonymous-default-export`, `jsx-a11y/alt-text` and `react-hooks/rules-of-hooks` fire on
a throwaway file), lint is 0 errors with the same nine warnings, the site builds, and the linter
never ships to anyone. The line goes the day the two plugins publish ESLint 10 support. Supersedes
Dependabot's pull request 4.

## 2026-10-21 — Tailwind CSS 3 → 4 (W58)

Taken on a branch with the official codemod (`npx @tailwindcss/upgrade`, 114 files) plus hand fixes:
26 bare `rounded` inside template literals the codemod skips, `@source '../lib'` (the 31 August
lesson: helpers in `lib/` return class names), and three compatibility rules from the upgrade guide
in `@layer base` (bare `border` stays gray-200, placeholders gray-400, buttons keep the pointer).
The brand colours and font stacks are `@theme` tokens in `app/globals.css`; `tailwind.config.js` and
`autoprefixer` are gone. Proof: 82 full-page screenshots of every page per persona, shot on
Tailwind 3 the same morning, pixel-diffed against the same pages on the branch — 55 identical;
the remaining 27 are explained to the pixel (two by test data, six by date inputs 2px shorter
under v4's cross-browser normalisation, the rest by v4's OKLCH palette shades and sub-pixel text at
under 1.5%). Four v4 behaviour changes were pinned back to the look staff approved: `leading-*`
now wins over `sm:text-*` (five headings), small pills under `text-sm` inherit a proportional
line-height (`leading-5` added), the admin search box is transparent (`bg-white`), and the native
file-picker button on Screening lost its border (`file:` utilities). Accepted, not pinned: the
palette shades (red-600 is #e7000b, was #dc2626 — pinning per shade is a hack a volunteer would
not understand; the brand colours are unchanged) and the date inputs. A 35-screen functional
walk with the bot accounts passed; the security re-check found no logic change, no new package
outside Tailwind's own tree, four fewer audit advisories, headers unchanged and the CSP untouched
(v4's `@property` rules live in the stylesheet file). The reason to take it now: a CSS-first
config a volunteer can read, a faster build, and Dependabot stops proposing it every Monday.

## 2026-10-21 — The "Administrator" preset becomes "Every area, read and write"

On Staff & Access the column tick *Administrator* is one power — granting, accounts, naming a
leader, the doctor's dated access — and the preset of the same name was nine areas at write plus
that tick. One word, two meanings, and the preset quietly set the tick. Lawrence asked whether to
rename the tick ("Super Admin") or drop the preset. Neither: a "super" admin implies a ladder that
does not exist, and dropping the preset makes an administrator a tick plus nine hand-set grants.
The preset is now **Every area, read and write** and **no preset touches the administrator tick or
the role column** (applying *Registration & coordination* to an administrator used to take the power
away). The column reads *Administrator — grants access*. Two independent facts per person: which
areas, and whether they can grant. Resetting someone's two-factor stays administrator-only, in the
database (`admin_reset_mfa`: `is_admin()`, a code entered just now, never your own) and the app.

## 2026-10-21 — The Horseback Riding Waiver, and the first agreement tied to an activity

Horseback riding is run by the camp itself, with horses brought by friends as volunteers — no
outfitter, no form of theirs to link to (0041 left that open). So the waiver is the ministry's own,
one paragraph the length of the Emergency Consent: a warning that tracks T.C.A. § 44-20-103 (the
section that protects an equine activity *sponsor*; the sign wording § 44-20-105 mandates names
only paid professionals, and we use none — checked against the Tennessee Code on 21 October, enacted
1992, never amended), the horse risks, a release including ordinary negligence, the rules, and a line
that the Emergency Consent and Hold Harmless already signed apply. It is signed per rider on the
Activities page, with the same three signer roles as the wizard, through the schema's unused
per-activity hook (`agreement_requirements.activity_id`, 0001 §13) — `0116`. Larry's feedback
becomes version 2. Named parties are avoided on purpose (the horses' owners and the grounds are
classes), so the text does not change when the people do. Known to the attorney: Tennessee does
not enforce a parent's pre-injury release of a minor's own claim (*Childress*, 1989; *Blackwell*,
2017); the statute's inherent-risk bar and insurance are the real protection for a child's claim.
Follow-ups, not built: a Setup screen for per-activity requirements (`create_event()` copies
event-scoped rows only); a staff "verified" mark and staff upload for outfitter confirmations.

## 2026-10-21 — Activity waivers are set up on the Activities page, and a copied event keeps them

Lawrence: staff should set an activity's waiver without a migration. The editor on the staff
Activities page now asks one question with three answers — none, the outside provider's own form
(the provider name and link moved under that answer), or our own waiver signed on the site — because
the provider fields and the ministry's waiver were two different places on the form and read as two
different questions. A waiver is reused from another activity at its current version (next year's
horseback activity, one click) or written there in plain text with `{{event}}` allowed. **New text
is version n+1 of the same key, never an edit in place** (25 Aug: a signature belongs to the words
on the screen when it was given). Only the edited activity moves to the new version; the others on
the key are listed in the confirm and left alone, and the old version is retired only once nothing
points at it — the family page refuses to show a retired version, so retiring it under the other
camp week would have let riders sign up with no waiver. `admin_create_event()` takes the newest
*active* version of a key, so a copied event gets the revised text either way. Taking a waiver off
an activity deletes its requirement row and nothing else. `0117` also fixes the copy itself: 0083
filtered requirements on `event_id`, which an activity-scoped row never has, so no activity waiver
was ever copied; the harness now proves one is.

## 2026-10-22 — A volunteer's short support form; the volunteer application checked on the server

Website Feedback list rows 9, 13 and 17. **A non-camper's short support form now asks rescue
medication and sleep away from home** beside allergies, diet and the emergency contact: the
allergy hint sends everyone to "rescue medication below", and an EpiPen matters whoever carries
it. Their "Tell us more" no longer asks *A hard day* ("Every camper has one") or *Will a caregiver
be attending?* -- both are about campers; anyone with answers there keeps seeing them, as with the
About questions (16 Oct). Nothing a non-camper's form hides is required. The camper's form is
unchanged. **The volunteer application's required answers are refused by the server too**, in the
browser's words, from one rule (`volunteerApplicationProblem()`, `lib/volunteer.js`); until today
only the browser checked. Katie's tick *This is my first time serving in disability ministry*
(row 8) is **not built**: `volunteer_applications` has no jsonb answers column, so it needs a new
column, and that waits on a decision.

## 2026-10-22 — An activity's times must fall within its event

Lawrence, after the 22 Oct bot run found Week 1's only Salon sitting dated 15 July, four days
before the week. The Activities page had only warned since 25 August, so that an arrival-evening
sitting could be set. **Now it is a rule**, from the event's first day (or the volunteers' arrival
day, `events.volunteer_arrives_on`, when earlier) to its last day, held three times in one
sentence: the date inputs' min/max with the range written under them, the server action
(`createSlot` / `generateSlots`), and a trigger on `activity_slots` (`0119`). Asked on insert and
when a slot's day or activity changes, **not when an event's dates move**. Existing rows are not
rewritten: staff fix the Salon sitting on the Activities page, which marks any time outside the
event's days.

## 2026-10-22 — A waiver added after people signed up: a flag, an ask, and a staff-pressed email

Lawrence: an activity can be added, families sign people up, and staff attach a waiver (ours, or
an outside provider's link) later — and nobody already signed up was told. **One answer now says
what is outstanding:** the `activity_waivers_outstanding` view (`0120`), one row per active signup
missing our waiver (no signature of the activity's required agreement *version* on that
registration) or the provider's uploaded confirmation. It is **security invoker**: the tables'
own RLS already gives a family its own rows and staff every row, so it needs no `where` of its own
(unlike the three definer views). Keyed on the version, a revised waiver asks people already
signed up to sign the new text too; the editor's confirm now says so.

**A flag, not a status change.** Awaiting review gains a *Waiver outstanding* tab that lists
confirmed registrations too, and the registration page shows an amber line per waiver — but no
status moves. A confirmed place is not undone for paperwork: sending a family back to *submitted*
would drop them from rosters and counts for something staff chase by email, and the place was
given fairly when it was given. The family is asked where they will see it — an amber card on the
dashboard and an amber line with the signing box (or above the upload box) on the Activities page;
signing there writes only the signature (`signActivityWaiver`, sharing `setActivityChoice`'s
checks).

**Email is staff-pressed, never automatic.** Nothing emails families because an activity was saved:
a typo fixed in a description must not reach forty inboxes, and a waiver attached by mistake and
removed a minute later must not either. Instead the editor, after a save that puts a waiver or a
provider on an activity with people already signed up, says how many need it and links to
`/admin/email-families` with everything chosen and a suggested message; a person with Registration
write reads the preview ("This goes to N families (M people)" and the exact text) and confirms.
The same page sends any update to the families of an event or one activity. One email per
household, to the household email; households without one are listed, not guessed at. Each send
is logged to `message_log` through `log_family_email()` — a definer function, Registration write,
two template keys, stamped `sent_by` — rather than reopening INSERT on the table `0113` made
read-only.

## 2026-10-22 — A stopped payment plan: name the family, log every email, flag it for staff

Lawrence, four decisions on one evening.

**The staff alert names the family.** When a plan stopped after three failed payments, staff were
told about "registration `<uuid>`" — nobody could act on it without a database lookup. The alert's
subject is now *[Payment plans] Plan stopped — <household> — <event>*, and its body carries what
was owed this time, the remaining balance (the figure the registration page shows,
`registration_balances` via `settledBalance()`), the household's email and phone so staff can call,
and an *Open the registration* button to `/admin/registrations/<id>/`. The completed-plan-reopened
and deposit-failed alerts carry the same block. The family's own emails keep their wording, with a
"Hello <household>," line, and fall back to the household email when Stripe has none on the
customer.

**Every plan email is logged.** `message_log` (`0001`) exists so the ministry can say "we told you
on the first" from a record; the plan emails never wrote to it. `sendEmail()` in
`supabase/functions/_shared/plans.ts` now returns `{ok, id, error}` and writes one row per email,
sent or failed, with Resend's id — `plan_receipt`, `plan_payment_problem`, `plan_stopped_family`
(the out-of-tries notice is its own key: "the plan stopped" is a different claim from "a payment
failed"), `plan_stopped_staff`, `plan_reopened_staff`, `plan_deposit_failed_staff`. Logging is in
that one place, and a logging failure is printed and never stops a charge being recorded. The
edge functions insert as service_role; `log_family_email()` stays the staff path. `template_key` has
no check constraint, so `0121` only grants service_role SELECT and INSERT (named, as every money
table since `0006`) and refuses to apply if a constraint has appeared. Found on the way:
`settledBalance()` and the charger read a failed balance query as $0 owed, which could close a
plan; both now throw.

**A "Plan stopped" flag, built like *Waiver outstanding*.** Awaiting review gains a *Plan stopped
(N)* tab — registrations whose plan is `failed` (not paused by staff), confirmed ones included,
nobody's status changed; the Overview a red card linking to it; the plan card a red line, "This
plan stopped after 3 failed payments on <date>" (the third try, `planStoppedAt()`). Plans are money,
so all three need Payments read — which is exactly what `payment_plans_select` asks since `0101` —
and read with the staff member's own client, not a definer view. The question whether a stopped
plan should also put the registration on hold stays with Larry (Staff Questions §1.1).

**Ways to pay says bank costs the camp less.** Bank account was already first and the default; the
card-only note becomes one line under the choice, whichever is picked: "Paying from your bank
account costs the camp less in processing fees than a card." No dollar figure — the fee varies and a
number would date — and no amount changes.

## 2026-10-22 — The both-weeks discount is for volunteers only

Lawrence: only **volunteers**, **confirmed by staff**, registered as a volunteer **for both weeks**
get the multi-week discount; a camper attending both weeks gets none. That is what
`recalc_multi_week_discount()` already does (`c_require_vol_both = true`, `c_require_confirmed =
true`), so no code changes; the comment in `0114` that calls it "still with staff" is out of date and,
the migration having run, stays as it is. The amount (leaning 50%) is still Larry's. Staff Questions
§3 records it.

## 2026-10-22 — A returned-bank-payment fee, disclosed first, charged only as disclosed (0123)

Lawrence: when a bank (ACH) debit fails Stripe charges the ministry a fee, and the ministry may pass
a fee on to the family, with notice. Built as an event setting on Setup (`events.returned_payment_fee_cents`,
$0 = off), a `registration_fees` table (household and Payments read; written only through
`record_returned_payment_fee()` as the service role and `add_registration_fee()` /
`waive_registration_fee()` for Payments write; logged in `money_change_log`), and `fees_cents` in
`registration_balances`.

**Bank only.** A card decline costs the ministry nothing, so it adds nothing. The database checks it
too: the fee is recorded only against a *failed bank_transfer* payment row for that PaymentIntent.

**Disclosed before the choice, and only when there is a fee.** Ways to pay (and the dashboard's pay
panel) say "If your bank returns a payment, a $X fee is added to cover what the bank charges us."
beside the bank choice only when the fee is over $0. The plan agreement is page text
(`planConsentText()` in `lib/plans.js`, not an `agreements` row), so it gains the sentence
conditionally (version `plan-consent-v2`; with no fee the words are exactly v1's) — first person,
because the family is the one saying "I authorize". A fee nobody was told about is not one a family
can fairly be charged, and a $0 event should not print a sentence about fees at all.

**Charged only as disclosed — a snapshot (Lawrence's refinement).** The fee the family saw travels in
the Checkout metadata (`returned_fee_cents`) and, for a plan, is stored on
`payment_plans.returned_payment_fee_cents` when the plan activates. The automatic fee uses that
snapshot, never the event's current value: a fee set or raised after a family agreed does not apply
to them, and $0 at agreement means no fee ever for that plan or payment. Staff cannot edit the
snapshot (`guard_payment_plan_writes()` restated).

**Once per failed attempt.** Unique on the PaymentIntent — each plan try and each checkout is its own
PaymentIntent — so a Stripe retry of the same webhook, or the charger and the webhook both seeing
one failure, records one fee; only the writer that added it emails the family.

**Not added to the plan's stored schedule; collected by its remaining charges.** The brief offered
"fees outside the plan". In this code that would be the less simple option: the charger already
works every charge out on the day from the live balance, so a fee in the balance is collected by the
remaining charges with no change to the charger, and `settledBalance()` includes it so a plan never
closes with a fee unpaid. Keeping it outside would need the charger to subtract fees, would let a
plan "complete" with money owed, and would credit a fee the family paid separately to the plan's
principal so they appeared to owe it again. The agreement and the payment-problem email say plainly
that the remaining payments include it. The early-registration rule sets fees aside (a fee must not
cost a family its early discount).

**Review fixes, same day (0123 amended before it ran).** (1) *Only a debit the bank actually
returned.* After a return such as R02 (account closed) Stripe blocks the account and the plan's next
tries fail the moment they are made — each a new PaymentIntent, none of them reaching the bank. The
webhooks now ask Stripe whether the latest charge failed with a failure code
(`bankDebitReturned()`), the charger always says no (a debit cannot come back the moment it is made),
and `record_returned_payment_fee()` refuses without that word; a unique index also allows one
returned-payment fee per installment. One returned debit is one fee. (2) `registration_payment_routes`
asks about the camp (balance less fees), so a $4 fee does not turn a paid-in-full family back into
"not finished" and re-offer payment choices; the fee is its own line. (3) The payments CSV counts
fees as the page does. (4) *Families can read their own whole fee rows* — column grants are per
role, not per person, so the staff columns (who added or waived it, the waiver's reason) cannot be
hidden from the family the row belongs to without a view, and none of them is sensitive. The table
grant stays; the family pages select only kind, amount, date, reason and waived, and the Waive form
says "The family can see this reason." (5) *Waiving is a decision*: `can_decide_scholarships()`
(Payments **and** Registration write, `0102`), like a scholarship or a hand-set discount; adding a fee
stays Payments write.

**Not done:** a failed pay-in-full bank payment with no fee still sends the family no email (as
before); the email is sent when a fee is added. `money_change_log.changed_as` records the logger's
owner for every row, not the writer's role (the logger is security definer since `0111`) —
`changed_by` is the reliable column; left for a separate fix.

## 2026-10-24 — Tell families the site is new, and give them one place to say what is wrong

Lawrence: when the new site goes live, families should be told it is new and asked for feedback.

**A welcome card, once per browser, temporary.** A modal on the family dashboard and at the start of
the family wizard (`components/WelcomeNotice.jsx`). Closing it hides it for that page; only the tick
"Don't show this again" stores `l14_welcome_v1_dismissed` in localStorage, so a family who clicks past
it sees it once more. Per browser rather than per account because it needs no migration and the cost
of being shown it twice is nothing. The key is versioned so a rewritten card can be shown again. It
stops by itself after `WELCOME_NOTICE_UNTIL` in `lib/notices.js` (2027-08-31, after the first camp
season), so nobody has to remember to remove it. A plain overlay like the site's other modals, with
the keyboard handling they lack (focus in, Tab trapped, Escape, focus returned).

**Feedback by email, not a table.** "Send us feedback" at the foot of the dashboard sends one email to
the published info@ address (Reply-To the family), with the page they name, their household and the
browser; nothing is stored, as with the contact form — the shared mailbox is where staff already work.
Signed-in only. **No rate limit:** in memory is not real on a serverless host and the durable place to
check, `message_log`, is not readable by the family; the sign-in requirement (with two-factor) makes
every note attributable, which is limit enough for now. Families only — nothing in the staff area.

## 2026-10-26 — The family wizard's cards fold, and each says what it still needs

Lawrence: every card on `/register/family` should be collapsible and flagged when it is missing
something. **The chip is worked out from the submit's own rules, never a second copy:** one helper
per card (`sessionNeeds()` … `agreementNeeds()` in `FamilyWizard.jsx`, on top of `dobProblem()`,
`emailLooksValid()` and `supportProblems()`) returns what is missing, and `handleSubmit` walks the
same lists — hard items refuse, the two soft ones (date of birth, sex) still ask. **A new
registration opens every card** (it is read top to bottom); **editing a saved one opens only the
cards that need something**, decided once from the saved answers so nothing snaps shut while the
family types. Folded bodies are hidden, not unmounted, so no answer or chosen file is lost. A refused
submit opens every card that needs something and moves focus to the one the refusal is about.

## 2026-10-26 — A program leader can download and print their own roster

Lawrence, on `/admin/my-program` as a leader: "need a way to export". **Download CSV**
(`/admin/my-program/export/?grant=<program>:<event>`) and **Print / PDF** (`/admin/my-program/print/`,
the browser's Save as PDF — no PDF library) carry **the page's table and nothing more**: Name, Age (at
camp), Role, Buddy, Ask about (the flag words). Both read only `program_roster` through
`programRosterRows()` in `lib/programs.js`, which the page now uses too, so the three cannot drift.
**The gate is `app/admin/my-program/access.js`**, because a route handler does not run the admin
layout: the caller holds *that* leadership (`getProgramLeadership`) on a strong session
(`session_is_strong()`, the rule `leads_program()` applies, 0106), or is staff with `read:programs`
(whose `can()` already refuses a weak session); a leader asking for another program is refused, never
given their own instead. `getProgramRoster`/`getProgramLeaders` now throw rather than return an empty
list, so a failed read is an error, not "nobody placed yet" or a blank file. In the header a leader
no longer sees "Staff Admin" (their pill says Program Leader) or the badge-colour key (staff
vocabulary); **staff who hold a current leadership** get My Program in the sidebar with the same blue
count, from the layout's existing `getProgramLeadership()` read.

## 2026-10-26 — Activities: one event per card, and the dashboard button opens only its own event

Lawrence (Script 6, 7.1–7.2), a volunteer on the Retreat and both camp weeks with a camper on Week 2,
pressed **Choose activities** on Week 1 and read the page as wrong: the Retreat's outside-provider
block (the Retreat has its own *White water rafting — River outfitter*, seeded `ac71…0101`) looked
like Week 1's, and Week 1 seemed missing. The code did tie each block to its own event; what misled
was the layout — every event stacked under one camper-worded intro, ordered by when the
registration was created, so Week 1 came last, below Week 2's camper cards. Now the dashboard's
button (and the 0120 waiver card) pass `?registration=<id>`; the page matches it against the
household's own registrations (never a lookup by id) and shows that event alone, with **See
activities for all your events**; an unknown or foreign id gives the all-events view. Without it:
current events (`isCurrentEventRow`), by start date, each in its own card. The wording is per card:
camper sentences and the "Put a name down…" encouragement only where there is a camper; a
volunteer-only card says *As a volunteer you go where your camper goes…*. The page's queries now
throw on error instead of reading as "nothing to choose". The staff email's links keep `#reg-<id>`
(the all-events view still has the anchor).

## 2026-10-26 — One shared table that sorts, resizes and searches; "head leader", not "lead"

Lawrence on My Program: column widths adjustable, columns sortable, a search for names. Built once,
as `components/DataTable.jsx` (plain React and CSS, no table library), so the next table that wants
it behaves the same: a header is a real button with `aria-sort`, cycling A→Z, Z→A, original order;
numbers sort as numbers, text naturally and case-blind, blanks last both ways; each header has a
drag handle (arrow keys too, 16 px a step, 60 px minimum) and widths are remembered per table in
localStorage (read through `useSyncExternalStore`; when storage is blocked they last for the visit);
the search ignores case and accents and says *Showing N of M*. The CSV and print view still carry
the whole list, and the page says so. Other staff tables are left as they are until Lawrence picks
which to convert. Same day: every person with a `program_leaders` grant is a **leader** and the one
marked `is_lead` the **head leader** (My Program's line, the print view, the header pill *Program
Leader · Head*, the Programs page's **Make head leader**). Labels only; `is_lead` stays a label.

## 2026-10-26 — Staff accept or reject an outside provider's waiver confirmation

**This supersedes the 21–22 Oct decision of *no* staff "verified" mark for outfitter confirmations**
(the 21 Oct follow-up note above; DO-THIS-NEXT W60, "the family uploads, staff look"). Lawrence
uploaded a random picture as a test and it counted as the confirmation. Now each upload in
`activity_waiver_uploads` carries a review (`0124`): **pending** — shown to staff as *awaiting check*
(blue) and to the family as *Uploaded <date> — camp staff will check it.*; **accepted** (green
*accepted ✓*; the family reads *Accepted by camp staff ✓*); **rejected** with a reason (red
*rejected — <reason>*; the family reads, in amber, *Camp staff couldn't accept this: <reason>.
Please upload the confirmation again.* with the upload box open). A rejected upload is
**outstanding** again in `activity_waivers_outstanding` (restated in full, with `upload_status`
`missing` | `rejected` and `review_note`), so the dashboard card, the review queue's tab, the
registration's amber line and the staff email all ask for it again; pending and accepted are not
outstanding — the family has done their part, and the print sheet's Waiver column shows the three
states so the day still knows what was checked.

**Who reviews: Registration write**, through `review_waiver_upload(upload, status, note)` (definer,
stamps reviewer and time, note required to reject — also a table check). It is the grant the staff
Activities page already uses for the family-facing side (its email-the-families button,
`log_family_email()`) and the one that confirms an agreement signature (`0113`); Activities write is
about running the activity, not a family's paperwork. **Families cannot set the review**: they still
insert and replace their own row (`0087`), so an *invoker* guard trigger (a definer trigger would
see its owner as `current_user`) refuses any direct signed-in change to the review columns — staff
included; the function is the one way — and **resets the review to pending whenever the file
changes** (path, type or upload time), so a new file is never "accepted" by inheritance.

**The audit is the row itself** (`reviewed_by`, `reviewed_at`, `review_note`): `money_change_log` is
money only and `family_change_log` records family edits for staff to check off, neither a staff
paperwork decision. A re-upload clears the last review, so a rejected file's history is not kept —
the file in hand is what matters. Known gap, accepted: a family could overwrite the stored *file*
through the storage API without touching the row (WaiverUpload always rewrites the row, which resets
the review); a deliberate swap after acceptance is not something the ministry needs to defend against.

## 2026-10-26 — A linked caregiver must have a phone number; household cards fold

**Rule (Lawrence):** a person linked as a caregiver for someone (`person_caregivers`) **must** have a
phone number — the link exists so staff can reach that adult at camp. Everyone else's phone is
labelled *Phone (optional)*. One validator, `lib/caregivers.js` (`caregiverPhoneProblem`,
`caregiverLinkProblem`; "a phone" = at least seven digits), used by Manage Household in the browser
and by its server actions, so both sides refuse in the same words: saving a caregiver without one
(*A phone number is required — Ann is a linked caregiver for Sam and Pip.*), and linking someone who
has none (*Add a phone number for Ann first — caregivers must be reachable.*). Only **new** links are
refused; existing rows that break the rule are not rewritten — the card shows *Needs: phone* in amber
and opens. Links are created only on Manage Household (`setCaregivers`); the wizard and the staff
screens create none. The staff person editor (`updatePerson`) refuses only **clearing** a linked
caregiver's number — a caregiver who never had one does not block a staff name fix.

Every person card on Manage Household folds (a real button header with name, age, role chips, status
and chevron), folded by default unless it needs something; folding hides the body and never unmounts
it, so unsaved edits and the unsaved bar survive. *Open all / Fold all* sit above the cards; the
household contact card stays open.

## 2026-10-26 — Activity groups: rafts, a buddy travels with their camper, and a minimum age

Lawrence (W62): white water rafting has 100+ people — campers, their paired buddies, siblings,
parents — to put into rafts, and staff need lists. Decided: groups are **generic** for any activity
(`activity_groups`, `activity_group_members`, migration `0125`; pontoon boats next), sized per group
with a **default of 6**; the outfitter gets **names only** (we set the boats); **anyone signed up**
can go, and **a camper's paired buddy goes with them automatically** — the buddy is shown even if
they did not sign up, and a buddy who also signed up is listed once, in their camper's unit (a buddy
paired with two signed-up campers joins them into one unit; a signed-up buddy whose camper is not
going stands alone). The database stores one row per person (`unique (registration_participant_id,
activity_id)`, `activity_id` kept from the group by trigger, which also refuses a person from another
event); the pairing is the page's (`buildUnits()` in `lib/activityGroups.js`), and the place/unplace
actions work the unit out again from the database. **Minimum age** is `activities.min_age` (8 for
rafting on current events): a red *Under 8 — check with camp staff* pill and a filter, **never a
block**. Capacity is a warning too (red when over). Access is the `activities` area (0101: placements
are Activities, definitions are Setup): read sees the board, write places; no family or leader
access. Deleting a group sends its people back to *To place* rather than refusing. Waivers come from
`activity_waivers_outstanding`; a buddy riding **without** a signup is not in that view (it is built
from signups), so for them alone the loader asks the same two facts (an uploaded confirmation, a
signature of our waiver) — when 0124's upload review lands, that read should skip rejected uploads.
`admin_create_event()` was restated so a copied event keeps `min_age`; groups are not copied.

## 2026-10-26 — Event Payments opens on current events; the QuickBooks CSV is a date range

Event Payments' default scope is `isCurrentEventRow()` (*Current events*), the rule every other staff
page uses, not "90 days each way", which left Camp Celebrate 2027 out of the balances while its
registration is open (Script 6, 13.40). The 90-day windows, one event and full history stay in the
*Showing* select; the page and its Balances and Payments CSVs share `inPaymentsScope()`. The
QuickBooks CSV is about money, not events: From/To on the day the money moved (this month so far by
default, *All time* one link away), across every event, sorted by date, ignoring the page's scope
and payment-state pill. A payment since refunded is included, so its negative refund row is never
booked without the money it reverses.

## 2026-10-26 — Setup: one "Event status" dropdown in place of the Visible and Archived ticks

Lawrence: both boxes could be ticked at once, which "seems odd". Each event row on Setup now has one
**Event status** — Unpublished · Published · Archived — with a one-line hint under it, stored on the
same two columns (`updateEventRegistration` in `app/admin/setup/actions.js`): Unpublished =
`published` false, `archived_at` null; Published = `published` true, `archived_at` null; Archived =
`archived_at` set (kept if already set, else now) **and** `published` false — an archived event is
never on the public site. Choosing either of the others clears the archive mark. A row stored as
both (the Adult Adventure Retreat 2026, today) reads as Archived and is stored archived +
unpublished on its next save; no data is changed outside a save. **No check constraint**: only this
action writes either column (`admin_create_event()` inserts unpublished with no archive mark; no
edge function touches events), and the public pages already refuse an archived event through
`registrationOpen()`, so the mixed row does no harm in the meantime. If a second writer ever
appears, add `check (not (published and archived_at is not null))` after setting `published = false`
where `archived_at is not null`.

## 26 Oct 2026 — Administrator tick sets every area to write; never the reverse

Ticking *Administrator — grants access* on Staff & Access now also sets every area, Giving
included, to write (after a confirm), because an administrator can grant themselves anything
anyway and the ticks should say so. Every area at write does **not** make someone an
administrator, and removing the tick leaves the grants as they are. (Lawrence.)
## 2026-10-26 — Families answer camp staff in the app, and only there (0126)

Lawrence (Script 6, 2.8/2.9): a family asked "for more information" should be able to answer on the
site, and the answer should put the registration back in front of staff. **The conversation lives in
`registration_family_messages`** — the table the staff notes to the family already used (0019) —
with an `author_kind` of `staff` or `family`, not a second table: one thread both sides read, and the
"Ask the family…" question was already written there as a note. Nobody signed in inserts into it any
more: families write through `family_reply_to_staff()` (household membership checked in the
function), staff through `staff_message_to_family()` (Registration write). A reply clears
`awaiting_family_since`/`_reason` — the same effect as "The family has answered — back to staff" —
and stamps `registrations.family_replied_at`; a family may write unasked. Staff read it with
**Mark as read**, which stamps `family_reply_seen_at` rather than clearing `family_replied_at`, so
the family's dashboard can still say when their reply went; writing back also counts as reading.
`family_reply_unread` is a generated column so the review queue and the nav badge can filter on one
rule. **One way to answer** (Lawrence, same day): no notification email to the registration inbox
and no "or reply to registration@" line — staff learn of a reply from the blue *Family replied*
flag, the *Family replied (N)* tab and the Awaiting Review badge, which now also counts a
registration with an unread reply and nobody still submitted. `guard_awaiting_family()` became an
invoker trigger: as a definer trigger it asked the family *caller* for Registration write and so
refused the reply function too.

## 2026-10-26 — A deposit waiver can be undone (0127)

Lawrence: "why can't waive deposit be undone? it is an administrative tick -- suppose it was done in
error??" **`undo_deposit_waiver(registration, reason)`** takes it back, for the same people who may
waive (`can_decide_scholarships()`), with a reason required. The waiver overwrote any smaller
scholarship, so the undo **restores the one from before**, read from `money_change_log` — the
waiver's own `participant_money` write is the one whose new scholarship is the waived amount, at the
scholarship row's `reviewed_at` (stamped in the same transaction), and its *before* value is the
answer; none found means 0. Anchored on `reviewed_at`, not `deposit_waived_at`, because waiving
twice re-stamps the mark but writes nothing for people already at the deposit. Only people whose
scholarship is **still the waiver's** are touched (the row granted with a *Deposit waived* note and
the money still equal to it); one staff have decided since is left alone. The row reads *Deposit
waiver undone: reason*, granted at the restored amount or **declined** at 0 — not *withdrawn*,
which in this codebase means the family took a request back. The mark is cleared and the family
and early discounts re-run. **Nobody is un-approved**: the registration reads its real deposit again
(*No full deposit yet* / deposit short) and staff decide what follows. The scholarship row's note
from before the waiver is not recoverable (`scholarships` is not in the money log); the amount is.

## 2026-10-26 — Waitlisting says why, and the Review card says who is decided (0128)

Lawrence, on a test registration whose camper was granted a larger scholarship and then waitlisted:
the Review card read "nobody waiting" and "No review needed yet", and the waitlist showed only far
down the page in *People on this week* — "not obvious they were waitlisted or why". Nothing recorded
who changed a status or when. **`registration_participants` gains `status_changed_at`,
`status_changed_by` and `waitlist_reason`** (≤ 500 characters, only while waitlisted), on the person
rather than the registration because a camper can be confirmed while a sibling is waitlisted (0001).
An **invoker** trigger, last of the table's BEFORE triggers, owns the stamps (now/`auth.uid()`
whenever the status changes; untouchable by any signed-in caller otherwise), keeps the reason to
Registration write, and drops it when the person leaves the waitlist — so a hold, an approval or a
cancellation never leaves a stale reason. **The reason is family-visible**: RLS is per row and the
family reads every column of its own participant rows, so rather than a second table the reason is
written for the family — the form says "The family can see this reason." and their dashboard shows it.
The app requires a reason for every waitlisting (both "Waitlist all" and the per-person dropdown).
The Review card now opens with the decided people — waitlisted in amber with reason, when and by
whom; confirmed as a plain line — each name linking to (and unfolding) their row, its count pill
summarises them, and the class hint reads *Decided* (or *Decided — the deposit is still owed*).
Rows from before 0128 have no stamp and say "no reason recorded".

## 2026-10-26 — The registration page: week tabs, one Money card, cards open only while there is work

Lawrence: the staff registration page had ballooned. **Still one page per registration** — approving,
the deposit, payments, notes and the waitlist all belong to one registration — but the header's
"Registered for" list is now a row of **week tabs**, one per registration of the household ("Week 1",
"Week 2" from *Camp Celebrate … — Week n*; any other event by its full name; dates under it, full
name and people in the tab's title). A tab carries an **amber dot while that registration waits on
staff** — someone submitted (not while waiting on the family, as the nav badge counts it), an unread
family reply, on hold, an activity waiver outstanding, or `registration_review`'s deposit-short flag
(Payments read only) — read in `page.jsx` for every registration of the household, errors thrown.
A single registration still gets its one tab; a registration whose people are all cancelled is greyed.
The tabs replace the "*Event* registration details" heading. **Order**: header and tabs; the waiver
notice; Review; scholarship requests; notes to and from the family (and the family's registration
notes); People on this week; **Money** — one folding card holding the balance summary, the
deposit-short notice, Payments, Fees and *How this registration is being paid*, its bar saying
*Owed $x* / *Credit $x* / *Paid in full* / *Nothing owed*; Family contact (now a folding card);
Signed agreements. `#payments` and `#plan` stay sections with those ids, and the Money card opens
itself for them (`Panel`'s `opensFor` takes a list). **Open or folded on arrival** follows Lawrence's
rule, "default open when items are outstanding, folded when done" — each card's rule is written
beside it in `RegistrationManager.jsx`; Review ignores the *deposit waived* flag (a decision already
made). Nothing is remembered between visits, as before; a link still opens a folded card.

## 2026-10-26 — Review flags that inform: the Creed talked through with Larry (0129), the photographer's list

Lawrence, on the Review card: *"Can fold the declined photo and creed, but need an explicit flag
noting they've talked to Larry on the creed, and need to still have photo flag maintained to give list
to camp photographer."* **The `media_declined` (photo permission declined) and `creed_not_affirmed`
flags no longer hold the Review card open by themselves** (nor does `deposit_waived`, as before); they
still show on the card and in Awaiting Review, from `registration_review`, which is unchanged.
**The Creed:** `registrations` gains `creed_discussed_at`, `creed_discussed_by` (profiles, on delete set
null) and `creed_discussed_note` (≤ 500) — one record per registration, because the flag is per
registration. **Written only through two definer functions**, `mark_creed_discussed(registration,
note)` and `clear_creed_discussed(registration)`, each checking Registration write and stamping
`now()` / `auth.uid()` itself; an **invoker** guard (`guard_creed_discussed()`, 0126's shape) refuses
any signed-in direct change — staff with Registration write included — and blanks the columns on a
family's insert. Functions rather than a stamping trigger on a plain update: the who and when cannot
be forged by any client, the app has one call to make, and `review_waiver_upload()` (0124) already has
that shape. **The note is family-readable** (RLS is per row; no family page shows it): the form says
to keep it factual. On the Review card the Creed flag carries *Talked with Larry…* (Registration
write, optional note); once recorded the line turns calm — *Apostles' Creed not affirmed — talked with
Larry, Oct 26, 2026 (name): "note"* — with an Undo. Awaiting Review reads `creed_discussed_at` from
`registrations` and draws a discussed Creed flag in grey. The flags themselves are still Payments
read only (`registration_review`, 0103), so a staffer with Registration write but no Payments read
sees neither the flag nor the button — unchanged, noted. **The photographer's list** is new at
`/admin/rosters/photos/?event=…` (Registration read): one event's people whose newest media answer
is *no*, a face beside each name for Sensitive read (names only otherwise, and the sheet says so),
preferred name, role(s), age at the event, program, household, `print-sheet` so the browser's header
and footer stay off. No answer on file is counted, never listed as a refusal. It lives under Rosters
because the photo answer already does (the Rosters box and print view showed it, but nothing was a
sheet to hand a photographer); linked from that box and from the photo flag on the Review card.
**The Review card's undecided people** are now a *Waiting on your decision* block above the
Approve / Waitlist / Ask buttons — each person a link to their row with their role — replacing the
"Still submitted: …" sentence. The duplicate-name role label ("Cal (Volunteer)") needs a real
person id and ignores cancelled rows; "Ro BOTFAMILY-C (Camper)" was the pre-`4a463d0` comparison
(`person_id`, never selected, so every row matched).

## 26 Oct 2026 — The Creed conversation is per person, and the flag is not money (0130)

Lawrence on 0129: the Creed flag "should not be tied to money -- anyone with registration read should
see it, and anyone with write should be able to set the flag"; the note being family-readable is fine;
and the record "needs to apply to registrants at that time... should re-open if someone is added (or
major change, like name)". So `creed_status` (security invoker, reads no money) gives the flag to every
reviewer, and `creed_conversations` holds one row per (registration, person) with the person's name at
the time; a conversation covers someone only while that name still matches. *Talked with Larry* records
it for everyone the flag is raised for at that moment; Undo clears the registration's rows. 0129's
columns on `registrations` were dropped (none were set live). A pending conversation now holds the
Review card open; a recorded one folds. The table is staff-only — no reason to show the family the note
once it had its own table. Also: the event status dropdown on Setup is colour-coded (unpublished blue,
published green, archived grey), and giving statements print the tax year large at the top ("2026 Tax
Year" for a whole calendar year; the year and exact dates otherwise, so a partial statement never
passes for a year-end one).

### 26 Oct 2026 — Support questions for every camper; families room together; link a caregiver on the registration

Lawrence, on the registration wizard: the support wording *"seems to have an autistic/camper with
sensory needs in mind... camper population needs are much broader than that... want the language to be
inclusive"*; *"rooming default is for families to be together"* (not said); the Role select truncated
*"Camper with disabili…"*; *"caregiver (if attending) should be able to be linked here in
registration... indicate to save and come back after they are registered"*.
**Wording, labels only — no column renamed.** One source, `SUPPORT_QUESTIONS` in `lib/support.js`,
used by `SupportDetailsFields` (wizard and dashboard form) and the staff person page, so staff read the
question the family answered. *A hard day* → *When camp gets hard*, with examples spanning getting
around, pain and tiredness, communication, personal care, night-time help and the senses, for adults
as much as children; the sleep question now asks about help at night as well (the flag is still
`has_sleep_disturbance`; the change log calls it *Help at night / sleep*). **Rooming** says families
stay together unless the family says otherwise (the Rooms page already groups by household, "keep
families together") and asks only for what is different or needed about the room.
**Caregiver link.** No schema change: `person_caregivers` (0012, positions 1–2, both ends in the
family's household by policy) is what Manage Household already writes. On *Will a caregiver be
attending? — Yes* the wizard asks *Who is {name}'s caregiver?* from the other people named on the
form who are not under 18 at the event's start (no date of birth yet still offered), keyed by saved
id or, for someone new, by name (`memberKey`; the server resolves the same key against the saved
registration). A caregiver with no phone on file gets a phone box, because a linked caregiver must be
reachable (`lib/caregivers.js`); the phone is written to the caregiver's `people.phone` only when they
have none. The link is made after the save under the family's own permissions, only for people on
that registration, never replacing a link on file (a free position or nothing). It is never required
and never fails the submit — anything not linked comes back as an amber `caregiverNotice` pointing at
Manage household. *Not on this registration* says to save and, once the caregiver is registered, link
them from the dashboard under Manage household; the dashboard form's caregiver question says the same,
with the link. The Role select spans two columns.

## 26 Oct 2026 — A volunteer signs the ministry's activity waiver ahead, like a provider's form

Lawrence, a volunteer on both camp weeks, had "Horseback riding — Lawrence needs a waiver signed" twice on
his dashboard, and each link opened an Activities page with nowhere to sign it: the rows came from horseback
signups made before volunteers stopped choosing activities, and the page gave volunteers only outside-provider
uploads. Now each volunteer's block ("Volunteers and buddies — waivers") also lists every activity on that
event with one of the ministry's own waivers: signed (who, when) or a button opening the camper's signing box.
It is "ready in case", like the provider form, and still not a signup. signActivityWaiver lets an active
volunteer on the caller's household's registration for that activity's event sign without a signup; the
household check and signer rules are unchanged. The dashboard's lines link to the person's own block
(#person-<participant> for a camper, #vol-<participant> for a volunteer), name the event when there is more
than one, and the card says "Waivers still needed". The view (activity_waivers_outstanding) is unchanged; a
volunteer's legacy signup still makes a row, which signing now clears. The signing box puts a calm neutral
line before an agreement that opens with the statutory WARNING notice (TCA 44-20-105); the notice itself stays
verbatim.

## 26 Oct 2026 — Staff can see what was emailed, and Resend's id is kept (0132)

A test email went to a mistyped household address (luke14ministries.com); the "2 emails sent" card
vanished on reload and no staff page read `message_log`, so the only record was in the database, and it
held no provider id to look up at Resend. Now: each registration page has an **Emails sent** card (the
household's emails, folded), Email Families has **Recently sent** (latest 30, every family, including the
plan emails), and `sendEmail()` returns Resend's id, which `log_family_email()` stores (restated in full
in `0132`, the old signature dropped so there is one). The preview on Email Families lists what each
family will be asked for and can show any family's email, not just the first (one sample read as the
body everyone would get). Also: bank transfers "may" take a few days to clear, everywhere a family reads
it (the stripe-webhook receipt wording takes effect when that function is next deployed).

## 26 Oct 2026 — Provider confirmations are checked in one queue; Activities gets a badge

Lawrence on the Activities page: Accept / Reject on every card, a separate row of volunteer chips and a
long amber paragraph were "cluttered ... will become klunky when there are many", and the nav showed no
sign a confirmation was waiting. Now the page opens with **Confirmations to check** for the chosen event:
every upload awaiting check (campers and volunteers alike), oldest first, with the file and, for
Registration write, Accept / Reject. The cards are status only: one pill per person (awaiting check links
to its queue row; accepted / rejected open the file, the reason on hover), volunteers and buddies folded
into the people list by role, one short provider line with the rest under *How this works*, "told"
lightened, and the header says what is outstanding ("2 to check · 1 missing · 1 waiver not signed") so a
folded card still shows it. The Activities nav item carries an amber badge of uploads awaiting check at
current events, for Registration write (a failed count is logged and shows none). With no event chosen
the page opens on the first current event with something to check. Pending uploads were surfaced nowhere
else on purpose: Awaiting Review's *Waiver outstanding* tab is the family's work (missing or rejected);
checking an upload is staff's.


## 26 Oct 2026 — Stale pending refunds are flagged; rafts are placed by family

A refund still pending more than ten days after it was created has probably gone wrong (two bank
refunds sat pending from 26 Aug, quietly changing the balance note). `isStaleRefund()` /
`STALE_REFUND_DAYS` in `lib/payments.js` is the one rule: an amber "pending since <date> — check Stripe"
on the registration's Payments, a warning under the money note, and a strip on Event Payments listing
every such refund. A flag only; the money is unchanged. The rafts/groups "To place" list drops its
separate "Campers with their buddies" section: everything is grouped by family, each camper with their
buddy on one row under the camper's family (the buddy goes in the raft too, unlike rooming; a buddy
from another household is named with their household and not listed again). Rows stay individually
pickable so large families can be split; "Place the whole family" takes them all.

## 26 Oct 2026 — Ways to pay: expandable cards, the scholarship request a quieter line

On `/account/finish/[registrationId]` the three option cards sat on top and the chosen route's details
(how often, the schedule, bank or card, the authorization, the button) were one panel at the bottom,
so choosing a card jumped the page (Lawrence: "weird"). Now the payment plan and pay-in-full are
expandable cards, one open at a time, each holding its own details under its header (an opened card
scrolls gently into view; the first draw does not). The preselected card is unchanged (the plan where
one is offered, else pay in full); amounts, wording, bank-first with the thank-you line, the
returned-payment-fee disclosure and the plan consent are unchanged. "Request help with the fee"
became a quieter line under both cards linking to the same scholarship page. The header matches the
other account pages: title left, the Back to dashboard pill right.

## 26 Oct 2026 — Re-check a stuck refund with Stripe, from the site

Two bank refunds sat "pending" for two months because Stripe's later word never reached the refund
webhook, and nobody can see inside Stripe from here. A refund flagged stale (pending more than 10 days)
now has **Re-check with Stripe** on the registration's Payments and on Event Payments' strip (Payments
write). The server asks Stripe for that one refund (the key stays in `lib/stripe/server.js`), checks it
belongs to the same payment, and records the status only. No new database function: a pending refund's
status is already the one thing a Payments-write session may change (`payment_refunds_update`;
`payment_refunds_guard` keeps the amount and Stripe reference fixed and a settled status final), which
is the path `refundPayment` already uses; the triggers keep `payments.status` and `money_change_log`
right. Still pending at Stripe changes nothing and says so.

## 26 Oct 2026 — Checkout broke on Stripe's new API; "paid" double-counted a full refund (0133)

**Checkout:** the Dependabot upgrade to the Stripe library 23.0.0 (21 Oct) changed the pinned API version
to `2026-09-30.endive`, which removed `payment_method_types` from Checkout Sessions and PaymentIntents —
every card/bank checkout, plan set-up, plan method change and donation was refused ("The
`payment_method_types` parameter is no longer supported"); the 21 Oct review missed it. Fixed by sending
`allowed_payment_method_types` (same meaning: only the method the family chose). The edge functions now
import `npm:stripe@23.0.0` instead of an unversioned `npm:stripe`, so a redeploy is deterministic; they
need redeploying with the live keys at go-live (W51) — `charger.ts` had the same parameter.

**Paid:** after the two stuck bank refunds were recorded as succeeded (found succeeded in Stripe via the
connector — they pre-dated the refund webhook by 20 minutes), the $470 payment became `refunded` and the
balance read "Paid $-180, Owed $900": the paid sums counted only `succeeded` payments but subtracted every
succeeded refund. `0133` counts `refunded` payments in the gross in all three places; statements list a
fully refunded payment as "received, refunded". One live registration was affected (test data). Also: the
Money card's amber balance shows just the amount — "Owed" beside "Balance today" said it twice.

## 26 Oct 2026 — One header, one fold marker, everywhere

Lawrence, after a run of pages that each did it their own way: "be consistent EVERYWHERE!"

**Headers.** Every signed-in page puts its title on the left (`text-3xl font-bold`) and the shared
`BackLink` pill on the right of the same row, the intro left-aligned below — agreements, delete my
data, support details, help with the fee, two-factor, the statement, payment received, the Register
chooser and Volunteer with Us when signed in now match Activities, Manage Household and the wizard.
A success box keeps one way back (the header pill); the duplicate dashboard buttons went. Staff pages
use one `text-xl font-bold` title (Accounts, Deletion requests, Setup, Access changes and Background
screening were `text-2xl`), and a sub-page or print view puts its back pill on the right of that row
(Rafts, the person page, the statements, the photographer's list, allergies by allergen, My Program's
print). Public pages keep their centred hero. On `/admin` the site header uses the staff area's wider
container, so the logo lines up with the staff menu; the account pages keep the site container (their
content is a narrower centred column, so there is no shared edge to line up).

**Folding.** One marker: `components/FoldArrow.jsx`, a ▶ at the left of the title that turns down when
open, inside the heading's button; `fold-summary` (globals.css) draws the same on a native `<details>`.
No right-edge arrows, chevrons or "Show / Hide" words. Changed: FoldCard (Event Payments' cards), the
registration page's Panel, My Registrations and each registration, Support details, Ways to pay, Manage
Household, the family wizard's cards, Activities cards and Times, Rooms buildings, floors and Set up
rooms, the buddy board's marked list, Recent Changes households, the staff menu's Camp week group, and
every `<details>` (How this works, Prefer to mail a check?, Full schedule, consent text, family notes,
history, How reviewing works, How access works, Setup's year groups). Row menus (Event Payments,
Accounts) and drop-downs (the event filter, search pickers) are menus, not folds, and keep their look.
Rule in CONTRIBUTING.md, *Adding a page*.

## 27 Oct 2026 — A plan is flagged after its first failed payment, not only when it stops

Lawrence, on Testing Script 17.11: "should flag after ONE failure I think (not 3; additional flag for
plan stopped after 3rd attempt)". Until now staff saw nothing until the third try failed and the plan
stopped. **The earlier flag:** a plan still running — active, or paused by staff — with an installment
whose charge failed, one helper, `planFailingSince()` in `lib/plans.js` (the oldest outstanding
failure's time, its try count, whether the plan is paused; a stopped plan is never "failing", it is
`planStoppedAt()`'s). Amber, because the charger is still trying and the work drains when it succeeds
or staff act; the stopped plan stays red, because it is wrong until someone calls the family.
Awaiting review's *Plan stopped* tab is renamed **Plan problems** and lists both (same `?show=plan`,
so links keep working; red when any plan stopped, amber when only failing ones): "⚑ Plan payment failed
<date> — retrying (try N of 3)" and "⚑ Payment plan stopped <date>". One tab rather than two because it
is one job — the same families, the same plan card, the same three buttons — and a second tab would
split it. The Overview gains an amber card beside the red one that names the families, each linked to
its registration's `#plan`; the plan card an amber line above the schedule. A paused plan with a
failed charge says "plan paused — no retry until staff resume it", and a stopped plan restarted by the
family's new card says "retrying with the new payment method" (the edge functions reset its count to
0). Payments read only, current events only, as before; nobody's status changes. The nav's Awaiting
Review badge is unchanged: it counts people still submitted and not waiting on the family, with
unread family replies as a separate envelope count — plan problems were never in it.

## 27 Oct 2026 — Emails sent to families: grouped by send, filterable, searchable

Lawrence on Email Families' *Recently sent*: "should be collapsible and filterable; grouped by event,
date, etc" — then "make it searchable too". One staff send to three families was three near-identical
lines, and only the latest 30 showed.

**Grouped by send.** Rows with the same subject, sender, kind and event, each within two minutes of
the next, are one send (`groupEmailsBySend()`, `lib/emailLog.js`): the action sends one household at
a time with a 600 ms pause, so a send's rows are seconds apart, and measuring the gap between
neighbours keeps a long list that takes minutes as one send. No send id is stored, so this is a
reading of the log, not a fact in it; two identical sends within two minutes would merge, which is
harmless. The site's own plan emails (`sent_by` null) stay one per line — each is one family's news.
Sends sit under event headings (the registration's event; "No event" otherwise), the most recent
event first, and each folds open (the site's left ▶, `fold-summary`) to its families' rows.

**Filters in the URL, read on the server** — a plain GET form like Giving's, so a reload or a shared
link keeps them: search (`q`), event (`sent_event`; current events plus all), kind (`sent_kind`:
staff / waiver / plan_*), From / To (`sent_from` / `sent_to`, Morristown days). `?event` already
belongs to the send form, hence the prefix; the send form's choices ride along hidden. Search is one
box, case-insensitive, over the subject, what it said (`body_text`), the to-address and the family's
name — ILIKE in one PostgREST `or`, with `%`, `_` and `\` escaped and the value quoted; family names
are looked up first and their household ids join the `or` (over 100 matching households and the page
says the name part was left out). A separate family filter would add nothing the search does not.
Default window: the last 90 days, at most 300 rows, with an exact count ("Showing the last N emails",
"N emails match '…'"). The card is open by default: it is the record of what was sent, and folded
sends already keep it short. The registration page's *Emails sent* is unchanged — a household gets
one email per send, so grouping would change nothing there.

## 27 Oct 2026 — The whole family chooses activities; a provider tick works in either order

Lawrence: "for families, all can choose activities... not just the camper themselves... parents and
siblings can be signed up for rafting, pontoon, etc". The 14 Oct campers-only rule is replaced by
`CHOOSES_ACTIVITIES` in `lib/activityRoles.js` (camper, parent/guardian, sibling, caregiver) on the
Activities page and the dashboard's button; volunteers still go where their camper goes and have their own
waiver block, and support team / childcare are working. Nothing in the database limited signups to campers.
Also on that page: ticking a provider-run activity before its "I understand" box no longer springs back —
either order works and the place saves once both are ticked — and the doubled amber "now needs a waiver"
line above the upload box is gone; the upload box names whose form it is.


## 27 Oct 2026 — One way in to paying; the donor's own giving statement

Lawrence: the dashboard's Pay deposit / Payment plan / Request help buttons were "redundant with the next
page". Each registration now has one **Ways to pay** button (plus Statement); everything the old
dashboard pay panel did moved to `/account/finish/[id]`: a "Pay the deposit only / Pay part of the
balance" card (deposit or any amount), the optional cover-the-card-fee box on one-off payments, the
check-mailing details, a clearing line and a link to the statement. After a route is chosen (a plan in
place, a scholarship asked for) the page still takes one-off payments. Both checkouts cancel back to Ways
to pay. `PayPanel.jsx` is gone. "Needs: deposit" is no longer shown beside the "$… deposit due now" pill
(it still opens the card and counts).

The dashboard's "Download Giving Statement" placeholder is live: `/account/giving-statement/` prints the
donor's own settled gifts for one calendar year (newest year by default, other years linked), through
`components/GivingStatementSheet.jsx`, the sheet staff print at `/admin/giving/statements` — one sheet,
so the two cannot disagree. Scoped by `profile_id`, so a hand-recorded check with no login attached is
not on it; staff print those. No migration: donors already read their own gifts (`0010`).

## 27 Oct 2026 — Finished support details live with the household

Lawrence: "should support details be in manage household or is this event specific? seems mis-organized"
(the finished card also sat flush under My Giving). Support details are per person (`person_support` is
keyed by person), so once every attending person's are on file the separate card is no longer drawn; each
of them gets "Support details on file ✓ · Review" under their name in My Household. While anything is owed
the card stays at the top of the dashboard as a to-do, unchanged.

## 27 Oct 2026 — The Ways to pay button follows the money state; a running plan has its own pill

The button stays the site's teal (white on the pills' amber fails contrast, and amber means status, not
action), but it is **solid only while a payment is needed now** — the deposit, a plan problem, a past-due
balance (`MONEY_NEEDS`, the same Needs as the pills) — and an outline otherwise, still there for an extra
payment. Paid in full keeps the green badge. A plan running as it should (active, no problem) replaces the
amber balance pill with a calm "Payment plan · $890.00 left · next Nov 1"; a plan with a problem keeps the
amber balance and its Needs chip.

## 27 Oct 2026 — A family can cancel their own payment plan (0135)

Lawrence: "there should be a way to cancel the payment plan". `family_cancel_payment_plan(registration)`
(definer; the caller must belong to the household, checked in the function) does what the staff cancel
does: the plan becomes cancelled with `cancelled_at` / `cancelled_by`, its scheduled and failed charges are
cancelled, nothing is refunded, and what is owed stays on the balance. It is refused while a charge is still
clearing the bank. The early-discount decision is left to staff, as for any cancelled plan; the staff plan
panel now says "Cancelled <date> by the family" and prompts that decision. On the family dashboard the plan
box shows its status as a pill (green Active, red Payment problem) with "· Cancel payment plan" beside it and
an inline confirm. Paying off the balance needs no cancel: the charger closes a plan with nothing owed on its
next charge date, and a plan charge that settles the balance closes it at once.

Also from the 17.11 run: a failed payment shows a red pill and no Refund button (only money that arrived
can be refunded, and `refundPayment` refuses otherwise); a charge set aside when staff resume a plan reads
"Failed — … · moved into the later payments", not "Cancelled".

## 27 Oct 2026 — A plan failure stays flagged until it is fixed (0136)

Lawrence: "keep the flag until fixed". Resuming a plan sets its failed charges aside (cancelled) and rebuilds
the schedule, which cleared every flag though the card that failed was still on file. Now a set-aside failure
(`setAsideAfterFailing`: cancelled, tried, with an error) on a running plan counts in `planFailingSince` /
`planHasProblem` until a later plan charge succeeds or the family saves a new card or bank account after it.
That needs `payment_plans.payment_method_changed_at` (`0136`), stamped by a trigger whenever
`stripe_payment_method_id` changes and impossible to set by hand. The family's plan box says the payment was
spread over the rest but the same card is on file; staff read "plan resumed with the same card or bank account".

## 27 Oct 2026 — A restarted plan keeps the staff early-discount decision

A new plan deposit on a registration whose plan was cancelled restarts that plan (the plans webhook ignored
it until today). The restart clears the cancellation stamps but leaves `keeps_early_discount` as it was
(Lawrence: "carry the staff decision over -- default should be to keep as whatever it was before"); a
brand-new plan gets the column default, true.

## 27 Oct 2026 — Plan payment problems flagged at the top; decline wording; volunteers indigo

From the 17.11 run. A plan payment that failed, or a plan that stopped, now has a red banner at the top of
the family dashboard (like the volunteer application's), with a button to the plan's box where the card is
changed. A provider's error reads as a phrase in our sentence, "(your card was declined)", not "(Your card
was declined.)." (`declineReason`, in lib/plans.js and `_shared/plans.ts`; the emails change when the plan
functions are next deployed). On the staff registration page the volunteer role pill is indigo: amber is
the site's "needs attention" colour, and purple is caregivers'.

## 27 Oct 2026 — The both-weeks discount lives on the later week; Week 1's details are Week 2's defaults; Setup regrouped; horseback waiver accepted

Lawrence: the both-weeks discount "can only be on week 2 (since that's where it applies)", and "details
from week 1 should copy to week 2 as defaults ... IF week 2 have been manually edited ever they don't get
overwritten". The discount comes off the later week's fee (`recalc_multi_week_discount()` uses the later
event's percentage), so the field shows only on a camp's later week. Saving an earlier week copies its
price, places, early registration, balance due, family discount and returned-payment fee to each later week
of the same camp (names sharing the part before " — ") that has never been saved by hand —
`events.details_set_by_hand_at` (`0137`), stamped by Setup's own save, never by the copy. A later week with
more people registered than the copied places keeps its places, and the save says so. (A first version that
synced the percentage across weeks was replaced the same hour.) Setup's event details now put the
dates on one line (early registration ends, early discount, balance due) and every discount on the next
(family discount, from person, both-weeks). Larry, 27 Oct: the horseback waiver text (version 1, `0116`) is
acceptable; the Staff Questions item is closed.

## 27 Oct 2026 — Adding an administrator gives every area; reminder schedule decided; Setup card tidied

Ticking Administrator already gave every area at write (Giving included, 26 Oct) when ticked on the list,
but **Add to staff** with the box ticked skipped it, so Larry was added with no grants. `addStaffMember` now
does the same. The reminder-email schedule is decided (Lawrence and Larry): deposit and balance monthly on
the 15th until paid, then 2 weeks before the balance due date and on it, then weekly once past due; missing
details monthly, then 2 weeks and 5 days before camp; a plan notice 1 week before each payment. Setup's New
event panel says which dates they run from (folded). The event card on Setup lost its paragraphs: four
aligned columns, labels only, the explanations folded into "How these settings work", and the top button
reads "Save status" so it is not mistaken for the event-details save.

## 27 Oct 2026 — The automatic emails are built (0138)

Lawrence: "build all the rest of the email drafts and triggers as proposed" (draft §2–§5, less 5.4 and 5.5,
left to do). The job is the website's, not a Supabase function: a daily Vercel Cron calls
`/api/cron/reminders/`, so it reads the very rules the dashboard reads (`lib/familyNeeds.js`, shared now)
instead of a second copy in Deno that would drift. That needs a service-role client with no signed-in
person behind it — `lib/supabase/admin.js`, the site's only one, `server-only`, key set in Vercel by
Lawrence. One email per family per day; `reminder_sends` (kind, item_key) keeps anything from being said
twice; a failed send is not recorded, so it is tried again. Staff can **pause** a registration's nagging
reminders (deposit, balance, past due, missing details, not submitted); confirmations and plan notices
still go. Confirmations read `registration_participants.status_before` (a new trigger-only column) to tell
"off the waitlist" from "confirmed", and only for a change in the last three days, so switching it on
never announces old news. **Test mode until go-live**: only @luke14ministries.net addresses are emailed;
everyone else is recorded as skipped, so the test families' made-up addresses get nothing. Left out on
purpose: the "agreement for someone added later" line (nothing on the site works that out today) and the
two to-do emails. Email Families shows the next 7 days; the registration page's Emails sent has the pause.

## 27 Oct 2026 — One Save on each Setup event

Lawrence: "just one save is still more sensible ... unless there is a strong reason". There was not: the
split (2 Oct) kept the weekly act, opening and closing registration, apart from changing camp's dates, and
one button that saves only what changed does that as well. Each event card now has a single **Save** (and
**Undo my changes**) at its foot: it saves the status and registration window if they changed, then the
event details if they changed, and reports both in one message. The two server actions are unchanged.

## 28 Oct 2026 — One deposit wording; quieter reply notices

Lawrence: one wording, the "Deposit short — $0.00 of $250.00" style. `reviewClassLabel()` and
`depositShortWords()` in `lib/plans.js` give it to the Awaiting review pill, the Payments page, a person's
page, the Review card and the roster chip; the review tab and the Payments filter read "Deposit short"
(the part-paid filter "Deposit short — part paid"). The "A family wrote back" boxes on the Overview and
Awaiting review lose "— read first": the box is the notice.

## 28 Oct 2026 — Activity sheets: a Health & safety column that every activity leader can read (0139)

Script 6 17.21: the Support column printed "ask the coordinator", which said nothing, and read
person_support directly, so a leader without Sensitive read got blanks that looked like "nothing to know".
Now `activity_safety_flags()` (definer; Activities read or Sensitive read; only people with a signup)
gives yes/no facts and allergen names, and the column — renamed **Health & safety** — prints e.g.
"Allergy — severe: Peanut · Seizures · Needs a buddy", or "No details on file". Never the narrative
(what happens, medications, behaviour). Lawrence chose to include the allergen's name.

## 28 Oct 2026 — Old-site content carried over before the domain moves; The Hazelnut Movement removed

Lawrence approved, ahead of luke14ministries.net pointing here: nothing on this site may depend on the
old Squarespace pages. (1) The 2026 Adult Adventure Retreat stays on CampSite; its buttons go straight
there — "Returning Campers Register Here!" (sign-in) and "New Campers Register Here!" (enrol), the old
page's links and labels — and the retreat is for "independent adults with disabilities", the old site's
words. (2) The eight PDFs linked at `/s/<name>.pdf` were copied, each checked to be a real PDF, into
`public/resources/` under plain names. (3) `next.config.mjs` redirects (permanent) the old addresses with
no route of the same name here, and the eight PDF addresses; with `trailingSlash` an old page link takes
two hops (Next adds the slash first), checked with `next start`. (4) Party Memories and (5) Kenya
Memories are pages here now, linked from the Party and Wheels for Kenya pages; the old Kenya page's
2017 and 2018 "photos" are template placeholders over YouTube players, so its three years are videos.
(6) The videos the old site had and this one lacked are embedded (2026 highlights on Camp Celebrate and
Camp Memories, 2025's two weeks, the Wheels for the World process video); 2014 is on Vimeo, so the
report-only policy's `frame-src` lists `player.vimeo.com`. One shared `VideoEmbed` / `VideoYears` serves
every video page. (7) **The Hazelnut Movement is no longer part of Luke 14** — spun out to another
ministry. Its page, images, home card, nav and footer links, donation fund and the donate page's three
Hazelnut lines are gone, its address redirects home, and Julia Erman's leadership entry went with it, as
on the old site. The staff gift form keeps the fund name for gifts already recorded under it.

## 28 Oct 2026 — Julia Erman and the Hazelnut fund removed; a Luke 14 Party Meals fund; the brochure edited

Lawrence approved, following the Hazelnut Movement's removal earlier the same day. (1) **Julia Erman is
not part of Luke 14**: Host a Speaker loses "our founder Julia Erman" and her keynote, her speaker section
and her photo; Darlene, Larry and the ministry team remain. (2) **One fund list**, `lib/funds.js`, read by
the Donate form, its server-side whitelist and the staff Record a gift form — three copies had drifted
(the staff form still offered Hazelnut, which the entry above kept on purpose; Lawrence now wants it off
everywhere). Gifts already recorded keep their fund: the Giving filter, statements and exports read the
stored rows. (3) **Luke 14 Party Meals** is a fund, replacing the old Squarespace store's "$10 Luke 14
Party Meal Donation"; Donate says $10 a volunteer is suggested, never required. `stripe-webhook` records
whatever fund the checkout carries, so no edge function changed. (4) **The brochure**
(`public/resources/luke-14-ministries-brochure.pdf`) was edited, not rebuilt: its fonts (Public Sans,
Canva Sans) are not on this machine and the PDF holds only subsets, so an HTML rebuild would have reset
every panel in another font. `docs/brochure-source/rebuild_brochure.py` (pypdf) drops the cover's Hazelnut
line and the inside Hazelnut panel, filling that panel with a photo already on the site; no new words. A
redesign belongs in Canva.

## 28 Oct 2026 — Staff sheets and tables use marks, not sentences

Lawrence: yes/no and short-status cells on staff print sheets and spreadsheet-style tables are a tick, a cross or a warning mark (`components/StatusMark.jsx`), with brief words only where the mark alone would lose the meaning, the full words as the tooltip and a key line on each printed sheet. A column meaning a background check is headed "Background check". CSV exports keep the full words, and narrative, money and dates are unchanged. Applied the same day to the volunteer list, activity sheets and groups, My Program and the roster print.

## 28 Oct 2026 — Go-live in three stages; the functions read SITE_URL

Lawrence: go-live is three sittings, not one evening (DO-THIS-NEXT W51). **A**, ready ahead and invisible (Vercel server key and cron secret, Stripe live setup with the three live endpoints idle and their secrets in the vault, the Supabase Cron job, the new domain added to Auth redirects and Turnstile, the Cloudflare copy of the zone checked against the live records). **B**, the money switch after the purge and audit (live Stripe key and the three live signing secrets, the four functions redeployed, small real payments by staff at the preview address). **C**, the address (nameservers, Site URL and `SITE_URL`, the four preview switches). B before C is put to the board as a staff question, since the rule was test keys until launch. To keep C a settings change, `_shared/plans.ts` `SITE` now reads the `SITE_URL` function secret (preview address while unset), and `stripe-webhook`'s receipt link uses it.

## 28 Oct 2026 — A Redeploy of the live commit always builds; the skip rule is a script

Lawrence set `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` in Vercel and pressed Redeploy four times;
every one was cancelled. The docs-only skip compares against the last successful deployment, and a
Redeploy changes no files, so it looked like "nothing changed". A changed environment variable only
reaches the site through a deployment, so go-live steps B1 and C8 would have failed the same way. The
rule now builds whenever the commit being deployed is the one already live, and otherwise keeps the
29 Sep and 15 Oct behaviour (skip a Markdown-only change; build if the live commit is not in the
clone). A one-line version was refused: Vercel caps `ignoreCommand` at 256 characters. It lives in
`scripts/vercel-ignore.sh`, with comments, and `vercel.json` runs it. To apply a changed variable,
Redeploy the deployment marked **Current** (a Redeploy of a cancelled docs-only one is still skipped).

## 28 Oct 2026 — The site sends the refund email; the prayer list's page and email tidied; a Communication section

**Refunds (W66).** Lawrence: every family email from one place. When a refund on an event payment
reaches *succeeded*, `stripe-refund-webhook` emails the person who paid (template `refund_receipt`,
logged to `message_log`, shown as *Refund sent* under Emails sent), and Stripe's own *Refunds*
customer email is off. One email per refund: the status writes are conditional, and only the delivery
that actually moves a row into *succeeded* sends. Stripe's ACH mandate and microdeposit emails stay
Stripe's (they are the required bank-debit notices). Gift refunds are not emailed; they are rare and
staff write personally. Stripe's support email (replies to Stripe's emails) stays
`larry@luke14ministries.net` (Lawrence).

**Prayer list.** The message box starts with the team's sign-off ("In Christ, / L14 Prayer Team"),
ordinary text the writer can change or delete; a message that is only the sign-off cannot be sent. The
email no longer repeats its subject as a heading (`emailShell`'s title is now optional). *Who is on it*
folds shut by default, sorts and searches (DataTable), and hides people who unsubscribed or were taken
off behind a tick box: their row is kept on purpose, as the record that they must not be emailed.

**Communication section.** Email Families, Newsletter and Prayer List move into one sidebar section,
*Communication*, between Money and Admin. A prayer-team login holding only the Prayer list grant sees
the Overview and this section with one item.

## 28 Oct 2026 — New event starts from last season's camp or retreat (W70)

Lawrence: creating an event should offer three drafts — Camp (one or two weeks), Adult Adventure, Other
(blank) — the first two "with the settings from the previous season". *New event* on Setup now shows
those three choices, plus "or copy one particular event" for anything else. A camp draft starts from
the newest camp's weeks (events whose names share the part before " — ", the grouping Setup's
copy-to-later-weeks rule uses; names with "test" are never a template); one week takes Week 1 and
drops " — Week n" from the name, two weeks take Week 1 and Week 2 (or Week 1 twice, a week apart, if
last season had one). The retreat draft starts from the newest retreat. Every draft is next year's
name, the same weekdays 52 weeks on, editable before creating, and created unpublished.

`admin_create_event()` already copied the description, agreements, activities, waivers and rooms, but
not the money settings, so a copied event opened with no early-registration date, no discounts and no
balance due. `createEvent` now copies the registration window, early registration and its discount,
the family and both-weeks discounts, the balance due date and the returned-payment fee from the source,
every date moved by the same number of days as the event; a failure there is reported, never silent.
`details_set_by_hand_at` stays empty, so a Week 2 made this way still takes Week 1's details when Week 1
is saved (`0137`). No migration: the events policy already lets Setup write make that update.

## 29 Oct 2026 — The board's yes to going live in three sittings (G4)

Larry, answering the Staff Questions with his own Claude session: going live in three stages is "an
acceptable plan". Stage B, live Stripe keys with real money taken by staff only at the preview
address, may come a few days before Stage C, when the domain moves and families are told. Lawrence:
Larry's yes counts as the board's for B and C. The rule "test keys until launch" now means "until
Stage B". Larry also approved the rebuilt brochure (The Hazelnut Movement removed). Its QR code encodes
the bare `https://luke14ministries.net/`, so Stage C's phone check scans a printed copy.

## 29 Oct 2026 — Payment plans: a late Resume schedules a charge; notice before every rebuilt charge

Found by Larry's Claude session re-checking the 14 October plan review, and confirmed in the code.

- **Resume after the last charge date scheduled nothing** (`plan_charge_dates()` returns no date
  within three days of the due date), so the plan read Active and never charged. `0143` restates
  `build_plan_installments()` with `p_min_lead_days`. Resume passes the notice lead plus a day, and
  when no date is left and money is owed, it schedules one charge for the whole balance then.
  Stripe's webhook passes nothing, so a new plan's schedule is unchanged.
- **The "your next payment" email goes 10 days ahead for a bank account**, a week for a card
  (`planNoticeDays()`). A plan's amount follows the balance, and US rules for automatic bank debits
  expect about 10 days' notice of a changed amount. This is a cautious reading, not legal advice;
  David can confirm. The rebuilt schedule's lead is chosen so this email always goes out first.
- **A finished plan reads "Completed", not "Paid in full".** Someone added to the registration
  after the last charge leaves money owed, and the charger skips completed plans. The family's plan
  card says what is still owed and points at Ways to pay.
- **Ways to pay after the due date** says "was due on …, so it is due now", not "due by" a day
  that has passed.

## 29 Oct 2026 — Larry's answers: no store, no meal fund, Stripe at the Party, QuickBooks accounts

- **No store page** (T-shirts or anything else) and **no meal donation**. *Luke 14 Party Meals* is
  off Donate's fund list and its paragraph is gone; gifts already recorded to it keep their fund.
- **Party payments will probably go through Stripe** (Tap to Pay in Stripe's Dashboard app, a QR
  Payment Link as the backup), once live keys are in at Stage B. Nothing to build; Square is retired
  at the ministry's pace.
- **16.3 (a family's whole journey on a phone) holds up Stage C only**, not the purge or Stage B.
- **QuickBooks: every payment has an account and a class.** The class is the event. The accounts
  are 40000 Individual Contributions, 41000 Corporate Grants, 42000 Foundation Grants and 44000
  Purchase of Goods or Services (`lib/quickbooks.js`). The Event Payments QuickBooks CSV books
  registration money, a covered fee and refunds to 44000, class = the event's name. Lawrence: the
  export infers the class from the event, with no separate Setup setting. The Giving QuickBooks CSV
  books gifts to 40000, class = the fund's program (none for the General Operating Fund). Both files
  gain a Class column: Date, Name, Memo, Account, Class, Amount. Grants (41000, 42000) do not come
  through the site; they are booked by hand.

**Later the same day: the QuickBooks files take the Sales Receipt's shape.** Lawrence's screenshot
shows how a payment is entered: a QuickBooks **Sales Receipt** (Donor, Email, Sales Receipt Date,
Payment method, Reference no., Deposit To 12000 Undeposited Funds, then lines of Product/Service,
Description, Qty, Rate, Amount, Class), where **Product/Service is the event**. In QuickBooks a
product carries its income account, so the account follows from it. Both QuickBooks CSVs are now one
row per receipt line, in that field order, with a Receipt number grouping a payment's lines. A covered
fee is the second line of the same receipt, and a refund is a Refund Receipt. Gifts take the fund as
Product/Service. The Account column stays, as a check that the product is mapped to 44000 or 40000.

## 29 Oct 2026 — G2: the test data purged from production

Lawrence's go, 29 Oct. First a full copy of every public table, plus `auth.users`, `auth.identities`
and the storage file list, into the private schema `purge_backup_20261029` (the site's API does not
expose it; drop it once go-live is settled). Supabase Pro's daily backup is the second copy. A
dry run in a rolled-back block came first, then the real run, as one SQL block in the G2 order.

- **Deleted:** 17 households (every one except Gibson and Sherrill) with their 37 people and 24
  registrations, 12 payments, 5 refunds, 9 logged emails and 113 signatures. Also Sherrill's
  registration (the household stays), 19 logins (bots, test addresses, the personal-address staff
  logins, Katie's four personal ones) with 7 staff rows and 64 grants, both test gifts, the prayer
  list's 2 test sign-ups and 3 test sends, the stray Week 1 Salon time, the empty Week 2
  medical-contact row, and Lawrence's Giving write. The 15 test files in Storage went through the
  Storage API, using a one-off edge function `purge-storage-once`, now a stub that does nothing, to be
  deleted in the dashboard.
- **Kept:** the Gibson family and its Week 1 registration (with one photo), the Sherrill household,
  and the logins of Lawrence, Ellen, Katie, Larry, Gibson and Sherrill. The money change log, staff
  access log and background-check review log stay. Where a deleted bot was the actor, the actor is
  now blank.
- **Found on the way: `0144`.** The payment-plan guard returned NEW for the owner, which on a delete
  is null, so it silently cancelled the cascade from a deleted registration. The 27 Oct test plan
  survived as an orphan with 20 scheduled charges. The guard now returns `coalesce(new, old)`, and the
  orphan is deleted. A check of every foreign key found no other orphan.

## 29 Oct 2026 — G3: the security audit after the purge

Run the same night as the purge. The RLS harness and the five rule suites pass on fresh databases.
The advisor shows only accepted items: the three definer views, `mfa_trusted_sessions` without a
policy, and definer functions open to signed-in or anonymous callers. The two that matter for
anonymous callers (`staff_lookup_by_email`, `set_check_in`) check `is_admin()` and Registration write
inside. The rest are trigger functions or the access helpers the policies need. Every table has RLS,
every definer function pins `search_path`, and no policy uses the old role functions. All 117 server
actions check a grant or the signed-in user, or are public by design. The service-role client is
reached only by the automatic emails and the prayer list, each staff use behind its grant.

**`npm audit` found a critical Next.js advisory** (16.0.0–16.4.0: remote code execution through the
image optimiser with SVGs and through `use cache`, and a Server Actions denial of service). Fixed by
moving to **Next 16.4.2** (15 Oct; 16.4.3 was under two weeks old). The two dev-only highs (zod and
brace-expansion, pulled in by ESLint, never shipped) are patched in the lockfile. `npm audit` shows 0.
Lint and the production build pass locally.
