import React, { useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, FileCheck2, KeyRound, Loader2, PlugZap, Save, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminService } from '../../services/adminService';

const unwrapPayload = (response) => response?.data?.data || response?.data || {};

const DOCUMENT_OPTIONS = [
  { type: 'aadhaar', label: 'Aadhaar', note: 'OTP to the Aadhaar-linked mobile' },
  { type: 'pan', label: 'PAN', note: 'Instant check' },
  { type: 'driving_license', label: 'Driving Licence', note: 'Instant check, needs date of birth' },
  { type: 'voter_id', label: 'Voter ID', note: 'Instant check' },
];

const REQUIREMENT_OPTIONS = [
  { value: 'optional', label: 'Optional', note: 'Never blocks a booking; verified riders get a badge' },
  { value: 'after_signup', label: 'Right after signup', note: 'Riders are asked to verify after login; bookings are blocked until they do' },
  { value: 'before_booking', label: 'Before the first booking', note: 'Any booking is blocked until the rider is verified' },
  { value: 'rental_outstation', label: 'Hourly rental & outstation only', note: 'City rides stay open; rentals and intercity need KYC' },
];

const ENDPOINT_FIELDS = [
  { key: 'aadhaar_generate_otp', label: 'Aadhaar - generate OTP' },
  { key: 'aadhaar_submit_otp', label: 'Aadhaar - submit OTP' },
  { key: 'pan', label: 'PAN' },
  { key: 'driving_license', label: 'Driving licence' },
  { key: 'voter_id', label: 'Voter ID' },
];

const inputClass = 'w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors';
const labelClass = 'block text-xs font-semibold text-gray-500 mb-1.5';

const SectionHeader = ({ icon, title, subtitle }) => {
  const Icon = icon;
  return (
  <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
    <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
      <Icon size={18} />
    </div>
    <div>
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <p className="text-xs text-gray-400">{subtitle}</p>
    </div>
  </div>
  );
};

const DRIVER_REQUIREMENT_OPTIONS = [
  { value: 'optional', label: 'Optional', note: 'Never blocks; drivers can verify from their profile' },
  { value: 'before_approval', label: 'Before admin approval', note: 'You cannot approve a driver until their KYC is verified' },
  { value: 'before_going_online', label: 'Before going online', note: 'Approved drivers cannot go online until verified' },
];

const AUDIENCES = {
  riders: {
    noun: 'rider',
    title: 'Rider',
    requirementOptions: REQUIREMENT_OPTIONS,
    offNote: 'When off, nothing is checked and no booking is blocked.',
  },
  drivers: {
    noun: 'driver',
    title: 'Driver',
    requirementOptions: DRIVER_REQUIREMENT_OPTIONS,
    offNote: 'When off, nothing is checked and no driver is blocked.',
  },
};

/// On/off, "when required", accepted documents and limits for one audience.
const KycRulesSection = ({ audience, rules, onChange }) => {
  const { noun, title, requirementOptions, offNote } = AUDIENCES[audience];
  const update = (key, value) => onChange({ ...rules, [key]: value });
  const toggleDocument = (type) => {
    const allowed = new Set(rules.allowed_documents || []);
    if (allowed.has(type)) allowed.delete(type);
    else allowed.add(type);
    update('allowed_documents', DOCUMENT_OPTIONS.map((d) => d.type).filter((t) => allowed.has(t)));
  };

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <SectionHeader icon={ShieldCheck} title={`${title} verification`} subtitle={`Turn identity checks on and decide when ${noun}s must complete them`} />

        <label className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 px-4 py-3">
          <span>
            <span className="block text-sm font-semibold text-gray-900">Enable KYC for {noun}s</span>
            <span className="block text-xs text-gray-500">{offNote}</span>
          </span>
          <input
            type="checkbox"
            checked={Boolean(rules.enabled)}
            onChange={(event) => update('enabled', event.target.checked)}
            className="h-5 w-5 accent-indigo-600"
          />
        </label>

        <div className="mt-5">
          <p className={labelClass}>When is verification required?</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {requirementOptions.map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer gap-3 rounded-lg border px-4 py-3 ${rules.required_for === option.value ? 'border-indigo-500 bg-indigo-50/40' : 'border-gray-200'}`}
              >
                <input
                  type="radio"
                  name={`${audience}_required_for`}
                  checked={rules.required_for === option.value}
                  onChange={() => update('required_for', option.value)}
                  className="mt-1 accent-indigo-600"
                />
                <span>
                  <span className="block text-sm font-semibold text-gray-900">{option.label}</span>
                  <span className="block text-xs text-gray-500">{option.note}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <SectionHeader icon={FileCheck2} title="Accepted documents" subtitle={`${title}s choose one of these to verify with`} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {DOCUMENT_OPTIONS.map((doc) => (
            <label key={doc.type} className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 px-4 py-3">
              <input
                type="checkbox"
                checked={(rules.allowed_documents || []).includes(doc.type)}
                onChange={() => toggleDocument(doc.type)}
                className="h-4 w-4 accent-indigo-600"
              />
              <span>
                <span className="block text-sm font-semibold text-gray-900">{doc.label}</span>
                <span className="block text-xs text-gray-500">{doc.note}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-5">
          <div>
            <label className={labelClass}>Name on document doesn't match profile</label>
            <select value={rules.name_mismatch} onChange={(event) => update('name_mismatch', event.target.value)} className={inputClass}>
              <option value="review">Hold for admin review</option>
              <option value="ignore">Accept anyway</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Max attempts per {noun} per day</label>
            <input type="number" min={1} max={50} value={rules.max_attempts_per_day} onChange={(event) => update('max_attempts_per_day', event.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Aadhaar OTP valid for (minutes)</label>
            <input type="number" min={2} max={30} value={rules.otp_expiry_minutes} onChange={(event) => update('otp_expiry_minutes', event.target.value)} className={inputClass} />
          </div>
        </div>
      </div>
    </>
  );
};

const UserKycSettings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [settings, setSettings] = useState(null);
  const [driverSettings, setDriverSettings] = useState(null);
  const [audience, setAudience] = useState('riders');

  const applyResponse = (response) => {
    const payload = unwrapPayload(response);
    if (payload.settings) setSettings(payload.settings);
    if (payload.driver_settings) setDriverSettings(payload.driver_settings);
    setKeyConfigured(Boolean(payload.metadata?.api_key_configured));
  };

  useEffect(() => {
    (async () => {
      try {
        applyResponse(await adminService.getUserKycSettings());
      } catch (error) {
        toast.error(error?.response?.data?.message || 'Could not load verification settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const updateProvider = (key, value) =>
    setSettings((current) => ({ ...current, provider: { ...current.provider, [key]: value } }));
  const updateEndpoint = (key, value) =>
    setSettings((current) => ({
      ...current,
      provider: { ...current.provider, endpoints: { ...current.provider.endpoints, [key]: value } },
    }));

  const handleSave = async (event) => {
    event.preventDefault();
    try {
      setSaving(true);
      applyResponse(await adminService.updateUserKycSettings({ ...settings, driver: driverSettings }));
      toast.success('Verification settings saved');
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || 'Could not save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    try {
      setTesting(true);
      const result = unwrapPayload(await adminService.testUserKycSettings());
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Test failed');
    } finally {
      setTesting(false);
    }
  };

  if (loading || !settings || !driverSettings) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Loader2 className="animate-spin text-indigo-600" size={32} />
      </div>
    );
  }

  const isMock = settings.provider?.environment === 'mock';

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="mb-6">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
          <span>Settings</span>
          <ChevronRight size={12} />
          <span>Third-party</span>
          <ChevronRight size={12} />
          <span className="text-gray-700">Identity Verification (KYC)</span>
        </div>
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">Identity Verification (QuickeKYC)</h1>
          <button
            type="button"
            onClick={() => window.history.back()}
            className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <ArrowLeft size={16} /> Back
          </button>
        </div>
      </div>

      <form onSubmit={handleSave} className="max-w-5xl mx-auto space-y-6">
        <div className="flex gap-2">
          {[['riders', 'Riders'], ['drivers', 'Drivers']].map(([key, label]) => {
            const isOn = key === 'riders' ? settings.enabled : driverSettings.enabled;
            const active = audience === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setAudience(key)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${active ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
              >
                {label}
                <span className={`ml-2 text-xs ${active ? 'text-indigo-100' : 'text-gray-400'}`}>{isOn ? 'On' : 'Off'}</span>
              </button>
            );
          })}
        </div>

        {audience === 'riders' ? (
          <KycRulesSection
            audience="riders"
            rules={settings}
            onChange={(next) => setSettings((current) => ({ ...next, provider: current.provider }))}
          />
        ) : (
          <KycRulesSection audience="drivers" rules={driverSettings} onChange={setDriverSettings} />
        )}

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <SectionHeader icon={KeyRound} title="QuickeKYC connection" subtitle="Shared by rider and driver verification. Credentials stay on the server and are never sent to the apps" />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className={labelClass}>Environment</label>
              <select value={settings.provider.environment} onChange={(event) => updateProvider('environment', event.target.value)} className={inputClass}>
                <option value="mock">Mock (no real checks, OTP 123456)</option>
                <option value="sandbox">QuickeKYC sandbox</option>
                <option value="live">QuickeKYC live</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>API key {keyConfigured ? '(saved; leave as is to keep)' : ''}</label>
              <input
                type="password"
                autoComplete="off"
                value={settings.provider.api_key}
                onChange={(event) => updateProvider('api_key', event.target.value)}
                placeholder={isMock ? 'Not needed in mock mode' : 'Paste the QuickeKYC API key'}
                className={inputClass}
              />
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Base URL</label>
              <input value={settings.provider.base_url} onChange={(event) => updateProvider('base_url', event.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Send key as</label>
              <select value={settings.provider.auth_mode} onChange={(event) => updateProvider('auth_mode', event.target.value)} className={inputClass}>
                <option value="body">Field in request body</option>
                <option value="header">Request header</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>{settings.provider.auth_mode === 'header' ? 'Header name' : 'Body field'}</label>
                <input value={settings.provider.auth_field} onChange={(event) => updateProvider('auth_field', event.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Prefix (optional)</label>
                <input
                  value={settings.provider.auth_prefix}
                  onChange={(event) => updateProvider('auth_prefix', event.target.value)}
                  disabled={settings.provider.auth_mode !== 'header'}
                  placeholder="Bearer"
                  className={`${inputClass} disabled:bg-gray-50`}
                />
              </div>
            </div>
          </div>

          <p className="mt-6 mb-3 text-xs font-semibold text-gray-500">Endpoint paths (from the QuickeKYC API docs)</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ENDPOINT_FIELDS.map((field) => (
              <div key={field.key}>
                <label className={labelClass}>{field.label}</label>
                <input value={settings.provider.endpoints?.[field.key] || ''} onChange={(event) => updateEndpoint(field.key, event.target.value)} className={inputClass} />
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium text-indigo-700 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
          >
            {testing ? <Loader2 size={16} className="animate-spin" /> : <PlugZap size={16} />} Test connection
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-60"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save settings
          </button>
        </div>
      </form>
    </div>
  );
};

export default UserKycSettings;
