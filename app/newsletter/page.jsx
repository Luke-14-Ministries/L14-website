import Link from 'next/link';
import PageHero from '@/components/PageHero';
import { asset } from '@/lib/site';
import { createClient, getCurrentUser } from '@/lib/supabase/server';

export const metadata = { title: 'Newsletter' };

const linkCls = 'text-brand font-semibold underline';

// A signed-in visitor already has a news switch: "Also send me ministry news
// & updates" on Manage Household, beside the household's contact email the
// news goes to (CLAUDE.md, 23 Nov 2026). Sending them to the Google Form put
// them on a second list staff never see beside the first (review A4-18,
// 23 Nov 2026). So this page says which way their switch is set, and keeps
// the Google Form for visitors without an account. Replacing the form with a
// sign-up on the site, like the prayer list's, is still Lawrence's call.
async function myNews(user) {
  const supabase = await createClient();
  const [{ data: profile, error: profileError }, { data: membership, error: householdError }] = await Promise.all([
    supabase.from('profiles').select('email_news').eq('id', user.id).maybeSingle(),
    // The visitor's own household, by membership (never RLS alone).
    supabase.from('household_members').select('households ( email )').eq('profile_id', user.id).limit(1).maybeSingle(),
  ]);
  // CLAUDE.md: never swallow a query error; a wrong "you're not on the list"
  // is worse than an error page.
  if (profileError) throw new Error(`Your news setting: ${profileError.message}`);
  if (householdError) throw new Error(`Your household: ${householdError.message}`);
  return {
    // Unset reads as on, as Manage Household reads it.
    on: profile?.email_news !== false,
    // Where the news goes: the household's contact email, or the sign-in one
    // when it has none (the same fallback as the staff list, 0172).
    email: membership?.households?.email?.trim() || user.email,
  };
}

function SignedInNews({ news }) {
  if (news.on) {
    return (
      <div className="prose-site mt-8">
        <p>
          You get our news at <strong>{news.email}</strong>. You can change this on{' '}
          <Link href="/account/household/#news" className={linkCls}>
            Manage Household
          </Link>
          .
        </p>
      </div>
    );
  }
  return (
    <>
      <div className="prose-site mt-8">
        <p>You don&rsquo;t get our news yet. Switch it on and we&rsquo;ll send it to {news.email}.</p>
      </div>
      <Link href="/account/household/#news" className="btn-primary mt-6 inline-block text-lg">
        Turn on news &amp; updates
      </Link>
    </>
  );
}

export default async function NewsletterPage() {
  const user = await getCurrentUser();
  const news = user ? await myNews(user) : null;
  return (
    <>
      <PageHero
        image={asset('/images/Nigeria_December_2019_0078.jpg')}
        title="Newsletter"
      />

      <section className="container-site py-14 max-w-3xl mx-auto text-center">
        <div className="prose-site">
          <p>
            The Luke 14 Newsletter is published three times yearly to keep our
            friends and supporters aware of what is going on in our ministry.
            {news ? null : ' If you would like to receive our newsletter, please fill out the form below!'}
          </p>
        </div>
        {news ? (
          <SignedInNews news={news} />
        ) : (
          <a
            href="https://docs.google.com/forms/d/e/1FAIpQLSdzDoq7UTlTD0VmZhiLtF46Vs0eIRtyYS6QlSLHgvNT34KeWw/viewform"
            target="_blank"
            rel="noopener"
            className="btn-primary mt-10 inline-block text-lg"
          >
            Sign Up for the Newsletter
          </a>
        )}
      </section>
    </>
  );
}
