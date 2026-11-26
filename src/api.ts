import {
  mockAudioSettings,
  mockBluetoothSettings,
  mockData,
  mockHiddenApps,
  mockStoreData,
  mockUpdatesInfo,
  mockWifiSettings,
  type AudioSettingsState,
  type BluetoothSettingsState,
  type HiddenAppItem,
  type HiddenAppsPayload,
  type MockData,
  type StoreJobAction,
  type StorePayload,
  type UpdatesInfo,
  type WifiSettingsState,
} from './mock';

export type PowerAction = 'suspend' | 'reboot' | 'poweroff' | 'exit';

export type ApiActionResponse =
  | { ok: true }
  | { ok: false; error: string };

export interface StatusResponse {
  running: string | null;
  open: string[];
}

export interface AppsFetchResult {
  data: MockData;
  ok: boolean;
  usedFallback: boolean;
  error?: string;
}

export interface StoreFetchResult {
  data: StorePayload;
  ok: boolean;
  usedFallback: boolean;
  error?: string;
}

function getAuthToken(): string {
  if (typeof document === 'undefined') {
    return '';
  }
  const meta = document.querySelector<HTMLMetaElement>('meta[name="xlab-token"]');
  return meta?.getAttribute('content')?.trim() ?? '';
}

function buildHeaders(includeJsonContentType = false): HeadersInit {
  const headers: Record<string, string> = {
    'X-XLab-Token': getAuthToken(),
  };
  if (includeJsonContentType) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

function isValidAppsPayload(data: unknown): data is MockData {
  if (!data || typeof data !== 'object') {
    return false;
  }
  const candidate = data as Partial<MockData>;
  return Array.isArray(candidate.hero) && Array.isArray(candidate.rows);
}

function isValidStorePayload(data: unknown): data is StorePayload {
  if (!data || typeof data !== 'object') {
    return false;
  }
  const candidate = data as Partial<StorePayload>;
  return Array.isArray(candidate.items);
}

/**
 * Checks whether a launcher payload contains at least one hero item or row item.
 */
export function isAppsPayloadEmpty(data: MockData): boolean {
  const hasHero = data.hero.length > 0;
  const hasRowItems = data.rows.some((row) => row.items.length > 0);
  return !hasHero && !hasRowItems;
}

/**
 * Fetches launcher hero items and rows from GET /api/apps with full status info.
 * In dev mode, falls back to src/mock.ts when the local backend is unreachable.
 */
export async function fetchAppsWithStatus(
  signal?: AbortSignal
): Promise<AppsFetchResult> {
  try {
    const response = await fetch('/api/apps', {
      method: 'GET',
      headers: buildHeaders(),
      signal,
    });

    if (!response.ok) {
      return {
        data: mockData,
        ok: false,
        usedFallback: true,
        error: `Could not load apps (HTTP ${response.status}).`,
      };
    }

    const data: unknown = await response.json();
    if (!isValidAppsPayload(data)) {
      return {
        data: mockData,
        ok: false,
        usedFallback: true,
        error: 'Received an unexpected app list from the backend.',
      };
    }

    return {
      data,
      ok: true,
      usedFallback: false,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    return {
      data: mockData,
      ok: false,
      usedFallback: true,
      error: 'Unable to connect to the local xLab TV service.',
    };
  }
}

/**
 * Convenience wrapper returning MockData directly (falls back to src/mock.ts on failure).
 */
export async function fetchApps(signal?: AbortSignal): Promise<MockData> {
  try {
    const result = await fetchAppsWithStatus(signal);
    return result.data;
  } catch {
    return mockData;
  }
}

/**
 * Fetches available Store catalog items and active install/remove jobs from GET /api/store.
 */
export async function fetchStoreWithStatus(
  signal?: AbortSignal
): Promise<StoreFetchResult> {
  try {
    const response = await fetch('/api/store', {
      method: 'GET',
      headers: buildHeaders(),
      signal,
    });

    if (!response.ok) {
      return {
        data: mockStoreData,
        ok: false,
        usedFallback: true,
        error: `Could not load Store catalog (HTTP ${response.status}).`,
      };
    }

    const data: unknown = await response.json();
    if (!isValidStorePayload(data)) {
      return {
        data: mockStoreData,
        ok: false,
        usedFallback: true,
        error: 'Received an unexpected Store catalog from the backend.',
      };
    }

    return {
      data,
      ok: true,
      usedFallback: false,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    return {
      data: mockStoreData,
      ok: false,
      usedFallback: true,
      error: 'Unable to reach the xLab TV Store service.',
    };
  }
}

/**
 * Requests an app install or removal from POST /api/store (202 = accepted).
 */
export async function submitStoreAction(
  id: string,
  action: StoreJobAction
): Promise<ApiActionResponse> {
  try {
    const response = await fetch('/api/store', {
      method: 'POST',
      headers: buildHeaders(true),
      body: JSON.stringify({ id, action }),
    });

    let payload: Partial<{ ok: boolean; error: string }> | null = null;
    try {
      payload = (await response.json()) as Partial<{ ok: boolean; error: string }>;
    } catch {
      payload = null;
    }

    if (response.status === 202 || (payload && payload.ok === true)) {
      return { ok: true };
    }

    if (payload && payload.ok === false) {
      return {
        ok: false,
        error:
          typeof payload.error === 'string' && payload.error.trim().length > 0
            ? payload.error
            : `Failed to ${action} "${id}".`,
      };
    }

    if (response.ok) {
      return { ok: true };
    }

    return {
      ok: false,
      error: `Store request failed (HTTP ${response.status}).`,
    };
  } catch {
    return {
      ok: false,
      error: 'Unable to reach xLab TV Store backend.',
    };
  }
}

/**
 * Requests the local backend to launch an app or content item by ID.
 */
export async function launchApp(id: string): Promise<ApiActionResponse> {
  try {
    const response = await fetch('/api/launch', {
      method: 'POST',
      headers: buildHeaders(true),
      body: JSON.stringify({ id }),
    });

    let payload: Partial<{ ok: boolean; error: string }> | null = null;
    try {
      payload = (await response.json()) as Partial<{ ok: boolean; error: string }>;
    } catch {
      payload = null;
    }

    if (payload && payload.ok === true) {
      return { ok: true };
    }

    if (payload && payload.ok === false) {
      return {
        ok: false,
        error:
          typeof payload.error === 'string' && payload.error.trim().length > 0
            ? payload.error
            : `Failed to open "${id}".`,
      };
    }

    if (response.ok) {
      return { ok: true };
    }

    return {
      ok: false,
      error: `Launch request failed (HTTP ${response.status}).`,
    };
  } catch {
    return {
      ok: false,
      error: 'Unable to reach xLab TV backend.',
    };
  }
}

/**
 * Polls the currently running app ID from GET /api/status.
 * Returns null if the backend cannot be reached.
 */
export async function fetchStatus(
  signal?: AbortSignal
): Promise<StatusResponse | null> {
  try {
    const response = await fetch('/api/status', {
      method: 'GET',
      headers: buildHeaders(),
      signal,
    });

    if (!response.ok) {
      return null;
    }

    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !('running' in data)) {
      return null;
    }

    const raw = data as { running: unknown; open?: unknown };
    const running =
      typeof raw.running === 'string' && raw.running.length > 0
        ? raw.running
        : null;
    const open = Array.isArray(raw.open)
      ? raw.open.filter(
          (item): item is string => typeof item === 'string' && item.length > 0
        )
      : [];

    return { running, open };
  } catch {
    return null;
  }
}

/**
 * Sends a confirmed power or session action to POST /api/power.
 */
export async function sendPowerAction(
  action: PowerAction
): Promise<ApiActionResponse> {
  try {
    const response = await fetch('/api/power', {
      method: 'POST',
      headers: buildHeaders(true),
      body: JSON.stringify({ action }),
    });

    let payload: Partial<{ ok: boolean; error: string }> | null = null;
    try {
      payload = (await response.json()) as Partial<{ ok: boolean; error: string }>;
    } catch {
      payload = null;
    }

    if (payload && payload.ok === true) {
      return { ok: true };
    }

    if (payload && payload.ok === false) {
      return {
        ok: false,
        error:
          typeof payload.error === 'string' && payload.error.trim().length > 0
            ? payload.error
            : `Power action "${action}" failed.`,
      };
    }

    if (response.ok) {
      return { ok: true };
    }

    return {
      ok: false,
      error: `Power command failed (HTTP ${response.status}).`,
    };
  } catch {
    return {
      ok: false,
      error: 'Unable to reach xLab TV backend.',
    };
  }
}

export interface RemotePairingInfo {
  url: string;
  pairUrl: string;
  code: string;
  expiresIn: number;
  devices: number;
  inputError: string | null;
}

export type RemoteInfoFetchResult =
  | {
      ok: true;
      data: RemotePairingInfo;
      usedFallback: boolean;
    }
  | {
      ok: false;
      data: null;
      usedFallback: false;
      error: string;
    };

function buildMockRemoteInfo(): RemotePairingInfo {
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:8765';
  const url = `${origin}/remote`;
  const code = String(Math.floor(100000 + Math.random() * 900000));
  return {
    url,
    pairUrl: `${url}#pair=${code}`,
    code,
    expiresIn: 120,
    devices: 1,
    inputError: null,
  };
}

/**
 * Fetches phone-remote pairing details from GET /api/remote.
 * Falls back to a local preview payload in dev mode when no backend is running.
 */
export async function fetchRemoteInfo(
  signal?: AbortSignal
): Promise<RemoteInfoFetchResult> {
  try {
    const response = await fetch('/api/remote', {
      method: 'GET',
      headers: buildHeaders(),
      signal,
    });

    if (!response.ok) {
      if (import.meta.env.DEV) {
        return { ok: true, data: buildMockRemoteInfo(), usedFallback: true };
      }
      return {
        ok: false,
        data: null,
        usedFallback: false,
        error: `Could not load phone remote info (HTTP ${response.status}).`,
      };
    }

    const raw = (await response.json()) as Partial<RemotePairingInfo>;
    const pairUrl = typeof raw.pairUrl === 'string' ? raw.pairUrl : '';
    const derivedUrl = pairUrl ? pairUrl.split('#')[0] : '';
    const url =
      typeof raw.url === 'string' && raw.url.trim().length > 0
        ? raw.url
        : derivedUrl;
    const code = typeof raw.code === 'string' ? raw.code : String(raw.code ?? '');
    const expiresIn =
      typeof raw.expiresIn === 'number' && Number.isFinite(raw.expiresIn)
        ? Math.max(0, Math.floor(raw.expiresIn))
        : 0;
    const devices =
      typeof raw.devices === 'number' && Number.isFinite(raw.devices)
        ? Math.max(0, Math.floor(raw.devices))
        : 0;
    const inputError =
      raw.inputError === null || raw.inputError === undefined
        ? null
        : String(raw.inputError);

    return {
      ok: true,
      data: { url, pairUrl, code, expiresIn, devices, inputError },
      usedFallback: false,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    if (import.meta.env.DEV) {
      return { ok: true, data: buildMockRemoteInfo(), usedFallback: true };
    }
    return {
      ok: false,
      data: null,
      usedFallback: false,
      error: 'Unable to reach xLab TV backend.',
    };
  }
}

/**
 * Unpairs all connected phone remotes via POST /api/remote {"action":"forget"}.
 */
export async function forgetAllPhones(): Promise<ApiActionResponse> {
  try {
    const response = await fetch('/api/remote', {
      method: 'POST',
      headers: buildHeaders(true),
      body: JSON.stringify({ action: 'forget' }),
    });

    let payload: Partial<{ ok: boolean; error: string }> | null = null;
    try {
      payload = (await response.json()) as Partial<{ ok: boolean; error: string }>;
    } catch {
      payload = null;
    }

    if (payload && payload.ok === true) {
      return { ok: true };
    }

    if (payload && payload.ok === false) {
      return {
        ok: false,
        error:
          typeof payload.error === 'string' && payload.error.trim().length > 0
            ? payload.error
            : 'Could not forget paired phones.',
      };
    }

    if (response.ok) {
      return { ok: true };
    }

    return {
      ok: false,
      error: `Request failed (HTTP ${response.status}).`,
    };
  } catch {
    return {
      ok: false,
      error: 'Unable to reach xLab TV backend.',
    };
  }
}

// ============================================================================
// Card Menu, Hidden Apps, Updates & Quick Settings APIs
// ============================================================================

export type SettingsDataResult<T> =
  | { ok: true; data: T; usedFallback?: boolean }
  | { ok: false; error: string };

// In-memory stateful mocks for dev mode (only used when backend is unreachable in DEV)
let devWifiState: WifiSettingsState = structuredClone(mockWifiSettings);
let devBluetoothState: BluetoothSettingsState = structuredClone(
  mockBluetoothSettings
);
let devAudioState: AudioSettingsState = structuredClone(mockAudioSettings);
let devHiddenApps: HiddenAppItem[] = structuredClone(mockHiddenApps.apps);

async function parseJsonSafe(response: Response): Promise<unknown | null> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function extractApiError(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    typeof (payload as { error: unknown }).error === 'string' &&
    (payload as { error: string }).error.trim().length > 0
  ) {
    return (payload as { error: string }).error;
  }
  return fallback;
}

async function postSimpleAction(
  url: string,
  body: Record<string, unknown>,
  fallbackError: string
): Promise<ApiActionResponse> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(true),
      body: JSON.stringify(body),
    });

    const payload = await parseJsonSafe(response);
    if (payload && typeof payload === 'object' && 'ok' in payload) {
      const typed = payload as { ok: unknown; error?: unknown };
      if (typed.ok === true) {
        return { ok: true };
      }
      if (typed.ok === false) {
        return { ok: false, error: extractApiError(payload, fallbackError) };
      }
    }

    if (response.ok) {
      return { ok: true };
    }

    if (import.meta.env.DEV && response.status === 404 && payload === null) {
      return { ok: true };
    }

    return {
      ok: false,
      error: `${fallbackError} (HTTP ${response.status}).`,
    };
  } catch {
    if (import.meta.env.DEV) {
      return { ok: true };
    }
    return {
      ok: false,
      error: 'Unable to reach xLab TV backend.',
    };
  }
}

/**
 * Closes an open app via POST /api/close {"id"}.
 */
export async function closeApp(id: string): Promise<ApiActionResponse> {
  return postSimpleAction('/api/close', { id }, `Couldn't close "${id}"`);
}

/**
 * Moves an app left or right in its row via POST /api/apps/move {"id", "direction"}.
 */
export async function moveApp(
  id: string,
  direction: 'left' | 'right'
): Promise<ApiActionResponse> {
  return postSimpleAction(
    '/api/apps/move',
    { id, direction },
    `Couldn't move "${id}"`
  );
}

/**
 * Hides or unhides an app on the home screen via POST /api/apps/hide {"id", "hidden"}.
 */
export async function setAppHidden(
  id: string,
  hidden: boolean,
  displayName?: string
): Promise<ApiActionResponse> {
  const result = await postSimpleAction(
    '/api/apps/hide',
    { id, hidden },
    hidden ? `Couldn't hide "${id}"` : `Couldn't restore "${id}"`
  );

  if (import.meta.env.DEV && result.ok) {
    if (hidden) {
      if (!devHiddenApps.some((entry) => entry.id === id)) {
        devHiddenApps = [
          ...devHiddenApps,
          { id, name: displayName ?? id },
        ];
      }
    } else {
      devHiddenApps = devHiddenApps.filter((entry) => entry.id !== id);
    }
  }

  return result;
}

/**
 * Fetches hidden apps list from GET /api/apps/hidden.
 */
export async function fetchHiddenApps(
  signal?: AbortSignal
): Promise<SettingsDataResult<HiddenAppsPayload>> {
  try {
    const response = await fetch('/api/apps/hidden', {
      method: 'GET',
      headers: buildHeaders(),
      signal,
    });

    const payload = await parseJsonSafe(response);
    if (!response.ok) {
      if (import.meta.env.DEV && payload === null) {
        return {
          ok: true,
          data: { apps: structuredClone(devHiddenApps) },
          usedFallback: true,
        };
      }
      return {
        ok: false,
        error: extractApiError(
          payload,
          `Could not load hidden apps (HTTP ${response.status}).`
        ),
      };
    }

    if (
      payload &&
      typeof payload === 'object' &&
      Array.isArray((payload as { apps?: unknown }).apps)
    ) {
      const apps = (payload as { apps: unknown[] }).apps
        .filter(
          (entry): entry is HiddenAppItem =>
            Boolean(entry) &&
            typeof entry === 'object' &&
            typeof (entry as { id?: unknown }).id === 'string'
        )
        .map((entry) => ({
          id: entry.id,
          name:
            typeof entry.name === 'string' && entry.name.trim().length > 0
              ? entry.name
              : entry.id,
        }));
      return { ok: true, data: { apps } };
    }

    if (import.meta.env.DEV) {
      return {
        ok: true,
        data: { apps: structuredClone(devHiddenApps) },
        usedFallback: true,
      };
    }

    return { ok: false, error: 'Unexpected hidden apps response.' };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    if (import.meta.env.DEV) {
      return {
        ok: true,
        data: { apps: structuredClone(devHiddenApps) },
        usedFallback: true,
      };
    }
    return { ok: false, error: 'Unable to reach xLab TV backend.' };
  }
}

/**
 * Fetches available update counts from GET /api/updates.
 */
export async function fetchUpdates(
  signal?: AbortSignal
): Promise<UpdatesInfo | null> {
  try {
    const response = await fetch('/api/updates', {
      method: 'GET',
      headers: buildHeaders(),
      signal,
    });

    const payload = await parseJsonSafe(response);
    if (!response.ok || !payload || typeof payload !== 'object') {
      return import.meta.env.DEV ? structuredClone(mockUpdatesInfo) : null;
    }

    const raw = payload as Record<string, unknown>;
    const xlabtv =
      typeof raw.xlabtv === 'boolean' || typeof raw.xlabtv === 'number'
        ? raw.xlabtv
        : false;
    const apps =
      typeof raw.apps === 'number' && Number.isFinite(raw.apps)
        ? Math.max(0, Math.floor(raw.apps))
        : 0;
    const system =
      typeof raw.system === 'number' && Number.isFinite(raw.system)
        ? Math.max(0, Math.floor(raw.system))
        : 0;
    const xlabtvCount =
      typeof xlabtv === 'number' ? Math.max(0, xlabtv) : xlabtv ? 1 : 0;
    const total =
      typeof raw.total === 'number' && Number.isFinite(raw.total)
        ? Math.max(0, Math.floor(raw.total))
        : xlabtvCount + apps + system;
    const checked = typeof raw.checked === 'string' ? raw.checked : null;

    return { xlabtv, apps, system, total, checked };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    return import.meta.env.DEV ? structuredClone(mockUpdatesInfo) : null;
  }
}

function normalizeWifiState(raw: unknown): WifiSettingsState | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.enabled !== 'boolean') {
    return null;
  }
  const ethernet = Boolean(obj.ethernet);
  const rawConnected = obj.connected;
  const connected =
    rawConnected &&
    typeof rawConnected === 'object' &&
    typeof (rawConnected as { ssid?: unknown }).ssid === 'string'
      ? {
          ssid: (rawConnected as { ssid: string }).ssid,
          signal:
            typeof (rawConnected as { signal?: unknown }).signal === 'number'
              ? (rawConnected as { signal: number }).signal
              : 0,
        }
      : null;

  const networks = Array.isArray(obj.networks)
    ? obj.networks
        .filter(
          (entry): entry is Record<string, unknown> =>
            Boolean(entry) &&
            typeof entry === 'object' &&
            typeof (entry as { ssid?: unknown }).ssid === 'string'
        )
        .map((entry) => ({
          ssid: entry.ssid as string,
          signal:
            typeof entry.signal === 'number' && Number.isFinite(entry.signal)
              ? Math.max(0, Math.min(100, Math.round(entry.signal)))
              : 0,
          secure: Boolean(entry.secure),
          connected: Boolean(entry.connected),
        }))
    : [];

  return { enabled: obj.enabled, ethernet, connected, networks };
}

export async function fetchWifiSettings(
  signal?: AbortSignal
): Promise<SettingsDataResult<WifiSettingsState>> {
  try {
    const response = await fetch('/api/settings/wifi', {
      method: 'GET',
      headers: buildHeaders(),
      signal,
    });
    const payload = await parseJsonSafe(response);

    if (!response.ok) {
      if (import.meta.env.DEV && payload === null) {
        return {
          ok: true,
          data: structuredClone(devWifiState),
          usedFallback: true,
        };
      }
      return {
        ok: false,
        error: extractApiError(
          payload,
          `Could not load Wi-Fi settings (HTTP ${response.status}).`
        ),
      };
    }

    const parsed = normalizeWifiState(payload);
    if (parsed) {
      return { ok: true, data: parsed };
    }
    if (import.meta.env.DEV) {
      return {
        ok: true,
        data: structuredClone(devWifiState),
        usedFallback: true,
      };
    }
    return { ok: false, error: 'Unexpected Wi-Fi response.' };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    if (import.meta.env.DEV) {
      return {
        ok: true,
        data: structuredClone(devWifiState),
        usedFallback: true,
      };
    }
    return { ok: false, error: 'Unable to reach xLab TV backend.' };
  }
}

export type WifiActionPayload =
  | { action: 'power'; on: boolean }
  | { action: 'rescan' }
  | { action: 'connect'; ssid: string; password?: string }
  | { action: 'disconnect' };

function applyDevWifiAction(body: WifiActionPayload): WifiSettingsState {
  if (body.action === 'power') {
    devWifiState = {
      ...devWifiState,
      enabled: body.on,
      connected: body.on ? devWifiState.connected : null,
      networks: body.on
        ? devWifiState.networks
        : devWifiState.networks.map((n) => ({ ...n, connected: false })),
    };
  } else if (body.action === 'disconnect') {
    devWifiState = {
      ...devWifiState,
      connected: null,
      networks: devWifiState.networks.map((n) => ({ ...n, connected: false })),
    };
  } else if (body.action === 'connect') {
    const match = devWifiState.networks.find((n) => n.ssid === body.ssid);
    const signal = match?.signal ?? 72;
    devWifiState = {
      ...devWifiState,
      enabled: true,
      connected: { ssid: body.ssid, signal },
      networks: devWifiState.networks.map((n) => ({
        ...n,
        connected: n.ssid === body.ssid,
      })),
    };
  }
  return structuredClone(devWifiState);
}

export async function postWifiAction(
  body: WifiActionPayload
): Promise<SettingsDataResult<WifiSettingsState>> {
  try {
    const response = await fetch('/api/settings/wifi', {
      method: 'POST',
      headers: buildHeaders(true),
      body: JSON.stringify(body),
    });
    const payload = await parseJsonSafe(response);

    if (payload && typeof payload === 'object' && 'ok' in payload) {
      const typed = payload as { ok: unknown };
      if (typed.ok === false) {
        return {
          ok: false,
          error: extractApiError(payload, 'Wi-Fi action failed.'),
        };
      }
      const parsed = normalizeWifiState(payload);
      if (parsed) {
        return { ok: true, data: parsed };
      }
    }

    if (response.ok) {
      const parsed = normalizeWifiState(payload);
      if (parsed) {
        return { ok: true, data: parsed };
      }
    }

    if (import.meta.env.DEV && payload === null) {
      if (body.action === 'rescan' || body.action === 'connect') {
        await new Promise((r) => window.setTimeout(r, 700));
      }
      return { ok: true, data: applyDevWifiAction(body), usedFallback: true };
    }

    return {
      ok: false,
      error: extractApiError(
        payload,
        `Wi-Fi request failed (HTTP ${response.status}).`
      ),
    };
  } catch {
    if (import.meta.env.DEV) {
      if (body.action === 'rescan' || body.action === 'connect') {
        await new Promise((r) => window.setTimeout(r, 700));
      }
      return { ok: true, data: applyDevWifiAction(body), usedFallback: true };
    }
    return { ok: false, error: 'Unable to reach xLab TV backend.' };
  }
}

function normalizeBluetoothState(raw: unknown): BluetoothSettingsState | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.available !== 'boolean') {
    return null;
  }
  const powered = Boolean(obj.powered);
  const devices = Array.isArray(obj.devices)
    ? obj.devices
        .filter(
          (entry): entry is Record<string, unknown> =>
            Boolean(entry) &&
            typeof entry === 'object' &&
            typeof (entry as { mac?: unknown }).mac === 'string'
        )
        .map((entry) => ({
          mac: entry.mac as string,
          name:
            typeof entry.name === 'string' && entry.name.trim().length > 0
              ? entry.name
              : (entry.mac as string),
          paired: Boolean(entry.paired),
          connected: Boolean(entry.connected),
        }))
    : [];

  return { available: obj.available, powered, devices };
}

export async function fetchBluetoothSettings(
  signal?: AbortSignal
): Promise<SettingsDataResult<BluetoothSettingsState>> {
  try {
    const response = await fetch('/api/settings/bluetooth', {
      method: 'GET',
      headers: buildHeaders(),
      signal,
    });
    const payload = await parseJsonSafe(response);

    if (!response.ok) {
      if (import.meta.env.DEV && payload === null) {
        return {
          ok: true,
          data: structuredClone(devBluetoothState),
          usedFallback: true,
        };
      }
      return {
        ok: false,
        error: extractApiError(
          payload,
          `Could not load Bluetooth settings (HTTP ${response.status}).`
        ),
      };
    }

    const parsed = normalizeBluetoothState(payload);
    if (parsed) {
      return { ok: true, data: parsed };
    }
    if (import.meta.env.DEV) {
      return {
        ok: true,
        data: structuredClone(devBluetoothState),
        usedFallback: true,
      };
    }
    return { ok: false, error: 'Unexpected Bluetooth response.' };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    if (import.meta.env.DEV) {
      return {
        ok: true,
        data: structuredClone(devBluetoothState),
        usedFallback: true,
      };
    }
    return { ok: false, error: 'Unable to reach xLab TV backend.' };
  }
}

export type BluetoothActionPayload =
  | { action: 'power'; on: boolean }
  | { action: 'scan' }
  | { action: 'pair'; mac: string }
  | { action: 'connect'; mac: string }
  | { action: 'disconnect'; mac: string }
  | { action: 'remove'; mac: string };

function applyDevBluetoothAction(
  body: BluetoothActionPayload
): BluetoothSettingsState {
  if (body.action === 'power') {
    devBluetoothState = {
      ...devBluetoothState,
      powered: body.on,
      devices: body.on
        ? devBluetoothState.devices
        : devBluetoothState.devices.map((d) => ({ ...d, connected: false })),
    };
  } else if (body.action === 'scan') {
    if (!devBluetoothState.devices.some((d) => d.mac === 'AA:BB:CC:12:34:56')) {
      devBluetoothState = {
        ...devBluetoothState,
        devices: [
          ...devBluetoothState.devices,
          {
            mac: 'AA:BB:CC:12:34:56',
            name: 'Xbox Wireless Controller',
            paired: false,
            connected: false,
          },
        ],
      };
    }
  } else if (body.action === 'pair') {
    devBluetoothState = {
      ...devBluetoothState,
      devices: devBluetoothState.devices.map((d) =>
        d.mac === body.mac ? { ...d, paired: true, connected: true } : d
      ),
    };
  } else if (body.action === 'connect') {
    devBluetoothState = {
      ...devBluetoothState,
      devices: devBluetoothState.devices.map((d) =>
        d.mac === body.mac ? { ...d, connected: true } : d
      ),
    };
  } else if (body.action === 'disconnect') {
    devBluetoothState = {
      ...devBluetoothState,
      devices: devBluetoothState.devices.map((d) =>
        d.mac === body.mac ? { ...d, connected: false } : d
      ),
    };
  } else if (body.action === 'remove') {
    devBluetoothState = {
      ...devBluetoothState,
      devices: devBluetoothState.devices.filter((d) => d.mac !== body.mac),
    };
  }
  return structuredClone(devBluetoothState);
}

export async function postBluetoothAction(
  body: BluetoothActionPayload
): Promise<SettingsDataResult<BluetoothSettingsState>> {
  try {
    const response = await fetch('/api/settings/bluetooth', {
      method: 'POST',
      headers: buildHeaders(true),
      body: JSON.stringify(body),
    });
    const payload = await parseJsonSafe(response);

    if (payload && typeof payload === 'object' && 'ok' in payload) {
      const typed = payload as { ok: unknown };
      if (typed.ok === false) {
        return {
          ok: false,
          error: extractApiError(payload, 'Bluetooth action failed.'),
        };
      }
      const parsed = normalizeBluetoothState(payload);
      if (parsed) {
        return { ok: true, data: parsed };
      }
    }

    if (response.ok) {
      const parsed = normalizeBluetoothState(payload);
      if (parsed) {
        return { ok: true, data: parsed };
      }
    }

    if (import.meta.env.DEV && payload === null) {
      if (body.action === 'scan' || body.action === 'pair') {
        await new Promise((r) => window.setTimeout(r, 900));
      }
      return {
        ok: true,
        data: applyDevBluetoothAction(body),
        usedFallback: true,
      };
    }

    return {
      ok: false,
      error: extractApiError(
        payload,
        `Bluetooth request failed (HTTP ${response.status}).`
      ),
    };
  } catch {
    if (import.meta.env.DEV) {
      if (body.action === 'scan' || body.action === 'pair') {
        await new Promise((r) => window.setTimeout(r, 900));
      }
      return {
        ok: true,
        data: applyDevBluetoothAction(body),
        usedFallback: true,
      };
    }
    return { ok: false, error: 'Unable to reach xLab TV backend.' };
  }
}

function normalizeAudioState(raw: unknown): AudioSettingsState | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.outputs)) {
    return null;
  }
  const outputs = obj.outputs
    .filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) &&
        typeof entry === 'object' &&
        typeof (entry as { id?: unknown }).id === 'string'
    )
    .map((entry) => ({
      id: entry.id as string,
      name:
        typeof entry.name === 'string' && entry.name.trim().length > 0
          ? entry.name
          : (entry.id as string),
      default: Boolean(entry.default),
    }));

  const volume =
    typeof obj.volume === 'number' && Number.isFinite(obj.volume)
      ? Math.max(0, Math.min(100, Math.round(obj.volume)))
      : 50;
  const muted = Boolean(obj.muted);

  return { outputs, volume, muted };
}

export async function fetchAudioSettings(
  signal?: AbortSignal
): Promise<SettingsDataResult<AudioSettingsState>> {
  try {
    const response = await fetch('/api/settings/audio', {
      method: 'GET',
      headers: buildHeaders(),
      signal,
    });
    const payload = await parseJsonSafe(response);

    if (!response.ok) {
      if (import.meta.env.DEV && payload === null) {
        return {
          ok: true,
          data: structuredClone(devAudioState),
          usedFallback: true,
        };
      }
      return {
        ok: false,
        error: extractApiError(
          payload,
          `Could not load Sound settings (HTTP ${response.status}).`
        ),
      };
    }

    const parsed = normalizeAudioState(payload);
    if (parsed) {
      return { ok: true, data: parsed };
    }
    if (import.meta.env.DEV) {
      return {
        ok: true,
        data: structuredClone(devAudioState),
        usedFallback: true,
      };
    }
    return { ok: false, error: 'Unexpected Sound response.' };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    if (import.meta.env.DEV) {
      return {
        ok: true,
        data: structuredClone(devAudioState),
        usedFallback: true,
      };
    }
    return { ok: false, error: 'Unable to reach xLab TV backend.' };
  }
}

export type AudioActionPayload =
  | { action: 'up' }
  | { action: 'down' }
  | { action: 'mute' }
  | { action: 'output'; id: string };

function applyDevAudioAction(body: AudioActionPayload): AudioSettingsState {
  if (body.action === 'up') {
    devAudioState = {
      ...devAudioState,
      muted: false,
      volume: Math.min(100, devAudioState.volume + 5),
    };
  } else if (body.action === 'down') {
    devAudioState = {
      ...devAudioState,
      volume: Math.max(0, devAudioState.volume - 5),
    };
  } else if (body.action === 'mute') {
    devAudioState = {
      ...devAudioState,
      muted: !devAudioState.muted,
    };
  } else if (body.action === 'output') {
    devAudioState = {
      ...devAudioState,
      outputs: devAudioState.outputs.map((out) => ({
        ...out,
        default: out.id === body.id,
      })),
    };
  }
  return structuredClone(devAudioState);
}

export async function postAudioAction(
  body: AudioActionPayload
): Promise<SettingsDataResult<AudioSettingsState>> {
  try {
    const response = await fetch('/api/settings/audio', {
      method: 'POST',
      headers: buildHeaders(true),
      body: JSON.stringify(body),
    });
    const payload = await parseJsonSafe(response);

    if (payload && typeof payload === 'object' && 'ok' in payload) {
      const typed = payload as { ok: unknown };
      if (typed.ok === false) {
        return {
          ok: false,
          error: extractApiError(payload, 'Sound action failed.'),
        };
      }
      const parsed = normalizeAudioState(payload);
      if (parsed) {
        return { ok: true, data: parsed };
      }
    }

    if (response.ok) {
      const parsed = normalizeAudioState(payload);
      if (parsed) {
        return { ok: true, data: parsed };
      }
    }

    if (import.meta.env.DEV && payload === null) {
      return { ok: true, data: applyDevAudioAction(body), usedFallback: true };
    }

    return {
      ok: false,
      error: extractApiError(
        payload,
        `Sound request failed (HTTP ${response.status}).`
      ),
    };
  } catch {
    if (import.meta.env.DEV) {
      return { ok: true, data: applyDevAudioAction(body), usedFallback: true };
    }
    return { ok: false, error: 'Unable to reach xLab TV backend.' };
  }
}

/**
 * Opens Ubuntu Settings on the Display or Power page via POST /api/settings/open {"page"}.
 */
export async function openUbuntuSettings(
  page: 'display' | 'power'
): Promise<ApiActionResponse> {
  return postSimpleAction(
    '/api/settings/open',
    { page },
    `Couldn't open Ubuntu ${page} settings`
  );
}
