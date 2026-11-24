// Under every box that asks for a two-factor code (23 Nov 2026). Someone
// whose phone is lost or replaced had no word anywhere on the code step of
// what to do, and no way through. An administrator can reset two-factor on
// an account (Accounts, 0104); this line is the way to ask. A person, not a
// form: someone at this box is locked out.
//
// 4953 is Larry's line, the one for account and sign-in help (confirmed
// 21 Aug 2026; the footer's 4954 is the camp director's general line).
export default function LostPhoneNote({ className = '' }) {
  return (
    <p className={`text-sm text-neutral-600 ${className}`}>
      Lost the phone with your authenticator app? Email{' '}
      <a href="mailto:info@luke14ministries.net" className="text-brand underline break-all">
        info@luke14ministries.net
      </a>{' '}
      or call{' '}
      <a href="tel:+14237484953" className="text-brand underline whitespace-nowrap">
        (423) 748-4953
      </a>
      . Once we know it&rsquo;s you, we can turn two-factor off so you can set it up again.
    </p>
  );
}
