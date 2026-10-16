// Airport / railway station parking rules as the admin form holds them, and
// the numbers the server expects. See ParkingRulesEditor.jsx.

export const PARKING_VEHICLE_CLASSES = [
  { value: 'all', label: 'All vehicles' },
  { value: 'bike', label: 'Bike' },
  { value: 'auto', label: 'Auto' },
  { value: 'car', label: 'Car' },
];

export const emptyParkingRule = (vehicleClass = 'all') => ({
  vehicle_class: vehicleClass,
  drop_fee: '',
  slabs: [{ up_to_minutes: 10, fee: '' }],
});

export const defaultParking = () => ({
  enabled: false,
  max_minutes: 120,
  rules: [emptyParkingRule('all')],
});

/// What the server expects: numbers, not the strings the inputs hold.
export const parkingPayload = (parking) => ({
  enabled: Boolean(parking?.enabled),
  max_minutes: Number(parking?.max_minutes) || 120,
  rules: (parking?.rules || []).map((rule) => ({
    vehicle_class: rule.vehicle_class,
    drop_fee: Number(rule.drop_fee) || 0,
    slabs: (rule.slabs || [])
      .filter((slab) => Number(slab.up_to_minutes) > 0)
      .map((slab) => ({ up_to_minutes: Number(slab.up_to_minutes), fee: Number(slab.fee) || 0 })),
  })),
});
