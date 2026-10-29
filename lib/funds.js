// The funds a gift can be designated to -- the one list, read by the public
// Donate form, its server-side check (app/donate/actions.js) and the staff
// Record a gift form. The first is the default.
//
// Taking a fund off this list only stops NEW gifts choosing it. Gifts already
// recorded keep their fund as stored (gifts.fund is free text, no check), and
// the Giving page's fund filter, the statements and the CSV exports all read
// the stored rows, so an old fund still shows wherever it was used. The Stripe
// webhook records whatever fund the checkout carried, so adding a fund here
// needs no change to the edge function.
//
// The Hazelnut Movement came off on 28 Oct 2026 (spun out to another
// ministry). Luke 14 Party Meals came on the same day and went again on
// 29 Oct (Larry: no store page and no meal donation; Party payments will go
// through Stripe at the Party itself).
export const DONATION_FUNDS = [
  'General Operating Fund',
  'Camp Celebrate',
  'Luke 14 Party',
  'Wheels for Kenya',
];
