'use client';
import { useCallback, useEffect, useState } from 'react';
import { lockTouchViewport } from './touch-viewport';
export type Appearance = 'system' | 'light' | 'dark';
export function haptic(type: 'selection' | 'success' | 'error' = 'selection') {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function')
    navigator.vibrate(type === 'success' ? [10, 35, 10] : type === 'error' ? [20, 40, 20] : 5);
}
export function useAppearance() {
  const [appearance, setAppearance] = useState<Appearance>(() => {
    if (typeof document === 'undefined') return 'system';
    const value = document.documentElement.dataset.theme;
    return value === 'light' || value === 'dark' ? value : 'system';
  });
  useEffect(() => {
    try {
      const saved = localStorage.getItem('bh-appearance');
      if (saved === 'light' || saved === 'dark') setAppearance(saved);
    } catch {}
  }, []);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = appearance === 'dark' || (appearance === 'system' && media.matches);
      document.documentElement.dataset.theme = appearance;
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
      document
        .querySelectorAll('meta[name="theme-color"]')
        .forEach((el) => el.setAttribute('content', dark ? '#000000' : '#f2f2f7'));
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [appearance]);
  const choose = useCallback((value: Appearance) => {
    setAppearance(value);
    try {
      localStorage.setItem('bh-appearance', value);
    } catch {}
  }, []);
  return { appearance, setAppearance: choose };
}
export function useNativeViewport() {
  useEffect(() => {
    const touch = matchMedia('(any-pointer: coarse)');
    return lockTouchViewport(document, () => touch.matches);
  }, []);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      document.documentElement.classList.toggle('has-scrolled', window.scrollY > 125);
    };
    const scroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', scroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', scroll);
      cancelAnimationFrame(frame);
      document.documentElement.classList.remove('has-scrolled');
    };
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () =>
      document.documentElement.classList.toggle(
        'keyboard-open',
        !!viewport && window.innerHeight - viewport.height > 150,
      );
    viewport?.addEventListener('resize', resize);
    return () => {
      viewport?.removeEventListener('resize', resize);
      document.documentElement.classList.remove('keyboard-open');
    };
  }, []);
}
