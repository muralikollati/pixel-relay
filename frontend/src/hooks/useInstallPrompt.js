/**
 * useInstallPrompt — captures the browser's "Add to Home Screen" install prompt.
 *
 * The browser fires `beforeinstallprompt` when the PWA install criteria are met.
 * We intercept it (prevent the automatic mini-infobar) and store it so we can
 * trigger it manually from our own UI at the right moment.
 *
 * Usage:
 *   const { canInstall, install, installed } = useInstallPrompt();
 *
 * canInstall  — true when the deferred prompt is ready to show
 * install()   — shows the native install dialog, returns 'accepted'|'dismissed'
 * installed   — true after the user accepts (or if already installed as standalone)
 */
import { useState, useEffect } from 'react';

export function useInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState(null);
  const [installed,   setInstalled]   = useState(
    // Already running as installed PWA (standalone mode)
    () => window.matchMedia('(display-mode: standalone)').matches ||
          window.navigator.standalone === true
  );

  useEffect(() => {
    const handler = (e) => {
      // Prevent the default mini-infobar from appearing
      e.preventDefault();
      setPromptEvent(e);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // Listen for successful install
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!promptEvent) return null;
    promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    if (outcome === 'accepted') {
      setInstalled(true);
      setPromptEvent(null);
    }
    return outcome; // 'accepted' | 'dismissed'
  };

  return {
    canInstall: !!promptEvent && !installed,
    install,
    installed,
  };
}