require('dotenv').config();
const mongoose = require('mongoose');

const PROJECTS = ['jne', 'mup', 'sayurbox', 'unilever', 'wings'];

const connectDB = async () => {
  await mongoose.connect(process.env.DATABASE_URI);
  console.log('Database connected');
};

const migrateProject = async (project) => {
  const collectionName = `${project}_merchant_orders`;
  const collection = mongoose.connection.db.collection(collectionName);

  const total = await collection.countDocuments({ riders: { $exists: false } });

  if (total === 0) {
    console.log(`[${collectionName}] Tidak ada dokumen yang perlu dimigrasikan`);
    return;
  }

  const result = await collection.updateMany(
    { riders: { $exists: false } },
    { $set: { riders: null } }
  );

  console.log(`[${collectionName}] Berhasil migrasi ${result.modifiedCount} dari ${total} dokumen`);
};

const run = async () => {
  try {
    await connectDB();

    console.log('Memulai migrasi field "riders"...\n');

    for (const project of PROJECTS) {
      await migrateProject(project);
    }

    console.log('\nMigrasi selesai');
  } catch (error) {
    console.error('Migrasi gagal:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Koneksi database ditutup');
  }
};

run();