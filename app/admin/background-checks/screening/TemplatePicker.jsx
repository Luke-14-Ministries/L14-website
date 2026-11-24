'use client';

// Which VolunteerBadge application template each group gets (0170; the board,
// 14 Nov 2026: volunteers and family adults kept apart). VolunteerBadge's own
// list of templates, so a renamed or new one shows up here without a change
// to the site. Unset = VolunteerBadge's default template.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveVbTemplates } from './actions';

export default function TemplatePicker({ templates, volunteer, family }) {
  const router = useRouter();
  const [v, setV] = useState(volunteer ?? '');
  const [f, setF] = useState(family ?? '');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const changed = v !== (volunteer ?? '') || f !== (family ?? '');
  const defaultName = templates.find((t) => t.isDefault)?.name ?? templates[0]?.name ?? 'VolunteerBadge’s default';

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const r = await saveVbTemplates({ volunteer: v, family: f });
      setNote(r.ok ? { tone: 'yes', text: 'Saved.' } : { tone: 'no', text: r.error });
      if (r.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const pick = (id, value, onChange, label) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-semibold">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="field-sm w-auto"
      >
        <option value="">Default ({defaultName})</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="rounded-sm border border-neutral-200 bg-neutral-50 px-4 py-3">
      <p className="text-sm font-semibold">VolunteerBadge application templates</p>
      <div className="mt-2 flex flex-wrap items-end gap-4">
        {pick('vb-template-volunteer', v, setV, 'Volunteers')}
        {pick('vb-template-family', f, setF, 'Family adults')}
        <button type="button" onClick={save} disabled={busy || !changed} className="btn-outline btn-sm disabled:opacity-50">
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {note && <p className={`mt-1.5 text-sm ${note.tone === 'no' ? 'text-red-800' : 'text-green-800'}`}>{note.text}</p>}
    </div>
  );
}
