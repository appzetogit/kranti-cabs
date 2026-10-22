import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { ApiError } from '../../../../utils/ApiError.js';
import { StateTax } from '../models/StateTax.js';
import { invalidateStateTaxCache, normalizeStateTaxPayload } from '../../services/stateTaxService.js';

/**
 * State tax and MCD tax rules, for the admin panel. See
 * services/stateTaxService.js for when a trip pays one.
 */

const ok = (res, data, extra = {}) => res.json({ success: true, data, ...extra });

const present = (row) => ({
  id: String(row._id),
  _id: String(row._id),
  name: row.name,
  tax_type: row.tax_type || 'state_tax',
  state: row.state,
  fees: {
    bike: Number(row.fees?.bike || 0),
    auto: Number(row.fees?.auto || 0),
    car: Number(row.fees?.car || 0),
  },
  active: row.active !== false,
});

export const listStateTaxes = asyncHandler(async (_req, res) => {
  const rows = await StateTax.find({}).sort({ state: 1, tax_type: 1 }).lean();
  ok(res, { results: rows.map(present) });
});

export const createStateTax = asyncHandler(async (req, res) => {
  const payload = normalizeStateTaxPayload(req.body || {});
  if (!payload.name) throw new ApiError(400, 'Name is required', { code: 'STATE_TAX_NAME_REQUIRED' });
  if (!payload.state) throw new ApiError(400, 'State is required', { code: 'STATE_TAX_STATE_REQUIRED' });

  const row = await StateTax.create(payload);
  invalidateStateTaxCache();
  ok(res, present(row.toObject()));
});

export const updateStateTax = asyncHandler(async (req, res) => {
  const updates = normalizeStateTaxPayload(req.body || {}, { partial: true });
  if (updates.name === '') throw new ApiError(400, 'Name cannot be empty', { code: 'STATE_TAX_NAME_REQUIRED' });
  if (updates.state === '') throw new ApiError(400, 'State cannot be empty', { code: 'STATE_TAX_STATE_REQUIRED' });

  const row = await StateTax.findByIdAndUpdate(req.params.id, updates, {
    returnDocument: 'after',
    runValidators: true,
  }).lean();
  if (!row) throw new ApiError(404, 'Tax rule not found', { code: 'STATE_TAX_NOT_FOUND' });

  invalidateStateTaxCache();
  ok(res, present(row));
});

export const deleteStateTax = asyncHandler(async (req, res) => {
  const row = await StateTax.findByIdAndDelete(req.params.id).lean();
  if (!row) throw new ApiError(404, 'Tax rule not found', { code: 'STATE_TAX_NOT_FOUND' });

  invalidateStateTaxCache();
  ok(res, { id: String(row._id) });
});
