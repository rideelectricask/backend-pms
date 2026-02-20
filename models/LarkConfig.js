const mongoose = require("mongoose");

const larkConfigSchema = new mongoose.Schema({
  tenant_access_token: {
    type: String,
    default: ""
  },
  user_access_token: {
    type: String,
    default: ""
  },
  app_access_token: {
    type: String,
    default: ""
  },
  expires_at: {
    type: Date,
    default: null
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: "larkconfig"
});

larkConfigSchema.pre("save", function(next) {
  this.updatedAt = new Date();
  next();
});

larkConfigSchema.statics.updateTokens = async function(tokens) {
  try {
    console.log("🔄 Updating tokens in database...");
    console.log("📊 New token data:", {
      tenant_access_token: tokens.tenant_access_token ? `${tokens.tenant_access_token.substring(0, 10)}...` : "empty",
      expire: tokens.expire
    });

    const session = await mongoose.startSession();
    
    try {
      await session.withTransaction(async () => {
        await this.deleteMany({}, { session });
        console.log("🗑️ Cleared existing token records");

        const newConfig = new this({
          tenant_access_token: tokens.tenant_access_token || "",
          user_access_token: tokens.user_access_token || "",
          app_access_token: tokens.app_access_token || "",
          expires_at: tokens.expire ? new Date(Date.now() + (tokens.expire * 1000)) : null,
          updatedAt: new Date()
        });

        const savedConfig = await newConfig.save({ session });
        console.log("✅ New tokens saved to database");
        console.log("📊 Saved config ID:", savedConfig._id);
        console.log("📊 Expires at:", savedConfig.expires_at);

        return savedConfig;
      }, {
        readConcern: { level: 'majority' },
        writeConcern: { w: 'majority', j: true },
        maxCommitTimeMS: 3000
      });
    } finally {
      await session.endSession();
    }

    const result = await this.findOne().sort({ createdAt: -1 }).lean();
    return result;

  } catch (error) {
    console.error("❌ Error updating tokens in database:", error.message);
    
    if (error.name === 'MongoTimeoutError' || error.name === 'MongoNetworkError') {
      console.error("❌ Database connection issue during token update");
      
      try {
        const fallbackConfig = new this({
          tenant_access_token: tokens.tenant_access_token || "",
          user_access_token: tokens.user_access_token || "",
          app_access_token: tokens.app_access_token || "",
          expires_at: tokens.expire ? new Date(Date.now() + (tokens.expire * 1000)) : null,
          updatedAt: new Date()
        });

        const saved = await fallbackConfig.save();
        console.log("✅ Fallback token save successful");
        return saved;
      } catch (fallbackError) {
        console.error("❌ Fallback save also failed:", fallbackError.message);
      }
    }
    
    throw error;
  }
};

larkConfigSchema.statics.getTokens = async function() {
  try {
    const config = await this.findOne()
      .sort({ createdAt: -1 })
      .lean()
      .maxTimeMS(2000);
      
    if (!config) {
      console.log("⚠️ No token config found in database");
      return { 
        tenant_access_token: "", 
        user_access_token: "", 
        app_access_token: "" 
      };
    }
    
    console.log("📊 Retrieved tokens from database");
    return config;
  } catch (error) {
    console.error("❌ Error getting tokens from database:", error.message);
    
    if (error.name === 'MongoTimeoutError') {
      console.error("❌ Database query timeout when getting tokens");
    }
    
    return { 
      tenant_access_token: "", 
      user_access_token: "", 
      app_access_token: "" 
    };
  }
};

module.exports = mongoose.model("LarkConfig", larkConfigSchema);