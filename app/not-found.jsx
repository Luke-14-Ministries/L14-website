// A page that doesn't exist (cosmetic review, 15 Nov 2026): the site's own
// look instead of Next's bare 404.
import Link from 'next/link';

export const metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <section className="container-site py-16 max-w-2xl">
      <h1 className="text-3xl font-bold">We couldn&rsquo;t find that page</h1>
      <p className="mt-3 text-neutral-700">
        The link may be old, or the page may have moved. Try the home page, or email{' '}
        <a href="mailto:info@luke14ministries.net" className="text-brand underline">
          info@luke14ministries.net
        </a>{' '}
        and we&rsquo;ll help.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/" className="btn-primary">
          Home
        </Link>
        <Link href="/account/" className="btn-outline">
          My Account
        </Link>
      </div>
    </section>
  );
}
