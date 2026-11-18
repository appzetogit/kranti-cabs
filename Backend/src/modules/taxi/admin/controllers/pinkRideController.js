import mongoose from 'mongoose';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { ApiError } from '../../../../utils/ApiError.js';
import { Driver } from '../../driver/models/Driver.js';
import {
  driverTakesPinkRides,
  getPinkRideSettings,
  isFemale,
  pinkRideAvailability,
  updatePinkRideSettings,
} from '../../services/pinkRideService.js';

/**
 * Pink Ride endpoints - admin settings and driver approval, the rider's
 * "is it offered here" check, and the driver's own "Pink Rides only" switch.
 * See services/pinkRideService.js for how it works.
 */

const ok = (res, data) => res.json({ success: true, data });
const truthy = (value) => ['true', '1', 1, true].includes(value);

const presentDriver = (driver) => ({
  id: String(driver._id),
  name: driver.name || '',
  phone: driver.phone || '',
  gender: driver.gender || '',
  is_female: isFemale(driver.gender),
  vehicle_type: driver.vehicleType || '',
  vehicle_number: driver.vehicleNumber || '',
  is_online: Boolean(driver.isOnline),
  approved: Boolean(driver.pinkRide?.approved),
  approved_at: driver.pinkRide?.approvedAt || null,
  only_pink: Boolean(driver.pinkRide?.onlyPink),
  receives_pink_rides: driverTakesPinkRides(driver),
});

const DRIVER_SELECT = 'name phone gender vehicleType vehicleNumber isOnline pinkRide';

/// GET /admin/pink-ride/settings
export const getPinkRideSettingsAdmin = asyncHandler(async (_req, res) => {
  ok(res, await getPinkRideSettings());
});

/// PUT /admin/pink-ride/settings
export const updatePinkRideSettingsAdmin = asyncHandler(async (req, res) => {
  ok(res, await updatePinkRideSettings(req.body || {}));
});

/// GET /admin/pink-ride/drivers?search=&approved=true
/// Women drivers (and any already approved), for the approve list.
export const listPinkRideDrivers = asyncHandler(async (req, res) => {
  const search = String(req.query.search || '').trim().slice(0, 60);
  const filter = {
    deletedAt: null,
    $or: [{ gender: { $regex: /^f/i } }, { 'pinkRide.approved': true }],
  };
  if (truthy(req.query.approved)) filter['pinkRide.approved'] = true;
  if (search) {
    const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$and = [{ $or: [{ name: regex }, { phone: regex }, { vehicleNumber: regex }] }];
  }
  const rows = await Driver.find(filter).select(DRIVER_SELECT).sort({ 'pinkRide.approved': -1, name: 1 }).limit(500).lean();
  ok(res, { results: rows.map(presentDriver) });
});

/// PATCH /admin/drivers/:id/pink-ride  { approved }
/// Only a woman driver can be approved; removing approval also clears her
/// "Pink Rides only" choice so she is offered normal rides again.
export const updateDriverPinkRide = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Driver not found');
  const driver = await Driver.findById(req.params.id).select(DRIVER_SELECT).lean();
  if (!driver) throw new ApiError(404, 'Driver not found');
  const approved = truthy(req.body?.approved);
  if (approved && !isFemale(driver.gender)) {
    throw new ApiError(400, "Only women drivers can be approved for Pink Ride. Set the driver's gender to Female first.");
  }
  const set = approved
    ? { 'pinkRide.approved': true, 'pinkRide.approvedAt': new Date(), 'pinkRide.approvedBy': req.auth?.sub && mongoose.isValidObjectId(req.auth.sub) ? req.auth.sub : null }
    : { 'pinkRide.approved': false, 'pinkRide.approvedAt': null, 'pinkRide.approvedBy': null, 'pinkRide.onlyPink': false };
  const updated = await Driver.findByIdAndUpdate(req.params.id, { $set: set }, { returnDocument: 'after' })
    .select(DRIVER_SELECT)
    .lean();
  ok(res, presentDriver(updated));
});

/// GET /users/pink-ride?at=lat,lng - whether the rider can pick Pink Ride here.
export const getPinkRideForRider = asyncHandler(async (req, res) => {
  const [lat, lng] = String(req.query.at || `${req.query.lat || ''},${req.query.lng || ''}`).split(',').map(Number);
  const point = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lng, lat] : null;
  ok(res, await pinkRideAvailability({ point }));
});

const presentPreference = async (driver) => {
  const settings = await getPinkRideSettings();
  return {
    enabled: Boolean(settings.enabled),
    approved: Boolean(driver?.pinkRide?.approved),
    only_pink: Boolean(driver?.pinkRide?.onlyPink),
    receives_pink_rides: Boolean(settings.enabled) && driverTakesPinkRides(driver),
  };
};

/// GET /drivers/me/pink-ride
export const getMyPinkRidePreference = asyncHandler(async (req, res) => {
  const driver = await Driver.findById(req.auth.sub).select('gender pinkRide').lean();
  if (!driver) throw new ApiError(404, 'Driver not found');
  ok(res, await presentPreference(driver));
});

/// PUT /drivers/me/pink-ride  { only_pink }
export const updateMyPinkRidePreference = asyncHandler(async (req, res) => {
  const current = await Driver.findById(req.auth.sub).select('gender pinkRide').lean();
  if (!current) throw new ApiError(404, 'Driver not found');
  const onlyPink = truthy(req.body?.only_pink ?? req.body?.onlyPink);
  if (onlyPink && !driverTakesPinkRides(current)) {
    throw new ApiError(403, 'You are not approved for Pink Ride yet. Contact support.');
  }
  const driver = await Driver.findByIdAndUpdate(
    req.auth.sub,
    { $set: { 'pinkRide.onlyPink': onlyPink } },
    { returnDocument: 'after' },
  ).select('gender pinkRide').lean();
  ok(res, await presentPreference(driver));
});
