import { RefreshCw, Tv } from 'lucide-react';

interface EmptyErrorStateProps {
  title: string;
  description: string;
  retrying: boolean;
  isRetryFocused: boolean;
  onFocusRetry: () => void;
  onRetry: () => void;
}

export function EmptyErrorState({
  title,
  description,
  retrying,
  isRetryFocused,
  onFocusRetry,
  onRetry,
}: EmptyErrorStateProps) {
  return (
    <section
      aria-live="polite"
      className="flex min-h-screen w-full flex-col items-center justify-center px-16 text-center"
    >
      <div className="flex h-[5.5rem] w-[5.5rem] items-center justify-center rounded-3xl border border-white/12 bg-[#131823] text-[#94A3B8]">
        <Tv className="h-[2.75rem] w-[2.75rem]" strokeWidth={1.75} />
      </div>

      <h1
        className="mt-8 font-display text-[3rem] leading-tight font-bold tracking-[-0.025em] text-[#F8FAFC]"
        style={{ textWrap: 'balance' }}
      >
        {title}
      </h1>

      <p className="mt-4 max-w-[40rem] text-[1.375rem] leading-relaxed text-[#94A3B8]">
        {description}
      </p>

      <button
        type="button"
        disabled={retrying}
        onClick={onRetry}
        onMouseEnter={onFocusRetry}
        onFocus={onFocusRetry}
        aria-current={isRetryFocused ? 'true' : undefined}
        className={`tv-card relative mt-10 inline-flex items-center gap-3 rounded-xl bg-[#F8FAFC] px-9 py-4 font-sans text-[1.25rem] leading-none font-semibold text-[#090B10] whitespace-nowrap focus:outline-none disabled:opacity-75 ${
          isRetryFocused ? 'tv-btn-focused' : ''
        }`}
      >
        <RefreshCw
          className={`h-[1.35rem] w-[1.35rem] ${retrying ? 'animate-spin' : ''}`}
          aria-hidden="true"
        />
        <span>{retrying ? 'Retrying…' : 'Retry'}</span>
        <span
          aria-hidden="true"
          className={`tv-focus-ring pointer-events-none absolute -inset-[5px] rounded-[1rem] border-[3px] border-[#38BDF8] ${
            isRetryFocused ? 'tv-focus-ring-active' : ''
          }`}
        />
      </button>
    </section>
  );
}
