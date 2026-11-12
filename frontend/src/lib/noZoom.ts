/**
 * Stop pinch-zoom on iPhone and iPad.
 *
 * The viewport tag (`user-scalable=no`) is enough on Android, but iOS has
 * ignored it since iOS 10. What iOS does honour is a cancelled `gesturestart`
 * — a WebKit-only event fired when a second finger lands — so cancelling it
 * keeps the page at its own scale, the way a native app behaves. Scrolling,
 * taps and swipes are single-finger and unaffected. Elsewhere the event never
 * fires, so this does nothing.
 */
export function installNoZoom(target: Document = document): void {
  const cancel = (event: Event) => event.preventDefault();
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    target.addEventListener(type, cancel, { passive: false });
  }
}
