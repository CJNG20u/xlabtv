import { useEffect, useState } from 'react';
import type { HeroItem } from '../mock';

interface AmbientScreensaverProps {
  active: boolean;
  items: HeroItem[];
  use24HourClock: boolean;
  onWake: () => void;
}

const SLIDE_INTERVAL_MS = 14000;

function formatScreensaverTime(date: Date, use24Hour: boolean): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: use24Hour ? '2-digit' : 'numeric',
    minute: '2-digit',
    hour12: !use24Hour,
  }).format(date);
}

function formatScreensaverDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

export function AmbientScreensaver({
  active,
  items,
  use24HourClock,
  onWake,
}: AmbientScreensaverProps) {
  const [slideIndex, setSlideIndex] = useState(0);
  const [now, setNow] = useState(() => new Date());

  const validSlides = items.filter((item) => Boolean(item.backdrop));

  // Slow crossfade between hero backdrops while screensaver is active
  useEffect(() => {
    if (!active || validSlides.length <= 1) {
      return;
    }

    const timer = window.setInterval(() => {
      setSlideIndex((prev) => (prev + 1) % validSlides.length);
    }, SLIDE_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [active, validSlides.length]);

  // Keep large ambient clock ticking cleanly while active
  useEffect(() => {
    if (!active) {
      return;
    }

    setNow(new Date());
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [active]);

  const timeText = formatScreensaverTime(now, use24HourClock);
  const dateText = formatScreensaverDate(now);
  const safeIndex = validSlides.length > 0 ? slideIndex % validSlides.length : 0;

  return (
    <div
      aria-hidden={!active}
      onClick={active ? onWake : undefined}
      className={`tv-screensaver-fade fixed inset-0 z-50 overflow-hidden bg-[#050609] ${
        active ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
    >
      {/* Slow crossfading hero backdrops (compositor-only opacity + transform) */}
      {validSlides.map((slide, idx) => {
        const isCurrent = idx === safeIndex;
        return (
          <div
            key={slide.id}
            className={`tv-screensaver-backdrop absolute inset-0 ${
              isCurrent ? 'opacity-85 scale-100' : 'opacity-0 scale-[1.04]'
            }`}
          >
            <img
              src={slide.backdrop}
              alt=""
              referrerPolicy="no-referrer"
              decoding="async"
              className="h-full w-full object-cover object-center"
            />
          </div>
        );
      })}

      {/* Soft cinema scrim for high-contrast clock legibility */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(0deg, rgba(5, 6, 9, 0.88) 0%, rgba(5, 6, 9, 0.34) 42%, rgba(5, 6, 9, 0.25) 100%)',
        }}
      />

      {/* Large Living-Room Clock & Date */}
      <div className="relative z-10 flex h-full flex-col justify-end p-16">
        <div className="flex items-end justify-between gap-12">
          <div>
            <time className="block font-display text-[6.75rem] leading-none font-semibold tracking-[-0.03em] text-[#F8FAFC] tabular-nums">
              {timeText}
            </time>
            <p className="mt-3 text-[1.75rem] font-normal text-[#CBD5E1]">
              {dateText}
            </p>
          </div>

          <span className="pb-2 font-display text-[1.5rem] font-semibold tracking-[-0.02em] text-[#94A3B8]/80">
            xLab TV
          </span>
        </div>
      </div>
    </div>
  );
}
