import { api } from './apiClient';

export const inspectionsApi = {
  property: (caseId) => api.get(`/cases/${caseId}/property`),
  saveProperty: (caseId, data) => api.put(`/cases/${caseId}/property`, { data }),
  get: (caseId) => api.get(`/cases/${caseId}/inspection`),
  schedule: (caseId, scheduledAt) => api.post(`/cases/${caseId}/inspection/schedule`, { scheduledAt }),
  start: (caseId) => api.post(`/cases/${caseId}/inspection/start`),
  saveDraft: (caseId, body) => api.put(`/cases/${caseId}/inspection`, body),
  addPhoto: (caseId, { file, ...fields }, onProgress) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null && v !== '') fd.append(k, v);
    fd.append('file', file);
    return api.upload(`/cases/${caseId}/inspection/photos`, fd, onProgress);
  },
  removePhoto: (caseId, photoId) => api.post(`/cases/${caseId}/inspection/photos/${photoId}/remove`),
  submit: (caseId) => api.post(`/cases/${caseId}/inspection/submit`),
  mine: () => api.get('/inspections/mine'),
};
