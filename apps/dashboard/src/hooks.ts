import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/** Fetches a resource and exposes reload(); re-fetches when the path changes. */
export function useResource<T>(path: string | null, opts: { pollMs?: number | ((data: T | null) => number | null) } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const pathRef = useRef(path);
  pathRef.current = path;

  const reload = useCallback(async () => {
    if (!pathRef.current) return;
    const p = pathRef.current;
    try {
      const d = await api<T>(p);
      if (pathRef.current === p) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (pathRef.current === p) setError((e as Error).message);
    } finally {
      if (pathRef.current === p) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setData(null);
    setLoading(!!path);
    reload();
  }, [path, reload]);

  const poll = typeof opts.pollMs === 'function' ? opts.pollMs(data) : opts.pollMs;
  useEffect(() => {
    if (!poll) return;
    const t = setInterval(reload, poll);
    return () => clearInterval(t);
  }, [poll, reload]);

  return { data, setData, error, loading, reload };
}
