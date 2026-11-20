import { api } from './apiClient';

export const documentsApi = {
  tree: (caseId) => api.get(`/cases/${caseId}/documents`),
  upload: (caseId, { file, ...fields }, onProgress) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null && v !== '') fd.append(k, v);
    fd.append('file', file);
    return api.upload(`/cases/${caseId}/documents`, fd, onProgress);
  },
  get: (id) => api.get(`/documents/${id}`),
  update: (id, body) => api.patch(`/documents/${id}`, body),
  archive: (id, reason) => api.post(`/documents/${id}/archive`, { reason }),
  link: (id, { versionId, disposition = 'attachment' } = {}) => api.post(`/documents/${id}/link`, { ...(versionId ? { versionId } : {}), disposition }),
  requests: (caseId) => api.get(`/cases/${caseId}/document-requests`),
  createRequest: (caseId, body) => api.post(`/cases/${caseId}/document-requests`, body),
  cancelRequest: (id) => api.post(`/document-requests/${id}/cancel`),
  clientRepository: (clientId) => api.get(`/repository/clients/${clientId}`),
  myRepository: () => api.get('/repository/me'),
};

/** Opens a short-lived signed link: downloads, or previews inline in a new tab. */
export async function openDocument(id, { versionId, disposition = 'attachment' } = {}) {
  const { url } = await documentsApi.link(id, { versionId, disposition });
  if (disposition === 'inline') window.open(url, '_blank', 'noopener');
  else {
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}
