import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  fetchAppsWithStatus,
  fetchRemoteInfo,
  fetchStatus,
  fetchStoreWithStatus,
  forgetAllPhones,
  isAppsPayloadEmpty,
  launchApp,
  sendPowerAction,
  submitStoreAction,
  type PowerAction,
  type RemotePairingInfo,
} from './api';
import { AmbientScreensaver } from './components/AmbientScreensaver';
import { ContentRow } from './components/ContentRow';
import { EmptyErrorState } from './components/EmptyErrorState';
import { HeroBanner } from './components/HeroBanner';
import { PhoneRemotePanel } from './components/PhoneRemotePanel';
import {
  POWER_OPTIONS,
  SettingsDrawer,
  type LauncherSettings,
} from './components/SettingsDrawer';
import { StoreDetailPanel } from './components/StoreDetailPanel';
import { groupStoreItemsByCategory, StoreView } from './components/StoreView';
import { Toast, type ToastMessage } from './components/Toast';
import { TopBar, type TopBarButton } from './components/TopBar';
import { useGamepadInput, type SpatialAction } from './hooks/useGamepadInput';
import {
  mockData,
  mockStoreData,
  STORE_CARD_ID,
  storeCardItem,
  type ContentRow as ContentRowData,
  type HeroItem,
  type MockData,
  type RowItem,
  type StoreItem,
  type StoreJobAction,
  type StoreJobState,
} from './mock';

type FocusState =
  | { zone: 'topbar'; button: TopBarButton }
  | { zone: 'hero' }
  | { zone: 'retry' }
  | { zone: 'row'; rowIndex: number; colIndex: number };

interface PendingLaunch {
  id: string;
  name: string;
}

interface TrackedStoreJob {
  state: StoreJobState;
  action: StoreJobAction;
  message: string;
}

interface ActivePreviewSource {
  appId: string;
  rowIndex: number;
  colIndex: number;
}

const DEFAULT_SETTINGS: LauncherSettings = {
  use24HourClock: true,
  autoAdvanceHero: true,
  showSubtitles: true,
  showNavHints: true,
};

const SETTINGS_ITEM_COUNT = 9; // 0 Phone remote, 1..4 Power & Session actions, 5..8 Display toggles
const STATUS_POLL_INTERVAL_MS = 2000;
const STORE_POLL_INTERVAL_MS = 2000;
const APPS_IDLE_REFRESH_MS = 60_000;
const PREVIEW_FOCUS_DEBOUNCE_MS = 400;
const PREVIEW_AUTO_ADVANCE_MS = 8000;
const POWER_ARM_TIMEOUT_MS = 5000;
const TOAST_DURATION_MS = 4500;
const LAUNCH_TIMEOUT_MS = 20000;
const SCREENSAVER_IDLE_MS = 10 * 60 * 1000;
const PERSISTENT_API_FAILURE_THRESHOLD = 3;

/**
 * Preserves backend row ordering, hides empty rows, and appends the Store card
 * to the end of the first non-media row (falling back to row 0 if all rows are media).
 */
function computeDisplayRows(rawRows: ContentRowData[]): ContentRowData[] {
  const nonEmpty = rawRows.filter((row) => row.items.length > 0);
  if (nonEmpty.length === 0) {
    return nonEmpty;
  }

  const alreadyHasStore = nonEmpty.some((row) =>
    row.items.some((item) => item.id === STORE_CARD_ID)
  );
  if (alreadyHasStore) {
    return nonEmpty;
  }

  const firstAppRowIdx = nonEmpty.findIndex((row) =>
    row.items.some((item) => item.kind !== 'media')
  );
  const targetIdx = firstAppRowIdx >= 0 ? firstAppRowIdx : 0;

  return nonEmpty.map((row, idx) =>
    idx === targetIdx
      ? { ...row, items: [...row.items, storeCardItem] }
      : row
  );
}

export default function App() {
  const [launcherData, setLauncherData] = useState<MockData>(mockData);
  const [heroIndex, setHeroIndex] = useState<number>(0);
  // Focused element is active and visible immediately on load
  const [focus, setFocus] = useState<FocusState>({ zone: 'hero' });
  const [rowMemory, setRowMemory] = useState<Record<number, number>>({});

  // Tracks empty library or persistent backend failure state
  const [apiErrorMessage, setApiErrorMessage] = useState<string | null>(null);
  const [retryingApps, setRetryingApps] = useState<boolean>(false);

  // Store state (kept at App level so background install/remove polling continues if user leaves Store)
  const [storeOpen, setStoreOpen] = useState<boolean>(false);
  const [storeItems, setStoreItems] = useState<StoreItem[]>(
    import.meta.env.DEV ? mockStoreData.items : []
  );
  const [storeError, setStoreError] = useState<string | null>(null);
  const [retryingStore, setRetryingStore] = useState<boolean>(false);
  const [storeFocus, setStoreFocus] = useState<{
    rowIndex: number;
    colIndex: number;
  }>({ rowIndex: 0, colIndex: 0 });
  const [storeRowMemory, setStoreRowMemory] = useState<Record<number, number>>(
    {}
  );
  const [selectedStoreItemId, setSelectedStoreItemId] = useState<string | null>(
    null
  );
  const [submittingStoreItemId, setSubmittingStoreItemId] = useState<
    string | null
  >(null);

  const [settings, setSettings] = useState<LauncherSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [settingsFocusIndex, setSettingsFocusIndex] = useState<number>(0);
  const [armedPowerAction, setArmedPowerAction] = useState<PowerAction | null>(
    null
  );
  const [pendingPowerAction, setPendingPowerAction] =
    useState<PowerAction | null>(null);

  // TV Phone Remote pairing panel state
  const [phoneRemoteOpen, setPhoneRemoteOpen] = useState<boolean>(false);
  const [remoteInfo, setRemoteInfo] = useState<RemotePairingInfo | null>(null);
  const [remoteLoading, setRemoteLoading] = useState<boolean>(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [remoteSecondsLeft, setRemoteSecondsLeft] = useState<number>(0);
  const [forgetPhonesArmed, setForgetPhonesArmed] = useState<boolean>(false);
  const [forgettingPhones, setForgettingPhones] = useState<boolean>(false);

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

  // Google TV-style hero app previews (activated after ~400 ms of resting focus on an app with previews)
  const [activePreviewSource, setActivePreviewSource] =
    useState<ActivePreviewSource | null>(null);
  const [previewHeroIndex, setPreviewHeroIndex] = useState<number>(0);

  const toastTimerRef = useRef<number | null>(null);
  const powerArmTimerRef = useRef<number | null>(null);
  const forgetArmTimerRef = useRef<number | null>(null);
  const previewDebounceTimerRef = useRef<number | null>(null);
  const remoteFetchControllerRef = useRef<AbortController | null>(null);
  const launchTimeoutRef = useRef<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);

  const lastLaunchedFocusRef = useRef<FocusState | null>(null);
  const lastLaunchedItemIdRef = useRef<string | null>(null);
  const storeReturnFocusRef = useRef<FocusState>({ zone: 'hero' });
  const lastTopBarButtonRef = useRef<TopBarButton>('store');
  const prevConfirmedRunningRef = useRef<string | null>(null);
  const prevStoreJobsRef = useRef<Record<string, TrackedStoreJob>>({});
  const storeBackendSeenRef = useRef<boolean>(false);
  const backendConnectedOnceRef = useRef<boolean>(false);
  const consecutiveStatusFailuresRef = useRef<number>(0);
  const consecutiveAppsFailuresRef = useRef<number>(0);

  const heroItems = launcherData.hero;

  const rows = useMemo(
    () => computeDisplayRows(launcherData.rows),
    [launcherData.rows]
  );

  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const focusRef = useRef(focus);
  focusRef.current = focus;

  const heroItemsRef = useRef(heroItems);
  heroItemsRef.current = heroItems;

  const heroIndexRef = useRef(heroIndex);
  heroIndexRef.current = heroIndex;

  const storeRows = useMemo(
    () => groupStoreItemsByCategory(storeItems),
    [storeItems]
  );

  const activeStoreJobCount = useMemo(
    () =>
      storeItems.filter(
        (item) =>
          item.job?.state === 'queued' || item.job?.state === 'running'
      ).length,
    [storeItems]
  );

  const hasActiveStoreJob = activeStoreJobCount > 0;

  const selectedStoreItem = useMemo(
    () =>
      selectedStoreItemId
        ? storeItems.find((item) => item.id === selectedStoreItemId) ?? null
        : null,
    [selectedStoreItemId, storeItems]
  );

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
      if (forgetArmTimerRef.current !== null) {
        window.clearTimeout(forgetArmTimerRef.current);
      }
      if (previewDebounceTimerRef.current !== null) {
        window.clearTimeout(previewDebounceTimerRef.current);
      }
      if (remoteFetchControllerRef.current !== null) {
        remoteFetchControllerRef.current.abort();
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

  // Load apps from GET /api/apps (dev mode falls back to mockData; preserves focus on same item ID)
  const loadApps = useCallback(
    async (options?: {
      isManualRetry?: boolean;
      silent?: boolean;
      signal?: AbortSignal;
      preferredItemId?: string | null;
      preferredFocus?: FocusState | null;
    }) => {
      const isManualRetry = Boolean(options?.isManualRetry);
      const isSilent = Boolean(options?.silent);
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

          const prevRows = rowsRef.current;
          const nextRows = computeDisplayRows(result.data.rows);
          const prevHeroItems = heroItemsRef.current;
          const prevHeroIdx = heroIndexRef.current;
          const focusedHeroId = prevHeroItems[prevHeroIdx]?.id ?? null;
          const currentFocus = options?.preferredFocus ?? focusRef.current;

          setLauncherData(result.data);

          if (result.data.hero.length > 0) {
            const matchedHeroIdx = focusedHeroId
              ? result.data.hero.findIndex((item) => item.id === focusedHeroId)
              : -1;
            setHeroIndex(
              matchedHeroIdx >= 0
                ? matchedHeroIdx
                : Math.min(prevHeroIdx, result.data.hero.length - 1)
            );
          } else {
            setHeroIndex(0);
          }

          if (isAppsPayloadEmpty(result.data)) {
            setFocus({ zone: 'retry' });
          } else if (currentFocus.zone === 'retry') {
            setFocus(
              result.data.hero.length > 0
                ? { zone: 'hero' }
                : { zone: 'row', rowIndex: 0, colIndex: 0 }
            );
          } else if (currentFocus.zone === 'hero') {
            if (result.data.hero.length === 0 && nextRows.length > 0) {
              setFocus({ zone: 'row', rowIndex: 0, colIndex: 0 });
            } else {
              setFocus({ zone: 'hero' });
            }
          } else if (currentFocus.zone === 'row') {
            if (nextRows.length === 0) {
              setFocus({ zone: 'hero' });
            } else {
              const prevRow = prevRows[currentFocus.rowIndex];
              const prevRowTitle = prevRow?.title ?? null;
              const targetItemId =
                options?.preferredItemId ??
                prevRow?.items[currentFocus.colIndex]?.id ??
                null;

              let resolvedRow = -1;
              let resolvedCol = -1;

              // 1. Keep focus on the exact same item ID if it still exists (same row preferred)
              if (targetItemId) {
                if (prevRowTitle) {
                  const sameTitleIdx = nextRows.findIndex(
                    (row) => row.title === prevRowTitle
                  );
                  if (sameTitleIdx >= 0) {
                    const colIdx = nextRows[sameTitleIdx].items.findIndex(
                      (item) => item.id === targetItemId
                    );
                    if (colIdx >= 0) {
                      resolvedRow = sameTitleIdx;
                      resolvedCol = colIdx;
                    }
                  }
                }
                if (resolvedRow < 0) {
                  for (let r = 0; r < nextRows.length; r++) {
                    const colIdx = nextRows[r].items.findIndex(
                      (item) => item.id === targetItemId
                    );
                    if (colIdx >= 0) {
                      resolvedRow = r;
                      resolvedCol = colIdx;
                      break;
                    }
                  }
                }
              }

              // 2. Otherwise stay on the nearest item in the same row (or nearest available row)
              if (resolvedRow < 0) {
                const sameTitleIdx = prevRowTitle
                  ? nextRows.findIndex((row) => row.title === prevRowTitle)
                  : -1;
                resolvedRow =
                  sameTitleIdx >= 0
                    ? sameTitleIdx
                    : Math.min(currentFocus.rowIndex, nextRows.length - 1);
                resolvedCol = Math.min(
                  currentFocus.colIndex,
                  Math.max(0, nextRows[resolvedRow].items.length - 1)
                );
              }

              setFocus({
                zone: 'row',
                rowIndex: resolvedRow,
                colIndex: resolvedCol,
              });
              setRowMemory((prev) => ({
                ...prev,
                [resolvedRow]: resolvedCol,
              }));
            }
          }
          return;
        }

        // Request failed
        consecutiveAppsFailuresRef.current += 1;

        // In dev mode without a backend, fall back seamlessly to mockData on startup/background
        if (
          import.meta.env.DEV &&
          !isManualRetry &&
          !backendConnectedOnceRef.current
        ) {
          setLauncherData(mockData);
          setApiErrorMessage(null);
          return;
        }

        // Background silent refreshes only surface an error screen after repeated failures
        if (
          isManualRetry ||
          (!isSilent && backendConnectedOnceRef.current) ||
          consecutiveAppsFailuresRef.current >= PERSISTENT_API_FAILURE_THRESHOLD
        ) {
          setApiErrorMessage(
            result.error ?? 'Unable to reach the local xLab TV service.'
          );
          setFocus({ zone: 'retry' });
        } else if (!isSilent) {
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

  const loadAppsRef = useRef(loadApps);
  loadAppsRef.current = loadApps;

  useEffect(() => {
    const controller = new AbortController();
    void loadApps({ signal: controller.signal });
    return () => controller.abort();
  }, [loadApps]);

  // Periodically refetch GET /api/apps every 60 s while idle (no app running)
  useEffect(() => {
    if (activeOverlayId !== null) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'hidden') {
        return;
      }
      void loadApps({ silent: true });
    }, APPS_IDLE_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [activeOverlayId, loadApps]);

  // Apply fresh Store catalog and detect job transitions (done/failed -> toast + refetch /api/apps)
  const applyStoreItems = useCallback(
    (nextItems: StoreItem[], isLiveBackend: boolean) => {
      const prevJobs = prevStoreJobsRef.current;
      const nextJobs: Record<string, TrackedStoreJob> = {};
      let shouldRefetchApps = false;

      for (const item of nextItems) {
        const prev = prevJobs[item.id];
        const curr = item.job;

        if (isLiveBackend && prev && (prev.state === 'queued' || prev.state === 'running')) {
          if (curr && curr.state === 'done') {
            showToast(
              curr.message ||
                `${item.name} ${curr.action === 'remove' ? 'removed' : 'installed'}.`,
              'info'
            );
            shouldRefetchApps = true;
          } else if (curr && curr.state === 'failed') {
            showToast(
              curr.message || `Couldn't ${curr.action} ${item.name}.`,
              'error'
            );
            shouldRefetchApps = true;
          } else if (!curr) {
            showToast(
              `${item.name} ${prev.action === 'remove' ? 'removed' : 'installed'}.`,
              'info'
            );
            shouldRefetchApps = true;
          }
        }

        if (curr) {
          nextJobs[item.id] = {
            state: curr.state,
            action: curr.action,
            message: curr.message,
          };
        }
      }

      prevStoreJobsRef.current = nextJobs;
      setStoreItems(nextItems);

      // Clamp Store focus safely if rows/items changed
      const grouped = groupStoreItemsByCategory(nextItems);
      setStoreFocus((curr) => {
        if (grouped.length === 0) {
          return { rowIndex: 0, colIndex: 0 };
        }
        const safeRow = Math.min(curr.rowIndex, grouped.length - 1);
        const safeCol = Math.min(
          curr.colIndex,
          Math.max(0, grouped[safeRow].items.length - 1)
        );
        return { rowIndex: safeRow, colIndex: safeCol };
      });

      if (shouldRefetchApps) {
        void loadApps();
      }
    },
    [showToast, loadApps]
  );

  // Fetch Store catalog from GET /api/store
  const loadStore = useCallback(
    async (options?: {
      isManualRetry?: boolean;
      silent?: boolean;
      signal?: AbortSignal;
    }) => {
      const isManualRetry = Boolean(options?.isManualRetry);
      if (isManualRetry) {
        setRetryingStore(true);
      }

      try {
        const result = await fetchStoreWithStatus(options?.signal);
        if (options?.signal?.aborted) {
          return;
        }

        if (result.ok) {
          storeBackendSeenRef.current = true;
          setStoreError(null);
          applyStoreItems(result.data.items, true);
          return;
        }

        // In dev mode without a backend, fall back cleanly to mockStoreData
        if (
          import.meta.env.DEV &&
          !isManualRetry &&
          !storeBackendSeenRef.current
        ) {
          setStoreError(null);
          if (!options?.silent) {
            applyStoreItems(mockStoreData.items, false);
          }
          return;
        }

        if (!options?.silent) {
          setStoreError(
            result.error ?? 'Unable to reach the xLab TV Store service.'
          );
        }
      } catch {
        // Aborted on unmount
      } finally {
        if (isManualRetry) {
          setRetryingStore(false);
        }
      }
    },
    [applyStoreItems]
  );

  // Initial Store sync on mount so any already-running backend jobs are tracked immediately
  useEffect(() => {
    const controller = new AbortController();
    void loadStore({ signal: controller.signal });
    return () => controller.abort();
  }, [loadStore]);

  // Poll GET /api/store every 2 seconds while any job is "queued" or "running" (even outside Store)
  useEffect(() => {
    if (!hasActiveStoreJob) {
      return;
    }

    let active = true;
    let inFlight = false;
    let activeController: AbortController | null = null;

    const pollStore = async () => {
      if (!active || inFlight) {
        return;
      }
      inFlight = true;
      activeController = new AbortController();

      try {
        const result = await fetchStoreWithStatus(activeController.signal);
        if (!active || !result.ok) {
          return;
        }
        storeBackendSeenRef.current = true;
        setStoreError(null);
        applyStoreItems(result.data.items, true);
      } catch {
        // Aborted or transient network failure during poll
      } finally {
        inFlight = false;
        activeController = null;
      }
    };

    const intervalId = window.setInterval(() => {
      void pollStore();
    }, STORE_POLL_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      activeController?.abort();
    };
  }, [hasActiveStoreJob, applyStoreItems]);

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
          if (
            backendConnectedOnceRef.current &&
            consecutiveStatusFailuresRef.current >=
              PERSISTENT_API_FAILURE_THRESHOLD
          ) {
            setApiErrorMessage('Lost connection to the local xLab TV service.');
            setFocus((curr) =>
              curr.zone === 'topbar' ? curr : { zone: 'retry' }
            );
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

            const launchedItemId = lastLaunchedItemIdRef.current ?? finishedId;
            const targetFocus =
              lastLaunchedFocusRef.current ?? findFocusForItemId(launchedItemId);
            lastLaunchedFocusRef.current = null;
            lastLaunchedItemIdRef.current = null;

            if (targetFocus) {
              setFocus(targetFocus);
              if (targetFocus.zone === 'row') {
                setRowMemory((prev) => ({
                  ...prev,
                  [targetFocus.rowIndex]: targetFocus.colIndex,
                }));
              }
            }

            // Refetch GET /api/apps when returning from a running app to update Continue watching
            void loadAppsRef.current({
              silent: true,
              preferredItemId: launchedItemId,
              preferredFocus: targetFocus,
            });
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

  const appColorById = useMemo(() => {
    const colors: Record<string, string> = {};
    for (const [id, item] of Object.entries(appById)) {
      colors[id] = item.color;
    }
    return colors;
  }, [appById]);

  // Resolve the currently active app preview source against live rows (stays fresh across 60 s refetches)
  const activePreviewInfo = useMemo(() => {
    if (!activePreviewSource) {
      return null;
    }
    for (let r = 0; r < rows.length; r++) {
      const c = rows[r].items.findIndex(
        (item) => item.id === activePreviewSource.appId
      );
      if (c >= 0) {
        const app = rows[r].items[c];
        if (
          app.kind !== 'media' &&
          Array.isArray(app.previews) &&
          app.previews.length > 0
        ) {
          return {
            app,
            previews: app.previews,
            rowIndex: r,
            colIndex: c,
          };
        }
        return null;
      }
    }
    return null;
  }, [activePreviewSource, rows]);

  // Debounce switching hero to an app's previews (~400 ms) so fast scrolling doesn't flicker
  useEffect(() => {
    if (previewDebounceTimerRef.current !== null) {
      window.clearTimeout(previewDebounceTimerRef.current);
      previewDebounceTimerRef.current = null;
    }

    if (focus.zone === 'hero' || focus.zone === 'topbar') {
      return;
    }

    if (focus.zone === 'retry') {
      setActivePreviewSource(null);
      setPreviewHeroIndex(0);
      return;
    }

    const card = rows[focus.rowIndex]?.items[focus.colIndex];
    const hasPreviews = Boolean(
      card &&
        card.kind !== 'media' &&
        Array.isArray(card.previews) &&
        card.previews.length > 0
    );

    if (!hasPreviews || !card) {
      setActivePreviewSource(null);
      setPreviewHeroIndex(0);
      return;
    }

    if (activePreviewSource?.appId === card.id) {
      if (
        activePreviewSource.rowIndex !== focus.rowIndex ||
        activePreviewSource.colIndex !== focus.colIndex
      ) {
        setActivePreviewSource({
          appId: card.id,
          rowIndex: focus.rowIndex,
          colIndex: focus.colIndex,
        });
      }
      return;
    }

    const targetRow = focus.rowIndex;
    const targetCol = focus.colIndex;
    const targetId = card.id;

    previewDebounceTimerRef.current = window.setTimeout(() => {
      previewDebounceTimerRef.current = null;
      setActivePreviewSource({
        appId: targetId,
        rowIndex: targetRow,
        colIndex: targetCol,
      });
      setPreviewHeroIndex(0);
    }, PREVIEW_FOCUS_DEBOUNCE_MS);

    return () => {
      if (previewDebounceTimerRef.current !== null) {
        window.clearTimeout(previewDebounceTimerRef.current);
        previewDebounceTimerRef.current = null;
      }
    };
  }, [focus, rows, activePreviewSource]);

  const displayedHeroItems = activePreviewInfo
    ? activePreviewInfo.previews
    : heroItems;
  const displayedHeroIndex = activePreviewInfo
    ? Math.min(previewHeroIndex, Math.max(0, activePreviewInfo.previews.length - 1))
    : Math.min(heroIndex, Math.max(0, heroItems.length - 1));

  const resolveDisplayName = useCallback(
    (id: string) => {
      if (appNameById[id]) {
        return appNameById[id];
      }
      const heroMatch = heroItems.find(
        (item) => item.id === id || item.appId === id
      );
      if (heroMatch) {
        return heroMatch.title;
      }
      for (const row of rows) {
        for (const item of row.items) {
          const previewMatch = item.previews?.find((p) => p.id === id);
          if (previewMatch) {
            return previewMatch.title;
          }
        }
      }
      return id;
    },
    [appNameById, heroItems, rows]
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

  // Crossfade hero backdrop to match the focused row item when it has a backdrop (and no app previews)
  const focusedItemBackdrop = useMemo(() => {
    if (activePreviewInfo !== null || focus.zone !== 'row') {
      return null;
    }
    const item = rows[focus.rowIndex]?.items[focus.colIndex];
    if (
      item &&
      item.kind !== 'media' &&
      Array.isArray(item.previews) &&
      item.previews.length > 0
    ) {
      return null;
    }
    return item?.backdrop ?? null;
  }, [activePreviewInfo, focus, rows]);

  const handleFocusCard = useCallback((rowIndex: number, colIndex: number) => {
    setFocus({ zone: 'row', rowIndex, colIndex });
    setRowMemory((prev) => ({ ...prev, [rowIndex]: colIndex }));
  }, []);

  const handleFocusTopBar = useCallback((button: TopBarButton) => {
    lastTopBarButtonRef.current = button;
    setFocus({ zone: 'topbar', button });
  }, []);

  const handleFocusStoreCard = useCallback(
    (rowIndex: number, colIndex: number) => {
      setStoreFocus({ rowIndex, colIndex });
      setStoreRowMemory((prev) => ({ ...prev, [rowIndex]: colIndex }));
    },
    []
  );

  const openStore = useCallback(
    (returnFocus: FocusState) => {
      storeReturnFocusRef.current = returnFocus;
      setSelectedStoreItemId(null);
      setStoreOpen(true);
      void loadStore();
    },
    [loadStore]
  );

  const closeStore = useCallback(() => {
    setSelectedStoreItemId(null);
    setStoreOpen(false);
    const restore = storeReturnFocusRef.current;
    setFocus(restore);
    if (restore.zone === 'row') {
      setRowMemory((prev) => ({
        ...prev,
        [restore.rowIndex]: restore.colIndex,
      }));
    } else if (restore.zone === 'topbar') {
      lastTopBarButtonRef.current = restore.button;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const handleStoreAction = useCallback(
    async (item: StoreItem, action: StoreJobAction) => {
      if (submittingStoreItemId !== null) {
        return;
      }

      setSubmittingStoreItemId(item.id);
      const result = await submitStoreAction(item.id, action);
      setSubmittingStoreItemId(null);

      if (!result.ok) {
        showToast(result.error, 'error');
        return;
      }

      // Optimistically mark job as queued so UI shows "Waiting…" and starts 2s polling immediately
      const queuedJob = { action, state: 'queued' as const, message: '' };
      prevStoreJobsRef.current = {
        ...prevStoreJobsRef.current,
        [item.id]: queuedJob,
      };
      setStoreItems((prev) =>
        prev.map((entry) =>
          entry.id === item.id ? { ...entry, job: queuedJob } : entry
        )
      );

      void loadStore({ silent: true });
    },
    [submittingStoreItemId, showToast, loadStore]
  );

  const handleResetFocus = useCallback(() => {
    setActivePreviewSource(null);
    setPreviewHeroIndex(0);
    if (showEmptyOrErrorScreen) {
      setFocus({ zone: 'retry' });
      return;
    }
    setFocus(
      heroItems.length > 0
        ? { zone: 'hero' }
        : { zone: 'row', rowIndex: 0, colIndex: 0 }
    );
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [showEmptyOrErrorScreen, heroItems.length]);

  const clearArmedPower = useCallback(() => {
    setArmedPowerAction(null);
    if (powerArmTimerRef.current !== null) {
      window.clearTimeout(powerArmTimerRef.current);
      powerArmTimerRef.current = null;
    }
  }, []);

  const clearForgetArm = useCallback(() => {
    setForgetPhonesArmed(false);
    if (forgetArmTimerRef.current !== null) {
      window.clearTimeout(forgetArmTimerRef.current);
      forgetArmTimerRef.current = null;
    }
  }, []);

  const loadRemoteInfo = useCallback(async () => {
    if (remoteFetchControllerRef.current) {
      remoteFetchControllerRef.current.abort();
    }
    const controller = new AbortController();
    remoteFetchControllerRef.current = controller;
    setRemoteLoading(true);

    try {
      const result = await fetchRemoteInfo(controller.signal);
      if (controller.signal.aborted) {
        return;
      }

      if (result.ok) {
        setRemoteInfo(result.data);
        setRemoteError(null);
        setRemoteSecondsLeft(Math.max(1, Math.ceil(result.data.expiresIn)));
      } else {
        setRemoteError(
          result.error ?? 'Unable to reach the xLab TV remote service.'
        );
      }
    } catch {
      // Aborted on panel close or unmount
    } finally {
      if (remoteFetchControllerRef.current === controller) {
        remoteFetchControllerRef.current = null;
        setRemoteLoading(false);
      }
    }
  }, []);

  const openPhoneRemote = useCallback(() => {
    clearArmedPower();
    clearForgetArm();
    setRemoteError(null);
    setPhoneRemoteOpen(true);
    void loadRemoteInfo();
  }, [clearArmedPower, clearForgetArm, loadRemoteInfo]);

  const closePhoneRemote = useCallback(() => {
    clearForgetArm();
    if (remoteFetchControllerRef.current) {
      remoteFetchControllerRef.current.abort();
      remoteFetchControllerRef.current = null;
    }
    setRemoteLoading(false);
    setPhoneRemoteOpen(false);
  }, [clearForgetArm]);

  // Live countdown for phone remote pairing code; auto-refetches GET /api/remote when it hits 0
  useEffect(() => {
    if (!phoneRemoteOpen || !remoteInfo) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setRemoteSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [phoneRemoteOpen, remoteInfo]);

  useEffect(() => {
    if (
      phoneRemoteOpen &&
      remoteInfo !== null &&
      remoteSecondsLeft === 0 &&
      !remoteLoading &&
      !remoteError
    ) {
      void loadRemoteInfo();
    }
  }, [
    phoneRemoteOpen,
    remoteInfo,
    remoteSecondsLeft,
    remoteLoading,
    remoteError,
    loadRemoteInfo,
  ]);

  const handlePhoneRemotePrimaryAction = useCallback(async () => {
    if (remoteError && !remoteInfo) {
      void loadRemoteInfo();
      return;
    }

    if (forgettingPhones || !remoteInfo) {
      return;
    }

    if (!forgetPhonesArmed) {
      clearForgetArm();
      setForgetPhonesArmed(true);
      forgetArmTimerRef.current = window.setTimeout(() => {
        setForgetPhonesArmed(false);
        forgetArmTimerRef.current = null;
      }, POWER_ARM_TIMEOUT_MS);
      return;
    }

    clearForgetArm();
    setForgettingPhones(true);
    const result = await forgetAllPhones();
    setForgettingPhones(false);

    if (!result.ok) {
      showToast(result.error, 'error');
      return;
    }

    showToast('All paired phones forgotten.', 'info');
    void loadRemoteInfo();
  }, [
    remoteError,
    remoteInfo,
    forgettingPhones,
    forgetPhonesArmed,
    clearForgetArm,
    loadRemoteInfo,
    showToast,
  ]);

  const closeSettings = useCallback(() => {
    clearArmedPower();
    closePhoneRemote();
    setSettingsOpen(false);
  }, [clearArmedPower, closePhoneRemote]);

  const openSettings = useCallback(() => {
    clearArmedPower();
    setSettingsFocusIndex(0);
    setSettingsOpen(true);
  }, [clearArmedPower]);

  const handleSettingsFocusChange = useCallback(
    (nextIndex: number) => {
      setSettingsFocusIndex(nextIndex);
      const focusedPower =
        nextIndex >= 1 && nextIndex <= POWER_OPTIONS.length
          ? POWER_OPTIONS[nextIndex - 1]?.action ?? null
          : null;
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

  // Shared launcher for card or hero Open/Resume button -> POST /api/launch
  const executeLaunch = useCallback(
    async (
      id: string,
      displayName: string,
      restoreFocus: FocusState,
      focusItemId?: string
    ) => {
      if (launchingRequestId !== null || activeOverlayId !== null) {
        return;
      }

      setLaunchingRequestId(id);
      lastLaunchedFocusRef.current = restoreFocus;
      lastLaunchedItemIdRef.current = focusItemId ?? id;

      const result = await launchApp(id);
      setLaunchingRequestId(null);

      if (!result.ok) {
        lastLaunchedFocusRef.current = null;
        lastLaunchedItemIdRef.current = null;
        showToast(result.error, 'error');
        return;
      }

      setPendingLaunch({ id, name: displayName });
    },
    [launchingRequestId, activeOverlayId, showToast]
  );

  const handleOpenHero = useCallback(
    (item: HeroItem) => {
      const targetId =
        item.kind === 'media' ? item.id || item.appId : item.appId || item.id;
      const displayName = item.title || resolveDisplayName(targetId);
      void executeLaunch(targetId, displayName, { zone: 'hero' }, item.id);
    },
    [executeLaunch, resolveDisplayName]
  );

  const handleOpenCard = useCallback(
    (item: RowItem, rowIndex: number, colIndex: number) => {
      if (item.id === STORE_CARD_ID) {
        openStore({ zone: 'row', rowIndex, colIndex });
        return;
      }
      void executeLaunch(
        item.id,
        item.name,
        {
          zone: 'row',
          rowIndex,
          colIndex,
        },
        item.id
      );
    },
    [openStore, executeLaunch]
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
        if (phoneRemoteOpen || settingsOpen) {
          closeSettings();
        } else {
          openSettings();
        }
        return;
      }

      // 0. Phone Remote Pairing Panel spatial focus (Back closes, Activate triggers primary button)
      if (phoneRemoteOpen) {
        if (action === 'back') {
          closePhoneRemote();
          return;
        }
        if (action === 'activate') {
          void handlePhoneRemotePrimaryAction();
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
          if (settingsFocusIndex === 0) {
            openPhoneRemote();
          } else if (
            settingsFocusIndex >= 1 &&
            settingsFocusIndex <= POWER_OPTIONS.length
          ) {
            const powerOpt = POWER_OPTIONS[settingsFocusIndex - 1];
            if (powerOpt) {
              void handleTriggerPower(powerOpt.action);
            }
          } else if (settingsFocusIndex === 5) {
            setSettings((s) => ({ ...s, use24HourClock: !s.use24HourClock }));
          } else if (settingsFocusIndex === 6) {
            setSettings((s) => ({ ...s, autoAdvanceHero: !s.autoAdvanceHero }));
          } else if (settingsFocusIndex === 7) {
            setSettings((s) => ({ ...s, showSubtitles: !s.showSubtitles }));
          } else if (settingsFocusIndex === 8) {
            setSettings((s) => ({ ...s, showNavHints: !s.showNavHints }));
          }
        }
        return;
      }

      // 2. Store Detail Panel spatial focus (one focusable button + Back)
      if (storeOpen && selectedStoreItem) {
        if (action === 'back') {
          setSelectedStoreItemId(null);
          return;
        }
        if (action === 'activate') {
          const isBusy =
            selectedStoreItem.job?.state === 'queued' ||
            selectedStoreItem.job?.state === 'running' ||
            submittingStoreItemId !== null;
          if (!isBusy) {
            void handleStoreAction(
              selectedStoreItem,
              selectedStoreItem.installed ? 'remove' : 'install'
            );
          }
        }
        return;
      }

      // 3. Full-Screen Store View spatial focus
      if (storeOpen) {
        if (action === 'back') {
          closeStore();
          return;
        }

        if (storeError !== null || storeRows.length === 0) {
          if (action === 'activate') {
            void loadStore({ isManualRetry: true });
          }
          return;
        }

        const currentRow = storeRows[storeFocus.rowIndex];
        if (!currentRow) {
          handleFocusStoreCard(0, 0);
          return;
        }

        if (action === 'left') {
          handleFocusStoreCard(
            storeFocus.rowIndex,
            Math.max(0, storeFocus.colIndex - 1)
          );
        } else if (action === 'right') {
          handleFocusStoreCard(
            storeFocus.rowIndex,
            Math.min(currentRow.items.length - 1, storeFocus.colIndex + 1)
          );
        } else if (action === 'up') {
          if (storeFocus.rowIndex > 0) {
            const nextRowIdx = storeFocus.rowIndex - 1;
            const nextRow = storeRows[nextRowIdx];
            const rememberedCol = storeRowMemory[nextRowIdx] ?? 0;
            const clampedCol = Math.min(
              rememberedCol,
              Math.max(0, nextRow.items.length - 1)
            );
            handleFocusStoreCard(nextRowIdx, clampedCol);
          }
        } else if (action === 'down') {
          if (storeFocus.rowIndex < storeRows.length - 1) {
            const nextRowIdx = storeFocus.rowIndex + 1;
            const nextRow = storeRows[nextRowIdx];
            const rememberedCol = storeRowMemory[nextRowIdx] ?? 0;
            const clampedCol = Math.min(
              rememberedCol,
              Math.max(0, nextRow.items.length - 1)
            );
            handleFocusStoreCard(nextRowIdx, clampedCol);
          }
        } else if (action === 'activate') {
          const item = currentRow.items[storeFocus.colIndex];
          if (item) {
            setSelectedStoreItemId(item.id);
          }
        }
        return;
      }

      // 4. Empty / API failure screen spatial focus (Retry button <-> TopBar)
      if (showEmptyOrErrorScreen) {
        if (action === 'back') {
          setFocus({ zone: 'retry' });
          return;
        }
        if (action === 'up') {
          handleFocusTopBar(lastTopBarButtonRef.current);
          return;
        }
        if (action === 'down') {
          setFocus({ zone: 'retry' });
          return;
        }
        if (focus.zone === 'topbar') {
          if (action === 'left') {
            handleFocusTopBar('store');
            return;
          }
          if (action === 'right') {
            handleFocusTopBar('settings');
            return;
          }
        }
        if (action === 'activate') {
          if (focus.zone === 'topbar') {
            if (focus.button === 'store') {
              openStore({ zone: 'topbar', button: 'store' });
            } else {
              openSettings();
            }
          } else {
            void loadApps({ isManualRetry: true });
          }
        }
        return;
      }

      // 5. Main Home Launcher spatial focus
      if (action === 'back') {
        handleResetFocus();
        return;
      }

      if (action === 'activate') {
        if (focus.zone === 'topbar') {
          if (focus.button === 'store') {
            openStore({ zone: 'topbar', button: 'store' });
          } else {
            openSettings();
          }
        } else if (focus.zone === 'hero') {
          const active = displayedHeroItems[displayedHeroIndex];
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
        if (action === 'left') {
          handleFocusTopBar('store');
        } else if (action === 'right') {
          handleFocusTopBar('settings');
        } else if (action === 'down') {
          if (displayedHeroItems.length > 0) {
            setFocus({ zone: 'hero' });
          } else if (rows.length > 0) {
            handleFocusCard(0, rowMemory[0] ?? 0);
          }
        }
        return;
      }

      if (focus.zone === 'hero') {
        if (action === 'up') {
          handleFocusTopBar(lastTopBarButtonRef.current);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (action === 'down' && rows.length > 0) {
          if (activePreviewInfo) {
            handleFocusCard(
              activePreviewInfo.rowIndex,
              activePreviewInfo.colIndex
            );
          } else {
            const savedCol = rowMemory[0] ?? 0;
            const clampedCol = Math.min(
              savedCol,
              Math.max(0, rows[0].items.length - 1)
            );
            handleFocusCard(0, clampedCol);
          }
        } else if (action === 'left' && displayedHeroItems.length > 1) {
          if (activePreviewInfo) {
            setPreviewHeroIndex(
              (prev) =>
                (prev - 1 + displayedHeroItems.length) %
                displayedHeroItems.length
            );
          } else {
            setHeroIndex(
              (prev) => (prev - 1 + heroItems.length) % heroItems.length
            );
          }
        } else if (action === 'right' && displayedHeroItems.length > 1) {
          if (activePreviewInfo) {
            setPreviewHeroIndex(
              (prev) => (prev + 1) % displayedHeroItems.length
            );
          } else {
            setHeroIndex((prev) => (prev + 1) % heroItems.length);
          }
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
        // When an app card's previews are currently shown in the hero, Up jumps straight to its hero button
        if (
          activePreviewInfo &&
          activePreviewInfo.rowIndex === focus.rowIndex &&
          activePreviewInfo.colIndex === focus.colIndex
        ) {
          setFocus({ zone: 'hero' });
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (focus.rowIndex === 0) {
          if (activePreviewInfo) {
            setActivePreviewSource(null);
            setPreviewHeroIndex(0);
          }
          if (heroItems.length > 0) {
            setFocus({ zone: 'hero' });
          } else {
            handleFocusTopBar(lastTopBarButtonRef.current);
          }
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
      phoneRemoteOpen,
      settingsOpen,
      settingsFocusIndex,
      storeOpen,
      selectedStoreItem,
      submittingStoreItemId,
      storeError,
      storeRows,
      storeFocus,
      storeRowMemory,
      showEmptyOrErrorScreen,
      focus,
      heroIndex,
      heroItems,
      displayedHeroItems,
      displayedHeroIndex,
      activePreviewInfo,
      rows,
      rowMemory,
      openSettings,
      closeSettings,
      openPhoneRemote,
      closePhoneRemote,
      handlePhoneRemotePrimaryAction,
      handleSettingsFocusChange,
      handleTriggerPower,
      handleStoreAction,
      closeStore,
      loadStore,
      handleFocusStoreCard,
      openStore,
      handleFocusTopBar,
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

  // Hero auto-advance (8 s for active app previews; 8.5 s for default hero when no static backdrop override)
  useEffect(() => {
    const isPreviewMode = activePreviewInfo !== null;
    if (
      !settings.autoAdvanceHero ||
      displayedHeroItems.length <= 1 ||
      settingsOpen ||
      phoneRemoteOpen ||
      storeOpen ||
      activeOverlayId !== null ||
      screensaverActive ||
      showEmptyOrErrorScreen ||
      (!isPreviewMode && focusedItemBackdrop !== null)
    ) {
      return;
    }

    const slideCount = displayedHeroItems.length;
    const delayMs = isPreviewMode ? PREVIEW_AUTO_ADVANCE_MS : 8500;

    const timer = window.setInterval(() => {
      if (isPreviewMode) {
        setPreviewHeroIndex((prev) => (prev + 1) % slideCount);
      } else {
        setHeroIndex((prev) => (prev + 1) % slideCount);
      }
    }, delayMs);

    return () => window.clearInterval(timer);
  }, [
    settings.autoAdvanceHero,
    activePreviewInfo,
    displayedHeroItems.length,
    displayedHeroIndex,
    settingsOpen,
    phoneRemoteOpen,
    storeOpen,
    activeOverlayId,
    screensaverActive,
    showEmptyOrErrorScreen,
    focusedItemBackdrop,
  ]);

  const screensaverBackdrops = heroItems.length > 0 ? heroItems : mockData.hero;
  const homeInteractive =
    !settingsOpen &&
    !phoneRemoteOpen &&
    !storeOpen &&
    !screensaverActive &&
    activeOverlayId === null;

  return (
    <div className="relative min-h-screen w-full bg-[#090B10] text-[#F1F5F9]">
      {/* Top Bar */}
      <TopBar
        use24HourClock={settings.use24HourClock}
        focusedButton={
          homeInteractive && focus.zone === 'topbar' ? focus.button : null
        }
        onFocusStore={() => handleFocusTopBar('store')}
        onOpenStore={() => openStore({ zone: 'topbar', button: 'store' })}
        onFocusSettings={() => handleFocusTopBar('settings')}
        onOpenSettings={openSettings}
      />

      {/* Main 10-Foot Launcher Canvas or Friendly Empty/Error State */}
      {showEmptyOrErrorScreen ? (
        <main>
          <EmptyErrorState
            title={
              apiErrorMessage
                ? 'xLab TV service unavailable'
                : 'No apps available'
            }
            description={
              apiErrorMessage ??
              'Your app library is currently empty. Check your xLab TV configuration or press Retry to reload.'
            }
            retrying={retryingApps}
            isRetryFocused={homeInteractive && focus.zone !== 'topbar'}
            onFocusRetry={() => setFocus({ zone: 'retry' })}
            onRetry={() => void loadApps({ isManualRetry: true })}
          />
        </main>
      ) : (
        <main className="pb-16">
          <HeroBanner
            items={displayedHeroItems}
            activeIndex={displayedHeroIndex}
            isHeroFocused={homeInteractive && focus.zone === 'hero'}
            overrideBackdrop={focusedItemBackdrop}
            appNameById={appNameById}
            appColorById={appColorById}
            fallbackAppColor={activePreviewInfo?.app.color}
            onFocusHero={() => setFocus({ zone: 'hero' })}
            onOpenHero={handleOpenHero}
          />

          {/* Quiet source caption under the hero while an app with previews is active */}
          <div
            aria-live="polite"
            className={`px-16 pt-2 text-[1.05rem] leading-tight font-medium text-[#94A3B8] transition-opacity duration-200 ${
              activePreviewInfo ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {activePreviewInfo ? `From ${activePreviewInfo.app.name}` : '\u00A0'}
          </div>

          {/* Horizontal Content & App Rows */}
          <div className="relative z-20 mt-2 space-y-6">
            {rows.map((row, rowIndex) => (
              <ContentRow
                key={row.title}
                row={row}
                rowIndex={rowIndex}
                isRowFocused={
                  homeInteractive &&
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

      {/* Full-Screen Store View */}
      {storeOpen && (
        <StoreView
          rows={storeRows}
          use24HourClock={settings.use24HourClock}
          showSubtitles={settings.showSubtitles}
          activeJobCount={activeStoreJobCount}
          errorMessage={storeError}
          retrying={retryingStore}
          focusedRowIndex={storeFocus.rowIndex}
          focusedColIndex={storeFocus.colIndex}
          rowMemory={storeRowMemory}
          isGridActive={
            !settingsOpen &&
            !phoneRemoteOpen &&
            !screensaverActive &&
            activeOverlayId === null &&
            selectedStoreItem === null
          }
          onFocusCard={handleFocusStoreCard}
          onSelectCard={(item, rowIndex, colIndex) => {
            handleFocusStoreCard(rowIndex, colIndex);
            setSelectedStoreItemId(item.id);
          }}
          onRetry={() => void loadStore({ isManualRetry: true })}
          onClose={closeStore}
        />
      )}

      {/* Store Item Detail Panel */}
      {storeOpen && selectedStoreItem && (
        <StoreDetailPanel
          item={selectedStoreItem}
          submitting={submittingStoreItemId === selectedStoreItem.id}
          onAction={(item, action) => void handleStoreAction(item, action)}
          onClose={() => setSelectedStoreItemId(null)}
        />
      )}

      {/* Settings Side Panel with Phone Remote, Sleep, Restart, Shut down, Exit to desktop */}
      <SettingsDrawer
        isOpen={settingsOpen}
        focusedIndex={settingsFocusIndex}
        armedPowerAction={armedPowerAction}
        pendingPowerAction={pendingPowerAction}
        settings={settings}
        onFocusIndex={handleSettingsFocusChange}
        onOpenPhoneRemote={openPhoneRemote}
        onTriggerPower={(action) => void handleTriggerPower(action)}
        onUpdateSettings={(patch) =>
          setSettings((prev) => ({ ...prev, ...patch }))
        }
        onClose={closeSettings}
      />

      {/* TV Phone Remote Pairing Panel */}
      <PhoneRemotePanel
        isOpen={phoneRemoteOpen}
        info={remoteInfo}
        loading={remoteLoading}
        error={remoteError}
        secondsLeft={remoteSecondsLeft}
        forgetArmed={forgetPhonesArmed}
        forgetting={forgettingPhones}
        onTriggerPrimary={() => void handlePhoneRemotePrimaryAction()}
        onClose={closePhoneRemote}
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

      {/* Error & Job Completion Toast */}
      <Toast toast={toast} />
    </div>
  );
}
