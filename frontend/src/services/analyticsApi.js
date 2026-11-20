import { api, http } from './apiClient';

export const analyticsApi = {
  dashboard: () => api.get('/dashboard'),
  caseReport: (params) => api.get('/reports/cases', params),
  /** Downloads the CSV through the authenticated client (the token never goes into a URL). */
  async downloadCaseReport(params) {
    const res = await http.get('/reports/cases', { params: { ...params, format: 'csv' }, responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `case-register-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  platformCaseStats: () => api.get('/platform/case-stats'),
};

export const notificationsApi = {
  list: (params) => api.get('/notifications', params),
  unreadCount: () => api.get('/notifications/unread-count'),
  read: (id) => api.post(`/notifications/${id}/read`),
  readAll: () => api.post('/notifications/read-all'),
};

export const smtpApi = {
  get: () => api.get('/firm/smtp'),
  save: (body) => api.put('/firm/smtp', body),
  test: (to) => api.post('/firm/smtp/test', { to }),
  logs: (params) => api.get('/firm/email-logs', params),
};
