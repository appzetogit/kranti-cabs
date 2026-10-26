import { ApiError } from '../../../utils/ApiError.js';
import { normalizePoint, toPoint } from '../../../utils/geo.js';
import { Driver } from '../driver/models/Driver.js';
import { resolveRideRoute } from './routeService.js';
import { getTransportRideSettings } from './transportSettingsService.js';
import { sendPushNotificationToEntities } from './pushNotificationService.js';

/**
 * Destination mode ("Go Home"): a driver heading somewhere - usually home -
 * is offered only rides that take them that way.
 *
 * Turning it on stores the driver's road route from where they are to the
 * destination. A ride qualifies when:
 *   - its pickup and its drop both lie within the corridor (2 km) of that
 *     route,
 *   - the drop comes after the pickup along the route, and the pickup is not
 *     behind the driver - the ride carries them forward, never back;
 *   - driver -> pickup -> drop -> destination is at most 30% longer than
 *     driver -> destination, so a ride along the corridor that zigzags is
 *     still refused.
 * Drivers not in destination mode are matched exactly as before.
 *
 * It turns itself off when the driver gets within 500 m of the destination
 * or after a time limit (3 h), and can be turned on a limited number of
 * times a day. Home itself can only be moved every few days, so it cannot be
 * re-pointed at wherever the good trips are. All of these are admin settings
 * in the transport_ride group.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const ROUTE_REFRESH_MIN_MS = 2 * 60 * 1000;

const number = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const isOn = (value) => ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());

export const resolveDestinationModeSettings = async () => {
  const settings = (await getTransportRideSettings()) || {};
  return {
    enabled: isOn(settings.enable_my_route_booking_feature),
    // 0 = no daily limit.
    usesPerDay: Math.max(0, Math.round(number(settings.how_many_times_a_driver_can_enable_the_my_route_booking_per_day, 1))),
    corridorMeters: Math.max(200, number(settings.destination_mode_corridor_km, 2) * 1000),
    maxDetour: Math.max(0, number(settings.destination_mode_max_detour_percent, 30)) / 100,
    maxHours: Math.max(0.5, number(settings.destination_mode_max_hours, 3)),
    arrivalMeters: Math.max(100, number(settings.destination_mode_arrival_meters, 500)),
    // 0 (the default) = home can be moved any time.
    homeChangeDays: Math.max(0, number(settings.destination_mode_home_change_days, 0)),
  };
};

// --- geometry ---------------------------------------------------------------

export const distanceMeters = ([lng1, lat1], [lng2, lat2]) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/// Google's encoded polyline (precision 5) to [[lng, lat], ...].
export const decodePolyline = (encoded = '') => {
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (const axis of ['lat', 'lng']) {
      let result = 0;
      let shift = 0;
      let byte;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
        // Past the end charCodeAt is NaN, which ends the loop.
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 'lat') lat += delta;
      else lng += delta;
    }
    points.push([lng / 1e5, lat / 1e5]);
  }
  return points;
};

// Decoded routes, by polyline, so a dispatch wave does not decode the same
// route for every ride it considers.
const pathCache = new Map();
const PATH_CACHE_LIMIT = 500;

const routePath = (polyline) => {
  if (!polyline) return null;
  let entry = pathCache.get(polyline);
  if (!entry) {
    const points = decodePolyline(polyline);
    if (points.length < 2) return null;
    const cumulative = [0];
    for (let i = 1; i < points.length; i += 1) {
      cumulative.push(cumulative[i - 1] + distanceMeters(points[i - 1], points[i]));
    }
    entry = { points, cumulative };
    if (pathCache.size >= PATH_CACHE_LIMIT) pathCache.delete(pathCache.keys().next().value);
    pathCache.set(polyline, entry);
  }
  return entry;
};

/**
 * Where a point sits relative to a route: how far it is from the road
 * (`offRouteMeters`) and how far along the route its nearest spot is
 * (`progressMeters`). Segments are flattened locally, which is exact enough
 * at city scale.
 */
export const projectOntoRoute = (point, path) => {
  const [px, py] = point;
  let best = { offRouteMeters: Infinity, progressMeters: 0 };
  for (let i = 1; i < path.points.length; i += 1) {
    const [ax, ay] = path.points[i - 1];
    const [bx, by] = path.points[i];
    const kx = 111320 * Math.cos((((ay + by) / 2) * Math.PI) / 180);
    const ky = 110540;
    const abx = (bx - ax) * kx;
    const aby = (by - ay) * ky;
    const apx = (px - ax) * kx;
    const apy = (py - ay) * ky;
    const lengthSq = abx * abx + aby * aby;
    const t = lengthSq > 0 ? Math.min(1, Math.max(0, (apx * abx + apy * aby) / lengthSq)) : 0;
    const dx = apx - t * abx;
    const dy = apy - t * aby;
    const off = Math.sqrt(dx * dx + dy * dy);
    if (off < best.offRouteMeters) {
      best = { offRouteMeters: off, progressMeters: path.cumulative[i - 1] + t * Math.sqrt(lengthSq) };
    }
  }
  return best;
};

/**
 * Whether a ride from `pickup` to `drop` takes a driver at `driverPoint`
 * towards their destination. All points are [lng, lat].
 */
export const isRideOnRoute = ({ polyline, destination, driverPoint, pickup, drop, settings }) => {
  const path = routePath(polyline);
  if (!path || !Array.isArray(destination) || !Array.isArray(pickup) || !Array.isArray(drop)) return false;

  const pickupOnRoute = projectOntoRoute(pickup, path);
  const dropOnRoute = projectOntoRoute(drop, path);
  if (pickupOnRoute.offRouteMeters > settings.corridorMeters) return false;
  if (dropOnRoute.offRouteMeters > settings.corridorMeters) return false;

  // Forward only: the drop further along than the pickup (a little slack for
  // two points on the same stretch), and the pickup not behind the driver.
  if (dropOnRoute.progressMeters + 200 < pickupOnRoute.progressMeters) return false;
  if (Array.isArray(driverPoint)) {
    const driverOnRoute = projectOntoRoute(driverPoint, path);
    if (pickupOnRoute.progressMeters + settings.corridorMeters < driverOnRoute.progressMeters) return false;
  }

  // Not a long way round, even inside the corridor.
  const start = Array.isArray(driverPoint) ? driverPoint : path.points[0];
  const direct = distanceMeters(start, destination);
  const via = distanceMeters(start, pickup) + distanceMeters(pickup, drop) + distanceMeters(drop, destination);
  return via <= direct * (1 + settings.maxDetour) + 500;
};

// --- which drivers are in the mode -------------------------------------------

const isActive = (mode, now = Date.now()) =>
  Boolean(mode?.enabled)
  && Array.isArray(mode?.destination?.coordinates)
  && Boolean(mode?.routePolyline)
  && (!mode.expiresAt || new Date(mode.expiresAt).getTime() > now);

/**
 * Narrows matched drivers for a ride: drivers in destination mode stay only
 * when the ride is on their way; everyone else is untouched. A ride with no
 * drop (or the feature switched off) keeps every driver not in the mode.
 * Expects `destinationMode` and `location` on each driver.
 */
export const filterDriversOnRoute = async ({ drivers = [], pickupCoords, dropCoords }) => {
  if (!drivers.some((driver) => driver?.destinationMode?.enabled)) return drivers;

  const settings = await resolveDestinationModeSettings();
  return drivers.filter((driver) => {
    const mode = driver?.destinationMode;
    if (!mode?.enabled) return true;
    if (!settings.enabled || !isActive(mode)) return false;
    if (!Array.isArray(dropCoords) || !Array.isArray(pickupCoords)) return false;
    return isRideOnRoute({
      polyline: mode.routePolyline,
      destination: mode.destination.coordinates,
      driverPoint: driver?.location?.coordinates,
      pickup: pickupCoords,
      drop: dropCoords,
      settings,
    });
  });
};

// Drivers with the mode on, so the location hook skips everyone else without
// a database read. Filled at startup and kept current by enable / disable.
const activeDriverIds = new Set();
let activeLoaded = false;

const loadActiveDrivers = async () => {
  if (activeLoaded) return;
  activeLoaded = true;
  const rows = await Driver.find({ 'destinationMode.enabled': true }).select('_id').lean();
  rows.forEach((row) => activeDriverIds.add(String(row._id)));
};

// --- driver actions ------------------------------------------------------------

const istDay = (now = Date.now()) => new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10);

export const serializeDestinationMode = (driver, settings = null) => {
  const mode = driver?.destinationMode || {};
  const home = driver?.homeLocation || {};
  const usage = driver?.destinationModeUsage || {};
  const usedToday = usage.day === istDay() ? Number(usage.count || 0) : 0;
  const homeCoordinates = home?.location?.coordinates;
  const nextHomeChangeAt = settings && home?.updatedAt && settings.homeChangeDays > 0
    ? new Date(new Date(home.updatedAt).getTime() + settings.homeChangeDays * 86400000)
    : null;

  return {
    enabled: isActive(mode),
    destination: isActive(mode)
      ? {
          lat: mode.destination.coordinates[1],
          lng: mode.destination.coordinates[0],
          label: mode.label || '',
          isHome: Boolean(mode.isHome),
        }
      : null,
    routePolyline: isActive(mode) ? mode.routePolyline : '',
    routeDistanceMeters: isActive(mode) ? Number(mode.routeDistanceMeters || 0) : 0,
    startedAt: isActive(mode) ? mode.startedAt : null,
    expiresAt: isActive(mode) ? mode.expiresAt : null,
    home: Array.isArray(homeCoordinates)
      ? { lat: homeCoordinates[1], lng: homeCoordinates[0], address: home.address || '', updatedAt: home.updatedAt }
      : null,
    canChangeHomeAt: nextHomeChangeAt && nextHomeChangeAt.getTime() > Date.now() ? nextHomeChangeAt : null,
    featureEnabled: settings ? settings.enabled : undefined,
    usesPerDay: settings ? settings.usesPerDay : undefined,
    usedToday,
  };
};

export const getDestinationModeForDriver = async (driverId) => {
  const [driver, settings] = await Promise.all([
    Driver.findById(driverId).select('destinationMode homeLocation destinationModeUsage').lean(),
    resolveDestinationModeSettings(),
  ]);
  if (!driver) throw new ApiError(404, 'Driver not found');
  return serializeDestinationMode(driver, settings);
};

export const setDriverHomeLocation = async (driverId, { lat, lng, address = '' } = {}) => {
  const coordinates = normalizePoint([Number(lng), Number(lat)], 'home');
  const [driver, settings] = await Promise.all([
    Driver.findById(driverId).select('homeLocation destinationMode destinationModeUsage'),
    resolveDestinationModeSettings(),
  ]);
  if (!driver) throw new ApiError(404, 'Driver not found');

  const current = driver.homeLocation?.location?.coordinates;
  const moved = !Array.isArray(current) || distanceMeters(current, coordinates) > 50;
  if (moved && Array.isArray(current) && driver.homeLocation?.updatedAt && settings.homeChangeDays > 0) {
    const allowedAt = new Date(new Date(driver.homeLocation.updatedAt).getTime() + settings.homeChangeDays * 86400000);
    if (allowedAt.getTime() > Date.now()) {
      throw new ApiError(429, `Home can be changed once every ${settings.homeChangeDays} days. Next change from ${allowedAt.toDateString()}.`, {
        code: 'HOME_CHANGE_TOO_SOON',
        nextChangeAt: allowedAt,
      });
    }
  }

  driver.homeLocation = {
    location: toPoint(coordinates, 'home'),
    address: String(address || '').trim(),
    // Only a real move restarts the wait; re-saving the same spot does not.
    updatedAt: moved ? new Date() : driver.homeLocation?.updatedAt || new Date(),
  };
  await driver.save();
  return serializeDestinationMode(driver.toObject(), settings);
};

/**
 * Turns destination mode on, towards home (`useHome`) or a place.
 * Uses the driver's last known location as the start of the route.
 */
export const enableDestinationMode = async (driverId, { useHome = false, lat, lng, label = '' } = {}) => {
  const [driver, settings] = await Promise.all([
    Driver.findById(driverId).select('location homeLocation destinationMode destinationModeUsage'),
    resolveDestinationModeSettings(),
  ]);
  if (!driver) throw new ApiError(404, 'Driver not found');
  if (!settings.enabled) {
    throw new ApiError(403, 'Destination mode is not available right now.', { code: 'DESTINATION_MODE_OFF' });
  }

  let destination;
  let destinationLabel = String(label || '').trim();
  if (useHome) {
    destination = driver.homeLocation?.location?.coordinates;
    if (!Array.isArray(destination)) {
      throw new ApiError(400, 'Set your home location first.', { code: 'HOME_NOT_SET' });
    }
    destinationLabel = destinationLabel || driver.homeLocation.address || 'Home';
  } else {
    destination = normalizePoint([Number(lng), Number(lat)], 'destination');
  }

  const origin = driver.location?.coordinates;
  if (!Array.isArray(origin) || (origin[0] === 0 && origin[1] === 0)) {
    throw new ApiError(400, 'Your location is not known yet. Go online and try again.', { code: 'NO_DRIVER_LOCATION' });
  }
  if (distanceMeters(origin, destination) <= settings.arrivalMeters) {
    throw new ApiError(400, "You're already there.", { code: 'ALREADY_AT_DESTINATION' });
  }

  const today = istDay();
  const usedToday = driver.destinationModeUsage?.day === today ? Number(driver.destinationModeUsage.count || 0) : 0;
  if (settings.usesPerDay > 0 && usedToday >= settings.usesPerDay) {
    throw new ApiError(429, `You've used destination mode ${usedToday}/${settings.usesPerDay} times today.`, {
      code: 'DESTINATION_DAILY_LIMIT',
      usesPerDay: settings.usesPerDay,
    });
  }

  const route = await resolveRideRoute({ pickupCoords: origin, dropCoords: destination });
  if (!route?.polyline) {
    throw new ApiError(502, "Couldn't find a road route there. Try again in a moment.", { code: 'NO_ROUTE' });
  }

  const now = new Date();
  driver.destinationMode = {
    enabled: true,
    destination: toPoint(destination, 'destination'),
    label: destinationLabel,
    isHome: Boolean(useHome),
    routePolyline: route.polyline,
    routeDistanceMeters: Number(route.distanceMeters || 0),
    routeUpdatedAt: now,
    startedAt: now,
    expiresAt: new Date(now.getTime() + settings.maxHours * 3600000),
  };
  driver.destinationModeUsage = { day: today, count: usedToday + 1 };
  await driver.save();

  activeDriverIds.add(String(driver._id));
  return serializeDestinationMode(driver.toObject(), settings);
};

export const disableDestinationMode = async (driverId, { reason = 'driver' } = {}) => {
  const driver = await Driver.findOneAndUpdate(
    { _id: driverId },
    { $set: { 'destinationMode.enabled': false, 'destinationMode.routePolyline': '' } },
    { returnDocument: 'before' },
  ).select('destinationMode homeLocation destinationModeUsage').lean();
  activeDriverIds.delete(String(driverId));
  if (!driver) throw new ApiError(404, 'Driver not found');

  if (reason !== 'driver' && driver.destinationMode?.enabled) {
    const where = driver.destinationMode.label || (driver.destinationMode.isHome ? 'home' : 'your destination');
    sendPushNotificationToEntities({
      driverIds: [String(driverId)],
      title: 'Destination mode is off',
      body: reason === 'arrived'
        ? `You've reached ${where}. You'll get all nearby rides again.`
        : `Destination mode to ${where} timed out. You'll get all nearby rides again.`,
      data: { type: 'destination_mode_ended', reason },
    }).catch(() => null);
  }

  const settings = await resolveDestinationModeSettings();
  return serializeDestinationMode({ ...driver, destinationMode: { ...driver.destinationMode, enabled: false } }, settings);
};

const lastRefreshAt = new Map();

/**
 * Called with each live location of a driver. Ends destination mode on
 * arrival or expiry, and re-plans the route when the driver has left it (a
 * detour, a ride that went elsewhere) so later rides are matched from where
 * they really are. Best effort and cheap for drivers not in the mode.
 */
export const handleDestinationModeLocation = async (driverId, point) => {
  await loadActiveDrivers();
  const key = String(driverId);
  if (!activeDriverIds.has(key) || !Array.isArray(point)) return;

  const driver = await Driver.findById(driverId).select('destinationMode isOnRide').lean();
  const mode = driver?.destinationMode;
  if (!mode?.enabled) {
    activeDriverIds.delete(key);
    return;
  }

  const settings = await resolveDestinationModeSettings();
  const destination = mode.destination?.coordinates;
  if (mode.expiresAt && new Date(mode.expiresAt).getTime() <= Date.now()) {
    await disableDestinationMode(driverId, { reason: 'expired' });
    return;
  }
  // Arriving with a rider on board is the end of that ride, not of the
  // driver's trip home; wait until they are free.
  if (Array.isArray(destination) && !driver.isOnRide && distanceMeters(point, destination) <= settings.arrivalMeters) {
    await disableDestinationMode(driverId, { reason: 'arrived' });
    return;
  }

  const path = routePath(mode.routePolyline);
  if (!path || driver.isOnRide) return;
  if (projectOntoRoute(point, path).offRouteMeters <= settings.corridorMeters) return;
  if (Date.now() - (lastRefreshAt.get(key) || 0) < ROUTE_REFRESH_MIN_MS) return;
  lastRefreshAt.set(key, Date.now());

  const route = await resolveRideRoute({ pickupCoords: point, dropCoords: destination });
  if (route?.polyline) {
    await Driver.updateOne(
      { _id: driverId, 'destinationMode.enabled': true },
      {
        $set: {
          'destinationMode.routePolyline': route.polyline,
          'destinationMode.routeDistanceMeters': Number(route.distanceMeters || 0),
          'destinationMode.routeUpdatedAt': new Date(),
        },
      },
    );
  }
};
