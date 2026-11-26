import { useEffect, useMemo, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import type { HeroItem } from '../mock';

interface HeroBannerProps {
  items: HeroItem[];
  activeIndex: number;
  isHeroFocused: boolean;
  overrideBackdrop?: string | null;
  appNameById: Record<string, string>;
  onFocusHero: () => void;
  onOpenHero: (item: HeroItem) => void;
}

function clampProgress(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(1, Math.max(0, value));
}

function HeroBackdropImage({
  src,
  alt,
  isActive,
  onError,
}: {
  src: string;
  alt: string;
  isActive: boolean;
  onError: () => void;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setLoaded(true);
    } else {
      setLoaded(false);
    }
  }, [src]);

  return (
    <img
      ref={imgRef}
      src={src}
      alt={alt}
      loading={isActive ? 'eager' : 'lazy'}
      referrerPolicy="no-referrer"
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={onError}
      className={`h-full w-full object-cover object-center transition-opacity duration-300 ${
        loaded ? 'opacity-100' : 'opacity-0'
      }`}
    />
  );
}

export function HeroBanner({
  items,
  activeIndex,
  isHeroFocused,
  overrideBackdrop,
  appNameById,
  onFocusHero,
  onOpenHero,
}: HeroBannerProps) {
  const [failedUrls, setFailedUrls] = useState<Record<string, boolean>>({});
  const [loadedLogos, setLoadedLogos] = useState<Record<string, boolean>>({});
  const [failedLogos, setFailedLogos] = useState<Record<string, boolean>>({});
  const [previousOverride, setPreviousOverride] = useState<string | null>(null);

  const prevOverrideRef = useRef<string | null>(null);
  const logoImgRef = useRef<HTMLImageElement | null>(null);

  const activeItem = items[activeIndex] ?? items[0];
  const logoUrl =
    activeItem?.kind === 'media' ? activeItem.logo?.trim() ?? '' : '';

  // Keep previous override backdrop mounted briefly so crossfading between row items stays smooth
  useEffect(() => {
    const next = overrideBackdrop?.trim() || null;
    if (prevOverrideRef.current !== next) {
      setPreviousOverride(prevOverrideRef.current);
      prevOverrideRef.current = next;
    }
  }, [overrideBackdrop]);

  // Handle cached hero logo images immediately on mount/slide change
  useEffect(() => {
    if (!logoUrl) {
      return;
    }
    const img = logoImgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setLoadedLogos((prev) => (prev[logoUrl] ? prev : { ...prev, [logoUrl]: true }));
    }
  }, [logoUrl]);

  // Mount hero backdrops + active/previous override only (avoids eagerly fetching remote row URLs)
  const mountedBackdrops = useMemo(() => {
    const unique = new Set<string>();
    for (const item of items) {
      if (item.backdrop) unique.add(item.backdrop);
    }
    if (previousOverride) unique.add(previousOverride);
    if (overrideBackdrop) unique.add(overrideBackdrop);
    return Array.from(unique);
  }, [items, previousOverride, overrideBackdrop]);

  if (!activeItem) {
    return null;
  }

  const activeBackdropUrl = overrideBackdrop || activeItem.backdrop;
  const resolvedAppName = appNameById[activeItem.appId] ?? activeItem.appId;
  const isMediaHero = activeItem.kind === 'media';
  const eyebrowText =
    activeItem.eyebrow?.trim() ||
    (!isMediaHero && resolvedAppName ? `Featured in ${resolvedAppName}` : '');
  const progress = isMediaHero ? clampProgress(activeItem.progress) : null;
  const canTryLogo = Boolean(logoUrl) && !failedLogos[logoUrl];
  const isLogoLoaded = canTryLogo && Boolean(loadedLogos[logoUrl]);

  return (
    <section
      aria-label="Featured showcase"
      className="relative h-[55vh] min-h-[34rem] w-full overflow-hidden bg-[#090B10]"
    >
      {/* Full-bleed backdrop layers crossfading via opacity + transform only */}
      {mountedBackdrops.map((url) => {
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
            style={{
              background:
                'linear-gradient(135deg, #1E293B 0%, #0F172A 55%, #090B10 100%)',
            }}
          >
            {!hasFailed && (
              <HeroBackdropImage
                src={url}
                alt={isActive ? activeItem.title : ''}
                isActive={isActive}
                onError={() =>
                  setFailedUrls((prev) => ({ ...prev, [url]: true }))
                }
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
            {eyebrowText && (
              <p className="text-[1.125rem] font-medium tracking-[0.01em] text-[#94A3B8]">
                {eyebrowText}
              </p>
            )}

            {/* Show logo image (~22% hero max-height, left aligned) once loaded; keep text title otherwise */}
            {canTryLogo && (
              <img
                ref={logoImgRef}
                key={logoUrl}
                src={logoUrl}
                alt={activeItem.title}
                referrerPolicy="no-referrer"
                decoding="async"
                onLoad={() =>
                  setLoadedLogos((prev) =>
                    prev[logoUrl] ? prev : { ...prev, [logoUrl]: true }
                  )
                }
                onError={() =>
                  setFailedLogos((prev) => ({ ...prev, [logoUrl]: true }))
                }
                className={
                  isLogoLoaded
                    ? 'mt-3 block max-h-[8rem] max-w-[34rem] w-auto object-contain object-left opacity-100 transition-opacity duration-300'
                    : 'pointer-events-none absolute h-0 w-0 opacity-0'
                }
              />
            )}

            {isLogoLoaded ? (
              <h1 className="sr-only">{activeItem.title}</h1>
            ) : (
              <h1
                className="mt-2 font-display text-[3.875rem] leading-[1.05] font-bold tracking-[-0.025em] text-[#F8FAFC]"
                style={{ textWrap: 'balance' }}
              >
                {activeItem.title}
              </h1>
            )}

            {activeItem.subtitle && (
              <p className="mt-3.5 max-w-[44rem] text-[1.4375rem] leading-[1.45] font-normal text-[#CBD5E1]">
                {activeItem.subtitle}
              </p>
            )}

            {/* Watch progress bar under subtitle for media hero items */}
            {progress !== null && (
              <div
                role="progressbar"
                aria-label="Watch progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
                className="mt-4 h-[0.3125rem] w-[22rem] max-w-full overflow-hidden rounded-full bg-white/20"
              >
                <div
                  className="h-full w-full bg-[#38BDF8]"
                  style={{
                    transform: `scaleX(${progress})`,
                    transformOrigin: 'left center',
                  }}
                />
              </div>
            )}

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
                <span>{isMediaHero ? 'Resume' : 'Open'}</span>
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
