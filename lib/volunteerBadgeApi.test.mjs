// Run with: npm run test:lib   (node --test, no packages needed)
// VolunteerBadge's client and what its answers mean (0165), with a mocked fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeVolunteerBadge,
  stripReportLinks,
  statusFromCheck,
  checkForInvite,
  volunteersAtEmail,
  refreshRequest,
  namesAgree,
  loadRoster,
  creditsFrom,
  VolunteerBadgeError,
} from './volunteerBadgeApi.js';

const KEY = 'vb_test_abc123SECRET';

// A fetch that answers from a table of "METHOD /path" -> [status, body], and
// records every call.
function mockFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    const path = url.replace('https://www.volunteerbadge.com/api/v1', '');
    calls.push({ method: init.method, path, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const hit = routes[`${init.method} ${path}`];
    if (hit instanceof Error) throw hit;
    if (!hit) return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
    const [status, body] = hit;
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}
const client = (routes) => {
  const f = mockFetch(routes);
  return { api: makeVolunteerBadge({ key: KEY, fetchImpl: f, gapMs: 0 }), calls: f.calls };
};

test('no key, no client; the key prefix says test or live', () => {
  assert.equal(makeVolunteerBadge({ key: '' }), null);
  assert.equal(makeVolunteerBadge({ key: 'vb_test_x', fetchImpl: () => {} }).sandbox, true);
  assert.equal(makeVolunteerBadge({ key: 'vb_live_x', fetchImpl: () => {} }).sandbox, false);
});

test('the client can do only the five allowed things', () => {
  const { api } = client({});
  assert.deepEqual(Object.keys(api).sort(), ['check', 'credits', 'sandbox', 'sendApplication', 'templates', 'volunteer', 'volunteersPage'].sort());
});

test('stripReportLinks removes report links at any depth', () => {
  const out = stripReportLinks({
    checkId: 'c1',
    reportUrl: 'https://x/signed',
    reportDownloadUrl: 'https://x/dl',
    checks: [{ id: 'c2', report_url: 'u', status: 'complete', nested: { reportPdfLink: 'p' } }],
  });
  assert.deepEqual(out, { checkId: 'c1', checks: [{ id: 'c2', status: 'complete', nested: {} }] });
});

test('sendApplication posts the invite with the key, the ministry paying, and returns no apply link', async () => {
  const { api, calls } = client({
    'POST /applications': [200, { applicationId: 'app-1', applyUrl: 'https://vb/apply/t', deliveryMethod: 'email', expiresAt: '2026-12-01T00:00:00Z' }],
  });
  const r = await api.sendApplication({ templateId: '3f9a1c22-7b64-4e08-9d15-8a2c7e4b1f60', email: ' Pat@Example.org ' });
  assert.deepEqual(r, { applicationId: 'app-1', expiresAt: '2026-12-01T00:00:00Z', sandbox: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.Authorization, `Bearer ${KEY}`);
  assert.deepEqual(calls[0].body, { templateId: '3f9a1c22-7b64-4e08-9d15-8a2c7e4b1f60', email: 'pat@example.org', volunteerPays: false });
});

test('sendApplication refuses a missing template or a bad address without calling VB', async () => {
  const { api, calls } = client({});
  await assert.rejects(api.sendApplication({ templateId: '', email: 'a@b.org' }), VolunteerBadgeError);
  await assert.rejects(api.sendApplication({ templateId: 'tpl-123456', email: 'nope' }), VolunteerBadgeError);
  assert.equal(calls.length, 0);
});

test('check() hands back the status with the report links gone', async () => {
  const { api } = client({
    'GET /checks/chk-1': [200, { checkId: 'chk-1', status: 'complete', result: 'clear', completedAt: '2026-11-13T18:00:00Z', reportUrl: 'r', reportDownloadUrl: 'd' }],
  });
  const c = await api.check('chk-1');
  assert.equal(c.reportUrl, undefined);
  assert.equal(c.reportDownloadUrl, undefined);
  assert.equal(c.result, 'clear');
});

test('errors are plain words, say whether VB may have acted, and never carry the key', async () => {
  const { api } = client({
    'GET /credits': [402, { error: 'Insufficient credits' }],
    'GET /templates': [403, { code: 'identity_verification_required' }],
    'POST /applications': [500, {}],
    'GET /checks/chk-9': new TypeError('fetch failed'),
  });
  const e402 = await api.credits().catch((e) => e);
  assert.equal(e402.status, 402);
  assert.equal(e402.uncertain, false);
  assert.match(e402.message, /out of credits/);
  const e403 = await api.templates().catch((e) => e);
  assert.match(e403.message, /identity check/);
  const e500 = await api.sendApplication({ templateId: 'tpl-123456', email: 'a@b.org' }).catch((e) => e);
  assert.equal(e500.uncertain, true);
  const eNet = await api.check('chk-9').catch((e) => e);
  assert.equal(eNet.status, 0);
  assert.equal(eNet.uncertain, true);
  for (const e of [e402, e403, e500, eNet]) assert.ok(!e.message.includes('SECRET'));
});

test('an id that is not an id is refused before any call', async () => {
  const { api, calls } = client({});
  await assert.rejects(api.check('../volunteers'), VolunteerBadgeError);
  await assert.rejects(api.volunteer('a b'), VolunteerBadgeError);
  assert.equal(calls.length, 0);
});

test('creditsFrom reads the likely spellings, and unknown is null, never 0', () => {
  assert.equal(creditsFrom({ credits: 12 }), 12);
  assert.equal(creditsFrom({ balance: 3 }), 3);
  assert.equal(creditsFrom({ credits: { available: 5 } }), 5);
  assert.equal(creditsFrom({ something: 'else' }), null);
  assert.equal(creditsFrom(null), null);
});

test('statusFromCheck: clear only from a finished clear check; unknown is never clear', () => {
  const s = (status, result) => statusFromCheck({ status, result });
  assert.equal(s('complete', 'clear'), 'clear');
  assert.equal(s('adjudicated', 'clear'), 'clear');
  assert.equal(s('adjudicated', 'consider'), 'consider');
  assert.equal(s('adjudicated', null), 'in_review');
  assert.equal(s('pending_adjudication', 'null'), 'in_review');
  assert.equal(s('hits_found', null), 'in_review');
  assert.equal(s('processing', null), 'processing');
  assert.equal(s('pending', null), 'processing');
  assert.equal(s('pending_auto_release', null), 'processing');
  assert.equal(s('error', null), 'error');
  assert.equal(s('refunded', null), 'error');
  assert.equal(s('complete', null), 'processing');
  assert.equal(s('something_new', 'clear'), 'processing');
});

test('checkForInvite takes the newest check started after the invite, never an older or undated one', () => {
  const sent = '2026-11-13T15:00:00Z';
  const checks = [
    { id: 'old', createdAt: '2025-11-01T00:00:00Z', type: 'full' },
    { id: 'undated' },
    { id: 'new1', createdAt: '2026-11-13T16:00:00Z', type: 'full' },
    { id: 'new2', createdAt: '2026-11-14T16:00:00Z', type: 'full' },
  ];
  assert.equal(checkForInvite(checks, sent).id, 'new2');
  assert.equal(checkForInvite([{ id: 'old', createdAt: '2025-11-01T00:00:00Z' }, { id: 'undated' }], sent), null);
  assert.equal(checkForInvite(undefined, sent), null);
});

test('volunteersAtEmail matches the address invited, ignoring case and spaces', () => {
  const roster = [{ id: 'v1', email: 'Pat@Example.org' }, { id: 'v2', email: 'sam@example.org' }];
  assert.deepEqual(volunteersAtEmail(roster, ' pat@example.org').map((v) => v.id), ['v1']);
  assert.deepEqual(volunteersAtEmail(roster, ''), []);
});

test('checkForInvite counts only a full check when VB says the kind', () => {
  const sent = '2026-11-13T15:00:00Z';
  const checks = [
    { id: 'direct', createdAt: '2026-11-14T10:00:00Z', type: 'direct' },
    { id: 'full', createdAt: '2026-11-13T16:00:00Z', type: 'full' },
  ];
  assert.equal(checkForInvite(checks, sent).id, 'full');
  assert.equal(checkForInvite([{ id: 'direct', createdAt: '2026-11-14T10:00:00Z', type: 'direct' }], sent), null);
});

test('namesAgree compares first names loosely, and has no answer when VB gives none', () => {
  assert.ok(namesAgree({ firstName: 'Samantha' }, { first_name: 'Sam' }));
  assert.ok(namesAgree({ first_name: 'pat' }, { first_name: 'Patricia', preferred_name: '' }));
  assert.ok(namesAgree({ firstName: 'Lee' }, { first_name: 'Robert', preferred_name: 'Lee' }));
  assert.ok(!namesAgree({ firstName: 'Lee' }, { first_name: 'Pat' }));
  assert.equal(namesAgree({ firstName: 'Al' }, { first_name: 'Alex' }), false);
  assert.equal(namesAgree({}, { first_name: 'Pat' }), null);
});

test('loadRoster says when it was cut short or carries no addresses', async () => {
  const { api } = client({
    'GET /volunteers?page=1&limit=100': [200, { volunteers: [{ id: 'v1', first_name: 'A' }], pagination: { totalPages: 3 } }],
    'GET /volunteers?page=2&limit=100': [200, { volunteers: [{ id: 'v2', first_name: 'B' }], pagination: { totalPages: 3 } }],
  });
  const r = await loadRoster(api, 2);
  assert.equal(r.complete, false);
  assert.equal(r.hasEmails, false);
  const { api: api2 } = client({
    'GET /volunteers?page=1&limit=100': [200, { volunteers: [{ id: 'v1', email: 'a@b.org' }], pagination: { totalPages: 1 } }],
  });
  const r2 = await loadRoster(api2);
  assert.equal(r2.complete, true);
  assert.equal(r2.hasEmails, true);
  assert.equal(r2.find('A@B.org')[0].id, 'v1');
});

const baseReq = {
  invited_email: 'pat@example.org',
  first_name: 'Pat',
  preferred_name: '',
  status: 'invited',
  vb_volunteer_id: null,
  vb_check_id: null,
  vb_check_status: null,
  vb_result: null,
  completed_at: null,
  problem: null,
  apply_expires_at: '2026-12-01T00:00:00Z',
  sent_at: '2026-11-13T15:00:00Z',
};
const roster = (rows, extra = {}) => ({
  rows,
  complete: true,
  hasEmails: true,
  find: (email) => volunteersAtEmail(rows, email),
  ...extra,
});

test('refreshRequest: found by address, a full check after the invite, clear', async () => {
  const { api } = client({
    'GET /volunteers/v1': [200, { id: 'v1', firstName: 'Pat', checks: [{ id: 'chk-1', createdAt: '2026-11-13T16:00:00Z', type: 'full' }] }],
    'GET /checks/chk-1': [200, { checkId: 'chk-1', status: 'complete', result: 'clear', completedAt: '2026-11-13T18:00:00Z', reportUrl: 'r' }],
  });
  const patch = await refreshRequest(baseReq, api, roster([{ id: 'v1', email: 'pat@example.org', first_name: 'Pat' }]), new Date('2026-11-14'));
  assert.deepEqual(patch, {
    vb_volunteer_id: 'v1',
    vb_check_id: 'chk-1',
    status: 'clear',
    vb_check_status: 'complete',
    vb_result: 'clear',
    completed_at: '2026-11-13T18:00:00Z',
    problem: null,
  });
});

test('refreshRequest: a record that was already there is not "applied", and saves nothing', async () => {
  const { api } = client({
    'GET /volunteers/v1': [200, { id: 'v1', firstName: 'Pat', createdAt: '2025-06-01T00:00:00Z', checks: [{ id: 'old', createdAt: '2025-06-02T00:00:00Z', type: 'full' }] }],
  });
  const r = roster([{ id: 'v1', email: 'pat@example.org', first_name: 'Pat' }]);
  assert.equal(await refreshRequest(baseReq, api, r, new Date('2026-11-20')), null);
  // ...and once the link has run out, it expires so they can be sent again.
  assert.deepEqual(await refreshRequest(baseReq, api, r, new Date('2026-12-02')), { status: 'expired' });
});

test('refreshRequest: a record made since the invite with no check yet is applied, and never expires', async () => {
  const { api } = client({ 'GET /volunteers/v1': [200, { id: 'v1', createdAt: '2026-11-13T17:00:00Z', checks: [] }] });
  const r = roster([{ id: 'v1', email: 'pat@example.org' }]);
  assert.deepEqual(await refreshRequest(baseReq, api, r, new Date('2026-12-02')), { status: 'applied', problem: null });
  assert.equal(await refreshRequest({ ...baseReq, status: 'applied' }, api, r, new Date('2026-12-02')), null);
});

test('refreshRequest: a different first name at the address is never linked', async () => {
  const { api, calls } = client({});
  const patch = await refreshRequest(baseReq, api, roster([{ id: 'v1', email: 'pat@example.org', firstName: 'Lee' }]));
  assert.match(patch.problem, /different/);
  assert.equal(patch.vb_check_id, undefined);
  assert.equal(calls.length, 0);
});

test('refreshRequest: nobody on the roster expires only on a full roster read with addresses', async () => {
  const { api } = client({});
  const late = new Date('2026-12-02');
  assert.equal(await refreshRequest(baseReq, api, roster([]), new Date('2026-11-20')), null);
  assert.deepEqual(await refreshRequest(baseReq, api, roster([]), late), { status: 'expired' });
  assert.equal(await refreshRequest(baseReq, api, roster([], { complete: false }), late), null);
  const noMail = await refreshRequest(baseReq, api, roster([{ id: 'v1' }], { hasEmails: false }), late);
  assert.match(noMail.problem, /no email addresses/);
  // A send that never got an answer is never expired.
  assert.equal(await refreshRequest({ ...baseReq, status: 'sending' }, api, roster([]), late), null);
});

test('refreshRequest: two VB volunteers at one address is not guessed at', async () => {
  const { api } = client({});
  const patch = await refreshRequest(
    baseReq,
    api,
    roster([
      { id: 'a', email: 'pat@example.org' },
      { id: 'b', email: 'pat@example.org' },
    ])
  );
  assert.match(patch.problem, /More than one/);
  assert.equal(patch.status, undefined);
});

test('refreshRequest: a failed check keeps our words, not the message VB gives about the person', async () => {
  const { api } = client({ 'GET /checks/chk-2': [200, { status: 'error', result: null, errorMessage: 'Jane Smith: SSN mismatch' }] });
  const patch = await refreshRequest({ ...baseReq, status: 'processing', vb_volunteer_id: 'v1', vb_check_id: 'chk-2' }, api, roster([]));
  assert.equal(patch.status, 'error');
  assert.ok(!patch.problem.includes('Jane'));
});

test('refreshRequest: nothing new is null', async () => {
  const { api } = client({ 'GET /checks/chk-3': [200, { status: 'processing', result: null, completedAt: null }] });
  const req = { ...baseReq, status: 'processing', vb_volunteer_id: 'v1', vb_check_id: 'chk-3', vb_check_status: 'processing' };
  assert.equal(await refreshRequest(req, api, roster([])), null);
});

test('refreshRequest: with no name to compare, only a record made since the invite is trusted', async () => {
  const old = client({ 'GET /volunteers/v1': [200, { id: 'v1', createdAt: '2025-06-01T00:00:00Z', checks: [{ id: 'chk-9', createdAt: '2026-11-14T00:00:00Z', type: 'full' }] }] });
  const p1 = await refreshRequest(baseReq, old.api, roster([{ id: 'v1', email: 'pat@example.org' }]));
  assert.match(p1.problem, /different/);
  const made = client({
    'GET /volunteers/v1': [200, { id: 'v1', createdAt: '2026-11-13T16:00:00Z', checks: [{ id: 'chk-9', createdAt: '2026-11-14T00:00:00Z', type: 'full' }] }],
    'GET /checks/chk-9': [200, { status: 'processing', result: null }],
  });
  const p2 = await refreshRequest(baseReq, made.api, roster([{ id: 'v1', email: 'pat@example.org' }]));
  assert.equal(p2.vb_check_id, 'chk-9');
  assert.equal(p2.status, 'processing');
});

test('the client keeps only allow-listed fields: no birth date, SSN digits, address or phone', async () => {
  const { api } = client({
    'GET /volunteers/v1': [200, { id: 'v1', firstName: 'Pat', dob: '1980-01-01', ssnLast4: '1234', address: { street: 'x' }, phone: '555', checks: [{ id: 'c', status: 'complete', reportUrl: 'r', offenderCount: 2 }] }],
    'GET /volunteers?page=1&limit=100': [200, { volunteers: [{ id: 'v1', email: 'a@b.org', first_name: 'Pat', last_name: 'T', phone: '555' }], pagination: { totalPages: 1 } }],
  });
  const v = await api.volunteer('v1');
  assert.deepEqual(v, { id: 'v1', firstName: 'Pat', checks: [{ id: 'c', status: 'complete' }] });
  const page = await api.volunteersPage(1, 100);
  assert.deepEqual(page.volunteers, [{ id: 'v1', email: 'a@b.org', first_name: 'Pat' }]);
});

test('loadRoster without a page count reads on until a short page', async () => {
  const full = Array.from({ length: 100 }, (_, i) => ({ id: `v${i}`, email: `p${i}@b.org` }));
  const { api } = client({
    'GET /volunteers?page=1&limit=100': [200, { volunteers: full }],
    'GET /volunteers?page=2&limit=100': [200, { volunteers: [{ id: 'last', email: 'z@b.org' }] }],
  });
  const r = await loadRoster(api);
  assert.equal(r.complete, true);
  assert.equal(r.rows.length, 101);
});

test('sendApplication waives the ID step only when asked, with a reason', async () => {
  const { api, calls } = client({ 'POST /applications': [200, { applicationId: 'app-2' }] });
  await api.sendApplication({ templateId: 'tpl-123456', email: 'a@b.org' });
  assert.equal('requireIdVerification' in calls[0].body, false);
  await api.sendApplication({ templateId: 'tpl-123456', email: 'a@b.org', waiveIdReason: 'Declined the photo ID step; approved by Larry' });
  assert.equal(calls[1].body.requireIdVerification, false);
  assert.equal(calls[1].body.idVerificationReason, 'Declined the photo ID step; approved by Larry');
  await assert.rejects(api.sendApplication({ templateId: 'tpl-123456', email: 'a@b.org', waiveIdReason: 'short' }), VolunteerBadgeError);
  assert.equal(calls.length, 2);
});

test('refreshRequest: a check that is not this volunteer’s, or not an application’s, is refused', async () => {
  const other = client({
    'GET /volunteers/v1': [200, { id: 'v1', firstName: 'Pat', checks: [{ id: 'chk-5', created_at: '2026-11-14T00:00:00Z' }] }],
    'GET /checks/chk-5': [200, { status: 'complete', result: 'clear', volunteerId: 'v9' }],
  });
  const p1 = await refreshRequest(baseReq, other.api, roster([{ id: 'v1', email: 'pat@example.org', first_name: 'Pat' }]));
  assert.match(p1.problem, /isn’t one from this invite/);
  assert.equal(p1.status, undefined);
  const direct = client({
    'GET /volunteers/v1': [200, { id: 'v1', firstName: 'Pat', checks: [{ id: 'chk-6', created_at: '2026-11-14T00:00:00Z' }] }],
    'GET /checks/chk-6': [200, { status: 'complete', result: 'clear', volunteerId: 'v1', type: 'direct' }],
  });
  const p2 = await refreshRequest(baseReq, direct.api, roster([{ id: 'v1', email: 'pat@example.org', first_name: 'Pat' }]));
  assert.match(p2.problem, /isn’t one from this invite/);
});

test('VB’s own error words are kept only for a refused invite', async () => {
  const { api } = client({
    'POST /applications': [400, { error: 'email is invalid' }],
    'GET /checks/chk-7': [400, { error: 'Jane Smith record locked' }],
  });
  const e1 = await api.sendApplication({ templateId: 'tpl-123456', email: 'a@b.org' }).catch((e) => e);
  assert.match(e1.message, /email is invalid/);
  const e2 = await api.check('chk-7').catch((e) => e);
  assert.ok(!e2.message.includes('Jane'));
});

test('refreshRequest: a check VB says has no volunteer (a direct check) is refused', async () => {
  const { api } = client({
    'GET /volunteers/v1': [200, { id: 'v1', firstName: 'Pat', checks: [{ id: 'chk-8', created_at: '2026-11-14T00:00:00Z' }] }],
    'GET /checks/chk-8': [200, { status: 'complete', result: 'clear', volunteerId: null }],
  });
  const p = await refreshRequest(baseReq, api, roster([{ id: 'v1', email: 'pat@example.org', first_name: 'Pat' }]));
  assert.match(p.problem, /isn’t one from this invite/);
});
