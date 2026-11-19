import { api } from './apiClient';

/** Platform (Superadmin) */
export const platformApi = {
  summary: () => api.get('/platform/summary'),
  listFirms: (params) => api.get('/platform/firms', params),
  getFirm: (id) => api.get(`/platform/firms/${id}`),
  registerFirm: (body) => api.post('/platform/firms', body),
  updateFirm: (id, body) => api.patch(`/platform/firms/${id}`, body),
  setFirmStatus: (id, status, reason) => api.post(`/platform/firms/${id}/status`, { status, reason }),
  resendAdminInvite: (firmId, userId) => api.post(`/platform/firms/${firmId}/admins/${userId}/resend-invite`),
  auditLogs: (params) => api.get('/platform/audit-logs', params),
};

/** Own firm (Firm Admin) */
export const firmApi = {
  profile: () => api.get('/firm/profile'),
  updateProfile: (body) => api.patch('/firm/profile', body),
  summary: () => api.get('/firm/summary'),
  rbac: () => api.get('/firm/rbac'),
  setPermission: (roleCode, permissionCode, granted) => api.put('/firm/rbac', { roleCode, permissionCode, granted }),
  auditLogs: (params) => api.get('/firm/audit-logs', params),
};

export const employeesApi = {
  list: (params) => api.get('/employees', params),
  get: (id) => api.get(`/employees/${id}`),
  create: (body) => api.post('/employees', body),
  update: (id, body) => api.patch(`/employees/${id}`, body),
  deactivate: (id) => api.post(`/employees/${id}/deactivate`),
  reactivate: (id) => api.post(`/employees/${id}/reactivate`),
  unlock: (id) => api.post(`/employees/${id}/unlock`),
  resendInvite: (id) => api.post(`/employees/${id}/resend-invite`),
};

export const clientsApi = {
  list: (params) => api.get('/clients', params),
  get: (id) => api.get(`/clients/${id}`),
  create: (body) => api.post('/clients', body),
  update: (id, body) => api.patch(`/clients/${id}`, body),
  deactivate: (id) => api.post(`/clients/${id}/deactivate`),
  reactivate: (id) => api.post(`/clients/${id}/reactivate`),
  portalAccess: (id) => api.post(`/clients/${id}/portal-access`),
};
