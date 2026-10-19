/**
 * Rider identity verification (KYC) through QuickeKYC.
 *
 * Everything the admin controls lives in the third-party settings document
 * under `user_kyc`: the on/off switch, which documents a rider may use, when
 * verification is required, and the QuickeKYC credentials. With the switch off
 * nothing here blocks anyone.
 *
 * Aadhaar is a two-step OTP check; PAN, driving licence and voter ID are one
 * call. A verified name that does not match the rider's profile, or a
 * document already verified on another account, is parked as 'needs_review'
 * for an admin instead of being trusted.
 */
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { env } from '../../../config/env.js';
import { ApiError } from '../../../utils/ApiError.js';
import { AdminThirdPartySetting } from '../admin/models/AdminThirdPartySetting.js';
import { createDefaultThirdPartySettings } from '../admin/data/defaultThirdPartySettings.js';
import { User } from '../user/models/User.js';
import { UserKycAttempt } from '../user/models/UserKycAttempt.js';
import { createQuickEkycClient, KycProviderError, QUICKEKYC_DEFAULTS } from './quickEkycProvider.js';

export const KYC_DOCUMENTS = Object.freeze({
  aadhaar: { label: 'Aadhaar', flow: 'otp', hint: '12-digit Aadhaar number' },
  pan: { label: 'PAN', flow: 'instant', hint: '10-character PAN, e.g. ABCDE1234F' },
  driving_license: { label: 'Driving Licence', flow: 'instant', hint: 'Licence number and date of birth', needsDob: true },
  voter_id: { label: 'Voter ID', flow: 'instant', hint: 'EPIC number, e.g. ABC1234567' },
});

// When the rider must be verified:
//   optional          never blocks; shows a "Verified" badge once done
//   after_signup      the apps send the rider to KYC right after login, and
//                     bookings are blocked until verified
//   before_booking    blocks every booking until verified
//   rental_outstation blocks hourly rental and intercity bookings only
export const KYC_REQUIREMENT_MODES = ['optional', 'after_signup', 'before_booking', 'rental_outstation'];

export const DEFAULT_USER_KYC_SETTINGS = Object.freeze({
  enabled: false,
  required_for: 'before_booking',
  allowed_documents: ['aadhaar', 'pan', 'driving_license', 'voter_id'],
  // 'review' parks a name mismatch for an admin; 'ignore' accepts it.
  name_mismatch: 'review',
  max_attempts_per_day: 5,
  otp_expiry_minutes: 10,
  provider: { ...QUICKEKYC_DEFAULTS, endpoints: { ...QUICKEKYC_DEFAULTS.endpoints } },
});

const MASK = '••••••••';

const toBool = (value) => value === true || value === 1 || ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());

const normalizeSettings = (raw = {}) => {
  const providerRaw = raw.provider || {};
  const allowed = Array.isArray(raw.allowed_documents)
    ? raw.allowed_documents.filter((type) => KYC_DOCUMENTS[type])
    : DEFAULT_USER_KYC_SETTINGS.allowed_documents;

  return {
    enabled: toBool(raw.enabled ?? DEFAULT_USER_KYC_SETTINGS.enabled),
    required_for: KYC_REQUIREMENT_MODES.includes(raw.required_for) ? raw.required_for : DEFAULT_USER_KYC_SETTINGS.required_for,
    allowed_documents: [...new Set(allowed)],
    name_mismatch: raw.name_mismatch === 'ignore' ? 'ignore' : 'review',
    max_attempts_per_day: Math.min(50, Math.max(1, Number(raw.max_attempts_per_day) || DEFAULT_USER_KYC_SETTINGS.max_attempts_per_day)),
    otp_expiry_minutes: Math.min(30, Math.max(2, Number(raw.otp_expiry_minutes) || DEFAULT_USER_KYC_SETTINGS.otp_expiry_minutes)),
    provider: {
      environment: ['mock', 'sandbox', 'live'].includes(providerRaw.environment) ? providerRaw.environment : QUICKEKYC_DEFAULTS.environment,
      base_url: String(providerRaw.base_url || QUICKEKYC_DEFAULTS.base_url).trim(),
      api_key: String(providerRaw.api_key || '').trim(),
      auth_mode: providerRaw.auth_mode === 'header' ? 'header' : 'body',
      auth_field: String(providerRaw.auth_field || QUICKEKYC_DEFAULTS.auth_field).trim(),
      auth_prefix: String(providerRaw.auth_prefix ?? QUICKEKYC_DEFAULTS.auth_prefix).trim(),
      timeout_ms: Math.min(60000, Math.max(3000, Number(providerRaw.timeout_ms) || QUICKEKYC_DEFAULTS.timeout_ms)),
      endpoints: Object.fromEntries(
        Object.entries(QUICKEKYC_DEFAULTS.endpoints).map(([key, fallback]) => [
          key,
          String(providerRaw.endpoints?.[key] || fallback).trim(),
        ]),
      ),
    },
  };
};

const loadSettingsDoc = async () => {
  let doc = await AdminThirdPartySetting.findOne({ scope: 'default' });
  if (!doc) doc = await AdminThirdPartySetting.create(createDefaultThirdPartySettings());
  return doc;
};

export const getUserKycSettings = async () => {
  const doc = await AdminThirdPartySetting.findOne({ scope: 'default' }).select('user_kyc').lean();
  return normalizeSettings(doc?.user_kyc || {});
};

const maskKey = (key) => (key ? `${MASK}${key.slice(-4)}` : '');

/// Admin view: the API key is masked, never sent back in full.
export const getUserKycSettingsForAdmin = async () => {
  const settings = await getUserKycSettings();
  return {
    settings: { ...settings, provider: { ...settings.provider, api_key: maskKey(settings.provider.api_key) } },
    metadata: {
      documents: KYC_DOCUMENTS,
      requirement_modes: KYC_REQUIREMENT_MODES,
      api_key_configured: Boolean(settings.provider.api_key),
    },
  };
};

export const updateUserKycSettings = async (payload = {}) => {
  const doc = await loadSettingsDoc();
  const current = normalizeSettings(doc.user_kyc || {});
  const incomingProvider = payload.provider || {};
  // A masked or blank key in the form means "keep the saved one".
  const incomingKey = String(incomingProvider.api_key ?? '').trim();
  const apiKey = !incomingKey || incomingKey.startsWith(MASK) ? current.provider.api_key : incomingKey;

  const next = normalizeSettings({
    ...current,
    ...payload,
    provider: {
      ...current.provider,
      ...incomingProvider,
      api_key: apiKey,
      endpoints: { ...current.provider.endpoints, ...(incomingProvider.endpoints || {}) },
    },
  });

  if (next.enabled && !next.allowed_documents.length) {
    throw new ApiError(400, 'Choose at least one document riders can verify with');
  }
  if (next.enabled && next.provider.environment !== 'mock' && !next.provider.api_key) {
    throw new ApiError(400, 'Add the QuickeKYC API key before switching verification on');
  }

  doc.user_kyc = next;
  doc.markModified('user_kyc');
  await doc.save();
  return getUserKycSettingsForAdmin();
};

/// Checks the saved configuration without spending a paid verification.
export const testUserKycConnection = async () => {
  const settings = await getUserKycSettings();
  const { provider } = settings;
  if (provider.environment === 'mock') {
    return { ok: true, message: `Mock mode: no calls are made. Aadhaar OTP is 123456.` };
  }
  if (!provider.api_key) return { ok: false, message: 'API key is missing' };

  try {
    const url = new URL(provider.base_url);
    await fetch(url.origin, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    return { ok: true, message: `Reached ${url.host}. Credentials are checked on the first real verification.` };
  } catch {
    return { ok: false, message: `Could not reach ${provider.base_url}` };
  }
};

/// What the apps need to render the KYC screen. No secrets.
export const getPublicKycConfig = async () => {
  const settings = await getUserKycSettings();
  return {
    enabled: settings.enabled,
    requiredFor: settings.required_for,
    documents: settings.allowed_documents.map((type) => ({ type, ...KYC_DOCUMENTS[type] })),
    otpExpiryMinutes: settings.otp_expiry_minutes,
    mockMode: settings.provider.environment === 'mock',
  };
};

// ---- document numbers -----------------------------------------------------

// Verhoeff checksum, which every valid Aadhaar number satisfies.
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
export const isValidAadhaar = (value) => {
  if (!/^[2-9][0-9]{11}$/.test(value)) return false;
  let check = 0;
  [...value].reverse().forEach((digit, index) => {
    check = VERHOEFF_D[check][VERHOEFF_P[index % 8][Number(digit)]];
  });
  return check === 0;
};

const DOCUMENT_PATTERNS = {
  pan: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
  voter_id: /^[A-Z]{3}[0-9]{7}$/,
  driving_license: /^[A-Z]{2}[0-9]{2}[0-9A-Z]{9,14}$/,
};

export const normalizeDocumentNumber = (type, raw) => {
  const value = String(raw || '').toUpperCase().replace(/[\s-]/g, '');
  if (type === 'aadhaar') {
    if (!isValidAadhaar(value)) throw new ApiError(400, 'Enter a valid 12-digit Aadhaar number');
    return value;
  }
  if (!DOCUMENT_PATTERNS[type]?.test(value)) {
    throw new ApiError(400, `Enter a valid ${KYC_DOCUMENTS[type]?.label || 'document'} number`);
  }
  return value;
};

const maskNumber = (value) => `${'X'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
const hashNumber = (type, value) =>
  crypto.createHmac('sha256', process.env.KYC_HASH_SECRET || env.jwtSecret).update(`${type}:${value}`).digest('hex');

// ---- name matching ---------------------------------------------------------

const nameTokens = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !['mr', 'mrs', 'ms', 'dr', 'shri', 'smt', 'kumari'].includes(token));

/// True when the profile name plausibly belongs to the document holder: every
/// word of the shorter name appears in the longer one (initials allowed), so
/// "Rahul Sharma" matches "RAHUL KUMAR SHARMA" and "R Sharma".
export const namesMatch = (profileName, documentName) => {
  const a = nameTokens(profileName);
  const b = nameTokens(documentName);
  if (!a.length || !b.length) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.every((token) =>
    longer.some((other) => other === token || (token.length === 1 && other.startsWith(token)) || (other.length === 1 && token.startsWith(other))),
  );
};

// ---- flows -----------------------------------------------------------------

const logAttempt = (entry) => UserKycAttempt.create(entry).catch(() => null);

const loadUserForKyc = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, 'User not found');
  if (!user.kyc) user.kyc = {};
  return user;
};

const assertCanAttempt = async ({ settings, user, documentType }) => {
  if (!settings.enabled) throw new ApiError(400, 'Identity verification is not enabled');
  if (!settings.allowed_documents.includes(documentType)) {
    throw new ApiError(400, `${KYC_DOCUMENTS[documentType]?.label || 'This document'} is not accepted for verification`);
  }
  if (user.kyc?.status === 'verified') throw new ApiError(409, 'Your identity is already verified');
  if (user.kyc?.status === 'needs_review') throw new ApiError(409, 'Your verification is being reviewed');

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await UserKycAttempt.countDocuments({
    userId: user._id,
    step: { $in: ['otp_request', 'document'] },
    createdAt: { $gte: since },
  });
  if (recent >= settings.max_attempts_per_day) {
    throw new ApiError(429, 'Too many verification attempts. Please try again tomorrow.', { code: 'KYC_ATTEMPTS_EXCEEDED' });
  }
};

/// Another account already verified with this document.
const findDuplicateOwner = (userId, numberHash) =>
  User.findOne({ _id: { $ne: userId }, 'kyc.numberHash': numberHash, 'kyc.status': { $in: ['verified', 'needs_review'] } })
    .select('_id')
    .lean();

const providerFailure = (error) => {
  if (error instanceof KycProviderError) {
    return new ApiError(error.status, error.message, { code: error.code, retryable: error.retryable });
  }
  return error;
};

const finalize = async ({ user, settings, documentType, maskedNumber, numberHash, identity }) => {
  const duplicate = await findDuplicateOwner(user._id, numberHash);
  const nameOk = settings.name_mismatch === 'ignore' || !identity.name || namesMatch(user.name, identity.name);

  let status = 'verified';
  let reviewReason = '';
  if (duplicate) {
    status = 'needs_review';
    reviewReason = 'This document is already verified on another account';
  } else if (!nameOk) {
    status = 'needs_review';
    reviewReason = `Name on document (${identity.name}) does not match profile name (${user.name || '-'})`;
  }

  Object.assign(user.kyc, {
    status,
    documentType,
    maskedNumber,
    numberHash,
    verifiedName: identity.name || '',
    dob: identity.dob || '',
    gender: identity.gender || '',
    provider: `quickekyc:${settings.provider.environment}`,
    providerRef: identity.providerRef || '',
    pendingRequestId: '',
    pendingRequestAt: null,
    pendingNumberHash: '',
    pendingMaskedNumber: '',
    reviewReason,
    failureReason: '',
    verifiedAt: status === 'verified' ? new Date() : null,
  });
  user.isVerified = status === 'verified';
  user.markModified('kyc');
  await user.save();

  await logAttempt({
    userId: user._id,
    documentType,
    maskedNumber,
    step: documentType === 'aadhaar' ? 'otp_submit' : 'document',
    outcome: status === 'verified' ? 'verified' : 'needs_review',
    message: reviewReason,
    environment: settings.provider.environment,
  });

  return serializeUserKyc(user);
};

const recordFailure = async ({ user, settings, documentType, maskedNumber, step, message }) => {
  user.kyc.status = 'failed';
  user.kyc.failureReason = message;
  user.kyc.documentType = documentType;
  user.markModified('kyc');
  await user.save();
  await logAttempt({ userId: user._id, documentType, maskedNumber, step, outcome: 'failed', message, environment: settings.provider.environment });
};

export const startAadhaarVerification = async ({ userId, aadhaarNumber }) => {
  const settings = await getUserKycSettings();
  const user = await loadUserForKyc(userId);
  await assertCanAttempt({ settings, user, documentType: 'aadhaar' });

  const number = normalizeDocumentNumber('aadhaar', aadhaarNumber);
  const maskedNumber = maskNumber(number);
  const client = createQuickEkycClient(settings.provider);

  user.kyc.attempts = Number(user.kyc.attempts || 0) + 1;
  user.kyc.lastAttemptAt = new Date();

  let requestId;
  try {
    ({ requestId } = await client.startAadhaarOtp(number));
  } catch (error) {
    await recordFailure({ user, settings, documentType: 'aadhaar', maskedNumber, step: 'otp_request', message: error.message });
    throw providerFailure(error);
  }

  Object.assign(user.kyc, {
    status: 'otp_sent',
    documentType: 'aadhaar',
    pendingRequestId: requestId,
    pendingRequestAt: new Date(),
    pendingNumberHash: hashNumber('aadhaar', number),
    pendingMaskedNumber: maskedNumber,
    failureReason: '',
  });
  user.markModified('kyc');
  await user.save();
  await logAttempt({ userId: user._id, documentType: 'aadhaar', maskedNumber, step: 'otp_request', outcome: 'sent', environment: settings.provider.environment });

  return {
    status: 'otp_sent',
    maskedNumber,
    expiresInSeconds: settings.otp_expiry_minutes * 60,
    ...(settings.provider.environment === 'mock' ? { mockOtp: '123456' } : {}),
  };
};

export const submitAadhaarOtp = async ({ userId, otp }) => {
  const settings = await getUserKycSettings();
  const user = await loadUserForKyc(userId);
  if (!settings.enabled) throw new ApiError(400, 'Identity verification is not enabled');

  const cleanOtp = String(otp || '').replace(/\D/g, '');
  if (!/^[0-9]{4,8}$/.test(cleanOtp)) throw new ApiError(400, 'Enter the OTP sent to your Aadhaar-linked mobile');

  const { pendingRequestId, pendingRequestAt, pendingNumberHash, pendingMaskedNumber } = user.kyc || {};
  const expired = !pendingRequestAt ||
    Date.now() - new Date(pendingRequestAt).getTime() > settings.otp_expiry_minutes * 60 * 1000;
  if (user.kyc?.status !== 'otp_sent' || !pendingRequestId || expired) {
    throw new ApiError(400, 'OTP expired. Please request a new one.', { code: 'KYC_OTP_EXPIRED' });
  }

  const client = createQuickEkycClient(settings.provider);
  let identity;
  try {
    identity = await client.submitAadhaarOtp(pendingRequestId, cleanOtp);
  } catch (error) {
    // A wrong OTP keeps the request open so the rider can retype it.
    if (error instanceof KycProviderError && error.code === 'KYC_VERIFICATION_FAILED') {
      await logAttempt({ userId: user._id, documentType: 'aadhaar', maskedNumber: pendingMaskedNumber, step: 'otp_submit', outcome: 'failed', message: error.message, environment: settings.provider.environment });
    }
    throw providerFailure(error);
  }

  return finalize({
    user,
    settings,
    documentType: 'aadhaar',
    maskedNumber: pendingMaskedNumber,
    numberHash: pendingNumberHash,
    identity,
  });
};

export const verifyUserDocument = async ({ userId, documentType, number, dob }) => {
  if (!KYC_DOCUMENTS[documentType] || documentType === 'aadhaar') {
    throw new ApiError(400, 'Use PAN, driving licence or voter ID here; Aadhaar uses OTP');
  }
  const settings = await getUserKycSettings();
  const user = await loadUserForKyc(userId);
  await assertCanAttempt({ settings, user, documentType });

  const normalized = normalizeDocumentNumber(documentType, number);
  const maskedNumber = maskNumber(normalized);
  const cleanDob = String(dob || '').trim();
  if (KYC_DOCUMENTS[documentType].needsDob && !/^\d{4}-\d{2}-\d{2}$/.test(cleanDob)) {
    throw new ApiError(400, 'Enter your date of birth');
  }

  user.kyc.attempts = Number(user.kyc.attempts || 0) + 1;
  user.kyc.lastAttemptAt = new Date();

  const client = createQuickEkycClient(settings.provider);
  let identity;
  try {
    identity = await client.verifyDocument(documentType, normalized, { dob: cleanDob });
  } catch (error) {
    await recordFailure({ user, settings, documentType, maskedNumber, step: 'document', message: error.message });
    throw providerFailure(error);
  }

  return finalize({
    user,
    settings,
    documentType,
    maskedNumber,
    numberHash: hashNumber(documentType, normalized),
    identity,
  });
};

export const serializeUserKyc = (user) => {
  const kyc = user?.kyc || {};
  return {
    status: kyc.status || 'not_started',
    isVerified: kyc.status === 'verified',
    documentType: kyc.documentType || '',
    documentLabel: KYC_DOCUMENTS[kyc.documentType]?.label || '',
    maskedNumber: kyc.maskedNumber || kyc.pendingMaskedNumber || '',
    verifiedName: kyc.verifiedName || '',
    verifiedAt: kyc.verifiedAt || null,
    failureReason: kyc.status === 'failed' ? kyc.failureReason || '' : '',
    underReview: kyc.status === 'needs_review',
  };
};

export const getUserKycStatus = async (userId) => {
  const [user, config] = await Promise.all([
    User.findById(userId).select('kyc name').lean(),
    getPublicKycConfig(),
  ]);
  if (!user) throw new ApiError(404, 'User not found');
  return { ...serializeUserKyc(user), config };
};

// ---- booking gate ----------------------------------------------------------

const requiresKycFor = (requiredFor, serviceType) => {
  if (requiredFor === 'before_booking' || requiredFor === 'after_signup') return true;
  if (requiredFor === 'rental_outstation') return ['hourly_rental', 'intercity'].includes(serviceType);
  return false;
};

/// Throws 403 KYC_REQUIRED when this booking needs a verified rider.
export const assertUserKycForBooking = async ({ userId, serviceType }) => {
  const settings = await getUserKycSettings();
  if (!settings.enabled || !requiresKycFor(settings.required_for, String(serviceType || 'ride'))) return;

  const user = await User.findById(userId).select('kyc').lean();
  const status = user?.kyc?.status || 'not_started';
  if (status === 'verified') return;

  throw new ApiError(
    403,
    status === 'needs_review'
      ? 'Your identity verification is under review. You can book once it is approved.'
      : 'Please verify your identity to book this ride.',
    { code: 'KYC_REQUIRED', kycStatus: status },
  );
};

// ---- admin -----------------------------------------------------------------

export const adminUpdateUserKyc = async ({ userId, action, reason = '', adminId = null }) => {
  if (!mongoose.Types.ObjectId.isValid(String(userId))) throw new ApiError(400, 'Invalid user id');
  const user = await loadUserForKyc(userId);
  const note = String(reason || '').trim();

  if (action === 'approve') {
    if (!user.kyc.documentType) throw new ApiError(400, 'This user has not submitted a document yet');
    user.kyc.status = 'verified';
    user.kyc.verifiedAt = new Date();
    user.kyc.reviewReason = note;
    user.isVerified = true;
  } else if (action === 'reject') {
    user.kyc.status = 'rejected';
    user.kyc.failureReason = note || 'Rejected by admin';
    user.kyc.verifiedAt = null;
    user.isVerified = false;
  } else if (action === 'reset') {
    // Lets the rider verify again (also clears the number so it no longer
    // counts as a duplicate for anyone else).
    user.kyc = { status: 'not_started' };
    user.isVerified = false;
  } else {
    throw new ApiError(400, 'action must be approve, reject or reset');
  }

  user.kyc.reviewedBy = adminId && mongoose.Types.ObjectId.isValid(String(adminId)) ? adminId : null;
  user.kyc.reviewedAt = new Date();
  user.markModified('kyc');
  await user.save();

  await logAttempt({
    userId: user._id,
    documentType: user.kyc.documentType || '',
    maskedNumber: user.kyc.maskedNumber || '',
    step: 'admin',
    outcome: action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'reset',
    message: note,
    adminId: user.kyc.reviewedBy,
  });

  return { ...serializeUserKyc(user), reviewReason: user.kyc.reviewReason || '' };
};

export const getUserKycForAdmin = async (userId) => {
  const user = await User.findById(userId).select('kyc name').lean();
  if (!user) throw new ApiError(404, 'User not found');
  const attempts = await UserKycAttempt.find({ userId }).sort({ createdAt: -1 }).limit(20).lean();
  return {
    ...serializeUserKyc(user),
    reviewReason: user.kyc?.reviewReason || '',
    provider: user.kyc?.provider || '',
    dob: user.kyc?.dob || '',
    attempts: attempts.map((item) => ({
      id: String(item._id),
      documentType: item.documentType,
      maskedNumber: item.maskedNumber,
      step: item.step,
      outcome: item.outcome,
      message: item.message,
      environment: item.environment,
      createdAt: item.createdAt,
    })),
  };
};
