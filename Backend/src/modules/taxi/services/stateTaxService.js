import { env } from '../../../config/env.js';
import { StateTax } from '../admin/models/StateTax.js';

/**
 * State tax and MCD tax - what a commercial vehicle pays at the border to
 * enter another state, or Delhi.
 *
 * A trip pays a rule when its drop is in the rule's state and its pickup is
 * not: Indore to Jaipur pays Rajasthan's, Jaipur to Jaipur pays nothing, and
 * Noida to Delhi pays Delhi's MCD tax (plus Delhi's state tax, if one is set).
 * A state the route only passes through is not charged.
 *
 * Zones cannot answer this - one "India" zone can cover the whole country - so
 * the state of each end comes from Google's reverse geocoder, cached on a
 * ~500 m grid so a busy pickup point is only asked about once a day.
 *
 * The tax is added to the fare at booking and passed to the driver at
 * settlement without commission, like the railway station entry fee: it is
 * money the driver hands over at the border.
 */

export const STATE_TAX_TYPES = Object.freeze(['state_tax', 'mcd_tax']);
export const STATE_TAX_CLASSES = Object.freeze(['bike', 'auto', 'car']);

const RULES_CACHE_MS = 60 * 1000;
const STATE_CACHE_MS = 24 * 60 * 60 * 1000;
const STATE_MISS_CACHE_MS = 10 * 60 * 1000;
const STATE_CACHE_LIMIT = 5000;
const GEOCODE_TIMEOUT_MS = 4000;

const money = (value) => Math.round(Math.max(0, Number(value) || 0) * 100) / 100;
const fold = (value) => String(value || '').trim().toLowerCase();

let rulesCache = { rows: null, at: 0 };
const stateCache = new Map();

export const invalidateStateTaxCache = () => {
  rulesCache = { rows: null, at: 0 };
};

const activeRules = async () => {
  if (rulesCache.rows && Date.now() - rulesCache.at < RULES_CACHE_MS) return rulesCache.rows;
  const rows = await StateTax.find({ active: true }).lean();
  rulesCache = { rows, at: Date.now() };
  return rows;
};

const geocoderKey = async () => {
  try {
    // Imported here, not at load: adminService imports half the app.
    const { getMapSettings } = await import('../admin/services/adminService.js');
    const settings = (await getMapSettings())?.settings || {};
    return settings.google_map_key_for_distance_matrix || settings.google_map_key_for_web_apps || env.googleMapsApiKey;
  } catch {
    return env.googleMapsApiKey;
  }
};

/**
 * The state a [lng, lat] point is in, as { name, code } ("Rajasthan", "RJ"),
 * or null when it cannot be told. Best effort: no key, a slow answer or an
 * error give null and the trip is booked without the tax.
 */
export const stateAt = async (point) => {
  if (!Array.isArray(point) || point.length !== 2) return null;
  const [lng, lat] = point.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const cacheKey = `${(Math.round(lat * 200) / 200).toFixed(3)},${(Math.round(lng * 200) / 200).toFixed(3)}`;
  const cached = stateCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let value = null;
  try {
    const key = await geocoderKey();
    if (key) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&result_type=administrative_area_level_1&key=${encodeURIComponent(key)}`;
      const response = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
      const body = await response.json();
      const part = (body?.results || [])
        .flatMap((result) => result.address_components || [])
        .find((component) => component.types?.includes('administrative_area_level_1'));
      if (part) value = { name: part.long_name || '', code: part.short_name || '' };
    }
  } catch {
    value = null;
  }

  if (stateCache.size >= STATE_CACHE_LIMIT) stateCache.delete(stateCache.keys().next().value);
  stateCache.set(cacheKey, { value, expiresAt: Date.now() + (value ? STATE_CACHE_MS : STATE_MISS_CACHE_MS) });
  return value;
};

const inState = (state, rule) => {
  if (!state) return false;
  const wanted = fold(rule.state);
  return Boolean(wanted) && (fold(state.name) === wanted || fold(state.code) === wanted);
};

const sameState = (a, b) => Boolean(a && b) && fold(a.name) === fold(b.name);

export const stateTaxVehicleClass = (value) => {
  const vehicleClass = fold(value);
  return STATE_TAX_CLASSES.includes(vehicleClass) ? vehicleClass : 'car';
};

const linesFor = (rules, dropState, vehicleClass) =>
  rules
    .filter((rule) => inState(dropState, rule))
    .map((rule) => ({
      rule_id: String(rule._id),
      name: rule.name,
      tax_type: STATE_TAX_TYPES.includes(rule.tax_type) ? rule.tax_type : 'state_tax',
      state: dropState.name,
      fee: money(rule.fees?.[vehicleClass]),
    }))
    .filter((line) => line.fee > 0);

const summarise = (lines) =>
  lines.length ? { lines, total_fee: money(lines.reduce((sum, line) => sum + line.fee, 0)) } : null;

/**
 * The state and MCD tax a trip pays.
 *
 * With a vehicleClass: { lines, total_fee } or null. Without one, for a
 * vehicle list: { by_vehicle_class: { bike, auto, car } } or null.
 */
export const stateTaxFees = async ({ pickup, drop, vehicleClass = '' }) => {
  const rules = await activeRules();
  if (!rules.length) return null;

  const [pickupState, dropState] = await Promise.all([stateAt(pickup), stateAt(drop)]);
  // Without both states the trip cannot be shown to cross a border.
  if (!pickupState || !dropState || sameState(pickupState, dropState)) return null;

  if (vehicleClass) return summarise(linesFor(rules, dropState, stateTaxVehicleClass(vehicleClass)));

  const byClass = Object.fromEntries(
    STATE_TAX_CLASSES.map((cls) => [cls, summarise(linesFor(rules, dropState, cls))]),
  );
  return Object.values(byClass).some(Boolean) ? { by_vehicle_class: byClass } : null;
};

/// Cleans a rule from the admin form.
export const normalizeStateTaxPayload = (input = {}, { partial = false } = {}) => {
  const out = {};
  if (!partial || input.name !== undefined) out.name = String(input.name || '').trim();
  if (!partial || input.state !== undefined) out.state = String(input.state || '').trim();
  if (!partial || input.tax_type !== undefined) {
    out.tax_type = STATE_TAX_TYPES.includes(input.tax_type) ? input.tax_type : 'state_tax';
  }
  if (!partial || input.fees !== undefined) {
    out.fees = Object.fromEntries(STATE_TAX_CLASSES.map((cls) => [cls, money(input.fees?.[cls])]));
  }
  if (!partial || input.active !== undefined) out.active = input.active !== false;
  return out;
};
