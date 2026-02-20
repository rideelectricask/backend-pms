require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");
const connectDB = require("./config/db");
const uploadRoutes = require("./routes/uploadRoutes");
const driverRoutes = require("./routes/driverRoutes");
const mitraRoutes = require("./routes/mitraRoutes");
const mitraExtendedRoutes = require("./routes/mitraExtendedRoutes");
const shipmentRoutes = require("./routes/shipmentRoutes");
const bonusRoutes = require("./routes/bonusRoutes");
const sayurboxRoutes = require("./routes/sayurboxRoutes");
const fleetRoutes = require("./routes/fleetRoutes");
const taskManagementRoutes = require("./routes/taskManagementRoutes");
const larkRoutes = require("./routes/larkRoutes");
const chartRoutes = require("./routes/chartRoutes");
const loginRoutes = require("./routes/loginRoutes");
const sellerRoutes = require("./routes/sellerRoutes");
const phoneMessageRoutes = require("./routes/phoneMessageRoutes");
const deliveryRoutes = require("./routes/deliveryRoutes.js");
const merchantOrderRoutes = require("./routes/merchantOrderRoutes.js");
const mitraAuthRoutes = require("./routes/mitraAuthRoutes.js");
const blitzSyncRoutes = require("./routes/blitzSyncRoutes.js");
const blitzProxyRoutes = require("./routes/blitzProxyRoutes.js");
const blitzLoginRoutes = require("./routes/blitzLoginRoutes.js");
const rideExperienceRoutes = require("./routes/rideExperienceRoutes.js");
const errorHandler = require("./middleware/errorHandler");
const { initializeLarkTokens } = require("./services/larkTokenService");

const app = express();
const port = process.env.PORT || 5000;

const WAHA_SERVICE_URL = process.env.WAHA_SERVICE_URL || "https://gallant-wonder-production-01e0.up.railway.app";

app.use(cors());
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  frameguard: false
}));
app.use(compression());
app.use(morgan("dev"));

app.use(express.json({ 
  limit: "500mb",
  strict: false
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: "500mb",
  parameterLimit: 100000
}));

app.use((req, res, next) => {
  const contentLength = req.headers['content-length'];
  if (contentLength && parseInt(contentLength) > 0) {
    const sizeMB = (parseInt(contentLength) / (1024 * 1024)).toFixed(2);
    if (parseFloat(sizeMB) > 10) {
      console.log(`📦 ${req.method} ${req.path} - Payload size: ${sizeMB}MB`);
    }
  }
  next();
});

app.use("/api/auth", loginRoutes);
app.use("/api/mitra-auth", mitraAuthRoutes);
app.use("/api", uploadRoutes);
app.use("/api/driver", driverRoutes);
app.use("/api/mitra", mitraRoutes);
app.use("/api/mitra", mitraExtendedRoutes);
app.use("/api/shipment", shipmentRoutes);
app.use("/api/bonus", bonusRoutes);
app.use("/api/sayurbox", sayurboxRoutes);
app.use("/api/fleet", fleetRoutes);
app.use("/api/task-management", taskManagementRoutes);
app.use("/api/chart", chartRoutes);
app.use("/api", larkRoutes);
app.use("/api/seller", sellerRoutes);
app.use("/api/phone-message", phoneMessageRoutes);
app.use("/api/delivery", deliveryRoutes);
app.use("/api/merchant-orders", merchantOrderRoutes);
app.use("/api/blitz-sync", blitzSyncRoutes);
app.use("/api/blitz-proxy", blitzProxyRoutes);
app.use("/api/blitz-logins", blitzLoginRoutes);
app.use("/api/ride-experience", rideExperienceRoutes);

app.get("/api/health", async (req, res) => {
  try {
    let wahaHealth = "disconnected";
    let wahaStatus = "not_running";
    
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${WAHA_SERVICE_URL}/api/server/status`, { 
        method: 'GET',
        headers: { 
          'Accept': 'application/json',
          'x-api-key': process.env.WAHA_API_KEY || '1c67560aad774aa7a5f7fdf28ae01ae7'
        },
        signal: controller.signal
      });
      
      clearTimeout(timeout);
      
      if (response.ok) {
        wahaHealth = "connected";
        wahaStatus = "running_ok";
      } else if (response.status === 401) {
        wahaHealth = "connected";
        wahaStatus = "running_auth_required";
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        wahaStatus = "timeout";
      } else {
        wahaStatus = "service_not_ready";
      }
    }
    
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      waha: wahaHealth,
      wahaStatus: wahaStatus,
      wahaServiceUrl: WAHA_SERVICE_URL,
      note: wahaStatus === "running_auth_required" ? "WAHA is running and requires authentication (this is normal)" : undefined
    });
  } catch (error) {
    res.status(503).json({
      status: "error",
      waha: "disconnected",
      error: error.message
    });
  }
});

app.get("/", (req, res) => {
  res.json({ 
    message: "PMS API Server is running", 
    timestamp: new Date().toISOString(),
    bodyParserLimit: "500MB",
    maxParameters: 100000,
    wahaStatus: "integrated",
    wahaServiceUrl: WAHA_SERVICE_URL,
    wahaDashboard: `${WAHA_SERVICE_URL}/dashboard`,
    wahaSwagger: `${WAHA_SERVICE_URL}/`
  });
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    console.error(`❌ Payload too large on ${req.method} ${req.path}`);
    return res.status(413).json({
      success: false,
      message: 'Request payload too large',
      error: 'Please apply filters to reduce dataset size (max: 500MB)',
      maxSize: '500MB',
      suggestion: 'Filter by Project, Hub, or Year to reduce data size'
    });
  }
  
  next(err);
});

app.use(errorHandler);

const startServer = async () => {
  try {
    await connectDB();
    console.log("✅ Database connected successfully");

    setTimeout(async () => {
      try {
        await initializeLarkTokens();
        console.log("✅ Lark tokens initialization completed");
      } catch (tokenError) {
        console.warn("⚠️ Lark token initialization failed:", tokenError.message);
      }
    }, 5000);

    app.listen(port, "0.0.0.0", () => {
      console.log(`\n🎉 Server running at http://localhost:${port}`);
      console.log(`\n📦 Body Parser Configuration:`);
      console.log(`   - JSON limit: 500MB`);
      console.log(`   - URL encoded limit: 500MB`);
      console.log(`   - Max parameters: 100,000`);
      console.log("\n📋 Merchant Orders API:");
      console.log("   - POST /api/merchant-orders/:project/upload");
      console.log("   - GET /api/merchant-orders/:project/all");
      console.log("   - DELETE /api/merchant-orders/:project/all");
      console.log("\n🚚 Mitra Authentication API:");
      console.log("   - POST /api/mitra-auth/login");
      console.log("   - POST /api/mitra-auth/logout");
      console.log("   - GET /api/mitra-auth/verify");
      console.log("\n📋 Delivery API:");
      console.log("   - POST /api/delivery/:project/upload");
      console.log("   - GET /api/delivery/:project/all");
      console.log("   - DELETE /api/delivery/:project/all");
      console.log("\n🔐 Blitz Logins API:");
      console.log("   - GET /api/blitz-logins/all");
      console.log("   - GET /api/blitz-logins/by-driver/:driverId?project=jne");
      console.log("   - GET /api/blitz-logins/by-user/:userId");
      console.log("   - POST /api/blitz-logins/create");
      console.log("   - PUT /api/blitz-logins/update/:userId");
      console.log("   - DELETE /api/blitz-logins/delete/:userId");
      console.log("\n⚡ Ride Experience API:");
      console.log("   - POST /api/ride-experience");
      console.log("   - GET /api/ride-experience");
      console.log("   - GET /api/ride-experience/:id");
      console.log("   - PUT /api/ride-experience/:id");
      console.log("   - DELETE /api/ride-experience/:id");
      console.log("   - DELETE /api/ride-experience");
      console.log("\n💬 WAHA WhatsApp API:");
      console.log(`   - 🌐 Service URL: ${WAHA_SERVICE_URL}`);
      console.log(`   - 📊 Dashboard: ${WAHA_SERVICE_URL}/dashboard`);
      console.log(`   - 📚 Swagger: ${WAHA_SERVICE_URL}/`);
      console.log(`   - 🏥 Health Check: http://localhost:${port}/api/health`);
      console.log("\n💡 WAHA is deployed as a separate Railway service");
      console.log("💡 Large dataset exports supported up to 500MB");
      console.log("\n🔄 Blitz Sync API:");
      console.log("   - POST /api/blitz-sync/sync");
      console.log("   - GET /api/blitz-sync/status");
      console.log("\n🔗 Blitz Proxy API:");
      console.log("   - POST /api/blitz-proxy/search-orders");
      console.log("   - POST /api/blitz-proxy/refresh-token");
    });

  } catch (error) {
    console.error("❌ Failed to start server:", error.message);
    process.exit(1);
  }
};

startServer();