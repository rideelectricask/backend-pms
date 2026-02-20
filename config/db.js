const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const dbURI = process.env.DATABASE_URI || 
                  process.env.MONGODB_URI || 
                  process.env.MONGO_URI;
    
    if (!dbURI) {
      throw new Error("Database URI is not defined in environment variables");
    }

    console.log("🔌 Connecting to database...");
    
    await mongoose.connect(dbURI, {
      serverSelectionTimeoutMS: 10000,  // timeout seleksi server: 10 detik
      socketTimeoutMS: 45000,           // timeout socket: 45 detik
      connectTimeoutMS: 10000,          // timeout koneksi awal: 10 detik
      maxPoolSize: 10,                  // max connection pool
      minPoolSize: 2,                   // min connection pool
      heartbeatFrequencyMS: 10000,      // cek koneksi tiap 10 detik
    });

    // Handle disconnect & auto-reconnect
    mongoose.connection.on('disconnected', () => {
      console.warn("⚠️ MongoDB disconnected! Attempting reconnect...");
    });

    mongoose.connection.on('reconnected', () => {
      console.log("✅ MongoDB reconnected!");
    });

    mongoose.connection.on('error', (err) => {
      console.error("❌ MongoDB error:", err.message);
    });
    
    console.log("✅ Database connected successfully");
  } catch (err) {
    console.error("❌ DB Connection Error:", err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
