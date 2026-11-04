import test from 'node:test';
import assert from 'node:assert/strict';
import { lockTouchViewport } from '../src/lib/touch-viewport';
const touch = (type: string, fingers: number) => {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, 'touches', { value: { length: fingers } });
  return event;
};
test('le verrouillage empêche le pincement sans annuler les clics, le défilement et la saisie', () => {
  const page = new EventTarget();
  const cleanup = lockTouchViewport(page, () => true);
  for (const type of ['touchstart', 'touchmove']) {
    const scroll = touch(type, 1);
    page.dispatchEvent(scroll);
    assert.equal(scroll.defaultPrevented, false);
    const pinch = touch(type, 2);
    page.dispatchEvent(pinch);
    assert.equal(pinch.defaultPrevented, true);
  }
  for (const type of ['click', 'focus', 'input']) {
    const event = new Event(type, { cancelable: true });
    page.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
  }
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    const event = new Event(type, { cancelable: true });
    page.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
  }
  cleanup();
  const after = touch('touchmove', 2);
  page.dispatchEvent(after);
  assert.equal(after.defaultPrevented, false);
  const gesture = new Event('gesturestart', { cancelable: true });
  page.dispatchEvent(gesture);
  assert.equal(gesture.defaultPrevented, false);
});
test('le verrouillage suit le mode tactile et laisse les gestes de bureau disponibles', () => {
  const page = new EventTarget();
  let enabled = false;
  const cleanup = lockTouchViewport(page, () => enabled);
  const desktop = new Event('gesturestart', { cancelable: true });
  page.dispatchEvent(desktop);
  assert.equal(desktop.defaultPrevented, false);
  enabled = true;
  const tablet = new Event('gesturestart', { cancelable: true });
  page.dispatchEvent(tablet);
  assert.equal(tablet.defaultPrevented, true);
  const nonCancelable = new Event('gesturechange');
  assert.doesNotThrow(() => page.dispatchEvent(nonCancelable));
  cleanup();
});
