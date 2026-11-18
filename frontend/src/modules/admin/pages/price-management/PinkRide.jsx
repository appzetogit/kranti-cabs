import React, { useEffect, useMemo, useState } from 'react';
import { Heart, Loader2, Save, Search, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminService } from '../../services/adminService';

const inputClass =
  'w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 bg-white focus:border-pink-500 focus:ring-1 focus:ring-pink-500 outline-none transition-colors';
const labelClass = 'block text-xs font-semibold text-gray-500 mb-1.5';

// The API answers { success, data }; the axios instance may or may not unwrap it.
const unwrap = (res) => {
  const body = res?.data ?? res;
  return body && body.success !== undefined ? body.data : body;
};
const firstArray = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['results', 'data', 'zones', 'items', 'list']) {
    const found = firstArray(value[key]);
    if (found.length) return found;
  }
  return [];
};
const idOf = (row) => String(row?._id || row?.id || '');

const Toggle = ({ on, onChange, label }) => (
  <button
    type="button"
    onClick={() => onChange(!on)}
    aria-pressed={on}
    aria-label={label}
    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${on ? 'bg-pink-600' : 'bg-gray-300'}`}
  >
    <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0'}`} />
  </button>
);

const Chips = ({ options, selected, onChange, emptyLabel }) => (
  <div>
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const on = selected.includes(option.id);
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(on ? selected.filter((id) => id !== option.id) : [...selected, option.id])}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${on ? 'bg-pink-600 border-pink-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-pink-300'}`}
          >
            {option.name}
          </button>
        );
      })}
    </div>
    <p className="text-[11px] text-gray-400 mt-1.5">{selected.length ? `${selected.length} selected` : emptyLabel}</p>
  </div>
);

/**
 * Pink Ride: rides offered only to women drivers approved for it.
 * Settings (where, which vehicles, extra charge, who may book) and the
 * women drivers list with approve / remove. Server: services/pinkRideService.js.
 */
const PinkRide = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState(null);
  const [zones, setZones] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [search, setSearch] = useState('');
  const [busyDriver, setBusyDriver] = useState('');

  const loadDrivers = async (term = '') => {
    try {
      const data = unwrap(await adminService.getPinkRideDrivers(term ? { search: term } : {}));
      setDrivers(firstArray(data));
    } catch {
      toast.error('Failed to load drivers');
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const [settingsRes, zonesRes, vehiclesRes] = await Promise.all([
          adminService.getPinkRideSettings(),
          adminService.getZones().catch(() => null),
          adminService.getVehicleTypes('taxi').catch(() => null),
        ]);
        setSettings(unwrap(settingsRes));
        setZones(firstArray(unwrap(zonesRes)).map((z) => ({ id: idOf(z), name: z.name || z.zone_name || 'Zone' })).filter((z) => z.id));
        setVehicles(firstArray(unwrap(vehiclesRes)).map((v) => ({ id: idOf(v), name: v.name || v.vehicle_name || 'Vehicle' })).filter((v) => v.id));
        await loadDrivers();
      } catch {
        toast.error('Failed to load Pink Ride settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = (patch) => setSettings((prev) => ({ ...prev, ...patch }));

  const save = async () => {
    try {
      setSaving(true);
      const payload = {
        enabled: Boolean(settings.enabled),
        zone_ids: settings.zone_ids || [],
        vehicle_type_ids: settings.vehicle_type_ids || [],
        extra_fee_type: settings.extra_fee_type,
        extra_fee: Number(settings.extra_fee) || 0,
        who_can_book: settings.who_can_book,
        require_kyc: Boolean(settings.require_kyc),
        title: settings.title,
        subtitle: settings.subtitle,
      };
      setSettings(unwrap(await adminService.updatePinkRideSettings(payload)));
      toast.success('Pink Ride settings saved');
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const setApproval = async (driver, approved) => {
    try {
      setBusyDriver(driver.id);
      const updated = unwrap(await adminService.setDriverPinkRide(driver.id, approved));
      setDrivers((prev) => prev.map((row) => (row.id === driver.id ? { ...row, ...updated } : row)));
      toast.success(approved ? `${driver.name || 'Driver'} approved for Pink Ride` : 'Approval removed');
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Failed to update driver');
    } finally {
      setBusyDriver('');
    }
  };

  const approvedCount = useMemo(() => drivers.filter((d) => d.approved).length, [drivers]);
  const onlineApproved = useMemo(() => drivers.filter((d) => d.approved && d.is_online).length, [drivers]);

  if (loading || !settings) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400">
        <Loader2 className="animate-spin" size={22} />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-pink-50 text-pink-600 flex items-center justify-center">
          <Heart size={20} />
        </div>
        <div>
          <h1 className="text-lg font-bold text-gray-900">Pink Ride</h1>
          <p className="text-sm text-gray-500">
            Rides offered only to women drivers you approve. If no approved woman driver is nearby the ride is not
            given to anyone else - the rider is told and can book a normal ride.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Settings */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-gray-900">Offer Pink Ride</h3>
              <p className="text-xs text-gray-400">Shows the Pink Ride option in the rider app.</p>
            </div>
            <Toggle on={Boolean(settings.enabled)} onChange={(on) => set({ enabled: on })} label="Offer Pink Ride" />
          </div>

          <div>
            <label className={labelClass}>Zones</label>
            <Chips
              options={zones}
              selected={settings.zone_ids || []}
              onChange={(ids) => set({ zone_ids: ids })}
              emptyLabel="None selected = every zone"
            />
          </div>

          <div>
            <label className={labelClass}>Vehicles</label>
            <Chips
              options={vehicles}
              selected={settings.vehicle_type_ids || []}
              onChange={(ids) => set({ vehicle_type_ids: ids })}
              emptyLabel="None selected = every vehicle"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Extra charge</label>
              <select className={inputClass} value={settings.extra_fee_type} onChange={(e) => set({ extra_fee_type: e.target.value })}>
                <option value="flat">Flat (₹)</option>
                <option value="percent">Percent of fare (%)</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>{settings.extra_fee_type === 'percent' ? 'Percent' : 'Amount (₹)'}</label>
              <input
                type="number"
                min="0"
                className={inputClass}
                value={settings.extra_fee}
                onChange={(e) => set({ extra_fee: e.target.value })}
              />
            </div>
          </div>
          <p className="text-[11px] text-gray-400 -mt-3">0 = same price as a normal ride.</p>

          <div>
            <label className={labelClass}>Who can book</label>
            <select className={inputClass} value={settings.who_can_book} onChange={(e) => set({ who_can_book: e.target.value })}>
              <option value="women_only">Women riders only</option>
              <option value="anyone">Anyone (e.g. booking for a mother or daughter)</option>
            </select>
          </div>

          {settings.who_can_book === 'women_only' && (
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                  <ShieldCheck size={15} className="text-pink-600" /> Require verified KYC (Aadhaar)
                </span>
                <p className="text-[11px] text-gray-400">Off = the gender on her profile is trusted.</p>
              </div>
              <Toggle on={Boolean(settings.require_kyc)} onChange={(on) => set({ require_kyc: on })} label="Require KYC" />
            </div>
          )}

          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className={labelClass}>Name in the app</label>
              <input className={inputClass} value={settings.title || ''} maxLength={40} onChange={(e) => set({ title: e.target.value })} />
            </div>
            <div>
              <label className={labelClass}>Line under it</label>
              <input className={inputClass} value={settings.subtitle || ''} maxLength={120} onChange={(e) => set({ subtitle: e.target.value })} />
            </div>
          </div>

          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 bg-pink-600 hover:bg-pink-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg py-2.5"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save settings
          </button>
        </div>

        {/* Drivers */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-bold text-gray-900">Women drivers</h3>
            <span className="text-xs text-gray-500">
              {approvedCount} approved · {onlineApproved} online now
            </span>
          </div>
          <p className="text-xs text-gray-400 mb-4">
            Approve a driver after checking her licence and Aadhaar. Only drivers whose gender is Female are listed.
          </p>
          <form
            className="relative mb-4"
            onSubmit={(e) => {
              e.preventDefault();
              loadDrivers(search.trim());
            }}
          >
            <Search size={15} className="absolute left-3 top-3 text-gray-400" />
            <input
              className={`${inputClass} pl-9`}
              placeholder="Search name, phone or vehicle number"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </form>

          <div className="divide-y divide-gray-100 max-h-[560px] overflow-y-auto">
            {drivers.length === 0 && <p className="text-sm text-gray-400 py-6 text-center">No women drivers found.</p>}
            {drivers.map((driver) => (
              <div key={driver.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    {driver.name || 'Driver'}
                    {driver.is_online && <span className="ml-2 text-[10px] font-bold text-green-600">ONLINE</span>}
                    {driver.only_pink && <span className="ml-2 text-[10px] font-bold text-pink-600">PINK ONLY</span>}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {driver.phone} · {driver.vehicle_type || '-'} {driver.vehicle_number ? `· ${driver.vehicle_number}` : ''}
                    {!driver.is_female && <span className="text-red-500"> · gender not Female</span>}
                  </p>
                </div>
                {driver.approved ? (
                  <button
                    type="button"
                    disabled={busyDriver === driver.id}
                    onClick={() => setApproval(driver, false)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:border-red-300 hover:text-red-600 disabled:opacity-50"
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busyDriver === driver.id || !driver.is_female}
                    onClick={() => setApproval(driver, true)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-pink-600 text-white hover:bg-pink-700 disabled:opacity-50"
                  >
                    Approve
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PinkRide;
