import type { ReactNode } from 'react';

export type AppSection = 'home' | 'quote' | 'accept' | 'trade' | 'proof' | 'faq' | 'admin';

const NAV_ITEMS: Array<{ section: AppSection; label: string; href: string }> = [
  { section: 'home', label: 'Home', href: '/' },
  { section: 'quote', label: 'Quote', href: '/quote' },
  { section: 'accept', label: 'Accept', href: '/quote/demo/accept' },
  { section: 'trade', label: 'Checkout', href: '/trades/demo' },
  { section: 'proof', label: 'Proof', href: '/trades/demo/proof' },
  { section: 'faq', label: 'FAQ', href: '/faq' },
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
  const shellClassName = active === 'admin' ? 'om-shell om-shell--admin' : 'om-shell';
  return (
    <div className={shellClassName}>
      <header className="om-topbar">
        <a className="om-brand" href="/" aria-label="Oysters Market home">
          <span className="om-brand__mark" aria-hidden="true" />
          <span>
            <strong>Oysters Market</strong>
            <small>Private market access</small>
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
        <div className="om-operator">PRL Settlement Desk</div>
      </header>
      <main className="om-main">{children}</main>
    </div>
  );
}
