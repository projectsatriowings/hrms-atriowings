// API client for the Attenza NestJS backend.
// Auth: short-lived access token kept IN MEMORY ONLY (never localStorage,
// so a stored XSS payload cannot steal a long-lived token from disk). The
// refresh_token lives in an httpOnly cookie, so every request uses
// credentials:"include". On 401 we attempt one silent refresh and retry.
// On page reload there is no in-memory token: AuthProvider restores the
// session by calling restoreSessionFromCookie() (refresh endpoint) first.

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1").replace(/\/$/, "");

let accessToken: string | null = null;

/** In-memory only: the access token is never read from localStorage. */
export function getAccessToken(): string | null {
  return accessToken;
}

/** In-memory only: the access token is never written to localStorage. */
export function setAccessToken(t: string | null): void {
  accessToken = t;
}

type Params = Record<string, string | number | boolean | undefined | null>;

function buildUrl(path: string, params?: Params): string {
  // BASE may be relative ("/api/v1") when the app is served behind the
  // one-origin reverse proxy: new URL() needs an absolute URL, so resolve
  // relative bases against the page origin. Absolute bases ignore this.
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  const url = new URL(BASE + path, origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

// Single-flight refresh so concurrent 401s trigger only one refresh call.
let refreshing: Promise<string | null> | null = null;
function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(BASE + "/auth/refresh", { method: "POST", credentials: "include" });
        if (!res.ok) return null;
        const data = (await res.json()) as { accessToken?: string };
        setAccessToken(data.accessToken ?? null);
        return data.accessToken ?? null;
      } catch {
        return null;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

/**
 * Session restore after a page reload: there is no in-memory token, so use
 * the httpOnly refresh cookie to mint a fresh access token. Returns false
 * (logged-out state, no throw) when the cookie is absent or expired — the
 * caller must fail gracefully, never redirect-loop.
 */
export async function restoreSessionFromCookie(): Promise<boolean> {
  const token = await refreshAccessToken();
  return token !== null;
}

interface RequestOpts {
  method?: string;
  body?: BodyInit;
  json?: unknown;
  params?: Params;
  _retried?: boolean;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const token = accessToken;
  const headers: Record<string, string> = {};
  if (opts.json !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(buildUrl(path, opts.params), {
    method: opts.method ?? "GET",
    credentials: "include",
    headers,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
  });

  if (res.status === 401 && !opts._retried && !path.startsWith("/auth/")) {
    const nt = await refreshAccessToken();
    if (nt) return request<T>(path, { ...opts, _retried: true });
    setAccessToken(null);
  }

  if (!res.ok) {
    let code = "request_failed";
    let message = `Request failed (${res.status})`;
    let details: unknown;
    try {
      const j = (await res.json()) as { error?: { code?: string; message?: string; details?: unknown } };
      if (j?.error) {
        code = j.error.code ?? code;
        message = j.error.message ?? message;
        details = j.error.details;
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, code, message, details);
  }

  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export function apiGet<T>(path: string, params?: Params): Promise<T> {
  return request<T>(path, { method: "GET", params });
}

export function apiPost<T>(path: string, json?: unknown, params?: Params): Promise<T> {
  return request<T>(path, { method: "POST", json, params });
}

export function apiPatch<T>(path: string, json?: unknown): Promise<T> {
  return request<T>(path, { method: "PATCH", json });
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

/** Multipart upload (no JSON content-type). Used by the import wizard. */
export function apiUpload<T>(path: string, form: FormData): Promise<T> {
  return request<T>(path, { method: "POST", body: form });
}

/** Download a binary/text file (CSV, PDF) through the authenticated channel. */
export async function downloadFile(path: string, filename: string, params?: Params): Promise<void> {
  const doFetch = async (retried: boolean): Promise<Response> => {
    const token = accessToken;
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(buildUrl(path, params), { credentials: "include", headers });
    if (res.status === 401 && !retried) {
      const nt = await refreshAccessToken();
      if (nt) return doFetch(true);
      setAccessToken(null);
    }
    return res;
  };
  const res = await doFetch(false);
  if (!res.ok) throw new ApiError(res.status, "download_failed", `Download failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function apiBase(): string {
  return BASE;
}
