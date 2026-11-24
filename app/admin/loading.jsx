// Shown while a staff page loads (cosmetic review, 15 Nov 2026): the sidebar
// stays, and this fills the page area instead of nothing.
export default function Loading() {
  return (
    <div className="card" role="status" aria-live="polite">
      <div className="h-6 w-48 animate-pulse rounded-sm bg-neutral-200" />
      <div className="mt-4 space-y-2">
        <div className="h-4 w-full animate-pulse rounded-sm bg-neutral-100" />
        <div className="h-4 w-5/6 animate-pulse rounded-sm bg-neutral-100" />
        <div className="h-4 w-2/3 animate-pulse rounded-sm bg-neutral-100" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
