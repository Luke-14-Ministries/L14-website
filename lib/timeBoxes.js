// A time box can look filled while holding nothing (Ellen, 5 Nov 2026).
// Chrome and Edge show "02:00 --" until AM or PM is picked, and until then the
// box's value is the empty string: the page reads "no time given". On the
// Activities page that was a red "Give a start and end time" for times that
// were plainly on screen; on Setup an unfinished "Registration opens" would
// have saved as blank, which means no limit, i.e. open now.
//
// The browser does know the box is half-filled (validity.badInput), so ask it
// before sending anything and name the box. Browser only: pass the input
// elements (refs), with the label the person sees.
export function unfinishedTimeBox(boxes) {
  for (const [el, label] of boxes) {
    if (el?.validity?.badInput) {
      return `"${label}" is not finished. Pick AM or PM, or fill in the part still showing dashes.`;
    }
  }
  return '';
}

// The one reading of a time typed into a slot (server and browser). Ellen's
// Safari 26 (5 Nov 2026) was refused "Give a start and end time" with
// "01:00 PM" and "04:30 PM" plainly in the boxes; the action accepted only
// "HH:MM". This takes what any browser or hand might send -- "13:00",
// "13:00:00", "13:00:00.000", "1:00 PM", "1pm" -- and returns "HH:MM",
// zero-padded so two times compare as strings; '' when it is not a time.
export function toHHMM(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2}(?:\.\d+)?)?\s*(a\.?m\.?|p\.?m\.?)?$/);
  if (!m) return '';
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const half = m[3]?.[0];
  if (half) {
    if (h < 1 || h > 12) return '';
    if (half === 'p' && h !== 12) h += 12;
    if (half === 'a' && h === 12) h = 0;
  } else if (m[2] === undefined) {
    return ''; // a bare number is not a time
  }
  if (h > 23 || min > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
