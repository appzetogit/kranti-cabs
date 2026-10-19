import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion as Motion } from 'framer-motion';
import { ArrowLeft, Check, Clock3, Gauge, Info, LoaderCircle, LocateFixed, MapPin, Search, Users, X } from 'lucide-react';
import { useAppGoogleMapsLoader } from '../../../admin/utils/googleMaps';
import { getSavedLocation, saveLocation } from '../../services/locationStore';
import { userService } from '../../services/userService';

const formatRupees = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const formatDuration = (minutes) => {
  const hours = Math.floor(Number(minutes || 0) / 60);
  const rest = Number(minutes || 0) % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr${hours === 1 ? '' : 's'}`;
};

const generateSearchNonce = () => `rental-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const readSavedPickup = () => {
  const saved = getSavedLocation();
  if (!saved || !Number.isFinite(saved.lat) || !Number.isFinite(saved.lon)) return null;
  return { address: saved.address || 'Current location', coords: [saved.lon, saved.lat] };
};

const PickupSearch = ({ isLoaded, onSelect, onClose }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const serviceRef = useRef(null);
  const geocoderRef = useRef(null);

  useEffect(() => {
    if (!isLoaded || !window.google?.maps?.places) return;
    serviceRef.current = new window.google.maps.places.AutocompleteService();
    geocoderRef.current = new window.google.maps.Geocoder();
  }, [isLoaded]);

  useEffect(() => {
    const text = query.trim();
    if (!text || !serviceRef.current) return undefined;
    const timer = setTimeout(() => {
      serviceRef.current.getPlacePredictions(
        { input: text, componentRestrictions: { country: 'in' } },
        (predictions) => setResults(Array.isArray(predictions) ? predictions.slice(0, 6) : []),
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const choose = (prediction) => {
    if (!geocoderRef.current) return;
    setBusy(true);
    geocoderRef.current.geocode({ placeId: prediction.place_id }, (geocoded, status) => {
      setBusy(false);
      const place = geocoded?.[0];
      const point = place?.geometry?.location;
      if (status !== 'OK' || !point) return;
      onSelect({
        address: prediction.description || place.formatted_address,
        coords: [point.lng(), point.lat()],
      });
    });
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) return;
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const finish = (address) => {
          setBusy(false);
          onSelect({ address: address || 'Current location', coords: [coords.longitude, coords.latitude] });
        };
        if (!geocoderRef.current) {
          finish('');
          return;
        }
        geocoderRef.current.geocode(
          { location: { lat: coords.latitude, lng: coords.longitude } },
          (geocoded, status) => finish(status === 'OK' ? geocoded?.[0]?.formatted_address : ''),
        );
      },
      () => setBusy(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <div className="fixed inset-0 z-40 mx-auto flex max-w-lg flex-col bg-white">
      <div className="flex items-center gap-3 border-b border-slate-200 px-5 pb-4 pt-10">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-700"
        >
          <X size={18} />
        </button>
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (!event.target.value.trim()) setResults([]);
            }}
            placeholder="Search pickup location"
            className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-blue-500"
          />
        </div>
      </div>
      <button
        type="button"
        onClick={useCurrentLocation}
        className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 text-left text-sm font-medium text-blue-700"
      >
        <LocateFixed size={18} />
        Use my current location
        {busy ? <LoaderCircle size={16} className="ml-auto animate-spin text-slate-400" /> : null}
      </button>
      <div className="flex-1 overflow-y-auto">
        {results.map((prediction) => (
          <button
            type="button"
            key={prediction.place_id}
            onClick={() => choose(prediction)}
            className="flex w-full items-start gap-3 border-b border-slate-100 px-5 py-3.5 text-left"
          >
            <MapPin size={16} className="mt-0.5 shrink-0 text-slate-400" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-slate-900">
                {prediction.structured_formatting?.main_text || prediction.description}
              </span>
              <span className="block truncate text-xs text-slate-500">
                {prediction.structured_formatting?.secondary_text || ''}
              </span>
            </span>
          </button>
        ))}
        {!isLoaded ? <p className="px-5 py-6 text-sm text-slate-500">Loading maps…</p> : null}
      </div>
    </div>
  );
};

const HourlyRental = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const routePrefix = location.pathname.startsWith('/taxi/user') ? '/taxi/user' : '';
  const { isLoaded } = useAppGoogleMapsLoader();

  const [pickup, setPickup] = useState(readSavedPickup);
  const [showPickupSearch, setShowPickupSearch] = useState(false);
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedPackageId, setSelectedPackageId] = useState('');
  const [selectedVehicleId, setSelectedVehicleId] = useState('');

  const pickupKey = pickup ? pickup.coords.join(',') : '';

  const loadPackages = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params = pickup ? { lat: pickup.coords[1], lng: pickup.coords[0] } : {};
      const response = await userService.getHourlyRentalPackages(params);
      const results = Array.isArray(response?.results) ? response.results : [];
      setPackages(results);
      setSelectedPackageId((current) => (results.some((pkg) => pkg.id === current) ? current : results[0]?.id || ''));
    } catch {
      setError('Could not load rental packages. Please try again.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupKey]);

  useEffect(() => {
    loadPackages();
  }, [loadPackages]);

  const selectedPackage = useMemo(
    () => packages.find((pkg) => pkg.id === selectedPackageId) || null,
    [packages, selectedPackageId],
  );

  useEffect(() => {
    if (!selectedPackage) return;
    if (!selectedPackage.vehicles.some((vehicle) => vehicle.vehicleTypeId === selectedVehicleId)) {
      setSelectedVehicleId(selectedPackage.vehicles[0]?.vehicleTypeId || '');
    }
  }, [selectedPackage, selectedVehicleId]);

  const selectedVehicle = useMemo(
    () => selectedPackage?.vehicles.find((vehicle) => vehicle.vehicleTypeId === selectedVehicleId) || null,
    [selectedPackage, selectedVehicleId],
  );

  const handlePickupSelected = (next) => {
    setPickup(next);
    setShowPickupSearch(false);
    saveLocation({ address: next.address, lat: next.coords[1], lon: next.coords[0], updatedAt: Date.now() });
  };

  const handleBook = () => {
    if (!pickup || !selectedPackage || !selectedVehicle) return;

    navigate(`${routePrefix}/ride/searching`, {
      state: {
        pickup: pickup.address,
        drop: pickup.address,
        pickupCoords: pickup.coords,
        // A rental has no fixed drop; the trip ends wherever the rider ends it.
        dropCoords: pickup.coords,
        fare: selectedVehicle.price,
        baseFare: selectedVehicle.price,
        estimatedDistanceMeters: selectedVehicle.includedKm * 1000,
        estimatedDurationMinutes: selectedVehicle.includedMinutes,
        vehicleTypeId: selectedVehicle.vehicleTypeId,
        vehicleIconType: selectedVehicle.iconType,
        vehicleIconUrl: selectedVehicle.icon,
        vehicle: {
          id: selectedVehicle.vehicleTypeId,
          vehicleTypeId: selectedVehicle.vehicleTypeId,
          name: selectedVehicle.vehicleName,
          price: selectedVehicle.price,
          icon: selectedVehicle.icon,
          iconType: selectedVehicle.iconType,
        },
        paymentMethod: 'Cash',
        serviceType: 'hourly_rental',
        transport_type: 'taxi',
        bookingMode: 'normal',
        searchNonce: generateSearchNonce(),
        rental: {
          packagePriceId: selectedPackage.id,
          packageName: selectedPackage.name,
          includedKm: selectedVehicle.includedKm,
          includedMinutes: selectedVehicle.includedMinutes,
          extraKmRate: selectedVehicle.extraKmRate,
          extraMinuteRate: selectedVehicle.extraMinuteRate,
        },
      },
    });
  };

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-slate-50 pb-36">
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-5 pb-4 pt-10 backdrop-blur">
        <div className="flex items-center gap-3">
          <Motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700"
          >
            <ArrowLeft size={18} />
          </Motion.button>
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500">Hourly rental</p>
            <h1 className="truncate text-lg font-semibold text-slate-900">Book a cab by the hour</h1>
          </div>
        </div>
      </div>

      <div className="space-y-5 px-5 py-5">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Pickup</p>
          <button
            type="button"
            onClick={() => setShowPickupSearch(true)}
            className="mt-2 flex w-full items-start gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-left text-sm text-slate-700"
          >
            <MapPin size={16} className="mt-0.5 shrink-0 text-blue-600" />
            <span className="line-clamp-2 flex-1">{pickup?.address || 'Choose a pickup location'}</span>
            <span className="shrink-0 text-xs font-semibold text-blue-700">Change</span>
          </button>
          <p className="mt-3 text-xs text-slate-500">
            The cab stays with you for the package. Make as many stops as you like and end the trip anywhere.
          </p>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold text-slate-900">Choose a package</h3>
          {loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
              <LoaderCircle size={16} className="animate-spin" /> Loading packages…
            </div>
          ) : error ? (
            <div className="py-4">
              <p className="text-sm text-rose-600">{error}</p>
              <button type="button" onClick={loadPackages} className="mt-2 text-sm font-semibold text-blue-700">
                Retry
              </button>
            </div>
          ) : !packages.length ? (
            <p className="py-4 text-sm text-slate-500">Hourly rentals aren't available at this pickup yet.</p>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-3">
              {packages.map((pkg) => {
                const active = pkg.id === selectedPackageId;
                return (
                  <button
                    type="button"
                    key={pkg.id}
                    onClick={() => setSelectedPackageId(pkg.id)}
                    className={`rounded-2xl border px-4 py-3 text-left transition ${
                      active ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <p className={`text-sm font-semibold ${active ? 'text-blue-600' : 'text-slate-900'}`}>
                      {formatDuration(pkg.includedMinutes)} · {pkg.includedKm} km
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">from {formatRupees(pkg.startingPrice)}</p>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {selectedPackage ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-base font-semibold text-slate-900">Choose a cab</h3>
            <p className="mt-1 text-sm text-slate-500">{selectedPackage.name}</p>
            <div className="mt-4 space-y-3">
              {selectedPackage.vehicles.map((vehicle) => {
                const active = vehicle.vehicleTypeId === selectedVehicleId;
                return (
                  <button
                    type="button"
                    key={vehicle.vehicleTypeId}
                    onClick={() => setSelectedVehicleId(vehicle.vehicleTypeId)}
                    className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                      active ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex h-12 w-14 shrink-0 items-center justify-center">
                      {vehicle.icon ? (
                        <img src={vehicle.icon} alt="" className="max-h-12 max-w-14 object-contain" />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{vehicle.vehicleName}</p>
                      <p className="flex items-center gap-1 text-xs text-slate-500">
                        {vehicle.category ? `${vehicle.category} · ` : ''}
                        <Users size={12} /> {vehicle.capacity || '-'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-base font-semibold text-slate-900">{formatRupees(vehicle.price)}</p>
                      {active ? <Check size={16} className="ml-auto text-blue-700" /> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {selectedVehicle ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <Info size={16} className="text-slate-400" /> What's included
            </h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              <li className="flex items-center gap-2">
                <Clock3 size={15} className="text-slate-400" /> {formatDuration(selectedVehicle.includedMinutes)} of cab time
              </li>
              <li className="flex items-center gap-2">
                <Gauge size={15} className="text-slate-400" /> {selectedVehicle.includedKm} km of travel
              </li>
            </ul>
            <div className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-xs text-slate-700">
              <span className="font-semibold text-amber-500">Beyond the package:</span> {formatRupees(selectedVehicle.extraKmRate)} per extra km and{' '}
              {formatRupees(selectedVehicle.extraMinuteRate)} per extra minute. Tolls and parking are extra.
            </div>
          </section>
        ) : null}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-lg border-t border-slate-200 bg-white px-5 pb-6 pt-4">
        <button
          type="button"
          onClick={handleBook}
          disabled={!pickup || !selectedVehicle}
          className="flex h-12 w-full items-center justify-center rounded-2xl bg-blue-600 text-sm font-semibold text-white transition disabled:bg-slate-300"
        >
          {selectedVehicle
            ? `Book ${selectedVehicle.vehicleName} · ${formatRupees(selectedVehicle.price)}`
            : pickup ? 'Choose a package' : 'Choose a pickup location'}
        </button>
        <p className="mt-2 text-center text-[11px] text-slate-500">Pay by cash at the end of the trip</p>
      </div>

      {showPickupSearch ? (
        <PickupSearch isLoaded={isLoaded} onSelect={handlePickupSelected} onClose={() => setShowPickupSearch(false)} />
      ) : null}
    </div>
  );
};

export default HourlyRental;
