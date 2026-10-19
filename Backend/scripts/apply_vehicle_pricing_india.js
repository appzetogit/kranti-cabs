// City Ride (transport_type 'taxi', pricing_scope 'ride') pricing for the
// nationwide "India" zone, one row per live vehicle type. Run
// scripts/seedIndiaZone.js first so the zone exists.
//
// Prices are starting values; adjust per vehicle from the admin panel's
// Set Price screen or edit VEHICLE_PRICES and re-run (it updates in place).
//
// Usage:
//   node scripts/apply_vehicle_pricing_india.js          (dry run)
//   node scripts/apply_vehicle_pricing_india.js --apply  (writes changes)
import mongoose from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const APPLY = process.argv.includes('--apply');
const ZONE_NAME = 'India';

const COMMON = {
  admin_commission_type_from_driver: 2,
  admin_commission_from_driver: 0,
  admin_commission_type_for_owner: 2,
  admin_commission_for_owner: 5,
  service_tax: 0,
  base_distance: 1.5,
  user_cancellation_fee_type: 'fixed',
  user_cancellation_fee: 10,
  driver_cancellation_fee_type: 'fixed',
  driver_cancellation_fee: 10,
  cancellation_fee_goes_to: 'admin',
  free_waiting_before: 5,
  free_waiting_after: 5,
};

// vehicle name -> { base_price (Rs, covers base_distance km), price_per_distance (Rs/km), waiting_charge (Rs/min) }
const VEHICLE_PRICES = {
  'Auto Rickshaw': { base_price: 30, price_per_distance: 15, waiting_charge: 1 },
  'Maruti Suzuki Dzire': { base_price: 70, price_per_distance: 14, waiting_charge: 2 },
  'Maruti Suzuki Ertiga': { base_price: 100, price_per_distance: 17, waiting_charge: 2 },
  'Toyota Innova Crysta': { base_price: 150, price_per_distance: 21, waiting_charge: 3 },
  'Toyota Fortuner': { base_price: 250, price_per_distance: 28, waiting_charge: 4 },
};

const vehicleSchema = new mongoose.Schema({}, { strict: false, collection: 'taxivehicles' });
const setPriceSchema = new mongoose.Schema({}, { strict: false, collection: 'taxisetprices' });
const zoneSchema = new mongoose.Schema({}, { strict: false, collection: 'taxizones' });
const Vehicle = mongoose.model('Vehicle_Migration', vehicleSchema);
const SetPrice = mongoose.model('SetPrice_Migration', setPriceSchema);
const Zone = mongoose.model('Zone_Migration', zoneSchema);

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME });
  console.log(`Connected. Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  const zone = await Zone.findOne({ name: ZONE_NAME }).lean();
  if (!zone) throw new Error(`Zone "${ZONE_NAME}" not found - run scripts/seedIndiaZone.js first`);
  console.log(`Zone: ${zone.name} (${zone._id})`);

  const backup = [];
  let createdCount = 0;
  let updatedCount = 0;

  for (const [name, prices] of Object.entries(VEHICLE_PRICES)) {
    const vehicle = await Vehicle.findOne({ name }).lean();
    if (!vehicle) {
      console.log(`\n[SKIP] Vehicle "${name}" not found`);
      continue;
    }
    const query = {
      zone_id: zone._id,
      vehicle_type: vehicle._id,
      pricing_scope: 'ride',
      transport_type: 'taxi',
    };
    const existing = await SetPrice.find(query).lean();
    const summary = `base_price=${prices.base_price}, price_per_distance=${prices.price_per_distance}, waiting_charge=${prices.waiting_charge}`;

    if (existing.length) {
      backup.push(...existing);
      console.log(`\n[UPDATE] ${name} - ${existing.length} existing doc(s) -> ${summary}`);
      if (APPLY) await SetPrice.updateMany(query, { $set: { ...COMMON, ...prices } });
      updatedCount += existing.length;
    } else {
      console.log(`\n[CREATE] ${name} -> ${summary}`);
      if (APPLY) {
        const created = await SetPrice.create({
          zone_id: zone._id,
          service_location_id: zone.service_location_id,
          pricing_scope: 'ride',
          transport_type: 'taxi',
          vehicle_type: vehicle._id,
          package_destination: '',
          package_availability: 'available',
          package_vehicle_prices: [],
          payment_type: ['cash'],
          active: 1,
          admin_commision_type: 1,
          admin_commision: 0,
          time_price: 0,
          outstation_base_price: 0,
          outstation_base_distance: 0,
          outstation_price_per_distance: 0,
          outstation_time_price: 0,
          enable_airport_ride: false,
          enable_outstation_ride: false,
          enable_ride_sharing: false,
          enable_shared_ride: 0,
          price_per_seat: 0,
          shared_price_per_distance: 0,
          shared_cancel_fee: 0,
          order_number: 0,
          bill_status: 1,
          status: 'active',
          ...COMMON,
          ...prices,
        });
        console.log(`  -> created ${created._id}`);
      }
      createdCount += 1;
    }
  }

  if (APPLY && backup.length) {
    const backupPath = path.resolve(__dirname, `../pricing-backup-${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    console.log(`\nBacked up ${backup.length} pre-change doc(s) to ${backupPath}`);
  }

  console.log(`\nSummary: ${createdCount} to create, ${updatedCount} doc(s) to update.`);
  if (!APPLY) console.log('Dry run only - rerun with --apply to write changes.');

  await mongoose.disconnect();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
