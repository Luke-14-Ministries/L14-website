// The ministry's QuickBooks, as the two QuickBooks exports use it
// (app/admin/exports/payments, app/admin/exports/giving).
//
// Larry, 29 Oct 2026: every payment received is booked to an ACCOUNT and a
// CLASS. The class is which event or program it is (e.g. "Camp Celebrate 1");
// the accounts, with their numbers:
//   40000 Individual contributions
//   41000 Corporate grants
//   42000 Foundation grants
//   44000 Purchase of goods or services
//
// Each payment is entered in QuickBooks as a SALES RECEIPT (Lawrence's
// screenshot, 29 Oct): Donor, Email, Sales Receipt Date, Payment method,
// Reference no., Deposit To, then lines of Product/Service, Description, Qty,
// Rate, Amount, Class. The Product/Service is the event, and in QuickBooks a
// product carries its income account, so the account follows from it; the
// Account column here says which one it should be, as a check. A refund is a
// REFUND RECEIPT, the same fields with the money going back.
//
// So the export is one row per receipt LINE, in the receipt's own field
// order: a payment is one receipt, with a second line when the payer covered
// the processing fee (same product and class, so it lands on the same receipt
// and in the same account). Rows of one receipt share the Receipt column.

export const QB_ACCOUNT = {
  individual: '40000 Individual Contributions',
  corporate: '41000 Corporate Grants',
  foundation: '42000 Foundation Grants',
  goods: '44000 Purchase of Goods or Services',
};

// Registration payments are a purchase of a service (a place at camp); gifts
// through Donate or recorded by staff are individual contributions. Grants
// (41000, 42000) never come through the site and are entered by hand.
export const QB_REGISTRATION_ACCOUNT = QB_ACCOUNT.goods;
export const QB_GIFT_ACCOUNT = QB_ACCOUNT.individual;

// Where QuickBooks puts money received until it is deposited (the receipt's
// Deposit To default): Stripe pays out in batches, net of its fee, and the
// treasurer groups the receipts into each payout's deposit.
export const QB_DEPOSIT_TO = '12000 Undeposited Funds';

// An event's Product/Service and Class: the event itself (Lawrence, 29 Oct:
// "that's just the event"), by its name as Setup shows it.
export function eventProduct(ev) {
  return ev?.name ?? '';
}

// A gift's Product/Service and Class: its fund, the program it was given to.
export function giftProduct(fund) {
  return String(fund ?? '').trim() || 'General Operating Fund';
}

// The receipt's Payment method, in QuickBooks' words.
const METHOD = {
  card: 'Credit Card',
  bank_transfer: 'Bank Transfer (ACH)',
  check: 'Check',
  cash: 'Cash',
  other: 'Other',
};
export function qbPaymentMethod(method) {
  return METHOD[method] ?? (method || '');
}

// MM/DD/YYYY, which QuickBooks Online reads without a format question.
export function qbDate(day) {
  const [y, m, d] = String(day ?? '').split('-');
  return y && m && d ? `${m}/${d}/${y}` : '';
}

export const QB_HEADER = [
  'Receipt', 'Type', 'Sales Receipt Date', 'Donor', 'Email', 'Payment method', 'Reference no.',
  'Deposit To', 'Service date', 'Product/Service', 'Description', 'Qty', 'Rate', 'Amount', 'Class',
  'Account',
];

// The rows of one receipt. `lines` are { description, cents }; a refund
// passes positive cents and type 'Refund Receipt' (QuickBooks' refund form
// takes the amount as a positive figure).
export function receiptRows({ receipt, type = 'Sales Receipt', day, donor, email, method, reference, serviceDay, product, account, lines }) {
  return lines.map(({ description, cents }) => {
    const amount = ((cents ?? 0) / 100).toFixed(2);
    return [
      receipt, type, qbDate(day), donor ?? '', email ?? '', qbPaymentMethod(method), reference ?? '',
      QB_DEPOSIT_TO, qbDate(serviceDay), product, description, '1', amount, amount, product, account,
    ];
  });
}
