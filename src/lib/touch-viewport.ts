/** Stop page scaling without canceling a normal one-finger scroll or tap. */
export function lockTouchViewport(target: EventTarget, enabled: () => boolean) {
  const stopGesture = (event: Event) => {
    if (enabled() && event.cancelable) event.preventDefault();
  };
  const stopPinch = (event: Event) => {
    if ((event as TouchEvent).touches.length > 1) stopGesture(event);
  };
  const options = { passive: false, capture: true };
  const gestures = ['gesturestart', 'gesturechange', 'gestureend'];
  const touches = ['touchstart', 'touchmove'];
  for (const name of gestures) target.addEventListener(name, stopGesture, options);
  for (const name of touches) target.addEventListener(name, stopPinch, options);
  return () => {
    for (const name of gestures) target.removeEventListener(name, stopGesture, options);
    for (const name of touches) target.removeEventListener(name, stopPinch, options);
  };
}
