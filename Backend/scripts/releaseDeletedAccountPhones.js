// Frees the phone (and owner email) of drivers / owners deleted before the
// app started doing it on delete, so those numbers can register again.
// The real values are kept in deletedPhone / deletedMobile / deletedEmail.
//
// Dry run:  node scripts/releaseDeletedAccountPhones.js
// Apply:    node scripts/releaseDeletedAccountPhones.js --apply
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { Driver, tagDeletedContact } from '../src/modules/taxi/driver/models/Driver.js';
import { Owner } from '../src/modules/taxi/admin/models/Owner.js';

const apply = process.argv.includes('--apply');
const alreadyTagged = /__deleted__\d+$/;

const main = async () => {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.mongoUri, { autoIndex: false, dbName: env.mongoDbName });

  const drivers = await Driver.find({ deletedAt: { $ne: null } }).select('phone deletedAt').lean();
  const driverUpdates = drivers
    .filter((driver) => driver.phone && !alreadyTagged.test(driver.phone))
    .map((driver) => ({
      updateOne: {
        filter: { _id: driver._id },
        update: {
          $set: {
            deletedPhone: driver.phone,
            phone: tagDeletedContact(driver.phone, driver.deletedAt),
          },
        },
      },
    }));

  const owners = await Owner.find({ deletedAt: { $ne: null } }).select('mobile email deletedAt').lean();
  const ownerUpdates = owners
    .filter((owner) => owner.mobile && !alreadyTagged.test(owner.mobile))
    .map((owner) => ({
      updateOne: {
        filter: { _id: owner._id },
        update: {
          $set: {
            deletedMobile: owner.mobile,
            deletedEmail: owner.email || '',
            mobile: tagDeletedContact(owner.mobile, owner.deletedAt),
            email: tagDeletedContact(owner.email, owner.deletedAt),
          },
        },
      },
    }));

  console.log(`Deleted drivers: ${drivers.length}, to free: ${driverUpdates.length}`);
  console.log(`Deleted owners: ${owners.length}, to free: ${ownerUpdates.length}`);

  if (!apply) {
    console.log('Dry run. Re-run with --apply to write.');
  } else {
    if (driverUpdates.length) await Driver.bulkWrite(driverUpdates, { ordered: false });
    if (ownerUpdates.length) await Owner.bulkWrite(ownerUpdates, { ordered: false });
    console.log('Done.');
  }

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
