// A boxed message on a staff page (23 Nov 2026, the admin review: failed
// saves showed as red words, red boxes or amber boxes depending on the file).
//   error  red    something failed: a save, a load
//   warn   amber  look at this before going on
//   ok     green  it worked
//   info   teal   a plain note
// role="alert" on an error, so a screen reader hears a failed save at once;
// the others are role="status". No 'use client', so server pages use it too.

const TONE = {
  error: 'border-red-200 bg-red-50 text-red-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-900',
  ok: 'border-green-200 bg-green-50 text-green-800',
  info: 'border-brand/30 bg-brand-light text-brand-dark',
};

export default function Notice({ tone = 'info', title, className = '', children }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-sm border px-3 py-2 text-sm ${TONE[tone] ?? TONE.info} ${className}`}
    >
      {title && <span className="font-semibold">{title} </span>}
      {children}
    </div>
  );
}
