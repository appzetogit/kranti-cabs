import React from 'react';
import { Car, Plus, Trash2 } from 'lucide-react';
import { PARKING_VEHICLE_CLASSES, defaultParking, emptyParkingRule } from './parkingRules';

const inputClass = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors";
const labelClass = "block text-xs font-semibold text-gray-500 mb-1.5";

/**
 * Parking a hub charges per vehicle class: what a pickup costs by how long the
 * driver waited inside the hub, and a flat drop-off fee. The server adds it to
 * the fare at the end of the trip and pays it all to the driver.
 */
const ParkingRulesEditor = ({ value, onChange }) => {
  const parking = value || defaultParking();
  const set = (patch) => onChange({ ...parking, ...patch });
  const setRule = (index, patch) =>
    set({ rules: parking.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)) });
  const setSlab = (ruleIndex, slabIndex, patch) =>
    setRule(ruleIndex, {
      slabs: parking.rules[ruleIndex].slabs.map((slab, i) => (i === slabIndex ? { ...slab, ...patch } : slab)),
    });

  const usedClasses = parking.rules.map((rule) => rule.vehicle_class);
  const nextFreeClass = PARKING_VEHICLE_CLASSES.find((option) => !usedClasses.includes(option.value));

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-5 pb-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
            <Car size={18} />
          </div>
          <div>
            <h3 className="text-sm text-gray-900 font-bold">Parking Charges</h3>
            <p className="text-xs text-gray-400">Timed from the driver's live location inside the boundary. Paid fully to the driver.</p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(parking.enabled)}
            onChange={(e) => set({ enabled: e.target.checked })}
            className="h-4 w-4 accent-indigo-600"
          />
          Enabled
        </label>
      </div>

      {parking.enabled ? (
        <div className="space-y-5">
          <div className="max-w-xs">
            <label className={labelClass}>Max minutes billed</label>
            <input
              type="number" min="1" value={parking.max_minutes}
              onChange={(e) => set({ max_minutes: e.target.value })}
              className={inputClass}
            />
            <p className="text-[10px] text-gray-400 mt-1">Caps the stay if a driver forgets to start the trip.</p>
          </div>

          {parking.rules.map((rule, ruleIndex) => (
            <div key={ruleIndex} className="rounded-lg border border-gray-200 p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                <div>
                  <label className={labelClass}>Vehicle class</label>
                  <select
                    value={rule.vehicle_class}
                    onChange={(e) => setRule(ruleIndex, { vehicle_class: e.target.value })}
                    className={inputClass}
                  >
                    {PARKING_VEHICLE_CLASSES.map((option) => (
                      <option
                        key={option.value}
                        value={option.value}
                        disabled={option.value !== rule.vehicle_class && usedClasses.includes(option.value)}
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Drop-off fee</label>
                  <input
                    type="number" min="0" step="0.01" value={rule.drop_fee} placeholder="0"
                    onChange={(e) => setRule(ruleIndex, { drop_fee: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => set({ rules: parking.rules.filter((_, i) => i !== ruleIndex) })}
                  className="h-[38px] px-3 rounded-lg border border-gray-200 text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                  aria-label="Remove vehicle class"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <div>
                <label className={labelClass}>Pickup parking by wait time</label>
                <div className="space-y-2">
                  {rule.slabs.map((slab, slabIndex) => (
                    <div key={slabIndex} className="flex items-center gap-2 text-sm text-gray-600">
                      <span className="shrink-0">Up to</span>
                      <input
                        type="number" min="1" value={slab.up_to_minutes}
                        onChange={(e) => setSlab(ruleIndex, slabIndex, { up_to_minutes: e.target.value })}
                        className={`${inputClass} w-24`}
                      />
                      <span className="shrink-0">min</span>
                      <input
                        type="number" min="0" step="0.01" value={slab.fee} placeholder="Fee"
                        onChange={(e) => setSlab(ruleIndex, slabIndex, { fee: e.target.value })}
                        className={`${inputClass} w-28`}
                      />
                      <button
                        type="button"
                        onClick={() => setRule(ruleIndex, { slabs: rule.slabs.filter((_, i) => i !== slabIndex) })}
                        className="p-2 text-gray-400 hover:text-rose-600"
                        aria-label="Remove slab"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const last = rule.slabs[rule.slabs.length - 1];
                    setRule(ruleIndex, {
                      slabs: [...rule.slabs, { up_to_minutes: (Number(last?.up_to_minutes) || 0) + 10, fee: '' }],
                    });
                  }}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                >
                  <Plus size={12} /> Add slab
                </button>
                <p className="text-[10px] text-gray-400 mt-1">
                  A stay longer than the last slab pays the last slab's fee. No slabs means pickups pay no parking.
                </p>
              </div>
            </div>
          ))}

          {nextFreeClass ? (
            <button
              type="button"
              onClick={() => set({ rules: [...parking.rules, emptyParkingRule(nextFreeClass.value)] })}
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              <Plus size={14} /> Add vehicle class
            </button>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-gray-400">No parking is charged at this hub.</p>
      )}
    </div>
  );
};

export default ParkingRulesEditor;
