import { api } from './apiClient';

export const approvalsApi = {
  get: (caseId) => api.get(`/cases/${caseId}/approval`),
  signValuer: (caseId, password) => api.post(`/cases/${caseId}/signatures/valuer`, { password, consent: true }),
  refresh: (signatureId) => api.post(`/signatures/${signatureId}/refresh`),
  verify: (signatureId) => api.post(`/signatures/${signatureId}/verify`),
};

export const portalApi = { summary: () => api.get('/portal/summary') };
