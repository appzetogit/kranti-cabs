/**
 * Seed a single nationwide "India" zone.
 *
 * Idempotent: matches on name, so re-running updates rather than duplicating.
 * The Zone model requires a GeoJSON Polygon, so this uses a bounding polygon
 * that covers mainland India (roughly lng 68-97.5E, lat 6-37.5N). That is
 * wide enough that any pickup in the country falls inside the zone; tighten it
 * later with a real boundary from the admin panel if you need precise edges.
 */
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { Zone } from '../src/modules/taxi/driver/models/Zone.js';

// Closed ring, wound counter-clockwise (GeoJSON right-hand rule) so MongoDB
// treats the enclosed area as the interior rather than the rest of the globe.
const INDIA_BOUNDARY = [
  [
    [68.0, 6.0],
    [97.5, 6.0],
    [97.5, 37.5],
    [68.0, 37.5],
    [68.0, 6.0],
  ],
];

const run = async () => {
  await mongoose.connect(env.mongoUri, { dbName: env.mongoDbName });

  const doc = await Zone.findOneAndUpdate(
    { name: 'India' },
    {
      $set: {
        name: 'India',
        active: true,
        status: 'active',
        boundary_mode: 'polygon',
        geometry: { type: 'Polygon', coordinates: INDIA_BOUNDARY },
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  console.log(
    JSON.stringify(
      { id: doc._id, name: doc.name, active: doc.active, status: doc.status, boundary_mode: doc.boundary_mode },
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
