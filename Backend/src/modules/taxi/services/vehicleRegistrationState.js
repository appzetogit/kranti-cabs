/**
 * The state a vehicle is registered in, read from its number plate.
 *
 * Indian plates start with the state's two-letter RTO code: "PB 65 AB 1234"
 * is Punjab, "MP-09-CD-5678" Madhya Pradesh. The table holds every code in
 * use, old ones too (OR before OD, UA before UK, TS before TG), mapped to the
 * state's name as Google's geocoder writes it, because names - not codes - are
 * what the state tax compares: Google's own short codes differ from the plates
 * for several states (Chhattisgarh is "CT" there, "CG" on a plate).
 *
 * Bharat-series plates ("22 BH 1234 AA") belong to no state and give null, as
 * does anything unreadable. Callers treat null as "not registered here".
 */

const PLATE_STATES = Object.freeze({
  AN: 'Andaman and Nicobar Islands',
  AP: 'Andhra Pradesh',
  AR: 'Arunachal Pradesh',
  AS: 'Assam',
  BR: 'Bihar',
  CG: 'Chhattisgarh',
  CH: 'Chandigarh',
  DD: 'Dadra and Nagar Haveli and Daman and Diu',
  DN: 'Dadra and Nagar Haveli and Daman and Diu',
  DL: 'Delhi',
  GA: 'Goa',
  GJ: 'Gujarat',
  HP: 'Himachal Pradesh',
  HR: 'Haryana',
  JH: 'Jharkhand',
  JK: 'Jammu and Kashmir',
  KA: 'Karnataka',
  KL: 'Kerala',
  LA: 'Ladakh',
  LD: 'Lakshadweep',
  MH: 'Maharashtra',
  ML: 'Meghalaya',
  MN: 'Manipur',
  MP: 'Madhya Pradesh',
  MZ: 'Mizoram',
  NL: 'Nagaland',
  OD: 'Odisha',
  OR: 'Odisha',
  PB: 'Punjab',
  PY: 'Puducherry',
  RJ: 'Rajasthan',
  SK: 'Sikkim',
  TG: 'Telangana',
  TN: 'Tamil Nadu',
  TR: 'Tripura',
  TS: 'Telangana',
  UA: 'Uttarakhand',
  UK: 'Uttarakhand',
  UP: 'Uttar Pradesh',
  WB: 'West Bengal',
});

// Other spellings the geocoder or an admin may use for the same state.
const NAME_ALIASES = Object.freeze({
  orissa: 'odisha',
  uttaranchal: 'uttarakhand',
  'nct of delhi': 'delhi',
  'national capital territory of delhi': 'delhi',
  pondicherry: 'puducherry',
  'jammu & kashmir': 'jammu and kashmir',
  'andaman & nicobar islands': 'andaman and nicobar islands',
  'dadra & nagar haveli and daman & diu': 'dadra and nagar haveli and daman and diu',
});

/// A state name folded for comparison: lower case, aliases resolved.
export const foldStateName = (value) => {
  const folded = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return NAME_ALIASES[folded] || folded;
};

/// Whether two state names are the same state.
export const sameStateName = (a, b) => {
  const left = foldStateName(a);
  return Boolean(left) && left === foldStateName(b);
};

/// The state name for a two-letter plate code ("PB" -> "Punjab"), or ''.
export const stateForPlateCode = (code) => PLATE_STATES[String(code || '').trim().toUpperCase()] || '';

/**
 * { code, state } for a number plate, or null when it names no state
 * (Bharat series, blank, unreadable).
 */
export const registrationStateFromPlate = (plate) => {
  const compact = String(plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!compact) return null;
  // Bharat series: two-digit year, then BH.
  if (/^\d{2}BH/.test(compact)) return null;
  const match = /^([A-Z]{2})\d/.exec(compact);
  if (!match) return null;
  const state = stateForPlateCode(match[1]);
  return state ? { code: match[1], state } : null;
};

/**
 * The state a driver's vehicle is registered in: the admin's override when
 * set, else read from the plate. '' when neither tells.
 */
export const driverRegistrationState = (driver) => {
  const override = String(driver?.vehicleRegistrationState || '').trim();
  if (override) return stateForPlateCode(override) || override;
  return registrationStateFromPlate(driver?.vehicleNumber)?.state || '';
};
