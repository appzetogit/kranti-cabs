/**
 * Seed the admin vehicle catalog with the Kranti Cabs ride types.
 *
 * Idempotent: matches on name, so re-running updates rather than duplicating.
 * Images point at the files already in frontend/public/vehicles; types without
 * a photo there are left blank for the admin to upload.
 *
 * Usage:
 *   node scripts/seedVehicles.js                      # upsert the five types
 *   node scripts/seedVehicles.js --deactivate-others  # also switch off other taxi vehicles
 */
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { Vehicle } from '../src/modules/taxi/admin/models/Vehicle.js';

// icon_types drives dispatch matching (bike/auto by keyword, everything else is a car),
// so it must stay within the model's enum.
export const FLEET = [
  { name: 'Auto',                    category: 'auto', icon_types: 'auto',    capacity: 3, image: '/vehicles/auto.jpg',     short_description: 'Quick, metered short-distance autos' },
  { name: 'Bike',                    category: 'bike', icon_types: 'bike',    capacity: 1, image: '',                       short_description: 'Beat the traffic on a bike taxi' },
  { name: 'Cab Economy (Hatchback)', category: 'car',  icon_types: 'car',     capacity: 4, image: '',                       short_description: 'Affordable hatchback for everyday rides' },
  { name: 'Cab Premium (Sedan)',     category: 'car',  icon_types: 'premium', capacity: 4, image: '/vehicles/dzire.jpg',    short_description: 'Comfortable sedan for city and airport runs' },
  { name: 'SUV',                     category: 'car',  icon_types: 'suv',     capacity: 6, image: '/vehicles/fortuner.jpg', short_description: 'Spacious SUV for families and groups' },
];

const run = async () => {
  const deactivateOthers = process.argv.includes('--deactivate-others');
  await mongoose.connect(env.mongoUri, { dbName: env.mongoDbName });

  const out = [];
  for (const v of FLEET) {
    const doc = await Vehicle.findOneAndUpdate(
      { name: v.name },
      { $set: { ...v, transport_type: 'taxi', dispatch_type: 'normal', is_taxi: 'taxi', status: 1, active: true } },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true, runValidators: true },
    );
    out.push({ id: String(doc._id), name: doc.name, category: doc.category, icon_types: doc.icon_types, capacity: doc.capacity });
  }

  let deactivated = 0;
  if (deactivateOthers) {
    // Delivery and pooling vehicles are separate catalogs; leave them alone.
    const res = await Vehicle.updateMany(
      { name: { $nin: FLEET.map((v) => v.name) }, transport_type: 'taxi', status: 1 },
      { $set: { status: 0, active: false } },
    );
    deactivated = res.modifiedCount;
  }

  console.log(JSON.stringify({ seeded: out.length, deactivated, vehicles: out }, null, 1));
  await mongoose.disconnect();
};

run().catch((e) => {
  console.error('seed failed:', e.message);
  process.exit(1);
});
