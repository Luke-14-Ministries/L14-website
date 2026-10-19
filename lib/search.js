// Typed search text made safe for a PostgREST `.or()` of `ilike` filters
// (Script 5, 18 Oct 2026).
//
// Two separate problems, both from putting a person's typing inside a filter
// string:
//
// 1. LIKE wildcards. `_` matches any one character and `%` any run, so they
//    must be ESCAPED, not dropped: dropping them turned "alastair_laptest"
//    into "alastairlaptest", which matches nothing. A backslash is LIKE's
//    escape character, so it is escaped first.
// 2. Filter syntax. Inside `.or(a.ilike.x,b.ilike.y)` a comma starts another
//    filter, parentheses group, and a double quote opens a quoted value. Typed
//    into the box they changed the query itself. They are not in anyone's
//    name or email, so they become word breaks. (An apostrophe is not
//    PostgREST syntax and stays, so "O'Brien" still finds O'Brien.)

const FILTER_SYNTAX = /[,()"]/g;

// The words of a search, at most `max`, with filter syntax treated as spaces.
export function searchWords(text, max = 4) {
  return String(text ?? '')
    .replace(FILTER_SYNTAX, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, max);
}

// One term as a "contains" pattern for ilike inside .or(): filter syntax
// removed, LIKE wildcards escaped, wrapped in %…%. '' when nothing is left.
export function ilikeContains(term) {
  const clean = String(term ?? '')
    .replace(FILTER_SYNTAX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';
  return `%${clean.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
