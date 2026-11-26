import {
  ArrowLeft,
  ArrowRight,
  EyeOff,
  Loader2,
  Play,
  Trash2,
  XCircle,
} from 'lucide-react';
import { STORE_CARD_ID, type RowItem } from '../mock';
import { buildCardGradient, buildIconTileSurface } from '../utils/color';

export type CardMenuActionId =
  | 'open'
  | 'close'
  | 'move_left'
  | 'move_right'
  | 'hide'
  | 'uninstall';

export interface CardMenuAction {
  id: CardMenuActionId;
  label: string;
  armedLabel?: string;
  tone?: 'default' | 'danger';
}

export function buildCardMenuActions(
  card: RowItem,
  isOpenApp: boolean,
  canUninstall: boolean
): CardMenuAction[] {
  if (card.kind === 'media' || card.id === STORE_CARD_ID) {
    return [{ id: 'open', label: 'Open' }];
  }

  const actions: CardMenuAction[] = [];

  if (isOpenApp) {
    actions.push({ id: 'close', label: 'Close' });
  }

  actions.push(
    { id: 'move_left', label: 'Move left' },
    { id: 'move_right', label: 'Move right' },
    { id: 'hide', label: 'Hide from home' }
  );

  if (canUninstall) {
    actions.push({
      id: 'uninstall',
      label: 'Uninstall',
      armedLabel: 'Press again to uninstall',
      tone: 'danger',
    });
  }

  return actions;
}

interface CardMenuModalProps {
  card: RowItem;
  actions: CardMenuAction[];
  focusedIndex: number;
  uninstallArmed: boolean;
  busyAction: CardMenuActionId | null;
  onFocusIndex: (index: number) => void;
  onSelectAction: (action: CardMenuActionId) => void;
  onClose: () => void;
}

function ActionIcon({
  actionId,
  busy,
}: {
  actionId: CardMenuActionId;
  busy: boolean;
}) {
  if (busy) {
    return (
      <Loader2
        className="h-[1.35rem] w-[1.35rem] shrink-0 animate-spin"
        strokeWidth={2}
      />
    );
  }

  switch (actionId) {
    case 'open':
      return <Play className="h-[1.35rem] w-[1.35rem] shrink-0" strokeWidth={2} />;
    case 'close':
      return (
        <XCircle className="h-[1.35rem] w-[1.35rem] shrink-0" strokeWidth={2} />
      );
    case 'move_left':
      return (
        <ArrowLeft className="h-[1.35rem] w-[1.35rem] shrink-0" strokeWidth={2} />
      );
    case 'move_right':
      return (
        <ArrowRight
          className="h-[1.35rem] w-[1.35rem] shrink-0"
          strokeWidth={2}
        />
      );
    case 'hide':
      return (
        <EyeOff className="h-[1.35rem] w-[1.35rem] shrink-0" strokeWidth={2} />
      );
    case 'uninstall':
      return (
        <Trash2 className="h-[1.35rem] w-[1.35rem] shrink-0" strokeWidth={2} />
      );
  }
}

export function CardMenuModal({
  card,
  actions,
  focusedIndex,
  uninstallArmed,
  busyAction,
  onFocusIndex,
  onSelectAction,
  onClose,
}: CardMenuModalProps) {
  const hasIcon = Boolean(card.icon) && card.kind !== 'media';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${card.name} options`}
      className="fixed inset-0 z-50 flex items-center justify-center p-8"
    >
      {/* Solid dark scrim (zero backdrop-filter for Intel UHD 630 60fps) */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-[#04060B]/80"
      />

      <div className="relative z-10 w-full max-w-[30rem] overflow-hidden rounded-[1.5rem] border border-white/15 bg-[#10141E] p-7 text-[#F1F5F9]">
        {/* Header with card preview */}
        <div className="mb-6 flex items-center gap-4 border-b border-white/10 pb-5">
          <div
            className="flex h-[4.25rem] w-[6.5rem] shrink-0 items-center justify-center overflow-hidden rounded-[0.875rem] border border-white/15"
            style={{
              background: hasIcon
                ? buildIconTileSurface(card.color)
                : buildCardGradient(card.color),
            }}
          >
            {card.kind === 'media' && card.backdrop ? (
              <img
                src={card.backdrop}
                alt=""
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            ) : hasIcon ? (
              <img
                src={card.icon}
                alt=""
                referrerPolicy="no-referrer"
                className="h-[2.6rem] w-[2.6rem] object-contain"
              />
            ) : (
              <span className="truncate px-2 font-display text-[1rem] font-bold text-white">
                {card.name}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-[1.6rem] leading-tight font-bold tracking-[-0.02em] text-[#FFFFFF]">
              {card.name}
            </h2>
            {card.subtitle && (
              <p className="mt-1 truncate text-[1rem] text-[#94A3B8]">
                {card.subtitle}
              </p>
            )}
          </div>
        </div>

        {/* Action List */}
        <div className="space-y-2.5">
          {actions.map((action, index) => {
            const isFocused = focusedIndex === index;
            const isArmed = action.id === 'uninstall' && uninstallArmed;
            const isBusy = busyAction === action.id;
            const isDanger = action.tone === 'danger';

            return (
              <button
                key={action.id}
                type="button"
                aria-current={isFocused ? 'true' : undefined}
                disabled={busyAction !== null}
                onMouseEnter={() => onFocusIndex(index)}
                onFocus={() => onFocusIndex(index)}
                onClick={() => onSelectAction(action.id)}
                className={`tv-card relative flex w-full items-center gap-4 rounded-[0.95rem] border px-5 py-4 text-left text-[1.2rem] font-semibold focus:outline-none ${
                  isArmed
                    ? 'border-[#F87171]/60 bg-[#3B1722] text-[#FECACA]'
                    : isFocused
                      ? isDanger
                        ? 'border-white/20 bg-[#221822] text-[#FCA5A5]'
                        : 'border-white/25 bg-[#1C2434] text-[#FFFFFF]'
                      : isDanger
                        ? 'border-white/10 bg-[#151A25] text-[#FCA5A5]/90'
                        : 'border-white/10 bg-[#151A25] text-[#E2E8F0]'
                } ${isFocused ? 'tv-btn-focused' : ''}`}
              >
                <ActionIcon actionId={action.id} busy={isBusy} />
                <span className="flex-1 truncate">
                  {isArmed && action.armedLabel
                    ? action.armedLabel
                    : action.label}
                </span>
                <span
                  aria-hidden="true"
                  className={`tv-focus-ring pointer-events-none absolute -inset-[3px] rounded-[1.05rem] border-[3px] ${
                    isArmed ? 'border-[#F87171]' : 'border-[#38BDF8]'
                  } ${isFocused ? 'tv-focus-ring-active' : ''}`}
                />
              </button>
            );
          })}
        </div>

        <p className="mt-5 text-center text-[0.9rem] text-[#64748B]">
          Up / Down to choose · Enter / A to select · Back to close
        </p>
      </div>
    </div>
  );
}
