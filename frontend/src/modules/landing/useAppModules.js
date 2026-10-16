import { useEffect, useState } from 'react';
import api from '../../shared/api/axiosInstance';

/**
 * The services the app actually offers, from the admin's app-module list.
 *
 * "Our Services" used to render a hand-maintained list that had drifted from the
 * product — it advertised Premium Sedan, SUV, Hotel Pickup and Mall Pickup, and
 * omitted Parcel and Bus, which the app does offer. These come from the same
 * records the mobile app reads, so adding or retiring a module updates the
 * website with it.
 *
 * Returns an empty array until it resolves, and on failure, so the caller can
 * fall back to the CMS copy rather than render an empty section.
 */
export default function useAppModules() {
  const [modules, setModules] = useState([]);

  useEffect(() => {
    let alive = true;

    api
      .get('/users/bootstrap')
      .then((response) => {
        if (!alive) return;
        const list = response?.data?.data?.modules ?? response?.data?.modules;
        if (!Array.isArray(list)) return;

        setModules(
          list
            .filter((item) => Number(item?.active) === 1)
            .sort((a, b) => (Number(a?.order_by) || 0) - (Number(b?.order_by) || 0))
            .map((item) => ({
              id: item.id || item._id,
              title: item.name || '',
              desc: item.short_description || item.description || '',
              image: item.mobile_menu_icon || '',
              transportType: item.transport_type || '',
            })),
        );
      })
      .catch(() => {
        /* caller falls back to the CMS list */
      });

    return () => {
      alive = false;
    };
  }, []);

  return modules;
}
