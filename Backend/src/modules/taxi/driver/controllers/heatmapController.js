import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { getHeatmapZones } from '../../heatmap/heatmapService.js';

/**
 * Aggregated ride demand around the driver.
 *
 * Authenticated as a driver through the existing middleware. The response
 * carries geography and counts only — never a rider, never another driver's
 * position.
 */
export const getDriverHeatmap = asyncHandler(async (req, res) => {
  const result = await getHeatmapZones({
    lat: req.query.lat ?? req.query.latitude,
    lng: req.query.lng ?? req.query.longitude,
    radiusKm: req.query.radius,
    resolutionMeters: req.query.resolution,
  });

  res.json({ success: true, ...result });
});
