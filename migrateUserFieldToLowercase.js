require("dotenv").config();
const mongoose = require("mongoose");

const TaskManagementDataSchema = new mongoose.Schema({
  fullName: String,
  phoneNumber: String,
  domicile: String,
  city: String,
  project: String,
  user: String,
  note: String,
  nik: String,
  replyRecord: String,
  finalStatus: String,
  date: Date,
  replyRecordHistory: Array,
  finalStatusHistory: Array,
  editHistory: Array,
  createdAt: Date,
  updatedAt: Date
});

const TaskManagementData = mongoose.model('TaskManagementData', TaskManagementDataSchema);

async function migrateUserFieldToLowercase() {
  try {
    console.log('🚀 Starting migration: Normalize user field to lowercase');
    console.log(`📡 Connecting to MongoDB: ${process.env.MONGO_URI}`);

    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('✅ Connected to MongoDB');

    const totalDocs = await TaskManagementData.countDocuments();
    console.log(`📊 Total documents in collection: ${totalDocs}`);

    const docsWithUser = await TaskManagementData.countDocuments({ user: { $exists: true, $ne: '' } });
    console.log(`📊 Documents with user field: ${docsWithUser}`);

    const uniqueUsers = await TaskManagementData.distinct('user');
    console.log(`👥 Unique users before migration: ${uniqueUsers.length}`);
    console.log('Current users:', uniqueUsers.sort());

    const caseVariations = {};
    uniqueUsers.forEach(u => {
      const lower = u.toLowerCase();
      if (!caseVariations[lower]) {
        caseVariations[lower] = [];
      }
      caseVariations[lower].push(u);
    });

    const duplicateCases = Object.entries(caseVariations).filter(([, variants]) => variants.length > 1);
    
    if (duplicateCases.length > 0) {
      console.log('\n⚠️  Found case variations that will be normalized:');
      duplicateCases.forEach(([normalized, variants]) => {
        console.log(`   "${normalized}" ← [${variants.join(', ')}]`);
      });
    }

    console.log('\n🔄 Starting bulk update...');

    const bulkOps = [];
    const batchSize = 1000;
    let processedCount = 0;

    const cursor = TaskManagementData.find({ user: { $exists: true, $ne: '' } }).cursor();

    for await (const doc of cursor) {
      if (doc.user) {
        const normalizedUser = doc.user.toLowerCase();
        
        if (doc.user !== normalizedUser) {
          bulkOps.push({
            updateOne: {
              filter: { _id: doc._id },
              update: { $set: { user: normalizedUser, updatedAt: new Date() } }
            }
          });
        }
      }

      processedCount++;

      if (bulkOps.length >= batchSize) {
        const result = await TaskManagementData.bulkWrite(bulkOps);
        console.log(`   ✓ Updated batch: ${result.modifiedCount} documents`);
        bulkOps.length = 0;
      }
    }

    if (bulkOps.length > 0) {
      const result = await TaskManagementData.bulkWrite(bulkOps);
      console.log(`   ✓ Updated final batch: ${result.modifiedCount} documents`);
    }

    console.log(`\n✅ Migration completed. Processed ${processedCount} documents.`);

    const uniqueUsersAfter = await TaskManagementData.distinct('user');
    console.log(`👥 Unique users after migration: ${uniqueUsersAfter.length}`);
    console.log('Users after migration:', uniqueUsersAfter.sort());

    const verificationSample = await TaskManagementData.findOne({ user: { $exists: true, $ne: '' } });
    if (verificationSample) {
      console.log(`\n🔍 Verification sample:`);
      console.log(`   User: "${verificationSample.user}"`);
      console.log(`   Is lowercase: ${verificationSample.user === verificationSample.user.toLowerCase()}`);
    }

    console.log('\n✅ Migration successful!');
    console.log('📝 Summary:');
    console.log(`   - Total documents: ${totalDocs}`);
    console.log(`   - Documents with user: ${docsWithUser}`);
    console.log(`   - Unique users before: ${uniqueUsers.length}`);
    console.log(`   - Unique users after: ${uniqueUsersAfter.length}`);
    console.log(`   - Case variations normalized: ${duplicateCases.length}`);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await mongoose.connection.close();
    console.log('\n📡 MongoDB connection closed');
  }
}

if (require.main === module) {
  migrateUserFieldToLowercase()
    .then(() => {
      console.log('\n🎉 Migration script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateUserFieldToLowercase };