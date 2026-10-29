// The ministry's QuickBooks chart, as the two QuickBooks exports use it
// (app/admin/exports/payments, app/admin/exports/giving).
//
// Larry, 29 Oct 2026: every payment received is booked to an ACCOUNT and a
// CLASS. The class is which event or program it is (e.g. "Camp Celebrate 1");
// the accounts, with their numbers:
//   40000 Individual contributions
//   41000 Corporate grants
//   42000 Foundation grants
//   44000 Purchase of goods or services
// The names are written as QuickBooks shows an account when account numbers
// are on ("40000 Individual Contributions"); QuickBooks matches them on
// import, and a name that differs is mapped once there.

export const QB_ACCOUNT = {
  individual: '40000 Individual Contributions',
  corporate: '41000 Corporate Grants',
  foundation: '42000 Foundation Grants',
  goods: '44000 Purchase of Goods or Services',
};

// What each kind of money is booked to. Registration payments are a purchase
// of a service (a place at camp); gifts through Donate or recorded by staff
// are individual contributions. A processing fee the payer chose to cover is
// part of the same payment, so it goes to the same account and class, on its
// own line so it can be seen.
export const QB_REGISTRATION_ACCOUNT = QB_ACCOUNT.goods;
export const QB_GIFT_ACCOUNT = QB_ACCOUNT.individual;

// An event's class is the event itself (Lawrence, 29 Oct 2026: "that's just
// the event"), so its name as Setup shows it, e.g. "Camp Celebrate — Week 1".
export function eventClass(ev) {
  return ev?.name ?? '';
}

// A gift's class is its fund, the program it was given to; a gift to the
// General Operating Fund has no program, so no class.
export function giftClass(fund) {
  const f = String(fund ?? '').trim();
  return !f || f === 'General Operating Fund' || f === 'General' ? '' : f;
}
