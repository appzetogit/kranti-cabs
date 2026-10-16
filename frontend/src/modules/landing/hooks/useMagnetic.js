import { useEffect } from 'react';
import gsap from 'gsap';

/**
 * Buttons marked [data-magnetic] lean towards the cursor and spring back.
 * Pointer-driven, so it is bound only on devices with a real hover pointer —
 * on touch there is no cursor to lean towards and it would just add jitter.
 */

const STRENGTH = 0.28;
const MAX_PX = 12;

export default function useMagnetic(scope, deps = []) {
  useEffect(() => {
    const root = scope.current;
    if (!root) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const targets = Array.from(root.querySelectorAll('[data-magnetic]'));
    if (!targets.length) return;

    const cleanups = targets.map((el) => {
      const move = (e) => {
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        gsap.to(el, {
          x: gsap.utils.clamp(-MAX_PX, MAX_PX, dx * STRENGTH),
          y: gsap.utils.clamp(-MAX_PX, MAX_PX, dy * STRENGTH),
          duration: 0.35,
          ease: 'power3.out',
        });
      };
      const reset = () =>
        gsap.to(el, { x: 0, y: 0, duration: 0.6, ease: 'elastic.out(1, 0.4)' });

      el.addEventListener('pointermove', move);
      el.addEventListener('pointerleave', reset);
      return () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerleave', reset);
        gsap.killTweensOf(el);
        gsap.set(el, { clearProps: 'transform' });
      };
    });

    return () => cleanups.forEach((fn) => fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
