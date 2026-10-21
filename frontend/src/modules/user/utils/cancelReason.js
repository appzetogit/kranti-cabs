// The backend's codes for a cancel refused over its reason (see
// cancellationReasonService.js); the ride is still live when these come back.
export const isCancelReasonError = (error) =>
  String(error?.details?.code || '').startsWith('CANCEL_REASON_');
