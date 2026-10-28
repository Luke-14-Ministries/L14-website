# Luke 14 Ministries — website and registration platform (preview)

The ministry's public website (a rebuild of [luke14ministries.net](https://luke14ministries.net))
and its own camp registration, family-account, giving and staff-admin platform. Every page shows a
red **PREVIEW / TEST BUILD** banner until launch, so nobody mistakes it for the official site.

**Live preview:** <https://luke14-ministries.vercel.app>

## Run locally

```powershell
npm ci             # installs the exact tested versions; use this, not npm install
npm run dev        # http://localhost:3000
```

Requires **Node.js 24 LTS** — the same major version Vercel builds with, so "it built on my
machine" and "it built on Vercel" are the same answer.

**You also need `.env.local` before either command does anything useful.** Without it the site
compiles and then dies at the end of `npm run build` with
`@supabase/ssr: Your project's URL and API key are required`. The fastest fix, which never puts a
key on the clipboard or in a chat window:

```powershell
npx vercel login
npx vercel link          # pick the luke14-ministries project
npx vercel env pull .env.local
```

Failing that, copy `.env.example` to `.env.local` and fill in the two `NEXT_PUBLIC_SUPABASE_*`
values from the Supabase dashboard. Those two are safe in a browser by design — that is what the
prefix means — and they are all a local build needs. `.env.local` is gitignored; keep it that way.

New here? Read [CONTRIBUTING.md](CONTRIBUTING.md) first — it covers setup, the everyday git
workflow, project layout, and the security rules.

## How it deploys

**Vercel** watches `main` and rebuilds on every push that touches the site — a push that changes
only Markdown documents is skipped, by `scripts/vercel-ignore.sh` (run by the `ignoreCommand` in
`vercel.json`; a Redeploy of the commit already live always builds, which is how a changed
environment variable reaches the site). Nothing is uploaded by
hand, and there is no deploy workflow in this repository to maintain — Vercel's GitHub integration
does the watching.

There *is* one GitHub Action: `.github/workflows/build.yml`. It lints and builds on every push to
`main` and deploys nothing — it exists so a broken build arrives as an email in about three minutes
rather than as a stale preview somebody notices days later. It needs no secrets.

`NEXT_PUBLIC_BASE_PATH` must stay **unset** on Vercel. Setting it breaks every link and every image,
and it fails in a way that looks like a styling problem rather than a configuration one. The site is
not a static export and GitHub Pages is retired; do not revive either.

## What's here

**Phase 3 — built, in staff testing.** Next.js 16 on Vercel, Supabase (Postgres, auth, row-level
security), Stripe in test mode. The public pages recreate the current site (photos self-hosted in
`public/images/`). The platform is real, not a mock-up: family accounts and households, the
registration wizard with tracked edits, card and bank payments with receipts, payment plans (switched on by
`supabase/PAYMENT-PLANS-SETUP.md`), scholarships, discounts and refunds, the volunteer application with background checks by Checkr
file export, giving with year-end statements, and the staff admin — rosters, check-in, dietary and
medical lists, rooms, buddies, activities, programs, Event Payments, Giving, and Staff & Access,
where each staff member holds read or write grants on eleven areas (Prayer list since `0141`); the
automatic reminder emails (`0138`) and the prayer email list. Migrations run through `0142`
(`supabase/migrations/`); the row-level security harness runs with
`bash supabase/tests/run_rls_local.sh` and must end `ALL CHECKS PASSED`.

**Payments:** Stripe's nonprofit rate (2.2% + 30¢ on domestic cards) was granted account-wide on
18 August 2026 — registration included; it holds while at least 80% of the account's volume is
gifts, so giving stays on the same account (`DECISIONS.md`, 2026-08-18). Test keys only until launch.

**Before launch (Phase 4, in three sittings; board approval required for the last two):** Stage A
(done 28 Oct 2026: server keys, Stripe live mode prepared with its **three** live webhook endpoints,
the Cloudflare copy of the domain); then purge all test data and a security audit; Stage B, live
Stripe keys with staff-only real payments at the preview address; Stage C, the domain pointed and
transferred to Cloudflare, and all four preview switches reversed together —
`components/PreviewBanner.jsx`, `public/robots.txt`, the `robots: { index: false }` block in
`app/layout.jsx`, and the "(Preview Build)" title suffix. Missing one fails silently. Vercel is on
Pro since 20 Oct 2026. The steps are DO-THIS-NEXT *Go live*.

**Where to read more:** `CLAUDE.md` (the standing brief — what is true now and what not to break),
`DECISIONS.md` (why), `CONTRIBUTING.md` (how to work), `supabase/PAYMENT-PLANS-SETUP.md`. The
ordered checklist (`DO-THIS-NEXT`), plans, staff questions and testing scripts live in the
ministry's SharePoint library.

## Content notes

- Some Squarespace video embeds and galleries could not be captured — placeholders are used.
- Newsletter and Wheels for Kenya sign-ups still link to the existing Google Forms, and speaker
  bookings to the existing Airtable form. The Pray page's sign-up is the site's own prayer email list
  (28 Oct 2026). The Hazelnut Movement is no longer part of Luke 14 and is gone from the site.

## Project documentation

Plans, vendor decisions, account inventory, brand assets and board materials live in the
ministry's SharePoint team site under **Website** — not in this repository. Secrets live in the
password vault. Neither ever belongs in git.
