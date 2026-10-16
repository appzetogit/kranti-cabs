import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { DriverSubscription } from '../models/DriverSubscription.js';
import {
  getDriverSubscriptionStatus,
  purchaseDriverSubscription,
} from '../services/driverSubscriptionService.js';

/** Active/expired, when it ends, and what the driver can buy. */
export const getMySubscription = asyncHandler(async (req, res) => {
  const data = await getDriverSubscriptionStatus(req.auth?.sub);
  res.json({ success: true, data });
});

export const buySubscription = asyncHandler(async (req, res) => {
  const { planId, paymentMethod } = req.body || {};
  const result = await purchaseDriverSubscription({
    driverId: req.auth?.sub,
    planId,
    paymentMethod,
  });

  // The driver's screen needs the new expiry immediately, so the fresh status
  // is returned with the purchase rather than making the app ask again.
  const status = await getDriverSubscriptionStatus(req.auth?.sub);

  res.json({ success: true, data: { ...result, status } });
});

/** What they have paid before, newest first. */
export const getMySubscriptionHistory = asyncHandler(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  const rows = await DriverSubscription.find({ driverId: req.auth?.sub, paidAt: { $ne: null } })
    .sort({ startsAt: -1 })
    .limit(limit)
    .lean();

  res.json({
    success: true,
    data: rows.map((row) => ({
      id: String(row._id),
      planName: row.planName,
      amount: row.amount,
      startsAt: row.startsAt,
      expiresAt: row.expiresAt,
      paymentMethod: row.paymentMethod,
      paidAt: row.paidAt,
      tripsCovered: row.tripsCovered,
      commissionWaived: row.commissionWaived,
    })),
  });
});
