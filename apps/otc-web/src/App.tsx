import { useEffect, type ComponentType } from 'react';

import { AcceptQuotePage } from './pages/AcceptQuotePage.js';
import { AdminTradesPage } from './pages/AdminTradesPage.js';
import { AppShell, type AppSection } from './components/AppShell.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { FaqPage } from './pages/FaqPage.js';
import { LandingPage } from './pages/LandingPage.js';
import { MarketPage } from './pages/MarketPage.js';
import { ProfilePage } from './pages/ProfilePage.js';
import { PublicProofPage } from './pages/PublicProofPage.js';
import { RfqPage } from './pages/RfqPage.js';
import { getBrowserPathname } from './routing.js';
import { TradeCheckoutPage } from './pages/TradeCheckoutPage.js';
import { captureReferralFromUrl } from './user-session.js';

export function App() {
  useEffect(() => {
    captureReferralFromUrl();
  }, []);
  const route = resolveRoute(getBrowserPathname());

  return (
    <AppShell active={route.active}>
      <ErrorBoundary>
        <route.Page />
      </ErrorBoundary>
    </AppShell>
  );
}

function resolveRoute(pathname: string): { active: AppSection; Page: ComponentType } {
  if (pathname === '/' || pathname === '') {
    return { active: 'home', Page: LandingPage };
  }
  if (pathname.startsWith('/faq')) {
    return { active: 'faq', Page: FaqPage };
  }
  if (pathname.startsWith('/admin')) {
    return { active: 'admin', Page: AdminTradesPage };
  }
  if (pathname.startsWith('/market') || pathname.startsWith('/orders')) {
    return { active: 'market', Page: MarketPage };
  }
  if (pathname.startsWith('/profile') || pathname.startsWith('/account')) {
    return { active: 'profile', Page: ProfilePage };
  }
  if (pathname.includes('/proof')) {
    return { active: 'proof', Page: PublicProofPage };
  }
  if (pathname.includes('/accept')) {
    return { active: 'accept', Page: AcceptQuotePage };
  }
  if (pathname.startsWith('/trades')) {
    return { active: 'trade', Page: TradeCheckoutPage };
  }
  return { active: 'quote', Page: RfqPage };
}
