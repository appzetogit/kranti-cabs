/**
 * Aggregated ride demand per geographic zone.
 *
 * Reads the rides and drivers this backend already stores — no new collection,
 * no denormalised zone field to keep in sync, and nothing about an individual
 * rider or driver ever leaves this module.
 */
import { Ride } from '../user/models/Ride.js';
import { Driver } from '../driver/models/Driver.js';
import {
  HEATMAP_DEMAND_STATUSES,
  HEATMAP_STATUS_WEIGHTS,
  resolveHeatmapConfig,
} from './heatmapConfig.js';
import { distanceMeters, zoneGeometry, zoneIdFor } from './heatmapGrid.js';

/// Weight a single request contributes, given how long ago it was made.
///
/// Exponential decay: a request from 2 minutes ago counts almost fully, one
/// from 30 minutes ago barely registers. This is what makes the map read as
/// demand *now* rather than a history of the last half hour.
const decayWeight = (ageMinutes, decayConstant) =>
  Math.exp(-Math.max(0, ageMinutes) / decayConstant);

/// Value at a percentile of an ascending list, linearly interpolated.
const percentile = (sortedAscending, fraction) => {
  if (sortedAscending.length === 0) return 0;
  if (sortedAscending.length === 1) return sortedAscending[0];

  const position = (sortedAscending.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedAscending[lower];

  return sortedAscending[lower] + (sortedAscending[upper] - sortedAscending[lower]) * (position - lower);
};

/**
 * Relative classification, with an absolute floor.
 *
 * Pure percentile ranking alone is wrong in both directions: on a dead night
 * the single zone with one request becomes "HIGH", and in a uniformly busy city
 * two thirds of zones become "LOW" despite every one of them being worth
 * driving to. So a zone must clear a percentile *and* a minimum raw score.
 */
const classify = (score, thresholds, config) => {
  if (score >= thresholds.high && score >= config.minScoreForHigh) return 'high';
  if (score >= thresholds.medium && score >= config.minScoreForMedium) return 'medium';
  return 'low';
};

/**
 * Demand zones around a point.
 *
 * @param {object} params
 * @param {number} params.lat    driver latitude
 * @param {number} params.lng    driver longitude
 * @param {number} [params.radiusKm]
 * @param {number} [params.resolutionMeters]
 */
export const getHeatmapZones = async ({ lat, lng, radiusKm, resolutionMeters } = {}) => {
  const config = await resolveHeatmapConfig();

  const centerLat = Number(lat);
  const centerLng = Number(lng);
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) {
    return { updatedAt: new Date().toISOString(), zones: [], config: publicConfig(config) };
  }

  const radius = Math.min(
    config.maxRadiusKm,
    Math.max(1, Number(radiusKm) || config.defaultRadiusKm),
  );
  const resolution = Math.min(
    10000,
    Math.max(200, Number(resolutionMeters) || config.resolutionMeters),
  );
  const radiusMeters = radius * 1000;
  const since = new Date(Date.now() - config.windowMinutes * 60 * 1000);

  // Only the fields the maths needs. Nothing identifying the rider is read, let
  // alone returned — see the module docblock.
  const [rides, drivers] = await Promise.all([
    Ride.find(
      {
        status: { $in: HEATMAP_DEMAND_STATUSES },
        createdAt: { $gte: since },
        pickupLocation: {
          $geoWithin: { $centerSphere: [[centerLng, centerLat], radiusMeters / 6378100] },
        },
      },
      { pickupLocation: 1, createdAt: 1, status: 1 },
    ).lean(),

    Driver.find(
      {
        isOnline: true,
        isOnRide: false,
        location: {
          $geoWithin: { $centerSphere: [[centerLng, centerLat], radiusMeters / 6378100] },
        },
      },
      { location: 1 },
    ).lean(),
  ]);

  const now = Date.now();
  const zones = new Map();

  const ensureZone = (zoneId) => {
    if (!zones.has(zoneId)) {
      zones.set(zoneId, { zoneId, requestScore: 0, requestCount: 0, availableDrivers: 0 });
    }
    return zones.get(zoneId);
  };

  for (const ride of rides) {
    const coords = ride?.pickupLocation?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;

    const zoneId = zoneIdFor(Number(coords[1]), Number(coords[0]), resolution);
    if (!zoneId) continue;

    const ageMinutes = (now - new Date(ride.createdAt).getTime()) / 60000;
    const statusWeight = HEATMAP_STATUS_WEIGHTS[ride.status] ?? 1;

    const zone = ensureZone(zoneId);
    zone.requestScore += decayWeight(ageMinutes, config.decayConstant) * statusWeight;
    zone.requestCount += 1;
  }

  // Supply, counted the same way so the two are comparable per zone. Only a
  // count ever leaves this function; individual driver positions do not.
  for (const driver of drivers) {
    const coords = driver?.location?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;

    const zoneId = zoneIdFor(Number(coords[1]), Number(coords[0]), resolution);
    if (!zoneId) continue;

    ensureZone(zoneId).availableDrivers += 1;
  }

  const scored = [];
  for (const zone of zones.values()) {
    const geometry = zoneGeometry(zone.zoneId);
    if (!geometry) continue;

    // Trim the square query box back to a real circle, so the corners of the
    // bounding box do not show zones the driver did not ask for.
    if (distanceMeters(centerLat, centerLng, geometry.center.lat, geometry.center.lng) > radiusMeters) {
      continue;
    }

    const demandScore = Math.max(
      0,
      zone.requestScore * config.demandMultiplier - zone.availableDrivers * config.driverWeight,
    );

    // A zone with no demand at all is not worth a polygon; sending it would
    // just paint the whole city grey and inflate the payload.
    if (zone.requestCount === 0) continue;

    scored.push({
      id: zone.zoneId,
      center: geometry.center,
      polygon: geometry.polygon,
      demandScore: Number(demandScore.toFixed(3)),
      requestCount: zone.requestCount,
      availableDrivers: zone.availableDrivers,
    });
  }

  const sortedScores = scored.map((z) => z.demandScore).sort((a, b) => a - b);
  const thresholds = {
    high: percentile(sortedScores, config.highPercentile),
    medium: percentile(sortedScores, config.mediumPercentile),
  };

  for (const zone of scored) {
    zone.level = classify(zone.demandScore, thresholds, config);
  }

  // Hottest first, then capped: if the cap bites, the driver keeps the zones
  // that actually matter rather than an arbitrary slice.
  scored.sort((a, b) => b.demandScore - a.demandScore);

  return {
    updatedAt: new Date().toISOString(),
    zones: scored.slice(0, config.maxZones),
    config: publicConfig(config),
  };
};

/// Only the values the app needs to behave correctly. Weights and thresholds
/// stay server-side.
const publicConfig = (config) => ({
  resolutionMeters: config.resolutionMeters,
  defaultRadiusKm: config.defaultRadiusKm,
  maxRadiusKm: config.maxRadiusKm,
  refreshIntervalSeconds: config.refreshIntervalSeconds,
  windowMinutes: config.windowMinutes,
});

/**
 * The zone one coordinate belongs to, for the socket nudge sent when a ride is
 * created or closed. Cheap: no database access at all.
 */
export const zoneIdForCoordinates = async (lat, lng) => {
  const config = await resolveHeatmapConfig();
  return zoneIdFor(Number(lat), Number(lng), config.resolutionMeters);
};
