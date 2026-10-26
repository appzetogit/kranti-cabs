/**
 * Hourly cab rentals - "1 hr / 10 km", "half day / 4 hr / 40 km" and so on.
 *
 * Packages are ordinary package prices (SetPrice, pricing_scope 'package')
 * marked package_kind 'hourly_rental', so the admin edits them on the existing
 * Package Pricing screens. Each vehicle row carries:
 *   base_price      what the package costs
 *   free_distance   kilometres included
 *   free_time       minutes included
 *   distance_price  per kilometre beyond free_distance
 *   time_price      per minute beyond free_time
 *
 * The rider's app only ever picks a package and a vehicle; the price is read
 * here, at booking, and locked onto the ride, so a stale or tampered app
 * cannot book below the admin's price. Usage beyond the package is billed by
 * the server when the trip completes, from the trip clock and the driver's
 * recorded GPS trail.
 */
import mongoose from 'mongoose';
import { ApiError } from '../../../utils/ApiError.js';
import { SetPrice } from '../admin/models/SetPrice.js';
import { Vehicle } from '../admin/models/Vehicle.js';
import { DriverLocationHistory } from '../driver/models/DriverLocationHistory.js';

export const HOURLY_RENTAL_PACKAGE_KIND = 'hourly_rental';

const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;
const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const activePackageFilter = () => ({
  pricing_scope: 'package',
  package_kind: HOURLY_RENTAL_PACKAGE_KIND,
  active: 1,
  status: 'active',
  package_availability: 'available',
});

const formatPackageLabel = (minutes, km) => {
  const hours = minutes / 60;
  const hoursLabel = Number.isInteger(hours) ? `${hours}` : hours.toFixed(1);
  return `${hoursLabel} ${hours === 1 ? 'Hour' : 'Hours'} / ${km} KM`;
};

const serializeVehicleRow = (row) => {
  const vehicle = row.vehicle_type || {};
  return {
    vehicleTypeId: vehicle._id ? String(vehicle._id) : '',
    vehicleName: vehicle.name || 'Vehicle',
    category: vehicle.category || '',
    capacity: toNumber(vehicle.capacity),
    icon: vehicle.image || vehicle.map_icon || vehicle.icon || '',
    iconType: vehicle.icon_types || vehicle.category || vehicle.name || '',
    price: roundMoney(row.base_price),
    includedKm: toNumber(row.free_distance),
    includedMinutes: toNumber(row.free_time),
    extraKmRate: roundMoney(row.distance_price),
    extraMinuteRate: roundMoney(row.time_price),
    cancellationFee: roundMoney(row.cancellation_fee),
  };
};

/// Packages bookable from a pickup in `serviceLocationId`. A package priced
/// for that city wins over a nationwide one (no service location) of the same
/// package type, so a city can be priced differently from the default.
export const listHourlyRentalPackages = async ({ serviceLocationId } = {}) => {
  const locationIds = [null];
  if (serviceLocationId && mongoose.Types.ObjectId.isValid(serviceLocationId)) {
    locationIds.push(new mongoose.Types.ObjectId(serviceLocationId));
  }

  const items = await SetPrice.find({
    ...activePackageFilter(),
    service_location_id: { $in: locationIds },
  })
    .populate('package_type_id', 'name short_description description status active')
    .populate('package_vehicle_prices.vehicle_type', 'name category capacity icon map_icon image icon_types active status rental_enabled')
    .lean();

  const byPackageType = new Map();
  for (const item of items) {
    const packageType = item.package_type_id;
    if (packageType && (packageType.status === 'inactive' || packageType.active === false)) continue;

    const key = packageType?._id ? String(packageType._id) : String(item._id);
    const isCitySpecific = Boolean(item.service_location_id);
    const existing = byPackageType.get(key);
    if (existing && (existing.isCitySpecific || !isCitySpecific)) continue;

    const vehicles = (item.package_vehicle_prices || [])
      // Vehicle types switched off for rentals are left out of every package.
      .filter((row) => row?.vehicle_type && Number(row.active ?? 1) === 1
        && row.vehicle_type.active !== false && row.vehicle_type.rental_enabled !== false)
      .map(serializeVehicleRow)
      .filter((row) => row.vehicleTypeId)
      .sort((a, b) => a.price - b.price);
    if (!vehicles.length) continue;

    const includedMinutes = vehicles[0].includedMinutes;
    const includedKm = vehicles[0].includedKm;

    byPackageType.set(key, {
      isCitySpecific,
      value: {
        id: String(item._id),
        packageTypeId: packageType?._id ? String(packageType._id) : '',
        name: packageType?.name || formatPackageLabel(includedMinutes, includedKm),
        description: packageType?.short_description || '',
        includedMinutes,
        includedKm,
        startingPrice: vehicles[0].price,
        vehicles,
      },
    });
  }

  return [...byPackageType.values()]
    .map((entry) => entry.value)
    .sort((a, b) => a.includedMinutes - b.includedMinutes || a.includedKm - b.includedKm);
};

/// The terms a rental is booked on, read from the admin's price - never from
/// the app. Throws if the package or that vehicle in it is no longer offered.
export const resolveHourlyRentalQuote = async ({ packagePriceId, vehicleTypeId }) => {
  if (!packagePriceId || !mongoose.Types.ObjectId.isValid(String(packagePriceId))) {
    throw new ApiError(400, 'A rental package is required');
  }

  const item = await SetPrice.findOne({ _id: packagePriceId, ...activePackageFilter() })
    .populate('package_type_id', 'name')
    .lean();
  if (!item) {
    throw new ApiError(404, 'This rental package is no longer available');
  }

  const row = (item.package_vehicle_prices || []).find(
    (entry) => String(entry?.vehicle_type || '') === String(vehicleTypeId || '') && Number(entry.active ?? 1) === 1,
  );
  if (!row) {
    throw new ApiError(400, 'This vehicle is not offered for the selected rental package');
  }
  const vehicle = await Vehicle.findById(row.vehicle_type).select('rental_enabled').lean();
  if (vehicle?.rental_enabled === false) {
    throw new ApiError(400, 'This vehicle is not offered for rentals right now', { code: 'RENTAL_VEHICLE_DISABLED' });
  }

  const includedMinutes = Math.max(0, toNumber(row.free_time));
  const includedKm = Math.max(0, toNumber(row.free_distance));

  return {
    packagePriceId: item._id,
    packageTypeId: item.package_type_id?._id || null,
    packageName: item.package_type_id?.name || formatPackageLabel(includedMinutes, includedKm),
    packagePrice: Math.max(0, roundMoney(row.base_price)),
    includedKm,
    includedMinutes,
    extraKmRate: Math.max(0, roundMoney(row.distance_price)),
    extraMinuteRate: Math.max(0, roundMoney(row.time_price)),
    commission: {
      admin_commission_type_from_driver: Number(row.admin_commission_type_from_driver ?? 1),
      admin_commission_from_driver: Number(row.admin_commission_from_driver ?? 0),
      admin_commission_type_for_owner: Number(row.admin_commission_type_for_owner ?? 1),
      admin_commission_for_owner: Number(row.admin_commission_for_owner ?? 0),
    },
  };
};

const EARTH_RADIUS_METERS = 6371000;
const toRadians = (value) => Number(value || 0) * (Math.PI / 180);
const haversineMeters = ([lng1, lat1], [lng2, lat2]) => {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};
// A hop implying more than this is a GPS jump, not driving, and is skipped
// rather than billed to the rider.
const MAX_PLAUSIBLE_SPEED_MPS = 50; // 180 km/h

/// Kilometres the driver covered between starting and ending the trip, summed
/// from the throttled location trail the live-tracking socket already stores.
export const measureRideTravelledMeters = async ({ rideId, driverId, from, to }) => {
  if (!rideId || !from || !to) return 0;

  const points = await DriverLocationHistory.find({
    rideId,
    ...(driverId ? { driverId } : {}),
    createdAt: { $gte: new Date(from), $lte: new Date(to) },
  })
    .select('location createdAt')
    .sort({ createdAt: 1 })
    .lean();

  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const a = previous.location?.coordinates;
    const b = current.location?.coordinates;
    if (!Array.isArray(a) || !Array.isArray(b)) continue;

    const meters = haversineMeters(a, b);
    const seconds = Math.max(1, (new Date(current.createdAt) - new Date(previous.createdAt)) / 1000);
    if (!Number.isFinite(meters) || meters / seconds > MAX_PLAUSIBLE_SPEED_MPS) continue;
    total += meters;
  }

  return total;
};

/// Bills kilometres and minutes beyond the package, once, as the trip
/// completes. Only whole kilometres and whole minutes over are charged, so a
/// part is never rounded up against the rider. Must run before the ride is
/// saved: wallet settlement reads ride.fare.
export const applyHourlyRentalCharges = async (ride) => {
  if (!ride || ride.serviceType !== 'hourly_rental' || !ride.rental) return;
  if (ride.rental.settledAt) return;

  const endedAt = ride.completedAt || new Date();
  const startedAt = ride.startedAt || endedAt;
  const usedMinutes = Math.max(0, Math.floor((new Date(endedAt) - new Date(startedAt)) / 60000));
  const travelledMeters = await measureRideTravelledMeters({
    rideId: ride._id,
    driverId: ride.driverId,
    from: startedAt,
    to: endedAt,
  }).catch(() => 0);
  const travelledKm = Math.round((travelledMeters / 1000) * 10) / 10;

  const extraKm = Math.max(0, Math.floor(travelledKm - toNumber(ride.rental.includedKm)));
  const extraMinutes = Math.max(0, usedMinutes - toNumber(ride.rental.includedMinutes));
  const extraKmCharge = roundMoney(extraKm * toNumber(ride.rental.extraKmRate));
  const extraTimeCharge = roundMoney(extraMinutes * toNumber(ride.rental.extraMinuteRate));

  ride.rental.travelledKm = travelledKm;
  ride.rental.usedMinutes = usedMinutes;
  ride.rental.extraKm = extraKm;
  ride.rental.extraMinutes = extraMinutes;
  ride.rental.extraKmCharge = extraKmCharge;
  ride.rental.extraTimeCharge = extraTimeCharge;
  ride.rental.settledAt = new Date();
  ride.fare = roundMoney(Number(ride.fare || 0) + extraKmCharge + extraTimeCharge);
};

/// Whether a driver may be sent and take hourly rentals: they accept them
/// (their app toggle) and admin has not blocked them. Their vehicle type
/// being rental-enabled is enforced by the package itself.
export const driverTakesRentals = (driver) =>
  driver?.rental?.accepts !== false && driver?.rental?.blockedByAdmin !== true;

export const serializeRideRental = (rental) => {
  if (!rental || !rental.packagePriceId) return null;
  return {
    packagePriceId: String(rental.packagePriceId),
    packageName: rental.packageName || '',
    packagePrice: toNumber(rental.packagePrice),
    includedKm: toNumber(rental.includedKm),
    includedMinutes: toNumber(rental.includedMinutes),
    extraKmRate: toNumber(rental.extraKmRate),
    extraMinuteRate: toNumber(rental.extraMinuteRate),
    travelledKm: toNumber(rental.travelledKm),
    usedMinutes: toNumber(rental.usedMinutes),
    extraKm: toNumber(rental.extraKm),
    extraMinutes: toNumber(rental.extraMinutes),
    extraKmCharge: toNumber(rental.extraKmCharge),
    extraTimeCharge: toNumber(rental.extraTimeCharge),
    settledAt: rental.settledAt || null,
  };
};
