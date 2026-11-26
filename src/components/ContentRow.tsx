import { useEffect, useRef, useState } from 'react';
import type { ContentRow as ContentRowData, RowItem } from '../mock';
import { buildCardGradient, buildIconTileSurface } from '../utils/color';

interface ContentRowProps {
  row: ContentRowData;
  rowIndex: number;
  isRowFocused: boolean;
  focusedColIndex: number;
  showSubtitles: boolean;
  onFocusCard: (rowIndex: number, colIndex: number) => void;
  onOpenCard: (item: RowItem, rowTitle: string) => void;
}

const CARD_WIDTH_REM = 19.25;
const CARD_GAP_REM = 2.0;
const CARD_STEP_REM = CARD_WIDTH_REM + CARD_GAP_REM;
const VISIBLE_SLOTS = 5;

export function ContentRow({
  row,
  rowIndex,
  isRowFocused,
  focusedColIndex,
  showSubtitles,
  onFocusCard,
  onOpenCard,
}: ContentRowProps) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [scrollIndex, setScrollIndex] = useState(0);
  const [failedIcons, setFailedIcons] = useState<Record<string, boolean>>({});

  const maxScrollIndex = Math.max(0, row.items.length - VISIBLE_SLOTS);

  // Smoothly keep the focused card inside the visible horizontal window
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

  // Smoothly scroll the active row into the vertical viewport
  useEffect(() => {
    if (isRowFocused && sectionRef.current) {
      sectionRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [isRowFocused]);

  if (row.items.length === 0) {
    return null;
  }

  const translateRem = scrollIndex * CARD_STEP_REM;

  return (
    <section
      ref={sectionRef}
      aria-label={row.title}
      className="relative scroll-my-20"
    >
      {/* Row Header */}
      <div className="mb-2 px-16">
        <h2
          className={`font-display text-[1.625rem] leading-tight font-semibold tracking-[-0.015em] transition-opacity duration-150 ${
            isRowFocused
              ? 'text-[#FFFFFF] opacity-100'
              : 'text-[#CBD5E1] opacity-80'
          }`}
        >
          {row.title}
        </h2>
      </div>

      {/* Horizontal GPU-composited track with generous vertical headroom for scale(1.08) */}
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

            return (
              <button
                key={item.id}
                type="button"
                aria-current={isFocused ? 'true' : undefined}
                onClick={() => {
                  onFocusCard(rowIndex, colIndex);
                  onOpenCard(item, row.title);
                }}
                onMouseEnter={() => onFocusCard(rowIndex, colIndex)}
                onFocus={() => onFocusCard(rowIndex, colIndex)}
                className={`group w-[19.25rem] shrink-0 text-left focus:outline-none ${
                  isFocused ? 'relative z-20' : 'relative z-10'
                }`}
              >
                {/* Rounded 16:9 TV Card Surface — scales to 1.08 with bright 3px accent ring */}
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
                  {/* Subtle geometric specular top edge (pure linear gradient, zero blur) */}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background:
                        'linear-gradient(160deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0) 42%, rgba(0, 0, 0, 0.24) 100%)',
                    }}
                  />

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

                  {/* Compositor-only bright 3px accent focus ring */}
                  <span
                    aria-hidden="true"
                    className={`tv-focus-ring pointer-events-none absolute inset-0 z-20 rounded-[1.125rem] border-[3px] border-[#38BDF8] ${
                      isFocused ? 'tv-focus-ring-active' : ''
                    }`}
                  />
                </div>

                {/* App name visible under every card; brighter + subtitle revealed when focused */}
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
