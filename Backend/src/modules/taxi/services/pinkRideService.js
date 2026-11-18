import mongoose from 'mongoose';
import { ApiError } from '../../../utils/ApiError.js';
import { PinkRideSetting } from '../admin/models/PinkRideSetting.js';
import { User } from '../user/models/User.js';

/**
 * Pink Ride - a ride only women drivers approved for it are offered.
 *
 * - Admin switches it on (Pink Ride page), per zone and vehicle, with an
 *   optional extra charge, and approves women drivers for it (driver edit).
 * - The rider books with `pinkRide: true`. Booking checks it is offered there
 *   and, when the admin says women only, that the rider is a woman - from her
 *   verified KYC (Aadhaar) when the admin requires it.
 * - Dispatch and every accept path offer it only to approved women drivers.
 *   With none nearby the ride ends as unmatched; it is never handed to a man.
 * - A driver may take Pink Rides only; normal rides then skip her.
 */

const CACHE_MS = 60 * 1000;
let cache = { row: null, at: 0 };

export const PINK_RIDE_DEFAULTS = Object.freeze({
  enabled: false,
  zone_ids: [],
  vehicle_type_ids: [],
  extra_fee_type: 'flat',
  extra_fee: 0,
  who_can_book: 'women_only',
  require_kyc: true,
  title: 'Pink Ride',
  subtitle: 'Women drivers only, for women riders',
});

export const invalidatePinkRideCache = () => {
  cache = { row: null, at: 0 };
};

const idList = (rows) => (Array.isArray(rows) ? rows : []).map(String).filter(Boolean);

export const getPinkRideSettings = async () => {
  if (cache.row && Date.now() - cache.at < CACHE_MS) return cache.row;
  const row = await PinkRideSetting.findOne({ scope: 'default' }).lean();
  const settings = { ...PINK_RIDE_DEFAULTS, ...(row || {}) };
  settings.zone_ids = idList(settings.zone_ids);
  settings.vehicle_type_ids = idList(settings.vehicle_type_ids);
  cache = { row: settings, at: Date.now() };
  return settings;
};

const money = (value) => Math.round(Math.max(0, Number(value) || 0) * 100) / 100;

export const updatePinkRideSettings = async (input = {}) => {
  const set = {};
  if (input.enabled !== undefined) set.enabled = input.enabled === true || input.enabled === 'true';
  const ids = (rows) =>
    (Array.isArray(rows) ? rows : [])
      .map(String)
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
  if (input.zone_ids !== undefined) set.zone_ids = ids(input.zone_ids);
  if (input.vehicle_type_ids !== undefined) set.vehicle_type_ids = ids(input.vehicle_type_ids);
  if (input.extra_fee_type !== undefined) set.extra_fee_type = input.extra_fee_type === 'percent' ? 'percent' : 'flat';
  if (input.extra_fee !== undefined) {
    set.extra_fee = money(input.extra_fee);
    if ((set.extra_fee_type || input.extra_fee_type) === 'percent') set.extra_fee = Math.min(set.extra_fee, 100);
  }
  if (input.who_can_book !== undefined) set.who_can_book = input.who_can_book === 'anyone' ? 'anyone' : 'women_only';
  if (input.require_kyc !== undefined) set.require_kyc = input.require_kyc === true || input.require_kyc === 'true';
  if (input.title !== undefined) set.title = String(input.title || '').trim().slice(0, 40) || PINK_RIDE_DEFAULTS.title;
  if (input.subtitle !== undefined) set.subtitle = String(input.subtitle || '').trim().slice(0, 120);
  await PinkRideSetting.updateOne({ scope: 'default' }, { $set: set }, { upsert: true });
  invalidatePinkRideCache();
  return getPinkRideSettings();
};

/// 'female', 'Female', 'F' - profiles and KYC providers write it differently.
export const isFemale = (gender) => /^f/i.test(String(gender || '').trim());

const FEMALE_QUERY = { $regex: /^f/i };

/// Whether a driver may be offered Pink Rides.
export const driverTakesPinkRides = (driver) =>
  Boolean(driver?.pinkRide?.approved) && isFemale(driver?.gender);

/**
 * The driver filter for a ride: only approved women for a Pink Ride; for any
 * other ride, everyone except drivers who take Pink Rides only.
 */
export const pinkRideDriverFilter = (isPinkRide) =>
  isPinkRide
    ? { gender: FEMALE_QUERY, 'pinkRide.approved': true }
    : { 'pinkRide.onlyPink': { $ne: true } };

/// The ride filter for lists a driver browses (scheduled rides).
export const pinkRideFilterForDriver = (driver) => {
  if (!driverTakesPinkRides(driver)) return { isPinkRide: { $ne: true } };
  return driver?.pinkRide?.onlyPink ? { isPinkRide: true } : {};
};

const zoneAt = async (point) => {
  try {
    const { findZoneByPickup } = await import('./matchingService.js');
    return await findZoneByPickup(point);
  } catch {
    return null;
  }
};

/**
 * Whether Pink Ride is offered at a pickup, and for which vehicles.
 * { available, reason, zone_id, vehicle_type_ids, extra_fee_type, extra_fee, title, subtitle }
 */
export const pinkRideAvailability = async ({ point, settings = null } = {}) => {
  const config = settings || (await getPinkRideSettings());
  const base = {
    available: false,
    reason: '',
    zone_id: null,
    vehicle_type_ids: config.vehicle_type_ids,
    extra_fee_type: config.extra_fee_type,
    extra_fee: config.extra_fee,
    who_can_book: config.who_can_book,
    require_kyc: config.require_kyc,
    title: config.title,
    subtitle: config.subtitle,
  };
  if (!config.enabled) return { ...base, reason: 'disabled' };
  const zone = point ? await zoneAt(point) : null;
  if (!zone) return { ...base, reason: 'unserviceable' };
  const zoneId = String(zone._id);
  if (config.zone_ids.length && !config.zone_ids.includes(zoneId)) {
    return { ...base, zone_id: zoneId, reason: 'not_in_zone' };
  }
  return { ...base, available: true, zone_id: zoneId };
};

/// The Pink Ride charge on a fare.
export const pinkRideFee = (settings, fare) => {
  const fee = Number(settings?.extra_fee) || 0;
  if (fee <= 0) return 0;
  return settings.extra_fee_type === 'percent' ? money((Number(fare) || 0) * Math.min(fee, 100) / 100) : money(fee);
};

/**
 * May this user book a Pink Ride here on this vehicle? Throws an ApiError the
 * apps show as-is; returns the settings when yes.
 */
export const assertPinkRideBooking = async ({ userId, pickup, vehicleTypeIds = [], serviceType = 'ride' }) => {
  const settings = await getPinkRideSettings();
  const availability = await pinkRideAvailability({ point: pickup, settings });
  if (!availability.available) {
    throw new ApiError(400, 'Pink Ride is not available at this pickup point', { code: 'PINK_RIDE_UNAVAILABLE' });
  }
  if (['parcel', 'hourly_rental'].includes(String(serviceType || ''))) {
    throw new ApiError(400, 'Pink Ride is for rides only', { code: 'PINK_RIDE_UNAVAILABLE' });
  }
  const vehicles = idList(vehicleTypeIds);
  if (settings.vehicle_type_ids.length && !vehicles.some((id) => settings.vehicle_type_ids.includes(id))) {
    throw new ApiError(400, 'Pink Ride is not offered on this vehicle', { code: 'PINK_RIDE_VEHICLE' });
  }

  if (settings.who_can_book === 'women_only') {
    const user = await User.findById(userId).select('gender kyc').lean();
    const kycVerified = user?.kyc?.status === 'verified';
    // A verified identity decides; the profile can be edited by anyone.
    const female = kycVerified && user?.kyc?.gender ? isFemale(user.kyc.gender) : isFemale(user?.gender);
    if (settings.require_kyc && !kycVerified) {
      throw new ApiError(403, 'Verify your identity to book a Pink Ride.', { code: 'KYC_REQUIRED', kycStatus: user?.kyc?.status || 'not_started', pinkRide: true });
    }
    if (!female) {
      throw new ApiError(403, 'Pink Ride is only for women riders.', { code: 'PINK_RIDE_WOMEN_ONLY' });
    }
  }
  return settings;
};
