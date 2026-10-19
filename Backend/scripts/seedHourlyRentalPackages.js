// Hourly cab rental packages (1 hr / 10 km ... 12 hr / 120 km), offered
// nationwide (no service location) for every live taxi vehicle at one price.
//
// Each package is a rental package type plus a package price
// (pricing_scope 'package', package_kind 'hourly_rental') with one row per
// vehicle. Price = km x KM_RATE + the package's time charge. Usage beyond the
// package is billed at EXTRA_KM_RATE per km and EXTRA_MINUTE_RATE per minute.
//
// Prices are starting values; edit them per vehicle from the admin panel's
// Package Pricing screen, or edit PACKAGES and re-run (it updates in place).
//
// Usage:
//   node scripts/seedHourlyRentalPackages.js          (dry run)
//   node scripts/seedHourlyRentalPackages.js --apply  (writes changes)
import mongoose from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const APPLY = process.argv.includes('--apply');

const KM_RATE = 25;
const EXTRA_KM_RATE = 25;
const EXTRA_MINUTE_RATE = 2;

// name, hours, km, time charge (Rs)
const PACKAGES = [
  { name: '1 Hour / 10 KM', short_description: 'Quick errands around the city', hours: 1, km: 10, timeCharge: 50 },
  { name: '2 Hours / 20 KM', short_description: 'Shopping or a couple of stops', hours: 2, km: 20, timeCharge: 100 },
  { name: '4 Hours / 40 KM (Half Day)', short_description: 'Half day with a cab at your disposal', hours: 4, km: 40, timeCharge: 200 },
  { name: '8 Hours / 80 KM (Full Day)', short_description: 'Full day of meetings or sightseeing', hours: 8, km: 80, timeCharge: 300 },
  { name: '12 Hours / 120 KM', short_description: 'Long day out, one cab throughout', hours: 12, km: 120, timeCharge: 400 },
];

// Same commission terms the city ride tariffs use.
const COMMISSION = {
  admin_commision_type: 1,
  admin_commision: 0,
  admin_commission_type_from_driver: 2,
  admin_commission_from_driver: 0,
  admin_commission_type_for_owner: 2,
  admin_commission_for_owner: 5,
  service_tax: 0,
  cancellation_fee: 0,
};

const strict = (collection) => new mongoose.Schema({}, { strict: false, collection, timestamps: true });
const Vehicle = mongoose.model('Vehicle_RentalSeed', strict('taxivehicles'));
const PackageType = mongoose.model('PackageType_RentalSeed', strict('taxirentalpackagetypes'));
const SetPrice = mongoose.model('SetPrice_RentalSeed', strict('taxisetprices'));

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME });
  console.log(`Connected. Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  const vehicles = await Vehicle.find({
    transport_type: { $in: ['taxi', 'both', 'all'] },
    active: { $ne: false },
  })
    .select('name')
    .lean();
  if (!vehicles.length) throw new Error('No active taxi vehicles found');
  console.log(`Vehicles: ${vehicles.map((v) => v.name).join(', ')}`);

  const backup = [];

  for (const pkg of PACKAGES) {
    const minutes = pkg.hours * 60;
    const price = pkg.km * KM_RATE + pkg.timeCharge;
    console.log(`\n${pkg.name}: Rs ${price} (${pkg.km} km x ${KM_RATE} + ${pkg.timeCharge}), includes ${pkg.km} km / ${minutes} min`);

    let packageType = await PackageType.findOne({ name: pkg.name, transport_type: 'taxi' }).lean();
    if (packageType) {
      console.log(`  [KEEP] package type ${packageType._id}`);
    } else {
      console.log('  [CREATE] package type');
      if (APPLY) {
        packageType = (await PackageType.create({
          transport_type: 'taxi',
          name: pkg.name,
          short_description: pkg.short_description,
          description: '',
          status: 'active',
          active: true,
        })).toObject();
      }
    }

    const rows = vehicles.map((vehicle) => ({
      vehicle_type: vehicle._id,
      base_price: price,
      free_distance: pkg.km,
      distance_price: EXTRA_KM_RATE,
      free_time: minutes,
      time_price: EXTRA_MINUTE_RATE,
      ...COMMISSION,
      active: 1,
    }));

    const existing = packageType
      ? await SetPrice.findOne({
          pricing_scope: 'package',
          package_kind: 'hourly_rental',
          package_type_id: packageType._id,
          service_location_id: null,
        }).lean()
      : null;

    if (existing) {
      backup.push(existing);
      console.log(`  [UPDATE] package price ${existing._id} (${rows.length} vehicle rows)`);
      if (APPLY) await SetPrice.updateOne({ _id: existing._id }, { $set: { package_vehicle_prices: rows } });
    } else {
      console.log(`  [CREATE] package price (${rows.length} vehicle rows)`);
      if (APPLY) {
        const created = await SetPrice.create({
          zone_id: null,
          service_location_id: null,
          vehicle_type: null,
          pricing_scope: 'package',
          package_kind: 'hourly_rental',
          transport_type: 'taxi',
          package_type_id: packageType._id,
          package_destination: 'Local',
          package_availability: 'available',
          package_vehicle_prices: rows,
          payment_type: ['cash', 'online'],
          active: 1,
          status: 'active',
        });
        console.log(`  -> created ${created._id}`);
      }
    }
  }

  if (APPLY && backup.length) {
    const backupPath = path.resolve(__dirname, `../rental-package-backup-${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    console.log(`\nBacked up ${backup.length} pre-change doc(s) to ${backupPath}`);
  }

  if (!APPLY) console.log('\nDry run only - rerun with --apply to write changes.');
  await mongoose.disconnect();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
