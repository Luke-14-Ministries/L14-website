// RETIRED 18 Oct 2026 (security audit, finding H2).
//
// This function reset a person's two-factor using the service-role key after
// checking only that the caller was an administrator: a password alone (no
// code) could reset anyone's two-factor, including the caller's own, and
// nothing was logged. Admin -> Security now calls a server action that goes
// through public.admin_reset_mfa() (migration 0104): a code-verified session,
// never your own account, and an entry in staff_access_log.
//
// Left deployed as this stub so an old browser tab gets a clear answer
// instead of a missing endpoint. It does nothing and holds no keys.

Deno.serve(() =>
  new Response(
    JSON.stringify({ error: "This reset path is retired. Use Admin -> Security, which now resets through the database." }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  )
);
