'use client';

// One staff member's grants: the ten areas, each none / read / write, and
// the preset buttons that set them in one click (Luke14-Access-Model-Plan;
// build plan item 16, step 2). Opens under the person's row on Staff &
// Access. Since 0101 these ticks are what the database enforces; the role
// radio beside them is a label, except that 'Administrator' is what lets a
// person grant anything.

import { useState } from 'react';
import { AREAS, PRESETS, PRESET_LEAVES, grantsForPreset, matchingPreset, nearestPreset } from '@/lib/grants';

const LEVELS = [
  ['', '—'],
  ['read', 'R'],
  ['write', 'W'],
];

export default function GrantsPanel({ member, busy, onApplyPreset, onSave, onClose }) {
  const [grants, setGrants] = useState(() => ({ ...(member.grants ?? {}) }));
  const dirty = JSON.stringify(grants) !== JSON.stringify(member.grants ?? {});
  const matches = matchingPreset(member.grants ?? {});
  // No exact match is the normal case; say so, and name the nearest preset.
  const nearest = matches ? null : nearestPreset(member.grants ?? {});
  const level = (v) => (v === 'write' ? 'W' : v === 'read' ? 'R' : '—');

  const set = (area, level) =>
    setGrants((prev) => {
      const next = { ...prev };
      if (level) next[area] = level;
      else delete next[area];
      return next;
    });

  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-bold">
            Grants for {member.name}
            {matches ? (
              <span className="ml-2 rounded-full bg-brand-light px-2 py-0.5 text-xs font-semibold text-brand-dark">
                matches {PRESETS[matches].label}
              </span>
            ) : (
              <span className="ml-2 rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-semibold text-neutral-700">
                Custom
              </span>
            )}
          </p>
          {nearest && (
            <p className="mt-0.5 text-xs text-neutral-600">
              Nearest preset: <em>{nearest.label}</em>, except{' '}
              {nearest.diffs.map((d) => `${d.label} ${level(d.have)}`).join(', ')}.
            </p>
          )}
          <p className="mt-0.5 text-xs text-neutral-600">
            R = read, W = write, — = no access. Giving is never set by a preset — tick it by hand
            for a named person. Every change is written to the access log.
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-xs underline">
          Close
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-neutral-600">Apply a preset:</span>
        {Object.entries(PRESETS).map(([key, p]) => (
          <button
            key={key}
            type="button"
            disabled={busy}
            title={p.note}
            onClick={() => {
              if (
                window.confirm(
                  `Apply the ${p.label} preset to ${member.name}?\n\n${p.note}\n\nThis sets every area to the preset (Giving is left as it is). The Administrator tick is not touched.`
                )
              ) {
                onApplyPreset(member.profileId, key);
                setGrants(grantsForPreset(key, member.grants ?? {}));
              }
            }}
            className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs font-semibold hover:border-brand hover:text-brand disabled:opacity-50"
          >
            {p.label}
          </button>
        ))}
      </div>

      <table className="mt-3 w-full text-left text-sm">
        <thead className="text-xs text-neutral-500">
          <tr>
            <th className="py-1 pr-3 font-semibold">Area</th>
            <th className="py-1 pr-3 font-semibold text-center" colSpan={3}>
              Access
            </th>
            <th className="py-1 font-semibold">What it covers</th>
          </tr>
        </thead>
        <tbody>
          {AREAS.map(([key, label, what]) => (
            <tr key={key} className="border-t border-neutral-200">
              <td className="py-1.5 pr-3 font-medium whitespace-nowrap">
                {label}
                {PRESET_LEAVES.has(key) && (
                  <span className="ml-1 text-xs font-normal text-neutral-500" title="Never set by a preset">
                    (by hand)
                  </span>
                )}
              </td>
              {LEVELS.map(([lvl, text]) => (
                <td key={lvl} className="py-1.5 px-1 text-center">
                  <label className="inline-flex cursor-pointer items-center gap-1">
                    <input
                      type="radio"
                      name={`grant-${member.profileId}-${key}`}
                      checked={(grants[key] ?? '') === lvl}
                      disabled={busy}
                      onChange={() => set(key, lvl)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="text-xs font-semibold">{text}</span>
                  </label>
                </td>
              ))}
              <td className="py-1.5 text-xs text-neutral-600">{what}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={() => onSave(member.profileId, grants)}
          className="btn-primary py-1.5! text-sm disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save grants'}
        </button>
        {dirty && !busy && (
          <button
            type="button"
            onClick={() => setGrants({ ...(member.grants ?? {}) })}
            className="text-xs underline"
          >
            Undo changes
          </button>
        )}
        <span className="text-xs text-neutral-500">
          These ticks are what the database enforces. The role on the left is a label, except
          that <em>Administrator</em> is what lets a person grant anything.
        </span>
      </div>
    </div>
  );
}
