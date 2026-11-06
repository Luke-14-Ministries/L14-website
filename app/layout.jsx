import './globals.css';
// After globals.css; inert unless a signed-in person chose Dark (ThemeSwitch).
import './theme-dark.css';
import PreviewBanner from '@/components/PreviewBanner';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import IdleTimeout from '@/components/IdleTimeout';
import SiteAnalytics from '@/components/SiteAnalytics';
import { THEME_SCRIPT } from '@/lib/theme';

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
    // suppressHydrationWarning: THEME_SCRIPT may set data-theme on <html>
    // before React arrives, which is the point, not a mismatch to report.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Dark mode's remembered choice, applied before the first paint so a
            dark page never flashes white (lib/theme.js). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
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
