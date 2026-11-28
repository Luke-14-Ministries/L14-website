// Run with: npm run test:lib   (node --test, no packages needed)
// Every figure here is made up: the real ones live only in the database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effortSummary, nightMessages, tokenMixRows, hireOut, runModel, runSensitivity, rateMap, RUN_RATE_KEYS } from './buildEffort.js';

const data = {
  weekly: [
    { week_start: '2026-01-05', commits: 3, hours_measured: 0, prompts: 0 },
    { week_start: '2026-01-12', commits: 7, hours_measured: 2.6, prompts: 5 },
  ],
  estimates: [
    { what: 'Hours at the keyboard', how: 'Measured from records', low: 10, mid: 12, high: 15 },
    { what: 'Hours at the keyboard', how: 'Estimated from commits', low: 5, mid: 8, high: 11 },
    { what: 'Claude tokens (millions)', low: 100, mid: 1500, high: 3000 },
    { what: 'Pay-as-you-go cost (USD)', low: 20, mid: 40, high: 90 },
  ],
  token_mix: [
    { model: 'A', calls: 10, input_tokens: 1e6, output_tokens: 2e6, cache_write_tokens: 3e6, cache_read_tokens: 494e6, total_tokens: 500e6, api_equivalent_usd: 30 },
    { model: 'B', calls: 5, input_tokens: 0, output_tokens: 1e6, cache_write_tokens: 1e6, cache_read_tokens: 498e6, total_tokens: 500e6, api_equivalent_usd: 10 },
  ],
};

test('the headline: measured plus estimated hours and tokens, each part kept apart', () => {
  const s = effortSummary(data);
  assert.equal(s.commits, 10);
  assert.equal(s.prompts, 5);
  assert.equal(s.hoursMeasured, 3);
  assert.deepEqual(s.hours, { low: 15, mid: 20, high: 26, measuredMid: 12 });
  assert.equal(s.tokens.measuredB, 1);
  assert.equal(s.tokens.totalB, 2.5);
  assert.deepEqual(s.tokens.earlyB, { low: 0.1, mid: 1.5, high: 3 });
  assert.equal(s.tokens.calls, 15);
  assert.equal(s.tokens.cacheReadPct, 99);
  assert.equal(s.api.measured, 40);
  assert.equal(s.api.total, 80);
});

test('night is 10 PM to 6 AM', () => {
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour_et: h, prompts: 1 }));
  assert.deepEqual(nightMessages(hours), { night: 8, total: 24 });
  assert.deepEqual(nightMessages([]), { night: 0, total: 0 });
});

test('the model table in millions, with a total row', () => {
  const { rows, total } = tokenMixRows(data.token_mix);
  assert.deepEqual(rows[0], { model: 'A', calls: 10, newM: 4, outputM: 2, rereadM: 494, totalM: 500, usd: 30 });
  assert.equal(total.totalM, 1000);
  assert.equal(total.usd, 40);
});

test('hire-out rows sorted by kind', () => {
  const h = hireOut([
    { scenario: 'X', kind: 'option' },
    { scenario: 'Y', kind: 'option' },
    { scenario: 'Likely', kind: 'summary' },
    { scenario: 'Before', kind: 'reference' },
  ]);
  assert.equal(h.options.length, 2);
  assert.equal(h.summary.scenario, 'Likely');
  assert.equal(h.reference.scenario, 'Before');
});

// Round made-up rates so the sums can be checked by hand.
const rates = Object.entries({
  campsite_pct: 10, campsite_flat_yr: 120, squarespace_yr: 200, squarespace_domain_yr: 20, checkr_each: 20,
  paypal_pct: 2, paypal_fixed: 0.5, stripe_card_pct: 2, stripe_card_fixed: 0.5, stripe_bank_pct: 1,
  stripe_bank_cap: 3, vercel_yr: 120, supabase_yr: 240, cloudflare_domain_yr: 10, volunteerbadge_each: 5,
  mailchimp_yr: 100, scholarships_last: 1000, scholarship_people: 10, avg_gift: 50,
}).map(([key, value]) => ({ key, value }));
const settings = { campers: 8, volunteers: 2, fee: 100, scholarships: 0, gifts: 1000, bank_pct: 0, cover_pct: 0, keep_mailchimp: true };

test('running costs line by line, at the snapshot settings', () => {
  const m = runModel(rates, settings);
  assert.equal(m.error, undefined);
  const by = Object.fromEntries(m.lines.map((l) => [l.line, l]));
  // 10 people × $100 = $1,000 through registration.
  assert.equal(by['Registration payments'].old, 100); // 10%
  assert.equal(by['Registration payments'].new, 25); // 10 × ($2 + 50¢)
  assert.equal(by['Registration payments'].oldWay, 'CampSite 10% of every dollar');
  assert.equal(by['Registration payments'].newWay, 'Stripe: card 2% + 50¢, bank 1%');
  assert.equal(by['Registration platform flat fees'].oldWay, 'CampSite $10 a month');
  assert.equal(by['Website and hosting'].new, 360);
  assert.equal(by['Online gifts'].old, 30); // 2% of $1,000 + 20 gifts × 50¢
  assert.equal(by['Online gifts'].new, 30); // 20 × ($1 + 50¢)
  assert.equal(by['Background checks'].old, 40);
  assert.equal(by['Background checks'].new, 10);
  assert.equal(by.Newsletter.saving, 0);
  assert.equal(m.totals.old, 100 + 120 + 200 + 20 + 30 + 40 + 100);
  assert.equal(m.totals.new, 25 + 0 + 360 + 10 + 30 + 10 + 100);
  assert.equal(m.totals.saving, m.totals.old - m.totals.new);
  assert.equal(m.totals.avgScholarship, 100);
});

test('bank transfers, the cap, covered fees and scholarships', () => {
  const allBank = runModel(rates, { ...settings, bank_pct: 100 });
  assert.equal(allBank.lines[0].new, 10); // 1% of $100, under the $3 cap
  const big = runModel(rates, { ...settings, fee: 1000, bank_pct: 100 });
  assert.equal(big.lines[0].new, 30); // capped at $3 each
  const covered = runModel(rates, { ...settings, cover_pct: 100 });
  assert.equal(covered.lines[0].new, 0);
  assert.match(covered.lines[0].newWay, /less the 100% who cover it/);
  const schol = runModel(rates, { ...settings, scholarships: 500 });
  assert.equal(schol.totals.registrations, 500);
  assert.equal(schol.lines[0].old, 50);
  const own = runModel(rates, { ...settings, keep_mailchimp: false });
  assert.equal(own.lines[6].new, 0);
});

test('a missing rate or setting is said, never read as zero', () => {
  assert.match(runModel(rates.filter((x) => x.key !== 'checkr_each'), settings).error, /no rate for checkr_each/);
  assert.match(runModel(rates, { ...settings, fee: undefined }).error, /no setting for fee/);
  assert.deepEqual(rateMap([]).missing, RUN_RATE_KEYS);
});

test('the bank-transfer table runs the model at each share', () => {
  const t = runSensitivity(rates, settings);
  assert.deepEqual(t.map((x) => x.share), [0, 25, 50, 75, 100]);
  assert.ok(t[4].new < t[0].new);
  assert.equal(t[0].old, t[4].old);
});
