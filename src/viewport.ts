// Full-screen sizing for the installed iOS app. With viewport-fit=cover and a
// translucent status bar, iOS reports 100%/100vh/100lvh short by the status
// bar height, leaving a band at the bottom. screen.width/height are the real
// screen in CSS px (always given in portrait on iOS), so size from those.

/** True when running as an installed home-screen app. */
export function isStandalone(): boolean {
  const iosStandalone = (navigator as { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches;
}

function fit(): void {
  if (!isStandalone()) {
    document.body.style.height = '';
    return;
  }
  const short = Math.min(screen.width, screen.height);
  const long = Math.max(screen.width, screen.height);
  const portrait = window.innerHeight >= window.innerWidth;
  // Never shrink below what the browser already gives us.
  const height = Math.max(portrait ? long : short, window.innerHeight);
  document.body.style.height = `${height}px`;
}

export function fitViewport(): void {
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);
}

/** Numbers for the ?debug readout when the layout looks wrong on a device. */
export function viewportReport(): string {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom) 0';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const insets = `${parseFloat(cs.paddingTop)}/${parseFloat(cs.paddingBottom)}`;
  probe.remove();
  const vv = window.visualViewport;
  return [
    `screen ${screen.width}x${screen.height}`,
    `inner ${window.innerWidth}x${window.innerHeight}`,
    `vv ${vv ? Math.round(vv.height) : '-'}`,
    `body ${document.body.clientHeight}`,
    `safe ${insets}`,
    isStandalone() ? 'standalone' : 'tab',
  ].join(' · ');
}
