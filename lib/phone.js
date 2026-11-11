// Phone numbers: one place for how the site reads, tidies and dials them.
// No imports, so it loads anywhere (client, server, and `node --test`).
// lib/format.js re-exports these, so existing imports keep working.
//
// House rule (lib/format.js): TIDY, NEVER MANGLE. Only a clean US number is
// reformatted; anything else comes back exactly as typed.
//
// Extensions stay in the same field (Lawrence, 11 Nov 2026: rare on family
// and emergency phones, and a column would mean schema, forms, staff pages
// and exports for very little). They are read off the END of the number:
// "x12", "ext 12", "ext. 12", "extension 12", optionally after a comma.

const EXTENSION = /\s*[,;]?\s*(?:x|ext\.?|extension)\s*(\d+)\s*$/i;

// { main, ext }: the number without its extension, and the extension's digits
// (or '' when there is none).
export function splitExtension(raw) {
  const s = String(raw ?? '');
  const m = s.match(EXTENSION);
  if (!m) return { main: s, ext: '' };
  return { main: s.slice(0, m.index), ext: m[1] };
}

export function withoutExtension(raw) {
  return splitExtension(raw).main;
}

// A US phone number with its area code: ten digits, or eleven starting with
// 1 (Lawrence, 26 Oct 2026: an emergency contact saved as "423200"). Any
// punctuation is fine, and an extension is not counted.
export function isFullPhone(raw) {
  const digits = withoutExtension(raw).replace(/\D/g, '');
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
}

// Tidy a US phone number into (423) 200-6158, keeping any extension as
// "(423) 200-6158 ext. 12". Anything that is not a clean 10-digit (or
// 1-plus-10) number -- a foreign number, half-typed digits -- is returned
// exactly as entered.
export function formatPhone(raw) {
  const { main, ext } = splitExtension(raw);
  const digits = main.replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length !== 10) return raw;
  const tidy = `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return ext ? `${tidy} ext. ${ext}` : tidy;
}

// The href that dials a stored phone number, or null when there is nothing to
// dial. A US number becomes tel:+14232006158, and an extension is added the
// standard way (RFC 3966), tel:+14232006158;ext=12 -- never glued onto the
// number, which would dial a different number. A number typed with a leading
// "+" keeps it; anything else is dialed as its digits.
export function telHref(raw) {
  const { main, ext } = splitExtension(raw);
  const digits = main.replace(/\D/g, '');
  if (!digits) return null;
  let number;
  if (main.trim().startsWith('+')) number = `+${digits}`;
  else if (digits.length === 10) number = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith('1')) number = `+${digits}`;
  else number = digits;
  return ext ? `tel:${number};ext=${ext}` : `tel:${number}`;
}
