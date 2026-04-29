const API_BASE = import.meta.env.VITE_API_URL || '/api';

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Returns auth headers for a request. If a JWT is present in localStorage,
 * adds `Authorization: Bearer <token>`. Otherwise returns an empty object so
 * unauthenticated endpoints (login, register) still work.
 *
 * Exported because a few components (BootSequence, InsightsChat,
 * GwiRecommendations, exportReport, uploads.upload) bypass `request()` and
 * call `fetch` directly — they need the same auth treatment.
 */
export function authHeaders(): Record<string, string> {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...authHeaders(),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new ApiError(response.status, error.error || 'Request failed');
  }

  return response.json();
}

// Auth
export const auth = {
  login: (email: string, password: string) =>
    request<{ user: { id: string; email: string; name: string | null }; token: string }>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password }) }
    ),
  register: (email: string, password: string, name?: string) =>
    request<{ user: { id: string; email: string; name: string | null }; token: string }>(
      '/auth/register',
      { method: 'POST', body: JSON.stringify({ email, password, name }) }
    ),
  me: () =>
    request<{ user: { id: string; email: string; name: string | null } }>('/auth/me'),
};

// Projects
export const projects = {
  list: () => request<any[]>('/projects'),
  get: (id: string) => request<any>(`/projects/${id}`),
  create: (data: { name: string; client_name?: string; copy_persona_ids?: string[] }) =>
    request<any>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: { name: string; client_name?: string }) =>
    request<any>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<{ success: boolean }>(`/projects/${id}`, { method: 'DELETE' }),
};

// Personas
export const personas = {
  list: (projectId?: string) =>
    request<any[]>(`/personas${projectId ? `?project_id=${projectId}` : ''}`),
  get: (id: string) => request<any>(`/personas/${id}`),
  create: (data: any) =>
    request<any>('/personas', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<any>(`/personas/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<{ success: boolean }>(`/personas/${id}`, { method: 'DELETE' }),
  generateVariants: (id: string, config: any) =>
    request<{ persona_id: string; variants_generated: number; variants: any[] }>(
      `/personas/${id}/variants`,
      { method: 'POST', body: JSON.stringify(config) }
    ),
  getVariants: (id: string) => request<any[]>(`/personas/${id}/variants`),
  regenerateVoice: (id: string) =>
    request<{ voice_sample: string }>(`/personas/${id}/voice`, { method: 'POST' }),
};

// Tests
export const tests = {
  list: (projectId?: string) =>
    request<any[]>(`/tests${projectId ? `?project_id=${projectId}` : ''}`),
  get: (id: string) => request<any>(`/tests/${id}`),
  create: (data: any) =>
    request<any>('/tests', { method: 'POST', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<{ success: boolean }>(`/tests/${id}`, { method: 'DELETE' }),
  run: (id: string) =>
    request<{ message: string; test_id: string; total_variants: number }>(
      `/tests/${id}/run`,
      { method: 'POST' }
    ),
  cancel: (id: string) =>
    request<{ success: boolean; message: string }>(
      `/tests/${id}/cancel`,
      { method: 'POST' }
    ),
  getResponses: (id: string, params?: { limit?: number; offset?: number; sentiment?: string; platform?: string; attitude?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());
    if (params?.sentiment) searchParams.set('sentiment', params.sentiment);
    if (params?.platform) searchParams.set('platform', params.platform);
    if (params?.attitude) searchParams.set('attitude', params.attitude);
    return request<{ responses: any[]; total: number; limit: number; offset: number }>(
      `/tests/${id}/responses?${searchParams.toString()}`
    );
  },
  getResults: (id: string) => request<any>(`/tests/${id}/results`),
  exportReport: async (id: string) => {
    const response = await fetch(`${API_BASE}/tests/${id}/export`, {
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
    });
    if (!response.ok) throw new ApiError(response.status, 'Export failed');
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition');
    const filename = disposition?.match(/filename="(.+)"/)?.[1] || `ralph-report-${id}.json`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};

// Uploads
export const uploads = {
  upload: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE}/uploads`, {
      method: 'POST',
      headers: { ...authHeaders() }, // do NOT set Content-Type; browser sets multipart boundary
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new ApiError(response.status, error.error || 'Upload failed');
    }

    return response.json();
  },
};

// GWI Spark
import type { GwiAudience, GwiValidation, GwiEnrichment } from '@/types/gwi';

export const gwi = {
  status: () =>
    request<{ enabled: boolean; features: string[]; integration_enabled?: boolean; reason?: string | null }>('/gwi/status', { method: 'POST' }),
  suggestAudiences: (data: { concept_text: string }) =>
    request<{ enabled: boolean; audiences: GwiAudience[] }>('/gwi/suggest-audiences', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  validatePersona: (data: { persona: any }) =>
    request<{ enabled: boolean; validation: GwiValidation | null }>('/gwi/validate-persona', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  enrichResults: (testId: string) =>
    request<{ enabled: boolean; enrichment: GwiEnrichment | null }>('/gwi/enrich-results', {
      method: 'POST',
      body: JSON.stringify({ test_id: testId }),
    }),
  saveApiKey: (apiKey: string) =>
    request<{ success: boolean }>('/gwi/settings', {
      method: 'POST',
      body: JSON.stringify({ api_key: apiKey }),
    }),
};

export const admin = {
  stats: () =>
    request<{
      total_anchors: number;
      by_source: Record<string, number>;
      embedded_personas: number;
      total_personas: number;
    }>('/anchors/stats'),
  personas: () =>
    request<Array<{
      id: string;
      name: string;
      age_base: number | null;
      location: string | null;
      has_values: boolean;
      has_platform: boolean;
      has_cultural: boolean;
      has_demographic: boolean;
      embeddings_updated_at: string | null;
    }>>('/anchors/personas'),
  recent: () =>
    request<Array<{
      id: string;
      source: string;
      confidence: number;
      sentiment_score: number;
      engagement_likelihood: number;
      share_likelihood: number;
      comprehension_score: number;
      reaction_tags: string[];
      primary_platform: string | null;
      attitude_score: number | null;
      persona_name: string | null;
      test_name: string | null;
      created_at: string;
    }>>('/anchors/recent'),
  seed: () =>
    request<{ anchors_seeded: number; personas_embedded: number }>('/anchors/seed', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  clear: () =>
    request<{ deleted: number }>('/anchors/all', { method: 'DELETE' }),
};

export { ApiError };
