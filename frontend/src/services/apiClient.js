import axios from 'axios';

/**
 * API client (Axios).
 * - The access token lives ONLY in memory (never localStorage/sessionStorage) to limit XSS token theft.
 * - The refresh token is an HttpOnly, SameSite=Strict cookie handled by the browser; refresh/logout send the
 *   CSRF double-submit header read from the (non-HttpOnly) CSRF cookie.
 * - A 401 triggers ONE single-flight silent refresh, then the original request is retried once.
 * - Errors are normalised to ApiError so UI code never inspects raw Axios errors.
 */

export const API_BASE = '/api/v1';
export const CSRF_COOKIE = 'valuers_csrf';

export class ApiError extends Error {
  constructor(status, message, details, requestId) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }
}

let accessToken = null;
let refreshInFlight = null;
let onSessionExpired = null;

export const tokenStore = {
  get: () => accessToken,
  set: (t) => {
    accessToken = t;
  },
  /** Registers the callback run when the session cannot be refreshed (e.g. redirect to login). */
  onExpired: (cb) => {
    onSessionExpired = cb;
  },
};

export function csrfToken() {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : '';
}

/** Converts any Axios error into an ApiError with a user-safe message. */
export function toApiError(err) {
  if (err instanceof ApiError) return err;
  if (!err?.response) return new ApiError(0, 'Unable to reach the server. Check your connection and try again.');
  const { status, data } = err.response;
  const msg = data?.message;
  const list = Array.isArray(msg) ? msg : undefined;
  const first = list ? list[0] : typeof msg === 'string' ? msg : undefined;
  const text =
    status === 429
      ? 'Too many requests. Please wait a moment and try again.'
      : status === 413
        ? 'The file or request is too large.'
        : first || (status >= 500 ? 'Something went wrong. Please try again.' : 'Request failed');
  return new ApiError(status, text, list, data?.requestId);
}

const http = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  timeout: 30_000,
  headers: { Accept: 'application/json' },
});

http.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

/** Exchanges the refresh cookie for a new access token. Resolves false if the session is gone. */
export function refreshSession() {
  if (!refreshInFlight) {
    refreshInFlight = axios
      .post(`${API_BASE}/auth/refresh`, null, { withCredentials: true, headers: { 'X-CSRF-Token': csrfToken() }, timeout: 15_000 })
      .then((res) => {
        accessToken = res.data.accessToken;
        return true;
      })
      .catch(() => {
        accessToken = null;
        return false;
      })
      .finally(() => {
        setTimeout(() => (refreshInFlight = null), 0);
      });
  }
  return refreshInFlight;
}

http.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    const status = err.response?.status;
    const isAuthCall = original?.url?.startsWith('/auth/');
    if (status === 401 && original && !original._retried && !isAuthCall) {
      original._retried = true;
      if (await refreshSession()) return http(original);
      onSessionExpired?.();
    }
    throw toApiError(err);
  },
);

/** Drops undefined / null / empty-string params so URLs stay clean. */
const cleanParams = (params) => (params ? Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')) : undefined);

export const api = {
  get: (path, params, config) => http.get(path, { ...config, params: cleanParams(params) }).then((r) => r.data),
  post: (path, body, config) => http.post(path, body, config).then((r) => r.data),
  patch: (path, body, config) => http.patch(path, body, config).then((r) => r.data),
  put: (path, body, config) => http.put(path, body, config).then((r) => r.data),
  delete: (path, config) => http.delete(path, config).then((r) => r.data),
  /** Multipart upload with progress (0-100). */
  upload: (path, formData, onProgress) =>
    http
      .post(path, formData, {
        timeout: 0,
        onUploadProgress: onProgress ? (e) => e.total && onProgress(Math.round((e.loaded / e.total) * 100)) : undefined,
      })
      .then((r) => r.data),
};

export { http };
