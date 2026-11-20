import { api } from './apiClient';

export const casesApi = {
  list: (params) => api.get('/cases', params),
  get: (id) => api.get(`/cases/${id}`),
  create: (body) => api.post('/cases', body),
  update: (id, body) => api.patch(`/cases/${id}`, body),
  assign: (id, stage, employeeId) => api.post(`/cases/${id}/assignments`, { stage, employeeId }),
  transition: (id, action, remarks) => api.post(`/cases/${id}/transitions`, { action, ...(remarks ? { remarks } : {}) }),
  timeline: (id) => api.get(`/cases/${id}/timeline`),
  assignable: (stage, caseId) => api.get('/cases/assignable-employees', { stage, caseId }),
};

export const mastersApi = {
  banks: (params) => api.get('/masters/banks', params),
  bank: (id) => api.get(`/masters/banks/${id}`),
  createBank: (body) => api.post('/masters/banks', body),
  updateBank: (id, body) => api.patch(`/masters/banks/${id}`, body),
  categories: (params) => api.get('/masters/categories', params),
  category: (id) => api.get(`/masters/categories/${id}`),
  createCategory: (body) => api.post('/masters/categories', body),
  updateCategory: (id, body) => api.patch(`/masters/categories/${id}`, body),
  saveField: (id, body) => api.put(`/masters/categories/${id}/fields`, body),
  removeField: (id, key) => api.delete(`/masters/categories/${id}/fields/${key}`),
  documentTypes: (params) => api.get('/masters/document-types', params),
  createDocumentType: (body) => api.post('/masters/document-types', body),
  updateDocumentType: (id, body) => api.patch(`/masters/document-types/${id}`, body),
  financialYears: () => api.get('/masters/financial-years'),
  workflowSettings: () => api.get('/masters/workflow-settings'),
  updateWorkflowSettings: (body) => api.put('/masters/workflow-settings', body),
};
