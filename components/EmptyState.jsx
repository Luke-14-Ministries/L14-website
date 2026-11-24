// What a page or a section says when it has nothing to show (23 Nov 2026,
// the admin review: "Nothing here", "No rows", grey boxes and bare words, one
// per file).
//   plain    the list is empty because there is nothing to do: grey words
//   missing  something expected is not there (no events set up, a setting
//            not made): a dashed box, so it does not read as "all done"
// The words are the page's own; this only gives them one look.

export default function EmptyState({ kind = 'plain', className = '', children }) {
  if (kind === 'missing') {
    return (
      <div className={`rounded-lg border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-600 ${className}`}>
        {children}
      </div>
    );
  }
  return <p className={`py-2 text-sm text-neutral-500 ${className}`}>{children}</p>;
}
