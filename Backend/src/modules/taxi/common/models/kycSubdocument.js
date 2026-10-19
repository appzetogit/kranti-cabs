import mongoose from 'mongoose';

// Identity check through QuickeKYC, shared by riders (User.kyc) and drivers
// (Driver.kyc) - see services/userKycService.js. The full document number is
// never stored: only its last four digits and a salted hash, the hash so one
// Aadhaar / PAN cannot verify two accounts of the same kind.
export const createKycSubdocument = () => ({
  status: {
    type: String,
    enum: ['not_started', 'otp_sent', 'verified', 'failed', 'needs_review', 'rejected'],
    default: 'not_started',
  },
  documentType: {
    type: String,
    enum: ['', 'aadhaar', 'pan', 'driving_license', 'voter_id'],
    default: '',
  },
  maskedNumber: { type: String, default: '', trim: true },
  numberHash: { type: String, default: '', index: true },
  verifiedName: { type: String, default: '', trim: true },
  dob: { type: String, default: '', trim: true },
  gender: { type: String, default: '', trim: true },
  provider: { type: String, default: '', trim: true },
  providerRef: { type: String, default: '', trim: true },
  pendingRequestId: { type: String, default: '' },
  pendingRequestAt: { type: Date, default: null },
  pendingNumberHash: { type: String, default: '' },
  pendingMaskedNumber: { type: String, default: '' },
  reviewReason: { type: String, default: '', trim: true },
  failureReason: { type: String, default: '', trim: true },
  attempts: { type: Number, default: 0 },
  lastAttemptAt: { type: Date, default: null },
  verifiedAt: { type: Date, default: null },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiAdmin', default: null },
  reviewedAt: { type: Date, default: null },
});
