import { useEffect, useState } from 'react';
import { Settings, ShoppingBag } from 'lucide-react';

export type TopBarButton = 'store' | 'settings';

interface TopBarProps {
  use24HourClock: boolean;
  focusedButton: TopBarButton | null;
  updateCount?: number;
  onFocusStore: () => void;
  onOpenStore: () => void;
  onFocusSettings: () => void;
  onOpenSettings: () => void;
}

function formatClock(date: Date, use24Hour: boolean): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: use24Hour ? '2-digit' : 'numeric',
    minute: '2-digit',
    hour12: !use24Hour,
  }).format(date);
}

function getGreeting(date: Date): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) {
    return 'Good morning';
  }
  if (hour >= 12 && hour < 18) {
    return 'Good afternoon';
  }
  return 'Good evening';
}

export function TopBar({
  use24HourClock,
  focusedButton,
  updateCount = 0,
  onFocusStore,
  onOpenStore,
  onFocusSettings,
  onOpenSettings,
}: TopBarProps) {
  const [clockState, setClockState] = useState<{
    timeText: string;
    greeting: string;
  }>(() => {
    const now = new Date();
    return {
      timeText: formatClock(now, use24HourClock),
      greeting: getGreeting(now),
    };
  });

  useEffect(() => {
    const syncClockAndGreeting = () => {
      const now = new Date();
      const nextTime = formatClock(now, use24HourClock);
      const nextGreeting = getGreeting(now);
      setClockState((prev) =>
        prev.timeText === nextTime && prev.greeting === nextGreeting
          ? prev
          : { timeText: nextTime, greeting: nextGreeting }
      );
    };

    syncClockAndGreeting();

    // Align to the next exact minute boundary, then update every minute
    let intervalId: number | null = null;
    const msUntilNextMinute = 60000 - (Date.now() % 60000);
    const timeoutId = window.setTimeout(() => {
      syncClockAndGreeting();
      intervalId = window.setInterval(syncClockAndGreeting, 60000);
    }, msUntilNextMinute);

    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [use24HourClock]);

  const isStoreFocused = focusedButton === 'store';
  const isSettingsFocused = focusedButton === 'settings';

  return (
    <header
      className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between px-16 pt-8 pb-12"
      style={{
        background:
          'linear-gradient(180deg, rgba(9, 11, 16, 0.84) 0%, rgba(9, 11, 16, 0.36) 55%, rgba(9, 11, 16, 0) 100%)',
      }}
    >
      {/* Left: Small xLab TV logo icon + time-based greeting */}
      <div className="pointer-events-auto flex items-center gap-3.5 select-none">
        <svg
          width="36"
          height="36"
          viewBox="0 0 36 36"
          fill="none"
          aria-hidden="true"
          className="h-[2.25rem] w-[2.25rem] shrink-0"
        >
          <rect
            x="2"
            y="2"
            width="32"
            height="32"
            rx="9"
            fill="#141924"
            stroke="#F8FAFC"
            strokeOpacity="0.22"
            strokeWidth="2"
          />
          <path
            d="M11.5 11.5L24.5 24.5M24.5 11.5L11.5 24.5"
            stroke="#F8FAFC"
            strokeWidth="3.2"
            strokeLinecap="round"
          />
          <circle cx="24.5" cy="11.5" r="2.2" fill="#38BDF8" />
        </svg>
        <span className="font-display text-[1.875rem] leading-none font-semibold tracking-[-0.025em] text-[#F8FAFC] whitespace-nowrap shrink-0">
          {clockState.greeting}
        </span>
      </div>

      {/* Right: Live Clock + Store Button + Settings Button */}
      <div className="pointer-events-auto flex items-center gap-5 shrink-0">
        <time
          aria-label="Current time"
          className="mr-1 font-display text-[1.75rem] leading-none font-medium tracking-[-0.015em] text-[#E2E8F0] tabular-nums whitespace-nowrap select-none"
        >
          {clockState.timeText}
        </time>

        <button
          type="button"
          onClick={onOpenStore}
          onMouseEnter={onFocusStore}
          onFocus={onFocusStore}
          aria-label="Open Store"
          aria-current={isStoreFocused ? 'true' : undefined}
          className={`tv-card relative flex h-[3.25rem] items-center gap-2.5 rounded-full border border-white/15 bg-[#151A24] px-5 text-[1.125rem] font-semibold text-[#E2E8F0] whitespace-nowrap focus:outline-none ${
            isStoreFocused ? 'tv-btn-focused text-white' : ''
          }`}
        >
          <ShoppingBag className="h-[1.35rem] w-[1.35rem]" strokeWidth={2} />
          <span>Store</span>
          <span
            aria-hidden="true"
            className={`tv-focus-ring pointer-events-none absolute -inset-[3px] rounded-full border-[3px] border-[#38BDF8] ${
              isStoreFocused ? 'tv-focus-ring-active' : ''
            }`}
          />
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          onMouseEnter={onFocusSettings}
          onFocus={onFocusSettings}
          aria-label={
            updateCount > 0
              ? `Open settings (${updateCount} ${updateCount === 1 ? 'update' : 'updates'} available)`
              : 'Open settings'
          }
          aria-current={isSettingsFocused ? 'true' : undefined}
          className={`tv-card relative flex h-[3.25rem] w-[3.25rem] items-center justify-center rounded-full border border-white/15 bg-[#151A24] text-[#E2E8F0] focus:outline-none ${
            isSettingsFocused ? 'tv-btn-focused text-white' : ''
          }`}
        >
          <Settings className="h-[1.5rem] w-[1.5rem]" strokeWidth={2} />
          {updateCount > 0 && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -top-1.5 -right-1.5 z-10 flex h-[1.55rem] min-w-[1.55rem] items-center justify-center rounded-full border-2 border-[#090B10] bg-[#38BDF8] px-1 text-[0.8125rem] leading-none font-bold text-[#06080D] tabular-nums"
            >
              {updateCount > 99 ? '99+' : updateCount}
            </span>
          )}
          <span
            aria-hidden="true"
            className={`tv-focus-ring pointer-events-none absolute -inset-[3px] rounded-full border-[3px] border-[#38BDF8] ${
              isSettingsFocused ? 'tv-focus-ring-active' : ''
            }`}
          />
        </button>
      </div>
    </header>
  );
}
