import mongoose from 'mongoose';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { RideAcceptAttempt } from '../../driver/models/RideAcceptAttempt.js';
import { Driver } from '../../driver/models/Driver.js';

/**
 * Ride-accept speed per driver, for reviewing possible auto clicker use.
 *
 * Built from the RideAcceptAttempt log. A driver is flagged for review - never
 * blocked - when most of their accepts land faster than a person reacts, or
 * when they keep hitting the accept rate limit or accepting rides they were
 * not offered. reactionMs includes network delay, so a fast figure is a
 * conservative one.
 */

const ok = (res, data) => res.json({ success: true, data });

const clampNumber = (value, fallback, min, max) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

export const getAcceptSpeedReview = asyncHandler(async (req, res) => {
  const days = clampNumber(req.query.days, 7, 1, 30);
  const fastMs = clampNumber(req.query.fastMs, 400, 50, 5000);
  const minAccepts = clampNumber(req.query.minAccepts, 5, 1, 1000);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await RideAcceptAttempt.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: '$driverId',
        attempts: { $sum: 1 },
        accepts: { $sum: { $cond: [{ $eq: ['$result', 'accepted'] }, 1, 0] } },
        fastAccepts: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ['$result', 'accepted'] }, { $ne: ['$reactionMs', null] }, { $lt: ['$reactionMs', fastMs] }] },
              1,
              0,
            ],
          },
        },
        timedReactions: {
          $push: { $cond: [{ $and: [{ $eq: ['$result', 'accepted'] }, { $ne: ['$reactionMs', null] }] }, '$reactionMs', '$$REMOVE'] },
        },
        lost: { $sum: { $cond: [{ $eq: ['$result', 'lost'] }, 1, 0] } },
        rateLimited: { $sum: { $cond: [{ $eq: ['$result', 'rate_limited'] }, 1, 0] } },
        notOffered: { $sum: { $cond: [{ $eq: ['$result', 'not_offered'] }, 1, 0] } },
        lastAttemptAt: { $max: '$createdAt' },
      },
    },
  ]);

  const drivers = await Driver.find({ _id: { $in: rows.map((row) => row._id) } })
    .select('name phone countryCode')
    .lean();
  const driverById = new Map(drivers.map((driver) => [String(driver._id), driver]));

  const results = rows.map((row) => {
    const reactions = [...row.timedReactions].sort((a, b) => a - b);
    const median = reactions.length ? reactions[Math.floor((reactions.length - 1) / 2)] : null;
    const fastShare = row.accepts ? row.fastAccepts / row.accepts : 0;
    const reasons = [];
    if (row.accepts >= minAccepts && fastShare >= 0.5) {
      reasons.push(`${Math.round(fastShare * 100)}% of accepts under ${fastMs} ms`);
    }
    if (row.rateLimited >= 3) reasons.push(`hit the accept rate limit ${row.rateLimited} times`);
    if (row.notOffered >= 3) reasons.push(`tried ${row.notOffered} rides not offered to them`);

    const driver = driverById.get(String(row._id)) || {};
    return {
      driverId: String(row._id),
      name: driver.name || '',
      phone: driver.phone ? `${driver.countryCode || ''}${driver.phone}` : '',
      attempts: row.attempts,
      accepts: row.accepts,
      fastAccepts: row.fastAccepts,
      fastShare: Math.round(fastShare * 1000) / 1000,
      medianReactionMs: median,
      fastestReactionMs: reactions.length ? reactions[0] : null,
      lost: row.lost,
      rateLimited: row.rateLimited,
      notOffered: row.notOffered,
      lastAttemptAt: row.lastAttemptAt,
      flagged: reasons.length > 0,
      reasons,
    };
  });

  results.sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.fastShare - a.fastShare || b.attempts - a.attempts);

  ok(res, { days, fastMs, minAccepts, results: results.slice(0, 300) });
});

/** One driver's recent attempts, newest first, for the detail view. */
export const getDriverAcceptAttempts = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.driverId)) return ok(res, { results: [] });
  const rows = await RideAcceptAttempt.find({ driverId: req.params.driverId })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  ok(res, {
    results: rows.map((row) => ({
      rideId: row.rideId ? String(row.rideId) : null,
      channel: row.channel,
      result: row.result,
      reactionMs: row.reactionMs,
      at: row.createdAt,
    })),
  });
});
