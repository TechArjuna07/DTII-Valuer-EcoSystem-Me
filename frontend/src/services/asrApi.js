import { api } from './apiClient';

/** IGR Maharashtra eASR (ready-reckoner) rates — shared platform data, fetched from the government site on first use. */
export const asrApi = {
  districts: () => api.get('/asr/districts'),
  talukas: (districtId) => api.get(`/asr/districts/${districtId}/talukas`),
  villages: (talukaId) => api.get(`/asr/talukas/${talukaId}/villages`),
  years: () => api.get('/asr/years'),
  rates: (villageId, year) => api.get(`/asr/villages/${villageId}/rates`, { year }),
  refresh: (villageId, year) => api.post(`/asr/villages/${villageId}/refresh`, year ? { year } : {}),
  status: () => api.get('/asr/status'),
};
