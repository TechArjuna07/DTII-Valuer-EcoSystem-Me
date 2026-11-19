import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

/**
 * List state (page, search, filters) kept in the URL, so lists are shareable and survive refresh/back.
 * Changing any filter resets to page 1.
 * @param {string[]} filterKeys extra query keys, e.g. ['status', 'role']
 */
export function useListParams(filterKeys = []) {
  const [sp, setSp] = useSearchParams();
  const keysId = filterKeys.join(',');
  const params = useMemo(() => {
    const p = { page: Number(sp.get('page')) || 1, search: sp.get('search') || '' };
    for (const k of keysId ? keysId.split(',') : []) p[k] = sp.get(k) || '';
    return p;
  }, [sp, keysId]);

  const set = useCallback(
    (key, value) =>
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === '' || value === null || value === undefined) next.delete(key);
          else next.set(key, String(value));
          if (key !== 'page') next.delete('page');
          return next;
        },
        { replace: true },
      ),
    [setSp],
  );
  return [params, set];
}
