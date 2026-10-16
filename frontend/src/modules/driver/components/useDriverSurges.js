import { useEffect, useState } from 'react';
import api from '../../../shared/api/axiosInstance';

const REFRESH_MS = 60 * 1000;

/// Surge hexagons near the driver, as on Rapido's "Surge Fare Area" map, so an
/// idle driver can see where riders outnumber drivers and head there. Refreshed
/// every minute while `enabled` (the driver is online).
export const useDriverSurges = (position, enabled) => {
  const [areas, setAreas] = useState([]);
  const lat = position?.lat;
  const lng = position?.lng;
  const active = enabled && Number.isFinite(lat) && Number.isFinite(lng);

  useEffect(() => {
    if (!active) return undefined;

    let cancelled = false;
    const load = async () => {
      try {
        const res = await api.get('/drivers/surge-map', { params: { lat, lng, radius_km: 15 } });
        const payload = res?.data || res || {};
        if (!cancelled) setAreas(Array.isArray(payload.results) ? payload.results : []);
      } catch {
        // A missing surge map must never get in the way of taking rides.
      }
    };

    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // Re-fetch when the driver moves roughly a kilometre, not on every GPS tick.
  }, [active, lat && Number(lat).toFixed(2), lng && Number(lng).toFixed(2)]); // eslint-disable-line react-hooks/exhaustive-deps

  // Offline drivers see no surge, whatever was last fetched.
  return active ? areas : [];
};
