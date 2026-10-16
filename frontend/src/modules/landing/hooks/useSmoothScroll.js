import { useEffect } from 'react';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/**
 * The live instance, so programmatic scrolls can go through Lenis instead of
 * around it. A raw window.scrollTo leaves Lenis' virtual position stale and the
 * next wheel event snaps the page back — visible as a jump after tab changes.
 */
let lenisInstance = null;

export function scrollToTop() {
  if (lenisInstance) {
    lenisInstance.scrollTo(0, { immediate: false });
    return;
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Inertial scrolling, wired into GSAP's ticker so ScrollTrigger stays in sync
 * with Lenis' virtual position instead of fighting it.
 *
 * Touch is left on the native scroller on purpose: hijacking touch scrolling is
 * what makes "smooth scroll" sites feel broken on a phone, and mobile already
 * has its own momentum.
 */
export default function useSmoothScroll() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // pointer:coarse covers phones and tablets
    if (window.matchMedia('(pointer: coarse)').matches) return;

    const lenis = new Lenis({
      duration: 1.05,
      easing: (t) => 1 - (1 - t) ** 3,
      smoothWheel: true,
      syncTouch: false,
    });

    lenisInstance = lenis;
    lenis.on('scroll', ScrollTrigger.update);

    const tick = (time) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(tick);
      gsap.ticker.lagSmoothing(500, 33);
      lenis.destroy();
      lenisInstance = null;
    };
  }, []);
}
