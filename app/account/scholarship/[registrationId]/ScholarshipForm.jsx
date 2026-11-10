'use client';

// One card per person on the registration. Asking is meant to feel ordinary,
// because it is: the ministry raises money so that cost is not the reason
// someone stays home, and a form that reads like a means test discourages
// exactly the families it exists for.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { requestScholarship, withdrawScholarship, requestFamilyScholarship, withdrawFamilyScholarship } from './actions';
import { dollars } from '@/lib/payments';

const ROLE_LABEL = {
  camper: 'Camper',
  parent_guardian: 'Parent/Guardian',
  sibling: 'Sibling / Child',
  caregiver: 'Caregiver',
  volunteer: 'Volunteer',
  volunteer_child: 'Volunteer child (under 16)',
  childcare: 'Childcare',
  support_team: 'Support team',
};

// Two decimals, always (dollars(), lib/payments.js): this printed "$742.5".
const money = dollars;

const STATUS = {
  requested: ['Requested; staff will review', 'bg-amber-100 text-amber-800'],
  granted: ['Approved', 'bg-green-100 text-green-800'],
  approved: ['Approved', 'bg-green-100 text-green-800'],
  declined: ['Not granted this time', 'bg-neutral-200 text-neutral-600'],
  withdrawn: ['Withdrawn', 'bg-neutral-200 text-neutral-600'],
};

function PersonCard({ registrationId, row, agreementReady = true, agreementKey = null, signerName = '' }) {
  const router = useRouter();
  const granted = (row.grantedCents ?? 0) > 0;
  const [open, setOpen] = useState(Boolean(row.status) && row.status !== 'withdrawn' && !granted);
  const [amount, setAmount] = useState(
    row.requestedCents ? String(Math.round(row.requestedCents / 100)) : ''
  );
  const [statement, setStatement] = useState(row.statement ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function save() {
    if (!agreementReady) {
      setError(
        'Please check the scholarship agreement above and type your name to sign it. It covers every request on this registration.'
      );
      return;
    }
    // A request with nothing written in it gives staff nothing to decide on
    // (Ellen's note; Lawrence 14 Oct 2026) -- but it is NOT a blocker
    // (Lawrence, 15 Oct): the form says plainly that no details usually means
    // no scholarship, and a family who has already talked to the office can
    // still send the request through. The reviewer sees the empty statement.
    setBusy(true);
    setError('');
    const res = await requestScholarship(registrationId, row.participantId, {
      amount: amount === '' ? 0 : amount,
      statement,
      agreementKey,
      // Carried so the recorded signature names the person who typed it,
      // rather than defaulting to whoever happened to be logged in.
      signerName,
    });
    setBusy(false);
    if (!res.ok) setError(res.error);
    else {
      setSaved(true);
      router.refresh();
    }
  }

  async function withdraw() {
    if (!confirm('Withdraw this request? You can ask again later if things change.')) return;
    setBusy(true);
    setError('');
    const res = await withdrawScholarship(registrationId, row.participantId);
    setBusy(false);
    if (!res.ok) setError(res.error);
    else {
      setOpen(false);
      router.refresh();
    }
  }

  const chip = row.status ? STATUS[row.status] : null;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white shadow-xs p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">
            {row.name}
            {row.role && (
              <span className="ml-2 text-sm font-normal text-neutral-500">
                {ROLE_LABEL[row.role] ?? row.role}
              </span>
            )}
          </h2>
          <p className="text-sm text-neutral-500">
            Fee {row.feeCents == null ? '—' : money(row.feeCents)}
            {granted && (
              <span className="text-green-700 font-semibold">
                {' '}
                &middot; {money(row.grantedCents)} scholarship awarded
              </span>
            )}
          </p>
        </div>
        {chip && (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${chip[1]}`}>
            {chip[0]}
          </span>
        )}
      </div>

      {granted ? (
        <p className="mt-3 text-sm text-neutral-700">
          Camp staff have applied this to {row.name}&rsquo;s fee. You&rsquo;ll see it on your
          balance. If something has changed, please contact the office rather than editing this.
        </p>
      ) : !open ? (
        <button onClick={() => setOpen(true)} className="btn-outline py-1.5! text-sm mt-3">
          {row.status === 'withdrawn' ? 'Ask again' : `Request help for ${row.name}`}
        </button>
      ) : (
        <div className="mt-4">
          <label className="block font-semibold mb-1.5">
            How much would help? <span className="font-normal text-neutral-500">(optional)</span>
          </label>
          <div className="flex items-center gap-2">
            <span className="text-neutral-500">$</span>
            <input
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-32 rounded-sm border border-neutral-300 px-3 py-2"
              placeholder="0"
            />
            <span className="text-sm text-neutral-500">
              of {row.feeCents == null ? '—' : money(row.feeCents)}
            </span>
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            Leave blank if you are not sure.
          </p>

          <label className="block font-semibold mb-1.5 mt-4">
            Your situation
          </label>
          <textarea
            rows={3}
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            className="w-full rounded-sm border border-neutral-300 px-3 py-2"
          />
          <p className="mt-1 text-xs text-neutral-500">
            Staff decide from what you write here. Only the staff who handle scholarships see
            it.
          </p>

          {error && (
            <p role="alert" className="mt-3 rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button onClick={save} disabled={busy} className="btn-primary py-2! text-sm">
              {busy ? 'Saving…' : row.status === 'requested' ? 'Update request' : 'Send request'}
            </button>
            {row.status === 'requested' && (
              <button onClick={withdraw} disabled={busy} className="text-sm text-neutral-600 underline">
                Withdraw
              </button>
            )}
            {saved && <span className="text-sm font-semibold text-green-700">Saved.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// One request for the whole family (0159, Lawrence 10 Nov 2026): a
// percentage of what the family owes, a dollar amount, or help without a
// figure. Staff award dollars and the site shares them out by each person's
// fee, so the family never has to work out who gets what.
function FamilyCard({ registrationId, family, owesCents, people, agreementReady, agreementKey, signerName }) {
  const router = useRouter();
  const decided = family?.status === 'granted';
  const waiting = family?.status === 'requested';
  const [open, setOpen] = useState(waiting || !family);
  const [kind, setKind] = useState(family?.kind ?? 'percent');
  const [percent, setPercent] = useState(family?.percent ? String(family.percent) : '');
  const [amount, setAmount] = useState(family?.cents ? String(Math.round(family.cents / 100)) : '');
  const [statement, setStatement] = useState(family?.statement ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const pct = Number(percent);
  const pctDollars =
    owesCents != null && Number.isInteger(pct) && pct >= 1 && pct <= 100 ? Math.round((owesCents * pct) / 100) : null;

  async function save() {
    if (!agreementReady) {
      setError('Please check the scholarship agreement above and type your name to sign it.');
      return;
    }
    setBusy(true);
    setError('');
    const res = await requestFamilyScholarship(registrationId, {
      kind,
      percent,
      amount,
      statement,
      agreementKey,
      signerName,
    });
    setBusy(false);
    if (!res.ok) setError(res.error);
    else {
      setSaved(true);
      router.refresh();
    }
  }

  async function withdraw() {
    if (!confirm('Withdraw your family’s request? You can ask again later if things change.')) return;
    setBusy(true);
    setError('');
    const res = await withdrawFamilyScholarship(registrationId);
    setBusy(false);
    if (!res.ok) setError(res.error);
    else {
      setOpen(false);
      router.refresh();
    }
  }

  const chip = family?.status ? STATUS[family.status] : null;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white shadow-xs p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">Your whole family</h2>
          <p className="text-sm text-neutral-500">
            {people.map((p) => p.name).join(', ')}
            {owesCents != null && <> &middot; {money(owesCents)} to pay after discounts</>}
          </p>
        </div>
        {chip && (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${chip[1]}`}>{chip[0]}</span>
        )}
      </div>

      {decided ? (
        <>
          <p className="mt-3 text-sm text-neutral-700">
            Camp staff awarded <strong>{money(family.grantedCents)}</strong> for your family, shared
            across everyone&rsquo;s fees. You&rsquo;ll see it on your balance. If something has
            changed, please contact the office.
          </p>
          <ul className="mt-2 text-sm text-neutral-600">
            {people
              .filter((p) => (p.grantedCents ?? 0) > 0)
              .map((p) => (
                <li key={p.participantId}>
                  {p.name}: {money(p.grantedCents)}
                </li>
              ))}
          </ul>
        </>
      ) : !open ? (
        <button onClick={() => setOpen(true)} className="btn-outline py-1.5! text-sm mt-3">
          {family ? 'Ask again for the family' : 'Ask for the whole family'}
        </button>
      ) : (
        <div className="mt-4">
          <fieldset>
            <legend className="font-semibold mb-1.5">How much would help?</legend>
            <div className="space-y-2 text-sm">
              <label className="flex flex-wrap items-center gap-2">
                <input type="radio" name="fam-kind" checked={kind === 'percent'} onChange={() => setKind('percent')} />
                A percentage
                {kind === 'percent' && (
                  <>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      step="1"
                      inputMode="numeric"
                      value={percent}
                      onChange={(e) => setPercent(e.target.value)}
                      className="w-20 rounded-sm border border-neutral-300 px-2 py-1"
                      aria-label="Percentage"
                    />
                    %{pctDollars != null && <span className="text-neutral-500">(about {money(pctDollars)})</span>}
                  </>
                )}
              </label>
              <label className="flex flex-wrap items-center gap-2">
                <input type="radio" name="fam-kind" checked={kind === 'amount'} onChange={() => setKind('amount')} />
                An amount
                {kind === 'amount' && (
                  <>
                    <span className="text-neutral-500">$</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-28 rounded-sm border border-neutral-300 px-2 py-1"
                      aria-label="Amount in dollars"
                    />
                  </>
                )}
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="fam-kind" checked={kind === 'unsure'} onChange={() => setKind('unsure')} />
                I&rsquo;m not sure
              </label>
            </div>
          </fieldset>

          <label className="block font-semibold mb-1.5 mt-4">Your situation</label>
          <textarea
            rows={3}
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            className="w-full rounded-sm border border-neutral-300 px-3 py-2"
          />
          <p className="mt-1 text-xs text-neutral-500">
            Staff decide from what you write here. Only the staff who handle scholarships see it.
          </p>

          {error && (
            <p role="alert" className="mt-3 rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button onClick={save} disabled={busy} className="btn-primary py-2! text-sm">
              {busy ? 'Saving…' : waiting ? 'Update request' : 'Send request'}
            </button>
            {waiting && (
              <button onClick={withdraw} disabled={busy} className="text-sm text-neutral-600 underline">
                Withdraw
              </button>
            )}
            {saved && <span className="text-sm font-semibold text-green-700">Saved.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ScholarshipForm({
  registrationId,
  rows,
  agreement = null,
  agreementSigned = false,
  contactName = '',
  eventName = '',
  family = null,
  familyOwesCents = null,
}) {
  // The scholarship agreement moved here from the registration form (24 Aug):
  // signed by the families it binds, at the moment it starts to apply, rather
  // than by every family whether or not it means anything to them. One tick
  // covers all requests on this registration; once signed (here or in a past
  // request) it is shown, not re-asked -- signatures are never re-taken.
  const [agreed, setAgreed] = useState(agreementSigned);
  const [signerName, setSignerName] = useState('');
  // Same rule as the registration form: the signature should name the person
  // the household says is responsible. A mismatch warns rather than blocks --
  // a spouse completing the form is a normal thing, and refusing it outright
  // would strand a family asking for help with money.
  const normName = (v) => (v || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const nameMatches = normName(signerName) === normName(contactName);
  const needsAgreement = Boolean(agreement) && !agreementSigned;

  // Family or per person (0159): a registration has one or the other. The
  // family choice is offered when two or more people have something to pay
  // and nobody has a per-person award already; a waiting or decided family
  // request is shown on its own.
  const owing = rows.filter((r) => (r.owesCents ?? 0) > 0);
  const personAwarded = rows.some((r) => !r.inFamilyRequest && (r.grantedCents ?? 0) > 0);
  const familyActive = Boolean(family) && (family.status === 'requested' || family.status === 'granted');
  const familyOffered = familyActive || (owing.length >= 2 && !personAwarded);
  const personAsked = rows.some((r) => !r.inFamilyRequest && r.status === 'requested');
  const [mode, setMode] = useState(familyActive || (familyOffered && !personAsked) ? 'family' : 'person');

  if (rows.length === 0) {
    return <p className="text-neutral-600">Nobody is on this registration yet.</p>;
  }
  const agreementReady =
    !needsAgreement || (agreed && signerName.trim().length > 1 && (!contactName || nameMatches));
  return (
    <div className="space-y-4">
      {agreement && (
        <div
          className={`rounded-lg border p-5 ${
            agreementSigned ? 'border-green-300 bg-green-50' : 'border-neutral-200 bg-white shadow-xs'
          }`}
        >
          <p className="font-bold">{agreement.title}</p>
          <p className="mt-1 text-sm text-neutral-700">{agreement.body}</p>
          {agreementSigned ? (
            <p className="mt-2 text-sm font-semibold text-green-800">
              Already signed for this registration.
            </p>
          ) : (
            <>
              <label className="mt-3 flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                />
                <span className="text-sm font-semibold">
                  I agree. This is signed with my request below.
                </span>
              </label>
              {/* The name, typed. A tick records that SOMEONE agreed; it does
                  not record who, and this is the same legal act the
                  registration form asks a name for. Testing asked for the
                  signature box back (25 Aug), and it was right to. */}
              {agreed && (
                <div className="mt-3 max-w-sm">
                  <label className="block text-sm font-semibold mb-1" htmlFor="schol-signer">
                    Type your full name to sign
                  </label>
                  <input
                    id="schol-signer"
                    className="w-full rounded-sm border border-neutral-300 px-3 py-2"
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    placeholder={contactName || 'Your full name'}
                    autoComplete="name"
                  />
                  {contactName && !nameMatches && signerName.trim() !== '' && (
                    <p className="mt-1 text-sm font-semibold text-amber-800">
                      This has to be {contactName}, the primary contact for your family. If
                      someone else is signing, change the primary contact under Manage
                      Household first, so the agreement names the person actually
                      responsible.
                    </p>
                  )}
                  <p className="mt-1 text-xs text-neutral-500">
                    Dated{' '}
                    {new Date().toLocaleDateString('en-US', {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                    . Typing your name here has the same effect as signing on paper.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {familyOffered && !familyActive && (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Who the request is for">
          {[
            ['family', 'Ask once for the whole family'],
            ['person', 'Ask for each person'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={mode === key}
              onClick={() => setMode(key)}
              className={`rounded-full border px-3 py-1 text-sm ${
                mode === key ? 'border-brand bg-brand-light font-semibold text-brand-dark' : 'border-neutral-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {familyOffered && mode === 'family' && (
        <FamilyCard
          registrationId={registrationId}
          family={family}
          owesCents={familyOwesCents}
          people={owing.length ? owing : rows}
          agreementReady={agreementReady}
          agreementKey={needsAgreement && agreed ? agreement.key : null}
          signerName={signerName.trim()}
        />
      )}
      {!(familyOffered && mode === 'family') && rows.map((r) => (
        <PersonCard
          key={r.participantId}
          registrationId={registrationId}
          row={r}
          /* The same rule the registration form applies, and the same rule
             0049 now enforces in Postgres: the name on an agreement must be
             the primary contact's. This used to warn and let it through, so
             the two signing surfaces disagreed with each other. */
          agreementReady={agreementReady}
          agreementKey={needsAgreement && agreed ? agreement.key : null}
          signerName={signerName.trim()}
        />
      ))}
    </div>
  );
}
