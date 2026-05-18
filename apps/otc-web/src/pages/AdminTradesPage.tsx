import { demoTrade } from '../demo-data.js';
import { buildFailureBanner, buildStateBadge } from '../page-models.js';
import { DataRow, FailureBanner, StateBadge } from '../components/Primitives.js';

const ADMIN_ROWS = [
  demoTrade,
  { ...demoTrade, tradeId: 'trade_manual_1', state: 'unknown_spend' as const },
  { ...demoTrade, tradeId: 'trade_reorg_1', state: 'reorged' as const },
  { ...demoTrade, tradeId: 'trade_released_1', state: 'released' as const },
];

export function AdminTradesPage() {
  const selected = ADMIN_ROWS[1];
  const banner = buildFailureBanner(selected.state, selected.tradeId);

  return (
    <section className="admin-page">
      <div className="om-page-title">
        <span>Admin</span>
        <h1>Trade operations</h1>
        <p>Operators can inspect and annotate state. Release and refund controls are intentionally absent from the UI.</p>
      </div>

      <div className="admin-page__grid">
        <section className="om-panel admin-list">
          <div className="admin-list__toolbar">
            <input placeholder="Search trade id" aria-label="Search trade id" />
            <button className="om-button">Manual review only</button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Trade</th>
                <th>State</th>
                <th>PRL</th>
                <th>USDC</th>
              </tr>
            </thead>
            <tbody>
              {ADMIN_ROWS.map((trade) => (
                <tr key={trade.tradeId}>
                  <td>
                    <a href={`/admin/trades/${trade.tradeId}`}>{trade.tradeId}</a>
                  </td>
                  <td>
                    <StateBadge badge={buildStateBadge(trade.state)} />
                  </td>
                  <td>{trade.amountPrl}</td>
                  <td>{trade.amountUsdc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <aside className="om-panel admin-detail">
          <span className="om-kicker">Selected trade</span>
          <h2>{selected.tradeId}</h2>
          <FailureBanner banner={banner} />
          <DataRow label="State" value={selected.state} />
          <DataRow label="Pearl escrow" value={selected.pearlEscrow.address} />
          <DataRow label="Base contract" value={selected.usdcEscrow.contract} />
          <div className="admin-detail__actions">
            <button className="om-button">Add note</button>
            <button className="om-button">Export evidence</button>
          </div>
          <p>No release or refund actions are available to operators.</p>
        </aside>
      </div>
    </section>
  );
}
