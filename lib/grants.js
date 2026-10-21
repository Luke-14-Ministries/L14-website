// The grants model -- the ten areas and the presets (Luke14-Access-Model-Plan,
// 15-16 Oct 2026; build plan item 16, step 1 and 2).
//
// Plain module: imported by the Staff & Access page (server), its actions and
// its client component. One list of areas, one table of presets, so the page
// and the database vocabulary (staff_grants.area, migration 0100) cannot
// drift apart.
//
// Since 0101 (17 Oct 2026) the grants ARE the access: every row-level policy
// asks has_grant(area, level) and every page asks can(staff, 'read:<area>'
// | 'write:<area>'). The role column says one thing -- 'admin' (granting,
// accounts, naming a leader, the doctor's grant) -- the tick on the page.
// Presets set areas only (21 Oct 2026); 'registrar' and 'coordinator' are
// labels nothing reads.

export const AREAS = [
  ['registration', 'Registration info', 'Names, contact details, the demographic questions, who is coming to what, status.'],
  ['payments', 'Payments & scholarships', 'Payments, refunds, balances, scholarship requests and decisions, deposit flags.'],
  ['giving', 'Giving', 'Donor gifts and year-end statements. Never implied by a preset — ticked by hand for a named person.'],
  ['background_checks', 'Background checks', 'Read: on file, current, verdict. Write (ordering, importing, the verdict) is the administrator’s alone.'],
  ['sensitive', 'Sensitive', 'Medical, disability and support needs, allergies, seizure plans, camper photos.'],
  ['setup', 'Events & camp setup', 'The definitions: events, prices, dates, agreements; activities offered; buildings and rooms; the programs list.'],
  ['activities', 'Activities', 'Who is signed up for what.'],
  ['rooming', 'Rooming', 'Who sleeps where.'],
  ['buddies', 'Buddies', 'Pairings, and publishing them.'],
  ['programs', 'Programs', 'Who is in which program. Naming a leader stays with administrators.'],
];
export const AREA_KEYS = AREAS.map(([k]) => k);
export const AREA_LABEL = Object.fromEntries(AREAS.map(([k, l]) => [k, l]));
export const LEVELS = ['read', 'write'];

// Giving is never set by a preset (plan, note 5): applying one leaves it as
// it is. Everything else is set exactly -- an area the preset does not name
// is removed.
export const PRESET_LEAVES = new Set(['giving']);

// Each preset: the ticks (plan §2d), plus the role label (only 'admin' is
// read, by is_admin()) and the three legacy flags, kept in step for the
// record.
export const PRESETS = {
  // Until 21 Oct 2026 this preset was called "Administrator" and also set the
  // administrator tick, so one word meant "the one power" in the column and
  // "everything" here (Lawrence). A preset now sets areas only; the tick is
  // the tick.
  everything: {
    label: 'Every area, read and write',
    note: 'All nine areas at write. Does not make an administrator — that is the tick.',
    sensitive: true,
    backgroundChecks: true,
    grants: {
      registration: 'write', payments: 'write', background_checks: 'write', sensitive: 'write',
      setup: 'write', activities: 'write', rooming: 'write', buddies: 'write', programs: 'write',
    },
  },
  coordination: {
    label: 'Registration & coordination',
    note: 'Katie, Ellen. Families, money and placements; reads background-check facts and the programs list.',
    sensitive: true,
    backgroundChecks: false,
    grants: {
      registration: 'write', payments: 'write', background_checks: 'read', sensitive: 'write',
      activities: 'write', rooming: 'write', buddies: 'write', programs: 'read',
    },
  },
  finance: {
    label: 'Finance',
    note: 'Records payments and refunds; reads names and events. Scholarship decisions need Registration write too, so they stay with Registration & coordination (0102).',
    sensitive: false,
    backgroundChecks: false,
    grants: { registration: 'read', payments: 'write' },
  },
  ops_lead: {
    label: 'Operations lead',
    note: 'Robin Gibson. Check-in: contact details at the door, moves people between rooms and activities; no payment information.',
    sensitive: true,
    backgroundChecks: false,
    grants: {
      registration: 'write', sensitive: 'read', activities: 'write', rooming: 'write',
      buddies: 'read', programs: 'read',
    },
  },
  ops_helper: {
    label: 'Operations helper',
    note: 'Reads what is needed to move people around camp safely; writes nothing.',
    sensitive: true,
    backgroundChecks: false,
    grants: {
      registration: 'read', sensitive: 'read', activities: 'read', rooming: 'read',
      buddies: 'read', programs: 'read',
    },
  },
};

// The grants a preset produces for a member, keeping what presets leave alone.
export function grantsForPreset(key, current = {}) {
  const p = PRESETS[key];
  if (!p) return null;
  const next = {};
  for (const k of AREA_KEYS) {
    if (PRESET_LEAVES.has(k)) {
      if (current[k]) next[k] = current[k];
    } else if (p.grants[k]) {
      next[k] = p.grants[k];
    }
  }
  return next;
}

// Which preset a member's ticks match exactly (ignoring what presets leave
// alone), or null. For the "matches: Finance" line on the page.
export function matchingPreset(grants = {}) {
  for (const [key, p] of Object.entries(PRESETS)) {
    const ok = AREA_KEYS.every((k) => PRESET_LEAVES.has(k) || (grants[k] ?? null) === (p.grants[k] ?? null));
    if (ok) return key;
  }
  return null;
}

// When no preset matches exactly: the preset with the fewest differing areas,
// and those areas with the level the person holds. For the "Custom" label on
// the page -- most people are a preset changed by hand (Lawrence, 21 Oct 2026:
// show the level, keep it short, the grid underneath is the full list).
export function nearestPreset(grants = {}) {
  let best = null;
  for (const [key, p] of Object.entries(PRESETS)) {
    const diffs = AREA_KEYS
      .filter((k) => !PRESET_LEAVES.has(k) && (grants[k] ?? null) !== (p.grants[k] ?? null))
      .map((k) => ({ area: k, label: AREAS.find(([a]) => a === k)[1], have: grants[k] ?? null }));
    if (!best || diffs.length < best.diffs.length) best = { key, label: p.label, diffs };
  }
  return best;
}

// Clean a grants object from the client: known areas, known levels, nothing else.
export function cleanGrants(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const k of AREA_KEYS) {
    const v = input[k];
    if (v === 'read' || v === 'write') out[k] = v;
  }
  return out;
}
