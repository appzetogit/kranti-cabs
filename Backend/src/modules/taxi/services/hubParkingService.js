/**
 * Parking at transport hubs - airports and railway stations.
 *
 * Each hub can carry parking rules per vehicle class (bike / auto / car, or
 * "all" as the catch-all):
 *
 *   - slabs      what a PICKUP at the hub costs by how long the driver was
 *                inside the hub: [{ up_to_minutes: 10, fee: 30 }, ...]. The
 *                first slab the stay fits under applies; a stay longer than
 *                every slab pays the last one.
 *   - drop_fee   a flat entry fee for DROPPING at the hub.
 *
 * The rules and the hub's geofence are copied onto the ride at booking, so an
 * admin edit mid-trip never changes what a ride is billed. While the trip runs
 * the driver's live location stamps when they entered the pickup hub and when
 * they left it with the rider; at completion that stay picks the slab, and the
 * fee is added to the fare. Settlement pays the whole of it to the driver - it
 * is money they handed over at the exit barrier, never platform revenue.
 */

// A hub with a location but no drawn boundary still counts within this.
export const HUB_FALLBACK_RADIUS_KM = 2;

// Safety net, as for the parcel waiting charge: a driver who forgets to start
// the trip should not bill the rider for the rest of the day.
const DEFAULT_MAX_PARKING_MINUTES = 120;

export const HUB_TYPES = Object.freeze(['airport', 'railway_station']);
export const PARKING_VEHICLE_CLASSES = Object.freeze(['all', 'bike', 'auto', 'car']);

const money = (value) => Math.round(Math.max(0, Number(value) || 0) * 100) / 100;

export const hubTypeOf = (row) => (HUB_TYPES.includes(row?.hub_type) ? row.hub_type : 'airport');

/// Ray casting over a GeoJSON ring of [lng, lat] points.
export const insideRing = ([lng, lat], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
};

export const distanceKm = ([lng1, lat1], [lng2, lat2]) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/// The area a hub covers: its drawn boundary, else a circle round its pin.
export const hubGeofence = (row) => {
  const ring = row?.boundary?.coordinates?.[0];
  const centre = row?.location?.coordinates
    || (Number.isFinite(row?.longitude) && Number.isFinite(row?.latitude) ? [row.longitude, row.latitude] : null);
  return {
    ring: Array.isArray(ring) && ring.length >= 4 ? ring : undefined,
    centre: Array.isArray(centre) && centre.length === 2 ? centre : undefined,
    radius_km: HUB_FALLBACK_RADIUS_KM,
  };
};

export const insideGeofence = (point, geofence) => {
  if (!Array.isArray(point) || point.length !== 2 || !geofence) return false;
  if (Array.isArray(geofence.ring) && geofence.ring.length >= 4) return insideRing(point, geofence.ring);
  if (Array.isArray(geofence.centre) && geofence.centre.length === 2) {
    return distanceKm(point, geofence.centre) <= (Number(geofence.radius_km) || HUB_FALLBACK_RADIUS_KM);
  }
  return false;
};

export const hubAt = (rows, point) => rows.find((row) => insideGeofence(point, hubGeofence(row))) || null;

/// Cleans parking rules from the admin form. Bad rows are dropped, not refused.
export const normalizeParkingConfig = (input = {}) => {
  const rules = (Array.isArray(input?.rules) ? input.rules : [])
    .map((rule) => {
      const vehicleClass = String(rule?.vehicle_class || 'all').trim().toLowerCase();
      const slabs = (Array.isArray(rule?.slabs) ? rule.slabs : [])
        .map((slab) => ({
          up_to_minutes: Math.max(0, Math.round(Number(slab?.up_to_minutes) || 0)),
          fee: money(slab?.fee),
        }))
        .filter((slab) => slab.up_to_minutes > 0)
        .sort((a, b) => a.up_to_minutes - b.up_to_minutes);
      return {
        vehicle_class: PARKING_VEHICLE_CLASSES.includes(vehicleClass) ? vehicleClass : 'all',
        drop_fee: money(rule?.drop_fee),
        slabs,
      };
    })
    // One rule per class; the later one wins, as it would on screen.
    .reduce((byClass, rule) => byClass.set(rule.vehicle_class, rule), new Map());

  const maxMinutes = Math.round(Number(input?.max_minutes));
  return {
    enabled: Boolean(input?.enabled),
    max_minutes: Number.isFinite(maxMinutes) && maxMinutes > 0 ? maxMinutes : DEFAULT_MAX_PARKING_MINUTES,
    rules: [...rules.values()],
  };
};

/// The rule a vehicle class pays under: its own, else the "all" rule.
export const parkingRuleFor = (hubRow, vehicleClass) => {
  if (!hubRow?.parking?.enabled) return null;
  const rules = hubRow.parking.rules || [];
  const wanted = String(vehicleClass || '').trim().toLowerCase();
  return rules.find((rule) => rule.vehicle_class === wanted)
    || rules.find((rule) => rule.vehicle_class === 'all')
    || null;
};

export const slabFee = (slabs = [], minutes = 0) => {
  if (!slabs.length) return 0;
  const sorted = [...slabs].sort((a, b) => a.up_to_minutes - b.up_to_minutes);
  const slab = sorted.find((row) => minutes <= row.up_to_minutes) || sorted[sorted.length - 1];
  return money(slab.fee);
};

const hubSummary = (row) => ({
  id: String(row._id),
  name: row.name,
  code: row.code || '',
  hub_type: hubTypeOf(row),
});

/**
 * What the rider should be shown before booking: the least a pickup at the hub
 * can cost (the first slab - the final figure depends on how long the driver
 * waits) and the drop fee. Nothing when neither end is at a hub with parking.
 */
export const estimateHubParking = ({ pickupHub, dropHub, vehicleClass }) => {
  const pickupRule = parkingRuleFor(pickupHub, vehicleClass);
  const dropRule = parkingRuleFor(dropHub, vehicleClass);
  if (!pickupRule && !dropRule) return null;

  const pickupFrom = pickupRule ? slabFee(pickupRule.slabs, 0) : 0;
  const dropFee = dropRule ? money(dropRule.drop_fee) : 0;
  return {
    pickup: pickupRule
      ? { ...hubSummary(pickupHub), fee_from: pickupFrom, slabs: pickupRule.slabs, varies_with_wait: pickupRule.slabs.length > 1 }
      : null,
    drop: dropRule ? { ...hubSummary(dropHub), fee: dropFee } : null,
    estimated_total: money(pickupFrom + dropFee),
  };
};

const legSnapshot = (row, rule, end) => ({
  hub_id: row._id,
  name: row.name,
  hub_type: hubTypeOf(row),
  geofence: hubGeofence(row),
  slabs: end === 'pickup' ? rule.slabs : [],
  drop_fee: end === 'drop' ? money(rule.drop_fee) : 0,
  max_minutes: Number(row.parking?.max_minutes) || DEFAULT_MAX_PARKING_MINUTES,
  entered_at: null,
  exited_at: null,
  minutes: 0,
  fee: 0,
});

/// The parking terms locked onto a ride at booking, or undefined for none.
export const buildRideHubParking = ({ pickupHub, dropHub, vehicleClass }) => {
  const pickupRule = parkingRuleFor(pickupHub, vehicleClass);
  const dropRule = parkingRuleFor(dropHub, vehicleClass);
  if (!pickupRule && !dropRule) return undefined;
  return {
    pickup: pickupRule ? legSnapshot(pickupHub, pickupRule, 'pickup') : undefined,
    drop: dropRule ? legSnapshot(dropHub, dropRule, 'drop') : undefined,
    total_fee: 0,
    applied_at: null,
  };
};

/**
 * Which geofence times a live location fix settles, as a $set, or null.
 *
 * The pickup stay starts at the first fix inside the hub once the driver has
 * the ride (a driver already waiting in the taxi bay starts the clock at
 * acceptance, not when they got there) and ends at the first fix outside it
 * after the trip starts.
 */
export const hubParkingStampsForLocation = (ride, point, now = new Date()) => {
  const pickup = ride?.hub_parking?.pickup;
  if (!pickup?.geofence || pickup.exited_at) return null;

  const status = ride.liveStatus;
  const inside = insideGeofence(point, pickup.geofence);

  if (!pickup.entered_at && inside && ['accepted', 'arriving', 'started'].includes(status)) {
    return { 'hub_parking.pickup.entered_at': now };
  }
  if (pickup.entered_at && !inside && ['started', 'arrived'].includes(status)) {
    return { 'hub_parking.pickup.exited_at': now };
  }
  return null;
};

/**
 * Adds the hub parking to a completing ride's fare. Called before the ride is
 * saved, because the wallet settlement that follows reads ride.fare.
 */
export const applyHubParkingCharge = (ride) => {
  const parking = ride?.hub_parking;
  if (!parking || parking.applied_at) return 0;
  if (!parking.pickup?.hub_id && !parking.drop?.hub_id) return 0;

  let total = 0;

  if (parking.pickup?.hub_id) {
    // Gaps in the live fixes fall back to the trip's own milestones: reaching
    // the pickup for the entry, starting the trip for the exit.
    const enteredAt = parking.pickup.entered_at || ride.arrivedAt || ride.startedAt || null;
    const exitedAt = parking.pickup.exited_at || ride.startedAt || ride.completedAt || null;
    const elapsedMs = enteredAt && exitedAt ? new Date(exitedAt).getTime() - new Date(enteredAt).getTime() : 0;
    // Part-minutes count as a minute here: a barrier ticket for 10m 20s is the
    // 10-20 minute ticket.
    const minutes = Math.min(
      Math.max(0, Math.ceil((Number.isFinite(elapsedMs) ? elapsedMs : 0) / 60000)),
      Number(parking.pickup.max_minutes) || DEFAULT_MAX_PARKING_MINUTES,
    );
    const fee = slabFee(parking.pickup.slabs || [], minutes);
    parking.pickup.minutes = minutes;
    parking.pickup.fee = fee;
    total += fee;
  }

  if (parking.drop?.hub_id) {
    const fee = money(parking.drop.drop_fee);
    parking.drop.fee = fee;
    total += fee;
  }

  total = money(total);
  parking.total_fee = total;
  parking.applied_at = new Date();
  if (total > 0) {
    ride.fare = money(Number(ride.fare || 0) + total);
  }
  return total;
};

/// For the apps and admin: what was charged and why, without the geofence.
export const serializeRideHubParking = (parking) => {
  if (!parking || (!parking.pickup?.hub_id && !parking.drop?.hub_id)) return null;
  const leg = (row, end) => (row?.hub_id
    ? {
        hub_id: String(row.hub_id),
        name: row.name || '',
        hub_type: row.hub_type || 'airport',
        ...(end === 'pickup'
          ? { slabs: row.slabs || [], entered_at: row.entered_at || null, exited_at: row.exited_at || null, minutes: Number(row.minutes || 0) }
          : { drop_fee: Number(row.drop_fee || 0) }),
        fee: Number(row.fee || 0),
      }
    : null);
  return {
    pickup: leg(parking.pickup, 'pickup'),
    drop: leg(parking.drop, 'drop'),
    total_fee: Number(parking.total_fee || 0),
    applied_at: parking.applied_at || null,
  };
};
