import { useEffect, useState } from 'react';

const money = (value) => `Rs ${Number(value || 0).toFixed(2).replace(/\.00$/, '')}`;

/// Minutes inside the pickup hub so far, counted the way the server bills it
/// (a part-minute is a minute). Null when the stay has not started.
const parkingMinutesSoFar = (pickup, now) => {
  if (!pickup?.entered_at) return null;
  const end = pickup.exited_at ? new Date(pickup.exited_at).getTime() : now;
  return Math.max(0, Math.ceil((end - new Date(pickup.entered_at).getTime()) / 60000));
};

/// The slab fee a stay of this many minutes would pay - same rule as the server.
const slabFeeFor = (slabs = [], minutes = 0) => {
  if (!slabs.length) return 0;
  const sorted = [...slabs].sort((a, b) => a.up_to_minutes - b.up_to_minutes);
  return Number((sorted.find((slab) => minutes <= slab.up_to_minutes) || sorted[sorted.length - 1]).fee || 0);
};

/**
 * The location charges inside a ride's fare - airport fee, railway station
 * entry fee and hub parking - from the ride's `locationCharges` lines. Before
 * the trip completes, parking is not a line yet: it is shown as a running
 * estimate from how long the driver has been inside the pickup hub.
 *
 * Renders nothing for a ride with no location charges.
 */
const LocationCharges = ({ lines = [], hubParking = null, title = 'Location charges', className = '' }) => {
  const pickup = hubParking?.pickup;
  const parkingPending = Boolean(hubParking && !hubParking.applied_at && (pickup || hubParking.drop));
  const timing = parkingPending && pickup?.entered_at && !pickup?.exited_at;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!timing) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [timing]);

  const safeLines = Array.isArray(lines) ? lines.filter((line) => Number(line?.amount) > 0) : [];
  if (!safeLines.length && !parkingPending) return null;

  const minutes = parkingMinutesSoFar(pickup, now);
  const pickupEstimate = pickup ? slabFeeFor(pickup.slabs, minutes || 0) : 0;
  const dropFee = Number(hubParking?.drop?.drop_fee || 0);

  return (
    <div className={`rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3 ${className}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{title}</p>
      {safeLines.map((line) => (
        <div key={`${line.code}-${line.label}`} className="mt-2 flex items-center justify-between gap-3 text-[12px] font-bold text-slate-700">
          <span className="min-w-0 truncate">{line.label}</span>
          <span className="shrink-0 text-slate-900">{money(line.amount)}</span>
        </div>
      ))}
      {parkingPending && pickup && (
        <div className="mt-2 flex items-center justify-between gap-3 text-[12px] font-bold text-slate-700">
          <span className="min-w-0 truncate">
            Parking - {pickup.name || 'pickup'}
            {minutes !== null ? ` (${minutes} min so far)` : ''}
          </span>
          <span className="shrink-0 text-slate-900">~{money(pickupEstimate)}</span>
        </div>
      )}
      {parkingPending && dropFee > 0 && (
        <div className="mt-2 flex items-center justify-between gap-3 text-[12px] font-bold text-slate-700">
          <span className="min-w-0 truncate">Drop-off fee - {hubParking.drop.name || 'drop'}</span>
          <span className="shrink-0 text-slate-900">{money(dropFee)}</span>
        </div>
      )}
      {parkingPending && (
        <p className="mt-2 text-[11px] font-semibold leading-4 text-slate-500">
          Parking is added to the fare when the trip ends, from the time spent inside the station or airport.
        </p>
      )}
    </div>
  );
};

export default LocationCharges;
