import { useEffect } from 'react';
import gsap from 'gsap';

/**
 * Runs a GSAP build function once on mount, scoped to `scope`. This is the only
 * place GSAP is used — scroll reveals are plain IntersectionObserver + CSS in
 * useReveal, so ScrollTrigger isn't in the bundle.
 *
 * `gsap.from` hides its targets before animating them in, so the content would
 * be stranded if the ticker never ran. Two guards: skip entirely when the tab is
 * hidden (throttled requestAnimationFrame freezes GSAP's ticker) or reduced
 * motion is set, and revert the context if rAF hasn't fired within a second.
 */

const TICKER_PROBE_MS = 1000;

const canAnimate = () =>
  document.visibilityState === 'visible' &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function useEntrance(scope, build, deps = []) {
  useEffect(() => {
    if (!scope.current || !canAnimate()) return;

    const ctx = gsap.context(build, scope);

    let tickerAlive = false;
    requestAnimationFrame(() => { tickerAlive = true; });
    const safety = setTimeout(() => {
      if (!tickerAlive) ctx.revert();
    }, TICKER_PROBE_MS);

    return () => {
      clearTimeout(safety);
      ctx.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
