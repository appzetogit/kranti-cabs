import {
  getUserKycStatus,
  startAadhaarVerification,
  submitAadhaarOtp,
  verifyUserDocument,
} from '../../services/userKycService.js';

// Driver identity verification (QuickeKYC). Same flow as riders, with the
// admin's driver rules; pending drivers can call these during onboarding.

export const getDriverKycStatus = async (req, res) => {
  res.json({ success: true, data: await getUserKycStatus(req.auth.sub, 'driver') });
};

export const requestDriverAadhaarOtp = async (req, res) => {
  const data = await startAadhaarVerification({
    userId: req.auth.sub,
    aadhaarNumber: req.body?.aadhaarNumber,
    subject: 'driver',
  });
  res.json({ success: true, data });
};

export const verifyDriverAadhaarOtp = async (req, res) => {
  const data = await submitAadhaarOtp({ userId: req.auth.sub, otp: req.body?.otp, subject: 'driver' });
  res.json({ success: true, data });
};

export const verifyDriverKycDocument = async (req, res) => {
  const data = await verifyUserDocument({
    userId: req.auth.sub,
    documentType: String(req.body?.documentType || '').trim().toLowerCase(),
    number: req.body?.number,
    dob: req.body?.dob,
    subject: 'driver',
  });
  res.json({ success: true, data });
};
