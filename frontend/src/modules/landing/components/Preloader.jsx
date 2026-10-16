import React, { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { markIntroDone, introAlreadyPlayed } from '../hooks/introGate';
import { useLanding } from '../landingContentContext';

/**
 * Full-screen intro curtain: logo, a 0-100 counter, then two panels slide apart
 * to reveal the page underneath.
 *
 * The page content is already in the DOM behind this — the curtain only covers
 * it. That matters: nothing here can prevent the site from rendering. It also
 * self-destructs on a hard timeout, so a stalled tween can never trap the user
 * behind it, and it is skipped entirely on repeat navigations within the session
 * and under reduced motion.
 */

const HARD_TIMEOUT_MS = 4000;

export default function Preloader() {
  const { brand } = useLanding();
  const rootRef = useRef(null);
  const [gone, setGone] = useState(
    () =>
      introAlreadyPlayed() ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  useEffect(() => {
    if (gone) {
      markIntroDone();
      return;
    }

    const root = rootRef.current;
    let killed = false;

    const finish = () => {
      if (killed) return;
      killed = true;
      setGone(true);
      markIntroDone();
    };

    // Escape hatch: whatever happens to the timeline, the curtain lifts.
    const hardStop = setTimeout(finish, HARD_TIMEOUT_MS);

    const ctx = gsap.context(() => {
      const counter = { v: 0 };
      const out = { ease: 'power3.inOut' };

      gsap
        .timeline({ onComplete: finish })
        .to('.pl-brand', { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' })
        .to(
          counter,
          {
            v: 100,
            duration: 1.1,
            ease: 'power1.inOut',
            onUpdate: () => {
              const el = root.querySelector('.pl-count');
              if (el) el.textContent = String(Math.round(counter.v)).padStart(3, '0');
            },
          },
          0.1
        )
        .to('.pl-bar-fill', { scaleX: 1, duration: 1.1, ease: 'power1.inOut' }, 0.1)
        .to('.pl-brand, .pl-meta', { opacity: 0, y: -14, duration: 0.35, ease: 'power2.in' })
        // panels part like a stage curtain
        .to('.pl-panel-top', { yPercent: -100, duration: 0.7, ...out }, '<0.05')
        .to('.pl-panel-bottom', { yPercent: 100, duration: 0.7, ...out }, '<');
    }, rootRef);

    return () => {
      clearTimeout(hardStop);
      ctx.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (gone) return null;

  return (
    <div className="preloader" ref={rootRef} role="presentation">
      <div className="pl-panel pl-panel-top" />
      <div className="pl-panel pl-panel-bottom" />

      <div className="pl-center">
        <div className="pl-brand">
          <img src={brand.logo} alt="" className="pl-logo" />
          <span className="pl-wordmark">
            <span className="pl-zi">{brand.wordmarkPrimary}</span>
            <span className="pl-cab">{brand.wordmarkSecondary}</span>
          </span>
        </div>
        <div className="pl-meta">
          <div className="pl-bar">
            <span className="pl-bar-fill" />
          </div>
          <span className="pl-count">000</span>
        </div>
      </div>
    </div>
  );
}
