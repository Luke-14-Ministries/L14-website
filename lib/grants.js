// The grants model -- the ten areas and the presets (Luke14-Access-Model-Plan,
// 15-16 Oct 2026; build plan item 16, step 1 and 2).
//
// Plain module: imported by the Staff & Access page (server), its actions and
// its client component. One list of areas, one table of presets, so the page
// and the database vocabulary (staff_grants.area, migration 0100) cannot
// drift apart.
//
// WHERE THIS STANDS (16 Oct 2026). The grants are recorded and logged, the
// presets set them, and can(staff, 'read:<area>' | 'write:<area>') reads
// them. The ROLE still decides what the database allows: the ~100 row-level
// rules and ~90 page checks still ask "registrar / coordinator / admin?".
// Switching them over one area at a time is step 3 of the plan; until then a
// preset sets the closest role as well, and says so on the page.

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

// Each preset: the ticks (plan §2d), and -- until step 3 -- the legacy role
// and flags that make the database agree as closely as it can today.
export const PRESETS = {
  admin: {
    label: 'Administrator',
    note: 'Every area, read and write. The only preset that can grant anything.',
    role: 'admin',
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
    role: 'registrar',
    sensitive: true,
    backgroundChecks: false,
    grants: {
      registration: 'write', payments: 'write', background_checks: 'read', sensitive: 'write',
      activities: 'write', rooming: 'write', buddies: 'write', programs: 'read',
    },
  },
  finance: {
    label: 'Finance',
    note: 'Records payments and refunds; reads names and events. Scholarship decisions stay with Registration & coordination (enforced when the rules switch over).',
    role: 'registrar',
    sensitive: false,
    backgroundChecks: false,
    grants: { registration: 'read', payments: 'write' },
  },
  ops_lead: {
    label: 'Operations lead',
    note: 'Robin Gibson. Check-in: contact details at the door, moves people between rooms and activities; no payment information.',
    role: 'coordinator',
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
    role: 'coordinator',
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
