import mongoose from 'mongoose';

const pointSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['Point'],
      required: true,
    },
    coordinates: {
      type: [Number],
      required: true,
    },
  },
  { _id: false },
);

const polygonSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['Polygon'],
      required: true,
    },
    coordinates: {
      type: [[[Number]]],
      required: true,
    },
  },
  { _id: false },
);

// Parking a hub charges, per vehicle class. See services/hubParkingService.js.
const parkingSlabSchema = new mongoose.Schema(
  {
    up_to_minutes: { type: Number, required: true, min: 1 },
    fee: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const parkingRuleSchema = new mongoose.Schema(
  {
    vehicle_class: {
      type: String,
      enum: ['all', 'bike', 'auto', 'car'],
      default: 'all',
    },
    drop_fee: { type: Number, default: 0, min: 0 },
    slabs: { type: [parkingSlabSchema], default: [] },
  },
  { _id: false },
);

// Airports and railway stations share this collection: both are a drawn area
// with a fee. Rows from before hub_type existed are airports.
const airportSchema = new mongoose.Schema(
  {
    hub_type: {
      type: String,
      enum: ['airport', 'railway_station'],
      default: 'airport',
    },
    parking: {
      enabled: { type: Boolean, default: false },
      max_minutes: { type: Number, default: 120, min: 1 },
      rules: { type: [parkingRuleSchema], default: [] },
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      default: '',
      trim: true,
      uppercase: true,
    },
    service_location_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiServiceLocation',
      default: null,
    },
    zone_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiZone',
      default: null,
    },
    terminal: {
      type: String,
      default: '',
      trim: true,
    },
    address: {
      type: String,
      default: '',
      trim: true,
    },
    contact_number: {
      type: String,
      default: '',
      trim: true,
    },
    latitude: {
      type: Number,
      default: null,
    },
    longitude: {
      type: Number,
      default: null,
    },
    location: {
      type: pointSchema,
      default: undefined,
    },
    boundary: {
      type: polygonSchema,
      default: undefined,
    },
    airport_surge: {
      type: Number,
      default: 0,
      min: 0,
    },
    support_airport_fee: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    active: {
      type: Boolean,
      default: true,
    },
    pickup_availability: {
      type: Boolean,
      default: true,
    },
    drop_availability: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

airportSchema.index({ name: 1 });
airportSchema.index({ hub_type: 1, status: 1 });
airportSchema.index({ code: 1 });
airportSchema.index({ service_location_id: 1, status: 1 });
airportSchema.index({ location: '2dsphere' });
airportSchema.index({ boundary: '2dsphere' });

export const Airport = mongoose.models.TaxiAirport || mongoose.model('TaxiAirport', airportSchema);
