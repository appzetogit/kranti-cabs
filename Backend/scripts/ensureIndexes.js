/**
 * Build every index declared in the schemas.
 *
 * config/database.js connects with `autoIndex: env.nodeEnv !== 'production'`, so
 * in production Mongoose never creates them. That is a sensible default — index
 * builds on boot are dangerous on a large database — but it means indexes have
 * to be created deliberately, and nothing in this repo did that. The symptom was
 * dispatch failing with "unable to find index for $geoNear query" on
 * taxidrivers.location, but every declared index was missing, not just that one.
 *
 * Uses createIndexes(), which only adds what is missing. Deliberately NOT
 * syncIndexes(), which drops any index not in the schema — too destructive to
 * run against production.
 *
 * Run this after any deploy that changes a schema index.
 *
 * Usage: node scripts/ensureIndexes.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');

/** Every *.js under a models/ directory, so no model is missed. */
const findModelFiles = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      findModelFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.js') && full.includes(`${path.sep}models${path.sep}`)) {
      out.push(full);
    }
  }
  return out;
};

const run = async () => {
  const files = findModelFiles(SRC);
  for (const file of files) {
    await import(pathToFileURL(file).href);
  }

  await mongoose.connect(env.mongoUri, { dbName: env.mongoDbName, autoIndex: false });

  const before = {};
  const results = [];
  let created = 0;
  let failed = 0;

  for (const name of mongoose.modelNames()) {
    const Model = mongoose.model(name);
    const coll = Model.collection.collectionName;

    let existing = [];
    try {
      existing = await Model.collection.indexes();
    } catch {
      existing = []; // collection does not exist yet
    }
    before[coll] = new Set(existing.map((i) => i.name));

    try {
      await Model.createIndexes();
      const after = await Model.collection.indexes();
      const added = after.map((i) => i.name).filter((n) => !before[coll].has(n));
      if (added.length) {
        created += added.length;
        results.push({ collection: coll, added });
      }
    } catch (error) {
      failed += 1;
      results.push({ collection: coll, error: error.message.slice(0, 160) });
    }
  }

  console.log(
    JSON.stringify(
      { database: env.mongoDbName, models: mongoose.modelNames().length, indexesCreated: created, failures: failed, detail: results },
      null,
      1,
    ),
  );

  await mongoose.disconnect();
  if (failed) process.exit(1);
};

run().catch((e) => {
  console.error('ensureIndexes failed:', e.message);
  process.exit(1);
});
