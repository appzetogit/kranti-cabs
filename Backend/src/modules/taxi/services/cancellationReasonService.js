import mongoose from 'mongoose';
import { ApiError } from '../../../utils/ApiError.js';
import { CancellationReason } from '../admin/models/CancellationReason.js';

/// Ride stages a reason can be limited to. "Waiting for a driver" and "my
/// driver is late" are different conversations, so the admin can keep two
/// lists; `any` shows a reason in both.
export const CANCEL_STAGES = ['any', 'before_driver', 'after_driver'];

/// Sent by the apps for the built-in "Other" choice, which has no catalog row.
export const OTHER_REASON_ID = 'other';

const MAX_TEXT = 300;

const clean = (value) => String(value ?? '').trim().slice(0, MAX_TEXT);

export const normalizeStage = (value, fallback = 'any') => {
  const stage = String(value || '').trim().toLowerCase();
  return CANCEL_STAGES.includes(stage) ? stage : fallback;
};

/// Which list applies to this ride right now: before or after a driver took it.
export const rideCancelStage = (ride) => (ride?.driverId ? 'after_driver' : 'before_driver');

const reasonError = (message, code) => new ApiError(400, message, { code });

/**
 * Turns what the rider sent with a cancel into what is stored on the ride.
 *
 * Deliberately lenient when nothing is sent: the shipped Flutter app cancels
 * without a reason, and refusing that would leave riders unable to cancel
 * until they update. Anything that *is* sent is checked against the admin's list.
 */
export const resolveRiderCancelReason = async ({ ride, input = {} }) => {
  const stage = rideCancelStage(ride);
  const reasonId = clean(input.reasonId ?? input.reason_id ?? input.cancel_reason_id);
  const note = clean(input.note ?? input.reason_note ?? input.custom_reason);
  const text = clean(input.reason ?? input.cancel_reason);

  const result = (title, id = null) => ({
    cancelReason: note && title !== note ? `${title}: ${note}` : title,
    cancelReasonId: id,
    cancelReasonNote: note,
    cancelStage: stage,
    // Only the label goes to the driver; the rider's own words stay with admin.
    driverLabel: title,
  });

  if (reasonId.toLowerCase() === OTHER_REASON_ID) {
    if (!note) throw reasonError('Please tell us why you are cancelling', 'CANCEL_REASON_NOTE_REQUIRED');
    return result('Other');
  }

  if (reasonId) {
    const reason = mongoose.isValidObjectId(reasonId)
      ? await CancellationReason.findOne({
        _id: reasonId,
        audience: 'user',
        active: true,
        stage: { $in: [stage, 'any', null] },
      }).lean()
      : null;

    if (reason) {
      if (reason.requiresNote && !note) {
        throw reasonError('Please add a few words about why you are cancelling', 'CANCEL_REASON_NOTE_REQUIRED');
      }
      return result(reason.title, reason._id);
    }

    // The admin may have edited the list while the rider had it open; keep
    // the wording they saw rather than blocking the cancel.
    if (text) return result(text);
    throw reasonError('That cancellation reason is no longer available', 'CANCEL_REASON_INVALID');
  }

  if (text) return result(text);
  if (note) return result('Other');

  return { ...result(''), cancelReason: '', driverLabel: '' };
};
