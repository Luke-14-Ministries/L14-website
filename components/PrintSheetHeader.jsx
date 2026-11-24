import BackLink from '@/components/BackLink';
import PrintButton from '@/components/PrintButton';

// The top of every print sheet (23 Nov 2026, review): the sheet's name, the
// way back and Print on the right, and one line saying what the sheet is for.
// Eleven sheets each wrote this out by hand, so titles drifted ("Buddy
// Sheets", "Rosters (print view)", "Volunteer List") and three sheets had no
// title on screen at all. None of it prints: the sheet's own heading (the
// event, its dates) is what goes on paper. Sentence-case titles, no "(print
// view)": the page is plainly a print sheet.
//
// A server component (PrintButton and BackLink are the client parts), so any
// sheet may use it.
export default function PrintSheetHeader({ title, back, printLabel, intro, introClassName = 'mb-6' }) {
  return (
    <>
      <div className="mb-2 flex items-start justify-between gap-4 print:hidden">
        <h1 className="text-xl font-bold">{title}</h1>
        {/* The way back on the title's line, Print under it (27 Oct 2026). */}
        <span className="flex shrink-0 flex-col items-end gap-2">
          {back && <BackLink href={back.href} label={back.label} />}
          <PrintButton label={printLabel} />
        </span>
      </div>
      {intro && <p className={`${introClassName} text-sm text-neutral-500 print:hidden`}>{intro}</p>}
    </>
  );
}
