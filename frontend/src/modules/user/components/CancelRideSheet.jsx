import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, LoaderCircle } from 'lucide-react';
import api from '../../../shared/api/axiosInstance';

// The built-in catch-all; the backend accepts this id with a typed note.
const OTHER_ID = 'other';

/**
 * Cancel confirmation that asks the rider why, from the list the admin keeps
 * under Settings → App Settings → Cancellation Reasons.
 *
 * `stage` picks the list ('before_driver' while searching, 'after_driver' once
 * a captain is assigned). `onConfirm(payload)` performs the cancel; throw an
 * error carrying a CANCEL_REASON_* code to keep the sheet open with its message.
 */
const CancelRideSheet = ({
  open,
  stage,
  title = 'Cancel ride?',
  subtitle = '',
  keepLabel = 'Go Back',
  onClose,
  onConfirm,
}) => {
  const [reasons, setReasons] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let ignore = false;

    setSelectedId('');
    setNote('');
    setError('');
    setLoading(true);

    api.get(`/users/cancellation-reasons?audience=user&stage=${encodeURIComponent(stage || '')}`)
      .then((res) => {
        if (ignore) return;
        const list = res?.data?.results || res?.results || [];
        setReasons(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        // Cancelling must still work if the list cannot load; "Other" remains.
        if (!ignore) setReasons([]);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [open, stage]);

  const selected = reasons.find((r) => r.id === selectedId);
  const isOther = selectedId === OTHER_ID;
  const needsNote = isOther || Boolean(selected?.requiresNote);
  const hasReasons = reasons.length > 0;

  const handleConfirm = async () => {
    // With no admin list at all, a reason cannot be required.
    if (hasReasons && !selectedId) {
      setError('Please pick a reason');
      return;
    }
    if (needsNote && hasReasons && !note.trim()) {
      setError('Please tell us a little more');
      return;
    }

    const payload = {};
    if (selected) {
      payload.reasonId = selected.id;
      payload.reason = selected.title;
    } else if (isOther && hasReasons) {
      payload.reasonId = OTHER_ID;
    }
    if (note.trim()) payload.note = note.trim();

    try {
      setSubmitting(true);
      setError('');
      await onConfirm(payload);
    } catch (err) {
      setError(err?.message || 'Could not cancel the ride');
    } finally {
      setSubmitting(false);
    }
  };

  const optionClass = (active) =>
    `w-full text-left px-4 py-3 rounded-[14px] border text-[13px] font-bold transition-colors ${
      active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700'
    }`;

  return (
    <AnimatePresence>
      {open && (
        <div className="z-[100] relative">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !submitting && onClose()}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] max-w-lg mx-auto"
          />
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 40 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 40 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[88%] max-w-sm max-h-[85vh] overflow-y-auto bg-white rounded-[28px] p-6 z-[101] shadow-2xl"
          >
            <div className="text-center">
              <div className="w-14 h-14 bg-red-50 rounded-[18px] flex items-center justify-center mx-auto mb-4">
                <AlertTriangle size={26} className="text-red-400" strokeWidth={2} />
              </div>
              <h3 className="text-[18px] font-bold text-slate-900 mb-1.5">{title}</h3>
              {subtitle ? (
                <p className="text-[13px] font-bold text-slate-400 mb-4 leading-relaxed">{subtitle}</p>
              ) : null}
            </div>

            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400 mb-2">
              Why are you cancelling?
            </p>

            {loading ? (
              <div className="flex justify-center py-6 text-slate-400">
                <LoaderCircle size={22} className="animate-spin" />
              </div>
            ) : (
              <div className="space-y-2">
                {reasons.map((reason) => (
                  <button
                    key={reason.id}
                    type="button"
                    onClick={() => { setSelectedId(reason.id); setError(''); }}
                    className={optionClass(selectedId === reason.id)}
                  >
                    {reason.title}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => { setSelectedId(OTHER_ID); setError(''); }}
                  className={optionClass(isOther)}
                >
                  Other
                </button>
              </div>
            )}

            {(needsNote || (!hasReasons && !loading)) && (
              <textarea
                value={note}
                onChange={(e) => { setNote(e.target.value); setError(''); }}
                maxLength={300}
                rows={3}
                placeholder={needsNote ? 'Tell us what happened' : 'Tell us why (optional)'}
                className="mt-3 w-full rounded-[14px] border border-slate-200 px-4 py-3 text-[13px] text-slate-800 outline-none focus:border-slate-900"
              />
            )}

            {error ? <p className="mt-3 text-[12px] font-bold text-red-500">{error}</p> : null}

            <div className="space-y-2.5 mt-5">
              <motion.button
                whileTap={{ scale: 0.97 }}
                type="button"
                disabled={submitting || loading}
                onClick={handleConfirm}
                className="w-full flex items-center justify-center gap-2 bg-slate-900 disabled:opacity-60 text-white py-3.5 rounded-[16px] text-[13px] font-bold uppercase tracking-widest"
              >
                {submitting ? <LoaderCircle size={16} className="animate-spin" /> : null}
                Yes, Cancel
              </motion.button>
              <button
                type="button"
                disabled={submitting}
                onClick={onClose}
                className="w-full py-3.5 text-[13px] font-bold text-slate-400 uppercase tracking-widest"
              >
                {keepLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default CancelRideSheet;
