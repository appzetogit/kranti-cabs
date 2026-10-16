import { runRedisCommand } from '../../../infrastructure/redis/redisClient.js';
import { Airport } from '../admin/models/Airport.js';
import { getMapSettings } from '../admin/services/adminService.js';
import { Driver } from '../driver/models/Driver.js';
import { getTariffsAt } from '../user/controllers/userController.js';
import { describeOpportunityAt, getSurgeProfiles, listOpportunityCells, profileKeyForVehicle } from './surgeService.js';

/**
 * The driver app's surge & demand map: where fares are higher and where
 * riders are waiting, so a driver can decide where to go.
 *
 * Everything is read from what the surge engine already computes once a
 * minute. Nothing here records demand or changes a price, so opening the map
 * cannot move a surge, and the multiplier shown is the one riders are quoted.
 *
 * Contract: docs/surge-heatmap-implementation.md in the driver app repo.
 */

const REFRESH_AFTER_SECONDS = 60;
const EXAMPLE_TRIP_KM = 5;
const MAX_HOTSPOTS = 3;
const AIRPORT_RADIUS_KM = 60;
const LABEL_TTL_SECONDS = 24 * 60 * 60;
const LABEL_MISS_TTL_SECONDS = 60 * 60;
const LABEL_TIMEOUT_MS = 1500;

const LEVEL_RANK = { very_high: 2, high: 1, normal: 0 };

const toRad = (deg) => (deg * Math.PI) / 180;
const distanceKm = (aLat, aLng, bLat, bLng) => {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(h)) * 100) / 100;
};

/**
 * What a trip of `km` costs on a tariff row, by the rider app's own formula:
 * base fare for the first base_distance, then per km, then the platform fee.
 * No time component - the per-minute charge is not used.
 */
const fareFor = (row, km) => {
  const base = Number(row.base_price) || 0;
  const freeKm = Number(row.base_distance) || 0;
  const perKm = Number(row.price_per_distance) || 0;
  const subtotal = base + Math.max(0, km - freeKm) * perKm;
  const fee = Number(row.rider_platform_fee) || 0;
  const feeAmount = row.rider_platform_fee_type === 'percentage' ? (subtotal * fee) / 100 : fee;
  return Math.round(subtotal + feeAmount);
};

/**
 * A short place name for a hexagon ("Majestic"), from Google's reverse
 * geocoder, cached per hexagon for a day - and a miss for an hour, so an area
 * Google cannot name is not asked about on every refresh.
 *
 * Best effort: no key, a slow answer or an error all give '', and the app
 * shows the distance instead.
 */
const labelFor = async (hex, lat, lng) => {
  const cacheKey = `opmap:label:${hex}`;
  const cached = await runRedisCommand((client) => client.get(cacheKey), { label: 'opmap label read' });
  if (cached.ok && cached.value !== null && cached.value !== undefined) return cached.value;

  let label = '';
  try {
    const settings = (await getMapSettings())?.settings || {};
    const key = settings.google_map_key_for_distance_matrix || settings.google_map_key_for_web_apps;
    if (key) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), LABEL_TIMEOUT_MS);
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&result_type=neighborhood|sublocality|locality&key=${encodeURIComponent(key)}`;
      const response = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
      const body = await response.json();
      const parts = body?.results?.[0]?.address_components || [];
      const pick = (type) => parts.find((part) => part.types?.includes(type))?.short_name || '';
      label = pick('neighborhood') || pick('sublocality_level_1') || pick('sublocality') || pick('locality');
    }
  } catch {
    label = '';
  }

  await runRedisCommand(
    (client) => client.set(cacheKey, label, { EX: label ? LABEL_TTL_SECONDS : LABEL_MISS_TTL_SECONDS }),
    { label: 'opmap label write' },
  );
  return label;
};

/** Normal and surged fare for this driver's vehicle at a point. */
const exampleFareAt = async ({ lat, lng, profileMultipliers, profiles, vehicleTypeIds, tariffCache }) => {
  const { zone, tariffs } = await getTariffsAt({ lat, lng });
  const zoneKey = zone ? String(zone._id) : 'none';
  if (!tariffCache.has(zoneKey)) tariffCache.set(zoneKey, tariffs);
  const rows = tariffCache.get(zoneKey) || [];

  const row = vehicleTypeIds
    .map((id) => rows.find((candidate) => String(candidate.type_id || candidate.vehicle_type) === id))
    .find(Boolean);
  if (!row) return null;

  const normal = fareFor(row, EXAMPLE_TRIP_KM);
  // This vehicle's own surge here: surge is set per vehicle type.
  const rowVehicleId = row.type_id || row.vehicle_type?._id || row.vehicle_type;
  const applied = profileMultipliers?.[profileKeyForVehicle(profiles, rowVehicleId)] || 1;
  return {
    km: EXAMPLE_TRIP_KM,
    normal,
    // The surge scales the tariff itself, so the fare scales with it.
    now: Math.round(normal * applied),
    vehicle: row.name || '',
  };
};

export const getOpportunityMap = async ({ driverId, lat, lng, radiusKm }) => {
  const radius = Math.min(25, Math.max(1, Number(radiusKm) || 8));
  const latitude = Number(lat);
  const longitude = Number(lng);
  const hasPoint = Number.isFinite(latitude) && Number.isFinite(longitude);

  const [profiles, driver] = await Promise.all([
    getSurgeProfiles(),
    driverId ? Driver.findById(driverId).select('vehicleTypeId vehicleTypeIds').lean() : null,
  ]);

  const vehicleTypeIds = [...new Set([driver?.vehicleTypeId, ...(driver?.vehicleTypeIds || [])]
    .filter(Boolean)
    .map(String))];

  // Surge is set per vehicle type, so the map shows this driver's own: the
  // highest among the vehicles they drive. A vehicle that is not surging
  // shows the demand but no higher fare.
  const { enabled, max_multiplier: maxMultiplier, cells } = await listOpportunityCells({
    lat: latitude,
    lng: longitude,
    radiusKm: radius,
    vehicleTypeIds,
  });

  // The best few places to go: highest fare first, then busiest, then nearest.
  // Only surging or busy hexagons are worth suggesting; the quiet grid around
  // the driver is there to be seen, not to be sent to.
  const ranked = cells.filter((cell) => cell.multiplier > 1 || cell.demand_level !== 'normal').sort((a, b) =>
    b.multiplier - a.multiplier
    || LEVEL_RANK[b.demand_level] - LEVEL_RANK[a.demand_level]
    || (a.distance_km ?? 0) - (b.distance_km ?? 0));
  const top = ranked.slice(0, MAX_HOTSPOTS);

  // Names and fares only for the hotspots: one geocode and one tariff read
  // each at most, whatever the number of cells.
  const tariffCache = new Map();
  const details = await Promise.all(
    top.map(async (cell) => {
      const [label, exampleFare] = await Promise.all([
        labelFor(cell.hex, cell.center.lat, cell.center.lng).catch(() => ''),
        vehicleTypeIds.length
          ? exampleFareAt({
            lat: cell.center.lat,
            lng: cell.center.lng,
            profileMultipliers: cell.profile_multipliers,
            profiles,
            vehicleTypeIds,
            tariffCache,
          }).catch(() => null)
          : null,
      ]);
      return { hex: cell.hex, label, exampleFare };
    }),
  );
  const labels = new Map(details.map((item) => [item.hex, item.label]));

  const hotspots = top.map((cell) => {
    const detail = details.find((item) => item.hex === cell.hex) || {};
    return {
      hex: cell.hex,
      title: detail.label || '',
      center: cell.center,
      multiplier: cell.multiplier,
      surge_ends_in_minutes: cell.surge_ends_in_minutes,
      demand_level: cell.demand_level,
      distance_km: cell.distance_km,
      example_fare: detail.exampleFare || null,
    };
  });

  const airportDocs = await Airport.find({ active: { $ne: false }, status: { $ne: 'inactive' } })
    .select('name latitude longitude location')
    .lean();
  const airports = (
    await Promise.all(
      airportDocs.map(async (airport) => {
        const aLng = airport.location?.coordinates?.[0] ?? airport.longitude;
        const aLat = airport.location?.coordinates?.[1] ?? airport.latitude;
        if (!Number.isFinite(Number(aLat)) || !Number.isFinite(Number(aLng))) return null;
        const distance = hasPoint ? distanceKm(latitude, longitude, Number(aLat), Number(aLng)) : null;
        if (distance !== null && distance > AIRPORT_RADIUS_KM) return null;
        const info = await describeOpportunityAt(Number(aLat), Number(aLng), vehicleTypeIds).catch(() => null);
        return {
          name: airport.name,
          lat: Number(aLat),
          lng: Number(aLng),
          demand_level: info?.demand_level || 'normal',
          multiplier: info?.multiplier || 1,
          surge_ends_in_minutes: info?.surge_ends_in_minutes || 0,
          distance_km: distance,
        };
      }),
    )
  )
    .filter(Boolean)
    .sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0));

  return {
    refreshed_at: new Date().toISOString(),
    refresh_after_seconds: REFRESH_AFTER_SECONDS,
    surge_enabled: Boolean(enabled),
    max_multiplier: Number(maxMultiplier) || 1,
    cells: cells.map(({ profile_multipliers: _internal, ...cell }) => ({ ...cell, label: labels.get(cell.hex) || '' })),
    hotspots,
    airports,
  };
};
