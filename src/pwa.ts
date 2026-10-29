// Service worker registration. When a new build has installed, the page
// saves and reloads straight away, so a push shows on the first launch
// instead of the second.
import { registerSW } from 'virtual:pwa-register';

export function registerUpdates(saveNow: () => void): void {
  registerSW({
    immediate: true,
    onNeedReload() {
      saveNow();
      window.location.reload();
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // A home-screen app resumed from the background doesn't navigate, so
      // nothing checks for a new build unless we ask.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update().catch(() => {});
      });
    },
  });
}
