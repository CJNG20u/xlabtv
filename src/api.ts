import { mockData, type MockData } from './mock';

export type PowerAction = 'suspend' | 'reboot' | 'poweroff' | 'exit';

export type ApiActionResponse =
  | { ok: true }
  | { ok: false; error: string };

export interface StatusResponse {
  running: string | null;
}

export interface AppsFetchResult {
  data: MockData;
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

    const running = (data as { running: unknown }).running;
    return {
      running: typeof running === 'string' && running.length > 0 ? running : null,
    };
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
