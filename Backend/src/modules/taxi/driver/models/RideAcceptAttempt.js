import mongoose from 'mongoose';

// One row per ride-accept attempt, for spotting automated accepting (auto
// clickers). reactionMs is server time from the offer going out to the accept
// arriving, so it includes network delay and is never faster than reality.
// Kept 30 days.
const rideAcceptAttemptSchema = new mongoose.Schema(
  {
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiDriver', required: true },
    rideId: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiRide', default: null },
    channel: { type: String, enum: ['socket', 'rest'], default: 'socket' },
    result: {
      type: String,
      enum: ['accepted', 'retry', 'lost', 'not_offered', 'rate_limited', 'refused'],
      required: true,
    },
    offeredAt: { type: Date, default: null },
    reactionMs: { type: Number, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

rideAcceptAttemptSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
rideAcceptAttemptSchema.index({ driverId: 1, createdAt: -1 });

export const RideAcceptAttempt =
  mongoose.models.TaxiRideAcceptAttempt || mongoose.model('TaxiRideAcceptAttempt', rideAcceptAttemptSchema);
