import { useEffect } from 'react';
import gsap from 'gsap';

/**
 * 3D tilt with a specular highlight that tracks the cursor, for [data-tilt]
 * cards. The card leans toward the pointer and a soft white gloss follows it,
 * which is what sells the surface as physical rather than as a flat rectangle.
 *
 * Hover-capable pointers only: on touch there is no cursor to track, and a
 * lingering tilt after a tap just looks broken.
 */

const MAX_DEG = 7;
const LIFT_PX = 10;

export default function useTilt(scope, deps = []) {
  useEffect(() => {
    const root = scope.current;
    if (!root) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const cards = Array.from(root.querySelectorAll('[data-tilt]'));
    if (!cards.length) return;

    const teardown = cards.map((card) => {
      // the gloss lives in its own layer so it never tints the card's content
      const gloss = document.createElement('span');
      gloss.className = 'tilt-gloss';
      gloss.setAttribute('aria-hidden', 'true');
      card.appendChild(gloss);

      const quickX = gsap.quickTo(card, 'rotationY', { duration: 0.5, ease: 'power3.out' });
      const quickY = gsap.quickTo(card, 'rotationX', { duration: 0.5, ease: 'power3.out' });

      const move = (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        quickX((px - 0.5) * 2 * MAX_DEG);
        quickY((0.5 - py) * 2 * MAX_DEG);
        gloss.style.setProperty('--gx', `${px * 100}%`);
        gloss.style.setProperty('--gy', `${py * 100}%`);
      };

      const enter = () => {
        gsap.to(card, {
          y: -LIFT_PX,
          scale: 1.015,
          duration: 0.45,
          ease: 'power3.out',
          overwrite: 'auto',
        });
        gsap.to(gloss, { opacity: 1, duration: 0.3 });
      };

      const leave = () => {
        quickX(0);
        quickY(0);
        gsap.to(card, { y: 0, scale: 1, duration: 0.6, ease: 'power3.out', overwrite: 'auto' });
        gsap.to(gloss, { opacity: 0, duration: 0.4 });
      };

      card.addEventListener('pointermove', move);
      card.addEventListener('pointerenter', enter);
      card.addEventListener('pointerleave', leave);

      return () => {
        card.removeEventListener('pointermove', move);
        card.removeEventListener('pointerenter', enter);
        card.removeEventListener('pointerleave', leave);
        gsap.killTweensOf(card);
        gsap.set(card, { clearProps: 'transform' });
        gloss.remove();
      };
    });

    return () => teardown.forEach((fn) => fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
