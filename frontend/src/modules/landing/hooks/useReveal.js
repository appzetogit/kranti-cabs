import { useEffect } from 'react';

/**
 * Scroll reveals with IntersectionObserver + CSS transitions — no animation
 * library. Inside the hook's scope:
 *   data-reveal          -> the element fades up when it scrolls in
 *   data-reveal-stagger  -> its direct children fade up one after another
 *   data-reveal-mask     -> its child rises out of a clipping mask (headings)
 *   data-count="100000"  -> counts up to that number on first view
 *
 * The hidden state lives behind the `data-reveal-root` attribute this hook puts
 * on its own scope element, so if the script never runs the content is simply
 * visible. Nothing here needs requestAnimationFrame either, so a throttled
 * background tab can't strand it.
 *
 * The marker is per-scope on purpose: a single shared class on <html> lets one
 * page's cleanup strip the class another page's hook just set during a tab swap.
 */

const ROOT_ATTR = 'data-reveal-root';
const STAGGER_MS = 60;
const COUNT_MS = 1400;

const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const format = (n) => Math.round(n).toLocaleString('en-IN');

function countUp(el) {
  const target = Number(el.dataset.count);
  if (!Number.isFinite(target)) return;

  // A hidden tab throttles rAF, so just show the final number.
  if (document.visibilityState !== 'visible') {
    el.textContent = format(target);
    return;
  }

  let start;
  const step = (ts) => {
    if (start === undefined) start = ts;
    const p = Math.min((ts - start) / COUNT_MS, 1);
    el.textContent = format(target * (1 - (1 - p) ** 3)); // ease-out cubic
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export default function useReveal(scope, deps = []) {
  useEffect(() => {
    const root = scope.current;
    if (!root || reducedMotion() || !('IntersectionObserver' in window)) return;

    root.setAttribute(ROOT_ATTR, '');

    const groups = Array.from(root.querySelectorAll('[data-reveal-stagger]'));
    groups.forEach((row) => {
      Array.from(row.children).forEach((child, i) => {
        child.style.transitionDelay = `${i * STAGGER_MS}ms`;
      });
    });

    // IntersectionObserver always delivers an initial callback per observed
    // target, so this is a liveness probe for the backstop below.
    let observerFired = false;

    const revealIO = new IntersectionObserver(
      (entries) => {
        observerFired = true;
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          if (el.hasAttribute('data-reveal-stagger')) {
            Array.from(el.children).forEach((c) => c.classList.add('is-visible'));
          } else {
            el.classList.add('is-visible');
          }
          revealIO.unobserve(el);
        });
      },
      // start a little before the element is fully in view
      { rootMargin: '0px 0px -8% 0px' }
    );

    Array.from(root.querySelectorAll('[data-reveal], [data-reveal-mask]'))
      .concat(groups)
      .forEach((el) => revealIO.observe(el));

    const countIO = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        countUp(entry.target);
        countIO.unobserve(entry.target);
      });
    });

    root.querySelectorAll('[data-count]').forEach((el) => countIO.observe(el));

    // Backstop for the observer never delivering at all: unhide everything.
    // Keyed on the callback firing, not on anything having become visible — on a
    // page whose first reveal sits below the fold, nothing visible yet is the
    // normal case and must not disable the animation.
    const safety = setTimeout(() => {
      if (observerFired) return;
      root.removeAttribute(ROOT_ATTR);
      // Dropping the attribute alone leaves the un-hide to a CSS transition. If
      // the animation clock is frozen (a throttled tab) that transition never
      // advances and the content stays at opacity 0 — the very thing this
      // backstop exists to prevent. Write the end state directly instead.
      root
        .querySelectorAll('[data-reveal], [data-reveal-stagger] > *, [data-reveal-mask] > *')
        .forEach((el) => {
          el.style.transition = 'none';
          el.style.opacity = '1';
          el.style.transform = 'none';
        });
    }, 1200);

    return () => {
      clearTimeout(safety);
      revealIO.disconnect();
      countIO.disconnect();
      root.removeAttribute(ROOT_ATTR);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
