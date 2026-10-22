import { useCallback, useEffect, useRef, useState } from 'react';

/** Read-only refreshes retain the last successful snapshot and ignore late replies. */
export function useOperationsRead<T>(loader: () => Promise<T>, refreshToken = 0) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const current = useRef(loader);
  current.current = loader;
  useEffect(() => {
    let active = true;
    setLoading(true);
    void current.current().then((value) => {
      if (active) { setData(value); setFailed(false); }
    }).catch(() => { if (active) setFailed(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loader, refreshToken, revision]);
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  return { data, loading, failed, retry };
}
