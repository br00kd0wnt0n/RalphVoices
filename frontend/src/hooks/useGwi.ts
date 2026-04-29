import { useEffect, useState } from 'react';
import { gwi } from '@/lib/api';

interface GwiStatus {
  enabled: boolean;
  features: string[];
  loading: boolean;
  // Distinguishes "integration is dormant (no commercial deal)" from
  // "integration is on but the user hasn't supplied a key." Frontend code that
  // wants to show different copy for each case can branch on this.
  integrationEnabled: boolean;
  reason: string | null;
}

type CachedGwiStatus = Omit<GwiStatus, 'loading'>;

let cachedStatus: CachedGwiStatus | null = null;

function normalize(data: any): CachedGwiStatus {
  return {
    enabled: !!data?.enabled,
    features: Array.isArray(data?.features) ? data.features : [],
    integrationEnabled: data?.integration_enabled ?? !!data?.enabled,
    reason: data?.reason ?? null,
  };
}

export function useGwi(): GwiStatus {
  const [status, setStatus] = useState<GwiStatus>({
    ...(cachedStatus ?? { enabled: false, features: [], integrationEnabled: false, reason: null }),
    loading: !cachedStatus,
  });

  useEffect(() => {
    if (cachedStatus) return;

    gwi.status()
      .then((data) => {
        cachedStatus = normalize(data);
        setStatus({ ...cachedStatus, loading: false });
      })
      .catch(() => {
        cachedStatus = { enabled: false, features: [], integrationEnabled: false, reason: null };
        setStatus({ ...cachedStatus, loading: false });
      });
  }, []);

  return status;
}

/** Reset cached status (call after saving new API key) */
export function resetGwiCache() {
  cachedStatus = null;
}
