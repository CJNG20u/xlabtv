import { useEffect, useState } from 'react';
import { Check, Download, Trash2 } from 'lucide-react';
import type { StoreItem, StoreJobAction } from '../mock';
import { buildCardGradient, buildIconTileSurface } from '../utils/color';

interface StoreDetailPanelProps {
  item: StoreItem | null;
  submitting: boolean;
  onAction: (item: StoreItem, action: StoreJobAction) => void;
  onClose: () => void;
}

function getJobStatusLabel(item: StoreItem): string {
  if (!item.job) {
    return '';
  }
  if (item.job.state === 'queued') {
    return 'Waiting…';
  }
  if (item.job.state === 'running') {
    return item.job.action === 'remove' ? 'Removing…' : 'Installing…';
  }
  return '';
}

export function StoreDetailPanel({
  item,
  submitting,
  onAction,
  onClose,
}: StoreDetailPanelProps) {
  const [iconFailed, setIconFailed] = useState(false);

  useEffect(() => {
    setIconFailed(false);
  }, [item?.id]);

  if (!item) {
    return null;
  }

  const hasIcon = Boolean(item.icon) && !iconFailed;
  const isJobActive =
    item.job?.state === 'queued' || item.job?.state === 'running';
  const actionType: StoreJobAction = item.installed ? 'remove' : 'install';
  const busy = isJobActive || submitting;
  const statusLabel = isJobActive
    ? getJobStatusLabel(item)
    : submitting
      ? 'Waiting…'
      : '';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="store-detail-title"
      className="fixed inset-0 z-40 flex items-center justify-center bg-[#06080D]/86 px-16"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[58rem] overflow-hidden rounded-3xl border border-white/12 bg-[#10141D] p-12"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-9">
          {/* Large Icon or Color Gradient Artwork */}
          <div
            className="relative flex h-[11rem] w-[15.5rem] shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/12"
            style={{
              background: hasIcon
                ? buildIconTileSurface(item.color)
                : buildCardGradient(item.color),
            }}
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'linear-gradient(160deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0) 42%, rgba(0, 0, 0, 0.24) 100%)',
              }}
            />

            {hasIcon ? (
              <img
                src={item.icon}
                alt={item.name}
                referrerPolicy="no-referrer"
                decoding="async"
                onError={() => setIconFailed(true)}
                className="relative z-10 h-[6.5rem] w-[6.5rem] object-contain"
              />
            ) : (
              <span
                className="relative z-10 px-5 text-center font-display text-[1.95rem] leading-[1.12] font-bold tracking-[-0.02em] text-white"
                style={{ textWrap: 'balance' }}
              >
                {item.name}
              </span>
            )}
          </div>

          {/* App Metadata */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3 text-[1.0625rem] text-[#94A3B8]">
              <span>{item.category}</span>
              {item.installed && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1.5 font-medium text-emerald-300">
                    <Check className="h-[1.05rem] w-[1.05rem]" strokeWidth={2.5} />
                    <span>Installed</span>
                  </span>
                </>
              )}
            </div>

            <h2
              id="store-detail-title"
              className="mt-2 font-display text-[2.875rem] leading-[1.08] font-bold tracking-[-0.025em] text-[#F8FAFC]"
              style={{ textWrap: 'balance' }}
            >
              {item.name}
            </h2>

            <p className="mt-2 text-[1.375rem] font-medium text-[#CBD5E1]">
              {item.subtitle}
            </p>
          </div>
        </div>

        {/* Description */}
        <p className="mt-8 text-[1.25rem] leading-[1.6] text-[#94A3B8]">
          {item.description}
        </p>

        {/* Active Job Progress Section */}
        {busy && (
          <div className="mt-7 rounded-2xl border border-white/10 bg-[#151B27] p-5">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[1.1875rem] font-semibold text-[#F8FAFC]">
                {statusLabel}
              </span>
              {item.job?.message && (
                <span className="truncate text-[1.05rem] text-[#94A3B8]">
                  {item.job.message}
                </span>
              )}
            </div>
            <div className="mt-3.5 h-[0.375rem] w-full overflow-hidden rounded-full bg-white/12">
              <div className="tv-progress-indeterminate h-full rounded-full bg-[#38BDF8]" />
            </div>
          </div>
        )}

        {/* Single Focusable Primary Action Button */}
        <div className="mt-9 flex items-center justify-between gap-6">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!busy) {
                onAction(item, actionType);
              }
            }}
            aria-current="true"
            className={`tv-card tv-btn-focused relative inline-flex items-center gap-3 rounded-xl px-9 py-4 font-sans text-[1.25rem] leading-none font-semibold whitespace-nowrap focus:outline-none ${
              busy
                ? 'border border-white/15 bg-[#1B2230] text-[#94A3B8]'
                : actionType === 'install'
                  ? 'bg-[#F8FAFC] text-[#090B10]'
                  : 'border border-rose-400/45 bg-[#2A151D] text-rose-100'
            }`}
          >
            {busy ? (
              <span>{statusLabel}</span>
            ) : actionType === 'install' ? (
              <>
                <Download className="h-[1.3rem] w-[1.3rem]" strokeWidth={2.2} />
                <span>Install</span>
              </>
            ) : (
              <>
                <Trash2 className="h-[1.3rem] w-[1.3rem]" strokeWidth={2.2} />
                <span>Remove</span>
              </>
            )}
            <span
              aria-hidden="true"
              className="tv-focus-ring tv-focus-ring-active pointer-events-none absolute -inset-[5px] rounded-[1rem] border-[3px] border-[#38BDF8]"
            />
          </button>

          <span className="text-[1.05rem] text-[#64748B]">
            {busy
              ? 'Press Back to keep browsing while this finishes'
              : 'Press Back to return to Store'}
          </span>
        </div>
      </div>
    </div>
  );
}
