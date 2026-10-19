import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion as Motion } from 'framer-motion';
import { ArrowLeft, BadgeCheck, Clock3, LoaderCircle, ShieldAlert, ShieldCheck } from 'lucide-react';
import { userService } from '../../services/userService';

const unwrap = (response) => response?.data ?? response ?? {};
const errorMessage = (error, fallback) => error?.message || error?.response?.data?.message || fallback;

const DOCUMENT_PLACEHOLDERS = {
  aadhaar: 'XXXX XXXX XXXX',
  pan: 'ABCDE1234F',
  driving_license: 'MH0120190012345',
  voter_id: 'ABC1234567',
};

const formatAadhaarInput = (value) =>
  value.replace(/\D/g, '').slice(0, 12).replace(/(\d{4})(?=\d)/g, '$1 ');

const VerifyIdentity = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const routePrefix = location.pathname.startsWith('/taxi/user') ? '/taxi/user' : '';
  // Set when a booking was refused with KYC_REQUIRED: after verifying, the
  // rider goes back to the screen they booked from.
  const returnToBooking = Boolean(location.state?.returnToBooking);

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [documentType, setDocumentType] = useState('');
  const [number, setNumber] = useState('');
  const [dob, setDob] = useState('');
  const [otp, setOtp] = useState('');
  const [otpInfo, setOtpInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = unwrap(await userService.getKycStatus());
      setStatus(data);
      setDocumentType((current) => current || data?.config?.documents?.[0]?.type || '');
    } catch (loadError) {
      setError(errorMessage(loadError, 'Could not load verification status'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const config = status?.config;
  const selectedDocument = useMemo(
    () => config?.documents?.find((doc) => doc.type === documentType) || null,
    [config, documentType],
  );

  const resetForm = (type) => {
    setDocumentType(type);
    setNumber('');
    setDob('');
    setOtp('');
    setOtpInfo(null);
    setError('');
  };

  const finish = (data) => {
    setStatus((current) => ({ ...current, ...data }));
    setOtpInfo(null);
    setOtp('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!selectedDocument) return;
    setError('');
    setBusy(true);
    try {
      if (selectedDocument.flow === 'otp' && !otpInfo) {
        setOtpInfo(unwrap(await userService.requestAadhaarOtp({ aadhaarNumber: number.replace(/\s/g, '') })));
      } else if (selectedDocument.flow === 'otp') {
        finish(unwrap(await userService.verifyAadhaarOtp({ otp })));
      } else {
        finish(unwrap(await userService.verifyKycDocument({ documentType, number, dob })));
      }
    } catch (submitError) {
      if (submitError?.details?.code === 'KYC_OTP_EXPIRED') setOtpInfo(null);
      setError(errorMessage(submitError, 'Verification failed. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate(`${routePrefix || '/taxi/user'}/profile`));

  const header = (
    <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-5 pb-4 pt-10 backdrop-blur">
      <div className="flex items-center gap-3">
        <Motion.button
          whileTap={{ scale: 0.96 }}
          onClick={goBack}
          aria-label="Back"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700"
        >
          <ArrowLeft size={18} />
        </Motion.button>
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">Account</p>
          <h1 className="truncate text-lg font-semibold text-slate-900">Verify your identity</h1>
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="mx-auto min-h-screen max-w-lg bg-slate-50">
        {header}
        <div className="flex items-center gap-2 px-5 py-10 text-sm text-slate-500">
          <LoaderCircle size={16} className="animate-spin" /> Loading…
        </div>
      </div>
    );
  }

  const isVerified = status?.status === 'verified';
  const underReview = status?.status === 'needs_review';

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-slate-50 pb-16">
      {header}

      <div className="space-y-5 px-5 py-5">
        {isVerified ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <BadgeCheck size={44} className="mx-auto text-emerald-500" />
            <h2 className="mt-3 text-lg font-semibold text-slate-900">You're verified</h2>
            <p className="mt-1 text-sm text-slate-500">
              {status.documentLabel} {status.maskedNumber}
              {status.verifiedName ? ` · ${status.verifiedName}` : ''}
            </p>
            {returnToBooking ? (
              <button type="button" onClick={() => navigate(-1)} className="mt-5 h-12 w-full rounded-2xl bg-blue-600 text-sm font-semibold text-white">
                Continue booking
              </button>
            ) : null}
          </section>
        ) : underReview ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <Clock3 size={40} className="mx-auto text-amber-500" />
            <h2 className="mt-3 text-lg font-semibold text-slate-900">Under review</h2>
            <p className="mt-1 text-sm text-slate-500">
              We've received your {status.documentLabel || 'document'} {status.maskedNumber}. Our team will review it shortly;
              you can book once it's approved.
            </p>
          </section>
        ) : !config?.enabled ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <ShieldCheck size={40} className="mx-auto text-slate-400" />
            <h2 className="mt-3 text-lg font-semibold text-slate-900">No verification needed</h2>
            <p className="mt-1 text-sm text-slate-500">Identity verification isn't required right now.</p>
          </section>
        ) : (
          <>
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <ShieldCheck size={22} className="mt-0.5 shrink-0 text-blue-600" />
                <p className="text-sm text-slate-600">
                  {returnToBooking
                    ? 'Verify your identity once to continue booking. It takes under a minute.'
                    : 'Verify your identity once to keep your rides safe. We store only the last four digits of your document.'}
                </p>
              </div>
              {status?.status === 'rejected' || status?.status === 'failed' ? (
                <p className="mt-3 flex items-start gap-2 rounded-2xl bg-rose-50 px-4 py-3 text-xs text-rose-700">
                  <ShieldAlert size={14} className="mt-0.5 shrink-0" />
                  {status.failureReason || 'Your last attempt did not go through. Please try again.'}
                </p>
              ) : null}
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold text-slate-900">Choose a document</h3>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {config.documents.map((doc) => {
                  const active = doc.type === documentType;
                  return (
                    <button
                      type="button"
                      key={doc.type}
                      onClick={() => resetForm(doc.type)}
                      disabled={busy || Boolean(otpInfo)}
                      className={`rounded-2xl border px-4 py-3 text-left transition disabled:opacity-60 ${active ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white'}`}
                    >
                      <p className={`text-sm font-semibold ${active ? 'text-blue-600' : 'text-slate-900'}`}>{doc.label}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{doc.flow === 'otp' ? 'OTP verification' : 'Instant'}</p>
                    </button>
                  );
                })}
              </div>
            </section>

            {selectedDocument ? (
              <form onSubmit={handleSubmit} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <label className="block text-sm font-medium text-slate-700">{selectedDocument.label} number</label>
                <input
                  value={number}
                  onChange={(event) =>
                    setNumber(documentType === 'aadhaar' ? formatAadhaarInput(event.target.value) : event.target.value.toUpperCase())
                  }
                  disabled={busy || Boolean(otpInfo)}
                  inputMode={documentType === 'aadhaar' ? 'numeric' : 'text'}
                  placeholder={DOCUMENT_PLACEHOLDERS[documentType]}
                  autoComplete="off"
                  className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm tracking-wide text-slate-900 outline-none focus:border-blue-500"
                />
                <p className="mt-1.5 text-xs text-slate-500">{selectedDocument.hint}</p>

                {selectedDocument.needsDob ? (
                  <>
                    <label className="mt-4 block text-sm font-medium text-slate-700">Date of birth</label>
                    <input
                      type="date"
                      value={dob}
                      onChange={(event) => setDob(event.target.value)}
                      disabled={busy}
                      className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none focus:border-blue-500"
                    />
                  </>
                ) : null}

                {otpInfo ? (
                  <>
                    <label className="mt-4 block text-sm font-medium text-slate-700">OTP</label>
                    <input
                      value={otp}
                      onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      disabled={busy}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="6-digit OTP"
                      className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm tracking-[0.3em] text-slate-900 outline-none focus:border-blue-500"
                    />
                    <p className="mt-1.5 text-xs text-slate-500">
                      Sent to the mobile number linked with Aadhaar {otpInfo.maskedNumber}.
                      {otpInfo.mockOtp ? ` Test mode: use ${otpInfo.mockOtp}.` : ''}
                    </p>
                    <button
                      type="button"
                      onClick={() => { setOtpInfo(null); setOtp(''); setError(''); }}
                      disabled={busy}
                      className="mt-2 text-xs font-semibold text-blue-600"
                    >
                      Change number / resend OTP
                    </button>
                  </>
                ) : null}

                {error ? <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</p> : null}

                <button
                  type="submit"
                  disabled={busy || !number.trim() || (otpInfo && otp.length < 4) || (selectedDocument.needsDob && !dob)}
                  className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 text-sm font-semibold text-white transition disabled:bg-slate-300"
                >
                  {busy ? <LoaderCircle size={16} className="animate-spin" /> : null}
                  {selectedDocument.flow === 'otp' ? (otpInfo ? 'Verify OTP' : 'Send OTP') : 'Verify'}
                </button>
              </form>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
};

export default VerifyIdentity;
