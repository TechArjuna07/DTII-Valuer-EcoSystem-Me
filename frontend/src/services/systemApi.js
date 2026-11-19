import { api } from './apiClient';

/** Readiness of the API and its dependencies. The API answers 503 with the same body shape when degraded. */
export async function getReadiness() {
  try {
    return await api.get('/health/ready');
  } catch (e) {
    if (e.status === 503) return { status: 'error', checks: null, degraded: true };
    throw e;
  }
}
