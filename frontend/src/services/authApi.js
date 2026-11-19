import axios from 'axios';
import { api, API_BASE, csrfToken, toApiError, tokenStore } from './apiClient';

/** Auth endpoints. Login / logout / switch use plain axios so the 401-refresh interceptor never loops on them. */

export async function login(email, password) {
  try {
    const res = await axios.post(`${API_BASE}/auth/login`, { email, password }, { withCredentials: true });
    tokenStore.set(res.data.accessToken);
  } catch (e) {
    throw toApiError(e);
  }
}

export async function logout() {
  await axios.post(`${API_BASE}/auth/logout`, null, { withCredentials: true, headers: { 'X-CSRF-Token': csrfToken() } }).catch(() => undefined);
  tokenStore.set(null);
}

export async function switchContext(firmId) {
  try {
    const res = await axios.post(`${API_BASE}/auth/switch-context`, { firmId }, { withCredentials: true, headers: { 'X-CSRF-Token': csrfToken() } });
    tokenStore.set(res.data.accessToken);
  } catch (e) {
    throw toApiError(e);
  }
}

export const getMe = () => api.get('/auth/me');
export const forgotPassword = (email) => api.post('/auth/forgot-password', { email });
export const tokenInfo = (token, purpose) => api.get('/auth/token-info', { token, purpose });
export const acceptInvite = (token, password) => api.post('/auth/accept-invite', { token, password });
export const resetPassword = (token, password) => api.post('/auth/reset-password', { token, password });
export const changePassword = (currentPassword, newPassword) => api.post('/auth/change-password', { currentPassword, newPassword });
export const listSessions = () => api.get('/auth/sessions');
export const revokeSession = (id) => api.delete(`/auth/sessions/${id}`);
