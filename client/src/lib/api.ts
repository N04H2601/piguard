import { setState } from '../state/store.js';

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status = 0, details: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

type ApiFetchOptions = RequestInit & {
  suppressUnauthorized?: boolean;
};

let csrfToken: string | null = null;
let csrfPromise: Promise<string> | null = null;
let authExpiredHandler: (() => void) | null = null;

export function setAuthExpiredHandler(handler: (() => void) | null) {
  authExpiredHandler = handler;
}

export async function ensureCsrfToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && csrfToken) return csrfToken;
  if (!forceRefresh && csrfPromise) return csrfPromise;

  csrfPromise = fetch('/api/v1/auth/csrf', { credentials: 'include' })
    .then(async (res) => {
      const payload = await safeJson(res);
      if (!res.ok || !payload?.success || !payload.data?.token) {
        throw new ApiError(payload?.error ?? 'Unable to fetch CSRF token', res.status, payload);
      }
      csrfToken = payload.data.token;
      return csrfToken;
    })
    .finally(() => {
      csrfPromise = null;
    });

  return csrfPromise;
}

export async function apiFetch<T = any>(url: string, options: ApiFetchOptions = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers ?? {});

  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    headers.set('X-CSRF-Token', await ensureCsrfToken());
  }

  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers,
  });

  const payload = await safeJson(response);

  if (response.status === 401 && !options.suppressUnauthorized) {
    handleUnauthorized();
  }

  if (!response.ok || payload?.success === false) {
    throw new ApiError(payload?.error ?? response.statusText ?? 'Request failed', response.status, payload);
  }

  return (payload?.data ?? payload) as T;
}

async function safeJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { success: response.ok, data: text };
  }
}

function handleUnauthorized() {
  csrfToken = null;
  setState({
    authenticated: false,
    username: '',
    wsConnected: false,
    mobileSidebarOpen: false,
    authError: 'Session expired',
  });
  authExpiredHandler?.();
}
