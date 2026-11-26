export const REMOTE_TOKEN_STORAGE_KEY = 'xlabRemoteToken';

export type RemoteKey =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'ok'
  | 'back'
  | 'home'
  | 'playpause'
  | 'voldown'
  | 'mute'
  | 'volup'
  | 'backspace';

export type RemotePowerAction = 'suspend' | 'reboot' | 'poweroff';

export type RemoteMousePayload =
  | { dx: number; dy: number }
  | { click: 'left' | 'right' }
  | { scroll: number };

export interface RemoteAppItem {
  id: string;
  name: string;
  color: string;
  icon: string;
}

export interface RemoteAppsResponse {
  apps: RemoteAppItem[];
  running: string | null;
  input: boolean;
}

export type RemoteResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string; unauthorized?: boolean };

type UnauthorizedListener = () => void;
let unauthorizedListener: UnauthorizedListener | null = null;

export function setRemoteUnauthorizedListener(
  listener: UnauthorizedListener | null
): void {
  unauthorizedListener = listener;
}

export function getStoredRemoteToken(): string {
  try {
    return window.localStorage.getItem(REMOTE_TOKEN_STORAGE_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function saveRemoteToken(token: string): void {
  try {
    window.localStorage.setItem(REMOTE_TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore storage quota errors
  }
}

export function clearRemoteToken(): void {
  try {
    window.localStorage.removeItem(REMOTE_TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

function handleUnauthorized(): void {
  clearRemoteToken();
  unauthorizedListener?.();
}

function buildRemoteHeaders(includeJson = false): HeadersInit {
  const headers: Record<string, string> = {
    'X-Remote-Token': getStoredRemoteToken(),
  };
  if (includeJson) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function postRemoteCommand(
  path: string,
  body: Record<string, unknown>
): Promise<RemoteResult> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: buildRemoteHeaders(true),
      body: JSON.stringify(body),
    });

    if (response.status === 401) {
      handleUnauthorized();
      return {
        ok: false,
        error: 'Session expired. Pair your phone again.',
        unauthorized: true,
      };
    }

    const payload = await parseJsonSafe<{ ok?: boolean; error?: string }>(
      response
    );

    if (payload && payload.ok === false) {
      return {
        ok: false,
        error:
          typeof payload.error === 'string' && payload.error.trim().length > 0
            ? payload.error
            : 'Command failed.',
      };
    }

    if (response.ok || (payload && payload.ok === true)) {
      return { ok: true };
    }

    return {
      ok: false,
      error: `Request failed (HTTP ${response.status}).`,
    };
  } catch {
    return {
      ok: false,
      error: "Can't reach the TV",
    };
  }
}

/**
 * Pairs the phone using a 6-digit code via POST /remote/pair.
 */
export async function pairRemotePhone(
  code: string,
  name: string
): Promise<RemoteResult<{ token: string }>> {
  try {
    const response = await fetch('/remote/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, name }),
    });

    const payload = await parseJsonSafe<{
      ok?: boolean;
      token?: string;
      error?: string;
    }>(response);

    if (payload && payload.ok === false) {
      return {
        ok: false,
        error:
          typeof payload.error === 'string' && payload.error.trim().length > 0
            ? payload.error
            : 'Invalid pairing code.',
      };
    }

    if (response.ok && payload && typeof payload.token === 'string' && payload.token) {
      saveRemoteToken(payload.token);
      return { ok: true, data: { token: payload.token } };
    }

    return {
      ok: false,
      error:
        payload?.error ||
        (response.status === 401 || response.status === 403
          ? 'Invalid or expired pairing code.'
          : `Pairing failed (HTTP ${response.status}).`),
    };
  } catch {
    return {
      ok: false,
      error: "Can't reach the TV",
    };
  }
}

/**
 * Fetches installed TV apps, active app ID, and input availability from GET /remote/apps.
 */
export async function fetchRemoteApps(
  signal?: AbortSignal
): Promise<RemoteResult<RemoteAppsResponse>> {
  try {
    const response = await fetch('/remote/apps', {
      method: 'GET',
      headers: buildRemoteHeaders(),
      signal,
    });

    if (response.status === 401) {
      handleUnauthorized();
      return {
        ok: false,
        error: 'Session expired. Pair your phone again.',
        unauthorized: true,
      };
    }

    const payload = await parseJsonSafe<
      Partial<RemoteAppsResponse> & { ok?: boolean; error?: string }
    >(response);

    if (payload && payload.ok === false) {
      return {
        ok: false,
        error:
          typeof payload.error === 'string' && payload.error.trim().length > 0
            ? payload.error
            : 'Could not load TV apps.',
      };
    }

    if (!response.ok || !payload || !Array.isArray(payload.apps)) {
      return {
        ok: false,
        error: `Could not load TV apps (HTTP ${response.status}).`,
      };
    }

    return {
      ok: true,
      data: {
        apps: payload.apps,
        running:
          typeof payload.running === 'string' && payload.running.length > 0
            ? payload.running
            : null,
        input: payload.input !== false,
      },
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    return {
      ok: false,
      error: "Can't reach the TV",
    };
  }
}

export function sendRemoteKey(key: RemoteKey): Promise<RemoteResult> {
  return postRemoteCommand('/remote/key', { key });
}

export function sendRemoteMouse(
  payload: RemoteMousePayload
): Promise<RemoteResult> {
  return postRemoteCommand('/remote/mouse', payload);
}

export function sendRemoteText(text: string): Promise<RemoteResult> {
  return postRemoteCommand('/remote/text', { text });
}

export function launchRemoteApp(id: string): Promise<RemoteResult> {
  return postRemoteCommand('/remote/launch', { id });
}

export function sendRemotePower(
  action: RemotePowerAction
): Promise<RemoteResult> {
  return postRemoteCommand('/remote/power', { action });
}
