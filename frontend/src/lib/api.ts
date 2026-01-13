const API_BASE = import.meta.env.VITE_API_URL || '/api';

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = localStorage.getItem('token');

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }

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
  create: (data: { name: string; client_name?: string }) =>
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
};

export { ApiError };
