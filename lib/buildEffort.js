// The website build effort and running costs report (0188, Lawrence, 28 Nov
// 2026): the arithmetic behind /admin/build-effort, from one snapshot's JSON.
//
// The repository is public, so no figure lives here: hours, tokens, hire-out
// estimates, rates and the running-cost settings all come from the snapshot
// row (build_effort_snapshots.data). This file holds only the formulas, the
// same ones as the Claude dashboard of 10 Nov 2026 the page replaced. A rate
// the snapshot lacks is reported, never shown as NaN or zero. No server-only
// imports, so `npm run test:lib` loads it.

const n = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);
const sum = (rows, key) => (rows ?? []).reduce((a, r) => a + n(r[key]), 0);
const round1 = (v) => Math.round(v * 10) / 10;

// The late-night window for messages: 10 PM to 6 AM Eastern.
export const isNightHour = (h) => h >= 22 || h < 6;

// The headline figures: hours (measured plus estimated, low/mid/high),
// tokens in billions (measured, plus the July to mid-September estimate),
// pay-as-you-go dollars, and the totals across the weeks.
export function effortSummary(data) {
  const weekly = data?.weekly ?? [];
  const mix = data?.token_mix ?? [];
  const est = data?.estimates ?? [];
  const hoursRows = est.filter((r) => r.what === 'Hours at the keyboard');
  const tok = est.find((r) => String(r.what).startsWith('Claude tokens')) ?? {};
  const usd = est.find((r) => String(r.what).startsWith('Pay-as-you-go')) ?? {};
  const measuredTokens = sum(mix, 'total_tokens');
  const hours = { low: sum(hoursRows, 'low'), mid: sum(hoursRows, 'mid'), high: sum(hoursRows, 'high') };
  // The measured rows say "Measured" in how they were worked out.
  hours.measuredMid = hoursRows.filter((r) => /^measured/i.test(String(r.how))).reduce((a, r) => a + n(r.mid), 0);
  return {
    commits: sum(weekly, 'commits'),
    prompts: sum(weekly, 'prompts'),
    hoursMeasured: Math.round(sum(weekly, 'hours_measured')),
    hours,
    tokens: {
      measuredB: round1(measuredTokens / 1e9),
      totalB: round1((measuredTokens + n(tok.mid) * 1e6) / 1e9),
      earlyB: { low: round1(n(tok.low) / 1000), mid: round1(n(tok.mid) / 1000), high: round1(n(tok.high) / 1000) },
      calls: sum(mix, 'calls'),
      cacheReadPct: measuredTokens ? Math.round((sum(mix, 'cache_read_tokens') / measuredTokens) * 100) : 0,
    },
    api: {
      measured: sum(mix, 'api_equivalent_usd'),
      early: { low: n(usd.low), mid: n(usd.mid), high: n(usd.high) },
      total: sum(mix, 'api_equivalent_usd') + n(usd.mid),
    },
  };
}

// Messages by hour of day, and how many fell at night.
export function nightMessages(promptHours) {
  const rows = promptHours ?? [];
  return {
    night: rows.filter((r) => isNightHour(n(r.hour_et))).reduce((a, r) => a + n(r.prompts), 0),
    total: sum(rows, 'prompts'),
  };
}

// The model table in millions of tokens. "Read new" is fresh input plus what
// was saved for re-reading; "Re-read" is the saved copy read again.
export function tokenMixRows(mix) {
  const m = (v) => round1(n(v) / 1e6);
  const rows = (mix ?? []).map((r) => ({
    model: r.model,
    calls: n(r.calls),
    newM: m(n(r.input_tokens) + n(r.cache_write_tokens)),
    outputM: m(r.output_tokens),
    rereadM: m(r.cache_read_tokens),
    totalM: m(r.total_tokens),
    usd: n(r.api_equivalent_usd),
  }));
  const total = {
    model: 'Total',
    calls: sum(mix, 'calls'),
    newM: m(sum(mix, 'input_tokens') + sum(mix, 'cache_write_tokens')),
    outputM: m(sum(mix, 'output_tokens')),
    rereadM: m(sum(mix, 'cache_read_tokens')),
    totalM: m(sum(mix, 'total_tokens')),
    usd: sum(mix, 'api_equivalent_usd'),
  };
  return { rows, total };
}

// Hire-out rows by kind: the options (a range each), the one "most likely"
// summary, and the before-AI reference.
export function hireOut(rows) {
  const all = rows ?? [];
  return {
    options: all.filter((r) => r.kind === 'option'),
    summary: all.find((r) => r.kind === 'summary') ?? null,
    reference: all.find((r) => r.kind === 'reference') ?? null,
  };
}

// ---- Running costs, old setup against new --------------------------------

export const RUN_RATE_KEYS = [
  'campsite_pct', 'campsite_flat_yr', 'squarespace_yr', 'squarespace_domain_yr', 'checkr_each',
  'paypal_pct', 'paypal_fixed', 'stripe_card_pct', 'stripe_card_fixed', 'stripe_bank_pct',
  'stripe_bank_cap', 'vercel_yr', 'supabase_yr', 'cloudflare_domain_yr', 'volunteerbadge_each',
  'mailchimp_yr', 'scholarships_last', 'scholarship_people', 'avg_gift',
];
export const RUN_SETTING_KEYS = ['campers', 'volunteers', 'fee', 'scholarships', 'gifts', 'bank_pct', 'cover_pct'];

// The rates by key, or { missing } naming what the snapshot lacks.
export function rateMap(rates) {
  const r = {};
  for (const x of rates ?? []) {
    const v = Number(x.value);
    if (x.key && Number.isFinite(v)) r[x.key] = v;
  }
  const missing = RUN_RATE_KEYS.filter((k) => !(k in r));
  return missing.length ? { missing } : { r };
}

const pctWords = (v) => `${v}%`;
const centsWords = (dollars) => (dollars < 1 ? `${Math.round(dollars * 100)}¢` : `$${dollars.toFixed(2)}`);
const monthly = (yearly) => {
  const m = yearly / 12;
  return Number.isInteger(m) ? `$${m}` : `$${m.toFixed(2)}`;
};

// Each line a year, old and new, at the snapshot's settings. Everyone pays
// the same week fee in one payment; scholarships come off first (no card is
// charged for them). Stripe splits card and bank by the bank share; payers
// who cover the fee take their share off the new cost.
export function runModel(rates, settings) {
  const got = rateMap(rates);
  if (got.missing) return { error: `The snapshot has no rate for ${got.missing.join(', ')}.` };
  const missingSettings = RUN_SETTING_KEYS.filter((k) => !Number.isFinite(Number(settings?.[k])));
  if (missingSettings.length) return { error: `The snapshot has no setting for ${missingSettings.join(', ')}.` };
  const r = got.r;
  const s = Object.fromEntries(RUN_SETTING_KEYS.map((k) => [k, Math.max(0, Number(settings[k]))]));
  const keepMailchimp = settings.keep_mailchimp !== false;
  const b = Math.min(100, s.bank_pct) / 100;
  const keep = 1 - Math.min(100, s.cover_pct) / 100;
  const stripe = (count, each) => {
    if (!count || !each) return 0;
    const card = (each * r.stripe_card_pct) / 100 + r.stripe_card_fixed;
    const bank = Math.min((each * r.stripe_bank_pct) / 100, r.stripe_bank_cap);
    return count * ((1 - b) * card + b * bank);
  };
  const reg = Math.max(0, (s.campers + s.volunteers) * s.fee - s.scholarships);
  const payments = s.fee ? reg / s.fee : 0;
  const giftCount = r.avg_gift ? s.gifts / r.avg_gift : 0;
  const stripeWords =
    `Stripe: card ${pctWords(r.stripe_card_pct)} + ${centsWords(r.stripe_card_fixed)}, bank ${pctWords(r.stripe_bank_pct)}` +
    (s.cover_pct ? `, less the ${s.cover_pct}% who cover it` : '');
  const raw = [
    ['Registration payments', `CampSite ${pctWords(r.campsite_pct)} of every dollar`, (reg * r.campsite_pct) / 100, stripeWords, keep * stripe(payments, s.fee)],
    ['Registration platform flat fees', `CampSite ${monthly(r.campsite_flat_yr)} a month`, r.campsite_flat_yr, 'None', 0],
    ['Website and hosting', 'Squarespace plan', r.squarespace_yr, `Vercel ${monthly(r.vercel_yr)} + Supabase ${monthly(r.supabase_yr)} a month`, r.vercel_yr + r.supabase_yr],
    ['Domain', 'At Squarespace', r.squarespace_domain_yr, 'At Cloudflare, at cost', r.cloudflare_domain_yr],
    ['Online gifts', `PayPal ${pctWords(r.paypal_pct)} + ${centsWords(r.paypal_fixed)}`, (s.gifts * r.paypal_pct) / 100 + giftCount * r.paypal_fixed, stripeWords, keep * stripe(giftCount, r.avg_gift)],
    ['Background checks', `Checkr Basic $${r.checkr_each} each`, s.volunteers * r.checkr_each, `VolunteerBadge $${r.volunteerbadge_each} each`, s.volunteers * r.volunteerbadge_each],
    ['Newsletter', 'Mailchimp', r.mailchimp_yr, keepMailchimp ? 'Mailchimp (kept)' : 'The site’s own email', keepMailchimp ? r.mailchimp_yr : 0],
  ];
  const lines = raw.map(([line, oldWay, oldCost, newWay, newCost]) => {
    const o = Math.round(oldCost);
    const w = Math.round(newCost);
    return { line, oldWay, old: o, newWay, new: w, saving: o - w };
  });
  const old = lines.reduce((a, l) => a + l.old, 0);
  const nw = lines.reduce((a, l) => a + l.new, 0);
  const avgScholarship = r.scholarship_people ? r.scholarships_last / r.scholarship_people : 0;
  return {
    lines,
    totals: {
      old,
      new: nw,
      saving: old - nw,
      savingPct: old ? Math.round(((old - nw) / old) * 100) : 0,
      registrations: Math.round(reg),
      checks: s.volunteers,
      avgScholarship: Math.round(avgScholarship),
      scholarshipsEquiv: avgScholarship ? Math.round((old - nw) / avgScholarship) : 0,
    },
  };
}

// The same totals at 0% to 100% of payments by bank transfer.
export function runSensitivity(rates, settings, shares = [0, 25, 50, 75, 100]) {
  return shares.map((share) => {
    const m = runModel(rates, { ...settings, bank_pct: share });
    if (m.error) return { share, error: m.error };
    return { share, old: m.totals.old, new: m.totals.new, saving: m.totals.saving };
  });
}
