// One-click unsubscribe for the prayer list (0141; RFC 8058). Gmail and
// Outlook show an "Unsubscribe" button for mail carrying List-Unsubscribe and
// List-Unsubscribe-Post headers, and press it by POSTing here. POST only: a
// GET does nothing, so a mail scanner opening the address unsubscribes
// nobody. The footer link goes to /pray/unsubscribe/, which has a button.

import { unsubscribePrayerList } from '@/app/pray/actions';

export async function POST(request) {
  const token = new URL(request.url).searchParams.get('t') ?? '';
  const res = await unsubscribePrayerList(token);
  // 200 whenever the address is off the list (or already was); the mail
  // provider only needs to know the request was taken.
  return new Response(res.ok ? 'Unsubscribed' : res.error, { status: res.ok || /no longer valid/.test(res.error ?? '') ? 200 : 400 });
}

export function GET() {
  return new Response('Use the Unsubscribe link at the bottom of a prayer email.', { status: 405 });
}
