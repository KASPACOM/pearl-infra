import type { ComponentType } from 'react';

import { AcceptQuotePage } from './pages/AcceptQuotePage.js';
import { AdminTradesPage } from './pages/AdminTradesPage.js';
import { AppShell, type AppSection } from './components/AppShell.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { PublicProofPage } from './pages/PublicProofPage.js';
import { RfqPage } from './pages/RfqPage.js';
import { getBrowserPathname } from './routing.js';
import { TradeCheckoutPage } from './pages/TradeCheckoutPage.js';

export function App() {
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
  if (pathname.startsWith('/admin')) {
    return { active: 'admin', Page: AdminTradesPage };
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
  return { active: 'rfq', Page: RfqPage };
}
