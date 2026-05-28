const PROCESS_STEPS = [
  {
    label: 'Price',
    title: 'Create a quote',
    copy: 'Choose buy or sell, enter the PRL size, and get Base USDC terms before any wallet action starts.',
  },
  {
    label: 'Lock',
    title: 'Fund both legs',
    copy: 'PRL moves to a Pearl escrow address while USDC terms are matched against the Base escrow contract.',
  },
  {
    label: 'Prove',
    title: 'Track the trade',
    copy: 'The proof page shows deadlines, confirmations, chain events, and any manual-review state in one place.',
  },
] as const;

const PEARL_FACTS = [
  'Pearl is a high-throughput blockchain designed around fast finality and predictable transfer flows.',
  'PRL is the native asset used on Pearl, and Oysters Market focuses on PRL liquidity against Base USDC.',
  'The app watches Pearl funding, Base escrow events, deadlines, and edge cases before any completion state is shown.',
] as const;

export function LandingPage() {
  return (
    <section className="landing-page">
      <section className="landing-hero">
        <div className="landing-hero__scene" aria-hidden="true">
          <figure className="landing-preview">
            <img src="/brand/oysters-market-quote.webp" alt="" decoding="async" />
          </figure>
          <div className="landing-chain">
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="landing-orbit">
            <div className="landing-orbit__core">PRL</div>
            <span className="landing-orbit__node is-a">USDC</span>
            <span className="landing-orbit__node is-b">Base</span>
            <span className="landing-orbit__node is-c">Proof</span>
          </div>
        </div>
        <div className="landing-hero__content">
          <span className="om-kicker">Oysters Market</span>
          <h1>Private PRL trading with proof-first settlement.</h1>
          <p>
            Oysters Market gives buyers and sellers a clear quote flow, locked Base USDC terms, Pearl escrow tracking, and
            public proof pages built for support and auditability.
          </p>
          <div className="landing-hero__actions">
            <a className="om-button om-button--primary" href="/quote">
              Get a quote
            </a>
            <a className="om-button" href="/faq">
              Learn how it works
            </a>
          </div>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-section__title">
          <span className="om-kicker">How it works</span>
          <h2>Quote, fund, verify, then follow the proof.</h2>
        </div>
        <div className="landing-steps">
          {PROCESS_STEPS.map((step) => (
            <article key={step.label} className="landing-step">
              <span>{step.label}</span>
              <h3>{step.title}</h3>
              <p>{step.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section landing-section--split">
        <div>
          <span className="om-kicker">Pearl blockchain</span>
          <h2>Built around PRL escrow visibility.</h2>
          <p>
            Pearl is the PRL chain. Oysters Market treats the Pearl leg as first-class settlement state: funding outpoints,
            confirmations, spends, reorgs, and manual-review blockers are all surfaced before the trade is considered safe.
          </p>
        </div>
        <ul className="landing-facts">
          {PEARL_FACTS.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      </section>
    </section>
  );
}
