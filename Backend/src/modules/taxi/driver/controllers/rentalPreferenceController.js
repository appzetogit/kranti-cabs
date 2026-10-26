import mongoose from 'mongoose';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { ApiError } from '../../../../utils/ApiError.js';
import { Driver } from '../models/Driver.js';
import { Vehicle } from '../../admin/models/Vehicle.js';

/**
 * Hourly rentals per driver: their own "Accept rental trips" toggle and the
 * admin's override. Dispatch sends rental requests only to drivers who
 * accept them, are not blocked, and drive a rental-enabled vehicle type.
 */

const ok = (res, data) => res.json({ success: true, data });

const vehicleRentalEnabled = async (driver) => {
  const ids = [driver?.vehicleTypeId, ...(driver?.vehicleTypeIds || [])].filter(Boolean);
  if (!ids.length) return false;
  return Boolean(await Vehicle.exists({ _id: { $in: ids }, rental_enabled: { $ne: false } }));
};

const present = async (driver) => {
  const accepts = driver?.rental?.accepts !== false;
  const blockedByAdmin = driver?.rental?.blockedByAdmin === true;
  const vehicleEnabled = await vehicleRentalEnabled(driver);
  return {
    accepts,
    blockedByAdmin,
    vehicleRentalEnabled: vehicleEnabled,
    // Whether rental requests will actually reach this driver.
    receivesRentals: accepts && !blockedByAdmin && vehicleEnabled,
  };
};

const SELECT = 'rental vehicleTypeId vehicleTypeIds';

/// GET /drivers/me/rental-preference
export const getMyRentalPreference = asyncHandler(async (req, res) => {
  const driver = await Driver.findById(req.auth.sub).select(SELECT).lean();
  if (!driver) throw new ApiError(404, 'Driver not found');
  ok(res, await present(driver));
});

/// PUT /drivers/me/rental-preference  { accepts }
export const updateMyRentalPreference = asyncHandler(async (req, res) => {
  const accepts = !['false', '0', 0, false].includes(req.body?.accepts);
  const driver = await Driver.findByIdAndUpdate(
    req.auth.sub,
    { $set: { 'rental.accepts': accepts } },
    { returnDocument: 'after' },
  ).select(SELECT).lean();
  if (!driver) throw new ApiError(404, 'Driver not found');
  ok(res, await present(driver));
});

/// GET /admin/drivers/:id/rental-access
export const getDriverRentalAccess = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Driver not found');
  const driver = await Driver.findById(req.params.id).select(SELECT).lean();
  if (!driver) throw new ApiError(404, 'Driver not found');
  ok(res, await present(driver));
});

/// PATCH /admin/drivers/:id/rental-access  { blockedByAdmin }
export const updateDriverRentalAccess = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Driver not found');
  const blockedByAdmin = ['true', '1', 1, true].includes(req.body?.blockedByAdmin);
  const driver = await Driver.findByIdAndUpdate(
    req.params.id,
    { $set: { 'rental.blockedByAdmin': blockedByAdmin } },
    { returnDocument: 'after' },
  ).select(SELECT).lean();
  if (!driver) throw new ApiError(404, 'Driver not found');
  ok(res, await present(driver));
});
