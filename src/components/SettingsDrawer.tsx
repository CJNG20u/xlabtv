import {
  ChevronRight,
  LogOut,
  Moon,
  Power,
  RotateCw,
  Smartphone,
  X,
} from 'lucide-react';
import type { PowerAction } from '../api';

export interface LauncherSettings {
  use24HourClock: boolean;
  autoAdvanceHero: boolean;
  showSubtitles: boolean;
  showNavHints: boolean;
}

export const POWER_OPTIONS: {
  action: PowerAction;
  label: string;
  confirmLabel: string;
  description: string;
}[] = [
  {
    action: 'suspend',
    label: 'Sleep',
    confirmLabel: 'Press again to sleep',
    description: 'Suspend HTPC to low-power standby',
  },
  {
    action: 'reboot',
    label: 'Restart',
    confirmLabel: 'Press again to restart',
    description: 'Reboot Linux system cleanly',
  },
  {
    action: 'poweroff',
    label: 'Shut down',
    confirmLabel: 'Press again to shut down',
    description: 'Power off the machine completely',
  },
  {
    action: 'exit',
    label: 'Exit to desktop',
    confirmLabel: 'Press again to exit to desktop',
    description: 'Leave xLab TV and return to desktop',
  },
];

interface SettingsDrawerProps {
  isOpen: boolean;
  focusedIndex: number;
  armedPowerAction: PowerAction | null;
  pendingPowerAction: PowerAction | null;
  settings: LauncherSettings;
  onFocusIndex: (index: number) => void;
  onOpenPhoneRemote: () => void;
  onTriggerPower: (action: PowerAction) => void;
  onUpdateSettings: (patch: Partial<LauncherSettings>) => void;
  onClose: () => void;
}

export function SettingsDrawer({
  isOpen,
  focusedIndex,
  armedPowerAction,
  pendingPowerAction,
  settings,
  onFocusIndex,
  onOpenPhoneRemote,
  onTriggerPower,
  onUpdateSettings,
  onClose,
}: SettingsDrawerProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-drawer-title"
      className="fixed inset-0 z-40 flex justify-end bg-[#06080D]/80"
      onClick={onClose}
    >
      <aside
        className="flex h-full w-full max-w-[36rem] flex-col overflow-y-auto border-l border-white/12 bg-[#10141D] px-9 py-8"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-5">
          <h2
            id="settings-drawer-title"
            className="font-display text-[1.875rem] font-bold tracking-[-0.02em] text-[#F8FAFC]"
          >
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="flex h-[2.75rem] w-[2.75rem] items-center justify-center rounded-full border border-white/15 bg-[#171C28] text-[#CBD5E1] hover:text-white focus:outline-none"
          >
            <X className="h-[1.3rem] w-[1.3rem]" />
          </button>
        </div>

        {/* Phone remote (index 0) */}
        <div className="mt-5">
          <h3 className="mb-2.5 text-[1rem] font-semibold text-[#94A3B8]">
            Remote
          </h3>
          <button
            type="button"
            onClick={() => {
              onFocusIndex(0);
              onOpenPhoneRemote();
            }}
            onMouseEnter={() => onFocusIndex(0)}
            onFocus={() => onFocusIndex(0)}
            className={`tv-card relative flex w-full items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[#151A25] px-5 py-3.5 text-left focus:outline-none ${
              focusedIndex === 0 ? 'tv-btn-focused' : ''
            }`}
          >
            <div className="flex items-center gap-4">
              <span className="flex h-[2.625rem] w-[2.625rem] shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[#1C2332] text-[#38BDF8]">
                <Smartphone className="h-[1.25rem] w-[1.25rem]" />
              </span>
              <div>
                <div className="text-[1.1875rem] font-semibold leading-snug text-[#F8FAFC]">
                  Phone remote
                </div>
                <div className="mt-0.5 text-[0.9rem] text-[#94A3B8]">
                  Pair a phone to control xLab TV
                </div>
              </div>
            </div>
            <ChevronRight
              className="h-[1.3rem] w-[1.3rem] shrink-0 text-[#94A3B8]"
              aria-hidden="true"
            />
            <span
              aria-hidden="true"
              className={`tv-focus-ring pointer-events-none absolute -inset-[3px] rounded-[1.125rem] border-[3px] border-[#38BDF8] ${
                focusedIndex === 0 ? 'tv-focus-ring-active' : ''
              }`}
            />
          </button>
        </div>

        {/* Power & Session Actions (indices 1, 2, 3, 4) with two-press confirmation */}
        <div className="mt-5 border-t border-white/10 pt-5">
          <h3 className="mb-2.5 text-[1rem] font-semibold text-[#94A3B8]">
            Power & Session
          </h3>
          <div className="space-y-2.5">
            {POWER_OPTIONS.map((opt, idx) => {
              const itemIndex = idx + 1;
              const isFocused = focusedIndex === itemIndex;
              const isArmed = armedPowerAction === opt.action;
              const isPending = pendingPowerAction === opt.action;

              const Icon =
                opt.action === 'suspend'
                  ? Moon
                  : opt.action === 'reboot'
                    ? RotateCw
                    : opt.action === 'poweroff'
                      ? Power
                      : LogOut;

              return (
                <button
                  key={opt.action}
                  type="button"
                  disabled={pendingPowerAction !== null}
                  onClick={() => {
                    onFocusIndex(itemIndex);
                    onTriggerPower(opt.action);
                  }}
                  onMouseEnter={() => onFocusIndex(itemIndex)}
                  onFocus={() => onFocusIndex(itemIndex)}
                  className={`tv-card relative flex w-full items-center justify-between gap-4 rounded-2xl border px-5 py-3 text-left focus:outline-none disabled:opacity-60 ${
                    isArmed
                      ? 'border-amber-400/70 bg-[#241B12]'
                      : 'border-white/10 bg-[#151A25]'
                  } ${isFocused ? 'tv-btn-focused' : ''}`}
                >
                  <div className="flex items-center gap-4">
                    <span
                      className={`flex h-[2.5rem] w-[2.5rem] shrink-0 items-center justify-center rounded-xl border ${
                        isArmed
                          ? 'border-amber-400/60 bg-amber-400/15 text-amber-300'
                          : 'border-white/10 bg-[#1C2332] text-[#E2E8F0]'
                      }`}
                    >
                      <Icon className="h-[1.2rem] w-[1.2rem]" />
                    </span>
                    <div>
                      <div
                        className={`text-[1.15rem] font-semibold leading-snug ${
                          isArmed ? 'text-amber-200' : 'text-[#F8FAFC]'
                        }`}
                      >
                        {isPending
                          ? `${opt.label}…`
                          : isArmed
                            ? opt.confirmLabel
                            : opt.label}
                      </div>
                      <div className="mt-0.5 text-[0.875rem] text-[#94A3B8]">
                        {isArmed
                          ? 'Press Enter / A again to confirm'
                          : opt.description}
                      </div>
                    </div>
                  </div>

                  <span
                    aria-hidden="true"
                    className={`tv-focus-ring pointer-events-none absolute -inset-[3px] rounded-[1.125rem] border-[3px] ${
                      isArmed ? 'border-amber-300' : 'border-[#38BDF8]'
                    } ${isFocused ? 'tv-focus-ring-active' : ''}`}
                  />
                </button>
              );
            })}
          </div>
        </div>

        {/* Display & Launcher Preferences (indices 5, 6, 7, 8) */}
        <div className="mt-5 border-t border-white/10 pt-5">
          <h3 className="mb-2.5 text-[1rem] font-semibold text-[#94A3B8]">
            Display
          </h3>
          <div className="space-y-2.5">
            <SettingToggleRow
              label="24-Hour Clock"
              description="Display time in 24-hour format"
              checked={settings.use24HourClock}
              isFocused={focusedIndex === 5}
              onFocus={() => onFocusIndex(5)}
              onToggle={() =>
                onUpdateSettings({ use24HourClock: !settings.use24HourClock })
              }
            />

            <SettingToggleRow
              label="Hero Auto-Advance"
              description="Cycle featured backdrops automatically"
              checked={settings.autoAdvanceHero}
              isFocused={focusedIndex === 6}
              onFocus={() => onFocusIndex(6)}
              onToggle={() =>
                onUpdateSettings({
                  autoAdvanceHero: !settings.autoAdvanceHero,
                })
              }
            />

            <SettingToggleRow
              label="Card Subtitles"
              description="Show secondary details below focused tiles"
              checked={settings.showSubtitles}
              isFocused={focusedIndex === 7}
              onFocus={() => onFocusIndex(7)}
              onToggle={() =>
                onUpdateSettings({ showSubtitles: !settings.showSubtitles })
              }
            />

            <SettingToggleRow
              label="Navigation Hints"
              description="Show keyboard and gamepad hints at bottom"
              checked={settings.showNavHints}
              isFocused={focusedIndex === 8}
              onFocus={() => onFocusIndex(8)}
              onToggle={() =>
                onUpdateSettings({ showNavHints: !settings.showNavHints })
              }
            />
          </div>
        </div>
      </aside>
    </div>
  );
}

interface SettingToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  isFocused: boolean;
  onFocus: () => void;
  onToggle: () => void;
}

function SettingToggleRow({
  label,
  description,
  checked,
  isFocused,
  onFocus,
  onToggle,
}: SettingToggleRowProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      onMouseEnter={onFocus}
      onFocus={onFocus}
      className={`tv-card relative flex w-full items-center justify-between gap-5 rounded-2xl border border-white/10 bg-[#151A25] px-5 py-3 text-left focus:outline-none ${
        isFocused ? 'tv-btn-focused' : ''
      }`}
    >
      <div>
        <div className="text-[1.1rem] font-semibold leading-snug text-[#F8FAFC]">
          {label}
        </div>
        <div className="mt-0.5 text-[0.875rem] text-[#94A3B8]">{description}</div>
      </div>

      <span
        aria-hidden="true"
        className={`relative flex h-[1.8rem] w-[3.3rem] shrink-0 items-center rounded-full border p-1 ${
          checked
            ? 'border-[#38BDF8] bg-[#38BDF8]'
            : 'border-white/20 bg-[#0B0E14]'
        }`}
      >
        <span
          className={`h-[1.2rem] w-[1.2rem] rounded-full transition-transform duration-150 ${
            checked
              ? 'translate-x-[1.45rem] bg-[#090B10]'
              : 'translate-x-0 bg-[#94A3B8]'
          }`}
        />
      </span>

      <span
        aria-hidden="true"
        className={`tv-focus-ring pointer-events-none absolute -inset-[3px] rounded-[1.125rem] border-[3px] border-[#38BDF8] ${
          isFocused ? 'tv-focus-ring-active' : ''
        }`}
      />
    </button>
  );
}
