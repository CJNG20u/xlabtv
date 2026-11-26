import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ShoppingBag } from 'lucide-react';
import type { StoreItem } from '../mock';
import { buildCardGradient, buildIconTileSurface } from '../utils/color';
import { EmptyErrorState } from './EmptyErrorState';

export interface StoreCategoryRow {
  category: string;
  items: StoreItem[];
}

export const STORE_CATEGORY_ORDER = ['Watch', 'Live & Free', 'Music', 'Play', 'Web'];

export function groupStoreItemsByCategory(
  items: StoreItem[]
): StoreCategoryRow[] {
  const buckets = new Map<string, StoreItem[]>();

  for (const item of items) {
    const cat = item.category?.trim() || 'Other';
    const list = buckets.get(cat) ?? [];
    list.push(item);
    buckets.set(cat, list);
  }

  const ordered: StoreCategoryRow[] = [];
  for (const cat of STORE_CATEGORY_ORDER) {
    const list = buckets.get(cat);
    if (list && list.length > 0) {
      ordered.push({ category: cat, items: list });
      buckets.delete(cat);
    }
  }

  for (const [cat, list] of buckets.entries()) {
    if (list.length > 0) {
      ordered.push({ category: cat, items: list });
    }
  }

  return ordered;
}

function formatClock(date: Date, use24Hour: boolean): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: use24Hour ? '2-digit' : 'numeric',
    minute: '2-digit',
    hour12: !use24Hour,
  }).format(date);
}

interface StoreViewProps {
  rows: StoreCategoryRow[];
  use24HourClock: boolean;
  showSubtitles: boolean;
  activeJobCount: number;
  errorMessage: string | null;
  retrying: boolean;
  focusedRowIndex: number;
  focusedColIndex: number;
  rowMemory: Record<number, number>;
  isGridActive: boolean;
  onFocusCard: (rowIndex: number, colIndex: number) => void;
  onSelectCard: (item: StoreItem, rowIndex: number, colIndex: number) => void;
  onRetry: () => void;
  onClose: () => void;
}

const CARD_WIDTH_REM = 19.25;
const CARD_GAP_REM = 2.0;
const CARD_STEP_REM = CARD_WIDTH_REM + CARD_GAP_REM;
const VISIBLE_SLOTS = 5;

export function StoreView({
  rows,
  use24HourClock,
  showSubtitles,
  activeJobCount,
  errorMessage,
  retrying,
  focusedRowIndex,
  focusedColIndex,
  rowMemory,
  isGridActive,
  onFocusCard,
  onSelectCard,
  onRetry,
  onClose,
}: StoreViewProps) {
  const [timeText, setTimeText] = useState<string>(() =>
    formatClock(new Date(), use24HourClock)
  );

  useEffect(() => {
    const syncTime = () => {
      const next = formatClock(new Date(), use24HourClock);
      setTimeText((prev) => (prev === next ? prev : next));
    };
    syncTime();

    let intervalId: number | null = null;
    const msUntilNextMinute = 60000 - (Date.now() % 60000);
    const timeoutId = window.setTimeout(() => {
      syncTime();
      intervalId = window.setInterval(syncTime, 60000);
    }, msUntilNextMinute);

    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [use24HourClock]);

  const showEmptyOrError = errorMessage !== null || rows.length === 0;

  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-[#090B10] text-[#F1F5F9]">
      {/* Store Top Header */}
      <header className="flex items-center justify-between px-16 pt-8 pb-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back to home"
            className="flex h-[3rem] w-[3rem] items-center justify-center rounded-full border border-white/12 bg-[#141924] text-[#CBD5E1] focus:outline-none"
          >
            <ArrowLeft className="h-[1.35rem] w-[1.35rem]" />
          </button>

          <div className="flex items-center gap-3">
            <ShoppingBag
              className="h-[1.85rem] w-[1.85rem] text-[#38BDF8]"
              strokeWidth={2}
              aria-hidden="true"
            />
            <h1 className="font-display text-[2.125rem] leading-none font-bold tracking-[-0.025em] text-[#F8FAFC]">
              Store
            </h1>
            {activeJobCount > 0 && (
              <span className="ml-2 text-[1.125rem] font-medium text-[#94A3B8]">
                · {activeJobCount}{' '}
                {activeJobCount === 1 ? 'task in progress' : 'tasks in progress'}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-6">
          <span className="text-[1.05rem] text-[#64748B]">
            Esc / B to return home
          </span>
          <time
            aria-label="Current time"
            className="font-display text-[1.75rem] leading-none font-medium tracking-[-0.015em] text-[#E2E8F0] tabular-nums whitespace-nowrap select-none"
          >
            {timeText}
          </time>
        </div>
      </header>

      {showEmptyOrError ? (
        <div className="-mt-16">
          <EmptyErrorState
            title={
              errorMessage ? 'Store unavailable' : 'No Store apps available'
            }
            description={
              errorMessage ??
              'No installable apps were returned by the Store catalog. Press Retry to check again or press Back to return home.'
            }
            retrying={retrying}
            isRetryFocused={isGridActive}
            onFocusRetry={() => {}}
            onRetry={onRetry}
          />
        </div>
      ) : (
        <main className="mt-2 space-y-6 pb-20">
          {rows.map((row, rowIndex) => (
            <StoreRowSection
              key={row.category}
              row={row}
              rowIndex={rowIndex}
              isRowFocused={isGridActive && focusedRowIndex === rowIndex}
              focusedColIndex={
                isGridActive && focusedRowIndex === rowIndex
                  ? focusedColIndex
                  : (rowMemory[rowIndex] ?? 0)
              }
              showSubtitles={showSubtitles}
              onFocusCard={onFocusCard}
              onSelectCard={onSelectCard}
            />
          ))}
        </main>
      )}
    </div>
  );
}

interface StoreRowSectionProps {
  row: StoreCategoryRow;
  rowIndex: number;
  isRowFocused: boolean;
  focusedColIndex: number;
  showSubtitles: boolean;
  onFocusCard: (rowIndex: number, colIndex: number) => void;
  onSelectCard: (item: StoreItem, rowIndex: number, colIndex: number) => void;
}

function StoreRowSection({
  row,
  rowIndex,
  isRowFocused,
  focusedColIndex,
  showSubtitles,
  onFocusCard,
  onSelectCard,
}: StoreRowSectionProps) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [scrollIndex, setScrollIndex] = useState(0);
  const [failedIcons, setFailedIcons] = useState<Record<string, boolean>>({});

  const maxScrollIndex = Math.max(0, row.items.length - VISIBLE_SLOTS);

  useEffect(() => {
    if (!isRowFocused) {
      return;
    }

    setScrollIndex((prev) => {
      if (focusedColIndex < prev) {
        return focusedColIndex;
      }
      if (focusedColIndex >= prev + VISIBLE_SLOTS) {
        return Math.min(maxScrollIndex, focusedColIndex - VISIBLE_SLOTS + 1);
      }
      return prev;
    });
  }, [isRowFocused, focusedColIndex, maxScrollIndex]);

  useEffect(() => {
    if (isRowFocused && sectionRef.current) {
      sectionRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [isRowFocused]);

  const translateRem = scrollIndex * CARD_STEP_REM;

  return (
    <section
      ref={sectionRef}
      aria-label={row.category}
      className="relative scroll-my-20"
    >
      <div className="mb-2 px-16">
        <h2
          className={`font-display text-[1.625rem] leading-tight font-semibold tracking-[-0.015em] transition-opacity duration-150 ${
            isRowFocused
              ? 'text-[#FFFFFF] opacity-100'
              : 'text-[#CBD5E1] opacity-80'
          }`}
        >
          {row.category}
        </h2>
      </div>

      <div className="overflow-x-clip px-16 pt-5 pb-2">
        <div
          className="tv-row-track flex gap-[2rem]"
          style={{
            transform: `translate3d(-${translateRem}rem, 0, 0)`,
            willChange: 'transform',
          }}
        >
          {row.items.map((item, colIndex) => {
            const isFocused = isRowFocused && focusedColIndex === colIndex;
            const hasIconImage = Boolean(item.icon) && !failedIcons[item.id];
            const isQueued = item.job?.state === 'queued';
            const isRunning = item.job?.state === 'running';
            const isJobActive = isQueued || isRunning;
            const jobLabel = isQueued
              ? 'Waiting…'
              : item.job?.action === 'remove'
                ? 'Removing…'
                : 'Installing…';

            return (
              <button
                key={item.id}
                type="button"
                aria-current={isFocused ? 'true' : undefined}
                onClick={() => {
                  onFocusCard(rowIndex, colIndex);
                  onSelectCard(item, rowIndex, colIndex);
                }}
                onMouseEnter={() => onFocusCard(rowIndex, colIndex)}
                onFocus={() => onFocusCard(rowIndex, colIndex)}
                className={`group w-[19.25rem] shrink-0 text-left focus:outline-none ${
                  isFocused ? 'relative z-20' : 'relative z-10'
                }`}
              >
                {/* Same 16:9 card style as home */}
                <div
                  className={`tv-card relative flex h-[10.875rem] w-[19.25rem] items-center justify-center overflow-hidden rounded-[1.125rem] border border-white/12 ${
                    isFocused ? 'tv-card-focused' : ''
                  }`}
                  style={{
                    background: hasIconImage
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

                  {/* Small "Installed" check badge */}
                  {item.installed && (
                    <span className="absolute top-3 right-3 z-20 inline-flex items-center gap-1 rounded-lg border border-emerald-400/50 bg-[#081018]/92 px-2.5 py-1 text-[0.8125rem] leading-none font-semibold text-emerald-300">
                      <Check className="h-[0.85rem] w-[0.85rem]" strokeWidth={2.6} />
                      <span>Installed</span>
                    </span>
                  )}

                  {hasIconImage ? (
                    <img
                      src={item.icon}
                      alt={item.name}
                      referrerPolicy="no-referrer"
                      decoding="async"
                      onError={() =>
                        setFailedIcons((prev) => ({
                          ...prev,
                          [item.id]: true,
                        }))
                      }
                      className="relative z-10 h-[5.5rem] w-[5.5rem] object-contain"
                    />
                  ) : (
                    <span
                      className="relative z-10 px-6 text-center font-display text-[1.9rem] leading-[1.12] font-bold tracking-[-0.02em] text-[#FFFFFF]"
                      style={{ textWrap: 'balance' }}
                    >
                      {item.name}
                    </span>
                  )}

                  {/* Active job overlay strip with indeterminate progress bar */}
                  {isJobActive && (
                    <div className="absolute inset-x-0 bottom-0 z-20 bg-[#080B12]/92 pt-2">
                      <div className="px-3.5 pb-2 text-[0.9rem] leading-none font-semibold text-[#F8FAFC]">
                        {jobLabel}
                      </div>
                      <div className="h-[0.25rem] w-full overflow-hidden bg-white/15">
                        <div className="tv-progress-indeterminate h-full bg-[#38BDF8]" />
                      </div>
                    </div>
                  )}

                  {/* Compositor-only bright 3px accent focus ring */}
                  <span
                    aria-hidden="true"
                    className={`tv-focus-ring pointer-events-none absolute inset-0 z-30 rounded-[1.125rem] border-[3px] border-[#38BDF8] ${
                      isFocused ? 'tv-focus-ring-active' : ''
                    }`}
                  />
                </div>

                {/* App name under every card; brighter + subtitle on focus */}
                <div className="mt-4 min-h-[3.5rem] px-0.5">
                  <div
                    className={`truncate text-[1.25rem] leading-snug font-semibold transition-opacity duration-150 ${
                      isFocused
                        ? 'text-[#FFFFFF] opacity-100'
                        : 'text-[#CBD5E1] opacity-70'
                    }`}
                  >
                    {item.name}
                  </div>
                  {showSubtitles && item.subtitle && (
                    <div
                      className={`tv-card-caption mt-0.5 truncate text-[1rem] leading-snug font-normal text-[#94A3B8] ${
                        isFocused ? 'tv-card-caption-visible' : ''
                      }`}
                    >
                      {item.subtitle}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
