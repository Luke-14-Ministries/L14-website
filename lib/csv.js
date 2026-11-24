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

// The response every staff CSV export sends (security review, 23 Nov 2026).
// Eight routes built their own headers and most left out the cache rule, so a
// file of family names, phones or payments could be kept by a shared cache
// or a browser's back button. One place now says: a CSV download, never
// cached anywhere but this browser for this moment, never sniffed as
// something else.
//
// `filename` is the name as people should see it ("Children - Camp
// Celebrate 2027 - Week 2.csv"). Characters Windows refuses become spaces;
// filename= carries a plain-ASCII copy for old browsers, and filename*= the
// real name (dashes and accents included).
export function csvResponse(csv, filename) {
  const base = String(filename || 'export.csv')
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const name = /\.csv$/i.test(base) ? base : `${base}.csv`;
  const ascii = name.replace(/[–—]/g, '-').replace(/[^\x20-\x7e]/g, '').trim() || 'export.csv';
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// Record the download in export_log (0182; shown on Access Changes). The
// filters are the export's own URL choices; empty ones are left out.
//
// Never stops the download: a log that cannot be written is reported in the
// server log, and the staff member still gets the file. (Refusing would also
// break every export for the minutes between a deploy and its migration.)
export async function logExport(supabase, kind, filters = {}) {
  const clean = Object.fromEntries(
    Object.entries(filters ?? {})
      .filter(([, v]) => v !== '' && v !== null && v !== undefined && v !== false)
      .map(([k, v]) => [k, String(v).slice(0, 200)])
  );
  try {
    const { error } = await supabase.rpc('log_export', { p_kind: kind, p_filters: clean });
    if (error) console.error(`log_export ${kind}:`, error.message);
  } catch (e) {
    console.error(`log_export ${kind}:`, e?.message);
  }
}
