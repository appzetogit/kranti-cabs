import { useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/**
 * Scrub-linked scroll effects, scoped to one page. Markers, all optional:
 *
 *   data-parallax="-80"   element drifts this many px across its scroll range
 *   data-img-parallax     the <img> inside overshoots its frame and drifts, so
 *                         the photo moves against the card as it passes
 *   data-marquee-velocity the marquee's playback rate follows scroll speed and
 *                         flips direction with it
 *
 * These only ever animate transform on decorative layers — nothing here owns an
 * element's visibility, so a dead ticker degrades to a static page rather than a
 * blank one. That is why reveals stay on IntersectionObserver in useReveal.
 */

const canAnimate = () =>
  document.visibilityState === 'visible' &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function useScrollFx(scope, deps = []) {
  useEffect(() => {
    if (!scope.current || !canAnimate()) return;

    const ctx = gsap.context((self) => {
      self.selector('[data-parallax]').forEach((el) => {
        const distance = Number(el.dataset.parallax) || -60;
        gsap.fromTo(
          el,
          { y: -distance / 2 },
          {
            y: distance / 2,
            ease: 'none',
            scrollTrigger: {
              trigger: el,
              start: 'top bottom',
              end: 'bottom top',
              scrub: true,
            },
          }
        );
      });

      self.selector('[data-img-parallax]').forEach((frame) => {
        const img = frame.querySelector('img');
        if (!img) return;
        // scale up first so the drift never exposes an edge
        gsap.set(img, { scale: 1.16, transformOrigin: 'center center' });
        gsap.fromTo(
          img,
          { yPercent: -6 },
          {
            yPercent: 6,
            ease: 'none',
            scrollTrigger: {
              trigger: frame,
              start: 'top bottom',
              end: 'bottom top',
              scrub: true,
            },
          }
        );
      });

      // Hero content drifts up, fades and shrinks slightly as it scrolls away,
      // so the fold hands over instead of just sliding off.
      self.selector('[data-hero-exit]').forEach((el) => {
        gsap.to(el, {
          y: -70,
          scale: 0.955,
          opacity: 0,
          ease: 'none',
          scrollTrigger: {
            trigger: el,
            start: 'top top',
            end: '+=520',
            scrub: 0.6,
          },
        });
      });

      self.selector('[data-marquee-velocity]').forEach((marquee) => {
        const tracks = marquee.querySelectorAll('.partners-track');
        if (!tracks.length) return;
        // hand the loop over to GSAP so scroll can steer its timeScale
        marquee.classList.add('is-js-driven');

        const loop = gsap.timeline({ repeat: -1 }).to(tracks, {
          xPercent: -100,
          duration: 26,
          ease: 'none',
        });

        ScrollTrigger.create({
          trigger: marquee,
          start: 'top bottom',
          end: 'bottom top',
          onUpdate: (st) => {
            const v = gsap.utils.clamp(-6, 6, st.getVelocity() / 260);
            // idle at 1x, speed up with the scroll, reverse when scrolling up
            gsap.to(loop, {
              timeScale: v === 0 ? 1 : Math.sign(v) * Math.max(1, Math.abs(v)),
              duration: 0.4,
              overwrite: true,
            });
          },
        });
      });
    }, scope);

    const refresh = setTimeout(() => ScrollTrigger.refresh(), 350);

    return () => {
      clearTimeout(refresh);
      ctx.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
