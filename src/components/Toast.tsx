import { AlertCircle, CheckCircle2 } from 'lucide-react';

export interface ToastMessage {
  id: number;
  text: string;
  tone: 'error' | 'info';
}

interface ToastProps {
  toast: ToastMessage | null;
}

export function Toast({ toast }: ToastProps) {
  if (!toast) {
    return null;
  }

  const isError = toast.tone === 'error';

  return (
    <div
      role="status"
      aria-live={isError ? 'assertive' : 'polite'}
      className="pointer-events-none fixed inset-x-0 bottom-10 z-50 flex justify-center px-16"
    >
      <div
        className={`flex max-w-[46rem] items-center gap-3.5 rounded-2xl border px-7 py-4 text-[1.2rem] font-medium text-[#F8FAFC] ${
          isError
            ? 'border-rose-400/60 bg-[#1F1218]'
            : 'border-[#38BDF8]/55 bg-[#111824]'
        }`}
      >
        {isError ? (
          <AlertCircle
            className="h-[1.5rem] w-[1.5rem] shrink-0 text-rose-400"
            aria-hidden="true"
          />
        ) : (
          <CheckCircle2
            className="h-[1.5rem] w-[1.5rem] shrink-0 text-[#38BDF8]"
            aria-hidden="true"
          />
        )}
        <span className="leading-snug">{toast.text}</span>
      </div>
    </div>
  );
}
