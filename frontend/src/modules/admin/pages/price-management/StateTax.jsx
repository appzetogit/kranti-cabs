import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Loader2, X, Save, ChevronRight, Landmark } from 'lucide-react';
import { adminService } from '../../services/adminService';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';

const inputClass =
  "w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors";
const labelClass = "block text-xs font-semibold text-gray-500 mb-1.5";

const TAX_TYPES = [
  { value: 'state_tax', label: 'State tax' },
  { value: 'mcd_tax', label: 'MCD tax' },
];
const typeLabel = (value) => TAX_TYPES.find((t) => t.value === value)?.label || 'State tax';

const CLASSES = [
  { key: 'bike', label: 'Bike' },
  { key: 'auto', label: 'Auto' },
  { key: 'car', label: 'Car' },
];

const StatusToggle = ({ active, onToggle }) => (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      onToggle();
    }}
    className={`w-11 h-6 rounded-full transition-colors relative flex items-center px-0.5 ${
      active ? 'bg-indigo-600' : 'bg-gray-300'
    }`}
  >
    <div
      className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
        active ? 'translate-x-5' : 'translate-x-0'
      }`}
    />
  </button>
);

const SegmentedControl = ({ options, value, onChange }) => (
  <div className="inline-flex bg-gray-100 rounded-lg p-1 w-full">
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        onClick={() => onChange(option.value)}
        className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
          value === option.value ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        {option.label}
      </button>
    ))}
  </div>
);

const emptyForm = {
  name: '',
  tax_type: 'state_tax',
  state: '',
  fees: { bike: '', auto: '', car: '' },
  active: true,
};

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;

/**
 * State tax and MCD tax a vehicle pays to enter a state, or Delhi.
 *
 * A trip pays a rule when its drop is in the rule's state and its pickup is
 * not. The server adds it to the fare at booking and passes it to the driver
 * without commission, as it does the railway station entry fee.
 */
const StateTax = () => {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [rules, setRules] = useState([]);
  const [editing, setEditing] = useState(null); // null = closed, {} = create
  const [formData, setFormData] = useState(emptyForm);

  const fetchRules = async () => {
    try {
      setLoading(true);
      const res = await adminService.getStateTaxes();
      const data = res?.data?.results || res?.results || [];
      setRules(Array.isArray(data) ? data : []);
    } catch {
      toast.error('Failed to load tax rules');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRules();
  }, []);

  const openCreate = () => {
    setFormData(emptyForm);
    setEditing({});
  };

  const openEdit = (rule) => {
    setFormData({
      name: rule.name || '',
      tax_type: rule.tax_type || 'state_tax',
      state: rule.state || '',
      fees: {
        bike: String(rule.fees?.bike ?? ''),
        auto: String(rule.fees?.auto ?? ''),
        car: String(rule.fees?.car ?? ''),
      },
      active: rule.active !== false,
    });
    setEditing(rule);
  };

  const setFee = (key, value) => setFormData({ ...formData, fees: { ...formData.fees, [key]: value } });

  const handleSave = async () => {
    const name = formData.name.trim();
    const state = formData.state.trim();
    if (!name) {
      toast.error('Name is required');
      return;
    }
    if (!state) {
      toast.error('State is required');
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        name,
        tax_type: formData.tax_type,
        state,
        fees: Object.fromEntries(CLASSES.map(({ key }) => [key, Number(formData.fees[key]) || 0])),
        active: formData.active,
      };

      if (editing?.id) {
        await adminService.updateStateTax(editing.id, payload);
        toast.success('Tax rule updated');
      } else {
        await adminService.createStateTax(payload);
        toast.success('Tax rule added');
      }

      setEditing(null);
      await fetchRules();
    } catch (err) {
      toast.error(err?.message || 'Could not save the tax rule');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (rule) => {
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, active: !r.active } : r)));
    try {
      await adminService.updateStateTax(rule.id, { active: !rule.active });
    } catch {
      toast.error('Could not update the tax rule');
      fetchRules();
    }
  };

  const handleDelete = async (rule) => {
    if (!window.confirm(`Delete “${rule.name}”?\n\nRides already booked keep the tax they were charged.`)) {
      return;
    }
    try {
      await adminService.deleteStateTax(rule.id);
      toast.success('Tax rule deleted');
      await fetchRules();
    } catch {
      toast.error('Could not delete the tax rule');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="mb-6">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
          <span>Price Management</span>
          <ChevronRight size={12} />
          <span className="text-gray-700">State &amp; MCD Tax</span>
        </div>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">State &amp; MCD Tax</h1>
            <p className="text-sm text-gray-500 mt-1 max-w-2xl">
              Charged when a trip&apos;s drop is in this state and its pickup is not. Added to the fare at booking and
              paid to the driver without commission. Leave a vehicle&apos;s amount at 0 to not charge it.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm px-4 py-2.5 rounded-lg transition-colors"
          >
            <Plus size={16} /> Add Tax
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="animate-spin" size={22} />
          </div>
        ) : rules.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-gray-500 text-sm">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 mb-3">
              <Landmark size={18} />
            </div>
            No state or MCD tax set up yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left font-semibold px-5 py-3">Name</th>
                  <th className="text-left font-semibold px-5 py-3">State</th>
                  <th className="text-left font-semibold px-5 py-3">Type</th>
                  {CLASSES.map(({ key, label }) => (
                    <th key={key} className="text-right font-semibold px-5 py-3">{label}</th>
                  ))}
                  <th className="text-left font-semibold px-5 py-3 w-24">Active</th>
                  <th className="text-right font-semibold px-5 py-3 w-28">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id} className="border-t border-gray-100 hover:bg-gray-50/60">
                    <td className="px-5 py-3.5 font-medium text-gray-900">{rule.name}</td>
                    <td className="px-5 py-3.5 text-gray-700">{rule.state}</td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex px-2 py-0.5 rounded-md text-xs font-medium bg-indigo-50 text-indigo-700">
                        {typeLabel(rule.tax_type)}
                      </span>
                    </td>
                    {CLASSES.map(({ key }) => (
                      <td key={key} className="px-5 py-3.5 text-right text-gray-700">
                        {Number(rule.fees?.[key]) > 0 ? money(rule.fees[key]) : '—'}
                      </td>
                    ))}
                    <td className="px-5 py-3.5">
                      <StatusToggle active={rule.active !== false} onToggle={() => handleToggleActive(rule)} />
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(rule)}
                          className="p-2 rounded-lg text-gray-500 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                          title="Edit"
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(rule)}
                          className="p-2 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
            onClick={() => !submitting && setEditing(null)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="bg-white rounded-xl border border-gray-200 w-full max-w-md p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5 pb-4 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-900">
                  {editing?.id ? 'Edit Tax' : 'Add Tax'}
                </h2>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className={labelClass}>Type</label>
                  <SegmentedControl
                    options={TAX_TYPES}
                    value={formData.tax_type}
                    onChange={(value) => setFormData({ ...formData, tax_type: value })}
                  />
                </div>

                <div>
                  <label className={labelClass}>Name *</label>
                  <input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder={formData.tax_type === 'mcd_tax' ? 'e.g. Delhi MCD entry tax' : 'e.g. Rajasthan state tax'}
                    className={inputClass}
                    autoFocus
                  />
                </div>

                <div>
                  <label className={labelClass}>State *</label>
                  <input
                    value={formData.state}
                    onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                    placeholder={formData.tax_type === 'mcd_tax' ? 'Delhi' : 'e.g. Rajasthan'}
                    className={inputClass}
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Full state name as on Google Maps (e.g. Rajasthan, Delhi) or its code (RJ, DL).
                  </p>
                </div>

                <div>
                  <label className={labelClass}>Amount per vehicle (₹)</label>
                  <div className="grid grid-cols-3 gap-3">
                    {CLASSES.map(({ key, label }) => (
                      <div key={key}>
                        <span className="block text-[11px] text-gray-400 mb-1">{label}</span>
                        <input
                          type="number"
                          min="0"
                          value={formData.fees[key]}
                          onChange={(e) => setFee(key, e.target.value)}
                          placeholder="0"
                          className={inputClass}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-sm font-medium text-gray-700">Active</span>
                  <StatusToggle
                    active={formData.active}
                    onToggle={() => setFormData({ ...formData, active: !formData.active })}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  disabled={submitting}
                  className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={submitting}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-medium text-sm px-4 py-2 rounded-lg"
                >
                  {submitting ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  Save
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default StateTax;
