// Shown while a family page loads (cosmetic review, 15 Nov 2026).
export default function Loading() {
  return (
    <section className="container-site py-12" role="status" aria-live="polite">
      <div className="h-8 w-56 animate-pulse rounded-sm bg-neutral-200" />
      <div className="mt-6 space-y-3">
        <div className="h-4 w-full animate-pulse rounded-sm bg-neutral-100" />
        <div className="h-4 w-5/6 animate-pulse rounded-sm bg-neutral-100" />
        <div className="h-4 w-2/3 animate-pulse rounded-sm bg-neutral-100" />
      </div>
      <span className="sr-only">Loading…</span>
    </section>
  );
}
