import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import './styles.scss';
import './components/AppShell.scss';
import './components/Primitives.scss';
import './pages/AcceptQuotePage.scss';
import './pages/AdminTradesPage.scss';
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
