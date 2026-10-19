// One CSV cell, safe to open in Excel or import into QuickBooks.
//
// Two jobs. Quoting: a comma, quote or line break inside a value is wrapped
// in quotes, with quotes doubled. Formula injection (security audit, 18 Oct
// 2026): a cell that STARTS with = + - @, a tab or a carriage return is run
// as a formula by spreadsheet programs. Names, notes and a donor's cardholder
// name are typed by the public, so `=HYPERLINK(...)` in a child's name could
// otherwise land in a staff spreadsheet as a working link. Such a cell gets a
// leading apostrophe, which Excel shows as plain text.
//
// Plain numbers are left alone, so a refund printed as -12.50 stays a number.
const NUMBER = /^-?\d+(\.\d+)?$/;
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(v) {
  let s = String(v ?? '');
  if (FORMULA_START.test(s) && !NUMBER.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// For a file with its own strict format (the Checkr bulk upload), where a
// quoted cell is not allowed: commas, quotes and line breaks become spaces,
// and leading formula characters are dropped.
export function csvPlainText(v) {
  return String(v ?? '')
    .replace(/[",\r\n]/g, ' ')
    .trim()
    .replace(/^[=+\-@\t]+/, '')
    .trim();
}
