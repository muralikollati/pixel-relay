/**
 * useWakeLock — prevents the screen from sleeping during an active run.
 *
 * Uses the Screen Wake Lock API (supported on Chrome Android, Safari 16.4+).
 * Silently no-ops on unsupported browsers — never throws.
 *
 * Usage:
 *   const { supported, active } = useWakeLock(isRunning);
 *
 * When isRunning flips true  → acquires wake lock (screen stays on)
 * When isRunning flips false → releases wake lock (normal screen timeout resumes)
 *
 * Also handles the visibility change edge case: if the user switches away and
 * comes back, the wake lock is automatically re-acquired (OS releases it on hide).
 */
import { useState, useEffect, useRef } from 'react';

export function useWakeLock(isRunning) {
  const [supported] = useState(() => 'wakeLock' in navigator);
  const [active, setActive]   = useState(false);
  const lockRef               = useRef(null);

  const acquire = async () => {
    if (!supported || lockRef.current) return;
    try {
      lockRef.current = await navigator.wakeLock.request('screen');
      lockRef.current.addEventListener('release', () => {
        lockRef.current = null;
        setActive(false);
      });
      setActive(true);
    } catch {
      // Permission denied or not supported — silent fail
      lockRef.current = null;
      setActive(false);
    }
  };

  const release = async () => {
    if (!lockRef.current) return;
    try { await lockRef.current.release(); } catch { /* ignore */ }
    lockRef.current = null;
    setActive(false);
  };

  // Acquire/release based on isRunning
  useEffect(() => {
    if (isRunning) {
      acquire();
    } else {
      release();
    }
    return () => { release(); };
  }, [isRunning]);

  // Re-acquire if page becomes visible again (OS releases lock on hide)
  useEffect(() => {
    if (!supported) return;
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && isRunning && !lockRef.current) {
        acquire();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [isRunning, supported]);

  return { supported, active };
}