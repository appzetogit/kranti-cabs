import { useEffect } from 'react';

/**
 * Auto-advances a scroll-snap rail, one card at a time, looping back to the
 * start. Pauses while the user is touching or hovering it, and while the rail is
 * off screen, so it never fights the user or burns battery in the background.
 *
 * Only runs when the rail actually scrolls, which is the mobile case — on desktop
 * the same markup is a static grid with nothing to advance.
 */

const STEP_MS = 3200;

export default function useAutoScroll(ref, { interval = STEP_MS } = {}) {
  useEffect(() => {
    const rail = ref.current;
    if (!rail) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let paused = false;
    let inView = false;
    let timer = null;

    const canScroll = () => rail.scrollWidth > rail.clientWidth + 2;

    const step = () => {
      if (paused || !inView || !canScroll()) return;
      const card = rail.children[0];
      if (!card) return;
      const gap = parseFloat(getComputedStyle(rail).columnGap) || 0;
      const stride = card.getBoundingClientRect().width + gap;
      const atEnd = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 4;
      rail.scrollTo({
        left: atEnd ? 0 : rail.scrollLeft + stride,
        behavior: 'smooth',
      });
    };

    const start = () => {
      if (timer) return;
      timer = setInterval(step, interval);
    };
    const stop = () => {
      clearInterval(timer);
      timer = null;
    };

    const pause = () => { paused = true; };
    const resume = () => { paused = false; };

    // A real interaction should hand control back to the user for a while, not
    // yank the rail out from under their thumb on the next tick.
    let resumeTimer = null;
    const holdThenResume = () => {
      paused = true;
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(resume, interval * 2);
    };

    rail.addEventListener('pointerenter', pause);
    rail.addEventListener('pointerleave', resume);
    rail.addEventListener('touchstart', holdThenResume, { passive: true });
    rail.addEventListener('wheel', holdThenResume, { passive: true });

    const io = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting;
        if (inView) start();
        else stop();
      },
      { threshold: 0.25 }
    );
    io.observe(rail);

    const onVisibility = () => (document.hidden ? stop() : inView && start());
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      clearTimeout(resumeTimer);
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      rail.removeEventListener('pointerenter', pause);
      rail.removeEventListener('pointerleave', resume);
      rail.removeEventListener('touchstart', holdThenResume);
      rail.removeEventListener('wheel', holdThenResume);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interval]);
}
