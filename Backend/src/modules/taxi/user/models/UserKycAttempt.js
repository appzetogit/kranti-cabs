import mongoose from 'mongoose';

// One row per verification attempt, for support and abuse checks. Holds the
// masked number only - never the full Aadhaar / PAN.
const userKycAttemptSchema = new mongoose.Schema(
  {
    // The rider or driver id; subjectType says which.
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    subjectType: { type: String, enum: ['user', 'driver'], default: 'user', index: true },
    documentType: { type: String, default: '' },
    maskedNumber: { type: String, default: '' },
    step: { type: String, enum: ['otp_request', 'otp_submit', 'document', 'admin'], default: 'document' },
    outcome: { type: String, enum: ['sent', 'verified', 'failed', 'needs_review', 'rejected', 'reset', 'approved'], required: true },
    message: { type: String, default: '' },
    environment: { type: String, default: '' },
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiAdmin', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

userKycAttemptSchema.index({ userId: 1, createdAt: -1 });

export const UserKycAttempt =
  mongoose.models.TaxiUserKycAttempt || mongoose.model('TaxiUserKycAttempt', userKycAttemptSchema);
