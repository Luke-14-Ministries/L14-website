import { redirect } from 'next/navigation';
import AdminPageHeader from '@/components/AdminPageHeader';
import EmptyState from '@/components/EmptyState';
import Notice from '@/components/Notice';
import PrintButton from '@/components/PrintButton';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { formatDay } from '@/lib/events';
import { effortSummary, nightMessages, tokenMixRows, hireOut, runModel, runSensitivity, isNightHour } from '@/lib/buildEffort';
import { VBars, RangeBars, PairedBars, Legend } from './charts';

// The website build effort and running costs report (0188, Lawrence, 28 Nov
// 2026), moved here from a Claude dashboard of 10 Nov 2026. Staff may show it
// to donors, or print it. Not linked from the menu or anywhere else.
//
// Every figure comes from the newest row of build_effort_snapshots: the
// repository is public, so none is written here. A revision is a new row
// added in Supabase's SQL editor, with no code change. The arithmetic is
// lib/buildEffort.js.
export const metadata = { title: 'Website Build Effort · Staff Admin' };

// The Giving grant, as for gifts: the database is the real gate (0188).
export default async function BuildEffortPage() {
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/build-effort/');
  if (!can(staff, 'giving')) redirect('/admin');

  const supabase = await createClient();
  const { data: snap, error } = await supabase
    .from('build_effort_snapshots')
    .select('as_of, data, created_at')
    .order('as_of', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`The build effort report couldn’t be read: ${error.message}`);

  if (!snap) {
    return (
      <div>
        <AdminPageHeader title="Website Build Effort and Running Costs" />
        <EmptyState kind="missing">No report has been loaded yet. Its figures are added in Supabase, not in the code.</EmptyState>
      </div>
    );
  }

  const d = snap.data ?? {};
  const asOf = formatDay(snap.as_of);
  return (
    <div className="effort-report">
      <AdminPageHeader
        title={d.title ?? 'Website Build Effort and Running Costs'}
        intro={
          <>
            <strong>As of {asOf}.</strong> What building the new Luke 14 site took, and what it costs to run against the
            old setup. {d.intro}
          </>
        }
        actions={
          <span className="print:hidden">
            <PrintButton label="Print or save as PDF" />
          </span>
        }
      />
      <div className="space-y-6 print:space-y-0">
        <Summary d={d} />
        <Produced d={d} />
        <Hours d={d} />
        <Tokens d={d} />
        <TokenMix d={d} />
        <WhenWork d={d} />
        <HireOut d={d} />
        <RunningCosts d={d} />
        <Method d={d} />
      </div>
      {/* Printed at the foot of every page (globals.css, the effort-report block). */}
      <p className="effort-footer">
        Luke 14 Ministries · Website build effort and running costs · as of {asOf}
      </p>
    </div>
  );
}

const num = (v) => (Number(v) || 0).toLocaleString('en-US');
const money = (v) => `${v < 0 ? '−' : ''}$${Math.abs(Math.round(Number(v) || 0)).toLocaleString('en-US')}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// A week's bar is labeled with its month when the month turns, at least
// three bars after the last label (a first week of June beside July's
// would print on top of it).
const monthTick = (rows) => {
  const labels = [];
  let last = -9;
  rows.forEach((r, i) => {
    const m = Number(String(r.week_start).slice(5, 7));
    const next = i + 1 < rows.length ? Number(String(rows[i + 1].week_start).slice(5, 7)) : null;
    const prev = i > 0 ? Number(String(rows[i - 1].week_start).slice(5, 7)) : null;
    // The first bar is skipped when the next one already starts a new month.
    const turns = m && m !== prev && !(i === 0 && next && next !== m);
    labels[i] = turns && i - last >= 3 ? MONTHS[m - 1] : null;
    if (labels[i]) last = i;
  });
  return (r, i) => labels[i];
};

function Section({ title, children, first = false }) {
  return (
    <section className={`card p-5 effort-section ${first ? '' : 'effort-break'}`}>
      <h3 className="mb-2 text-lg font-bold">{title}</h3>
      {children}
    </section>
  );
}

function Tile({ label, value, sub }) {
  return (
    <div className="rounded-sm border border-neutral-200 p-3">
      <p className="text-xs font-semibold text-neutral-600">{label}</p>
      <p className="mt-0.5 text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-neutral-600">{sub}</p>}
    </div>
  );
}

function Est() {
  return <span className="ml-1 rounded-full border border-neutral-400 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">Estimate</span>;
}

function Notes({ items }) {
  if (!items?.length) return null;
  return (
    <ul className="mt-3 space-y-1.5 text-sm text-neutral-700">
      {items.map((x) => (
        <li key={x.title}>
          <strong>{x.title}</strong> {x.text}
        </li>
      ))}
    </ul>
  );
}

function Summary({ d }) {
  const s = effortSummary(d);
  return (
    <section className="card p-5 effort-section">
      <p className="text-neutral-800">
        Since July the new site has taken about <strong>{num(s.hours.mid)} hours</strong> at the keyboard, and Claude has
        used about <strong>{s.tokens.totalB} billion tokens</strong>. At Anthropic&rsquo;s pay-as-you-go prices that use
        would cost about <strong>{money(s.api.total)}</strong>. {d.notes?.subscription}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4">
        <Tile
          label={<>Hours at the keyboard<Est /></>}
          value={num(s.hours.mid)}
          sub={`Likely ${num(s.hours.low)} to ${num(s.hours.high)}. About ${num(s.hours.measuredMid)} measured, the rest estimated.`}
        />
        <Tile
          label={<>Claude tokens<Est /></>}
          value={`${s.tokens.totalB} billion`}
          sub={`${s.tokens.measuredB} billion measured across ${num(s.tokens.calls)} requests; ${s.tokens.earlyB.mid} billion estimated (${s.tokens.earlyB.low} to ${s.tokens.earlyB.high}).`}
        />
        <Tile
          label={<>At pay-as-you-go prices<Est /></>}
          value={money(s.api.total)}
          sub={`${money(s.api.measured)} of it measured. Covered by the subscription, so not money spent.`}
        />
        <Tile label="Code changes saved" value={`${num(s.commits)} commits`} sub={`Plus ${num(s.prompts)} messages from Lawrence to Claude.`} />
      </div>
    </section>
  );
}

function Produced({ d }) {
  return (
    <Section title="1 · What the time produced" first>
      <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5 print:grid-cols-5">
        {(d.outputs ?? []).map((o) => (
          <div key={o.metric} className="rounded-sm border border-neutral-200 p-3">
            <dt className="text-xs font-semibold text-neutral-600">{o.metric}</dt>
            <dd className="mt-0.5 text-xl font-bold tabular-nums">{num(o.value)}</dd>
          </div>
        ))}
      </dl>
      <h4 className="mt-5 mb-1 font-bold">Milestones</h4>
      <ol className="space-y-0.5 text-sm">
        {(d.milestones ?? []).map((m) => (
          <li key={`${m.date}-${m.milestone}`} className="flex gap-3">
            <span className="w-24 shrink-0 tabular-nums text-neutral-600">{formatDay(m.date)}</span>
            <span>{m.milestone}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function EstimatesTable({ rows, unit }) {
  if (!rows.length) return null;
  return (
    <table className="mt-3 w-full text-sm">
      <thead className="text-left text-neutral-600">
        <tr>
          <th className="th-cell">Period</th>
          <th className="th-cell">How</th>
          <th className="th-cell text-right">Low</th>
          <th className="th-cell text-right">Middle</th>
          <th className="th-cell text-right">High</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.period}-${r.what}`} className="border-t border-neutral-100">
            <td className="td-cell whitespace-nowrap">{r.period}</td>
            <td className="td-cell">
              {r.what}: {r.how}
              {!/^measured/i.test(String(r.how)) && <Est />}
            </td>
            {['low', 'mid', 'high'].map((k) => (
              <td key={k} className="td-cell text-right tabular-nums">
                {unit === 'usd' ? money(r[k]) : num(r[k])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Hours({ d }) {
  const rows = d.weekly ?? [];
  return (
    <Section title="2 · Hours at the keyboard, week by week">
      <p className="mb-3 text-sm text-neutral-700">{d.notes?.hours}</p>
      <VBars
        id="hours"
        rows={rows}
        series={[
          { key: 'hours_measured', label: 'Measured', kind: 'solid' },
          { key: 'hours_estimated', label: 'Estimated', kind: 'hatch' },
        ]}
        xLabel={monthTick(rows)}
        fmt={(v) => `${Math.round(v * 10) / 10}`}
        ariaLabel="Hours at the keyboard each week: measured from session records, and estimated from commit times before mid-September."
      />
      <Legend id="hours-key" items={[['solid', 'Measured from session records'], ['hatch', 'Estimated from commit times']]} />
      <EstimatesTable rows={(d.estimates ?? []).filter((r) => r.what === 'Hours at the keyboard')} />
    </Section>
  );
}

function Tokens({ d }) {
  const rows = d.weekly ?? [];
  return (
    <Section title="3 · Claude tokens, week by week">
      <p className="mb-3 text-sm text-neutral-700">{d.notes?.tokens}</p>
      <VBars
        id="tokens"
        rows={rows}
        series={[
          { key: 'tokens_millions', label: 'Measured (millions)', kind: 'solid' },
          { key: 'tokens_estimated_millions', label: 'Estimated (millions)', kind: 'hatch' },
        ]}
        xLabel={monthTick(rows)}
        fmt={(v) => num(Math.round(v))}
        ariaLabel="Claude tokens each week in millions: measured, and estimated before mid-September."
      />
      <p className="mt-1 text-xs text-neutral-600">Millions of tokens a week.</p>
      <Legend id="tokens-key" items={[['solid', 'Measured'], ['hatch', 'Estimated from the hours worked']]} />
      <EstimatesTable rows={(d.estimates ?? []).filter((r) => r.what !== 'Hours at the keyboard' && !String(r.what).startsWith('Pay'))} />
      <EstimatesTable rows={(d.estimates ?? []).filter((r) => String(r.what).startsWith('Pay'))} unit="usd" />
    </Section>
  );
}

function TokenMix({ d }) {
  const { rows, total } = tokenMixRows(d.token_mix);
  const s = effortSummary(d);
  const line = (r, strong) => (
    <tr key={r.model} className={`border-t border-neutral-100 ${strong ? 'font-bold' : ''}`}>
      <td className="td-cell">{r.model}</td>
      <td className="td-cell text-right tabular-nums">{num(r.calls)}</td>
      <td className="td-cell text-right tabular-nums">{num(r.newM)}</td>
      <td className="td-cell text-right tabular-nums">{num(r.outputM)}</td>
      <td className="td-cell text-right tabular-nums">{num(r.rereadM)}</td>
      <td className="td-cell text-right tabular-nums">{num(r.totalM)}</td>
      <td className="td-cell text-right tabular-nums">{money(r.usd)}</td>
    </tr>
  );
  return (
    <Section title="4 · Where the tokens went">
      <p className="mb-3 text-sm text-neutral-700">{d.notes?.mix} Tokens in millions.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-neutral-600">
            <tr>
              <th className="th-cell">Model</th>
              <th className="th-cell text-right">Requests</th>
              <th className="th-cell text-right">Read new</th>
              <th className="th-cell text-right">Written</th>
              <th className="th-cell text-right">Re-read</th>
              <th className="th-cell text-right">Total</th>
              <th className="th-cell text-right">At API prices</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => line(r, false))}
            {line(total, true)}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-neutral-700">
        <strong>{s.tokens.cacheReadPct}%</strong> of the tokens are Claude re-reading the work so far, billed at a small
        fraction of the normal rate.
      </p>
      <dl className="mt-3 grid gap-2 text-sm text-neutral-700 sm:grid-cols-2 print:grid-cols-2">
        <div>
          <dt className="font-semibold">Requests</dt>
          <dd>Each time Claude is called for its next step: reading a file, running a command, writing an answer. One message from Lawrence can lead to dozens.</dd>
        </div>
        <div>
          <dt className="font-semibold">Read new</dt>
          <dd>Material Claude reads for the first time, like a file it opens or a test result.</dd>
        </div>
        <div>
          <dt className="font-semibold">Written</dt>
          <dd>What Claude writes: code, replies, commands. The most expensive kind, but small.</dd>
        </div>
        <div>
          <dt className="font-semibold">Re-read</dt>
          <dd>With every request Claude reads the whole conversation so far again, from a saved copy. It repeats a lot, so it is most of the total, but it costs a small fraction of the normal rate.</dd>
        </div>
      </dl>
    </Section>
  );
}

function WhenWork({ d }) {
  const night = nightMessages(d.prompt_hours);
  const rows = (d.prompt_hours ?? []).map((r) => ({ ...r, hour: Number(r.hour_et) }));
  const hourWord = (h) => (h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`);
  const lc = d.late_commits;
  return (
    <Section title="5 · When the work happens">
      <p className="mb-3 text-sm text-neutral-700">
        <strong>{num(night.night)}</strong> of {num(night.total)} messages since{' '}
        {d.period?.measured_from ? formatDay(d.period.measured_from) : 'mid-September'} were sent between 10 PM and 6 AM
        Eastern.
        {lc && (
          <>
            {' '}
            In {lc.period}, <strong>{num(lc.night)}</strong> of {num(lc.total)} commits were made between {lc.window}.
          </>
        )}
      </p>
      <VBars
        id="hourly"
        rows={rows}
        series={[{ key: 'prompts', label: 'Messages', kind: 'light' }]}
        kindFor={(r) => (isNightHour(r.hour) ? 'solid' : 'light')}
        xLabel={(r) => (r.hour % 3 === 0 ? hourWord(r.hour) : null)}
        fmt={(v) => num(Math.round(v))}
        height={190}
        ariaLabel="Messages from Lawrence to Claude by hour of the day, Eastern time, with 10 PM to 6 AM marked."
      />
      <p className="mt-1 text-xs text-neutral-600">Messages by hour of the day, Eastern time.</p>
      <Legend id="hourly-key" items={[['solid', '10 PM to 6 AM'], ['light', 'Daytime and evening']]} />
    </Section>
  );
}

function HireOut({ d }) {
  const h = hireOut(d.hire_out);
  const rows = [
    ...h.options.map((o) => ({ label: o.scenario, low: Number(o.cost_low), high: Number(o.cost_high), kind: 'hatch' })),
    ...(h.summary ? [{ label: h.summary.scenario, low: Number(h.summary.cost_low), high: Number(h.summary.cost_high), kind: 'solid' }] : []),
  ];
  return (
    <Section title="6 · What hiring it out might have cost">
      <p className="mb-2 font-semibold text-neutral-900">Estimates, not quotes, and not a donated value.</p>
      <p className="mb-3 text-sm text-neutral-700">
        {d.notes?.hire_intro}
        {h.summary && (
          <>
            {' '}
            Hiring a developer who uses the same AI tools would most likely have cost{' '}
            <strong>
              {money(h.summary.cost_low)} to {money(h.summary.cost_high)}
            </strong>
            .
          </>
        )}
        {h.reference && (
          <>
            {' '}
            For comparison, before AI coding tools an agency would typically have quoted {money(h.reference.cost_low)} to{' '}
            {money(h.reference.cost_high)} for the same scope.
          </>
        )}
      </p>
      {rows.length > 0 && (
        <>
          <RangeBars id="hire" rows={rows} fmt={money} ariaLabel="Estimated cost range for each way of hiring the work out, and the most likely range." />
          <Legend id="hire-key" items={[['hatch', 'Range for each option'], ['solid', 'Most likely overall']]} />
        </>
      )}
      <ul className="mt-3 space-y-1.5 text-sm text-neutral-700">
        {[...h.options, ...(h.summary ? [h.summary] : []), ...(h.reference ? [h.reference] : [])].map((o) => (
          <li key={o.scenario}>
            <strong>{o.scenario}</strong>
            {o.hours_low != null && o.rate_low != null && (
              <>
                {' '}
                ({num(o.hours_low)} to {num(o.hours_high)} hours at {money(o.rate_low)} to {money(o.rate_high)} an hour)
              </>
            )}
            : {o.basis}
          </li>
        ))}
      </ul>
      <h4 className="mt-4 font-bold">How sure is this? Not very.</h4>
      <Notes items={d.notes?.hire_caveats} />
    </Section>
  );
}

function RunningCosts({ d }) {
  const settings = d.run_settings ?? {};
  const m = runModel(d.run_rates, settings);
  return (
    <Section title="7 · Where the money goes">
      <p className="mb-3 text-sm text-neutral-700">{d.notes?.run_intro}</p>
      {m.error ? (
        <Notice tone="error">The running costs can&rsquo;t be worked out: {m.error}</Notice>
      ) : (
        <RunningCostsBody d={d} m={m} settings={settings} />
      )}
    </Section>
  );
}

function RunningCostsBody({ d, m, settings }) {
  const t = m.totals;
  const sens = runSensitivity(d.run_rates, settings);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4">
        <Tile label={<>Old setup, a year<Est /></>} value={money(t.old)} sub="CampSite, Squarespace, PayPal, Checkr" />
        <Tile label={<>New setup, a year<Est /></>} value={money(t.new)} sub="Stripe, Vercel, Supabase, VolunteerBadge" />
        <Tile label={<>Saving, a year<Est /></>} value={money(t.saving)} sub={`${t.savingPct}% less than the old setup`} />
        <Tile
          label={<>In scholarships<Est /></>}
          value={`about ${num(t.scholarshipsEquiv)} more a year`}
          sub={`At last season’s average of about ${money(t.avgScholarship)} each.`}
        />
      </div>
      {settings.note && <p className="mt-3 text-sm text-neutral-700">{settings.note}</p>}
      <div className="mt-4">
        <PairedBars id="run" rows={m.lines} fmt={money} ariaLabel={`Yearly running cost by line, old setup against new: ${money(t.old)} against ${money(t.new)}.`} />
        <Legend id="run-key" items={[['light', 'Old setup'], ['solid', 'New setup']]} />
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-neutral-600">
            <tr>
              <th className="th-cell">Cost a year</th>
              <th className="th-cell">Old: how it&rsquo;s charged</th>
              <th className="th-cell text-right">Old</th>
              <th className="th-cell">New: how it&rsquo;s charged</th>
              <th className="th-cell text-right">New</th>
              <th className="th-cell text-right">Saving</th>
            </tr>
          </thead>
          <tbody>
            {m.lines.map((l) => (
              <tr key={l.line} className="border-t border-neutral-100">
                <td className="td-cell">{l.line}</td>
                <td className="td-cell text-neutral-700">{l.oldWay}</td>
                <td className="td-cell text-right tabular-nums">{money(l.old)}</td>
                <td className="td-cell text-neutral-700">{l.newWay}</td>
                <td className="td-cell text-right tabular-nums">{money(l.new)}</td>
                <td className="td-cell text-right tabular-nums">{money(l.saving)}</td>
              </tr>
            ))}
            <tr className="border-t border-neutral-300 font-bold">
              <td className="td-cell">Total</td>
              <td className="td-cell" />
              <td className="td-cell text-right tabular-nums">{money(t.old)}</td>
              <td className="td-cell" />
              <td className="td-cell text-right tabular-nums">{money(t.new)}</td>
              <td className="td-cell text-right tabular-nums">{money(t.saving)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h4 className="mt-5 font-bold">How much bank transfers matter</h4>
      <p className="text-sm text-neutral-700">
        The same settings, with more or fewer people paying by bank transfer instead of by card. The old setup had no bank
        option, so its cost stays the same.
      </p>
      <table className="mt-2 w-full max-w-lg text-sm">
        <thead className="text-left text-neutral-600">
          <tr>
            <th className="th-cell">Paid by bank transfer</th>
            <th className="th-cell text-right">Old</th>
            <th className="th-cell text-right">New</th>
            <th className="th-cell text-right">Saving</th>
          </tr>
        </thead>
        <tbody>
          {sens.map((r) => (
            <tr key={r.share} className={`border-t border-neutral-100 ${r.share === Number(settings.bank_pct) ? 'font-bold' : ''}`}>
              <td className="td-cell">{r.share}%</td>
              <td className="td-cell text-right tabular-nums">{money(r.old)}</td>
              <td className="td-cell text-right tabular-nums">{money(r.new)}</td>
              <td className="td-cell text-right tabular-nums">{money(r.saving)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4 className="mt-5 font-bold">Other savings, counted and not</h4>
      <Notes items={d.notes?.run_other} />
      <h4 className="mt-5 font-bold">What these figures assume, and what they leave out</h4>
      <Notes items={d.notes?.run_assumptions} />
      <h4 className="mt-5 font-bold">Rates used</h4>
      <table className="mt-1 w-full text-xs">
        <thead className="text-left text-neutral-600">
          <tr>
            <th className="th-cell">Setup</th>
            <th className="th-cell">What</th>
            <th className="th-cell">Source</th>
          </tr>
        </thead>
        <tbody>
          {(d.run_rates ?? []).map((r) => (
            <tr key={r.key} className="border-t border-neutral-100">
              <td className="td-cell whitespace-nowrap">{r.setup === 'both' ? 'Both' : r.setup === 'old' ? 'Old' : 'New'}</td>
              <td className="td-cell">{r.what}</td>
              <td className="td-cell text-neutral-600">{r.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Method({ d }) {
  if (!d.notes?.method?.length) return null;
  return (
    <Section title="How the build numbers were worked out, and what they leave out">
      <Notes items={d.notes.method} />
    </Section>
  );
}
