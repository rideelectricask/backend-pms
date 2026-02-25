const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs").promises;

const TEMP_DIR = path.join(__dirname, "..", "temp");
const PYTHON_SCRIPT = path.join(__dirname, "..", "utils", "mitraPerformanceChartGeneratorFormula.py");

const ensureTempDir = async () => {
  try {
    await fs.access(TEMP_DIR);
  } catch {
    await fs.mkdir(TEMP_DIR, { recursive: true });
  }
};

const generateUniqueFilename = (prefix = "chart", extension = "xlsx") => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}.${extension}`;
};

const cleanupFile = async (filePath) => {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    console.warn(`Failed to cleanup file ${filePath}:`, error.message);
  }
};

const executePythonScript = (inputPath, outputPath) => {
  return new Promise((resolve, reject) => {
    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
    const pythonProcess = spawn(pythonCommand, [PYTHON_SCRIPT, inputPath, outputPath], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: path.dirname(PYTHON_SCRIPT)
    });

    let stdout = "";
    let stderr = "";

    pythonProcess.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    pythonProcess.on("close", (code) => {
      console.log(`Python process exited with code: ${code}`);
      console.log(`Python stdout: ${stdout}`);
      console.log(`Python stderr: ${stderr}`);

      if (code === 0) {
        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch (parseError) {
          console.error('Failed to parse Python output:', parseError);
          reject(new Error(`Failed to parse Python output: ${parseError.message}`));
        }
      } else {
        reject(new Error(`Python script failed with code ${code}: ${stderr || 'Unknown error'}`));
      }
    });

    pythonProcess.on("error", (error) => {
      console.error('Python process error:', error);
      reject(new Error(`Failed to start Python process: ${error.message}`));
    });

    setTimeout(() => {
      pythonProcess.kill("SIGTERM");
      reject(new Error("Python script timeout"));
    }, 120000);
  });
};

const validateAndNormalizePerformanceData = (chartData) => {
  if (!chartData || typeof chartData !== 'object') {
    throw new Error('Invalid chart data format');
  }

  const profile = chartData.profile || {};
  const metrics = chartData.metrics || {};
  const trends = chartData.trends || [];
  const projectBreakdown = chartData.projectBreakdown || [];
  const radarData = chartData.radarData || [];
  const shipmentData = chartData.shipmentData || [];

  const normalizedMetrics = {
    totalDeliveries: parseInt(metrics.totalDeliveries) || 0,
    deliveryRate: parseFloat(metrics.deliveryRate) || 0,
    onTimeRate: parseFloat(metrics.onTimeRate) || 0,
    avgDistance: parseFloat(metrics.avgDistance) || 0,
    cancelRate: parseFloat(metrics.cancelRate) || 0,
    growthRate: parseFloat(metrics.growthRate) || 0,
    uniqueProjects: parseInt(metrics.uniqueProjects) || 0,
    uniqueHubs: parseInt(metrics.uniqueHubs) || 0
  };

  const normalizedTrends = trends.map(trend => ({
    month: trend.month || 'Unknown',
    deliveries: parseInt(trend.deliveries) || 0
  }));

  const normalizedProjects = projectBreakdown.map(project => ({
    project: project.project || 'Unknown',
    count: parseInt(project.count) || 0
  }));

  const normalizedRadar = radarData.map(item => ({
    metric: item.metric || 'Unknown',
    value: parseFloat(item.value) || 0
  }));

  const normalizedShipment = shipmentData.map(shipment => ({
    client_name: shipment.client_name || '-',
    project_name: shipment.project_name || '-',
    delivery_date: shipment.delivery_date || '-',
    drop_point: shipment.drop_point || '-',
    hub: shipment.hub || '-',
    order_code: shipment.order_code || '-',
    weight: shipment.weight || '-',
    distance_km: shipment.distance_km || '-',
    mitra_code: shipment.mitra_code || '-',
    mitra_name: shipment.mitra_name || '-',
    receiving_date: shipment.receiving_date || '-',
    vehicle_type: shipment.vehicle_type || '-',
    cost: shipment.cost || '-',
    sla: shipment.sla || '-',
    weekly: shipment.weekly || '-'
  }));

  const performanceScore = calculatePerformanceScore(normalizedMetrics);

  return {
    profile: {
      name: profile.name || 'Unknown',
      driverId: profile.driverId || 'N/A',
      phone: profile.phone || 'N/A',
      city: profile.city || 'N/A',
      status: profile.status || 'Unknown',
      joinedDate: profile.joinedDate || new Date().toISOString()
    },
    metrics: normalizedMetrics,
    trends: normalizedTrends,
    projectBreakdown: normalizedProjects,
    radarData: normalizedRadar,
    shipmentData: normalizedShipment,
    performanceScore: performanceScore,
    insights: chartData.insights || [],
    generatedAt: chartData.generatedAt || new Date().toISOString()
  };
};

const calculatePerformanceScore = (metrics) => {
  const weights = {
    deliveryRate: 0.30,
    onTimeRate: 0.25,
    activityLevel: 0.20,
    consistency: 0.15,
    growth: 0.10
  };

  const deliveryRate = parseFloat(metrics.deliveryRate) || 0;
  const onTimeRate = parseFloat(metrics.onTimeRate) || 0;
  const totalDeliveries = parseInt(metrics.totalDeliveries) || 0;
  const cancelRate = parseFloat(metrics.cancelRate) || 0;
  const growthRate = parseFloat(metrics.growthRate) || 0;

  const deliveryScore = Math.min(100, (deliveryRate / 95) * 100);
  const onTimeScore = Math.min(100, (onTimeRate / 90) * 100);
  const activityScore = Math.min(100, (totalDeliveries / 100) * 100);
  const consistencyScore = Math.max(0, 100 - (cancelRate * 10));
  
  let growthScore = 50 + growthRate;
  if (growthRate < 0) {
    growthScore = Math.max(0, 50 + growthRate);
  }
  growthScore = Math.max(0, Math.min(100, growthScore));

  const totalScore = (
    deliveryScore * weights.deliveryRate +
    onTimeScore * weights.onTimeRate +
    activityScore * weights.activityLevel +
    consistencyScore * weights.consistency +
    growthScore * weights.growth
  );

  return parseFloat(totalScore.toFixed(2));
};

const generateMitraPerformanceChart = async (req, res) => {
  let inputPath = null;
  let outputPath = null;

  try {
    console.log('Starting mitra performance chart generation...');
    await ensureTempDir();

    const rawChartData = req.body;
    const chartData = validateAndNormalizePerformanceData(rawChartData);

    console.log('Processing chart data for:', chartData.profile.name);
    console.log('Total deliveries:', chartData.metrics.totalDeliveries);
    console.log('Performance score:', chartData.performanceScore);

    const inputFilename = generateUniqueFilename("mitra_performance_data", "json");
    const outputFilename = generateUniqueFilename("mitra_performance_chart", "xlsx");

    inputPath = path.join(TEMP_DIR, inputFilename);
    outputPath = path.join(TEMP_DIR, outputFilename);

    console.log('Writing data to:', inputPath);
    await fs.writeFile(inputPath, JSON.stringify(chartData, null, 2), "utf-8");

    console.log('Executing Python script...');
    const result = await executePythonScript(inputPath, outputPath);

    if (!result.success) {
      throw new Error(result.error || "Chart generation failed");
    }

    console.log('Checking output file...');
    const fileExists = await fs.access(outputPath).then(() => true).catch(() => false);
    if (!fileExists) {
      throw new Error("Output file was not created");
    }

    const fileBuffer = await fs.readFile(outputPath);
    const fileName = `Mitra_Performance_${chartData.profile.name}_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.xlsx`;

    console.log('Sending file to client...');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', fileBuffer.length);

    res.send(fileBuffer);

  } catch (error) {
    console.error("Generate mitra performance chart error:", error);
    res.status(500).json({
      success: false,
      message: "Gagal generate performance chart",
      error: error.message || "Failed to generate mitra performance chart",
      details: error.stack
    });
  } finally {
    if (inputPath) {
      setTimeout(() => cleanupFile(inputPath), 1000);
    }
    if (outputPath) {
      setTimeout(() => cleanupFile(outputPath), 5000);
    }
  }
};

module.exports = {
  generateMitraPerformanceChart,
  validateAndNormalizePerformanceData,
  calculatePerformanceScore
};