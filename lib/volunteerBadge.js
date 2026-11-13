// The site's VolunteerBadge client (0165, 13 Nov 2026). Server only: it holds
// VOLUNTEERBADGE_API_KEY, which never reaches a browser, a log or a page.
//
//   vb_test_...  sandbox: no credit, no real check, simulated results that
//                never clear anyone (Vercel Preview and .env.local)
//   vb_live_...  real checks, real credits (Vercel Production, added later)
//   unset        "VolunteerBadge isn't connected yet"; nothing breaks
//
// What the client can and cannot do is lib/volunteerBadgeApi.js.

import 'server-only';
import { makeVolunteerBadge } from './volunteerBadgeApi';

// 'off' | 'test' | 'live'. Safe to show: it says which mode, never the key.
export function volunteerBadgeMode() {
  const key = process.env.VOLUNTEERBADGE_API_KEY || '';
  if (!key) return 'off';
  return key.startsWith('vb_test_') ? 'test' : 'live';
}

// A client, or null when no key is set.
export function volunteerBadge() {
  return makeVolunteerBadge({ key: process.env.VOLUNTEERBADGE_API_KEY || '' });
}

// Optional: which application template to send. Unset, the account's default
// (VB lists it first).
export function volunteerBadgeTemplateId() {
  return (process.env.VOLUNTEERBADGE_TEMPLATE_ID || '').trim() || null;
}
