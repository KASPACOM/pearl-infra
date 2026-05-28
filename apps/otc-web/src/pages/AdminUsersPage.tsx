import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';

import { createOtcClient, getInitialAdminToken, persistAdminToken } from '../api.js';
import { OtcApiError, type AdminUserSummary, type OtcUserWalletType } from '../otc-api-client.js';
import './AdminTradesPage.scss';
import './AdminUsersPage.scss';

const ADMIN_USER_LIMIT_OPTIONS = [10, 25, 50, 100] as const;

export function AdminUsersPage() {
  const [adminToken, setAdminToken] = useState(getInitialAdminToken);
  const [tokenInput, setTokenInput] = useState(adminToken);
  const [search, setSearch] = useState('');
  const [walletType, setWalletType] = useState<'all' | OtcUserWalletType>('all');
  const [referrerUserId, setReferrerUserId] = useState('');
  const [cursor, setCursor] = useState<string>();
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>([]);
  const [limit, setLimit] = useState(25);
  const [nextCursor, setNextCursor] = useState<string>();
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<AdminUserSummary[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>();
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string>();
  const selectedUser = useMemo(() => rows.find((row) => row.userId === selectedUserId) ?? rows[0], [rows, selectedUserId]);

  useEffect(() => {
    if (!adminToken) {
      setRows([]);
      setTotal(0);
      setNextCursor(undefined);
      setStatus('idle');
      return undefined;
    }
    let active = true;
    setStatus('loading');
    setError(undefined);
    void createOtcClient()
      .listAdminUsers(
        {
          search,
          walletType: walletType === 'all' ? undefined : walletType,
          referrerUserId,
          cursor,
          limit,
        },
        adminToken,
      )
      .then((page) => {
        if (!active) return;
        setRows(page.items);
        setTotal(page.total);
        setNextCursor(page.nextCursor);
        setSelectedUserId((current) => (current && page.items.some((row) => row.userId === current) ? current : page.items[0]?.userId));
        setStatus('ready');
      })
      .catch((loadError) => {
        if (!active) return;
        setRows([]);
        setTotal(0);
        setNextCursor(undefined);
        setStatus('error');
        setError(formatApiError(loadError));
      });
    return () => {
      active = false;
    };
  }, [adminToken, cursor, limit, referrerUserId, search, walletType]);

  const resetPagination = useCallback(() => {
    setCursor(undefined);
    setCursorHistory([]);
  }, []);

  const onTokenSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const trimmed = tokenInput.trim();
      persistAdminToken(trimmed);
      setAdminToken(trimmed);
      resetPagination();
    },
    [resetPagination, tokenInput],
  );

  const onSearchChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setSearch(event.target.value);
      resetPagination();
    },
    [resetPagination],
  );

  const onWalletTypeChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      setWalletType(event.target.value as 'all' | OtcUserWalletType);
      resetPagination();
    },
    [resetPagination],
  );

  const onReferrerChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setReferrerUserId(event.target.value);
      resetPagination();
    },
    [resetPagination],
  );

  const onLimitChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      setLimit(Number(event.target.value));
      resetPagination();
    },
    [resetPagination],
  );

  const nextPage = useCallback(() => {
    if (!nextCursor) return;
    setCursorHistory((current) => [...current, cursor]);
    setCursor(nextCursor);
  }, [cursor, nextCursor]);

  const previousPage = useCallback(() => {
    if (cursorHistory.length === 0) return;
    setCursor(cursorHistory[cursorHistory.length - 1]);
    setCursorHistory((current) => current.slice(0, -1));
  }, [cursorHistory]);

  const metrics = useMemo(() => buildUserMetrics(rows), [rows]);

  return (
    <section className="admin-page admin-users-page">
      <div className="om-page-title">
        <span>Admin</span>
        <h1>Wallet Users</h1>
      </div>

      <nav className="admin-tabs" aria-label="Admin sections">
        <a href="/admin/trades">Trades</a>
        <a className="is-active" href="/admin/users">Users</a>
      </nav>

      <form className="om-panel admin-auth" onSubmit={onTokenSubmit}>
        <label>
          <span>Admin token</span>
          <input autoComplete="off" onChange={(event) => setTokenInput(event.target.value)} type="password" value={tokenInput} />
        </label>
        <button className="om-button" type="submit">Apply</button>
      </form>

      {error ? <div className="om-error">{error}</div> : null}

      <div className="admin-metrics">
        <Metric label="Visible users" value={rows.length} />
        <Metric label="Linked wallets" value={metrics.wallets} />
        <Metric label="With email" value={metrics.emailUsers} />
        <Metric label="Points" value={metrics.points} />
      </div>

      <div className="admin-page__grid">
        <section className="om-panel admin-list admin-users-list">
          <div className="admin-list__toolbar admin-users-toolbar">
            <input onChange={onSearchChange} placeholder="Search user, email, referral, wallet" value={search} />
            <select onChange={onWalletTypeChange} value={walletType}>
              <option value="all">All wallets</option>
              <option value="evm">EVM wallets</option>
              <option value="pearl">Pearl wallets</option>
            </select>
            <input onChange={onReferrerChange} placeholder="Referrer user ID" value={referrerUserId} />
            <select onChange={onLimitChange} value={limit}>
              {ADMIN_USER_LIMIT_OPTIONS.map((option) => (
                <option key={option} value={option}>{option} rows</option>
              ))}
            </select>
          </div>

          <div className="admin-pagination">
            <span>{status === 'loading' ? 'Loading users...' : `${total} matching users`}</span>
            <button className="om-button om-button--ghost" disabled={cursorHistory.length === 0} onClick={previousPage} type="button">Prev</button>
            <button className="om-button om-button--ghost" disabled={!nextCursor} onClick={nextPage} type="button">Next</button>
          </div>

          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Wallets</th>
                <th>Email</th>
                <th>Activity</th>
                <th>Referral</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((user) => (
                <tr
                  className={user.userId === selectedUser?.userId ? 'is-selected' : undefined}
                  key={user.userId}
                  onClick={() => setSelectedUserId(user.userId)}
                >
                  <td>
                    {shortId(user.userId)}
                    <small>{user.referralCode}</small>
                  </td>
                  <td>
                    {user.walletCount}
                    <small>{user.wallets.map((wallet) => wallet.walletType).join(', ')}</small>
                  </td>
                  <td>
                    {user.email ?? 'none'}
                    <small>{user.emailVerified ? 'verified' : user.email ? 'unverified' : 'not set'}</small>
                  </td>
                  <td>
                    {user.tradeCount} trades
                    <small>{user.orderCount} orders / {user.pointTotal} pts</small>
                  </td>
                  <td>
                    {user.referredBy?.referralCode ?? 'direct'}
                    <small>{user.referredBy ? shortId(user.referredBy.referrerUserId) : 'no referrer'}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <aside className="om-panel admin-detail admin-user-detail">
          {selectedUser ? (
            <>
              <header>
                <p>User</p>
                <h2>{shortId(selectedUser.userId)}</h2>
                <small>{selectedUser.userId}</small>
              </header>
              <div className="admin-detail__section">
                <h3>Profile</h3>
                <DataLine label="Referral code" value={selectedUser.referralCode} />
                <DataLine label="Email" value={selectedUser.email ?? 'not set'} />
                <DataLine label="Email verified" value={selectedUser.emailVerified ? 'yes' : 'no'} />
                <DataLine label="Email alerts" value={selectedUser.notificationEmailEnabled ? 'enabled' : 'disabled'} />
                <DataLine label="Created" value={selectedUser.createdAt} />
              </div>
              <div className="admin-detail__section">
                <h3>Wallets</h3>
                <div className="admin-user-wallets">
                  {selectedUser.wallets.map((wallet) => (
                    <div key={`${wallet.walletType}:${wallet.network}:${wallet.address}`}>
                      <strong>{wallet.walletType} / {wallet.network}</strong>
                      <span>{wallet.address}</span>
                      {wallet.publicKeyHex ? <small>{wallet.publicKeyHex}</small> : null}
                    </div>
                  ))}
                </div>
              </div>
              <div className="admin-detail__section">
                <h3>Activity</h3>
                <DataLine label="Trades" value={String(selectedUser.tradeCount)} />
                <DataLine label="Orders" value={String(selectedUser.orderCount)} />
                <DataLine label="Points" value={String(selectedUser.pointTotal)} />
                <DataLine label="Updated" value={selectedUser.updatedAt} />
              </div>
              <div className="admin-detail__section">
                <h3>Referral</h3>
                <DataLine label="Referred by" value={selectedUser.referredBy?.referrerUserId ?? 'direct'} />
                <DataLine label="Source" value={selectedUser.referredBy?.sourceUrl ?? 'none'} />
              </div>
            </>
          ) : (
            <p className="admin-empty">No user selected.</p>
          )}
        </aside>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="admin-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DataLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="admin-user-data-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function buildUserMetrics(users: AdminUserSummary[]): { wallets: number; emailUsers: number; points: number } {
  return users.reduce(
    (total, user) => ({
      wallets: total.wallets + user.walletCount,
      emailUsers: total.emailUsers + (user.email ? 1 : 0),
      points: total.points + user.pointTotal,
    }),
    { wallets: 0, emailUsers: 0, points: 0 },
  );
}

function shortId(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function formatApiError(error: unknown): string {
  if (error instanceof OtcApiError) {
    return error.message;
  }
  return error instanceof Error ? error.message : 'Admin users failed to load.';
}
