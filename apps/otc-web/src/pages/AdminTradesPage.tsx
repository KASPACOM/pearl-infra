import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';

import {
  ADMIN_DELIVERY_STATUS_FILTERS,
  ADMIN_SEVERITY_FILTERS,
  ADMIN_STATE_FILTERS,
  DEFAULT_ADMIN_LIST_LIMIT,
  buildAdminTradeRow,
  buildAlertDeliveries,
  type AdminDeliveryStatusFilter,
  type AdminSeverityFilter,
  type AdminStateFilter,
  type AlertDeliveryModel,
} from '../admin-models.js';
import { createClientRequestId, createOtcClient, getInitialAdminToken, persistAdminToken } from '../api.js';
import { prepareEscrowCreateTradeCall, toTransactionRequest } from '../base-escrow-client.js';
import {
  connectInjectedEvmWallet,
  hasInjectedEvmWallet,
  readInjectedEvmWallet,
  sendAndWaitInjectedEvmTransaction,
  subscribeInjectedEvmWalletChanges,
  switchInjectedEvmChain,
  type EvmWalletSnapshot,
} from '../evm-wallet.js';
import {
  OtcApiError,
  type AdminTradeDebugDetail,
  type AdminTradeSummary,
  type OtcSideEffect,
  type SupportAlertSeverity,
  type UsdcEscrowVerification,
} from '../otc-api-client.js';
import { BrandLoader, DataRow, StateBadge } from '../components/Primitives.js';
import { buildStateBadge } from '../page-models.js';
import { getAdminTradeIdFromPath, getBrowserPathname } from '../routing.js';

type NoteMode = 'support_alert' | 'manual_review';
type BaseOperatorActionStatus = 'idle' | 'connecting' | 'switching' | 'preparing' | 'creating' | 'recording' | 'confirmed' | 'error';

const ADMIN_LIMIT_OPTIONS = [10, 25, 50, 100] as const;

export function AdminTradesPage() {
  const [adminToken, setAdminToken] = useState(getInitialAdminToken);
  const [tokenInput, setTokenInput] = useState(adminToken);
  const [stateFilter, setStateFilter] = useState<AdminStateFilter>('all');
  const [manualReviewOnly, setManualReviewOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<AdminSeverityFilter>('all');
  const [failedSideEffectOnly, setFailedSideEffectOnly] = useState(false);
  const [deadlineBreachedOnly, setDeadlineBreachedOnly] = useState(false);
  const [blocker, setBlocker] = useState('');
  const [minUpdatedAgeMs, setMinUpdatedAgeMs] = useState('');
  const [alertDeliveryStatus, setAlertDeliveryStatus] = useState<AdminDeliveryStatusFilter>('all');
  const [cursor, setCursor] = useState<string>();
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>([]);
  const [limit, setLimit] = useState(DEFAULT_ADMIN_LIST_LIMIT);
  const [nextCursor, setNextCursor] = useState<string>();
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<AdminTradeSummary[]>([]);
  const [selectedTradeId, setSelectedTradeId] = useState(() => getAdminTradeIdFromPath(getBrowserPathname()));
  const [detail, setDetail] = useState<AdminTradeDebugDetail>();
  const [listStatus, setListStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [detailStatus, setDetailStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [refreshTick, setRefreshTick] = useState(0);
  const [error, setError] = useState<string>();
  const [actionStatus, setActionStatus] = useState<string>();
  const [noteMode, setNoteMode] = useState<NoteMode>('support_alert');
  const [noteSeverity, setNoteSeverity] = useState<SupportAlertSeverity>('warning');
  const [noteMessage, setNoteMessage] = useState('');
  const [noteContact, setNoteContact] = useState('');
  const [publicSeverity, setPublicSeverity] = useState<SupportAlertSeverity>('warning');
  const [publicMessage, setPublicMessage] = useState('');
  const [publicContact, setPublicContact] = useState('');
  const [operatorWallet, setOperatorWallet] = useState<EvmWalletSnapshot>({ connected: false });
  const [baseActionStatus, setBaseActionStatus] = useState<BaseOperatorActionStatus>('idle');
  const [baseActionError, setBaseActionError] = useState<string>();
  const [baseCreateTxHash, setBaseCreateTxHash] = useState<string>();

  const rowModels = useMemo(() => rows.map(buildAdminTradeRow), [rows]);
  const deliveryRows = useMemo(() => buildAlertDeliveries(detail), [detail]);
  const metrics = useMemo(() => buildAdminMetrics(rows), [rows]);

  useEffect(() => {
    let active = true;
    const refreshWallet = () => {
      void readInjectedEvmWallet()
        .then((snapshot) => {
          if (active) {
            setOperatorWallet(snapshot);
          }
        })
        .catch(() => {
          if (active) {
            setOperatorWallet({ connected: false });
          }
        });
    };
    refreshWallet();
    const unsubscribe = subscribeInjectedEvmWalletChanges(refreshWallet);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!adminToken) {
      setRows([]);
      setTotal(0);
      setNextCursor(undefined);
      setListStatus('idle');
      return undefined;
    }
    let active = true;
    setListStatus('loading');
    setError(undefined);
    void createOtcClient()
      .listAdminTrades(
        {
          state: stateFilter === 'all' ? undefined : stateFilter,
          manualReviewOnly,
          search,
          severity: severityFilter === 'all' ? undefined : severityFilter,
          failedSideEffectOnly,
          deadlineBreachedOnly,
          blocker,
          minUpdatedAgeMs: parseOptionalNumber(minUpdatedAgeMs),
          alertDeliveryStatus: alertDeliveryStatus === 'all' ? undefined : alertDeliveryStatus,
          cursor,
          limit,
        },
        adminToken,
      )
      .then((page) => {
        if (!active) {
          return;
        }
        setRows(page.items);
        setTotal(page.total);
        setNextCursor(page.nextCursor);
        setSelectedTradeId((current) => (current && page.items.some((row) => row.tradeId === current) ? current : page.items[0]?.tradeId));
        setListStatus('ready');
      })
      .catch((loadError) => {
        if (!active) {
          return;
        }
        setRows([]);
        setTotal(0);
        setNextCursor(undefined);
        setListStatus('error');
        setError(formatApiError(loadError, 'Admin trade list failed to load.'));
      });
    return () => {
      active = false;
    };
  }, [
    adminToken,
    alertDeliveryStatus,
    blocker,
    cursor,
    deadlineBreachedOnly,
    failedSideEffectOnly,
    limit,
    manualReviewOnly,
    minUpdatedAgeMs,
    refreshTick,
    search,
    severityFilter,
    stateFilter,
  ]);

  useEffect(() => {
    if (!adminToken || !selectedTradeId) {
      setDetail(undefined);
      setDetailStatus('idle');
      return undefined;
    }
    let active = true;
    setDetailStatus('loading');
    setDetail(undefined);
    setError(undefined);
    void createOtcClient()
      .getAdminTradeDebug(selectedTradeId, adminToken)
      .then((adminDetail) => {
        if (active) {
          setDetail(adminDetail);
          setDetailStatus('ready');
        }
      })
      .catch((loadError) => {
        if (active) {
          setDetail(undefined);
          setDetailStatus('error');
          setError(formatApiError(loadError, 'Admin trade detail failed to load.'));
        }
      });
    return () => {
      active = false;
    };
  }, [adminToken, refreshTick, selectedTradeId]);

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
  const onTokenChange = useCallback((event: ChangeEvent<HTMLInputElement>) => setTokenInput(event.target.value), []);
  const onStateChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      setStateFilter(event.target.value as AdminStateFilter);
      resetPagination();
    },
    [resetPagination],
  );
  const onSearchChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setSearch(event.target.value);
      resetPagination();
    },
    [resetPagination],
  );
  const onSeverityChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      setSeverityFilter(event.target.value as AdminSeverityFilter);
      resetPagination();
    },
    [resetPagination],
  );
  const onDeliveryStatusChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      setAlertDeliveryStatus(event.target.value as AdminDeliveryStatusFilter);
      resetPagination();
    },
    [resetPagination],
  );
  const onBlockerChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setBlocker(event.target.value);
      resetPagination();
    },
    [resetPagination],
  );
  const onMinAgeChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setMinUpdatedAgeMs(event.target.value);
      resetPagination();
    },
    [resetPagination],
  );
  const onManualReviewChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setManualReviewOnly(event.target.checked);
      resetPagination();
    },
    [resetPagination],
  );
  const onFailedOnlyChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setFailedSideEffectOnly(event.target.checked);
      resetPagination();
    },
    [resetPagination],
  );
  const onDeadlineOnlyChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setDeadlineBreachedOnly(event.target.checked);
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
  const refresh = useCallback(() => {
    setSearch((current) => current.trim());
    setBlocker((current) => current.trim());
    setRefreshTick((current) => current + 1);
  }, []);
  const nextPage = useCallback(() => {
    if (!nextCursor) {
      return;
    }
    setCursorHistory((current) => [...current, cursor]);
    setCursor(nextCursor);
  }, [cursor, nextCursor]);
  const previousPage = useCallback(() => {
    if (cursorHistory.length === 0) {
      return;
    }
    setCursor(cursorHistory[cursorHistory.length - 1]);
    setCursorHistory((current) => current.slice(0, -1));
  }, [cursorHistory]);

  const onNoteSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!detail || !adminToken || !noteMessage.trim()) {
        return;
      }
      setActionStatus(undefined);
      setError(undefined);
      const client = createOtcClient();
      try {
        if (noteMode === 'manual_review') {
          await client.markAdminManualReview(
            detail.trade.tradeId,
            {
              idempotencyKey: createClientRequestId('admin_manual_review'),
              reason: noteMessage.trim(),
              metadata: { source: 'otc_admin_ui' },
            },
            adminToken,
          );
          setActionStatus('Manual review note recorded.');
        } else {
          await client.recordAdminSupportAlert(
            detail.trade.tradeId,
            {
              idempotencyKey: createClientRequestId('admin_support_alert'),
              severity: noteSeverity,
              message: noteMessage.trim(),
              contact: noteContact.trim() || undefined,
              metadata: { source: 'otc_admin_ui' },
            },
            adminToken,
          );
          setActionStatus('Support alert note recorded.');
        }
        setNoteMessage('');
        setNoteContact('');
        setRefreshTick((current) => current + 1);
      } catch (submitError) {
        setError(formatApiError(submitError, 'Admin note failed to submit.'));
      }
    },
    [adminToken, detail, noteContact, noteMessage, noteMode, noteSeverity],
  );

  const onPublicAlertSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!detail || !publicMessage.trim()) {
        return;
      }
      setActionStatus(undefined);
      setError(undefined);
      try {
        await createOtcClient().recordPublicSupportAlert(detail.trade.tradeId, {
          idempotencyKey: createClientRequestId('user_support_alert'),
          actor: 'user',
          severity: publicSeverity,
          message: publicMessage.trim(),
          source: 'user',
          contact: publicContact.trim() || undefined,
          metadata: { source: 'otc_admin_ui_support_form' },
        });
        setActionStatus('User support alert submitted.');
        setPublicMessage('');
        setPublicContact('');
        setRefreshTick((current) => current + 1);
      } catch (submitError) {
        setError(formatApiError(submitError, 'User support alert failed to submit.'));
      }
    },
    [detail, publicContact, publicMessage, publicSeverity],
  );

  const replayDelivery = useCallback(
    async (delivery: AlertDeliveryModel) => {
      if (!detail || !adminToken || !delivery.supportAlertId) {
        return;
      }
      setActionStatus(undefined);
      setError(undefined);
      try {
        await createOtcClient().replayAdminSupportAlertDelivery(
          detail.trade.tradeId,
          delivery.supportAlertId,
          { idempotencyKey: createClientRequestId('admin_alert_replay') },
          adminToken,
        );
        setActionStatus('Alert delivery replay queued.');
        setRefreshTick((current) => current + 1);
      } catch (replayError) {
        setError(formatApiError(replayError, 'Alert delivery replay failed.'));
      }
    },
    [adminToken, detail],
  );
  const copySupportSummary = useCallback(async () => {
    if (!detail || typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }
    try {
      await navigator.clipboard.writeText(buildSupportSummaryText(detail));
      setActionStatus('Support summary copied.');
    } catch {
      setError('Support summary copy failed.');
    }
  }, [detail]);

  const connectOperatorWallet = useCallback(async () => {
    setBaseActionStatus('connecting');
    setBaseActionError(undefined);
    try {
      setOperatorWallet(await connectInjectedEvmWallet());
      setBaseActionStatus('idle');
    } catch (walletError) {
      setBaseActionStatus('error');
      setBaseActionError(walletError instanceof Error ? walletError.message : 'Operator wallet connection failed.');
    }
  }, []);

  const switchOperatorNetwork = useCallback(async () => {
    if (!detail) return;
    setBaseActionStatus('switching');
    setBaseActionError(undefined);
    try {
      await switchInjectedEvmChain(detail.trade.usdcEscrow.chainId);
      setOperatorWallet(await readInjectedEvmWallet());
      setBaseActionStatus('idle');
    } catch (networkError) {
      setBaseActionStatus('error');
      setBaseActionError(networkError instanceof Error ? networkError.message : 'Operator network switch failed.');
    }
  }, [detail]);

  const createBaseTrade = useCallback(async () => {
    if (!detail || !adminToken) return;
    setBaseActionStatus('preparing');
    setBaseActionError(undefined);
    setBaseCreateTxHash(undefined);
    const client = createOtcClient();
    try {
      const wallet = await readInjectedEvmWallet();
      setOperatorWallet(wallet);
      if (!wallet.connected || !wallet.address) {
        throw new Error('Connect the Base operator wallet before creating the escrow trade.');
      }
      if (wallet.chainId !== detail.trade.usdcEscrow.chainId) {
        throw new Error(`Switch operator wallet to chain ${detail.trade.usdcEscrow.chainId}.`);
      }
      assertEscrowCanBeCreated(await client.verifyUsdcEscrowTerms(detail.trade.tradeId));
      const intent = await client.prepareUsdcCreateTrade(detail.trade.tradeId, {
        idempotencyKey: createClientRequestId('admin_usdc_create_trade'),
        actor: 'otc-admin-ui',
      }, adminToken);
      const createCall = prepareEscrowCreateTradeCall(
        {
          tradeKey: intent.tradeKey,
          buyer: intent.buyer,
          seller: intent.seller,
          amountMicros: intent.amountMicros,
          feeMicros: intent.feeMicros,
          expiryUnixSeconds: intent.expiryUnixSeconds,
        },
        {
          chainId: intent.chainId,
          usdcToken: detail.trade.usdcEscrow.usdcToken,
          escrowContract: intent.contract,
        },
      );
      setBaseActionStatus('creating');
      const txHash = await sendAndWaitInjectedEvmTransaction(toTransactionRequest(createCall), wallet.address);
      setBaseCreateTxHash(txHash);
      assertEscrowCreated(await client.verifyUsdcEscrowTerms(detail.trade.tradeId));
      setBaseActionStatus('recording');
      await client.recordSideEffect(
        detail.trade.tradeId,
        {
          idempotencyKey: createClientRequestId('admin_usdc_create_trade_confirmed'),
          effectType: 'usdc_create_trade',
          status: 'confirmed',
          actor: 'otc-admin-ui',
          txHash,
          chainId: intent.chainId,
          metadata: {
            contract: intent.contract,
            trade_key: intent.tradeKey,
            buyer: intent.buyer,
            seller: intent.seller,
            amount_micros: intent.amountMicros,
            fee_micros: intent.feeMicros,
            expiry_unix_seconds: intent.expiryUnixSeconds,
          },
        },
        adminToken,
      );
      setBaseActionStatus('confirmed');
      setActionStatus('Base escrow createTrade recorded.');
      setRefreshTick((current) => current + 1);
    } catch (createError) {
      setBaseActionStatus('error');
      setBaseActionError(formatApiError(createError, 'Base createTrade failed.'));
    }
  }, [adminToken, detail]);

  return (
    <section className="admin-page">
      <div className="om-page-title">
        <span>Admin</span>
        <h1>Trade operations</h1>
        <p>Operators can inspect live backlog, blocker, and alert status. Settlement controls are intentionally absent from the UI.</p>
      </div>

      <nav className="admin-tabs" aria-label="Admin sections">
        <a className="is-active" href="/admin/trades">Trades</a>
        <a href="/admin/users">Users</a>
      </nav>

      <form className="om-panel admin-auth" onSubmit={onTokenSubmit}>
        <label>
          <span>Admin API token</span>
          <input value={tokenInput} onChange={onTokenChange} placeholder="Bearer token" type="password" />
        </label>
        <button className="om-button om-button--primary" type="submit">
          Connect
        </button>
      </form>

      <div className="admin-metrics" aria-label="Admin backlog indicators">
        <MetricCard label="Open alerts" value={metrics.alerts} tone={metrics.alerts > 0 ? 'warning' : 'ok'} />
        <MetricCard label="Manual review" value={metrics.manualReview} tone={metrics.manualReview > 0 ? 'danger' : 'ok'} />
        <MetricCard label="Blockers" value={metrics.blockers} tone={metrics.blockers > 0 ? 'warning' : 'ok'} />
        <MetricCard label="Failed effects" value={metrics.failedSideEffects} tone={metrics.failedSideEffects > 0 ? 'danger' : 'ok'} />
      </div>

      <div className="admin-page__grid">
        <section className="om-panel admin-list">
          <div className="admin-list__toolbar">
            <input placeholder="Search trade, address, tx, or outpoint" aria-label="Search admin trades" value={search} onChange={onSearchChange} />
            <select aria-label="State filter" value={stateFilter} onChange={onStateChange}>
              {ADMIN_STATE_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select aria-label="Severity filter" value={severityFilter} onChange={onSeverityChange}>
              {ADMIN_SEVERITY_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select aria-label="Alert delivery status filter" value={alertDeliveryStatus} onChange={onDeliveryStatusChange}>
              {ADMIN_DELIVERY_STATUS_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input placeholder="Blocker" aria-label="Blocker filter" value={blocker} onChange={onBlockerChange} />
            <input placeholder="Min updated age ms" aria-label="Minimum updated age milliseconds" inputMode="numeric" value={minUpdatedAgeMs} onChange={onMinAgeChange} />
            <select aria-label="Page size" value={limit} onChange={onLimitChange}>
              {ADMIN_LIMIT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option} rows
                </option>
              ))}
            </select>
            <label className="admin-list__toggle">
              <input checked={manualReviewOnly} onChange={onManualReviewChange} type="checkbox" />
              <span>Manual review only</span>
            </label>
            <label className="admin-list__toggle">
              <input checked={failedSideEffectOnly} onChange={onFailedOnlyChange} type="checkbox" />
              <span>Failed side effects</span>
            </label>
            <label className="admin-list__toggle">
              <input checked={deadlineBreachedOnly} onChange={onDeadlineOnlyChange} type="checkbox" />
              <span>Deadline breached</span>
            </label>
            <button className="om-button" onClick={refresh} type="button">
              Refresh
            </button>
          </div>

          {error ? <p className="om-form-error">{error}</p> : null}
          {actionStatus ? <p className="admin-action-status">{actionStatus}</p> : null}
          <div className="admin-pagination">
            <span>
              {rows.length} of {total} trades
            </span>
            <button className="om-button" disabled={cursorHistory.length === 0} onClick={previousPage} type="button">
              Previous
            </button>
            <button className="om-button" disabled={!nextCursor} onClick={nextPage} type="button">
              Next
            </button>
          </div>
          {listStatus === 'loading' ? (
            <div className="om-empty">
              <BrandLoader label="Loading live admin trades..." />
            </div>
          ) : null}
          {listStatus === 'ready' && rowModels.length === 0 ? <div className="om-empty">No trades match the current filters.</div> : null}
          {rowModels.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Trade</th>
                  <th>State</th>
                  <th>Amounts</th>
                  <th>Indicators</th>
                  <th>Blockers</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {rowModels.map((row) => (
                  <tr key={row.tradeId} className={row.tradeId === selectedTradeId ? 'is-selected' : undefined}>
                    <td>
                      <a
                        href={`/admin/trades/${row.tradeId}`}
                        onClick={(event) => {
                          event.preventDefault();
                          setSelectedTradeId(row.tradeId);
                        }}
                      >
                        {row.tradeId}
                      </a>
                    </td>
                    <td>
                      <StateBadge badge={buildStateBadge(row.state)} />
                    </td>
                    <td>
                      <span>{row.amountPrl} PRL</span>
                      <small>{row.amountUsdc} USDC</small>
                    </td>
                    <td>
                      <div className="admin-indicators">
                        {row.indicators.map((indicator) => (
                          <span key={indicator.key} className={`admin-indicator is-${indicator.tone}`}>
                            {indicator.label}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>{row.blockerSummary}</td>
                    <td>{row.updatedLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>

        <aside className="om-panel admin-detail">
          <span className="om-kicker">Selected trade</span>
          {detailStatus === 'loading' ? (
            <div className="om-empty">
              <BrandLoader label="Loading debug detail..." />
            </div>
          ) : null}
          {detail ? (
            <>
              <h2>{detail.trade.tradeId}</h2>
              <StateBadge badge={buildStateBadge(detail.trade.state)} />
              <DataRow label="Redaction" value={detail.redaction} />
              <DataRow label="Support headline" value={detail.supportSummary.headline} />
              <DataRow label="Public proof" value={detail.supportSummary.publicProofPath} />
              <DataRow label="Current blockers" value={detail.currentBlockers.join(', ') || 'none'} />
              <DataRow label="Deadline breaches" value={detail.deadlineBreaches.join(', ') || 'none'} />
              <button className="om-button admin-detail__copy" onClick={() => void copySupportSummary()} type="button">
                Copy support summary
              </button>

              <DetailTags title="Safe actions" values={detail.safeActions} empty="No safe support actions." tone="ok" />
              <DetailTags title="Waiting on" values={detail.supportSummary.waitingOn} empty="No support wait states." tone="warning" />

              <BaseEscrowCreateTradePanel
                detail={detail}
                wallet={operatorWallet}
                status={baseActionStatus}
                error={baseActionError}
                txHash={baseCreateTxHash}
                onConnect={() => void connectOperatorWallet()}
                onSwitch={() => void switchOperatorNetwork()}
                onCreate={() => void createBaseTrade()}
              />

              <AdminNoteForm
                mode={noteMode}
                severity={noteSeverity}
                message={noteMessage}
                contact={noteContact}
                onModeChange={setNoteMode}
                onSeverityChange={setNoteSeverity}
                onMessageChange={setNoteMessage}
                onContactChange={setNoteContact}
                onSubmit={onNoteSubmit}
              />

              <PublicSupportForm
                severity={publicSeverity}
                message={publicMessage}
                contact={publicContact}
                onSeverityChange={setPublicSeverity}
                onMessageChange={setPublicMessage}
                onContactChange={setPublicContact}
                onSubmit={onPublicAlertSubmit}
              />

              <div className="admin-detail__section">
                <h3>Alert delivery</h3>
                {deliveryRows.length > 0 ? (
                  <ul className="admin-deliveries">
                    {deliveryRows.map((delivery) => (
                      <li key={delivery.key} className={`is-${delivery.status}`}>
                        <strong>{delivery.label}</strong>
                        <small>{delivery.updatedAt}</small>
                        {delivery.supportAlertId ? <code>{delivery.supportAlertId}</code> : null}
                        {delivery.error ? <code>{delivery.error}</code> : null}
                        {delivery.canReplay ? (
                          <button className="om-button" onClick={() => void replayDelivery(delivery)} type="button">
                            Replay alert delivery
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="om-empty">No alert delivery records.</div>
                )}
              </div>

              <ProofSummary detail={detail} />
              <SideEffectList sideEffects={detail.sideEffects} />
              <EventList events={detail.events} />

              <p>Operators can add support context and replay failed alert delivery only; settlement execution actions are not available here.</p>
            </>
          ) : detailStatus === 'error' ? (
            <p className="om-form-error">Selected trade detail failed to load.</p>
          ) : (
            <p>Select a trade to inspect blocker and alert delivery status.</p>
          )}
        </aside>
      </div>
    </section>
  );
}

function BaseEscrowCreateTradePanel({
  detail,
  wallet,
  status,
  error,
  txHash,
  onConnect,
  onSwitch,
  onCreate,
}: {
  detail: AdminTradeDebugDetail;
  wallet: EvmWalletSnapshot;
  status: BaseOperatorActionStatus;
  error?: string;
  txHash?: string;
  onConnect: () => void;
  onSwitch: () => void;
  onCreate: () => void;
}) {
  const trade = detail.trade;
  const alreadyCreated = detail.sideEffects.some(
    (effect) => effect.effectType === 'usdc_create_trade' && (effect.status === 'submitted' || effect.status === 'confirmed'),
  );
  const isBusy = status === 'connecting' || status === 'switching' || status === 'preparing' || status === 'creating' || status === 'recording';
  const canPrepare = !isBusy && !trade.usdcEscrow.depositTxHash;
  const action = getBaseCreateTradeAction(trade, wallet, canPrepare);

  return (
    <div className="admin-detail__section admin-base-create">
      <h3>Base escrow setup</h3>
      <div className="admin-proof-grid">
        <DataRow label="Operator wallet" value={wallet.address ?? (hasInjectedEvmWallet() ? 'Disconnected' : 'No injected wallet')} />
        <DataRow label="Chain" value={trade.usdcEscrow.chainId} />
        <DataRow label="Contract" value={trade.usdcEscrow.contract} />
        <DataRow label="Trade key" value={trade.usdcEscrow.tradeKey} />
        <DataRow label="Expected USDC micros" value={trade.usdcEscrow.expectedAmountMicros} />
        <DataRow label="Create status" value={alreadyCreated ? 'created or submitted' : 'not recorded'} />
      </div>
      <button
        className="om-button om-button--primary"
        disabled={action.disabled}
        onClick={action.kind === 'connect' ? onConnect : action.kind === 'switch' ? onSwitch : onCreate}
        type="button"
      >
        {isBusy ? <BrandLoader compact label={getBaseCreateTradeStatusLabel(status)} /> : action.label}
      </button>
      {action.reason ? <small>{action.reason}</small> : null}
      {txHash ? <code>{txHash}</code> : null}
      {error ? <small className="admin-base-create__error">{error}</small> : null}
    </div>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: number; tone: 'ok' | 'warning' | 'danger' }) {
  return (
    <div className={`admin-metric is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AdminNoteForm({
  mode,
  severity,
  message,
  contact,
  onModeChange,
  onSeverityChange,
  onMessageChange,
  onContactChange,
  onSubmit,
}: {
  mode: NoteMode;
  severity: SupportAlertSeverity;
  message: string;
  contact: string;
  onModeChange: (mode: NoteMode) => void;
  onSeverityChange: (severity: SupportAlertSeverity) => void;
  onMessageChange: (message: string) => void;
  onContactChange: (contact: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form className="admin-action-form" onSubmit={onSubmit}>
      <h3>Add note</h3>
      <div className="admin-action-form__grid">
        <select aria-label="Admin note type" value={mode} onChange={(event) => onModeChange(event.target.value as NoteMode)}>
          <option value="support_alert">Support alert</option>
          <option value="manual_review">Manual review</option>
        </select>
        <select aria-label="Admin note severity" value={severity} onChange={(event) => onSeverityChange(event.target.value as SupportAlertSeverity)} disabled={mode === 'manual_review'}>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="critical">Critical</option>
        </select>
      </div>
      <textarea aria-label="Admin note message" value={message} onChange={(event) => onMessageChange(event.target.value)} placeholder="Operator note or manual-review reason" required />
      <input aria-label="Admin note contact" value={contact} onChange={(event) => onContactChange(event.target.value)} placeholder="Optional contact" />
      <button className="om-button om-button--primary" type="submit">
        Add note
      </button>
    </form>
  );
}

function PublicSupportForm({
  severity,
  message,
  contact,
  onSeverityChange,
  onMessageChange,
  onContactChange,
  onSubmit,
}: {
  severity: SupportAlertSeverity;
  message: string;
  contact: string;
  onSeverityChange: (severity: SupportAlertSeverity) => void;
  onMessageChange: (message: string) => void;
  onContactChange: (contact: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form className="admin-action-form" onSubmit={onSubmit}>
      <h3>User help alert</h3>
      <select aria-label="User support alert severity" value={severity} onChange={(event) => onSeverityChange(event.target.value as SupportAlertSeverity)}>
        <option value="info">Info</option>
        <option value="warning">Warning</option>
        <option value="critical">Critical</option>
      </select>
      <textarea aria-label="User support alert message" value={message} onChange={(event) => onMessageChange(event.target.value)} placeholder="User-visible help request" required />
      <input aria-label="User support alert contact" value={contact} onChange={(event) => onContactChange(event.target.value)} placeholder="Optional contact" />
      <button className="om-button" type="submit">
        Submit user alert
      </button>
    </form>
  );
}

function DetailTags({
  title,
  values,
  empty,
  tone,
}: {
  title: string;
  values: string[];
  empty: string;
  tone: 'ok' | 'warning' | 'danger';
}) {
  return (
    <div className="admin-detail__section">
      <h3>{title}</h3>
      {values.length > 0 ? (
        <div className="admin-indicators">
          {values.map((value) => (
            <span key={value} className={`admin-indicator is-${tone}`}>
              {value}
            </span>
          ))}
        </div>
      ) : (
        <div className="om-empty">{empty}</div>
      )}
    </div>
  );
}

function ProofSummary({ detail }: { detail: AdminTradeDebugDetail }) {
  const { proof } = detail;
  return (
    <div className="admin-detail__section">
      <h3>Proof</h3>
      <div className="admin-proof-grid">
        <DataRow label="Quote" value={`${proof.quote.amountPrl} PRL / ${proof.quote.amountUsdc} USDC`} />
        <DataRow label="Pearl escrow" value={proof.pearl.escrowAddress} />
        <DataRow label="Pearl outpoint" value={proof.pearl.escrowOutpoint ?? 'none'} />
        <DataRow label="Pearl confirmations" value={String(proof.pearl.escrowConfirmations)} />
        <DataRow label="Base contract" value={proof.base.contract} />
        <DataRow label="Base trade key" value={proof.base.tradeKey} />
        <DataRow label="Base deposit" value={proof.base.depositTxHash ?? 'none'} />
        <DataRow label="Observed" value={proof.observedAt} />
      </div>
    </div>
  );
}

function SideEffectList({ sideEffects }: { sideEffects: OtcSideEffect[] }) {
  return (
    <div className="admin-detail__section">
      <h3>Side effects</h3>
      {sideEffects.length > 0 ? (
        <ul className="admin-record-list">
          {sideEffects.map((effect) => (
            <li key={effect.idempotencyKey}>
              <strong>{effect.effectType}</strong>
              <span>{effect.status}</span>
              <small>{effect.actor} | {effect.updatedAt}</small>
              {effect.txHash ? <code>{effect.txHash}</code> : null}
              {effect.outpoint ? <code>{effect.outpoint}</code> : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="om-empty">No side effects recorded.</div>
      )}
    </div>
  );
}

function EventList({ events }: { events: AdminTradeDebugDetail['events'] }) {
  return (
    <div className="admin-detail__section">
      <h3>Events</h3>
      {events.length > 0 ? (
        <ul className="admin-record-list">
          {events.map((event) => (
            <li key={event.sourceEventId}>
              <strong>{event.fromState} {'->'} {event.toState}</strong>
              <span>{event.source}</span>
              <small>{event.observedAt}</small>
              {event.txHash ? <code>{event.txHash}</code> : null}
              {event.outpoint ? <code>{event.outpoint}</code> : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="om-empty">No trade events recorded.</div>
      )}
    </div>
  );
}

function buildAdminMetrics(rows: AdminTradeSummary[]) {
  return {
    alerts: rows.reduce((sum, row) => sum + row.alertCount, 0),
    manualReview: rows.filter((row) => row.manualReview).length,
    blockers: rows.reduce((sum, row) => sum + row.currentBlockers.length, 0),
    failedSideEffects: rows.reduce((sum, row) => sum + row.failedSideEffectCount, 0),
  };
}

function getBaseCreateTradeAction(
  trade: AdminTradeDebugDetail['trade'],
  wallet: EvmWalletSnapshot,
  canPrepare: boolean,
): { kind: 'connect' | 'switch' | 'create'; label: string; disabled: boolean; reason?: string } {
  if (!canPrepare) {
    return {
      kind: 'create',
      label: 'Create Base escrow',
      disabled: true,
      reason: trade.usdcEscrow.depositTxHash ? 'USDC deposit already exists for this trade.' : undefined,
    };
  }
  if (!wallet.connected) {
    return { kind: 'connect', label: 'Connect operator wallet', disabled: false };
  }
  if (wallet.chainId !== trade.usdcEscrow.chainId) {
    return { kind: 'switch', label: `Switch to chain ${trade.usdcEscrow.chainId}`, disabled: false };
  }
  return { kind: 'create', label: 'Create Base escrow', disabled: false };
}

function getBaseCreateTradeStatusLabel(status: BaseOperatorActionStatus): string {
  switch (status) {
    case 'connecting':
      return 'Connecting wallet...';
    case 'switching':
      return 'Switching network...';
    case 'preparing':
      return 'Preparing createTrade...';
    case 'creating':
      return 'Creating escrow...';
    case 'recording':
      return 'Recording evidence...';
    case 'confirmed':
      return 'Created';
    default:
      return 'Working...';
  }
}

function assertEscrowCanBeCreated(verification: UsdcEscrowVerification): void {
  const status = verification.onChain?.status;
  if (!status) {
    throw new Error('Base escrow verification did not return on-chain state.');
  }
  if (status === 'none') {
    return;
  }
  if (verification.verified) {
    throw new Error(`Base escrow already exists on-chain with status ${status}; refresh the trade before retrying.`);
  }
  throw new Error(`Base escrow already exists with mismatched terms: ${formatVerificationMismatches(verification)}.`);
}

function assertEscrowCreated(verification: UsdcEscrowVerification): void {
  const status = verification.onChain?.status;
  if (verification.verified && status === 'created') {
    return;
  }
  throw new Error(`Base createTrade did not verify on-chain after confirmation: status ${status ?? 'unknown'}; mismatches ${formatVerificationMismatches(verification)}.`);
}

function formatVerificationMismatches(verification: UsdcEscrowVerification): string {
  return verification.mismatches.length > 0 ? verification.mismatches.join(', ') : 'none reported';
}

function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatApiError(error: unknown, fallback: string): string {
  if (error instanceof OtcApiError) {
    if (error.status === 401) {
      return 'Admin token rejected. Reconnect with a valid operator token.';
    }
    if (error.status === 403) {
      return 'Admin token lacks permission for this action.';
    }
    if (error.status === 429) {
      return 'Rate limit hit. Wait before submitting another support alert.';
    }
    if (error.status >= 500) {
      return 'Admin API unavailable. Try again after service recovery.';
    }
    return error.message;
  }
  return error instanceof Error ? error.message : fallback;
}

function buildSupportSummaryText(detail: AdminTradeDebugDetail): string {
  return [
    detail.supportSummary.headline,
    `Trade: ${detail.trade.tradeId}`,
    `State: ${detail.trade.state}`,
    `Public proof: ${detail.supportSummary.publicProofPath}`,
    `Blockers: ${detail.currentBlockers.join(', ') || 'none'}`,
    `Deadline breaches: ${detail.deadlineBreaches.join(', ') || 'none'}`,
    `Waiting on: ${detail.supportSummary.waitingOn.join(', ') || 'none'}`,
  ].join('\n');
}
