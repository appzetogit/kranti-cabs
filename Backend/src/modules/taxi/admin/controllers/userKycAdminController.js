import { asyncHandler } from '../../../../utils/asyncHandler.js';
import {
  adminUpdateUserKyc,
  getUserKycForAdmin,
  getUserKycSettingsForAdmin,
  testUserKycConnection,
  updateUserKycSettings,
} from '../../services/userKycService.js';

const ok = (res, data) => res.json({ success: true, data });

export const getUserKycSettings = asyncHandler(async (_req, res) => ok(res, await getUserKycSettingsForAdmin()));

export const saveUserKycSettings = asyncHandler(async (req, res) => ok(res, await updateUserKycSettings(req.body || {})));

export const testUserKycSettings = asyncHandler(async (_req, res) => ok(res, await testUserKycConnection()));

export const getUserKyc = asyncHandler(async (req, res) => ok(res, await getUserKycForAdmin(req.params.id)));

export const getDriverKyc = asyncHandler(async (req, res) => ok(res, await getUserKycForAdmin(req.params.id, 'driver')));

export const reviewDriverKyc = asyncHandler(async (req, res) =>
  ok(res, await adminUpdateUserKyc({
    userId: req.params.id,
    action: String(req.body?.action || '').trim().toLowerCase(),
    reason: req.body?.reason,
    adminId: req.auth?.sub,
    subject: 'driver',
  })));

export const reviewUserKyc = asyncHandler(async (req, res) =>
  ok(res, await adminUpdateUserKyc({
    userId: req.params.id,
    action: String(req.body?.action || '').trim().toLowerCase(),
    reason: req.body?.reason,
    adminId: req.auth?.sub,
  })));
