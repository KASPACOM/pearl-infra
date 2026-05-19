import type { ReactNode } from 'react';
import type { DeadlineModel, FailureBannerModel, StateBadgeModel, TimelineEventModel } from '../page-models.js';

export type BrandLoaderVariant = 'pearl-pulse' | 'shell-breathe';

export function BrandLoader({
  label,
  variant = 'pearl-pulse',
  compact = false,
}: {
  label: string;
  variant?: BrandLoaderVariant;
  compact?: boolean;
}) {
  return (
    <span className={`om-loader om-loader--${variant} ${compact ? 'om-loader--compact' : ''}`} role="status" aria-live="polite">
      {variant === 'shell-breathe' ? (
        <svg className="om-loader__shell" viewBox="0 0 140 140" aria-hidden="true">
          <defs>
            <radialGradient id="om-loader-pearl" cx="35%" cy="35%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="55%" stopColor="#ece5ff" />
              <stop offset="100%" stopColor="#b69aff" />
            </radialGradient>
          </defs>
          <g className="om-loader__shell-bottom">
            <path d="M14 76 Q70 126 126 76 Q70 86 14 76 Z" />
          </g>
          <g className="om-loader__shell-top">
            <path d="M14 64 Q70 12 126 64 Q70 56 14 64 Z" />
          </g>
          <circle className="om-loader__shell-pearl" cx="70" cy="70" r="9" />
        </svg>
      ) : (
        <span className="om-loader__pulse" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      )}
      <span>{label}</span>
    </span>
  );
}

export function StateBadge({ badge }: { badge: StateBadgeModel }) {
  return <span className={`om-badge om-badge--${badge.family}`}>{badge.label}</span>;
}

export function FailureBanner({ banner }: { banner?: FailureBannerModel }) {
  if (!banner) {
    return null;
  }
  return (
    <section className={`om-banner om-banner--${banner.severity}`} role="status">
      <strong>{banner.headline}</strong>
      <a href={banner.supportHref}>Contact support</a>
    </section>
  );
}

export function DeadlineStrip({ deadlines }: { deadlines: DeadlineModel[] }) {
  return (
    <div className="om-deadlines">
      {deadlines.map((deadline) => (
        <div key={deadline.key} className={`om-deadline is-${deadline.status}`}>
          <span>{deadline.label}</span>
          <strong>{formatRemaining(deadline.msRemaining)}</strong>
        </div>
      ))}
    </div>
  );
}

export function Timeline({ events }: { events: TimelineEventModel[] }) {
  if (events.length === 0) {
    return <div className="om-empty">No indexed activity yet.</div>;
  }
  return (
    <ol className="om-timeline">
      {events.map((event) => {
        const eventKey = `${event.observedAt}-${event.chain}-${event.label}-${event.txHash ?? event.outpoint ?? 'pending'}`;
        return (
          <li key={eventKey} className={`is-${event.chain}`}>
            <span className="om-timeline__dot" />
            <div>
              <strong>{event.label}</strong>
              <small>
                {event.observedAt}
                {event.confirmations === undefined ? '' : ` · ${event.confirmations} confirmations`}
              </small>
              {event.txHash || event.outpoint ? <code>{event.txHash ?? event.outpoint}</code> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="om-field">
      <span>{label}</span>
      {children}
      {error ? <small className="is-error">{error}</small> : null}
    </label>
  );
}

export function DataRow({ label, value }: { label: string; value?: string | number }) {
  return (
    <div className="om-data-row">
      <span>{label}</span>
      <code>{value || '-'}</code>
    </div>
  );
}

function formatRemaining(ms: number): string {
  if (ms <= 0) {
    return 'closed';
  }
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}
