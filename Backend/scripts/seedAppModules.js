/**
 * Seed the app service modules (Bike Taxi, Auto, E-Rickshaw, Taxi, Parcel,
 * Bike Rental, Outstation, Bus).
 *
 * Writes to the TaxiAppModule collection, which is what adminService.listAppModules
 * and the app bootstrap actually read. Note the codebase disagrees with itself
 * here: ensureAppModules() is a no-op commented "AppModule is now nested inside
 * AdminAppSetting", and scripts/resetAppModules.js sets AdminAppSetting.app_modules
 * — but that schema has no such field, so Mongoose silently drops it. That is why
 * the module list has always come back empty.
 *
 * Also avoids the other bug in resetAppModules.js: it connects without a dbName,
 * and our URI carries no database path, so it would seed the wrong database.
 *
 * Idempotent by name: existing modules are updated in place, so admin edits to
 * active/order survive a re-run.
 *
 * Usage: node scripts/seedAppModules.js
 */
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { TaxiAppModule } from '../src/modules/taxi/admin/models/TaxiAppModule.js';
import { createDefaultAppSettings } from '../src/modules/taxi/admin/data/defaultAppSettings.js';

const run = async () => {
  await mongoose.connect(env.mongoUri, { dbName: env.mongoDbName });

  const defaults = createDefaultAppSettings().app_modules || [];

  for (const mod of defaults) {
    await TaxiAppModule.findOneAndUpdate(
      { name: mod.name },
      {
        $set: {
          name: mod.name,
          transport_type: mod.transport_type,
          service_type: mod.service_type,
          short_description: mod.short_description || '',
          description: mod.description || '',
          mobile_menu_icon: mod.mobile_menu_icon || '',
        },
        // order and active are admin-editable; only set them on first insert
        $setOnInsert: {
          order_by: Number(mod.order_by || 1),
          active: mod.active === false ? 0 : 1, // schema stores 1/0, not a boolean
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
  }

  const modules = await TaxiAppModule.find().sort({ order_by: 1 }).lean();

  console.log(
    JSON.stringify(
      {
        database: env.mongoDbName,
        total: modules.length,
        modules: modules.map((m) => ({
          name: m.name,
          transport: m.transport_type,
          service: m.service_type,
          order: m.order_by,
          active: m.active,
        })),
      },
      null,
      1,
    ),
  );

  await mongoose.disconnect();
};

run().catch((e) => {
  console.error('seed failed:', e.message);
  process.exit(1);
});
