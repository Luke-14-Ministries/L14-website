export default function PreviewBanner() {
  return (
    <div className="bg-red-700 text-white text-center text-sm sm:text-base font-semibold px-4 py-2 sticky top-0 z-50">
      ⚠️ PREVIEW / TEST BUILD. This is NOT the official Luke 14 Ministries
      website. For the official site, visit{' '}
      <a href="https://luke14ministries.net" className="underline">
        luke14ministries.net
      </a>
      . Forms and payments here are for demonstration only.
    </div>
  );
}
