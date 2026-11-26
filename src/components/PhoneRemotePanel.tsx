import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, Smartphone, Trash2 } from 'lucide-react';
import QRCode from 'qrcode';
import type { RemotePairingInfo } from '../api';

interface PhoneRemotePanelProps {
  isOpen: boolean;
  info: RemotePairingInfo | null;
  loading: boolean;
  error: string | null;
  secondsLeft: number;
  forgetArmed: boolean;
  forgetting: boolean;
  onTriggerPrimary: () => void;
  onClose: () => void;
}

function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatCodeDigits(code: string): string {
  const clean = code.replace(/\s+/g, '');
  if (clean.length === 6) {
    return `${clean.slice(0, 3)} ${clean.slice(3)}`;
  }
  return clean;
}

export function PhoneRemotePanel({
  isOpen,
  info,
  loading,
  error,
  secondsLeft,
  forgetArmed,
  forgetting,
  onTriggerPrimary,
  onClose,
}: PhoneRemotePanelProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  useEffect(() => {
    if (!isOpen || !info?.pairUrl) {
      setQrDataUrl('');
      return;
    }

    let cancelled = false;
    QRCode.toDataURL(info.pairUrl, {
      width: 340,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#090B10',
        light: '#F8FAFC',
      },
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setQrDataUrl(dataUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrDataUrl('');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, info?.pairUrl]);

  if (!isOpen) {
    return null;
  }

  const deviceCount = info?.devices ?? 0;
  const deviceLabel =
    deviceCount === 1 ? '1 phone paired' : `${deviceCount} phones paired`;
  const displayUrl = info?.url || info?.pairUrl?.split('#')[0] || '';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="phone-remote-panel-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#06080D]/88 px-16"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[64rem] overflow-hidden rounded-3xl border border-white/12 bg-[#10141D] p-11"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-6">
          <div className="flex items-center gap-4">
            <span className="flex h-[3.25rem] w-[3.25rem] items-center justify-center rounded-2xl border border-white/12 bg-[#171D2B] text-[#38BDF8]">
              <Smartphone className="h-[1.65rem] w-[1.65rem]" strokeWidth={2} />
            </span>
            <div>
              <h2
                id="phone-remote-panel-title"
                className="font-display text-[2.25rem] leading-tight font-bold tracking-[-0.02em] text-[#F8FAFC]"
              >
                Phone remote
              </h2>
              {info && (
                <p className="mt-0.5 text-[1.125rem] text-[#94A3B8]">
                  {deviceLabel}
                </p>
              )}
            </div>
          </div>

          <span className="text-[1.05rem] text-[#64748B]">
            Esc / B to close
          </span>
        </div>

        {/* Warning when virtual input device cannot reach the TV */}
        {info?.inputError !== null && info?.inputError !== undefined && (
          <div
            role="alert"
            className="mt-6 flex items-center gap-4 rounded-2xl border border-amber-400/55 bg-[#241B12] px-6 py-4 text-[1.1875rem] font-medium text-amber-200"
          >
            <AlertTriangle
              className="h-[1.5rem] w-[1.5rem] shrink-0 text-amber-300"
              aria-hidden="true"
            />
            <span>Phone keys can&apos;t reach the TV: log out and back in</span>
          </div>
        )}

        {loading && !info ? (
          <div className="flex min-h-[22rem] flex-col items-center justify-center text-center">
            <Loader2
              className="h-[2.75rem] w-[2.75rem] animate-spin text-[#38BDF8]"
              aria-hidden="true"
            />
            <p className="mt-4 text-[1.25rem] text-[#CBD5E1]">
              Preparing pairing code…
            </p>
          </div>
        ) : error && !info ? (
          <div className="flex min-h-[22rem] flex-col items-center justify-center text-center">
            <p className="max-w-[36rem] text-[1.35rem] text-[#CBD5E1]">
              {error}
            </p>
            <button
              type="button"
              onClick={onTriggerPrimary}
              aria-current="true"
              className="tv-card tv-btn-focused relative mt-7 inline-flex items-center gap-3 rounded-xl bg-[#F8FAFC] px-8 py-4 text-[1.2rem] font-semibold text-[#090B10] focus:outline-none"
            >
              <RefreshCw className="h-[1.25rem] w-[1.25rem]" />
              <span>Retry</span>
              <span
                aria-hidden="true"
                className="tv-focus-ring tv-focus-ring-active pointer-events-none absolute -inset-[5px] rounded-[1rem] border-[3px] border-[#38BDF8]"
              />
            </button>
          </div>
        ) : info ? (
          <div className="mt-8 grid grid-cols-[auto_1fr] items-center gap-12">
            {/* Left: Large Local QR Code */}
            <div className="flex h-[20.5rem] w-[20.5rem] items-center justify-center rounded-2xl bg-[#F8FAFC] p-4">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={`QR code to pair phone at ${displayUrl}`}
                  className="h-full w-full object-contain"
                />
              ) : (
                <Loader2
                  className="h-[2.25rem] w-[2.25rem] animate-spin text-[#090B10]"
                  aria-hidden="true"
                />
              )}
            </div>

            {/* Right: Big 6-digit code, URL, countdown, and Forget button */}
            <div className="min-w-0">
              <p className="text-[1.125rem] font-medium text-[#94A3B8]">
                Scan the QR code or enter this code
              </p>

              <div className="mt-2 font-display text-[4.25rem] leading-none font-bold tracking-[0.14em] text-[#F8FAFC] tabular-nums">
                {formatCodeDigits(info.code)}
              </div>

              <p className="mt-4 text-[1.25rem] text-[#CBD5E1] break-all">
                Open on your phone:{' '}
                <span className="font-semibold text-[#F8FAFC]">
                  {displayUrl}
                </span>
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-3 text-[1.125rem] text-[#94A3B8] tabular-nums">
                <span>
                  {secondsLeft > 0
                    ? `Expires in ${formatCountdown(secondsLeft)}`
                    : 'Refreshing code…'}
                </span>
                <span aria-hidden="true">·</span>
                <span>{deviceLabel}</span>
              </div>

              {/* Forget all phones (confirmed with second press) */}
              <div className="mt-9">
                <button
                  type="button"
                  disabled={forgetting}
                  onClick={onTriggerPrimary}
                  aria-current="true"
                  className={`tv-card tv-btn-focused relative inline-flex items-center gap-3 rounded-xl border px-7 py-4 text-[1.1875rem] leading-none font-semibold whitespace-nowrap focus:outline-none disabled:opacity-60 ${
                    forgetArmed
                      ? 'border-amber-400/75 bg-[#241B12] text-amber-200'
                      : 'border-white/15 bg-[#171D2A] text-[#F8FAFC]'
                  }`}
                >
                  <Trash2 className="h-[1.25rem] w-[1.25rem]" strokeWidth={2} />
                  <span>
                    {forgetting
                      ? 'Forgetting…'
                      : forgetArmed
                        ? 'Press again to forget all phones'
                        : 'Forget all phones'}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`tv-focus-ring tv-focus-ring-active pointer-events-none absolute -inset-[5px] rounded-[1rem] border-[3px] ${
                      forgetArmed ? 'border-amber-300' : 'border-[#38BDF8]'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
