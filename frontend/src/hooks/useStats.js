import { useState, useEffect, useCallback } from 'react';
import { getStats } from '../utils/api';

export function useStats(intervalMs = 3000, enabled = true) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const fetch = useCallback(async () => {
    // Don't poll if not enabled (e.g. user not logged in)
    if (!enabled) return;
    try {
      const res = await getStats();
      setData(res.data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    fetch();
    const id = setInterval(fetch, intervalMs);
    return () => clearInterval(id);
  }, [fetch, intervalMs, enabled]);

  return { data, loading, error, refetch: fetch };
}
