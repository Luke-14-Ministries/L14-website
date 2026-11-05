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
