/**
 * Every tunable the demand heat map uses.
 *
 * One place on purpose: the thresholds and weights below decide what a driver
 * sees as "hot", and hunting them down across a service, a controller and a
 * Flutter widget is how they drift apart.
 *
 * Defaults can be overridden per deployment through the existing admin
 * general-settings system (category `heatmap`), so a city can be retuned
 * without a release — see `resolveHeatmapConfig`.
 */
import { getGeneralSettings } from '../admin/services/adminService.js';

export const HEATMAP_DEFAULTS = Object.freeze({
  /// How far back a ride request still counts toward demand.
  windowMinutes: 30,

  /// Exponential decay constant, in minutes. A request this old contributes
  /// 1/e (~37%) of a brand new one; at 3x this it is down to ~5%.
  decayConstant: 10,

  /// Grid cell size in metres (approximate, at the equator). Smaller means more
  /// zones and finer detail at the cost of payload size.
  resolutionMeters: 1200,

  /// Default and maximum radius around the driver, in kilometres. The cap is
  /// what stops one request from asking for a whole state.
  defaultRadiusKm: 6,
  maxRadiusKm: 15,

  /// Never return more than this many zones in one response.
  maxZones: 160,

  /// Multiplies the decayed request score before supply is subtracted.
  demandMultiplier: 1,

  /// How much one idle nearby driver cancels out. 20 requests with 2 drivers
  /// should read hotter than 20 requests with 30, and this is the dial for it.
  driverWeight: 0.6,

  /// Relative classification. A zone at or above `highPercentile` of the
  /// scores in the current response is HIGH, at or above `mediumPercentile` is
  /// MEDIUM, the rest LOW.
  highPercentile: 0.67,
  mediumPercentile: 0.34,

  /// Absolute floor so a near-dead city cannot paint a single request red.
  /// A zone must clear this raw score before it can be called HIGH.
  minScoreForHigh: 2.5,
  minScoreForMedium: 1,

  /// How often the driver app refetches its visible area when the socket is
  /// quiet, in seconds.
  refreshIntervalSeconds: 25,
});

/// Ride statuses that represent demand still looking for a driver.
///
/// Mapped onto the statuses this backend already uses — no new ones invented.
/// `searching` is live unmet demand. `cancelled` is included at a discount
/// because a rider who gave up waiting is still evidence that the area wanted a
/// car; `accepted`/`ongoing`/`completed` are demand that has already been met.
export const HEATMAP_DEMAND_STATUSES = Object.freeze(['searching', 'cancelled']);

/// Weight applied per status, so met-but-abandoned demand counts for less.
export const HEATMAP_STATUS_WEIGHTS = Object.freeze({
  searching: 1,
  cancelled: 0.5,
});

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/// Admin overrides merged over the defaults.
///
/// Never throws: a missing or malformed settings document falls back to the
/// defaults rather than taking the heat map — and with it the driver's map
/// screen — down with it.
export const resolveHeatmapConfig = async () => {
  try {
    const result = await getGeneralSettings('heatmap');
    const saved = result?.settings && typeof result.settings === 'object' ? result.settings : {};

    const merged = { ...HEATMAP_DEFAULTS };
    for (const key of Object.keys(HEATMAP_DEFAULTS)) {
      if (saved[key] !== undefined) {
        merged[key] = toNumber(saved[key], HEATMAP_DEFAULTS[key]);
      }
    }

    // Guard rails, so a bad admin value cannot produce a divide-by-zero or a
    // request for the entire planet.
    merged.windowMinutes = Math.min(240, Math.max(1, merged.windowMinutes));
    merged.decayConstant = Math.max(0.5, merged.decayConstant);
    merged.resolutionMeters = Math.min(10000, Math.max(200, merged.resolutionMeters));
    merged.maxRadiusKm = Math.min(50, Math.max(1, merged.maxRadiusKm));
    merged.defaultRadiusKm = Math.min(merged.maxRadiusKm, Math.max(1, merged.defaultRadiusKm));
    merged.maxZones = Math.min(500, Math.max(10, Math.round(merged.maxZones)));
    merged.highPercentile = Math.min(0.99, Math.max(0.5, merged.highPercentile));
    merged.mediumPercentile = Math.min(merged.highPercentile - 0.05, Math.max(0.05, merged.mediumPercentile));

    return merged;
  } catch {
    return { ...HEATMAP_DEFAULTS };
  }
};
