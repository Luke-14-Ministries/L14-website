// WHEN each automatic email goes (decided 27 Oct 2026, Lawrence and Larry;
// 01 Plans and Decisions\Luke14-Automatic-Emails-Draft.pdf §1). Pure date
// rules on YYYY-MM-DD strings in ministry time, so they can be checked on
// their own and the job, the "due in the next 7 days" list and a test run
// with ?date= all agree.
//
//   deposit, balance   monthly on the 15th until paid, then 2 weeks before
//                      the balance due date and on it
//   past due           weekly after the due date (same weekday), until paid
//                      or paused
//   missing details    monthly on the 15th until done, then 2 weeks and 5
//                      days before the first day
//   not submitted      3 days after it was started, then weekly for 3 weeks
//   plan upcoming      1 week before each automatic payment
//   staff summary      Mondays

export const MONTHLY_DAY = 15;

const ms = (iso) => Date.parse(`${iso}T12:00:00Z`);
export function addDays(iso, n) {
  return new Date(ms(iso) + n * 86400000).toISOString().slice(0, 10);
}
export function daysBetween(fromIso, toIso) {
  return Math.round((ms(toIso) - ms(fromIso)) / 86400000);
}
const isMonthlyDay = (today) => Number(today.slice(8, 10)) === MONTHLY_DAY;

// Deposit and balance reminders (before the due date, or with no due date).
export function moneyReminderDay(today, dueOn) {
  if (isMonthlyDay(today) && (!dueOn || today <= dueOn)) return true;
  return Boolean(dueOn) && (today === addDays(dueOn, -14) || today === dueOn);
}

// The weekly past-due note: every 7 days after the due date.
export function pastDueDay(today, dueOn) {
  if (!dueOn || today <= dueOn) return false;
  return daysBetween(dueOn, today) % 7 === 0;
}

// Missing details: monthly, then 2 weeks and 5 days before the first day.
export function detailsReminderDay(today, startsOn) {
  if (!startsOn || today >= startsOn) return false;
  return isMonthlyDay(today) || today === addDays(startsOn, -14) || today === addDays(startsOn, -5);
}

// A registration started but not submitted: 3, 10, 17 and 24 days after.
// Returns which of the four this is (1-4), or 0.
export function notSubmittedStep(today, startedOn) {
  const d = daysBetween(startedOn, today);
  return [3, 10, 17, 24].indexOf(d) + 1;
}

export function isMonday(today) {
  return new Date(ms(today)).getUTCDay() === 1;
}
