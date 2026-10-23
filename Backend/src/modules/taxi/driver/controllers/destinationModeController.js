import { asyncHandler } from '../../../../utils/asyncHandler.js';
import {
  disableDestinationMode,
  enableDestinationMode,
  getDestinationModeForDriver,
  setDriverHomeLocation,
} from '../../services/destinationModeService.js';

/**
 * Destination mode ("Go Home") and the driver's saved home, for the driver
 * apps. See services/destinationModeService.js for the matching rules.
 */

const ok = (res, data) => res.json({ success: true, data });

/// GET /drivers/me/destination
export const getMyDestinationMode = asyncHandler(async (req, res) => {
  ok(res, await getDestinationModeForDriver(req.auth.sub));
});

/// PUT /drivers/me/destination  { enabled, useHome?, lat?, lng?, label? }
export const updateMyDestinationMode = asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (body.enabled === false || body.enabled === 'false') {
    return ok(res, await disableDestinationMode(req.auth.sub));
  }
  ok(res, await enableDestinationMode(req.auth.sub, {
    useHome: body.useHome === true || body.useHome === 'true',
    lat: body.lat,
    lng: body.lng,
    label: body.label,
  }));
});

/// PUT /drivers/me/home-location  { lat, lng, address }
export const updateMyHomeLocation = asyncHandler(async (req, res) => {
  const body = req.body || {};
  ok(res, await setDriverHomeLocation(req.auth.sub, { lat: body.lat, lng: body.lng, address: body.address }));
});
