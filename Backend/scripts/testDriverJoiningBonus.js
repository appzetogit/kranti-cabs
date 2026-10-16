/**
 * Verifies the driver joining bonus is paid exactly once.
 *
 * Needs a real database because the guarantee lives in an atomic updateOne, not
 * in JavaScript - a pure unit test would prove nothing about the thing that can
 * actually break. Creates a throwaway driver, cleans up after itself.
 *
 * Usage: node scripts/testDriverJoiningBonus.js
 */
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { env } = await import('../src/config/env.js');
const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
const { WalletTransaction } = await import('../src/modules/taxi/driver/models/WalletTransaction.js');
const { grantDriverJoiningBonus } = await import('../src/modules/taxi/driver/services/walletService.js');

await mongoose.connect(env.mongoUri, { dbName: env.mongoDbName });

const phone = `999000${Date.now() % 10000}`;
const driver = await Driver.create({
  name: 'BONUS TEST - delete me',
  phone,
  password: 'test-only-not-a-login',
  vehicleType: 'car',
  approve: false,
});
const bonus = env.driverWallet.joiningBonus;

try {
  const first = await grantDriverJoiningBonus({ driverId: driver._id });
  assert.ok(first, 'first grant should credit');
  assert.equal(first.transaction.amount, bonus, `should credit ${bonus}`);
  assert.equal(first.transaction.type, 'adjustment');

  let after = await Driver.findById(driver._id).lean();
  assert.equal(after.wallet.balance, bonus, 'balance should equal the bonus');
  assert.ok(after.joiningBonusGrantedAt, 'grant should be stamped');

  // Approving again must not pay again.
  assert.equal(await grantDriverJoiningBonus({ driverId: driver._id }), null, 'second grant must be a no-op');

  // Nor should a burst of concurrent approvals - the real multi-instance case.
  const racers = await Promise.all([1, 2, 3, 4, 5].map(() => grantDriverJoiningBonus({ driverId: driver._id })));
  assert.ok(racers.every((r) => r === null), 'concurrent grants must all no-op');

  after = await Driver.findById(driver._id).lean();
  assert.equal(after.wallet.balance, bonus, 'balance must not have moved');

  const txns = await WalletTransaction.countDocuments({ driverId: driver._id });
  assert.equal(txns, 1, `exactly one wallet transaction, got ${txns}`);

  // Un-approving and re-approving is not a second payday.
  await Driver.updateOne({ _id: driver._id }, { $set: { approve: false } });
  await Driver.updateOne({ _id: driver._id }, { $set: { approve: true } });
  assert.equal(await grantDriverJoiningBonus({ driverId: driver._id }), null, 're-approval must not pay again');

  // The real trigger is the admin approval path, not the helper. Exercise it
  // directly so the wiring in updateDriver is covered, not just the primitive.
  const adminService = await import('../src/modules/taxi/admin/services/adminService.js');
  const second = await Driver.create({
    name: 'BONUS TEST 2 - delete me',
    phone: `${phone}1`,
    password: 'test-only-not-a-login',
    vehicleType: 'car',
    approve: false,
  });

  try {
    await adminService.updateDriver(String(second._id), { approve: true });
    const afterApproval = await Driver.findById(second._id).lean();
    assert.equal(afterApproval.wallet.balance, bonus, 'approving via admin must credit the bonus');
    assert.ok(afterApproval.joiningBonusGrantedAt, 'admin approval must stamp the grant');

    // Saving the same driver again with approve:true must not pay twice.
    await adminService.updateDriver(String(second._id), { approve: true });
    const afterResave = await Driver.findById(second._id).lean();
    assert.equal(afterResave.wallet.balance, bonus, 're-saving an approved driver must not pay again');

    console.log(`PASS - bonus of ${bonus} paid exactly once (8 direct attempts + admin approve + re-approve)`);
  } finally {
    await WalletTransaction.deleteMany({ driverId: second._id });
    await Driver.deleteOne({ _id: second._id });
  }
} finally {
  await WalletTransaction.deleteMany({ driverId: driver._id });
  await Driver.deleteOne({ _id: driver._id });
  await mongoose.disconnect();
}
