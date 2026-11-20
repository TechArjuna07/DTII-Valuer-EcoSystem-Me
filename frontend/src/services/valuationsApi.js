import { api } from './apiClient';

export const valuationsApi = {
  get: (caseId) => api.get(`/cases/${caseId}/valuations`),
  createVersion: (caseId, stage, body) => api.post(`/cases/${caseId}/valuations/${stage}/versions`, body),
  attach: (caseId, stage, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.upload(`/cases/${caseId}/valuations/${stage}/attachments`, fd);
  },
  submitPreliminary: (caseId) => api.post(`/cases/${caseId}/valuations/preliminary/submit`),
  review: (caseId, decision, comments) => api.post(`/cases/${caseId}/valuations/review`, { decision, ...(comments ? { comments } : {}) }),
  approveFinal: (caseId, comments) => api.post(`/cases/${caseId}/valuations/final/approve`, comments ? { comments } : {}),
};

export const templatesApi = {
  list: () => api.get('/report-templates'),
  get: (id) => api.get(`/report-templates/${id}`),
  create: (body) => api.post('/report-templates', body),
  update: (id, body) => api.patch(`/report-templates/${id}`, body),
  addVersion: (id, bodyHtml, changeNote) => api.post(`/report-templates/${id}/versions`, { bodyHtml, ...(changeNote ? { changeNote } : {}) }),
  preview: (bodyHtml) => api.post('/report-templates/preview', { bodyHtml }),
};

export const verifyApi = { verify: (code) => api.get(`/verify/${encodeURIComponent(code)}`) };
