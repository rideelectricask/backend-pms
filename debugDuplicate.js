const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const PROJECTS = ['jne', 'mup', 'sayurbox', 'unilever', 'wings'];

async function removeDuplicatesAndCreateIndex(project) {
  const collectionName = `${project}_merchant_orders`;
  const collection = mongoose.connection.db.collection(collectionName);

  const duplicates = await collection.aggregate([
    { $group: { _id: '$merchant_order_id', count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();

  let deleted = 0;
  for (const dup of duplicates) {
    const idsToDelete = dup.ids.slice(1);
    const result = await collection.deleteMany({ _id: { $in: idsToDelete } });
    deleted += result.deletedCount;
    console.log(`[${project}] Hapus duplikat "${dup._id}": ${result.deletedCount} dihapus`);
  }

  if (deleted === 0) console.log(`[${project}] Tidak ada duplikat`);

  try {
    await collection.dropIndex('merchant_order_id_1');
    console.log(`[${project}] Index lama dihapus`);
  } catch (e) {
    console.log(`[${project}] Tidak ada index lama (normal)`);
  }

  await collection.createIndex(
    { merchant_order_id: 1 },
    { unique: true, name: 'merchant_order_id_1' }
  );
  console.log(`[${project}] Unique index berhasil dibuat\n`);
}

async function main() {
  const uri = process.env.DATABASE_URI;
  if (!uri) {
    console.error('DATABASE_URI tidak ditemukan di .env');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log('Terhubung ke MongoDB\n');

    for (const project of PROJECTS) {
      await removeDuplicatesAndCreateIndex(project);
    }

    console.log('Selesai. Semua collection memiliki unique index pada merchant_order_id.');
    console.log('Mulai sekarang duplikat apapun akan otomatis ditolak di level database.');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await mongoose.disconnect();
  }
}

main();