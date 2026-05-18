const FAQ_GROUPS = [
  {
    title: 'Using Oysters Market',
    items: [
      {
        question: 'What is Oysters Market?',
        answer:
          'Oysters Market is a PRL trading app for quote-based trades. It gives both sides a clear quote, funding instructions, deadlines, and a public proof page instead of hiding settlement state behind private messages.',
      },
      {
        question: 'Why use a quote flow instead of a normal order book?',
        answer:
          'Large or negotiated PRL trades need confirmed terms before either side funds. The quote flow locks the side, size, price, fees, expiry, Pearl escrow terms, and Base USDC terms into one trade record.',
      },
      {
        question: 'What happens after I accept a quote?',
        answer:
          'The app creates a trade, shows the Pearl funding address, checks the Base escrow terms, tracks deadlines, and keeps the checkout screen read-only for settlement actions that operators should not expose in the browser.',
      },
    ],
  },
  {
    title: 'Pearl and Base settlement',
    items: [
      {
        question: 'What is Pearl?',
        answer:
          'Pearl is the blockchain where PRL lives. The app watches Pearl escrow funding, confirmations, and spends so the trade can show whether PRL arrived on time, arrived late, was underpaid, was overpaid, or needs manual review.',
      },
      {
        question: 'Why is USDC on Base?',
        answer:
          'Base provides a widely supported USDC settlement rail. Oysters Market verifies the Base escrow contract terms before allowing the buyer deposit flow to proceed.',
      },
      {
        question: 'What does the proof page show?',
        answer:
          'The proof page shows quote terms, deadlines, Pearl escrow facts, Base escrow facts, confirmations, observed events, and the current trade state. It is designed to be shared with support without exposing operator controls.',
      },
    ],
  },
  {
    title: 'Safety and support',
    items: [
      {
        question: 'What if funding is late or mismatched?',
        answer:
          'Late funding, amount mismatches, reorgs, stale indexer data, and unknown spends move the trade into review states. The frontend shows those states and support paths instead of offering unsafe completion actions.',
      },
      {
        question: 'Can users trigger release or refund from the app?',
        answer:
          'No. The user and admin screens do not expose release, refund, signing, broadcast, or trade-term edit controls. Settlement execution remains behind backend policy and operator review.',
      },
      {
        question: 'How do I ask for help?',
        answer:
          'Use the proof or checkout support path with your trade id. Operators can review blockers, side effects, deadlines, and alert delivery status from the admin screen.',
      },
    ],
  },
] as const;

export function FaqPage() {
  return (
    <section className="faq-page">
      <div className="om-page-title">
        <span>FAQ</span>
        <h1>Learn Oysters Market before you trade.</h1>
        <p>How the quote flow, Pearl escrow tracking, Base USDC leg, proof page, and support process fit together.</p>
      </div>

      <div className="faq-grid">
        {FAQ_GROUPS.map((group) => (
          <section key={group.title} className="om-panel faq-group">
            <h2>{group.title}</h2>
            {group.items.map((item) => (
              <article key={item.question} className="faq-item">
                <h3>{item.question}</h3>
                <p>{item.answer}</p>
              </article>
            ))}
          </section>
        ))}
      </div>
    </section>
  );
}
