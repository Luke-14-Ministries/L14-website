// How an activity's time is written (0052: times AT CAMP, a date and two
// times of day, never converted). A plain module so the server page and the
// client editor share it -- a server component cannot call a function
// exported from a 'use client' file (26 Oct 2026).

export const fmtDay = (iso) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};

export const fmtTime = (t) => {
  if (!t) return '';
  const [h, min] = String(t).split(':').map(Number);
  if (Number.isNaN(h)) return t;
  const ampm = h >= 12 ? 'pm' : 'am';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return min ? `${hh}:${String(min).padStart(2, '0')}${ampm}` : `${hh}${ampm}`;
};

export const slotLabel = (s) =>
  `${fmtDay(s.slot_date)} ${fmtTime(s.start_time)}–${fmtTime(s.end_time)}${
    s.label ? ` · ${s.label}` : ''
  }`;
