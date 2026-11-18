import mongoose from 'mongoose';

// Pink Ride: a ride only women drivers approved for it are offered. One
// settings row (scope 'default'); see services/pinkRideService.js.
const pinkRideSettingSchema = new mongoose.Schema(
  {
    scope: { type: String, default: 'default', unique: true },
    enabled: { type: Boolean, default: false },
    // Zones it is offered in. Empty = every zone.
    zone_ids: { type: [mongoose.Schema.Types.ObjectId], ref: 'TaxiZone', default: [] },
    // Vehicles it is offered on. Empty = every taxi vehicle.
    vehicle_type_ids: { type: [mongoose.Schema.Types.ObjectId], ref: 'TaxiVehicle', default: [] },
    // Added to the fare: a flat amount or a percentage of it. 0 = no charge.
    extra_fee_type: { type: String, enum: ['flat', 'percent'], default: 'flat' },
    extra_fee: { type: Number, default: 0, min: 0 },
    // 'women_only': the rider must be a woman. 'anyone': anyone may book one
    // (for a mother, a daughter...); the driver is a woman either way.
    who_can_book: { type: String, enum: ['women_only', 'anyone'], default: 'women_only' },
    // With women_only: the rider's gender must come from a verified KYC
    // (Aadhaar), not only from her profile.
    require_kyc: { type: Boolean, default: true },
    title: { type: String, default: 'Pink Ride', trim: true },
    subtitle: { type: String, default: 'Women drivers only, for women riders', trim: true },
  },
  { timestamps: true },
);

export const PinkRideSetting =
  mongoose.models.TaxiPinkRideSetting || mongoose.model('TaxiPinkRideSetting', pinkRideSettingSchema);
