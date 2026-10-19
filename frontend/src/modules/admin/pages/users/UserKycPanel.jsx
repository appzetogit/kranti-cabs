import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, RotateCcw, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminService } from '../../services/adminService';
import { KYC_DOCUMENT_LABELS, KYC_STATUS_META } from '../../constants/kycStatus';

const unwrapPayload = (response) => response?.data?.data || response?.data || {};

const formatDate = (value) => (value ? new Date(value).toLocaleString('en-IN') : '-');

const Row = ({ label, value }) => (
  <div className="flex justify-between gap-4 py-2 text-sm">
    <span className="text-gray-500">{label}</span>
    <span className="text-right font-medium text-gray-900">{value || '-'}</span>
  </div>
);

/// Admin view of one rider's or driver's identity verification, with manual
/// overrides. `subject` is 'user' (default) or 'driver'.
const UserKycPanel = ({ userId, subject = 'user' }) => {
  const api = subject === 'driver'
    ? { get: adminService.getDriverKyc, review: adminService.reviewDriverKyc }
    : { get: adminService.getUserKyc, review: adminService.reviewUserKyc };
  const [kyc, setKyc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setKyc(unwrapPayload(await api.get(userId)));
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Could not load KYC details');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, subject]);

  useEffect(() => {
    load();
  }, [load]);

  const review = async (action) => {
    if (action === 'reject' && !reason.trim()) {
      toast.error('Add a reason before rejecting');
      return;
    }
    try {
      setBusyAction(action);
      await api.review(userId, { action, reason: reason.trim() });
      toast.success(action === 'approve' ? 'KYC approved' : action === 'reject' ? 'KYC rejected' : 'KYC reset');
      setReason('');
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Action failed');
    } finally {
      setBusyAction('');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="animate-spin text-indigo-600" size={28} />
      </div>
    );
  }
  if (!kyc) return null;

  const meta = KYC_STATUS_META[kyc.status] || KYC_STATUS_META.not_started;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 lg:col-span-1">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Identity verification</h3>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${meta.className}`}>{meta.label}</span>
        </div>
        <div className="divide-y divide-gray-100">
          <Row label="Document" value={KYC_DOCUMENT_LABELS[kyc.documentType] || kyc.documentType} />
          <Row label="Number" value={kyc.maskedNumber} />
          <Row label="Name on document" value={kyc.verifiedName} />
          <Row label="Date of birth" value={kyc.dob} />
          <Row label="Verified at" value={formatDate(kyc.verifiedAt)} />
          <Row label="Provider" value={kyc.provider} />
        </div>
        {kyc.reviewReason ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{kyc.reviewReason}</p>
        ) : null}
        {kyc.failureReason ? (
          <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{kyc.failureReason}</p>
        ) : null}

        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Reason / note (required to reject)"
          rows={2}
          className="mt-4 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />
        <div className="mt-3 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => review('approve')}
            disabled={Boolean(busyAction) || !kyc.documentType || kyc.status === 'verified'}
            className="flex items-center justify-center gap-1 rounded-lg bg-emerald-600 px-2 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            {busyAction === 'approve' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Approve
          </button>
          <button
            type="button"
            onClick={() => review('reject')}
            disabled={Boolean(busyAction) || kyc.status === 'not_started'}
            className="flex items-center justify-center gap-1 rounded-lg bg-rose-600 px-2 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            {busyAction === 'reject' ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />} Reject
          </button>
          <button
            type="button"
            onClick={() => review('reset')}
            disabled={Boolean(busyAction) || kyc.status === 'not_started'}
            className="flex items-center justify-center gap-1 rounded-lg border border-gray-200 px-2 py-2 text-xs font-semibold text-gray-700 disabled:opacity-40"
          >
            {busyAction === 'reset' ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Reset
          </button>
        </div>
        <p className="mt-2 text-[11px] text-gray-400">Reset lets the {subject === 'driver' ? 'driver' : 'rider'} verify again and frees the document for another account.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden lg:col-span-2">
        <div className="border-b border-gray-100 px-5 py-4">
          <h3 className="text-sm font-semibold text-gray-900">Attempts</h3>
          <p className="text-xs text-gray-400">Latest 20, masked numbers only</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50">
              <tr>
                {['When', 'Document', 'Step', 'Result', 'Message'].map((heading) => (
                  <th key={heading} className="px-4 py-2.5 text-xs font-semibold text-gray-500">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(kyc.attempts || []).length ? (
                kyc.attempts.map((attempt) => (
                  <tr key={attempt.id}>
                    <td className="px-4 py-2.5 text-xs text-gray-600 whitespace-nowrap">{formatDate(attempt.createdAt)}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-700">
                      {KYC_DOCUMENT_LABELS[attempt.documentType] || attempt.documentType || '-'} {attempt.maskedNumber}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-600">{attempt.step.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-2.5 text-xs font-semibold text-gray-800">{attempt.outcome.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{attempt.message || '-'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">No verification attempts yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default UserKycPanel;
