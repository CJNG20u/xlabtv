import { useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import type { HeroItem } from '../mock';

interface HeroBannerProps {
  items: HeroItem[];
  activeIndex: number;
  isHeroFocused: boolean;
  overrideBackdrop?: string | null;
  backdropPool: string[];
  appNameById: Record<string, string>;
  onFocusHero: () => void;
  onOpenHero: (item: HeroItem) => void;
}

export function HeroBanner({
  items,
  activeIndex,
  isHeroFocused,
  overrideBackdrop,
  backdropPool,
  appNameById,
  onFocusHero,
  onOpenHero,
}: HeroBannerProps) {
  const [failedUrls, setFailedUrls] = useState<Record<string, boolean>>({});
  const activeItem = items[activeIndex] ?? items[0];

  const allBackdrops = useMemo(() => {
    const unique = new Set<string>();
    for (const item of items) {
      if (item.backdrop) unique.add(item.backdrop);
    }
    for (const url of backdropPool) {
      if (url) unique.add(url);
    }
    if (overrideBackdrop) unique.add(overrideBackdrop);
    return Array.from(unique);
  }, [items, backdropPool, overrideBackdrop]);

  if (!activeItem) {
    return null;
  }

  const activeBackdropUrl = overrideBackdrop || activeItem.backdrop;
  const resolvedAppName = appNameById[activeItem.appId] ?? activeItem.appId;

  return (
    <section
      aria-label="Featured showcase"
      className="relative h-[55vh] min-h-[34rem] w-full overflow-hidden bg-[#090B10]"
    >
      {/* Full-bleed pre-mounted backdrop layers crossfading via opacity + transform only */}
      {allBackdrops.map((url) => {
        const isActive = url === activeBackdropUrl;
        const hasFailed = Boolean(failedUrls[url]);

        return (
          <div
            key={url}
            aria-hidden={!isActive}
            className={`tv-hero-backdrop absolute inset-0 ${
              isActive
                ? 'z-0 opacity-100 scale-100'
                : 'z-0 pointer-events-none opacity-0 scale-[1.03]'
            }`}
          >
            {!hasFailed ? (
              <img
                src={url}
                alt={isActive ? activeItem.title : ''}
                referrerPolicy="no-referrer"
                decoding="async"
                onError={() =>
                  setFailedUrls((prev) => ({ ...prev, [url]: true }))
                }
                className="h-full w-full object-cover object-center"
              />
            ) : (
              <div
                className="h-full w-full"
                style={{
                  background:
                    'linear-gradient(135deg, #1E293B 0%, #0F172A 55%, #090B10 100%)',
                }}
              />
            )}
          </div>
        );
      })}

      {/* Left-to-right readability scrim (pure CSS gradient, no backdrop-filter) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            'linear-gradient(90deg, #090B10 0%, rgba(9, 11, 16, 0.88) 26%, rgba(9, 11, 16, 0.42) 54%, rgba(9, 11, 16, 0.08) 100%)',
        }}
      />

      {/* Seamless floor fade into dark canvas */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[48%]"
        style={{
          background:
            'linear-gradient(0deg, #090B10 0%, rgba(9, 11, 16, 0.78) 38%, rgba(9, 11, 16, 0) 100%)',
        }}
      />

      {/* Foreground hero content anchored in 10-foot lower-left safe zone */}
      <div className="relative z-20 flex h-full flex-col justify-end px-16 pb-12">
        <div className="flex items-end justify-between gap-12">
          <div className="max-w-[52rem]">
            <p className="text-[1.125rem] font-medium tracking-[0.01em] text-[#94A3B8]">
              Featured in {resolvedAppName}
            </p>

            <h1
              className="mt-2 font-display text-[3.875rem] leading-[1.05] font-bold tracking-[-0.025em] text-[#F8FAFC]"
              style={{ textWrap: 'balance' }}
            >
              {activeItem.title}
            </h1>

            <p className="mt-3.5 max-w-[44rem] text-[1.4375rem] leading-[1.45] font-normal text-[#CBD5E1]">
              {activeItem.subtitle}
            </p>

            <div className="mt-7 flex items-center gap-5">
              <button
                type="button"
                onClick={() => onOpenHero(activeItem)}
                onMouseEnter={onFocusHero}
                onFocus={onFocusHero}
                aria-current={isHeroFocused ? 'true' : undefined}
                className={`tv-card relative inline-flex items-center gap-3 rounded-xl bg-[#F8FAFC] px-9 py-4 font-sans text-[1.25rem] leading-none font-semibold text-[#090B10] whitespace-nowrap shrink-0 focus:outline-none ${
                  isHeroFocused ? 'tv-btn-focused' : ''
                }`}
              >
                <Play className="h-[1.35rem] w-[1.35rem] fill-current" />
                <span>Open</span>
                <span
                  aria-hidden="true"
                  className={`tv-focus-ring pointer-events-none absolute -inset-[5px] rounded-[1rem] border-[3px] border-[#38BDF8] ${
                    isHeroFocused ? 'tv-focus-ring-active' : ''
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Non-interactive hero position dots */}
          {items.length > 1 && (
            <div
              aria-hidden="true"
              className="pointer-events-none flex items-center gap-2.5 pb-2 shrink-0"
            >
              {items.map((slide, index) => {
                const active = index === activeIndex;
                return (
                  <span
                    key={slide.id}
                    className={`block h-[0.5rem] rounded-full transition-opacity duration-200 ${
                      active
                        ? 'w-[1.75rem] bg-[#38BDF8] opacity-100'
                        : 'w-[0.5rem] bg-[#94A3B8] opacity-40'
                    }`}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
