import { api } from './apiClient';

export const approvalsApi = {
  get: (caseId) => api.get(`/cases/${caseId}/approval`),
  release: (caseId) => api.post(`/cases/${caseId}/approval/release`),
  decide: (caseId, decision, comments) => api.post(`/cases/${caseId}/approval/decision`, { decision, ...(comments ? { comments } : {}) }),
  signValuer: (caseId, password) => api.post(`/cases/${caseId}/signatures/valuer`, { password, consent: true }),
  signClient: (caseId, password) => api.post(`/cases/${caseId}/signatures/client`, { password, consent: true }),
  refresh: (signatureId) => api.post(`/signatures/${signatureId}/refresh`),
  verify: (signatureId) => api.post(`/signatures/${signatureId}/verify`),
};

export const portalApi = { summary: () => api.get('/portal/summary') };
