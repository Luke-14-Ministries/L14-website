// Support details -- the one definition, shared by the two forms that collect
// them and the staff pages that read them.
//
// Since 16 October 2026 (Larry and Ellen's inked read-through, confirmed on
// the call: "that's correct") a camper's support and medical details are
// asked INSIDE the registration wizard, before submit. The per-person form on
// the dashboard (/account/details/[personId]) stays for edits and for the
// photo. Both render components/SupportDetailsFields.jsx and both call
// supportProblems() below, so what is required cannot differ between them.
//
// Plain module: no 'use server', no 'use client'. It is imported by server
// components, server actions and client components alike.

// ---- Allergens (0097) -------------------------------------------------------
// The eight US major food allergens, then the five the ministry asked for,
// then "other". The codes are what the database stores (and checks); the
// labels are what every page prints. Order is display order.
export const ALLERGENS = [
  ['milk', 'Milk / dairy'],
  ['egg', 'Egg'],
  ['peanut', 'Peanut'],
  ['tree_nuts', 'Tree nuts'],
  ['soy', 'Soy'],
  ['wheat', 'Wheat / gluten'],
  ['fish', 'Fish'],
  ['shellfish', 'Shellfish'],
  ['sesame', 'Sesame'],
  ['latex', 'Latex'],
  ['insect_stings', 'Insect stings'],
  ['medications', 'Medications'],
  ['food_dyes', 'Synthetic food dyes'],
  ['other', 'Other'],
];
export const ALLERGEN_LABEL = Object.fromEntries(ALLERGENS);
export const ALLERGEN_CODES = ALLERGENS.map(([code]) => code);

// The allergens as words, for any list that names them. A row saved before
// 0097 has no ticks and its list in allergy_detail: that text is shown as
// "Other: ..." until the family saves again -- never guessed into codes.
export function allergenWords(s) {
  if (!s?.has_allergies) return [];
  const codes = Array.isArray(s.allergens) ? s.allergens : [];
  const words = codes
    .filter((c) => c !== 'other' && ALLERGEN_LABEL[c])
    .map((c) => ALLERGEN_LABEL[c]);
  if (codes.includes('other')) {
    const other = (s.allergy_other ?? '').trim();
    words.push(other ? `Other: ${other}` : 'Other');
  }
  if (codes.length === 0 && (s.allergy_detail ?? '').trim()) {
    words.push(`Other: ${s.allergy_detail.trim()}`);
  }
  return words;
}

// One line for a named list: the ticked words, then the reaction. A pre-0097
// row prints its free text as given.
export function allergySummary(s) {
  if (!s?.has_allergies) return '';
  const codes = Array.isArray(s.allergens) ? s.allergens : [];
  const detail = (s.allergy_detail ?? '').trim();
  if (codes.length === 0) return detail;
  const words = allergenWords(s).join(', ');
  return detail ? `${words} — ${detail}` : words;
}

// ---- Fields -------------------------------------------------------------------
// Everything a family may write. Anything not on this list is ignored rather
// than trusted; buddy_required, buddy_ratio and reviewed_at/by are staff
// judgements and are deliberately absent.
export const SUPPORT_TEXT_FIELDS = [
  'disabilities',
  'communication',
  'mobility',
  'personal_care',
  'daily_living_supports',
  'allergy_other',
  'allergy_detail',
  'dietary_needs',
  'rooming_preferences', // E38
  'likes_dislikes', // E34
  'medications',
  'seizure_detail',
  'rescue_medication_detail',
  'behaviour_triggers',
  'redirection_strategies',
  'sleep_notes',
  'other_concerns',
  'emergency_contact_name',
  'emergency_contact_phone',
  'emergency_contact_relationship',
];

// buddy_required deliberately absent since 31 Aug 2026: families are no longer
// asked, so the family endpoints no longer accept it. Staff set it on the
// Buddies page. A server action is a public endpoint, and "the form does not
// show it" is not the same as "it cannot be sent".
export const SUPPORT_FLAG_FIELDS = [
  'has_allergies',
  'has_seizures',
  'has_rescue_medication',
  'has_sleep_disturbance',
  'has_caregiver',
];

// Form state from a person_support row (or nothing). Flags start null --
// "not answered" -- which is what the wizard requires a camper to change.
export function emptySupport(row) {
  const s = row ?? {};
  const f = {};
  for (const k of SUPPORT_TEXT_FIELDS) f[k] = s[k] ?? '';
  for (const k of SUPPORT_FLAG_FIELDS) f[k] = typeof s[k] === 'boolean' ? s[k] : null;
  f.allergy_severity = s.allergy_severity ?? '';
  f.allergens = Array.isArray(s.allergens) ? s.allergens.filter((c) => ALLERGEN_LABEL[c]) : [];
  // Read, never written by families (see above). Kept so the form can tell
  // that this person has real detail on file.
  f.buddy_required = s.buddy_required ?? null;
  return f;
}

// Whether a row already holds detail from the fuller sections -- the short
// form opens them for anyone who has, whatever their role, because hiding
// answers a family has given would read as data loss, and would be.
const FULLER_TEXT = [
  'disabilities', 'communication', 'mobility', 'personal_care',
  'daily_living_supports', 'medications', 'seizure_detail',
  'rescue_medication_detail', 'behaviour_triggers', 'redirection_strategies',
  'sleep_notes', 'rooming_preferences', 'likes_dislikes',
];
export function hasFullerDetail(f) {
  if (!f) return false;
  return (
    FULLER_TEXT.some((k) => (f[k] ?? '').toString().trim() !== '') ||
    Boolean(f.has_seizures || f.has_rescue_medication || f.has_sleep_disturbance ||
      f.has_caregiver || f.buddy_required)
  );
}

// ---- What is required ---------------------------------------------------------
// For a CAMPER (Larry, 16 Oct): the boxes below, each of the three safety
// yes/no questions answered, and an emergency contact. "N/A" is an answer in
// any text box -- the point is that somebody looked, not that there is
// something to say. There is no "nothing to report" tick (Lawrence, 16 Oct).
// Everyone else keeps the short version: nothing required beyond the detail
// behind a "yes".
export const REQUIRED_FOR_CAMPERS = [
  ['disabilities', 'Disability or diagnosis'],
  ['communication', 'How they communicate best'],
  ['mobility', 'Getting around'],
  ['personal_care', 'Personal care'],
  ['medications', 'Regular medications'],
  ['dietary_needs', 'Dietary needs'],
];
const YES_NO_FOR_CAMPERS = [
  ['has_allergies', 'Any allergies? (yes or no)'],
  ['has_seizures', 'Seizures? (yes or no)'],
  ['has_rescue_medication', 'Rescue or emergency medication? (yes or no)'],
];

export function supportProblems(f, { isCamper = false } = {}) {
  const v = f ?? {};
  const blank = (k) => (v[k] ?? '').toString().trim() === '';
  const missing = [];
  if (isCamper) {
    for (const [k, text] of REQUIRED_FOR_CAMPERS) {
      if (blank(k)) missing.push(`${text} — "N/A" is an answer`);
    }
    for (const [k, text] of YES_NO_FOR_CAMPERS) {
      if (v[k] !== true && v[k] !== false) missing.push(text);
    }
    if (blank('emergency_contact_name') || blank('emergency_contact_phone')) {
      missing.push('An emergency contact — name and phone');
    }
  }
  if (v.has_allergies === true) {
    const codes = Array.isArray(v.allergens) ? v.allergens : [];
    if (codes.length === 0) missing.push('Which allergies — tick at least one, or "Other"');
    if (codes.includes('other') && blank('allergy_other')) missing.push('What the "Other" allergy is');
    if (!v.allergy_severity) missing.push('How serious the allergy is (Mild, Severe, Anaphylaxis)');
  }
  if (v.has_seizures === true && blank('seizure_detail')) {
    missing.push('About the seizures — how long, what helps, when to call for help');
  }
  if (v.has_rescue_medication === true && blank('rescue_medication_detail')) {
    missing.push('The rescue medication and when it is given');
  }
  return missing;
}

// ---- What is written ------------------------------------------------------------
// The patch for person_support from form fields, sanitised. Keys absent from
// `fields` are left alone (so a partial save never wipes an answer); present
// and blank becomes NULL, so it reads back as unanswered rather than as an
// empty string that looks like a considered blank. Flags become true/false --
// the columns are NOT NULL, and "we asked and they didn't say" is
// operationally "no" for a yes/no with no detail behind it.
export function supportPatch(fields) {
  const src = fields && typeof fields === 'object' ? fields : {};
  const patch = {};
  for (const k of SUPPORT_TEXT_FIELDS) {
    if (k in src) {
      const v = src[k];
      patch[k] = typeof v === 'string' && v.trim() === '' ? null : v;
    }
  }
  for (const k of SUPPORT_FLAG_FIELDS) {
    if (k in src) patch[k] = src[k] === true || src[k] === 'true';
  }
  // A constrained value, not prose: the database allows exactly mild, severe
  // and anaphylaxis (0064), so anything else becomes NULL here or the whole
  // save fails on a check constraint and the family loses the form.
  if ('allergy_severity' in src) {
    const v = src.allergy_severity;
    patch.allergy_severity = v === 'mild' || v === 'severe' || v === 'anaphylaxis' ? v : null;
  }
  if ('allergens' in src) {
    const list = Array.isArray(src.allergens) ? src.allergens : [];
    patch.allergens = ALLERGEN_CODES.filter((c) => list.includes(c));
    if (!patch.allergens.includes('other')) patch.allergy_other = null;
  }
  // Turning a flag OFF clears the detail that belonged to it. Leaving a
  // seizure plan behind after a family has said "no seizures" would put stale
  // medical text in front of a nurse at camp, which is worse than no text.
  if (patch.has_allergies === false) {
    patch.allergens = [];
    patch.allergy_other = null;
    patch.allergy_detail = null;
    patch.allergy_severity = null;
  }
  if (patch.has_seizures === false) patch.seizure_detail = null;
  if (patch.has_rescue_medication === false) patch.rescue_medication_detail = null;
  if (patch.has_sleep_disturbance === false) patch.sleep_notes = null;
  return patch;
}
