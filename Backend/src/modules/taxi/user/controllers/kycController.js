import {
  getPublicKycConfig,
  getUserKycStatus,
  startAadhaarVerification,
  submitAadhaarOtp,
  verifyUserDocument,
} from '../../services/userKycService.js';

export const getKycConfig = async (_req, res) => {
  res.json({ success: true, data: await getPublicKycConfig() });
};

export const getMyKycStatus = async (req, res) => {
  res.json({ success: true, data: await getUserKycStatus(req.auth.sub) });
};

export const requestAadhaarOtp = async (req, res) => {
  const data = await startAadhaarVerification({
    userId: req.auth.sub,
    aadhaarNumber: req.body?.aadhaarNumber,
  });
  res.json({ success: true, data });
};

export const verifyAadhaarOtp = async (req, res) => {
  const data = await submitAadhaarOtp({ userId: req.auth.sub, otp: req.body?.otp });
  res.json({ success: true, data });
};

export const verifyKycDocument = async (req, res) => {
  const data = await verifyUserDocument({
    userId: req.auth.sub,
    documentType: String(req.body?.documentType || '').trim().toLowerCase(),
    number: req.body?.number,
    dob: req.body?.dob,
  });
  res.json({ success: true, data });
};
