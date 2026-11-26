import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  CornerDownLeft,
  Delete,
  Home,
  Keyboard,
  Menu,
  Moon,
  Play,
  Power,
  RotateCw,
  Send,
  Settings,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  clearRemoteToken,
  fetchRemoteApps,
  getStoredRemoteToken,
  launchRemoteApp,
  pairRemotePhone,
  sendRemoteKey,
  sendRemoteMouse,
  sendRemotePower,
  sendRemoteText,
  setRemoteUnauthorizedListener,
  type RemoteAppButtons,
  type RemoteAppItem,
  type RemoteKey,
  type RemoteMousePayload,
  type RemotePowerAction,
} from '../remoteApi';
import { buildCardGradient, buildIconTileSurface } from '../utils/color';
import { Touchpad } from './Touchpad';

type ControlTab = 'buttons' | 'touchpad';

interface MobileToast {
  id: number;
  text: string;
  tone: 'error' | 'info';
}

const REPEAT_INTERVAL_MS = 180;
const APPS_REFRESH_INTERVAL_MS = 10000;
const TOAST_DURATION_MS = 3800;

function hapticTap(): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(12);
    }
  } catch {
    // Ignore on devices without vibration support
  }
}

function detectDeviceName(): string {
  if (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)) {
    return 'Android phone';
  }
  return 'Phone';
}

function readPairCodeFromHash(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const match = window.location.hash.match(/(?:^#|&)pair=([0-9]{6})(?:&|$)/i);
  return match ? match[1] : null;
}

function clearUrlHash(): void {
  if (typeof window !== 'undefined' && window.location.hash) {
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}`
    );
  }
}

export function PhoneRemoteApp() {
  const [token, setToken] = useState<string>(() => getStoredRemoteToken());
  const [pairCode, setPairCode] = useState<string>('');
  const [pairing, setPairing] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<ControlTab>('buttons');
  const [keyboardOpen, setKeyboardOpen] = useState<boolean>(false);
  const [textInput, setTextInput] = useState<string>('');
  const [sendingText, setSendingText] = useState<boolean>(false);

  const [apps, setApps] = useState<RemoteAppItem[]>([]);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [appButtons, setAppButtons] = useState<RemoteAppButtons | null>(null);
  const [inputReady, setInputReady] = useState<boolean>(true);
  const [failedIcons, setFailedIcons] = useState<Record<string, boolean>>({});

  const [confirmPower, setConfirmPower] = useState<RemotePowerAction | null>(
    null
  );
  const [sendingPower, setSendingPower] = useState<boolean>(false);
  const [toast, setToast] = useState<MobileToast | null>(null);

  const toastTimerRef = useRef<number | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const repeatTimerRef = useRef<number | null>(null);

  const showToast = useCallback(
    (text: string, tone: 'error' | 'info' = 'error') => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      setToast({ id: Date.now(), text, tone });
      toastTimerRef.current = window.setTimeout(() => {
        setToast(null);
        toastTimerRef.current = null;
      }, TOAST_DURATION_MS);
    },
    []
  );

  const stopHoldRepeat = useCallback(() => {
    if (repeatTimerRef.current !== null) {
      window.clearInterval(repeatTimerRef.current);
      repeatTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopHoldRepeat();
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, [stopHoldRepeat]);

  // Register global 401 handler so any unauthorized API response returns to Pairing screen
  useEffect(() => {
    setRemoteUnauthorizedListener(() => {
      stopHoldRepeat();
      setToken('');
      setConfirmPower(null);
      setKeyboardOpen(false);
    });
    return () => setRemoteUnauthorizedListener(null);
  }, [stopHoldRepeat]);

  const handleApiError = useCallback(
    (
      result: { ok: true } | { ok: false; error: string; unauthorized?: boolean }
    ) => {
      if (!result.ok && !result.unauthorized) {
        showToast(result.error, 'error');
      }
    },
    [showToast]
  );

  const submitPair = useCallback(
    async (rawCode: string) => {
      const cleaned = rawCode.replace(/\D/g, '').slice(0, 6);
      if (cleaned.length !== 6) {
        showToast('Enter the 6-digit code shown on your TV.', 'error');
        return;
      }

      setPairing(true);
      const result = await pairRemotePhone(cleaned, detectDeviceName());
      setPairing(false);

      if (!result.ok) {
        showToast(result.error, 'error');
        return;
      }

      setPairCode('');
      setToken(result.data.token);
      showToast('Paired with xLab TV', 'info');
    },
    [showToast]
  );

  // Auto-pair when URL hash contains #pair=123456, then clear the hash
  useEffect(() => {
    const checkHashPair = () => {
      const code = readPairCodeFromHash();
      if (code) {
        clearUrlHash();
        setPairCode(code);
        void submitPair(code);
      }
    };

    checkHashPair();
    window.addEventListener('hashchange', checkHashPair);
    return () => window.removeEventListener('hashchange', checkHashPair);
  }, [submitPair]);

  const refreshApps = useCallback(
    async (signal?: AbortSignal, silentError = false) => {
      try {
        const result = await fetchRemoteApps(signal);
        if (signal?.aborted) {
          return;
        }
        if (!result.ok) {
          if (!silentError) {
            handleApiError(result);
          }
          return;
        }
        setApps(result.data.apps);
        setRunningId(result.data.running);
        setAppButtons(result.data.appButtons);
        setInputReady(result.data.input);
      } catch {
        // Aborted
      }
    },
    [handleApiError]
  );

  // Load apps and refresh every 10 seconds while paired
  useEffect(() => {
    if (!token) {
      return;
    }

    const controller = new AbortController();
    void refreshApps(controller.signal, false);

    const intervalId = window.setInterval(() => {
      void refreshApps(undefined, true);
    }, APPS_REFRESH_INTERVAL_MS);

    return () => {
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [token, refreshApps]);

  // Focus text input when Keyboard drawer opens
  useEffect(() => {
    if (keyboardOpen) {
      window.setTimeout(() => textInputRef.current?.focus(), 40);
    }
  }, [keyboardOpen]);

  const fireKey = useCallback(
    (key: RemoteKey) => {
      hapticTap();
      void sendRemoteKey(key).then((result) => {
        handleApiError(result);
        if (result.ok && key === 'home') {
          void refreshApps(undefined, true);
          window.setTimeout(() => {
            void refreshApps(undefined, true);
          }, 600);
        }
      });
    },
    [handleApiError, refreshApps]
  );

  const startHoldKey = useCallback(
    (key: RemoteKey, event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Ignore if pointer capture unavailable
      }
      stopHoldRepeat();
      fireKey(key);
      repeatTimerRef.current = window.setInterval(() => {
        fireKey(key);
      }, REPEAT_INTERVAL_MS);
    },
    [fireKey, stopHoldRepeat]
  );

  const handleSendMouse = useCallback(
    (payload: RemoteMousePayload) => {
      void sendRemoteMouse(payload).then(handleApiError);
    },
    [handleApiError]
  );

  const handleSendText = useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault();
      if (!textInput.trim() || sendingText) {
        return;
      }
      hapticTap();
      setSendingText(true);
      const result = await sendRemoteText(textInput);
      setSendingText(false);
      if (!result.ok) {
        handleApiError(result);
        return;
      }
      setTextInput('');
    },
    [textInput, sendingText, handleApiError]
  );

  const handleLaunchApp = useCallback(
    async (app: RemoteAppItem) => {
      hapticTap();
      const result = await launchRemoteApp(app.id);
      if (!result.ok) {
        handleApiError(result);
        return;
      }
      setRunningId(app.id);
      void refreshApps(undefined, true);
      window.setTimeout(() => {
        void refreshApps(undefined, true);
      }, 1200);
    },
    [handleApiError, refreshApps]
  );

  const handleConfirmPower = useCallback(async () => {
    if (!confirmPower || sendingPower) {
      return;
    }
    hapticTap();
    const action = confirmPower;
    setSendingPower(true);
    const result = await sendRemotePower(action);
    setSendingPower(false);
    setConfirmPower(null);

    if (!result.ok) {
      handleApiError(result);
      return;
    }

    const messages: Record<RemotePowerAction, string> = {
      suspend: 'Putting TV to sleep…',
      reboot: 'Restarting TV…',
      poweroff: 'Turning off TV…',
    };
    showToast(messages[action], 'info');
  }, [confirmPower, sendingPower, handleApiError, showToast]);

  const nowPlayingName = useMemo(() => {
    if (!runningId) {
      return null;
    }
    return apps.find((a) => a.id === runningId)?.name ?? runningId;
  }, [runningId, apps]);

  const frontAppMeta = useMemo(() => {
    if (!appButtons) {
      return null;
    }
    return apps.find((a) => a.id === appButtons.app) ?? null;
  }, [appButtons, apps]);

  // 1. PAIRING SCREEN
  if (!token) {
    return (
      <div className="min-h-screen w-full bg-[#090B10] px-5 py-8 text-[#F1F5F9]">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-[440px] flex-col justify-center">
          <div className="rounded-3xl border border-white/10 bg-[#11151F] p-7">
            <div className="flex items-center gap-3">
              <RemoteLogoMark />
              <div>
                <h1 className="font-display text-2xl font-bold tracking-tight text-[#F8FAFC]">
                  xLab Remote
                </h1>
                <p className="text-sm text-[#94A3B8]">Pair with your TV</p>
              </div>
            </div>

            <p className="mt-6 text-sm leading-relaxed text-[#CBD5E1]">
              Open <span className="font-semibold text-white">Settings</span> →{' '}
              <span className="font-semibold text-white">Phone remote</span> on
              your TV and enter the 6-digit code.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                hapticTap();
                void submitPair(pairCode);
              }}
              className="mt-6 space-y-4"
            >
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                value={pairCode}
                onChange={(e) =>
                  setPairCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                aria-label="6-digit pairing code"
                className="h-16 w-full rounded-2xl border border-white/15 bg-[#090B10] px-4 text-center font-display text-3xl font-bold tracking-[0.28em] text-[#F8FAFC] tabular-nums placeholder:text-[#334155] focus:border-[#38BDF8] focus:outline-none"
              />

              <button
                type="submit"
                disabled={pairing || pairCode.length !== 6}
                className="flex h-14 w-full items-center justify-center rounded-2xl bg-[#F8FAFC] text-base font-semibold text-[#090B10] transition-transform duration-100 active:scale-[0.98] disabled:opacity-45"
              >
                {pairing ? 'Pairing…' : 'Pair'}
              </button>
            </form>
          </div>
        </div>

        <RemoteToast toast={toast} />
      </div>
    );
  }

  // 2. REMOTE SCREEN
  return (
    <div className="min-h-screen w-full bg-[#090B10] px-4 pt-4 pb-8 text-[#F1F5F9]">
      <div className="mx-auto flex w-full max-w-[440px] flex-col gap-4">
        {/* Top bar & Now Playing */}
        <header className="flex items-center justify-between px-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <RemoteLogoMark />
            <div className="min-w-0">
              <div className="font-display text-lg leading-tight font-bold tracking-tight text-[#F8FAFC]">
                xLab Remote
              </div>
              {nowPlayingName && (
                <p className="truncate text-xs font-medium text-[#38BDF8]">
                  Now playing: {nowPlayingName}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              hapticTap();
              clearRemoteToken();
              setToken('');
            }}
            className="min-h-[40px] rounded-xl border border-white/10 bg-[#141925] px-3 text-xs font-medium text-[#94A3B8] active:scale-[0.97]"
          >
            Unpair
          </button>
        </header>

        {/* Input Warning Banner */}
        {!inputReady && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-2xl border border-amber-400/50 bg-[#241B12] px-4 py-3 text-xs leading-snug font-medium text-amber-200"
          >
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-300"
              aria-hidden="true"
            />
            <span>
              The TV can&apos;t receive key presses yet: log out and back in on
              the TV
            </span>
          </div>
        )}

        {/* Segmented Tabs: Buttons | Touchpad */}
        <div
          role="tablist"
          aria-label="Control mode"
          className="grid grid-cols-2 gap-1.5 rounded-2xl border border-white/10 bg-[#11151F] p-1.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'buttons'}
            onClick={() => {
              hapticTap();
              setActiveTab('buttons');
            }}
            className={`min-h-[44px] rounded-xl text-sm font-semibold transition-colors ${
              activeTab === 'buttons'
                ? 'bg-[#20283A] text-[#F8FAFC]'
                : 'text-[#94A3B8]'
            }`}
          >
            Buttons
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'touchpad'}
            onClick={() => {
              hapticTap();
              setActiveTab('touchpad');
            }}
            className={`min-h-[44px] rounded-xl text-sm font-semibold transition-colors ${
              activeTab === 'touchpad'
                ? 'bg-[#20283A] text-[#F8FAFC]'
                : 'text-[#94A3B8]'
            }`}
          >
            Touchpad
          </button>
        </div>

        {/* D-Pad OR Touchpad (identical area height) */}
        {activeTab === 'buttons' ? (
          <div className="flex h-[268px] w-full items-center justify-center rounded-3xl border border-white/10 bg-[#11151F]">
            <div className="relative h-[236px] w-[236px] rounded-full border border-white/12 bg-[#161C29]">
              {/* UP */}
              <button
                type="button"
                aria-label="Up"
                onPointerDown={(e) => startHoldKey('up', e)}
                onPointerUp={stopHoldRepeat}
                onPointerCancel={stopHoldRepeat}
                onContextMenu={(e) => e.preventDefault()}
                className="absolute top-1.5 left-1/2 flex h-[68px] w-[86px] -translate-x-1/2 touch-none select-none items-center justify-center rounded-t-full text-[#E2E8F0] active:scale-95 active:text-[#38BDF8]"
              >
                <ArrowUp className="h-7 w-7" strokeWidth={2.2} />
              </button>

              {/* DOWN */}
              <button
                type="button"
                aria-label="Down"
                onPointerDown={(e) => startHoldKey('down', e)}
                onPointerUp={stopHoldRepeat}
                onPointerCancel={stopHoldRepeat}
                onContextMenu={(e) => e.preventDefault()}
                className="absolute bottom-1.5 left-1/2 flex h-[68px] w-[86px] -translate-x-1/2 touch-none select-none items-center justify-center rounded-b-full text-[#E2E8F0] active:scale-95 active:text-[#38BDF8]"
              >
                <ArrowDown className="h-7 w-7" strokeWidth={2.2} />
              </button>

              {/* LEFT */}
              <button
                type="button"
                aria-label="Left"
                onPointerDown={(e) => startHoldKey('left', e)}
                onPointerUp={stopHoldRepeat}
                onPointerCancel={stopHoldRepeat}
                onContextMenu={(e) => e.preventDefault()}
                className="absolute top-1/2 left-1.5 flex h-[86px] w-[68px] -translate-y-1/2 touch-none select-none items-center justify-center rounded-l-full text-[#E2E8F0] active:scale-95 active:text-[#38BDF8]"
              >
                <ArrowLeft className="h-7 w-7" strokeWidth={2.2} />
              </button>

              {/* RIGHT */}
              <button
                type="button"
                aria-label="Right"
                onPointerDown={(e) => startHoldKey('right', e)}
                onPointerUp={stopHoldRepeat}
                onPointerCancel={stopHoldRepeat}
                onContextMenu={(e) => e.preventDefault()}
                className="absolute top-1/2 right-1.5 flex h-[86px] w-[68px] -translate-y-1/2 touch-none select-none items-center justify-center rounded-r-full text-[#E2E8F0] active:scale-95 active:text-[#38BDF8]"
              >
                <ArrowRight className="h-7 w-7" strokeWidth={2.2} />
              </button>

              {/* OK Center Button */}
              <button
                type="button"
                aria-label="OK"
                onClick={() => fireKey('ok')}
                className="absolute top-1/2 left-1/2 flex h-[88px] w-[88px] -translate-x-1/2 -translate-y-1/2 touch-none select-none items-center justify-center rounded-full border border-white/15 bg-[#232D42] font-display text-lg font-bold tracking-wide text-[#F8FAFC] active:scale-95 active:bg-[#38BDF8] active:text-[#090B10]"
              >
                OK
              </button>
            </div>
          </div>
        ) : (
          <Touchpad onSendMouse={handleSendMouse} onHaptic={hapticTap} />
        )}

        {/* Row: Back, Home, Play/Pause */}
        <div className="grid grid-cols-3 gap-2.5">
          <RemoteActionButton
            label="Back"
            icon={<ArrowLeft className="h-5 w-5" />}
            onClick={() => fireKey('back')}
          />
          <RemoteActionButton
            label="Home"
            icon={<Home className="h-5 w-5" />}
            onClick={() => fireKey('home')}
          />
          <RemoteActionButton
            label="Play/Pause"
            icon={<Play className="h-5 w-5" />}
            onClick={() => fireKey('playpause')}
          />
        </div>

        {/* Row: Volume down, Mute, Volume up */}
        <div className="grid grid-cols-3 gap-2.5">
          <button
            type="button"
            aria-label="Volume down"
            onPointerDown={(e) => startHoldKey('voldown', e)}
            onPointerUp={stopHoldRepeat}
            onPointerCancel={stopHoldRepeat}
            onContextMenu={(e) => e.preventDefault()}
            className="flex min-h-[56px] touch-none select-none flex-col items-center justify-center gap-1 rounded-2xl border border-white/10 bg-[#141925] text-[#E2E8F0] active:scale-[0.97] active:bg-[#1E2638]"
          >
            <Volume1 className="h-5 w-5" />
            <span className="text-xs font-medium text-[#94A3B8]">Vol -</span>
          </button>

          <RemoteActionButton
            label="Mute"
            icon={<VolumeX className="h-5 w-5" />}
            onClick={() => fireKey('mute')}
          />

          <button
            type="button"
            aria-label="Volume up"
            onPointerDown={(e) => startHoldKey('volup', e)}
            onPointerUp={stopHoldRepeat}
            onPointerCancel={stopHoldRepeat}
            onContextMenu={(e) => e.preventDefault()}
            className="flex min-h-[56px] touch-none select-none flex-col items-center justify-center gap-1 rounded-2xl border border-white/10 bg-[#141925] text-[#E2E8F0] active:scale-[0.97] active:bg-[#1E2638]"
          >
            <Volume2 className="h-5 w-5" />
            <span className="text-xs font-medium text-[#94A3B8]">Vol +</span>
          </button>
        </div>

        {/* Front App Shortcut Buttons (between volume row and keyboard button) */}
        {appButtons && appButtons.groups.length > 0 && (
          <section
            aria-label={`${appButtons.name} controls`}
            className="space-y-3.5 rounded-2xl border border-white/10 bg-[#11151F] p-3.5"
          >
            {/* App header with icon from apps grid + app name */}
            <div className="flex items-center gap-2.5 px-0.5">
              {(() => {
                const iconUrl = frontAppMeta?.icon ?? '';
                const hasIcon =
                  Boolean(iconUrl) && !failedIcons[appButtons.app];
                const tileColor = frontAppMeta?.color ?? '#334155';

                return (
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/15"
                    style={{
                      background: hasIcon
                        ? buildIconTileSurface(tileColor)
                        : buildCardGradient(tileColor),
                    }}
                  >
                    {hasIcon ? (
                      <img
                        src={iconUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                        decoding="async"
                        onError={() =>
                          setFailedIcons((prev) => ({
                            ...prev,
                            [appButtons.app]: true,
                          }))
                        }
                        className="h-5 w-5 object-contain"
                      />
                    ) : (
                      <span className="font-display text-xs leading-none font-bold text-white">
                        {appButtons.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </div>
                );
              })()}
              <h2 className="truncate font-display text-sm font-bold tracking-tight text-[#F8FAFC]">
                {appButtons.name}
              </h2>
            </div>

            {/* Button groups */}
            <div className="space-y-3.5">
              {appButtons.groups.map((group) => (
                <div key={group.title} className="space-y-2">
                  <h3 className="px-0.5 text-[11px] font-semibold tracking-[0.08em] text-[#94A3B8] uppercase">
                    {group.title}
                  </h3>
                  <div className="grid grid-cols-3 gap-2">
                    {group.buttons.map((btn, idx) => {
                      const lowerLabel = btn.label.trim().toLowerCase();
                      const ButtonIcon =
                        lowerLabel === 'menu'
                          ? Menu
                          : lowerLabel === 'settings'
                            ? Settings
                            : null;

                      return (
                        <button
                          key={`${group.title}-${btn.label}-${btn.key}-${idx}`}
                          type="button"
                          onClick={() => fireKey(btn.key)}
                          className="flex min-h-[52px] touch-none select-none flex-col items-center justify-center rounded-[26px] border border-white/10 bg-[#171D2B] px-2.5 py-2 text-center text-[#F1F5F9] active:scale-[0.97] active:border-[#38BDF8]/50 active:bg-[#222B3E]"
                        >
                          <span className="flex max-w-full items-center justify-center gap-1.5 text-[13px] leading-tight font-semibold">
                            {ButtonIcon && (
                              <ButtonIcon
                                className="h-3.5 w-3.5 shrink-0 text-[#38BDF8]"
                                strokeWidth={2.2}
                                aria-hidden="true"
                              />
                            )}
                            <span className="truncate">{btn.label}</span>
                          </span>
                          {btn.hint && (
                            <span className="mt-0.5 line-clamp-2 w-full text-[10px] leading-tight font-normal text-[#94A3B8]">
                              {btn.hint}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Keyboard Toggle & Text Input Drawer */}
        <div className="rounded-2xl border border-white/10 bg-[#11151F] p-2.5">
          <button
            type="button"
            onClick={() => {
              hapticTap();
              setKeyboardOpen((prev) => !prev);
            }}
            aria-expanded={keyboardOpen}
            className="flex min-h-[48px] w-full items-center justify-between rounded-xl px-3 text-sm font-semibold text-[#F8FAFC] active:bg-[#1A2131]"
          >
            <span className="flex items-center gap-2.5">
              <Keyboard className="h-5 w-5 text-[#38BDF8]" />
              <span>Keyboard</span>
            </span>
            {keyboardOpen ? (
              <X className="h-4 w-4 text-[#94A3B8]" />
            ) : (
              <span className="text-xs font-normal text-[#64748B]">
                Type on TV
              </span>
            )}
          </button>

          {keyboardOpen && (
            <div className="mt-2.5 space-y-2.5 border-t border-white/10 pt-2.5">
              <form onSubmit={handleSendText} className="flex gap-2">
                <input
                  ref={textInputRef}
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="Type text to send to TV…"
                  className="h-12 min-w-0 flex-1 rounded-xl border border-white/12 bg-[#090B10] px-3.5 text-sm text-[#F8FAFC] placeholder:text-[#64748B] focus:border-[#38BDF8] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={sendingText || !textInput.trim()}
                  className="flex h-12 shrink-0 items-center gap-1.5 rounded-xl bg-[#F8FAFC] px-4 text-sm font-semibold text-[#090B10] active:scale-[0.97] disabled:opacity-45"
                >
                  <Send className="h-4 w-4" />
                  <span>Send</span>
                </button>
              </form>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onPointerDown={(e) => startHoldKey('backspace', e)}
                  onPointerUp={stopHoldRepeat}
                  onPointerCancel={stopHoldRepeat}
                  onContextMenu={(e) => e.preventDefault()}
                  className="flex min-h-[48px] touch-none select-none items-center justify-center gap-2 rounded-xl border border-white/10 bg-[#171D2B] text-sm font-medium text-[#E2E8F0] active:scale-[0.97] active:bg-[#222B3E]"
                >
                  <Delete className="h-4 w-4" />
                  <span>Delete</span>
                </button>

                <button
                  type="button"
                  onClick={() => fireKey('ok')}
                  className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-white/10 bg-[#171D2B] text-sm font-medium text-[#E2E8F0] active:scale-[0.97] active:bg-[#222B3E]"
                >
                  <CornerDownLeft className="h-4 w-4" />
                  <span>Enter</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Apps Grid (4 columns) */}
        <section aria-label="Apps" className="pt-1">
          <div className="mb-2.5 flex items-center justify-between px-1">
            <h2 className="font-display text-sm font-semibold text-[#94A3B8]">
              Apps
            </h2>
            {apps.length > 0 && (
              <span className="text-xs text-[#64748B] tabular-nums">
                {apps.length}
              </span>
            )}
          </div>

          {apps.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-[#11151F] px-4 py-6 text-center text-sm text-[#64748B]">
              No TV apps found yet
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2.5">
              {apps.map((app) => {
                const hasIcon = Boolean(app.icon) && !failedIcons[app.id];
                const isRunning = runningId === app.id;

                return (
                  <button
                    key={app.id}
                    type="button"
                    onClick={() => void handleLaunchApp(app)}
                    className="flex flex-col items-center text-center focus:outline-none active:scale-95"
                  >
                    <div
                      className={`relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl border ${
                        isRunning
                          ? 'border-[#38BDF8] ring-2 ring-[#38BDF8]/40'
                          : 'border-white/12'
                      }`}
                      style={{
                        background: hasIcon
                          ? buildIconTileSurface(app.color)
                          : buildCardGradient(app.color),
                      }}
                    >
                      {hasIcon ? (
                        <img
                          src={app.icon}
                          alt={app.name}
                          referrerPolicy="no-referrer"
                          decoding="async"
                          onError={() =>
                            setFailedIcons((prev) => ({
                              ...prev,
                              [app.id]: true,
                            }))
                          }
                          className="h-11 w-11 object-contain"
                        />
                      ) : (
                        <span
                          className="px-1.5 font-display text-xs leading-tight font-bold text-white"
                          style={{ textWrap: 'balance' }}
                        >
                          {app.name}
                        </span>
                      )}
                    </div>
                    <span
                      className={`mt-1.5 w-full truncate text-[11px] font-medium ${
                        isRunning ? 'text-[#38BDF8]' : 'text-[#CBD5E1]'
                      }`}
                    >
                      {app.name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Power Controls with Confirmation */}
        <section aria-label="TV Power" className="border-t border-white/10 pt-4">
          {confirmPower ? (
            <div className="rounded-2xl border border-amber-400/50 bg-[#211912] p-3.5">
              <p className="text-center text-sm font-semibold text-amber-200">
                {confirmPower === 'suspend'
                  ? 'Put the TV to sleep?'
                  : confirmPower === 'reboot'
                    ? 'Restart the TV?'
                    : 'Turn off the TV?'}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={sendingPower}
                  onClick={() => {
                    hapticTap();
                    setConfirmPower(null);
                  }}
                  className="min-h-[46px] rounded-xl border border-white/15 bg-[#151A25] text-sm font-medium text-[#E2E8F0] active:scale-[0.98]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={sendingPower}
                  onClick={() => void handleConfirmPower()}
                  className="min-h-[46px] rounded-xl bg-amber-300 text-sm font-semibold text-[#090B10] active:scale-[0.98] disabled:opacity-60"
                >
                  {sendingPower
                    ? 'Sending…'
                    : confirmPower === 'suspend'
                      ? 'Sleep'
                      : confirmPower === 'reboot'
                        ? 'Restart'
                        : 'Power off'}
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2.5">
              <RemoteActionButton
                label="Sleep"
                icon={<Moon className="h-5 w-5" />}
                onClick={() => {
                  hapticTap();
                  setConfirmPower('suspend');
                }}
              />
              <RemoteActionButton
                label="Restart"
                icon={<RotateCw className="h-5 w-5" />}
                onClick={() => {
                  hapticTap();
                  setConfirmPower('reboot');
                }}
              />
              <RemoteActionButton
                label="Off"
                icon={<Power className="h-5 w-5 text-rose-300" />}
                onClick={() => {
                  hapticTap();
                  setConfirmPower('poweroff');
                }}
              />
            </div>
          )}
        </section>
      </div>

      <RemoteToast toast={toast} />
    </div>
  );
}

interface RemoteActionButtonProps {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}

function RemoteActionButton({ label, icon, onClick }: RemoteActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[56px] touch-none select-none flex-col items-center justify-center gap-1 rounded-2xl border border-white/10 bg-[#141925] text-[#E2E8F0] active:scale-[0.97] active:bg-[#1E2638]"
    >
      {icon}
      <span className="text-xs font-medium text-[#94A3B8]">{label}</span>
    </button>
  );
}

function RemoteLogoMark() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 36 36"
      fill="none"
      aria-hidden="true"
      className="h-8 w-8 shrink-0"
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
  );
}

function RemoteToast({ toast }: { toast: MobileToast | null }) {
  if (!toast) {
    return null;
  }

  const isError = toast.tone === 'error';

  return (
    <div
      role="status"
      aria-live={isError ? 'assertive' : 'polite'}
      className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4"
    >
      <div
        className={`flex w-full max-w-[412px] items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm font-medium text-[#F8FAFC] ${
          isError
            ? 'border-rose-400/60 bg-[#221219]'
            : 'border-[#38BDF8]/55 bg-[#111826]'
        }`}
      >
        {isError ? (
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
        ) : (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-[#38BDF8]" />
        )}
        <span className="leading-snug">{toast.text}</span>
      </div>
    </div>
  );
}
