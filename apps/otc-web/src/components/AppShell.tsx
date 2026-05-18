import type { ReactNode } from 'react';

export type AppSection = 'rfq' | 'accept' | 'trade' | 'proof' | 'admin';

const NAV_ITEMS: Array<{ section: AppSection; label: string; href: string }> = [
  { section: 'rfq', label: 'RFQ', href: '/quote' },
  { section: 'accept', label: 'Accept', href: '/quote/demo/accept' },
  { section: 'trade', label: 'Checkout', href: '/trades/demo' },
  { section: 'proof', label: 'Proof', href: '/trades/demo/proof' },
  { section: 'admin', label: 'Admin', href: '/admin/trades' },
];

export function AppShell({
  active,
  children,
  environment = 'testnet',
}: {
  active: AppSection;
  children: ReactNode;
  environment?: string;
}) {
  return (
    <div className="om-shell">
      <header className="om-topbar">
        <a className="om-brand" href="/quote" aria-label="Oysters Market home">
          <span className="om-brand__mark">O</span>
          <span>
            <strong>Oysters Market</strong>
            <small>PRL / USDC settlement</small>
          </span>
        </a>
        <span className="om-env">{environment}</span>
        <nav className="om-nav" aria-label="Oysters Market">
          {NAV_ITEMS.map((item) => (
            <a key={item.section} className={item.section === active ? 'is-active' : ''} href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="om-operator">desk@kaspa.com</div>
      </header>
      <main className="om-main">{children}</main>
    </div>
  );
}
