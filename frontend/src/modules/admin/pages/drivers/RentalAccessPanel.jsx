import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminService } from '../../services/adminService';

/**
 * Hourly rental access for one driver: whether rental requests reach them,
 * why not if they don't, and the admin's block / allow switch. The driver's
 * own "Accept rental trips" toggle and their vehicle type's rental setting
 * are shown, not changed, here.
 */
const RentalAccessPanel = ({ driverId }) => {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    adminService.getDriverRentalAccess(driverId)
      .then((res) => { if (active) setState(res?.data || res || null); })
      .catch(() => {});
    return () => { active = false; };
  }, [driverId]);

  if (!state) return null;

  const toggleBlock = async () => {
    try {
      setBusy(true);
      const res = await adminService.updateDriverRentalAccess(driverId, { blockedByAdmin: !state.blockedByAdmin });
      setState(res?.data || res);
      toast.success(state.blockedByAdmin ? 'Rental trips allowed' : 'Rental trips blocked');
    } catch {
      toast.error('Could not update rental access');
    } finally {
      setBusy(false);
    }
  };

  const reason = state.receivesRentals
    ? 'Gets rental requests'
    : state.blockedByAdmin
      ? 'Blocked by admin'
      : !state.vehicleRentalEnabled
        ? 'Vehicle type not enabled for rental'
        : 'Driver turned rentals off in the app';

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div>
        <p className="text-sm font-semibold text-gray-900">Hourly rental trips</p>
        <p className={`text-xs ${state.receivesRentals ? 'text-emerald-600' : 'text-gray-500'}`}>
          {reason}
          {' · '}driver toggle {state.accepts ? 'on' : 'off'}
          {' · '}vehicle {state.vehicleRentalEnabled ? 'rental-enabled' : 'not enabled'}
        </p>
      </div>
      <button
        type="button"
        onClick={toggleBlock}
        disabled={busy}
        className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold ${
          state.blockedByAdmin ? 'bg-emerald-600 text-white' : 'border border-rose-200 text-rose-600'
        } disabled:opacity-60`}
      >
        {busy && <Loader2 size={12} className="animate-spin" />}
        {state.blockedByAdmin ? 'Allow rental trips' : 'Block rental trips'}
      </button>
    </div>
  );
};

export default RentalAccessPanel;
