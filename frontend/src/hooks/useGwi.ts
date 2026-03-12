import { useEffect, useState } from 'react';
import { gwi } from '@/lib/api';

interface GwiStatus {
  enabled: boolean;
  features: string[];
  loading: boolean;
}

let cachedStatus: { enabled: boolean; features: string[] } | null = null;

export function useGwi(): GwiStatus {
  const [status, setStatus] = useState<GwiStatus>({
    enabled: cachedStatus?.enabled ?? false,
    features: cachedStatus?.features ?? [],
    loading: !cachedStatus,
  });

  useEffect(() => {
    if (cachedStatus) return;

    gwi.status()
      .then((data) => {
        cachedStatus = data;
        setStatus({ ...data, loading: false });
      })
      .catch(() => {
        cachedStatus = { enabled: false, features: [] };
        setStatus({ enabled: false, features: [], loading: false });
      });
  }, []);

  return status;
}

/** Reset cached status (call after saving new API key) */
export function resetGwiCache() {
  cachedStatus = null;
}
