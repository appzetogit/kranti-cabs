import React from 'react';
import { OverlayViewF, OVERLAY_MOUSE_TARGET, PolygonF } from '@react-google-maps/api';

// Deeper red for a higher multiplier.
const surgeColour = (multiplier) => {
  if (multiplier >= 1.4) return '#B91C1C';
  if (multiplier >= 1.2) return '#DC2626';
  if (multiplier >= 1.1) return '#EF4444';
  return '#F87171';
};

/// The hexagons themselves; render inside a <GoogleMap>.
export const DriverSurgeLayer = ({ areas }) => (
  <>
    {areas.map((area) => (
      <React.Fragment key={area.hex}>
        <PolygonF
          paths={area.boundary}
          options={{
            fillColor: surgeColour(area.multiplier),
            fillOpacity: 0.3,
            strokeColor: surgeColour(area.multiplier),
            strokeOpacity: 0.7,
            strokeWeight: 1,
            clickable: false,
          }}
        />
        <OverlayViewF position={area.center} mapPaneName={OVERLAY_MOUSE_TARGET}>
          <div className="-translate-x-1/2 -translate-y-1/2 rounded bg-emerald-600 px-1.5 py-0.5 text-[11px] font-black text-white shadow">
            {Number(area.multiplier).toFixed(2)}x
          </div>
        </OverlayViewF>
      </React.Fragment>
    ))}
  </>
);

/// The card under the map: the best surge near the driver and when it ends.
export const DriverSurgeCard = ({ areas }) => {
  if (!areas.length) return null;
  const best = [...areas].sort((a, b) => b.multiplier - a.multiplier || (a.distance_km ?? 0) - (b.distance_km ?? 0))[0];
  const distance = Number(best.distance_km);

  return (
    <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-red-100 bg-white/95 px-4 py-3 shadow-[0_12px_30px_rgba(15,23,42,0.16)]">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-base font-black text-red-600">↑</div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-black text-slate-900">Surge Fare Area</p>
        <p className="text-[11px] font-semibold text-slate-500">
          Ends in {best.ends_in_minutes} min{best.ends_in_minutes === 1 ? '' : 's'}
          {Number.isFinite(distance) ? ` · ${distance < 0.5 ? 'you are here' : `${distance.toFixed(1)} km away`}` : ''}
        </p>
      </div>
      <span className="rounded-lg bg-emerald-600 px-2 py-1 text-[12px] font-black text-white">
        {Number(best.multiplier).toFixed(2)}x
      </span>
    </div>
  );
};
