/** Device detection and mobile helpers. */
export const isTouch = navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches;

/** Fullscreen + landscape lock where the browser allows it (Android); iOS Safari ignores both. */
export function enterFullscreen() {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    if (!document.fullscreenElement) {
      const p = el.requestFullscreen?.({ navigationUI: 'hide' }) ?? el.webkitRequestFullscreen?.();
      Promise.resolve(p).then(() => (screen.orientation as any)?.lock?.('landscape')).catch(() => {});
    }
  } catch { /* unsupported */ }
}
