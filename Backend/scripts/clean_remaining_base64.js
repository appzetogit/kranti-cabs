
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';

await mongoose.connect('mongodb://127.0.0.1:27017/zicab_prod');
const db = mongoose.connection.db;

// Clean driver profileImage
const drivers = db.collection('taxidrivers');
const driverSample = await drivers.find({ profileImage: { $regex: '^data:image' } }).toArray();
for (const d of driverSample) {
  const match = d.profileImage.match(/^data:image\/(\w+);base64,(.+)$/s);
  if (match) {
    let ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');
    const filename = `driver-profile-${d._id}.${ext}`;
    const filePath = `/root/zicab/Backend/uploads/zicab/user-profile/${filename}`;
    fs.writeFileSync(filePath, buffer);
    const url = `https://zicab.in/uploads/zicab/user-profile/${filename}`;
    await drivers.updateOne({ _id: d._id }, { $set: { profileImage: url } });
    console.log(`Updated driver profile image for ${d._id} to ${url}`);
  }
}

// Clean rides with embedded base64 vehicleIconUrl
const rides = db.collection('taxirides');
await rides.updateMany(
  { vehicleIconUrl: { $regex: '^data:image' } },
  { $set: { vehicleIconUrl: 'https://zicab.in/uploads/vehicles/vehicle-default.png' } }
);

await mongoose.disconnect();
console.log('Cleaned remaining base64 fields.');
