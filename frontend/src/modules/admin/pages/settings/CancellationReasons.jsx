import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Search, Edit2, Trash2, Loader2, X, Save, Info, ChevronRight, ListChecks } from 'lucide-react';
import { adminService } from '../../services/adminService';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';

const inputClass =
  "w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors";
const labelClass = "block text-xs font-semibold text-gray-500 mb-1.5";

// When in the trip a rider reason is offered. Driver reasons are always 'any'.
const STAGES = [
  { value: 'any', label: 'Any time' },
  { value: 'before_driver', label: 'Before driver assigned' },
  { value: 'after_driver', label: 'After driver assigned' },
];
const stageLabel = (value) => STAGES.find((s) => s.value === (value || 'any'))?.label || 'Any time';

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

const SegmentedControl = ({ options, value, onChange, full = false }) => (
  <div className={`inline-flex bg-gray-100 rounded-lg p-1 ${full ? 'w-full' : ''}`}>
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        onClick={() => onChange(option.value)}
        className={`${full ? 'flex-1' : ''} px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
          value === option.value ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        {option.label}
      </button>
    ))}
  </div>
);

const AUDIENCES = [
  { value: 'user', label: 'Rider' },
  { value: 'driver', label: 'Driver' },
];

const emptyForm = {
  title: '',
  audience: 'user',
  stage: 'any',
  order_by: '',
  requiresNote: false,
  active: true,
};

/**
 * Manages the reasons riders and drivers pick from when they cancel a trip.
 *
 * The apps read this list at cancel time, so wording changes take effect
 * without an app release. Rider reasons can be limited to before or after a
 * driver is assigned, since "no driver yet" and "driver is late" differ.
 */
const CancellationReasons = () => {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reasons, setReasons] = useState([]);
  const [audience, setAudience] = useState('user');
  const [stageFilter, setStageFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [editing, setEditing] = useState(null); // null = closed, {} = create
  const [formData, setFormData] = useState(emptyForm);

  const fetchReasons = async () => {
    try {
      setLoading(true);
      const res = await adminService.getCancellationReasons();
      const data = res?.data?.results || res?.results || [];
      setReasons(Array.isArray(data) ? data : []);
    } catch {
      toast.error('Failed to load cancellation reasons');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReasons();
  }, []);

  const visibleReasons = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return reasons
      .filter((r) => (r.audience || 'user') === audience)
      .filter((r) => {
        if (audience !== 'user' || stageFilter === 'all') return true;
        // A reason for 'any' stage shows in both lists, so it belongs to both filters.
        const stage = r.stage || 'any';
        return stage === stageFilter || stage === 'any';
      })
      .filter((r) => (term ? (r.title || '').toLowerCase().includes(term) : true))
      .sort((a, b) => (a.order_by || 0) - (b.order_by || 0));
  }, [reasons, audience, stageFilter, searchTerm]);

  const openCreate = () => {
    // Defaults to the end of the currently shown list so a new reason does not
    // silently jump above existing ones.
    const nextOrder = visibleReasons.length
      ? Math.max(...visibleReasons.map((r) => Number(r.order_by) || 0)) + 1
      : 1;
    setFormData({
      ...emptyForm,
      audience,
      stage: audience === 'user' && stageFilter !== 'all' ? stageFilter : 'any',
      order_by: String(nextOrder),
    });
    setEditing({});
  };

  const openEdit = (reason) => {
    setFormData({
      title: reason.title || '',
      audience: reason.audience || 'user',
      stage: reason.stage || 'any',
      order_by: String(reason.order_by ?? ''),
      requiresNote: Boolean(reason.requiresNote),
      active: reason.active !== false,
    });
    setEditing(reason);
  };

  const handleSave = async () => {
    const title = formData.title.trim();
    if (!title) {
      toast.error('Reason text is required');
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        title,
        audience: formData.audience,
        stage: formData.audience === 'user' ? formData.stage : 'any',
        order_by: Number(formData.order_by) || 0,
        requiresNote: formData.requiresNote,
        active: formData.active,
      };

      if (editing?.id) {
        await adminService.updateCancellationReason(editing.id, payload);
        toast.success('Cancellation reason updated');
      } else {
        await adminService.createCancellationReason(payload);
        toast.success('Cancellation reason added');
      }

      setEditing(null);
      await fetchReasons();
    } catch (err) {
      toast.error(err?.message || 'Could not save the cancellation reason');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (reason) => {
    // Optimistic so the switch feels instant; reverted by the refetch on error.
    setReasons((prev) =>
      prev.map((r) => (r.id === reason.id ? { ...r, active: !r.active } : r)),
    );

    try {
      await adminService.updateCancellationReason(reason.id, { active: !reason.active });
    } catch {
      toast.error('Could not update the reason');
      fetchReasons();
    }
  };

  const handleDelete = async (reason) => {
    if (!window.confirm(`Delete “${reason.title}”?\n\nRides already cancelled with this reason keep their recorded text.`)) {
      return;
    }

    try {
      await adminService.deleteCancellationReason(reason.id);
      toast.success('Cancellation reason deleted');
      await fetchReasons();
    } catch {
      toast.error('Could not delete the reason');
    }
  };

  const isRider = audience === 'user';

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="mb-6">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
          <span>App Settings</span>
          <ChevronRight size={12} />
          <span className="text-gray-700">Cancellation Reasons</span>
        </div>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Cancellation Reasons</h1>
            <p className="text-sm text-gray-500 mt-1">
              Riders must pick one of these when they cancel. “Other” with a typed note is always offered too.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm px-4 py-2.5 rounded-lg transition-colors"
          >
            <Plus size={16} /> Add Reason
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex items-center gap-3 p-4 border-b border-gray-100 flex-wrap">
          <SegmentedControl options={AUDIENCES} value={audience} onChange={setAudience} />
          {isRider && (
            <SegmentedControl
              options={[{ value: 'all', label: 'All stages' }, ...STAGES.slice(1)]}
              value={stageFilter}
              onChange={setStageFilter}
            />
          )}
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search reasons"
              className={`${inputClass} pl-9`}
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="animate-spin" size={22} />
          </div>
        ) : visibleReasons.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-gray-500 text-sm">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 mb-3">
              <ListChecks size={18} />
            </div>
            No cancellation reasons for {isRider ? 'riders' : 'drivers'} yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left font-semibold px-5 py-3 w-16">Order</th>
                  <th className="text-left font-semibold px-5 py-3">Reason</th>
                  {isRider && <th className="text-left font-semibold px-5 py-3 w-52">Shown</th>}
                  <th className="text-left font-semibold px-5 py-3 w-32">Asks for note</th>
                  <th className="text-left font-semibold px-5 py-3 w-24">Active</th>
                  <th className="text-right font-semibold px-5 py-3 w-28">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleReasons.map((reason) => (
                  <tr key={reason.id} className="border-t border-gray-100 hover:bg-gray-50/60">
                    <td className="px-5 py-3.5 text-gray-500">{reason.order_by ?? 0}</td>
                    <td className="px-5 py-3.5 font-medium text-gray-900">{reason.title}</td>
                    {isRider && (
                      <td className="px-5 py-3.5">
                        <span className="inline-flex px-2 py-0.5 rounded-md text-xs font-medium bg-indigo-50 text-indigo-700">
                          {stageLabel(reason.stage)}
                        </span>
                      </td>
                    )}
                    <td className="px-5 py-3.5 text-gray-500">{reason.requiresNote ? 'Yes' : '—'}</td>
                    <td className="px-5 py-3.5">
                      <StatusToggle active={reason.active !== false} onToggle={() => handleToggleActive(reason)} />
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(reason)}
                          className="p-2 rounded-lg text-gray-500 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                          title="Edit"
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(reason)}
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
                  {editing?.id ? 'Edit Reason' : 'Add Reason'}
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
                  <label className={labelClass}>Reason text *</label>
                  <input
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="e.g. Driver is taking too long"
                    className={inputClass}
                    autoFocus
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Shown to</label>
                    <SegmentedControl
                      full
                      options={AUDIENCES}
                      value={formData.audience}
                      onChange={(value) => setFormData({ ...formData, audience: value })}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Order</label>
                    <input
                      type="number"
                      value={formData.order_by}
                      onChange={(e) => setFormData({ ...formData, order_by: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                </div>

                {formData.audience === 'user' && (
                  <div>
                    <label className={labelClass}>When in the trip</label>
                    <select
                      value={formData.stage}
                      onChange={(e) => setFormData({ ...formData, stage: e.target.value })}
                      className={inputClass}
                    >
                      {STAGES.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                )}

                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.requiresNote}
                    onChange={(e) => setFormData({ ...formData, requiresNote: e.target.checked })}
                    className="mt-0.5 w-4 h-4 accent-indigo-600"
                  />
                  <span className="text-sm text-gray-700">
                    Ask for a written note
                    <span className="block text-xs text-gray-400 mt-0.5">
                      The rider must type a few words when picking this reason.
                    </span>
                  </span>
                </label>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-sm font-medium text-gray-700">Active</span>
                  <StatusToggle
                    active={formData.active}
                    onToggle={() => setFormData({ ...formData, active: !formData.active })}
                  />
                </div>

                <div className="flex items-start gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
                  <Info size={14} className="mt-0.5 shrink-0" />
                  <span>
                    Rides already cancelled keep the wording the customer saw, so editing this
                    will not rewrite past records.
                  </span>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  disabled={submitting}
                  className="flex-1 bg-gray-50 border border-gray-200 text-gray-600 font-medium text-sm py-2.5 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-medium text-sm py-2.5 rounded-lg transition-colors"
                >
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
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

export default CancellationReasons;
