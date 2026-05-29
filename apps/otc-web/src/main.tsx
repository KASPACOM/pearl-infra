import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { indexedDbPearlWalletStorage } from './wallet/indexeddb-storage.js';
import { PearlWalletSession, setPearlWalletSession } from './wallet/wallet-session.js';

// Initialize the Pearl wallet session before App mounts. Components reach for
// it via getPearlWalletSession() — they assume it's already wired here.
setPearlWalletSession(new PearlWalletSession(indexedDbPearlWalletStorage));
import './styles.scss';
import './components/AppShell.scss';
import './components/Primitives.scss';
import './pages/AcceptQuotePage.scss';
import './pages/AdminTradesPage.scss';
import './pages/FaqPage.scss';
import './pages/LandingPage.scss';
import './pages/MarketPage.scss';
import './pages/ProfilePage.scss';
import './pages/PublicProofPage.scss';
import './pages/RfqPage.scss';
import './pages/TradeCheckoutPage.scss';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing root element');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
