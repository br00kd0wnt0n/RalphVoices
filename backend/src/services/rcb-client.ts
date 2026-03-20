/**
 * RCB Client — Connects Ralph Voices to Ralph Context Base.
 */
export class RCBClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  private async _fetch(path: string, options: RequestInit = {}) {
    const res = await fetch(`${this.baseUrl}/api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'x-rcb-api-key': this.apiKey,
        ...(options.headers as Record<string, string>),
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `RCB request failed: ${res.status}`);
    }
    return res.json();
  }

  async ingest(params: {
    source_tool: string;
    run_type: string;
    brand?: string;
    client?: string;
    data: any;
    summary?: string;
  }) {
    return this._fetch('/ingest', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async query(params: {
    query: string;
    filters?: Record<string, any>;
    limit?: number;
    synthesize?: boolean;
  }) {
    return this._fetch('/query', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async checkFreshness(brand: string, sourceTool: string, maxAgeHours = 6) {
    const result = await this.query({
      query: brand,
      filters: { source_tool: sourceTool, brand },
      limit: 1,
    });
    if (!result.chunks || result.chunks.length === 0) return { fresh: false, age: null };
    const age = (Date.now() - new Date(result.chunks[0].snapshot_date).getTime()) / 3600000;
    return { fresh: age < maxAgeHours, age: Math.round(age * 10) / 10, chunk: result.chunks[0] };
  }
}
