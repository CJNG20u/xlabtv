import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  fetchAppsWithStatus,
  fetchStatus,
  isAppsPayloadEmpty,
  launchApp,
  sendPowerAction,
  type PowerAction,
} from './api';
import { AmbientScreensaver } from './components/AmbientScreensaver';
import { ContentRow } from './components/ContentRow';
import { EmptyErrorState } from './components/EmptyErrorState';
import { HeroBanner } from './components/HeroBanner';
import {
  POWER_OPTIONS,
  SettingsDrawer,
  type LauncherSettings,
} from './components/SettingsDrawer';
import { Toast, type ToastMessage } from './components/Toast';
import { TopBar } from './components/TopBar';
import { useGamepadInput, type SpatialAction } from './hooks/useGamepadInput';
import { mockData, type HeroItem, type MockData, type RowItem } from './mock';

type FocusState =
  | { zone: 'topbar' }
  | { zone: 'hero' }
  | { zone: 'retry' }
  | { zone: 'row'; rowIndex: number; colIndex: number };

interface PendingLaunch {
  id: string;
  name: string;
}

const DEFAULT_SETTINGS: LauncherSettings = {
  use24HourClock: true,
  autoAdvanceHero: true,
  showSubtitles: true,
  showNavHints: true,
};

const SETTINGS_ITEM_COUNT = 8; // 0..3 Power & Session actions, 4..7 Display toggles
const STATUS_POLL_INTERVAL_MS = 2000;
const POWER_ARM_TIMEOUT_MS = 5000;
const TOAST_DURATION_MS = 4500;
const LAUNCH_TIMEOUT_MS = 20000;
const SCREENSAVER_IDLE_MS = 10 * 60 * 1000;
const PERSISTENT_API_FAILURE_THRESHOLD = 3;

export default function App() {
  const [launcherData, setLauncherData] = useState<MockData>(mockData);
  const [heroIndex, setHeroIndex] = useState<number>(0);
  // Focused element is active and visible immediately on load
  const [focus, setFocus] = useState<FocusState>({ zone: 'hero' });
  const [rowMemory, setRowMemory] = useState<Record<number, number>>({});

  // Tracks empty library or persistent backend failure state
  const [apiErrorMessage, setApiErrorMessage] = useState<string | null>(null);
  const [retryingApps, setRetryingApps] = useState<boolean>(false);

  const [settings, setSettings] = useState<LauncherSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [settingsFocusIndex, setSettingsFocusIndex] = useState<number>(0);
  const [armedPowerAction, setArmedPowerAction] = useState<PowerAction | null>(
    null
  );
  const [pendingPowerAction, setPendingPowerAction] =
    useState<PowerAction | null>(null);

  // Separate optimistic launch state (subject to 20s timeout) from backend-confirmed running state
  const [pendingLaunch, setPendingLaunch] = useState<PendingLaunch | null>(null);
  const [confirmedRunningId, setConfirmedRunningId] = useState<string | null>(
    null
  );
  const [launchingRequestId, setLaunchingRequestId] = useState<string | null>(
    null
  );

  const [screensaverActive, setScreensaverActive] = useState<boolean>(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const toastTimerRef = useRef<number | null>(null);
  const powerArmTimerRef = useRef<number | null>(null);
  const launchTimeoutRef = useRef<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);

  const lastLaunchedFocusRef = useRef<FocusState | null>(null);
  const prevConfirmedRunningRef = useRef<string | null>(null);
  const backendConnectedOnceRef = useRef<boolean>(false);
  const consecutiveStatusFailuresRef = useRef<number>(0);
  const consecutiveAppsFailuresRef = useRef<number>(0);

  const heroItems = launcherData.hero;
  const rows = useMemo(
    () => launcherData.rows.filter((row) => row.items.length > 0),
    [launcherData.rows]
  );

  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const activeOverlayId = confirmedRunningId ?? pendingLaunch?.id ?? null;
  const isLibraryEmpty = isAppsPayloadEmpty(launcherData);
  const showEmptyOrErrorScreen = apiErrorMessage !== null || isLibraryEmpty;

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

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      if (powerArmTimerRef.current !== null) {
        window.clearTimeout(powerArmTimerRef.current);
      }
      if (launchTimeoutRef.current !== null) {
        window.clearTimeout(launchTimeoutRef.current);
      }
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
      }
    };
  }, []);

  // Reset the 10-minute ambient screensaver inactivity timer
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
    }

    if (activeOverlayId !== null) {
      idleTimerRef.current = null;
      return;
    }

    idleTimerRef.current = window.setTimeout(() => {
      setScreensaverActive(true);
    }, SCREENSAVER_IDLE_MS);
  }, [activeOverlayId]);

  const wakeScreensaver = useCallback(() => {
    setScreensaverActive(false);
    resetIdleTimer();
  }, [resetIdleTimer]);

  // Keep idle timer synchronized when overlays open/close
  useEffect(() => {
    if (activeOverlayId !== null) {
      setScreensaverActive(false);
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      return;
    }
    resetIdleTimer();
  }, [activeOverlayId, resetIdleTimer]);

  // Also reset idle timer on pointer/wheel interaction
  useEffect(() => {
    const handlePointer = () => {
      if (screensaverActive) {
        wakeScreensaver();
      } else {
        resetIdleTimer();
      }
    };

    window.addEventListener('pointerdown', handlePointer);
    window.addEventListener('wheel', handlePointer, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', handlePointer);
      window.removeEventListener('wheel', handlePointer);
    };
  }, [screensaverActive, wakeScreensaver, resetIdleTimer]);

  // Load apps from GET /api/apps (dev mode falls back to mockData; empty or persistent failures show Retry screen)
  const loadApps = useCallback(
    async (options?: { isManualRetry?: boolean; signal?: AbortSignal }) => {
      const isManualRetry = Boolean(options?.isManualRetry);
      if (isManualRetry) {
        setRetryingApps(true);
      }

      try {
        const result = await fetchAppsWithStatus(options?.signal);
        if (options?.signal?.aborted) {
          return;
        }

        if (result.ok) {
          backendConnectedOnceRef.current = true;
          consecutiveAppsFailuresRef.current = 0;
          consecutiveStatusFailuresRef.current = 0;
          setApiErrorMessage(null);
          setLauncherData(result.data);
          setHeroIndex((prev) =>
            result.data.hero.length > 0
              ? Math.min(prev, result.data.hero.length - 1)
              : 0
          );

          if (isAppsPayloadEmpty(result.data)) {
            setFocus({ zone: 'retry' });
          } else {
            setFocus((curr) => {
              const nonEmptyRows = result.data.rows.filter(
                (row) => row.items.length > 0
              );
              if (curr.zone === 'retry') {
                return result.data.hero.length > 0
                  ? { zone: 'hero' }
                  : { zone: 'row', rowIndex: 0, colIndex: 0 };
              }
              if (curr.zone !== 'row') {
                return curr;
              }
              if (nonEmptyRows.length === 0) {
                return { zone: 'hero' };
              }
              const safeRow = Math.min(curr.rowIndex, nonEmptyRows.length - 1);
              const safeCol = Math.min(
                curr.colIndex,
                Math.max(0, nonEmptyRows[safeRow].items.length - 1)
              );
              return { zone: 'row', rowIndex: safeRow, colIndex: safeCol };
            });
          }
          return;
        }

        // Request failed
        consecutiveAppsFailuresRef.current += 1;

        // In dev mode without a backend, fall back seamlessly to mockData on startup
        if (import.meta.env.DEV && !isManualRetry && !backendConnectedOnceRef.current) {
          setLauncherData(mockData);
          setApiErrorMessage(null);
          return;
        }

        // In production builds or after persistent/manual failures, show friendly Retry screen
        if (
          isManualRetry ||
          backendConnectedOnceRef.current ||
          consecutiveAppsFailuresRef.current >= PERSISTENT_API_FAILURE_THRESHOLD
        ) {
          setApiErrorMessage(
            result.error ?? 'Unable to reach the local xLab TV service.'
          );
          setFocus({ zone: 'retry' });
        } else {
          // Schedule automatic startup retry in production before declaring persistent failure
          window.setTimeout(() => {
            if (!options?.signal?.aborted) {
              void loadApps({ signal: options?.signal });
            }
          }, 1500);
        }
      } catch {
        // Aborted on unmount
      } finally {
        if (isManualRetry) {
          setRetryingApps(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadApps({ signal: controller.signal });
    return () => controller.abort();
  }, [loadApps]);

  // 20-second timeout for "Opening <name>…" when no app ever confirms running
  useEffect(() => {
    if (launchTimeoutRef.current !== null) {
      window.clearTimeout(launchTimeoutRef.current);
      launchTimeoutRef.current = null;
    }

    if (!pendingLaunch || confirmedRunningId !== null) {
      return;
    }

    const { name } = pendingLaunch;
    launchTimeoutRef.current = window.setTimeout(() => {
      launchTimeoutRef.current = null;
      setPendingLaunch(null);

      if (lastLaunchedFocusRef.current) {
        const restoreTarget = lastLaunchedFocusRef.current;
        lastLaunchedFocusRef.current = null;
        setFocus(restoreTarget);
        if (restoreTarget.zone === 'row') {
          setRowMemory((prev) => ({
            ...prev,
            [restoreTarget.rowIndex]: restoreTarget.colIndex,
          }));
        }
      }

      showToast(`Couldn't open ${name}`, 'error');
    }, LAUNCH_TIMEOUT_MS);

    return () => {
      if (launchTimeoutRef.current !== null) {
        window.clearTimeout(launchTimeoutRef.current);
        launchTimeoutRef.current = null;
      }
    };
  }, [pendingLaunch, confirmedRunningId, showToast]);

  // Poll GET /api/status every 2 seconds
  useEffect(() => {
    let active = true;
    let inFlight = false;
    let activeController: AbortController | null = null;

    const findFocusForItemId = (id: string): FocusState | null => {
      const currentRows = rowsRef.current;
      for (let r = 0; r < currentRows.length; r++) {
        const idx = currentRows[r].items.findIndex((item) => item.id === id);
        if (idx !== -1) {
          return { zone: 'row', rowIndex: r, colIndex: idx };
        }
      }
      return null;
    };

    const poll = async () => {
      if (!active || inFlight) {
        return;
      }
      inFlight = true;
      activeController = new AbortController();

      try {
        const status = await fetchStatus(activeController.signal);
        if (!active) {
          return;
        }

        if (status === null) {
          consecutiveStatusFailuresRef.current += 1;
          // If a live backend was previously connected and now keeps failing, surface Retry screen
          if (
            backendConnectedOnceRef.current &&
            consecutiveStatusFailuresRef.current >=
              PERSISTENT_API_FAILURE_THRESHOLD
          ) {
            setApiErrorMessage(
              'Lost connection to the local xLab TV service.'
            );
            setFocus((curr) => (curr.zone === 'topbar' ? curr : { zone: 'retry' }));
          }
          return;
        }

        backendConnectedOnceRef.current = true;
        consecutiveStatusFailuresRef.current = 0;

        if (status.running !== null) {
          prevConfirmedRunningRef.current = status.running;
          setPendingLaunch(null);
          setConfirmedRunningId(status.running);
        } else {
          const finishedId = prevConfirmedRunningRef.current;
          if (finishedId !== null) {
            prevConfirmedRunningRef.current = null;
            setConfirmedRunningId(null);

            const targetFocus =
              lastLaunchedFocusRef.current ?? findFocusForItemId(finishedId);
            lastLaunchedFocusRef.current = null;

            if (targetFocus) {
              setFocus(targetFocus);
              if (targetFocus.zone === 'row') {
                setRowMemory((prev) => ({
                  ...prev,
                  [targetFocus.rowIndex]: targetFocus.colIndex,
                }));
              }
            }
          }
        }
      } finally {
        inFlight = false;
        activeController = null;
      }
    };

    void poll();
    const intervalId = window.setInterval(() => {
      void poll();
    }, STATUS_POLL_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      activeController?.abort();
    };
  }, []);

  // Lookup tables for resolving item IDs -> display names
  const appById = useMemo(() => {
    const map: Record<string, RowItem> = {};
    for (const row of rows) {
      for (const item of row.items) {
        if (!map[item.id]) {
          map[item.id] = item;
        }
      }
    }
    return map;
  }, [rows]);

  const appNameById = useMemo(() => {
    const names: Record<string, string> = {};
    for (const [id, item] of Object.entries(appById)) {
      names[id] = item.name;
    }
    return names;
  }, [appById]);

  const resolveDisplayName = useCallback(
    (id: string) => {
      if (appNameById[id]) {
        return appNameById[id];
      }
      const heroMatch = heroItems.find(
        (item) => item.id === id || item.appId === id
      );
      return heroMatch?.title ?? id;
    },
    [appNameById, heroItems]
  );

  const runningAppName = useMemo(() => {
    if (confirmedRunningId) {
      return resolveDisplayName(confirmedRunningId);
    }
    if (pendingLaunch) {
      return pendingLaunch.name;
    }
    return '';
  }, [confirmedRunningId, pendingLaunch, resolveDisplayName]);

  // Pre-collect all row item backdrops so HeroBanner crossfades instantaneously
  const backdropPool = useMemo(() => {
    const urls: string[] = [];
    for (const row of rows) {
      for (const item of row.items) {
        if (item.backdrop) {
          urls.push(item.backdrop);
        }
      }
    }
    return urls;
  }, [rows]);

  // Crossfade hero backdrop to match the focused row item when it has a backdrop
  const focusedItemBackdrop = useMemo(() => {
    if (focus.zone !== 'row') {
      return null;
    }
    const item = rows[focus.rowIndex]?.items[focus.colIndex];
    return item?.backdrop ?? null;
  }, [focus, rows]);

  const handleFocusCard = useCallback((rowIndex: number, colIndex: number) => {
    setFocus({ zone: 'row', rowIndex, colIndex });
    setRowMemory((prev) => ({ ...prev, [rowIndex]: colIndex }));
  }, []);

  const handleResetFocus = useCallback(() => {
    if (showEmptyOrErrorScreen) {
      setFocus({ zone: 'retry' });
      return;
    }
    setFocus(heroItems.length > 0 ? { zone: 'hero' } : { zone: 'row', rowIndex: 0, colIndex: 0 });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [showEmptyOrErrorScreen, heroItems.length]);

  const clearArmedPower = useCallback(() => {
    setArmedPowerAction(null);
    if (powerArmTimerRef.current !== null) {
      window.clearTimeout(powerArmTimerRef.current);
      powerArmTimerRef.current = null;
    }
  }, []);

  const closeSettings = useCallback(() => {
    clearArmedPower();
    setSettingsOpen(false);
  }, [clearArmedPower]);

  const openSettings = useCallback(() => {
    clearArmedPower();
    setSettingsFocusIndex(0);
    setSettingsOpen(true);
  }, [clearArmedPower]);

  const handleSettingsFocusChange = useCallback(
    (nextIndex: number) => {
      setSettingsFocusIndex(nextIndex);
      const focusedPower = POWER_OPTIONS[nextIndex]?.action ?? null;
      if (armedPowerAction && focusedPower !== armedPowerAction) {
        clearArmedPower();
      }
    },
    [armedPowerAction, clearArmedPower]
  );

  // Two-press confirmation for Sleep / Restart / Shut down / Exit to desktop -> POST /api/power
  const handleTriggerPower = useCallback(
    async (action: PowerAction) => {
      if (pendingPowerAction !== null) {
        return;
      }

      if (armedPowerAction !== action) {
        clearArmedPower();
        setArmedPowerAction(action);
        powerArmTimerRef.current = window.setTimeout(() => {
          setArmedPowerAction(null);
          powerArmTimerRef.current = null;
        }, POWER_ARM_TIMEOUT_MS);
        return;
      }

      clearArmedPower();
      setPendingPowerAction(action);
      const result = await sendPowerAction(action);
      setPendingPowerAction(null);

      if (!result.ok) {
        showToast(result.error, 'error');
        return;
      }

      setSettingsOpen(false);
      const confirmMessages: Record<PowerAction, string> = {
        suspend: 'Putting system to sleep…',
        reboot: 'Restarting system…',
        poweroff: 'Shutting down system…',
        exit: 'Exiting to desktop…',
      };
      showToast(confirmMessages[action], 'info');
    },
    [armedPowerAction, pendingPowerAction, clearArmedPower, showToast]
  );

  // Shared launcher for card or hero Open button -> POST /api/launch
  const executeLaunch = useCallback(
    async (id: string, displayName: string, restoreFocus: FocusState) => {
      if (launchingRequestId !== null || activeOverlayId !== null) {
        return;
      }

      setLaunchingRequestId(id);
      lastLaunchedFocusRef.current = restoreFocus;

      const result = await launchApp(id);
      setLaunchingRequestId(null);

      if (!result.ok) {
        lastLaunchedFocusRef.current = null;
        showToast(result.error, 'error');
        return;
      }

      setPendingLaunch({ id, name: displayName });
    },
    [launchingRequestId, activeOverlayId, showToast]
  );

  const handleOpenHero = useCallback(
    (item: HeroItem) => {
      const targetId = item.appId || item.id;
      const displayName = item.title || resolveDisplayName(targetId);
      void executeLaunch(targetId, displayName, { zone: 'hero' });
    },
    [executeLaunch, resolveDisplayName]
  );

  const handleOpenCard = useCallback(
    (item: RowItem, rowIndex: number, colIndex: number) => {
      void executeLaunch(item.id, item.name, {
        zone: 'row',
        rowIndex,
        colIndex,
      });
    },
    [executeLaunch]
  );

  // Unified spatial input router for both Keyboard and Gamepad API
  const handleSpatialAction = useCallback(
    (action: SpatialAction) => {
      resetIdleTimer();

      // Lock launcher input while an app is opening or actively running
      if (activeOverlayId !== null) {
        return;
      }

      // Gamepad Start toggles Settings from anywhere
      if (action === 'settings') {
        if (settingsOpen) {
          closeSettings();
        } else {
          openSettings();
        }
        return;
      }

      // 1. Settings Side Panel spatial focus
      if (settingsOpen) {
        if (action === 'back') {
          closeSettings();
          return;
        }
        if (action === 'up') {
          handleSettingsFocusChange(Math.max(0, settingsFocusIndex - 1));
          return;
        }
        if (action === 'down') {
          handleSettingsFocusChange(
            Math.min(SETTINGS_ITEM_COUNT - 1, settingsFocusIndex + 1)
          );
          return;
        }
        if (action === 'activate') {
          if (settingsFocusIndex < POWER_OPTIONS.length) {
            const powerOpt = POWER_OPTIONS[settingsFocusIndex];
            if (powerOpt) {
              void handleTriggerPower(powerOpt.action);
            }
          } else if (settingsFocusIndex === 4) {
            setSettings((s) => ({ ...s, use24HourClock: !s.use24HourClock }));
          } else if (settingsFocusIndex === 5) {
            setSettings((s) => ({ ...s, autoAdvanceHero: !s.autoAdvanceHero }));
          } else if (settingsFocusIndex === 6) {
            setSettings((s) => ({ ...s, showSubtitles: !s.showSubtitles }));
          } else if (settingsFocusIndex === 7) {
            setSettings((s) => ({ ...s, showNavHints: !s.showNavHints }));
          }
        }
        return;
      }

      // 2. Empty / API failure screen spatial focus (Retry button <-> TopBar Settings)
      if (showEmptyOrErrorScreen) {
        if (action === 'back') {
          setFocus({ zone: 'retry' });
          return;
        }
        if (action === 'up') {
          setFocus({ zone: 'topbar' });
          return;
        }
        if (action === 'down') {
          setFocus({ zone: 'retry' });
          return;
        }
        if (action === 'activate') {
          if (focus.zone === 'topbar') {
            openSettings();
          } else {
            void loadApps({ isManualRetry: true });
          }
        }
        return;
      }

      // 3. Main Launcher spatial focus
      if (action === 'back') {
        handleResetFocus();
        return;
      }

      if (action === 'activate') {
        if (focus.zone === 'topbar') {
          openSettings();
        } else if (focus.zone === 'hero') {
          const active = heroItems[heroIndex];
          if (active) {
            handleOpenHero(active);
          }
        } else if (focus.zone === 'row') {
          const row = rows[focus.rowIndex];
          const card = row?.items[focus.colIndex];
          if (card) {
            handleOpenCard(card, focus.rowIndex, focus.colIndex);
          }
        }
        return;
      }

      if (focus.zone === 'topbar') {
        if (action === 'down') {
          if (heroItems.length > 0) {
            setFocus({ zone: 'hero' });
          } else if (rows.length > 0) {
            handleFocusCard(0, rowMemory[0] ?? 0);
          }
        }
        return;
      }

      if (focus.zone === 'hero') {
        if (action === 'up') {
          setFocus({ zone: 'topbar' });
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (action === 'down' && rows.length > 0) {
          const savedCol = rowMemory[0] ?? 0;
          const clampedCol = Math.min(
            savedCol,
            Math.max(0, rows[0].items.length - 1)
          );
          handleFocusCard(0, clampedCol);
        } else if (action === 'left' && heroItems.length > 1) {
          setHeroIndex(
            (prev) => (prev - 1 + heroItems.length) % heroItems.length
          );
        } else if (action === 'right' && heroItems.length > 1) {
          setHeroIndex((prev) => (prev + 1) % heroItems.length);
        }
        return;
      }

      if (focus.zone !== 'row') {
        setFocus({ zone: 'hero' });
        return;
      }

      // Row zone navigation
      const currentRow = rows[focus.rowIndex];
      if (!currentRow) {
        setFocus({ zone: 'hero' });
        return;
      }

      if (action === 'left') {
        const nextCol = Math.max(0, focus.colIndex - 1);
        handleFocusCard(focus.rowIndex, nextCol);
      } else if (action === 'right') {
        const nextCol = Math.min(currentRow.items.length - 1, focus.colIndex + 1);
        handleFocusCard(focus.rowIndex, nextCol);
      } else if (action === 'up') {
        if (focus.rowIndex === 0) {
          setFocus(heroItems.length > 0 ? { zone: 'hero' } : { zone: 'topbar' });
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          const nextRowIdx = focus.rowIndex - 1;
          const nextRow = rows[nextRowIdx];
          const rememberedCol = rowMemory[nextRowIdx] ?? 0;
          const clampedCol = Math.min(
            rememberedCol,
            Math.max(0, nextRow.items.length - 1)
          );
          handleFocusCard(nextRowIdx, clampedCol);
        }
      } else if (action === 'down') {
        if (focus.rowIndex < rows.length - 1) {
          const nextRowIdx = focus.rowIndex + 1;
          const nextRow = rows[nextRowIdx];
          const rememberedCol = rowMemory[nextRowIdx] ?? 0;
          const clampedCol = Math.min(
            rememberedCol,
            Math.max(0, nextRow.items.length - 1)
          );
          handleFocusCard(nextRowIdx, clampedCol);
        }
      }
    },
    [
      resetIdleTimer,
      activeOverlayId,
      settingsOpen,
      settingsFocusIndex,
      showEmptyOrErrorScreen,
      focus,
      heroIndex,
      heroItems,
      rows,
      rowMemory,
      openSettings,
      closeSettings,
      handleSettingsFocusChange,
      handleTriggerPower,
      loadApps,
      handleOpenHero,
      handleOpenCard,
      handleFocusCard,
      handleResetFocus,
    ]
  );

  // Connect Gamepad API with idle tracking and wake-without-action behavior
  useGamepadInput({
    onAction: handleSpatialAction,
    onActivity: resetIdleTimer,
    isScreensaverActive: screensaverActive,
    onWakeScreensaver: wakeScreensaver,
  });

  // Global keyboard listener (any key wakes screensaver without triggering an action)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (screensaverActive) {
        event.preventDefault();
        wakeScreensaver();
        return;
      }

      resetIdleTimer();

      let action: SpatialAction | null = null;
      switch (event.key) {
        case 'ArrowUp':
          action = 'up';
          break;
        case 'ArrowDown':
          action = 'down';
          break;
        case 'ArrowLeft':
          action = 'left';
          break;
        case 'ArrowRight':
          action = 'right';
          break;
        case 'Enter':
        case ' ':
          action = 'activate';
          break;
        case 'Escape':
        case 'Backspace':
          action = 'back';
          break;
        default:
          break;
      }

      if (!action) {
        return;
      }

      event.preventDefault();
      handleSpatialAction(action);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [screensaverActive, wakeScreensaver, resetIdleTimer, handleSpatialAction]);

  // Gentle hero auto-advance when idle and no overlay/screensaver/card override is active
  useEffect(() => {
    if (
      !settings.autoAdvanceHero ||
      heroItems.length <= 1 ||
      settingsOpen ||
      activeOverlayId !== null ||
      screensaverActive ||
      showEmptyOrErrorScreen ||
      focusedItemBackdrop !== null
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      setHeroIndex((prev) => (prev + 1) % heroItems.length);
    }, 8500);

    return () => window.clearInterval(timer);
  }, [
    settings.autoAdvanceHero,
    heroItems.length,
    settingsOpen,
    activeOverlayId,
    screensaverActive,
    showEmptyOrErrorScreen,
    focusedItemBackdrop,
    heroIndex,
  ]);

  const screensaverBackdrops = heroItems.length > 0 ? heroItems : mockData.hero;

  return (
    <div className="relative min-h-screen w-full bg-[#090B10] text-[#F1F5F9]">
      {/* Top Bar */}
      <TopBar
        use24HourClock={settings.use24HourClock}
        isSettingsFocused={
          !settingsOpen &&
          !screensaverActive &&
          activeOverlayId === null &&
          focus.zone === 'topbar'
        }
        onFocusSettings={() => setFocus({ zone: 'topbar' })}
        onOpenSettings={openSettings}
      />

      {/* Main 10-Foot Launcher Canvas or Friendly Empty/Error State */}
      {showEmptyOrErrorScreen ? (
        <main>
          <EmptyErrorState
            title={
              apiErrorMessage ? 'xLab TV service unavailable' : 'No apps available'
            }
            description={
              apiErrorMessage ??
              'Your app library is currently empty. Check your xLab TV configuration or press Retry to reload.'
            }
            retrying={retryingApps}
            isRetryFocused={
              !settingsOpen &&
              !screensaverActive &&
              activeOverlayId === null &&
              focus.zone !== 'topbar'
            }
            onFocusRetry={() => setFocus({ zone: 'retry' })}
            onRetry={() => void loadApps({ isManualRetry: true })}
          />
        </main>
      ) : (
        <main className="pb-16">
          <HeroBanner
            items={heroItems}
            activeIndex={heroIndex}
            isHeroFocused={
              !settingsOpen &&
              !screensaverActive &&
              activeOverlayId === null &&
              focus.zone === 'hero'
            }
            overrideBackdrop={focusedItemBackdrop}
            backdropPool={backdropPool}
            appNameById={appNameById}
            onFocusHero={() => setFocus({ zone: 'hero' })}
            onOpenHero={handleOpenHero}
          />

          {/* Horizontal Content & App Rows */}
          <div className="relative z-20 mt-4 space-y-6">
            {rows.map((row, rowIndex) => (
              <ContentRow
                key={row.title}
                row={row}
                rowIndex={rowIndex}
                isRowFocused={
                  !settingsOpen &&
                  !screensaverActive &&
                  activeOverlayId === null &&
                  focus.zone === 'row' &&
                  focus.rowIndex === rowIndex
                }
                focusedColIndex={
                  focus.zone === 'row' && focus.rowIndex === rowIndex
                    ? focus.colIndex
                    : (rowMemory[rowIndex] ?? 0)
                }
                showSubtitles={settings.showSubtitles}
                onFocusCard={handleFocusCard}
                onOpenCard={(item) => {
                  const colIdx = row.items.findIndex(
                    (entry) => entry.id === item.id
                  );
                  handleOpenCard(item, rowIndex, colIdx >= 0 ? colIdx : 0);
                }}
              />
            ))}
          </div>

          {/* Quiet 10-foot navigation hint footer (toggleable in Settings) */}
          {settings.showNavHints && (
            <footer className="mt-10 flex items-center justify-between px-16 text-[0.95rem] text-[#64748B]">
              <span>
                Arrows or Gamepad to navigate · Enter / A to open · Esc / B to
                go back · Start for settings
              </span>
              <span>xLab TV</span>
            </footer>
          )}
        </main>
      )}

      {/* Settings Side Panel with Sleep, Restart, Shut down, Exit to desktop */}
      <SettingsDrawer
        isOpen={settingsOpen}
        focusedIndex={settingsFocusIndex}
        armedPowerAction={armedPowerAction}
        pendingPowerAction={pendingPowerAction}
        settings={settings}
        onFocusIndex={handleSettingsFocusChange}
        onTriggerPower={(action) => void handleTriggerPower(action)}
        onUpdateSettings={(patch) =>
          setSettings((prev) => ({ ...prev, ...patch }))
        }
        onClose={closeSettings}
      />

      {/* Dim "Opening <name>…" overlay while launching or running */}
      {activeOverlayId !== null && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-[#06080D]/86 px-12 text-center"
        >
          <Loader2
            className="h-[3.25rem] w-[3.25rem] animate-spin text-[#38BDF8]"
            strokeWidth={2}
            aria-hidden="true"
          />
          <p className="mt-6 font-display text-[2.5rem] font-semibold tracking-[-0.02em] text-[#F8FAFC]">
            Opening {runningAppName}…
          </p>
        </div>
      )}

      {/* 10-Minute Ambient Screensaver (slow crossfading hero backdrops + large clock) */}
      <AmbientScreensaver
        active={screensaverActive}
        items={screensaverBackdrops}
        use24HourClock={settings.use24HourClock}
        onWake={wakeScreensaver}
      />

      {/* Error & Power Action Toast */}
      <Toast toast={toast} />
    </div>
  );
}
