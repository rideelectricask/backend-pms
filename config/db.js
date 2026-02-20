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
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log("✅ Database connected successfully");
  } catch (err) {
    console.error("❌ DB Connection Error:", err.message);
    process.exit(1);
  }
};

module.exports = connectDB;