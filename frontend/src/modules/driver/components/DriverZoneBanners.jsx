import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { BACKEND_ORIGIN } from '../../../shared/api/runtimeConfig';

const ROTATE_MS = 4000;
const DISMISS_KEY = 'kranti:driver-banners-dismissed';

const resolveImage = (image) => {
  const value = String(image || '');
  if (!value || /^(https?:|data:)/i.test(value)) return value;
  return `${BACKEND_ORIGIN}/${value.replace(/^\/+/, '')}`;
};

const readDismissed = () => {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
};

/// Promo banners for the driver's zone, as a slim rotating strip above the
/// day summary. The driver can hide it for the rest of the session so it never
/// competes with the map while they are working.
const DriverZoneBanners = ({ banners }) => {
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState(readDismissed);
  const count = banners.length;

  useEffect(() => {
    if (count <= 1) return undefined;
    const timer = setInterval(() => setIndex((current) => (current + 1) % count), ROTATE_MS);
    return () => clearInterval(timer);
  }, [count]);

  if (!count || dismissed) return null;

  // Modulo, so a shorter list after a zone change never points past the end.
  const current = index % count;
  const banner = banners[current];
  const target = String(banner.redirect_url || '');
  const open = () => {
    if (/^https?:\/\//i.test(target)) {
      window.open(target, '_blank', 'noopener,noreferrer');
    } else if (target.startsWith('/')) {
      navigate(target);
    }
  };
  const dismiss = (event) => {
    event.stopPropagation();
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // storage unavailable: hidden until the page reloads
    }
  };

  return (
    <div className="pointer-events-auto relative mb-3 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_12px_30px_rgba(15,23,42,0.16)]">
      <button
        type="button"
        onClick={open}
        className={`block w-full text-left ${target ? 'cursor-pointer' : 'cursor-default'}`}
        aria-label={banner.title || 'Promotion'}
      >
        <img
          src={resolveImage(banner.image)}
          alt={banner.title || 'Promotion'}
          className="block h-[84px] w-full object-cover"
        />
      </button>
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900/60 text-white backdrop-blur active:scale-90"
        aria-label="Hide promotions"
      >
        <X size={13} strokeWidth={3} />
      </button>
      {count > 1 ? (
        <div className="absolute bottom-1.5 left-0 right-0 flex justify-center gap-1">
          {banners.map((item, dot) => (
            <span
              key={item._id || dot}
              className={`h-1.5 rounded-full transition-all ${dot === current ? 'w-4 bg-white' : 'w-1.5 bg-white/60'}`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default DriverZoneBanners;
