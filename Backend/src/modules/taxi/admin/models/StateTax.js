import mongoose from 'mongoose';

// A tax a commercial vehicle pays to enter a state (state / interstate permit
// tax) or Delhi (MCD tax). See services/stateTaxService.js for when it is
// charged.
const stateTaxSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    tax_type: {
      type: String,
      enum: ['state_tax', 'mcd_tax'],
      default: 'state_tax',
    },
    // The state as Google names it ("Rajasthan", "Delhi"), matched without
    // case. The two-letter code ("RJ", "DL") matches too.
    state: {
      type: String,
      required: true,
      trim: true,
    },
    // Per vehicle class; 0 means that class is not charged.
    fees: {
      bike: { type: Number, default: 0, min: 0 },
      auto: { type: Number, default: 0, min: 0 },
      car: { type: Number, default: 0, min: 0 },
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

stateTaxSchema.index({ active: 1 });

export const StateTax = mongoose.models.TaxiStateTax || mongoose.model('TaxiStateTax', stateTaxSchema);
