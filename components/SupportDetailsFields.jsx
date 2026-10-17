'use client';

// The support-details questions, as fields only -- no card, no save button,
// no photo. Rendered twice: inside the registration wizard for every person
// on the form (required for campers before submit, 16 Oct 2026) and on the
// dashboard's per-person details page, which adds the photo and saves on its
// own. One component so the two can never ask different questions.
//
// Every question follows the same pattern: a plain yes/no, and the detail box
// only appears when the answer is yes. CampSite required free text for all of
// this, and their export is full of "NA" -- a required box gets filled, not
// answered. For a camper the boxes ARE required now (Larry's ruling), and the
// label says out loud that "N/A" is a fine answer: the point is that somebody
// looked, not that there is something to say.
//
// Props:
//   f, setF        the form state (see emptySupport in lib/support.js) and a
//                  React-style setter that takes an updater function
//   name           the person's name, for the questions
//   isCamper       the full profile, with the required marks
//   showAll        whether the fuller sections are open (a non-camper's short
//                  version hides them behind "Tell us more")
//   onShowAll      called when that button is pressed
//   idPrefix       keeps radio groups apart when several people share a page

import { ALLERGENS } from '@/lib/support';
import { formatPhone } from '@/lib/format';

const input = 'w-full rounded border border-neutral-300 px-4 py-2.5';
const label = 'block font-semibold mb-1.5 mt-4 first:mt-0';

function Heading({ children, hint }) {
  return (
    <div className="mt-8 mb-2 border-b border-neutral-200 pb-1 first:mt-0">
      <h3 className="text-lg font-bold">{children}</h3>
      {hint && <p className="text-sm text-neutral-600">{hint}</p>}
    </div>
  );
}

// A yes/no with a detail box that appears only on yes. The detail is asked in
// plain language -- "what should we do", not "describe the condition" --
// because what camp staff need is the plan, not the diagnosis.
function YesNo({ id, question, value, onChange, required = false, children }) {
  return (
    <div className="mt-5 first:mt-0">
      <p className="font-semibold mb-2">
        {question}
        {required && <span className="ml-1 font-normal text-neutral-500">(required)</span>}
      </p>
      <div className="flex gap-2">
        {[
          ['yes', true],
          ['no', false],
        ].map(([labelText, v]) => (
          <label
            key={labelText}
            className={`cursor-pointer rounded border px-4 py-1.5 text-sm font-semibold ${
              value === v
                ? 'border-brand bg-brand-light text-brand-dark'
                : 'border-neutral-300 text-neutral-600'
            }`}
          >
            <input
              type="radio"
              name={id}
              className="sr-only"
              checked={value === v}
              onChange={() => onChange(v)}
            />
            {labelText === 'yes' ? 'Yes' : 'No'}
          </label>
        ))}
      </div>
      {value === true && children}
    </div>
  );
}

export default function SupportDetailsFields({
  f,
  setF,
  name = 'this person',
  isCamper = false,
  showAll = true,
  onShowAll = () => {},
  idPrefix = '',
}) {
  const set = (k) => (e) => {
    const v = e.target.value;
    setF((prev) => ({ ...prev, [k]: v }));
  };
  const setFlag = (k) => (v) => setF((prev) => ({ ...prev, [k]: v }));
  const toggleAllergen = (code) =>
    setF((prev) => {
      const have = Array.isArray(prev.allergens) ? prev.allergens : [];
      return {
        ...prev,
        allergens: have.includes(code) ? have.filter((c) => c !== code) : [...have, code],
      };
    });
  const allergens = Array.isArray(f.allergens) ? f.allergens : [];
  // A row from before the tick list (0097) has its list in the detail box:
  // say so, so the family knows why they are being asked to tick.
  const legacyAllergyText =
    f.has_allergies === true && allergens.length === 0 && (f.allergy_detail ?? '').trim() !== '';

  // "(required -- 'N/A' is an answer)" on a camper's boxes; "(optional)" is
  // not written on the others, because almost everything else is.
  const req = isCamper ? (
    <span className="font-normal text-neutral-500">(required — &ldquo;N/A&rdquo; is an answer)</span>
  ) : null;

  return (
    <div>
      {showAll && (
        <>
          <Heading>About {name}</Heading>
          <label className={label}>
            Disability or diagnosis, in your own words {req}
          </label>
          <textarea className={input} rows={2} value={f.disabilities} onChange={set('disabilities')} />

          <label className={label}>How does {name} communicate best? {req}</label>
          <textarea
            className={input}
            rows={2}
            value={f.communication}
            onChange={set('communication')}
            placeholder="Speech, signs, a device, gestures — and anything that helps us understand them"
          />

          <label className={label}>Getting around {req}</label>
          <textarea
            className={input}
            rows={2}
            value={f.mobility}
            onChange={set('mobility')}
            placeholder="Walks independently, uses a wheelchair or walker, tires on hills, needs a hand on stairs…"
          />

          <label className={label}>Personal care {req}</label>
          <textarea
            className={input}
            rows={2}
            value={f.personal_care}
            onChange={set('personal_care')}
            placeholder="Dressing, toileting, showering — what they do themselves and where they need a hand"
          />

          <label className={label}>Anything else about daily routine</label>
          <textarea
            className={input}
            rows={2}
            value={f.daily_living_supports}
            onChange={set('daily_living_supports')}
          />
        </>
      )}

      <Heading hint="Camp has medical staff on site. What matters most is what we should DO, not the medical name for it.">
        Health
      </Heading>
      <YesNo
        id={`${idPrefix}allergies`}
        question={`Does ${name} have any allergies?`}
        value={f.has_allergies}
        onChange={setFlag('has_allergies')}
        required={isCamper}
      >
        {/* The tick list (0097). Fixed words, so the kitchen list, the buddy
            sheet and the Dietary page all count "peanut" once. */}
        <label className={label}>Which ones? Tick all that apply.</label>
        {legacyAllergyText && (
          <p className="mb-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            You told us before: &ldquo;{f.allergy_detail.trim()}&rdquo;. Please tick the matching
            boxes — we now keep a list so the kitchen reads the same words for everyone.
          </p>
        )}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          {ALLERGENS.map(([code, text]) => (
            <label key={code} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={allergens.includes(code)}
                onChange={() => toggleAllergen(code)}
              />
              {text}
            </label>
          ))}
        </div>
        {allergens.includes('other') && (
          <>
            <label className={label}>What is the other allergy?</label>
            <input
              className={input}
              value={f.allergy_other}
              onChange={set('allergy_other')}
              placeholder="e.g. strawberries, sunscreen, dogs"
            />
          </>
        )}

        {/* E33/E42. Severity before the description, because it is the part
            that changes what somebody does. Three buttons rather than a
            dropdown: on a phone, in a hurry, a closed <select> hides the
            options and one of them is the reason this field exists. Nothing
            is preselected, so "not recorded" stays visibly different from
            "mild". */}
        <label className={label}>How serious is it?</label>
        <div className="flex flex-wrap gap-2">
          {[
            ['mild', 'Mild', 'Avoid where easy'],
            ['severe', 'Severe', 'Must avoid; tell the nurse'],
            ['anaphylaxis', 'Anaphylaxis', 'Life-threatening; rescue medication'],
          ].map(([val, title, hint]) => {
            const on = f.allergy_severity === val;
            return (
              <button
                key={val}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setF((prev) => ({
                    ...prev,
                    allergy_severity: prev.allergy_severity === val ? '' : val,
                  }))
                }
                className={`rounded border px-3 py-2 text-left text-sm ${
                  on
                    ? 'border-brand bg-brand-light font-semibold text-brand-dark'
                    : 'border-neutral-300 bg-white hover:border-neutral-400'
                }`}
              >
                <span className="block">{title}</span>
                <span className="block text-xs font-normal text-neutral-500">{hint}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          One severity for the person. The kitchen list is printed without names, so this is
          what tells somebody how carefully to treat it.
        </p>

        <label className={label}>What happens, and what should we do?</label>
        <textarea
          className={input}
          rows={2}
          value={f.allergy_detail}
          onChange={set('allergy_detail')}
          placeholder="Hives and swelling within minutes — antihistamine in the bag"
        />
        <p className="mt-1 text-xs text-neutral-500">
          If {name} carries emergency medication for a reaction — an EpiPen, for example —
          record it under <strong>rescue medication</strong> below, so it is written down once,
          in the place staff will look for it.
        </p>
      </YesNo>

      {showAll && (
        <>
          <YesNo
            id={`${idPrefix}seizures`}
            question={`Does ${name} have seizures?`}
            value={f.has_seizures}
            onChange={setFlag('has_seizures')}
            required={isCamper}
          >
            <label className={label}>What do they look like, and what should we do?</label>
            <textarea
              className={input}
              rows={3}
              value={f.seizure_detail}
              onChange={set('seizure_detail')}
              placeholder="How long they usually last, what helps, when to call for help"
            />
          </YesNo>

          <YesNo
            id={`${idPrefix}rescue`}
            question={`Does ${name} carry any rescue or emergency medication?`}
            value={f.has_rescue_medication}
            onChange={setFlag('has_rescue_medication')}
            required={isCamper}
          >
            <label className={label}>What, where is it kept, and when is it used?</label>
            <textarea
              className={input}
              rows={2}
              value={f.rescue_medication_detail}
              onChange={set('rescue_medication_detail')}
              placeholder="EpiPen in her backpack — use for any reaction with facial swelling"
            />
          </YesNo>

          <label className={label}>Regular medications {req}</label>
          <textarea
            className={input}
            rows={3}
            value={f.medications}
            onChange={set('medications')}
            placeholder="Name, dose and when it's taken. Families keep and give their own medications at camp — staff never take them into custody."
          />
        </>
      )}

      {/* Diet stays in the SHORT form for everyone: every attendee eats, and
          the kitchen plans from this. */}
      <label className={label}>Dietary needs {req}</label>
      <textarea
        className={input}
        rows={2}
        value={f.dietary_needs}
        onChange={set('dietary_needs')}
        placeholder="Vegetarian, no pork, soft foods, small portions often…"
      />

      {showAll && (
        <>
          <Heading hint="Every camper has one. Knowing what helps in advance means staff can help instead of guess.">
            A hard day
          </Heading>
          <label className={label}>What tends to set {name} off, or make things harder?</label>
          <textarea
            className={input}
            rows={2}
            value={f.behaviour_triggers}
            onChange={set('behaviour_triggers')}
            placeholder="Loud rooms, changes to the plan, being rushed, hunger…"
          />

          <label className={label}>What helps them settle?</label>
          <textarea
            className={input}
            rows={3}
            value={f.redirection_strategies}
            onChange={set('redirection_strategies')}
            placeholder="A quiet corner, a favourite song, a walk, a five-minute warning before changes"
          />

          {/* E34. Here rather than on a page of its own: a leader reading
              "loves trains, hates loud singing" is reading it for the same
              reason they read the two boxes above. */}
          <label className={label}>What does {name} enjoy, and what do they avoid?</label>
          <textarea
            className={input}
            rows={2}
            value={f.likes_dislikes}
            onChange={set('likes_dislikes')}
            placeholder="Loves water and music, avoids crowds and face paint..."
          />

          <YesNo
            id={`${idPrefix}sleep`}
            question={`Does ${name} have trouble sleeping away from home?`}
            value={f.has_sleep_disturbance}
            onChange={setFlag('has_sleep_disturbance')}
          >
            <label className={label}>What should the night staff know?</label>
            <textarea className={input} rows={2} value={f.sleep_notes} onChange={set('sleep_notes')} />
          </YesNo>

          <Heading>Support at camp</Heading>
          {/* E38. Free text, and only for now: the right shape is probably a
              few tick-boxes with a box beside them, and Ellen has been asked
              what the options should be. */}
          <label className={label}>
            Anything about who {name} shares a room with, or the room itself?
          </label>
          <textarea
            className={input}
            rows={2}
            value={f.rooming_preferences}
            onChange={set('rooming_preferences')}
            placeholder="Near a bathroom, ground floor, shares with their brother, needs a quiet end..."
          />
          <p className="mt-1 mb-4 text-xs text-neutral-500">
            Staff do the room assignments and will get as close to this as the buildings allow.
          </p>

          {/* "Does X need a one-to-one buddy?" was removed on 31 August 2026:
              the family coordinator works that out with each family, and
              staff set it on the Buddies page. The FIELD is untouched. */}
          <YesNo
            id={`${idPrefix}caregiver`}
            question={`Will a caregiver be attending with ${name}?`}
            value={f.has_caregiver}
            onChange={setFlag('has_caregiver')}
          >
            <p className="mt-2 text-sm text-neutral-600">
              Make sure they are added to your registration as well, so they have a place and a
              meal.
            </p>
          </YesNo>
        </>
      )}

      {/* Offered, never hidden. A volunteer with a severe allergy or a sibling
          with real needs must be able to reach these questions in one click --
          the short form is a default, not a ceiling. */}
      {!showAll && (
        <div className="mt-5 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-4 text-center">
          <p className="text-sm text-neutral-700">
            We&rsquo;ve kept this short because {name} isn&rsquo;t registered as a camper. If
            there is more we should know — medications, seizures, sleep away from home, who they
            would like to room with — it all matters just as much.
          </p>
          <button type="button" onClick={onShowAll} className="btn-outline !py-1.5 text-sm mt-3">
            Tell us more about {name}
          </button>
        </div>
      )}

      <Heading hint="Someone we can reach during the event who is not attending it.">
        Emergency contact
      </Heading>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className={label}>Name {isCamper && <span className="font-normal text-neutral-500">(required)</span>}</label>
          <input
            className={input}
            value={f.emergency_contact_name}
            onChange={set('emergency_contact_name')}
          />
        </div>
        <div>
          <label className={label}>Phone {isCamper && <span className="font-normal text-neutral-500">(required)</span>}</label>
          <input
            type="tel"
            className={input}
            value={f.emergency_contact_phone}
            onChange={set('emergency_contact_phone')}
            // Tidy on blur, like every other phone box on the site. This is
            // the number somebody dials at 2am. formatPhone is tidy-never-
            // mangle: anything it does not recognise as a clean US number
            // comes back untouched.
            onBlur={() =>
              setF((prev) => ({
                ...prev,
                emergency_contact_phone: formatPhone(prev.emergency_contact_phone),
              }))
            }
          />
        </div>
      </div>
      <label className={label}>Relationship to {name}</label>
      <input
        className={input}
        value={f.emergency_contact_relationship}
        onChange={set('emergency_contact_relationship')}
        placeholder="Mother, brother, support worker…"
      />

      <Heading hint="Anything that doesn't fit neatly above.">Anything else?</Heading>
      <textarea className={input} rows={3} value={f.other_concerns} onChange={set('other_concerns')} />
    </div>
  );
}
