import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowUpCircle,
  Bluetooth,
  Cable,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  LogOut,
  Monitor,
  Moon,
  Power,
  RefreshCw,
  RotateCw,
  Search,
  Smartphone,
  Speaker,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  fetchAudioSettings,
  fetchBluetoothSettings,
  fetchHiddenApps,
  fetchWifiSettings,
  openUbuntuSettings,
  postAudioAction,
  postBluetoothAction,
  postWifiAction,
  setAppHidden,
  type PowerAction,
} from '../api';
import type { SpatialAction } from '../hooks/useGamepadInput';
import type {
  AudioSettingsState,
  BluetoothDevice,
  BluetoothSettingsState,
  HiddenAppItem,
  UpdatesInfo,
  WifiNetwork,
  WifiSettingsState,
} from '../mock';

export interface LauncherSettings {
  use24HourClock: boolean;
  autoAdvanceHero: boolean;
  showSubtitles: boolean;
  showNavHints: boolean;
}

export interface PowerOptionConfig {
  action: PowerAction;
  label: string;
  description: string;
  confirmLabel: string;
  confirmDescription: string;
}

export const POWER_OPTIONS: PowerOptionConfig[] = [
  {
    action: 'suspend',
    label: 'Sleep',
    description: 'Suspend HTPC to low-power standby',
    confirmLabel: 'Press again to sleep',
    confirmDescription: 'Confirm suspend via local power service',
  },
  {
    action: 'reboot',
    label: 'Restart',
    description: 'Reboot Linux and return to xLab TV',
    confirmLabel: 'Press again to restart',
    confirmDescription: 'Confirm full system reboot',
  },
  {
    action: 'poweroff',
    label: 'Shut down',
    description: 'Power off the living-room HTPC safely',
    confirmLabel: 'Press again to shut down',
    confirmDescription: 'Confirm full power off',
  },
  {
    action: 'exit',
    label: 'Exit to desktop',
    description: 'Leave xLab TV and return to the Linux desktop',
    confirmLabel: 'Press again to exit to desktop',
    confirmDescription: 'Confirm closing the xLab TV launcher session',
  },
];

type SettingsView = 'root' | 'wifi' | 'bluetooth' | 'sound' | 'display' | 'hidden';

type RootItemId =
  | 'updates'
  | 'wifi'
  | 'bluetooth'
  | 'sound'
  | 'display'
  | 'hidden'
  | 'phone_remote'
  | 'power_suspend'
  | 'power_reboot'
  | 'power_poweroff'
  | 'power_exit';

type WifiPrompt =
  | { type: 'password'; network: WifiNetwork }
  | { type: 'disconnect'; network: WifiNetwork };

export interface SettingsDrawerHandle {
  handleAction: (action: SpatialAction) => void;
}

interface SettingsDrawerProps {
  isOpen: boolean;
  updates: UpdatesInfo | null;
  armedPowerAction: PowerAction | null;
  pendingPowerAction: PowerAction | null;
  settings: LauncherSettings;
  onClearArmedPower: () => void;
  onLaunchUpdates: () => void;
  onOpenPhoneRemote: () => void;
  onTriggerPower: (action: PowerAction) => void;
  onUpdateSettings: (patch: Partial<LauncherSettings>) => void;
  onAppsChanged: () => void;
  onNotify: (text: string, tone?: 'error' | 'info') => void;
  onClose: () => void;
}

function PowerIcon({ action }: { action: PowerAction }) {
  switch (action) {
    case 'suspend':
      return <Moon className="h-[1.3rem] w-[1.3rem] shrink-0" strokeWidth={2} />;
    case 'reboot':
      return (
        <RotateCw className="h-[1.3rem] w-[1.3rem] shrink-0" strokeWidth={2} />
      );
    case 'poweroff':
      return <Power className="h-[1.3rem] w-[1.3rem] shrink-0" strokeWidth={2} />;
    case 'exit':
      return <LogOut className="h-[1.3rem] w-[1.3rem] shrink-0" strokeWidth={2} />;
  }
}

function SignalBars({ signal }: { signal: number }) {
  const activeBars =
    signal >= 75 ? 4 : signal >= 50 ? 3 : signal >= 25 ? 2 : signal > 0 ? 1 : 0;
  const heights = ['h-1.5', 'h-2.5', 'h-3.5', 'h-4.5'];

  return (
    <span
      aria-label={`Signal strength ${signal}%`}
      className="inline-flex items-end gap-[2px]"
    >
      {heights.map((heightClass, i) => (
        <span
          key={heightClass}
          className={`w-[3px] rounded-full ${heightClass} ${
            i < activeBars ? 'bg-[#E2E8F0]' : 'bg-white/20'
          }`}
        />
      ))}
    </span>
  );
}

function formatUpdatesBreakdown(updates: UpdatesInfo): string {
  const parts: string[] = [];
  const hasXlabTv =
    typeof updates.xlabtv === 'number'
      ? updates.xlabtv > 0
      : Boolean(updates.xlabtv);
  if (hasXlabTv) {
    parts.push('xLab TV');
  }
  if (updates.apps > 0) {
    parts.push(
      updates.apps === 1 ? '1 app update' : `${updates.apps} app updates`
    );
  }
  if (updates.system > 0) {
    parts.push(
      updates.system === 1
        ? '1 Ubuntu update'
        : `${updates.system} Ubuntu updates`
    );
  }
  return parts.length > 0
    ? parts.join(' · ')
    : `${updates.total} updates available`;
}

export const SettingsDrawer = forwardRef<
  SettingsDrawerHandle,
  SettingsDrawerProps
>(function SettingsDrawer(
  {
    isOpen,
    updates,
    armedPowerAction,
    pendingPowerAction,
    settings,
    onClearArmedPower,
    onLaunchUpdates,
    onOpenPhoneRemote,
    onTriggerPower,
    onUpdateSettings,
    onAppsChanged,
    onNotify,
    onClose,
  },
  ref
) {
  const [view, setView] = useState<SettingsView>('root');
  const [rootFocusIndex, setRootFocusIndex] = useState<number>(0);
  const [subFocusIndex, setSubFocusIndex] = useState<number>(0);

  // Quick Settings live state
  const [wifi, setWifi] = useState<WifiSettingsState | null>(null);
  const [wifiLoading, setWifiLoading] = useState<boolean>(false);
  const [wifiBusyLabel, setWifiBusyLabel] = useState<string | null>(null);
  const [wifiPrompt, setWifiPrompt] = useState<WifiPrompt | null>(null);
  const [wifiPassword, setWifiPassword] = useState<string>('');
  const [wifiPromptFocus, setWifiPromptFocus] = useState<number>(0);

  const [bluetooth, setBluetooth] = useState<BluetoothSettingsState | null>(null);
  const [btLoading, setBtLoading] = useState<boolean>(false);
  const [btBusyLabel, setBtBusyLabel] = useState<string | null>(null);
  const [btActionDevice, setBtActionDevice] = useState<BluetoothDevice | null>(
    null
  );
  const [btActionFocus, setBtActionFocus] = useState<number>(0);

  const [audio, setAudio] = useState<AudioSettingsState | null>(null);
  const [audioLoading, setAudioLoading] = useState<boolean>(false);

  const [hiddenApps, setHiddenApps] = useState<HiddenAppItem[]>([]);
  const [hiddenLoading, setHiddenLoading] = useState<boolean>(false);
  const [restoringAppId, setRestoringAppId] = useState<string | null>(null);

  const [openingUbuntuPage, setOpeningUbuntuPage] = useState<
    'display' | 'power' | null
  >(null);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  const hasUpdates = Boolean(updates && updates.total > 0);

  const rootItems = useMemo<RootItemId[]>(() => {
    const items: RootItemId[] = [];
    if (hasUpdates) {
      items.push('updates');
    }
    items.push(
      'wifi',
      'bluetooth',
      'sound',
      'display',
      'hidden',
      'phone_remote',
      'power_suspend',
      'power_reboot',
      'power_poweroff',
      'power_exit'
    );
    return items;
  }, [hasUpdates]);

  const loadWifi = useCallback(async (signal?: AbortSignal) => {
    setWifiLoading(true);
    try {
      const res = await fetchWifiSettings(signal);
      if (!signal?.aborted && res.ok) {
        setWifi(res.data);
      }
    } catch {
      // Aborted
    } finally {
      if (!signal?.aborted) {
        setWifiLoading(false);
      }
    }
  }, []);

  const loadBluetooth = useCallback(async (signal?: AbortSignal) => {
    setBtLoading(true);
    try {
      const res = await fetchBluetoothSettings(signal);
      if (!signal?.aborted && res.ok) {
        setBluetooth(res.data);
      }
    } catch {
      // Aborted
    } finally {
      if (!signal?.aborted) {
        setBtLoading(false);
      }
    }
  }, []);

  const loadAudio = useCallback(async (signal?: AbortSignal) => {
    setAudioLoading(true);
    try {
      const res = await fetchAudioSettings(signal);
      if (!signal?.aborted && res.ok) {
        setAudio(res.data);
      }
    } catch {
      // Aborted
    } finally {
      if (!signal?.aborted) {
        setAudioLoading(false);
      }
    }
  }, []);

  const loadHidden = useCallback(async (signal?: AbortSignal) => {
    setHiddenLoading(true);
    try {
      const res = await fetchHiddenApps(signal);
      if (!signal?.aborted && res.ok) {
        setHiddenApps(res.data.apps);
      }
    } catch {
      // Aborted
    } finally {
      if (!signal?.aborted) {
        setHiddenLoading(false);
      }
    }
  }, []);

  // Reset to root and fetch live summaries whenever the Quick Settings drawer opens
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setView('root');
    setRootFocusIndex(0);
    setSubFocusIndex(0);
    setWifiPrompt(null);
    setWifiPassword('');
    setBtActionDevice(null);

    const controller = new AbortController();
    void Promise.all([
      loadWifi(controller.signal),
      loadBluetooth(controller.signal),
      loadAudio(controller.signal),
      loadHidden(controller.signal),
    ]);

    return () => controller.abort();
  }, [isOpen, loadWifi, loadBluetooth, loadAudio, loadHidden]);

  // Clamp rootFocusIndex if updates availability changes while open
  useEffect(() => {
    setRootFocusIndex((prev) => Math.min(prev, Math.max(0, rootItems.length - 1)));
  }, [rootItems.length]);

  // Focus the password input cleanly when entering password prompt at index 0
  useEffect(() => {
    if (isOpen && wifiPrompt?.type === 'password' && wifiPromptFocus === 0) {
      window.setTimeout(() => {
        passwordInputRef.current?.focus();
      }, 20);
    } else if (
      document.activeElement &&
      document.activeElement === passwordInputRef.current
    ) {
      passwordInputRef.current.blur();
    }
  }, [isOpen, wifiPrompt, wifiPromptFocus]);

  // Keep the currently focused drawer item scrolled into view
  useEffect(() => {
    if (!isOpen || !scrollContainerRef.current) {
      return;
    }
    const activeEl = scrollContainerRef.current.querySelector<HTMLElement>(
      '[data-qs-focused="true"]'
    );
    activeEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [
    isOpen,
    view,
    rootFocusIndex,
    subFocusIndex,
    wifiPrompt,
    wifiPromptFocus,
    btActionDevice,
    btActionFocus,
  ]);

  const setRootFocusWithPowerReset = useCallback(
    (nextIndex: number) => {
      const clamped = Math.max(0, Math.min(rootItems.length - 1, nextIndex));
      setRootFocusIndex(clamped);
      const itemId = rootItems[clamped];
      const focusedPower: PowerAction | null =
        itemId === 'power_suspend'
          ? 'suspend'
          : itemId === 'power_reboot'
            ? 'reboot'
            : itemId === 'power_poweroff'
              ? 'poweroff'
              : itemId === 'power_exit'
                ? 'exit'
                : null;
      if (armedPowerAction && focusedPower !== armedPowerAction) {
        onClearArmedPower();
      }
    },
    [rootItems, armedPowerAction, onClearArmedPower]
  );

  // ---- Wi-Fi actions ----
  const handleWifiPowerToggle = useCallback(async () => {
    if (!wifi || wifiBusyLabel !== null) return;
    setWifiBusyLabel(wifi.enabled ? 'Turning off Wi-Fi…' : 'Turning on Wi-Fi…');
    const res = await postWifiAction({ action: 'power', on: !wifi.enabled });
    setWifiBusyLabel(null);
    if (!res.ok) {
      onNotify(res.error, 'error');
      return;
    }
    setWifi(res.data);
  }, [wifi, wifiBusyLabel, onNotify]);

  const handleWifiRescan = useCallback(async () => {
    if (wifiBusyLabel !== null) return;
    setWifiBusyLabel('Scanning for networks…');
    const res = await postWifiAction({ action: 'rescan' });
    setWifiBusyLabel(null);
    if (!res.ok) {
      onNotify(res.error, 'error');
      return;
    }
    setWifi(res.data);
  }, [wifiBusyLabel, onNotify]);

  const handleWifiConnect = useCallback(
    async (ssid: string, password: string) => {
      if (wifiBusyLabel !== null) return;
      passwordInputRef.current?.blur();
      setWifiBusyLabel(`Joining ${ssid}…`);
      const res = await postWifiAction({ action: 'connect', ssid, password });
      setWifiBusyLabel(null);
      if (!res.ok) {
        onNotify(res.error, 'error');
        return;
      }
      setWifi(res.data);
      setWifiPrompt(null);
      setWifiPassword('');
      onNotify(`Connected to ${ssid}`, 'info');
    },
    [wifiBusyLabel, onNotify]
  );

  const handleWifiDisconnect = useCallback(async () => {
    if (wifiBusyLabel !== null) return;
    setWifiBusyLabel('Disconnecting…');
    const res = await postWifiAction({ action: 'disconnect' });
    setWifiBusyLabel(null);
    if (!res.ok) {
      onNotify(res.error, 'error');
      return;
    }
    setWifi(res.data);
    setWifiPrompt(null);
    onNotify('Disconnected from Wi-Fi', 'info');
  }, [wifiBusyLabel, onNotify]);

  // ---- Bluetooth actions ----
  const handleBtPowerToggle = useCallback(async () => {
    if (!bluetooth || btBusyLabel !== null) return;
    setBtBusyLabel(
      bluetooth.powered ? 'Turning off Bluetooth…' : 'Turning on Bluetooth…'
    );
    const res = await postBluetoothAction({
      action: 'power',
      on: !bluetooth.powered,
    });
    setBtBusyLabel(null);
    if (!res.ok) {
      onNotify(res.error, 'error');
      return;
    }
    setBluetooth(res.data);
  }, [bluetooth, btBusyLabel, onNotify]);

  const handleBtScan = useCallback(async () => {
    if (btBusyLabel !== null) return;
    setBtBusyLabel('Searching for devices…');
    const res = await postBluetoothAction({ action: 'scan' });
    setBtBusyLabel(null);
    if (!res.ok) {
      onNotify(res.error, 'error');
      return;
    }
    setBluetooth(res.data);
  }, [btBusyLabel, onNotify]);

  const handleBtDeviceAction = useCallback(
    async (
      action: 'pair' | 'connect' | 'disconnect' | 'remove',
      device: BluetoothDevice
    ) => {
      if (btBusyLabel !== null) return;
      const labels: Record<typeof action, string> = {
        pair: `Pairing ${device.name}…`,
        connect: `Connecting ${device.name}…`,
        disconnect: `Disconnecting ${device.name}…`,
        remove: `Forgetting ${device.name}…`,
      };
      setBtBusyLabel(labels[action]);
      const res = await postBluetoothAction({ action, mac: device.mac });
      setBtBusyLabel(null);
      if (!res.ok) {
        onNotify(res.error, 'error');
        return;
      }
      setBluetooth(res.data);
      setBtActionDevice(null);
      if (action === 'pair') {
        onNotify(`Paired ${device.name}`, 'info');
      } else if (action === 'remove') {
        onNotify(`Forgot ${device.name}`, 'info');
      }
    },
    [btBusyLabel, onNotify]
  );

  // ---- Audio actions ----
  const handleAudioAction = useCallback(
    async (
      payload:
        | { action: 'up' }
        | { action: 'down' }
        | { action: 'mute' }
        | { action: 'output'; id: string }
    ) => {
      const res = await postAudioAction(payload);
      if (!res.ok) {
        onNotify(res.error, 'error');
        return;
      }
      setAudio(res.data);
    },
    [onNotify]
  );

  // ---- Display / Ubuntu Settings ----
  const handleOpenUbuntu = useCallback(
    async (page: 'display' | 'power') => {
      if (openingUbuntuPage !== null) return;
      setOpeningUbuntuPage(page);
      const res = await openUbuntuSettings(page);
      setOpeningUbuntuPage(null);
      if (!res.ok) {
        onNotify(res.error, 'error');
        return;
      }
      onNotify(
        page === 'display'
          ? 'Opening Ubuntu Display settings…'
          : 'Opening Ubuntu Power settings…',
        'info'
      );
    },
    [openingUbuntuPage, onNotify]
  );

  // ---- Hidden Apps ----
  const handleRestoreHiddenApp = useCallback(
    async (app: HiddenAppItem) => {
      if (restoringAppId !== null) return;
      setRestoringAppId(app.id);
      const res = await setAppHidden(app.id, false, app.name);
      setRestoringAppId(null);
      if (!res.ok) {
        onNotify(res.error, 'error');
        return;
      }
      setHiddenApps((prev) => prev.filter((item) => item.id !== app.id));
      setSubFocusIndex((prev) => Math.max(0, prev - 1));
      onAppsChanged();
      onNotify(`${app.name} shown on home`, 'info');
      void loadHidden();
    },
    [restoringAppId, onAppsChanged, onNotify, loadHidden]
  );

  // Open a sub-view and refresh its data
  const enterView = useCallback(
    (next: SettingsView) => {
      onClearArmedPower();
      setView(next);
      setSubFocusIndex(0);
      setWifiPrompt(null);
      setWifiPassword('');
      setBtActionDevice(null);
      if (next === 'wifi') void loadWifi();
      if (next === 'bluetooth') void loadBluetooth();
      if (next === 'sound') void loadAudio();
      if (next === 'hidden') void loadHidden();
    },
    [onClearArmedPower, loadWifi, loadBluetooth, loadAudio, loadHidden]
  );

  const returnToRoot = useCallback(() => {
    passwordInputRef.current?.blur();
    setWifiPrompt(null);
    setWifiPassword('');
    setBtActionDevice(null);
    setView('root');
  }, []);

  // Compute item counts for each sub-view so spatial navigation stays strictly in bounds
  const wifiNetworks = useMemo(
    () => (wifi?.enabled ? wifi.networks : []),
    [wifi]
  );
  const wifiItemCount = 2 + wifiNetworks.length; // 0: Power, 1: Scan, 2+: networks

  const btDevices = useMemo(
    () => (bluetooth?.available && bluetooth.powered ? bluetooth.devices : []),
    [bluetooth]
  );
  const btItemCount = bluetooth?.available ? 2 + btDevices.length : 0;

  const audioOutputs = useMemo(() => audio?.outputs ?? [], [audio]);
  const soundItemCount = 2 + audioOutputs.length; // 0: Volume, 1: Mute, 2+: outputs

  const displayItemCount = 6; // 0: Ubuntu Display, 1: Ubuntu Power, 2..5: Launcher toggles

  // Clamp subFocusIndex when lists shrink
  useEffect(() => {
    if (view === 'wifi') {
      setSubFocusIndex((prev) =>
        Math.min(prev, Math.max(0, wifiItemCount - 1))
      );
    } else if (view === 'bluetooth') {
      setSubFocusIndex((prev) => Math.min(prev, Math.max(0, btItemCount - 1)));
    } else if (view === 'sound') {
      setSubFocusIndex((prev) =>
        Math.min(prev, Math.max(0, soundItemCount - 1))
      );
    } else if (view === 'hidden') {
      setSubFocusIndex((prev) =>
        Math.min(prev, Math.max(0, hiddenApps.length - 1))
      );
    }
  }, [view, wifiItemCount, btItemCount, soundItemCount, hiddenApps.length]);

  const activateRootItem = useCallback(
    (itemId: RootItemId) => {
      switch (itemId) {
        case 'updates':
          onLaunchUpdates();
          return;
        case 'wifi':
          enterView('wifi');
          return;
        case 'bluetooth':
          enterView('bluetooth');
          return;
        case 'sound':
          enterView('sound');
          return;
        case 'display':
          enterView('display');
          return;
        case 'hidden':
          enterView('hidden');
          return;
        case 'phone_remote':
          onOpenPhoneRemote();
          return;
        case 'power_suspend':
          onTriggerPower('suspend');
          return;
        case 'power_reboot':
          onTriggerPower('reboot');
          return;
        case 'power_poweroff':
          onTriggerPower('poweroff');
          return;
        case 'power_exit':
          onTriggerPower('exit');
          return;
      }
    },
    [enterView, onLaunchUpdates, onOpenPhoneRemote, onTriggerPower]
  );

  // Spatial input handler invoked by App.tsx (Keyboard + Gamepad)
  useImperativeHandle(
    ref,
    () => ({
      handleAction: (action: SpatialAction) => {
        // 1. Root Quick Settings Menu
        if (view === 'root') {
          if (action === 'back') {
            onClose();
            return;
          }
          if (action === 'up') {
            setRootFocusWithPowerReset(rootFocusIndex - 1);
            return;
          }
          if (action === 'down') {
            setRootFocusWithPowerReset(rootFocusIndex + 1);
            return;
          }
          if (action === 'activate' || action === 'right') {
            const itemId = rootItems[rootFocusIndex];
            if (!itemId) return;
            // Only drill in on Right for section rows (not power actions)
            if (
              action === 'right' &&
              itemId.startsWith('power_')
            ) {
              return;
            }
            activateRootItem(itemId);
          }
          return;
        }

        // 2. Wi-Fi Sub-View
        if (view === 'wifi') {
          if (wifiPrompt) {
            if (action === 'back') {
              if (wifiBusyLabel === null) {
                passwordInputRef.current?.blur();
                setWifiPrompt(null);
                setWifiPassword('');
              }
              return;
            }
            if (wifiPrompt.type === 'disconnect') {
              if (action === 'activate') {
                void handleWifiDisconnect();
              }
              return;
            }
            // Password prompt: 0 = input, 1 = Join button
            if (action === 'up') {
              setWifiPromptFocus(0);
              return;
            }
            if (action === 'down') {
              passwordInputRef.current?.blur();
              setWifiPromptFocus(1);
              return;
            }
            if (action === 'activate') {
              if (wifiPromptFocus === 0) {
                passwordInputRef.current?.focus();
              } else {
                void handleWifiConnect(wifiPrompt.network.ssid, wifiPassword);
              }
            }
            return;
          }

          if (action === 'back') {
            returnToRoot();
            return;
          }
          if (action === 'up') {
            setSubFocusIndex((prev) => Math.max(0, prev - 1));
            return;
          }
          if (action === 'down') {
            setSubFocusIndex((prev) => Math.min(wifiItemCount - 1, prev + 1));
            return;
          }
          if (action === 'activate') {
            if (subFocusIndex === 0) {
              void handleWifiPowerToggle();
            } else if (subFocusIndex === 1) {
              void handleWifiRescan();
            } else {
              const net = wifiNetworks[subFocusIndex - 2];
              if (!net || wifiBusyLabel !== null) return;
              if (net.connected) {
                setWifiPrompt({ type: 'disconnect', network: net });
              } else if (net.secure) {
                setWifiPassword('');
                setWifiPromptFocus(0);
                setWifiPrompt({ type: 'password', network: net });
              } else {
                void handleWifiConnect(net.ssid, '');
              }
            }
          }
          return;
        }

        // 3. Bluetooth Sub-View
        if (view === 'bluetooth') {
          if (btActionDevice) {
            if (action === 'back') {
              if (btBusyLabel === null) {
                setBtActionDevice(null);
              }
              return;
            }
            if (action === 'up') {
              setBtActionFocus(0);
              return;
            }
            if (action === 'down') {
              setBtActionFocus(1);
              return;
            }
            if (action === 'activate') {
              if (btActionFocus === 0) {
                void handleBtDeviceAction(
                  btActionDevice.connected ? 'disconnect' : 'connect',
                  btActionDevice
                );
              } else {
                void handleBtDeviceAction('remove', btActionDevice);
              }
            }
            return;
          }

          if (action === 'back') {
            returnToRoot();
            return;
          }
          if (!bluetooth?.available) {
            return;
          }
          if (action === 'up') {
            setSubFocusIndex((prev) => Math.max(0, prev - 1));
            return;
          }
          if (action === 'down') {
            setSubFocusIndex((prev) => Math.min(btItemCount - 1, prev + 1));
            return;
          }
          if (action === 'activate') {
            if (subFocusIndex === 0) {
              void handleBtPowerToggle();
            } else if (subFocusIndex === 1) {
              void handleBtScan();
            } else {
              const dev = btDevices[subFocusIndex - 2];
              if (!dev || btBusyLabel !== null) return;
              if (!dev.paired) {
                void handleBtDeviceAction('pair', dev);
              } else {
                setBtActionFocus(0);
                setBtActionDevice(dev);
              }
            }
          }
          return;
        }

        // 4. Sound Sub-View
        if (view === 'sound') {
          if (action === 'back') {
            returnToRoot();
            return;
          }
          if (action === 'up') {
            setSubFocusIndex((prev) => Math.max(0, prev - 1));
            return;
          }
          if (action === 'down') {
            setSubFocusIndex((prev) => Math.min(soundItemCount - 1, prev + 1));
            return;
          }
          if (subFocusIndex === 0) {
            if (action === 'left') {
              void handleAudioAction({ action: 'down' });
            } else if (action === 'right') {
              void handleAudioAction({ action: 'up' });
            } else if (action === 'activate') {
              void handleAudioAction({ action: 'mute' });
            }
            return;
          }
          if (action === 'activate') {
            if (subFocusIndex === 1) {
              void handleAudioAction({ action: 'mute' });
            } else {
              const out = audioOutputs[subFocusIndex - 2];
              if (out) {
                void handleAudioAction({ action: 'output', id: out.id });
              }
            }
          }
          return;
        }

        // 5. Display & Power Sub-View
        if (view === 'display') {
          if (action === 'back') {
            returnToRoot();
            return;
          }
          if (action === 'up') {
            setSubFocusIndex((prev) => Math.max(0, prev - 1));
            return;
          }
          if (action === 'down') {
            setSubFocusIndex((prev) =>
              Math.min(displayItemCount - 1, prev + 1)
            );
            return;
          }
          if (action === 'activate') {
            if (subFocusIndex === 0) {
              void handleOpenUbuntu('display');
            } else if (subFocusIndex === 1) {
              void handleOpenUbuntu('power');
            } else if (subFocusIndex === 2) {
              onUpdateSettings({ use24HourClock: !settings.use24HourClock });
            } else if (subFocusIndex === 3) {
              onUpdateSettings({ autoAdvanceHero: !settings.autoAdvanceHero });
            } else if (subFocusIndex === 4) {
              onUpdateSettings({ showSubtitles: !settings.showSubtitles });
            } else if (subFocusIndex === 5) {
              onUpdateSettings({ showNavHints: !settings.showNavHints });
            }
          }
          return;
        }

        // 6. Hidden Apps Sub-View
        if (view === 'hidden') {
          if (action === 'back') {
            returnToRoot();
            return;
          }
          if (hiddenApps.length === 0) {
            return;
          }
          if (action === 'up') {
            setSubFocusIndex((prev) => Math.max(0, prev - 1));
            return;
          }
          if (action === 'down') {
            setSubFocusIndex((prev) =>
              Math.min(hiddenApps.length - 1, prev + 1)
            );
            return;
          }
          if (action === 'activate') {
            const app = hiddenApps[subFocusIndex];
            if (app) {
              void handleRestoreHiddenApp(app);
            }
          }
        }
      },
    }),
    [
      view,
      rootFocusIndex,
      rootItems,
      subFocusIndex,
      wifiPrompt,
      wifiPassword,
      wifiPromptFocus,
      wifiBusyLabel,
      wifiItemCount,
      wifiNetworks,
      btActionDevice,
      btActionFocus,
      btBusyLabel,
      bluetooth,
      btItemCount,
      btDevices,
      soundItemCount,
      audioOutputs,
      hiddenApps,
      settings,
      onClose,
      setRootFocusWithPowerReset,
      activateRootItem,
      returnToRoot,
      handleWifiDisconnect,
      handleWifiConnect,
      handleWifiPowerToggle,
      handleWifiRescan,
      handleBtDeviceAction,
      handleBtPowerToggle,
      handleBtScan,
      handleAudioAction,
      handleOpenUbuntu,
      onUpdateSettings,
      handleRestoreHiddenApp,
    ]
  );

  if (!isOpen) {
    return null;
  }

  // Root summary strings
  const wifiSummary = wifi
    ? wifi.ethernet && wifi.connected
      ? `Ethernet · ${wifi.connected.ssid}`
      : wifi.ethernet
        ? 'Ethernet connected'
        : !wifi.enabled
          ? 'Off'
          : wifi.connected
            ? wifi.connected.ssid
            : 'Not connected'
    : wifiLoading
      ? 'Checking…'
      : 'Manage networks';

  const btConnectedCount =
    bluetooth?.devices.filter((d) => d.connected).length ?? 0;
  const btSummary = bluetooth
    ? !bluetooth.available
      ? 'No Bluetooth adapter'
      : !bluetooth.powered
        ? 'Off'
        : btConnectedCount > 0
          ? `${btConnectedCount} connected`
          : 'On'
    : btLoading
      ? 'Checking…'
      : 'Pair controllers & audio';

  const defaultAudioOutput = audio?.outputs.find((o) => o.default);
  const soundSummary = audio
    ? audio.muted
      ? 'Muted'
      : `${audio.volume}%${defaultAudioOutput ? ` · ${defaultAudioOutput.name}` : ''}`
    : audioLoading
      ? 'Checking…'
      : 'Volume & outputs';

  const hiddenSummary =
    hiddenApps.length > 0
      ? `${hiddenApps.length} hidden ${hiddenApps.length === 1 ? 'app' : 'apps'}`
      : 'No hidden apps';

  const viewTitles: Record<SettingsView, string> = {
    root: 'Quick Settings',
    wifi: 'Wi-Fi',
    bluetooth: 'Bluetooth',
    sound: 'Sound',
    display: 'Display & Power',
    hidden: 'Hidden apps',
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={viewTitles[view]}
      className="fixed inset-0 z-50 flex justify-end"
    >
      {/* Opaque tinted scrim — zero backdrop-filter for Intel UHD 630 60fps */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-[#04060B]/76"
      />

      {/* Right-Side Quick Settings Panel */}
      <aside className="relative z-10 flex h-full w-full max-w-[38rem] flex-col border-l border-white/12 bg-[#0F131D] text-[#F1F5F9]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-9 py-7">
          <div className="flex min-w-0 items-center gap-3">
            {view !== 'root' && (
              <button
                type="button"
                onClick={returnToRoot}
                aria-label="Back to Quick Settings"
                className="flex h-[2.75rem] w-[2.75rem] shrink-0 items-center justify-center rounded-full border border-white/15 bg-[#171C28] text-[#E2E8F0] hover:bg-[#1F2636]"
              >
                <ChevronLeft className="h-[1.35rem] w-[1.35rem]" strokeWidth={2.2} />
              </button>
            )}
            <div className="min-w-0">
              <h2 className="truncate font-display text-[1.9rem] leading-tight font-bold tracking-[-0.02em] text-[#FFFFFF]">
                {viewTitles[view]}
              </h2>
              <p className="mt-0.5 text-[0.95rem] text-[#94A3B8]">
                {view === 'root'
                  ? 'xLab TV System & Connections'
                  : 'Press Back to return to Quick Settings'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Quick Settings"
            className="flex h-[2.85rem] w-[2.85rem] shrink-0 items-center justify-center rounded-full border border-white/15 bg-[#171C28] text-[#CBD5E1] hover:text-white focus:outline-none"
          >
            <X className="h-[1.35rem] w-[1.35rem]" strokeWidth={2.2} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto px-9 py-6"
        >
          {/* ================= ROOT VIEW ================= */}
          {view === 'root' && (
            <div className="space-y-6">
              {/* Updates Available Banner Row (only when total > 0) */}
              {hasUpdates && updates && (
                <div>
                  <h3 className="mb-2.5 text-[0.875rem] font-semibold tracking-[0.06em] text-[#38BDF8] uppercase">
                    Updates
                  </h3>
                  {(() => {
                    const idx = rootItems.indexOf('updates');
                    const isFocused = rootFocusIndex === idx;
                    return (
                      <button
                        type="button"
                        data-qs-focused={isFocused ? 'true' : undefined}
                        aria-current={isFocused ? 'true' : undefined}
                        onMouseEnter={() => setRootFocusWithPowerReset(idx)}
                        onFocus={() => setRootFocusWithPowerReset(idx)}
                        onClick={() => activateRootItem('updates')}
                        className={`tv-card relative flex w-full items-center justify-between gap-4 rounded-[1rem] border px-5 py-4 text-left focus:outline-none ${
                          isFocused
                            ? 'tv-btn-focused border-[#38BDF8]/50 bg-[#132436]'
                            : 'border-[#38BDF8]/30 bg-[#101C2B]'
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-4">
                          <div className="flex h-[2.75rem] w-[2.75rem] shrink-0 items-center justify-center rounded-[0.75rem] bg-[#38BDF8]/18 text-[#38BDF8]">
                            <ArrowUpCircle
                              className="h-[1.45rem] w-[1.45rem]"
                              strokeWidth={2}
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2.5">
                              <span className="text-[1.2rem] font-semibold text-[#FFFFFF]">
                                Updates available
                              </span>
                              <span className="rounded-full bg-[#38BDF8] px-2 py-0.5 text-[0.8125rem] font-bold text-[#06080D] tabular-nums">
                                {updates.total}
                              </span>
                            </div>
                            <div className="mt-0.5 truncate text-[0.95rem] text-[#BAE6FD]">
                              {formatUpdatesBreakdown(updates)}
                            </div>
                          </div>
                        </div>
                        <span className="shrink-0 rounded-[0.65rem] bg-[#38BDF8] px-3.5 py-1.5 text-[0.9375rem] font-bold text-[#06080D]">
                          Update
                        </span>
                        <span
                          aria-hidden="true"
                          className={`tv-focus-ring pointer-events-none absolute -inset-[3px] rounded-[1.08rem] border-[3px] border-[#38BDF8] ${
                            isFocused ? 'tv-focus-ring-active' : ''
                          }`}
                        />
                      </button>
                    );
                  })()}
                </div>
              )}

              {/* System & Connections */}
              <div>
                <h3 className="mb-2.5 text-[0.875rem] font-semibold tracking-[0.06em] text-[#94A3B8] uppercase">
                  System & Connections
                </h3>
                <div className="space-y-2.5">
                  {(
                    [
                      {
                        id: 'wifi' as const,
                        label: 'Wi-Fi',
                        summary: wifiSummary,
                        icon:
                          wifi && !wifi.enabled ? (
                            <WifiOff className="h-[1.3rem] w-[1.3rem]" strokeWidth={2} />
                          ) : (
                            <Wifi className="h-[1.3rem] w-[1.3rem]" strokeWidth={2} />
                          ),
                      },
                      {
                        id: 'bluetooth' as const,
                        label: 'Bluetooth',
                        summary: btSummary,
                        icon: (
                          <Bluetooth
                            className="h-[1.3rem] w-[1.3rem]"
                            strokeWidth={2}
                          />
                        ),
                      },
                      {
                        id: 'sound' as const,
                        label: 'Sound',
                        summary: soundSummary,
                        icon: audio?.muted ? (
                          <VolumeX className="h-[1.3rem] w-[1.3rem]" strokeWidth={2} />
                        ) : (
                          <Volume2 className="h-[1.3rem] w-[1.3rem]" strokeWidth={2} />
                        ),
                      },
                      {
                        id: 'display' as const,
                        label: 'Display & Power',
                        summary: 'Ubuntu settings & launcher display',
                        icon: (
                          <Monitor className="h-[1.3rem] w-[1.3rem]" strokeWidth={2} />
                        ),
                      },
                      {
                        id: 'hidden' as const,
                        label: 'Hidden apps',
                        summary: hiddenSummary,
                        icon: (
                          <EyeOff className="h-[1.3rem] w-[1.3rem]" strokeWidth={2} />
                        ),
                      },
                      {
                        id: 'phone_remote' as const,
                        label: 'Phone remote',
                        summary: 'Pair a phone over Wi-Fi to control xLab TV',
                        icon: (
                          <Smartphone
                            className="h-[1.3rem] w-[1.3rem]"
                            strokeWidth={2}
                          />
                        ),
                      },
                    ] as const
                  ).map((row) => {
                    const idx = rootItems.indexOf(row.id);
                    const isFocused = rootFocusIndex === idx;
                    return (
                      <button
                        key={row.id}
                        type="button"
                        data-qs-focused={isFocused ? 'true' : undefined}
                        aria-current={isFocused ? 'true' : undefined}
                        onMouseEnter={() => setRootFocusWithPowerReset(idx)}
                        onFocus={() => setRootFocusWithPowerReset(idx)}
                        onClick={() => activateRootItem(row.id)}
                        className={`tv-card relative flex w-full items-center justify-between gap-4 rounded-[1rem] border px-5 py-4 text-left focus:outline-none ${
                          isFocused
                            ? 'tv-btn-focused border-white/25 bg-[#1B2230]'
                            : 'border-white/10 bg-[#151A25]'
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-4">
                          <div className="flex h-[2.6rem] w-[2.6rem] shrink-0 items-center justify-center rounded-[0.75rem] bg-white/8 text-[#E2E8F0]">
                            {row.icon}
                          </div>
                          <div className="min-w-0">
                            <div className="text-[1.18rem] font-semibold text-[#FFFFFF]">
                              {row.label}
                            </div>
                            <div className="mt-0.5 truncate text-[0.94rem] text-[#94A3B8]">
                              {row.summary}
                            </div>
                          </div>
                        </div>
                        <ChevronRight
                          className="h-[1.25rem] w-[1.25rem] shrink-0 text-[#64748B]"
                          strokeWidth={2}
                        />
                        <span
                          aria-hidden="true"
                          className={`tv-focus-ring pointer-events-none absolute -inset-[3px] rounded-[1.08rem] border-[3px] border-[#38BDF8] ${
                            isFocused ? 'tv-focus-ring-active' : ''
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Power & Session */}
              <div>
                <h3 className="mb-2.5 text-[0.875rem] font-semibold tracking-[0.06em] text-[#94A3B8] uppercase">
                  Power & Session
                </h3>
                <div className="space-y-2.5">
                  {POWER_OPTIONS.map((option) => {
                    const itemId = `power_${option.action}` as RootItemId;
                    const idx = rootItems.indexOf(itemId);
                    const isFocused = rootFocusIndex === idx;
                    const isArmed = armedPowerAction === option.action;
                    const isPending = pendingPowerAction === option.action;

                    return (
                      <button
                        key={option.action}
                        type="button"
                        data-qs-focused={isFocused ? 'true' : undefined}
                        aria-current={isFocused ? 'true' : undefined}
                        onMouseEnter={() => setRootFocusWithPowerReset(idx)}
                        onFocus={() => setRootFocusWithPowerReset(idx)}
                        onClick={() => onTriggerPower(option.action)}
                        className={`tv-card relative flex w-full items-center justify-between gap-4 rounded-[1rem] border px-5 py-4 text-left focus:outline-none ${
                          isArmed
                            ? 'border-[#F87171]/60 bg-[#3B1722]'
                            : isFocused
                              ? 'border-white/25 bg-[#1B2230]'
                              : 'border-white/10 bg-[#151A25]'
                        } ${isFocused ? 'tv-btn-focused' : ''}`}
                      >
                        <div className="flex min-w-0 items-center gap-4">
                          <div
                            className={`flex h-[2.6rem] w-[2.6rem] shrink-0 items-center justify-center rounded-[0.75rem] ${
                              isArmed
                                ? 'bg-[#F87171]/25 text-[#FECACA]'
                                : 'bg-white/8 text-[#E2E8F0]'
                            }`}
                          >
                            {isPending ? (
                              <Loader2
                                className="h-[1.3rem] w-[1.3rem] animate-spin"
                                strokeWidth={2}
                              />
                            ) : (
                              <PowerIcon action={option.action} />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div
                              className={`text-[1.18rem] font-semibold ${
                                isArmed ? 'text-[#FECACA]' : 'text-[#FFFFFF]'
                              }`}
                            >
                              {isPending
                                ? `${option.label}…`
                                : isArmed
                                  ? option.confirmLabel
                                  : option.label}
                            </div>
                            <div
                              className={`mt-0.5 truncate text-[0.94rem] ${
                                isArmed ? 'text-[#FCA5A5]' : 'text-[#94A3B8]'
                              }`}
                            >
                              {isArmed
                                ? option.confirmDescription
                                : option.description}
                            </div>
                          </div>
                        </div>

                        <span
                          className={`shrink-0 rounded-full px-3 py-1 text-[0.8125rem] font-bold tracking-wide uppercase ${
                            isArmed
                              ? 'bg-[#F87171] text-[#090B10]'
                              : 'bg-white/10 text-[#CBD5E1]'
                          }`}
                        >
                          {isArmed ? 'Confirm' : 'Select'}
                        </span>

                        <span
                          aria-hidden="true"
                          className={`tv-focus-ring pointer-events-none absolute -inset-[3px] rounded-[1.08rem] border-[3px] ${
                            isArmed ? 'border-[#F87171]' : 'border-[#38BDF8]'
                          } ${isFocused ? 'tv-focus-ring-active' : ''}`}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ================= WI-FI SUB-VIEW ================= */}
          {view === 'wifi' && (
            <div className="space-y-5">
              {wifi?.ethernet && (
                <div className="flex items-center gap-3.5 rounded-[1rem] border border-[#38BDF8]/30 bg-[#101E2E] px-5 py-3.5 text-[#BAE6FD]">
                  <Cable className="h-[1.3rem] w-[1.3rem] shrink-0 text-[#38BDF8]" />
                  <span className="text-[1.05rem] font-semibold">
                    Ethernet connected
                  </span>
                </div>
              )}

              {wifiBusyLabel && (
                <div className="flex items-center gap-3 rounded-[1rem] border border-white/12 bg-[#151D2B] px-5 py-3.5 text-[#E2E8F0]">
                  <Loader2 className="h-[1.25rem] w-[1.25rem] shrink-0 animate-spin text-[#38BDF8]" />
                  <span className="text-[1.05rem] font-medium">
                    {wifiBusyLabel}
                  </span>
                </div>
              )}

              {/* Password or Disconnect Sub-Prompt */}
              {wifiPrompt?.type === 'password' ? (
                <div className="space-y-4 rounded-[1.15rem] border border-white/15 bg-[#151A25] p-6">
                  <div>
                    <h3 className="font-display text-[1.45rem] font-bold text-white">
                      Join {wifiPrompt.network.ssid}
                    </h3>
                    <p className="mt-1 text-[0.95rem] text-[#94A3B8]">
                      Enter the Wi-Fi password, then select Join.
                    </p>
                  </div>

                  <div
                    data-qs-focused={wifiPromptFocus === 0 ? 'true' : undefined}
                    className={`relative rounded-[0.9rem] border bg-[#0C1018] ${
                      wifiPromptFocus === 0
                        ? 'border-[#38BDF8]'
                        : 'border-white/15'
                    }`}
                  >
                    <input
                      ref={passwordInputRef}
                      type="password"
                      value={wifiPassword}
                      disabled={wifiBusyLabel !== null}
                      onFocus={() => setWifiPromptFocus(0)}
                      onChange={(e) => setWifiPassword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          e.stopPropagation();
                          if (wifiBusyLabel === null) {
                            passwordInputRef.current?.blur();
                            setWifiPrompt(null);
                            setWifiPassword('');
                          }
                        } else if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          e.stopPropagation();
                          passwordInputRef.current?.blur();
                          setWifiPromptFocus(1);
                        } else if (e.key === 'Enter') {
                          e.preventDefault();
                          e.stopPropagation();
                          void handleWifiConnect(
                            wifiPrompt.network.ssid,
                            wifiPassword
                          );
                        }
                      }}
                      placeholder="Wi-Fi password"
                      aria-label={`Password for ${wifiPrompt.network.ssid}`}
                      className="w-full rounded-[0.9rem] bg-transparent px-4 py-3.5 text-[1.15rem] text-white placeholder-[#64748B] focus:outline-none"
                    />
                  </div>

                  <button
                    type="button"
                    data-qs-focused={wifiPromptFocus === 1 ? 'true' : undefined}
                    disabled={wifiBusyLabel !== null}
                    onMouseEnter={() => setWifiPromptFocus(1)}
                    onFocus={() => setWifiPromptFocus(1)}
                    onClick={() =>
                      void handleWifiConnect(
                        wifiPrompt.network.ssid,
                        wifiPassword
                      )
                    }
                    className={`tv-card relative flex w-full items-center justify-center gap-3 rounded-[0.95rem] bg-[#38BDF8] px-5 py-3.5 text-[1.15rem] font-bold text-[#06080D] focus:outline-none ${
                      wifiPromptFocus === 1 ? 'tv-btn-focused' : ''
                    }`}
                  >
                    {wifiBusyLabel ? (
                      <>
                        <Loader2 className="h-[1.2rem] w-[1.2rem] animate-spin" />
                        <span>Joining…</span>
                      </>
                    ) : (
                      <span>Join</span>
                    )}
                    <span
                      aria-hidden="true"
                      className={`tv-focus-ring pointer-events-none absolute -inset-[3px] rounded-[1.05rem] border-[3px] border-white ${
                        wifiPromptFocus === 1 ? 'tv-focus-ring-active' : ''
                      }`}
                    />
                  </button>

                  <p className="text-[0.875rem] text-[#64748B]">
                    Connecting can take up to 45 seconds. Press Back to cancel.
                  </p>
                </div>
              ) : wifiPrompt?.type === 'disconnect' ? (
                <div className="space-y-4 rounded-[1.15rem] border border-white/15 bg-[#151A25] p-6">
                  <div>
                    <h3 className="font-display text-[1.45rem] font-bold text-white">
                      {wifiPrompt.network.ssid}
                    </h3>
                    <p className="mt-1 text-[0.95rem] text-[#94A3B8]">
                      Currently connected ({wifiPrompt.network.signal}% signal)
                    </p>
                  </div>

                  <button
                    type="button"
                    data-qs-focused="true"
                    disabled={wifiBusyLabel !== null}
                    onClick={() => void handleWifiDisconnect()}
                    className="tv-card tv-btn-focused relative flex w-full items-center justify-center gap-3 rounded-[0.95rem] border border-[#F87171]/50 bg-[#3B1722] px-5 py-3.5 text-[1.15rem] font-bold text-[#FECACA] focus:outline-none"
                  >
                    {wifiBusyLabel ? (
                      <>
                        <Loader2 className="h-[1.2rem] w-[1.2rem] animate-spin" />
                        <span>Disconnecting…</span>
                      </>
                    ) : (
                      <span>Disconnect</span>
                    )}
                    <span
                      aria-hidden="true"
                      className="tv-focus-ring tv-focus-ring-active pointer-events-none absolute -inset-[3px] rounded-[1.05rem] border-[3px] border-[#38BDF8]"
                    />
                  </button>
                </div>
              ) : (
                <>
                  {/* Power Toggle (index 0) & Scan (index 1) */}
                  <div className="space-y-2.5">
                    <button
                      type="button"
                      data-qs-focused={subFocusIndex === 0 ? 'true' : undefined}
                      onMouseEnter={() => setSubFocusIndex(0)}
                      onFocus={() => setSubFocusIndex(0)}
                      onClick={() => void handleWifiPowerToggle()}
                      className={`tv-card relative flex w-full items-center justify-between gap-4 rounded-[1rem] border px-5 py-4 text-left focus:outline-none ${
                        subFocusIndex === 0
                          ? 'tv-btn-focused border-white/25 bg-[#1B2230]'
                          : 'border-white/10 bg-[#151A25]'
                      }`}
                    >
                      <div className="flex items-center gap-3.5">
                        <Wifi className="h-[1.3rem] w-[1.3rem] text-[#E2E8F0]" />
                        <span className="text-[1.18rem] font-semibold text-white">
                          Wi-Fi
                        </span>
                      </div>
                      <span
                        className={`rounded-full px-3.5 py-1 text-[0.875rem] font-bold ${
                          wifi?.enabled
                            ? 'bg-[#38BDF8] text-[#06080D]'
                            : 'bg-white/10 text-[#94A3B8]'
                        }`}
                      >
                        {wifi?.enabled ? 'On' : 'Off'}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`tv-focus-ring pointer-events-none absolute -inset-[3px] rounded-[1.08rem] border-[3px] border-[#38BDF8] ${
                          subFocusIndex === 0 ? 'tv-focus-ring-active' : ''
                        }`}
                      />
                    </button>

                    <button
                      type="button"
                      data-qs-focused={subFocusIndex === 1 ? 'true' : undefined}
                      disabled={wifiBusyLabel !== null}
                      onMouseEnter={() => setSubFocusIndex(1)}
                      onFocus={() => setSubFocusIndex(1)}
                      onClick={() => void handleWifiRescan()}
                      className={`tv-card relative flex w-full items-center justify-between gap-4 rounded-[1rem] border px-5 py-4 text-left focus:outline-none ${
                        subFocusIndex === 1
                          ? 'tv-btn-focused border-white/25 bg-[#1B2230]'
                          : 'border-white/10 bg-[#151A25]'
                      }`}
                    >
                      <div className="flex items-center gap-3.5">
                        {wifiBusyLabel ? (
                          <Loader2 className="h-[1.3rem] w-[1.3rem] animate-spin text-[#38BDF8]" />
                        ) : (
                          <RefreshCw className="h-[1.3rem] w-[1.3rem] text-[#E2E8F0]" />
                        )}
                        <span className="text-[1.18rem] font-semibold text-white">
                          Scan
                        </span>
                      </div>
                      <span className="text-[0.95rem] text-[#94A3B8]">
                        Refresh networks
                      </span>
                      <span
                        aria-hidden="true"
                        className={`tv-focus-ring pointer-events-none absolute -inset-[3px] rounded-[1.08rem] border-[3px] border-[#38BDF8] ${
                          subFocusIndex === 1 ? 'tv-focus-ring-active' : ''
                        }`}
                      />
                    </button>
                  </div>

                  {/* Networks List */}
                  {wifi?.enabled && (
                    <div>
                      <h3 className="mb-2.5 text-[0.875rem] font-semibold tracking-[0.06em] text-[#94A3B8] uppercase">
                        Available Networks
                      </h3>
                      {wifiNetworks.length === 0 ? (
                        <p className="rounded-[1rem] border border-white/10 bg-[#151A25] px-5 py-4 text-[1rem] text-[#94A3B8]">
                          {wifiLoading
                            ? 'Loading Wi-Fi networks…'
                            : 'No Wi-Fi networks found. Select Scan to search again.'}
                        </p>
                      ) : (
                        <div className="space-y-2.5">
                          {wifiNetworks.map((net, i) => {
                            const idx = i + 2;
                            const isFocused = subFocusIndex === idx;
                            return (
                              <button
                                key={net.ssid}
                                type="button"
                                data-qs-focused={isFocused ? 'true' : undefined}
                                onMouseEnter={() => setSubFocusIndex(idx)}
                                onFocus={() => setSubFocusIndex(idx)}
                                onClick={() => {
                                  if (wifiBusyLabel !== null) return;
                                  if (net.connected) {
                                    setWifiPrompt({
                                      type: 'disconnect',
                                      network: net,
                                    });
                                  } else if (net.secure) {
                                    setWifiPassword('');
                                    setWifiPromptFocus(0);
                                    setWifiPrompt({
                                      type: 'password',
                                      network: net,
                                    });
                                  } else {
                                    void handleWifiConnect(net.ssid, '');
                                  }
                                }}
                                className={`tv-card relative flex w-full items-center justify-between gap-4 rounded-[1rem] border px-5 py-4 text-left focus:outline-none ${
                                  isFocused
                                    ? 'tv-btn-focused border-white/25 bg-[#1B2230]'
                                    : 'border-white/10 bg-[#151A25]'
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2.5">
                                    <span className="truncate text-[1.15rem] font-semibold text-white">
                                      {net.ssid}
                                    </span>
                                    {net.connected && (
                                      <span className="shrink-0 rounded-full bg-[#38BDF8]/20 px-2.5 py-0.5 text-[0.78rem] font-semibold text-[#38BDF8]">
                                        Connected
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-3 text-[#94A3B8]">
                                  {net.secure && (
                                    <Lock
                                      className="h-[1.05rem] w-[1.05rem]"
                                      strokeWidth={2}
                                      aria-label="Secured network"
                                    />
                                  )}
                                  <SignalBars signal={net.signal} />
                                </div>
                                <span
                                  aria-hidden="true"
                                  className={`tv-focus-ring pointer-events-none absolute -inset-[3px] rounded-[1.08rem] border-[3px] border-[#38BDF8] ${
                                    isFocused ? 'tv-focus-ring-active' : ''
                                  }`}
                                />
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ================= BLUETOOTH SUB-VIEW ================= */}
          {view === 'bluetooth' && (
            <div className="space-y-5">
              {bluetooth && !bluetooth.available ? (
                <div className="rounded-[1.15rem] border border-white/12 bg-[#151A25] p-6 text-center">
                  <Bluetooth className="mx-auto h-[2.5rem] w-[2.5rem] text-[#64748B]" />
                  <h3 className="mt-4 font-display text-[1.45rem] font-bold text-white">
                    No Bluetooth adapter
                  </h3>
                  <p className="mt-1.5 text-[1rem] text-[#94A3B8]">
                    Connect a USB Bluetooth adapter to pair controllers or
                    wireless audio.
                  </p>
                </div>
              ) : (
                <>
                  {btBusyLabel && (
                    <div className="flex items-center gap-3 rounded-[1rem] border border-white/12 bg-[#151D2B] px-5 py-3.5 text-[#E2E8F0]">
                      <Loader2 className="h-[1.25rem] w-[1.25rem] shrink-0 animate-spin text-[#38BDF8]" />
                      <span className="text-[1.05rem] font-medium">
                        {btBusyLabel}
                      </span>
                    </div>
                  )}

                  {btActionDevice ? (
                    <div className="space-y-3 rounded-[1.15rem] border border-white/15 bg-[#151A25] p-6">
                      <div className="mb-2">
                        <h3 className="font-display text-[1.45rem] font-bold text-white">
                          {btActionDevice.name}
                        </h3>
                        <p className="mt-0.5 text-[0.95rem] text-[#94A3B8]">
                          {btActionDevice.connected ? 'Connected' : 'Paired'} ·{' '}
                          {btActionDevice.mac}
                        </p>
                      </div>

                      <button
                        type="button"
                        data-qs-focused={btActionFocus === 0 ? 'true' : undefined}
                        disabled={btBusyLabel !== null}
                        onMouseEnter={() => setBtActionFocus(0)}
                        onFocus={() => setBtActionFocus(0)}
                        onClick={() =>
                          void handleBtDeviceAction(
                            btActionDevice.connected ? 'disconnect' : 'connect',
                            btActionDevice
                          )
                        }
                        className={`tv-card relative flex w-full items-center justify-center rounded-[0.95rem] border px-5 py-3.5 text-[1.15rem] font-semibold focus:outline-none ${
                          btActionFocus === 0
                            ? 'tv-btn-focused border-white/25 bg-[#1E2738] text-white'
                            : 'border-white/10 bg-[#10141E] text-[#E2E8F0]'
                        }`}
                      >
                        {btActionDevice.connected ? 'Disconnect' : 'Connect'}
                        <span
                          aria-hidden="true"
                          className={`tv-focus-ring pointer-events-none absolute -inset-[3px] rounded-[1.05rem] border-[3px] border-[#38BDF8] ${
                            btActionFocus === 0 ? 'tv-focus-ring-active' : ''
                          }`}
                        />
                      </button>

                      <button
                        type="button"
                        data-qs-focused={btActionFocus === 1 ? 'true' : undefined}
                        disabled={btBusyLabel !== null}
                        onMouseEnter={() => setBtActionFocus(1)}
                        onFocus={() => setBtActionFocus(1)}
                        onClick={() =>
                          void handleBtDeviceAction('remove', btActionDevice)
                        }
                        className={`tv-card relative flex w-full items-center justify-center rounded-[0.95rem] border px-5 py-3.5 text-[1.15rem] font-semibold focus:outline-none ${
                          btActionFocus === 1
                            ? 'tv-btn-focused border-[#F87171]/50 bg-[#3B1722] text-[#FECACA]'
                            : 'border-white/10 bg-[#10141E] text-[#FCA5A5]'
                        }`}
                      >
                        Forget
                        <span
                          aria-hidden="true"
                          className={`tv-focus-ring pointer-events-none absolute -inset-[3px] rounded-[1.05rem] border-[3px] border-[#38BDF8] ${
                            btActionFocus === 1 ? 'tv-focus-ring-active' : ''
                          }`}
                        />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2.5">
                        <button
                          type="button"
                          data-qs-focused={subFocusIndex === 0 ? 'true' : undefined}
                          onMouseEnter={() => setSubFocusIndex(0)}
                          onFocus={() => setSubFocusIndex(0)}
                          onClick={() => void handleBtPowerToggle()}
                          className={`tv-card relative flex w-full items-center justify-between gap-4 rounded-[1rem] border px-5 py-4 text-left focus:outline-none ${
                            subFocusIndex === 0
                              ? 'tv-btn-focused border-white/25 bg-[#1B2230]'
                              : 'border-white/10 bg-[#151A25]'
                          }`}
                        >
                          <div className="flex items-center gap-3.5">
                            <Bluetooth className="h-[1.3rem] w-[1.3rem] text-[#E2E8F0]" />
                            <span className="text-[1.18rem] font-semibold text-white">
                              Bluetooth
                            </span>
                          </div>
                          <span
                            className={`rounded-full px-3.5 py-1 text-[0.875rem] font-bold ${
                              bluetooth?.powered
                                ? 'bg-[#38BDF8] text-[#06080D]'
                                : 'bg-white/10 text-[#94A3B8]'
                            }`}
                          >
                            {bluetooth?.powered ? 'On' : 'Off'}
                          </span>
                          <span
                            aria-hidden="true"
                            className={`tv-focus-ring pointer-events-none absolute -inset-[3px] rounded-[1.08rem] border-[3px] border-[#38BDF8] ${
                              subFocusIndex === 0 ? 'tv-focus-ring-active' : ''
                            }`}
                          />
                        </button>

                        <button
                          type="button"
                          data-qs-focused={subFocusIndex === 1 ? 'true' : undefined}
                          disabled={btBusyLabel !== null}
                          onMouseEnter={() => setSubFocusIndex(1)}
                          onFocus={() => setSubFocusIndex(1)}
                          onClick={() => void handleBtScan()}
                          className={`tv-card relative flex w-full items-center justify-between gap-4 rounded-[1rem] border px-5 py-4 text-left focus:outline-none ${
                            subFocusIndex === 1
                              ? 'tv-btn-focused border-white/25 bg-[#1B2230]'
                              : 'border-white/10 bg-[#151A25]'
                          }`}
                        >
                          <div className="flex items-center gap-3.5">
                            {btBusyLabel?.startsWith('Searching') ? (
                              <Loader2 className="h-[1.3rem] w-[1.3rem] animate-spin text-[#38BDF8]" />
                            ) : (
                              <Search className="h-[1.3rem] w-[1.3rem] text-[#E2E8F0]" />
                            )}
                            <span className="text-[1.18rem] font-semibold text-white">
                              Search for devices
                            </span>
                          </div>
                          <span className="text-[0.95rem] text-[#94A3B8]">
                            ~8 s scan
                          </span>
                          <span
                            aria-hidden="true"
                            className={`tv-focus-ring pointer-events-none absolute -inset-[3px] rounded-[1.08rem] border-[3px] border-[#38BDF8] ${
                              subFocusIndex === 1 ? 'tv-focus-ring-active' : ''
                            }`}
                          />
                        </button>
                      </div>

                      <p className="rounded-[0.9rem] border border-white/8 bg-[#121722] px-4 py-3 text-[0.95rem] text-[#94A3B8]">
                        Put the controller or headphones in pairing mode first.
                      </p>

                      {bluetooth?.powered && (
                        <div>
                          <h3 className="mb-2.5 text-[0.875rem] font-semibold tracking-[0.06em] text-[#94A3B8] uppercase">
                            Devices
                          </h3>
                          {btDevices.length === 0 ? (
                            <p className="rounded-[1rem] border border-white/10 bg-[#151A25] px-5 py-4 text-[1rem] text-[#94A3B8]">
                              {btLoading
                                ? 'Loading Bluetooth devices…'
                                : 'No Bluetooth devices found yet.'}
                            </p>
                          ) : (
                            <div className="space-y-2.5">
                              {btDevices.map((dev, i) => {
                                const idx = i + 2;
                                const isFocused = subFocusIndex === idx;
                                return (
                                  <button
                                    key={dev.mac}
                                    type="button"
                                    data-qs-focused={
                                      isFocused ? 'true' : undefined
                                    }
                                    disabled={btBusyLabel !== null}
                                    onMouseEnter={() => setSubFocusIndex(idx)}
                                    onFocus={() => setSubFocusIndex(idx)}
                                    onClick={() => {
                                      if (btBusyLabel !== null) return;
                                      if (!dev.paired) {
                                        void handleBtDeviceAction('pair', dev);
                                      } else {
                                        setBtActionFocus(0);
                                        setBtActionDevice(dev);
                                      }
                                    }}
                                    className={`tv-card relative flex w-full items-center justify-between gap-4 rounded-[1rem] border px-5 py-4 text-left focus:outline-none ${
                                      isFocused
                                        ? 'tv-btn-focused border-white/25 bg-[#1B2230]'
                                        : 'border-white/10 bg-[#151A25]'
                                    }`}
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="truncate text-[1.15rem] font-semibold text-white">
                                        {dev.name}
                                      </div>
                                      <div className="mt-0.5 text-[0.92rem] text-[#94A3B8]">
                                        {dev.connected
                                          ? 'Connected'
                                          : dev.paired
                                            ? 'Paired'
                                            : 'Ready to pair'}
                                      </div>
                                    </div>
                                    <span
                                      className={`shrink-0 rounded-full px-3.5 py-1 text-[0.84rem] font-semibold ${
                                        dev.connected
                                          ? 'bg-[#38BDF8]/20 text-[#38BDF8]'
                                          : dev.paired
                                            ? 'bg-white/10 text-[#E2E8F0]'
                                            : 'bg-[#38BDF8] text-[#06080D]'
                                      }`}
                                    >
                                      {dev.paired ? 'Manage' : 'Pair'}
                                    </span>
                                    <span
                                      aria-hidden="true"
                                      className={`tv-focus-ring pointer-events-none absolute -inset-[3px] rounded-[1.08rem] border-[3px] border-[#38BDF8] ${
                                        isFocused ? 'tv-focus-ring-active' : ''
                                      }`}
                                    />
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* ================= SOUND SUB-VIEW ================= */}
          {view === 'sound' && (
            <div className="space-y-6">
              {/* Volume Slider (index 0) */}
              <div
                data-qs-focused={subFocusIndex === 0 ? 'true' : undefined}
                onMouseEnter={() => setSubFocusIndex(0)}
                onClick={() => setSubFocusIndex(0)}
                className={`tv-card relative rounded-[1rem] border px-5 py-5 ${
                  subFocusIndex === 0
                    ? 'tv-btn-focused border-white/25 bg-[#1B2230]'
                    : 'border-white/10 bg-[#151A25]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {audio?.muted ? (
                      <VolumeX className="h-[1.35rem] w-[1.35rem] text-[#F87171]" />
                    ) : (
                      <Volume2 className="h-[1.35rem] w-[1.35rem] text-[#38BDF8]" />
                    )}
                    <span className="text-[1.18rem] font-semibold text-white">
                      Volume
                    </span>
                  </div>
                  <span className="font-display text-[1.35rem] font-bold text-[#F8FAFC] tabular-nums">
                    {audio ? (audio.muted ? 'Muted' : `${audio.volume}%`) : '—'}
                  </span>
                </div>

                {/* Slider track with GPU-composited scaleX fill */}
                <div className="mt-4 flex items-center gap-3">
                  <button
                    type="button"
                    aria-label="Volume down"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleAudioAction({ action: 'down' });
                    }}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-[1.25rem] font-bold text-white"
                  >
                    −
                  </button>
                  <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-white/15">
                    <div
                      className={`h-full w-full rounded-full ${
                        audio?.muted ? 'bg-[#64748B]' : 'bg-[#38BDF8]'
                      }`}
                      style={{
                        transform: `scaleX(${(audio?.volume ?? 0) / 100})`,
                        transformOrigin: 'left center',
                        transition: 'transform 120ms ease-out',
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    aria-label="Volume up"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleAudioAction({ action: 'up' });
                    }}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-[1.25rem] font-bold text-white"
                  >
                    +
                  </button>
                </div>

                <p className="mt-3 text-[0.9rem] text-[#94A3B8]">
                  Use Left / Right to adjust volume
                </p>

                <span
                  aria-hidden="true"
                  className={`tv-focus-ring pointer-events-none absolute -inset-[3px] rounded-[1.08rem] border-[3px] border-[#38BDF8] ${
                    subFocusIndex === 0 ? 'tv-focus-ring-active' : ''
                  }`}
                />
              </div>

              {/* Mute Toggle (index 1) */}
              <button
                type="button"
                data-qs-focused={subFocusIndex === 1 ? 'true' : undefined}
                onMouseEnter={() => setSubFocusIndex(1)}
                onFocus={() => setSubFocusIndex(1)}
                onClick={() => void handleAudioAction({ action: 'mute' })}
                className={`tv-card relative flex w-full items-center justify-between gap-4 rounded-[1rem] border px-5 py-4 text-left focus:outline-none ${
                  subFocusIndex === 1
                    ? 'tv-btn-focused border-white/25 bg-[#1B2230]'
                    : 'border-white/10 bg-[#151A25]'
                }`}
              >
                <div className="flex items-center gap-3.5">
                  <VolumeX className="h-[1.3rem] w-[1.3rem] text-[#E2E8F0]" />
                  <span className="text-[1.18rem] font-semibold text-white">
                    Mute
                  </span>
                </div>
                <span
                  className={`rounded-full px-3.5 py-1 text-[0.875rem] font-bold ${
                    audio?.muted
                      ? 'bg-[#F87171] text-[#090B10]'
                      : 'bg-white/10 text-[#94A3B8]'
                  }`}
                >
                  {audio?.muted ? 'Muted' : 'Off'}
                </span>
                <span
                  aria-hidden="true"
                  className={`tv-focus-ring pointer-events-none absolute -inset-[3px] rounded-[1.08rem] border-[3px] border-[#38BDF8] ${
                    subFocusIndex === 1 ? 'tv-focus-ring-active' : ''
                  }`}
                />
              </button>

              {/* Output Devices (index 2+) */}
              <div>
                <h3 className="mb-2.5 text-[0.875rem] font-semibold tracking-[0.06em] text-[#94A3B8] uppercase">
                  Audio Output
                </h3>
                {audioOutputs.length === 0 ? (
                  <p className="rounded-[1rem] border border-white/10 bg-[#151A25] px-5 py-4 text-[1rem] text-[#94A3B8]">
                    {audioLoading
                      ? 'Loading audio outputs…'
                      : 'No audio output devices reported.'}
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {audioOutputs.map((out, i) => {
                      const idx = i + 2;
                      const isFocused = subFocusIndex === idx;
                      return (
                        <button
                          key={out.id}
                          type="button"
                          data-qs-focused={isFocused ? 'true' : undefined}
                          onMouseEnter={() => setSubFocusIndex(idx)}
                          onFocus={() => setSubFocusIndex(idx)}
                          onClick={() =>
                            void handleAudioAction({
                              action: 'output',
                              id: out.id,
                            })
                          }
                          className={`tv-card relative flex w-full items-center justify-between gap-4 rounded-[1rem] border px-5 py-4 text-left focus:outline-none ${
                            isFocused
                              ? 'tv-btn-focused border-white/25 bg-[#1B2230]'
                              : 'border-white/10 bg-[#151A25]'
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-3.5">
                            <Speaker className="h-[1.25rem] w-[1.25rem] shrink-0 text-[#94A3B8]" />
                            <span className="truncate text-[1.12rem] font-semibold text-white">
                              {out.name}
                            </span>
                          </div>
                          {out.default && (
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#38BDF8] text-[#06080D]">
                              <Check className="h-4 w-4" strokeWidth={2.75} />
                            </span>
                          )}
                          <span
                            aria-hidden="true"
                            className={`tv-focus-ring pointer-events-none absolute -inset-[3px] rounded-[1.08rem] border-[3px] border-[#38BDF8] ${
                              isFocused ? 'tv-focus-ring-active' : ''
                            }`}
                          />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================= DISPLAY & POWER SUB-VIEW ================= */}
          {view === 'display' && (
            <div className="space-y-6">
              <div>
                <h3 className="mb-1 text-[0.875rem] font-semibold tracking-[0.06em] text-[#94A3B8] uppercase">
                  Ubuntu Settings
                </h3>
                <p className="mb-3 text-[0.95rem] text-[#94A3B8]">
                  Opens Ubuntu Settings (use the air mouse)
                </p>
                <div className="space-y-2.5">
                  {(
                    [
                      {
                        page: 'display' as const,
                        label: 'Display settings',
                        description: 'Resolution, refresh rate, and scaling',
                        idx: 0,
                      },
                      {
                        page: 'power' as const,
                        label: 'Power settings',
                        description: 'Screen blanking and automatic suspend',
                        idx: 1,
                      },
                    ] as const
                  ).map((item) => {
                    const isFocused = subFocusIndex === item.idx;
                    const isBusy = openingUbuntuPage === item.page;
                    return (
                      <button
                        key={item.page}
                        type="button"
                        data-qs-focused={isFocused ? 'true' : undefined}
                        disabled={openingUbuntuPage !== null}
                        onMouseEnter={() => setSubFocusIndex(item.idx)}
                        onFocus={() => setSubFocusIndex(item.idx)}
                        onClick={() => void handleOpenUbuntu(item.page)}
                        className={`tv-card relative flex w-full items-center justify-between gap-4 rounded-[1rem] border px-5 py-4 text-left focus:outline-none ${
                          isFocused
                            ? 'tv-btn-focused border-white/25 bg-[#1B2230]'
                            : 'border-white/10 bg-[#151A25]'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-[1.18rem] font-semibold text-white">
                            {item.label}
                          </div>
                          <div className="mt-0.5 text-[0.94rem] text-[#94A3B8]">
                            {item.description}
                          </div>
                        </div>
                        {isBusy ? (
                          <Loader2 className="h-[1.25rem] w-[1.25rem] shrink-0 animate-spin text-[#38BDF8]" />
                        ) : (
                          <ChevronRight className="h-[1.25rem] w-[1.25rem] shrink-0 text-[#64748B]" />
                        )}
                        <span
                          aria-hidden="true"
                          className={`tv-focus-ring pointer-events-none absolute -inset-[3px] rounded-[1.08rem] border-[3px] border-[#38BDF8] ${
                            isFocused ? 'tv-focus-ring-active' : ''
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <h3 className="mb-2.5 text-[0.875rem] font-semibold tracking-[0.06em] text-[#94A3B8] uppercase">
                  Launcher Display
                </h3>
                <div className="space-y-2.5">
                  {(
                    [
                      {
                        idx: 2,
                        label: '24-Hour Clock',
                        description: 'Display time in 24-hour format',
                        checked: settings.use24HourClock,
                        onToggle: () =>
                          onUpdateSettings({
                            use24HourClock: !settings.use24HourClock,
                          }),
                      },
                      {
                        idx: 3,
                        label: 'Hero Auto-Advance',
                        description: 'Cycle featured hero slides automatically',
                        checked: settings.autoAdvanceHero,
                        onToggle: () =>
                          onUpdateSettings({
                            autoAdvanceHero: !settings.autoAdvanceHero,
                          }),
                      },
                      {
                        idx: 4,
                        label: 'Card Subtitles',
                        description: 'Show app descriptions under focused tiles',
                        checked: settings.showSubtitles,
                        onToggle: () =>
                          onUpdateSettings({
                            showSubtitles: !settings.showSubtitles,
                          }),
                      },
                      {
                        idx: 5,
                        label: 'Navigation Hints',
                        description: 'Show remote and controller hints at bottom',
                        checked: settings.showNavHints,
                        onToggle: () =>
                          onUpdateSettings({
                            showNavHints: !settings.showNavHints,
                          }),
                      },
                    ] as const
                  ).map((row) => {
                    const isFocused = subFocusIndex === row.idx;
                    return (
                      <button
                        key={row.label}
                        type="button"
                        role="switch"
                        aria-checked={row.checked}
                        data-qs-focused={isFocused ? 'true' : undefined}
                        onMouseEnter={() => setSubFocusIndex(row.idx)}
                        onFocus={() => setSubFocusIndex(row.idx)}
                        onClick={row.onToggle}
                        className={`tv-card relative flex w-full items-center justify-between gap-4 rounded-[1rem] border px-5 py-4 text-left focus:outline-none ${
                          isFocused
                            ? 'tv-btn-focused border-white/25 bg-[#1B2230]'
                            : 'border-white/10 bg-[#151A25]'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-[1.15rem] font-semibold text-white">
                            {row.label}
                          </div>
                          <div className="mt-0.5 text-[0.94rem] text-[#94A3B8]">
                            {row.description}
                          </div>
                        </div>
                        <span
                          aria-hidden="true"
                          className={`relative h-[1.85rem] w-[3.35rem] shrink-0 rounded-full transition-colors duration-150 ${
                            row.checked ? 'bg-[#38BDF8]' : 'bg-white/20'
                          }`}
                        >
                          <span
                            className="absolute top-[0.2rem] left-[0.2rem] h-[1.45rem] w-[1.45rem] rounded-full bg-white"
                            style={{
                              transform: row.checked
                                ? 'translate3d(1.5rem, 0, 0)'
                                : 'translate3d(0, 0, 0)',
                              transition:
                                'transform 160ms cubic-bezier(0.22, 1, 0.36, 1)',
                            }}
                          />
                        </span>
                        <span
                          aria-hidden="true"
                          className={`tv-focus-ring pointer-events-none absolute -inset-[3px] rounded-[1.08rem] border-[3px] border-[#38BDF8] ${
                            isFocused ? 'tv-focus-ring-active' : ''
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ================= HIDDEN APPS SUB-VIEW ================= */}
          {view === 'hidden' && (
            <div className="space-y-3">
              {hiddenLoading && hiddenApps.length === 0 ? (
                <div className="flex items-center gap-3 rounded-[1rem] border border-white/10 bg-[#151A25] px-5 py-4 text-[#CBD5E1]">
                  <Loader2 className="h-[1.25rem] w-[1.25rem] animate-spin text-[#38BDF8]" />
                  <span>Loading hidden apps…</span>
                </div>
              ) : hiddenApps.length === 0 ? (
                <div className="rounded-[1.15rem] border border-white/10 bg-[#151A25] p-6 text-center">
                  <Eye className="mx-auto h-[2.25rem] w-[2.25rem] text-[#64748B]" />
                  <h3 className="mt-3 font-display text-[1.35rem] font-bold text-white">
                    No hidden apps
                  </h3>
                  <p className="mt-1 text-[0.95rem] text-[#94A3B8]">
                    Apps you hide from the card menu will appear here so you can
                    bring them back anytime.
                  </p>
                </div>
              ) : (
                hiddenApps.map((app, idx) => {
                  const isFocused = subFocusIndex === idx;
                  const isRestoring = restoringAppId === app.id;
                  return (
                    <button
                      key={app.id}
                      type="button"
                      data-qs-focused={isFocused ? 'true' : undefined}
                      disabled={restoringAppId !== null}
                      onMouseEnter={() => setSubFocusIndex(idx)}
                      onFocus={() => setSubFocusIndex(idx)}
                      onClick={() => void handleRestoreHiddenApp(app)}
                      className={`tv-card relative flex w-full items-center justify-between gap-4 rounded-[1rem] border px-5 py-4 text-left focus:outline-none ${
                        isFocused
                          ? 'tv-btn-focused border-white/25 bg-[#1B2230]'
                          : 'border-white/10 bg-[#151A25]'
                      }`}
                    >
                      <span className="truncate text-[1.18rem] font-semibold text-white">
                        {app.name}
                      </span>
                      <span className="flex shrink-0 items-center gap-2 rounded-full bg-[#38BDF8]/18 px-3.5 py-1.5 text-[0.875rem] font-semibold text-[#38BDF8]">
                        {isRestoring && (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        )}
                        <span>Show on home</span>
                      </span>
                      <span
                        aria-hidden="true"
                        className={`tv-focus-ring pointer-events-none absolute -inset-[3px] rounded-[1.08rem] border-[3px] border-[#38BDF8] ${
                          isFocused ? 'tv-focus-ring-active' : ''
                        }`}
                      />
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-white/10 px-9 py-4 text-[0.92rem] text-[#64748B]">
          {view === 'sound' && subFocusIndex === 0
            ? 'Left / Right volume · Up / Down navigate · Back returns'
            : 'Up / Down navigate · Enter / A select · Back returns'}
        </div>
      </aside>
    </div>
  );
});
