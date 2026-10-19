import './globals.css';
import PreviewBanner from '@/components/PreviewBanner';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import IdleTimeout from '@/components/IdleTimeout';
import SiteAnalytics from '@/components/SiteAnalytics';

export const metadata = {
  title: {
    default: 'Luke 14 Ministries (Preview Build)',
    template: '%s — Luke 14 Ministries (Preview Build)',
  },
  description:
    'Luke 14 Ministries helps families and individuals affected by disability find community and connection to Jesus through His church.',
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {/* print:hidden — when any page is printed (rosters, kitchen list,
            statements), the site chrome stays off the paper. */}
        <div className="print:hidden">
          <PreviewBanner />
          <Header />
        </div>
        <main>{children}</main>
        <div className="print:hidden">
          <Footer />
        </div>
        {/* Idle auto-logout. Renders nothing unless someone is signed in and has
            gone quiet long enough to warrant the warning. */}
        <IdleTimeout />
        {/* Vercel Web Analytics (anonymous, cookie-free pageview counting -- no
            consent banner needed) and Speed Insights, public pages only. */}
        <SiteAnalytics />
      </body>
    </html>
  );
}
