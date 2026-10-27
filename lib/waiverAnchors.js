// The anchor of one upload's row in Activities' "Confirmations to check"
// list. A plain module, not the 'use client' WaiverReview.jsx: the server
// page renders the rows and the client pill links to them, and a server
// component cannot call a function exported from a client module (it crashed
// /admin/activities whenever the list had a row, 26 Oct 2026).
export const checkAnchor = (uploadId) => `check-${uploadId}`;
