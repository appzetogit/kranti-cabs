/**
 * Self-check for the price hike window logic. No DB, no clock.
 * Usage: node scripts/testPriceHike.js
 */
import assert from 'node:assert/strict';
import { applyPriceHikeToSetPrice, isHikeActiveAt } from '../src/modules/taxi/services/priceHikeService.js';

const at = (day, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return { day, minutes: h * 60 + m };
};

// Plain afternoon window, every day.
const afternoon = { startTime: '13:00', endTime: '17:00', days: [] };
assert.equal(isHikeActiveAt(afternoon, at(1, '13:00')), true, 'start is inclusive');
assert.equal(isHikeActiveAt(afternoon, at(1, '16:59')), true, 'inside window');
assert.equal(isHikeActiveAt(afternoon, at(1, '17:00')), false, 'end is exclusive');
assert.equal(isHikeActiveAt(afternoon, at(1, '12:59')), false, 'before window');

// Restricted to weekdays.
const weekdays = { startTime: '13:00', endTime: '17:00', days: [1, 2, 3, 4, 5] };
assert.equal(isHikeActiveAt(weekdays, at(3, '14:00')), true, 'Wednesday matches');
assert.equal(isHikeActiveAt(weekdays, at(0, '14:00')), false, 'Sunday excluded');

// Overnight window: the day is the day the window STARTED on.
const overnight = { startTime: '22:00', endTime: '02:00', days: [5] };
assert.equal(isHikeActiveAt(overnight, at(5, '23:30')), true, 'Friday night');
assert.equal(isHikeActiveAt(overnight, at(6, '01:00')), true, 'Saturday 1am belongs to Friday window');
assert.equal(isHikeActiveAt(overnight, at(5, '01:00')), false, 'Friday 1am belongs to Thursday window');
assert.equal(isHikeActiveAt(overnight, at(6, '03:00')), false, 'after window closed');

// Degenerate config must never surge rather than surging all day.
assert.equal(isHikeActiveAt({ startTime: '10:00', endTime: '10:00', days: [] }, at(1, '10:00')), false);
assert.equal(isHikeActiveAt({ startTime: 'nonsense', endTime: '10:00', days: [] }, at(1, '10:00')), false);

// Scaling touches fares, never thresholds or percentages.
const row = {
  base_price: 50,
  base_distance: 3,
  price_per_distance: 12,
  time_price: 2,
  service_tax: 5,
  admin_commision: 10,
  package_vehicle_prices: [{ base_price: 100, free_distance: 5, distance_price: 8, time_price: 1 }],
};
const hiked = applyPriceHikeToSetPrice(row, 1.5);
assert.equal(hiked.base_price, 75);
assert.equal(hiked.price_per_distance, 18);
assert.equal(hiked.time_price, 3);
assert.equal(hiked.base_distance, 3, 'distance allowance is not money');
assert.equal(hiked.service_tax, 5, 'percentages scale themselves');
assert.equal(hiked.admin_commision, 10, 'commission percent untouched');
assert.equal(hiked.package_vehicle_prices[0].base_price, 150);
assert.equal(hiked.package_vehicle_prices[0].distance_price, 12);
assert.equal(hiked.package_vehicle_prices[0].free_distance, 5);
assert.equal(hiked.price_hike_multiplier, 1.5);
assert.equal(row.base_price, 50, 'input must not be mutated');

// No hike is a passthrough.
assert.equal(applyPriceHikeToSetPrice(row, 1), row);
assert.equal(applyPriceHikeToSetPrice(row, 1).price_hike_multiplier, undefined);

// Rounding stays at paise, not floating point noise.
assert.equal(applyPriceHikeToSetPrice({ base_price: 33.33 }, 1.2).base_price, 40);

console.log('price hike self-check: all assertions passed');
