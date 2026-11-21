import { useCallback, useEffect, useRef } from 'react';

/**
 * Re-runs `fn` every `intervalMs`, and immediately whenever the tab becomes visible
 * or the window regains focus. This is what keeps two devices in sync: the server is
 * the single source of truth and each device simply re-reads it.
 * Polling pauses while the tab is hidden. `enabled=false` pauses it too.
 */
export function usePolling(fn: () => void | Promise<void>, intervalMs: number, enabled = true) {
  const saved = useRef(fn);
  saved.current = fn;

  const tick = useCallback(() => {
    if (!document.hidden) void saved.current();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    window.addEventListener('online', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
      window.removeEventListener('online', tick);
    };
  }, [intervalMs, enabled, tick]);
}
