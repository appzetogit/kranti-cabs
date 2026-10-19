// Rider identity verification (QuickeKYC) states, as stored on User.kyc.status.
export const KYC_STATUS_META = {
  not_started: { label: 'Not verified', className: 'bg-gray-100 text-gray-600' },
  otp_sent: { label: 'OTP sent', className: 'bg-sky-50 text-sky-700' },
  verified: { label: 'Verified', className: 'bg-emerald-50 text-emerald-700' },
  needs_review: { label: 'Needs review', className: 'bg-amber-50 text-amber-700' },
  failed: { label: 'Failed', className: 'bg-rose-50 text-rose-600' },
  rejected: { label: 'Rejected', className: 'bg-rose-100 text-rose-700' },
};

export const KYC_DOCUMENT_LABELS = {
  aadhaar: 'Aadhaar',
  pan: 'PAN',
  driving_license: 'Driving Licence',
  voter_id: 'Voter ID',
};
