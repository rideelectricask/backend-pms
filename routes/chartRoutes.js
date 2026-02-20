const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs").promises;
const router = express.Router();

const TEMP_DIR = path.join(__dirname, "..", "temp");
const PYTHON_SCRIPT = path.join(__dirname, "..", "utils", "chart_generator.py");
const PYTHON_SCRIPT_PROJECT_ANALYSIS = path.join(__dirname, "..", "utils", "projectAnalysisChartGenerator.py");
const PYTHON_SCRIPT_MITRA_ANALYSIS = path.join(__dirname, "..", "utils", "mitraAnalysisChartGenerator.py");

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

const executePythonScript = (scriptPath, inputPath, outputPath, mode = null) => {
  return new Promise((resolve, reject) => {
    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
    const args = mode ? [scriptPath, inputPath, outputPath, mode] : [scriptPath, inputPath, outputPath];
    
    const pythonProcess = spawn(pythonCommand, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: path.dirname(scriptPath)
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
    }, 180000);
  });
};

const validateDashboardData = (data) => {
  const { performanceData, summaryData, insightsData } = data;

  if (!performanceData || !Array.isArray(performanceData) || performanceData.length === 0) {
    throw new Error("Performance data is required and must be a non-empty array");
  }

  performanceData.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Performance data item ${index} must be an object`);
    }
    if (!item['Short Name'] && !item['Location']) {
      throw new Error(`Performance data item ${index} must have either 'Short Name' or 'Location'`);
    }
  });

  return true;
};

const validateProjectAnalysisData = (data) => {
  if (!data.projectAnalysis || !Array.isArray(data.projectAnalysis) || data.projectAnalysis.length === 0) {
    throw new Error("projectAnalysis is required and must be a non-empty array");
  }

  if (!data.shipmentData || !Array.isArray(data.shipmentData) || data.shipmentData.length === 0) {
    throw new Error("shipmentData is required and must be a non-empty array");
  }

  if (!data.periodType || !['monthly', 'weekly'].includes(data.periodType)) {
    throw new Error("periodType must be either 'monthly' or 'weekly'");
  }

  if (!data.metadata || typeof data.metadata !== 'object') {
    throw new Error("metadata is required and must be an object");
  }

  console.log('✓ Project data validation passed:', {
    projectCount: data.projectAnalysis.length,
    shipmentCount: data.shipmentData.length,
    periodType: data.periodType,
    filters: data.appliedFilters
  });

  return true;
};

const validateMitraAnalysisData = (data) => {
  if (!data.mitraAnalysis || !Array.isArray(data.mitraAnalysis) || data.mitraAnalysis.length === 0) {
    throw new Error("mitraAnalysis is required and must be a non-empty array");
  }

  if (!data.shipmentData || !Array.isArray(data.shipmentData) || data.shipmentData.length === 0) {
    throw new Error("shipmentData is required and must be a non-empty array");
  }

  if (!data.periodType || !['monthly', 'weekly'].includes(data.periodType)) {
    throw new Error("periodType must be either 'monthly' or 'weekly'");
  }

  if (!data.metadata || typeof data.metadata !== 'object') {
    throw new Error("metadata is required and must be an object");
  }

  console.log('✓ Mitra data validation passed:', {
    mitraCount: data.mitraAnalysis.length,
    shipmentCount: data.shipmentData.length,
    periodType: data.periodType,
    filters: data.appliedFilters
  });

  return true;
};

const logRequest = (req, res, next) => {
  const startTime = Date.now();
  const requestId = `${req.method}_${req.originalUrl}_${Date.now()}`;

  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - Request ID: ${requestId}`);

  req.requestId = requestId;

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms) - ID: ${requestId}`);
  });

  next();
};

const handleAsyncErrors = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

const handleErrors = (err, req, res, next) => {
  const errorId = `ERROR_${Date.now()}`;
  const timestamp = new Date().toISOString();

  console.error(`[${timestamp}] Error ID: ${errorId} in ${req.method} ${req.originalUrl}:`);
  console.error(`Error message: ${err.message}`);
  console.error(`Error stack: ${err.stack}`);

  let statusCode = 500;
  let message = 'Internal server error';
  let errorDetails = process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong';

  res.status(statusCode).json({
    message: message,
    error: errorDetails,
    errorId: errorId,
    timestamp: timestamp,
    success: false
  });
};

router.use(logRequest);

router.post("/generate-dashboard-chart", async (req, res) => {
  let inputPath = null;
  let outputPath = null;

  try {
    console.log('Starting dashboard chart generation...');
    await ensureTempDir();

    validateDashboardData(req.body);

    const { performanceData, summaryData, insightsData } = req.body;

    const chartData = {
      performanceData: performanceData.map(item => ({
        "Rank": item.Rank || 0,
        "Location": item.Location || item['Short Name'] || 'Unknown',
        "Short Name": item['Short Name'] || item.Location || 'Unknown',
        "Category": item.Category || 'Unknown',
        "Total Shipments": parseInt(item['Total Shipments']) || 0,
        "Late Shipments": parseInt(item['Late Shipments']) || 0,
        "On Time Percentage": parseFloat(item['On Time Percentage']) || 0,
        "Late Percentage": parseFloat(item['Late Percentage']) || 0,
        "Performance Level": item['Performance Level'] || 'N/A',
        "Performance Score": parseFloat(item['Performance Score']) || 0
      })),
      summaryData: summaryData || [],
      insightsData: insightsData || []
    };

    console.log('Processed chart data:', {
      performanceCount: chartData.performanceData.length,
      summaryCount: chartData.summaryData.length,
      insightsCount: chartData.insightsData.length
    });

    const inputFilename = generateUniqueFilename("dashboard_data", "json");
    const outputFilename = generateUniqueFilename("dashboard_chart", "xlsx");

    inputPath = path.join(TEMP_DIR, inputFilename);
    outputPath = path.join(TEMP_DIR, outputFilename);

    console.log('Writing data to:', inputPath);
    await fs.writeFile(inputPath, JSON.stringify(chartData, null, 2), "utf-8");

    console.log('Executing Python script...');
    const result = await executePythonScript(PYTHON_SCRIPT, inputPath, outputPath);

    if (!result.success) {
      throw new Error(result.error || "Chart generation failed");
    }

    console.log('Checking output file...');
    const fileExists = await fs.access(outputPath).then(() => true).catch(() => false);
    if (!fileExists) {
      throw new Error("Output file was not created");
    }

    const fileBuffer = await fs.readFile(outputPath);
    const fileName = `Dashboard_Analytics_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.xlsx`;

    console.log('Sending file to client...');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', fileBuffer.length);

    res.send(fileBuffer);

  } catch (error) {
    console.error("Chart generation error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to generate dashboard chart",
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
});

router.post("/generate-performance-chart", async (req, res) => {
  let inputPath = null;
  let outputPath = null;

  try {
    await ensureTempDir();

    const { courierData, chartType = "performance" } = req.body;

    if (!courierData || !Array.isArray(courierData)) {
      return res.status(400).json({
        success: false,
        error: "Courier data is required"
      });
    }

    const chartData = {
      performanceData: courierData.map((courier, index) => ({
        Rank: index + 1,
        "Short Name": courier.courierName?.substring(0, 20) || courier.courierCode || `Courier ${index + 1}`,
        Category: courier.hub || "Unknown",
        "Total Shipments": courier.totalDeliveries || 0,
        "Late Shipments": courier.lateDeliveries || 0,
        "On Time Percentage": courier.onTimePercentage || 0,
        "Performance Level": courier.performanceRating || "N/A"
      })),
      summaryData: [],
      insightsData: []
    };

    const inputFilename = generateUniqueFilename("performance_data", "json");
    const outputFilename = generateUniqueFilename("performance_chart", "xlsx");

    inputPath = path.join(TEMP_DIR, inputFilename);
    outputPath = path.join(TEMP_DIR, outputFilename);

    await fs.writeFile(inputPath, JSON.stringify(chartData, null, 2), "utf-8");

    const result = await executePythonScript(PYTHON_SCRIPT, inputPath, outputPath);

    if (!result.success) {
      throw new Error(result.error || "Performance chart generation failed");
    }

    const fileBuffer = await fs.readFile(outputPath);
    const fileName = `Performance_Analytics_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', fileBuffer.length);

    res.send(fileBuffer);

  } catch (error) {
    console.error("Performance chart generation error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to generate performance chart"
    });
  } finally {
    if (inputPath) {
      setTimeout(() => cleanupFile(inputPath), 1000);
    }
    if (outputPath) {
      setTimeout(() => cleanupFile(outputPath), 5000);
    }
  }
});

router.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Chart service is running",
    timestamp: new Date().toISOString(),
    pythonScript: PYTHON_SCRIPT,
    tempDir: TEMP_DIR
  });
});

const { generateMitraPerformanceChart } = require("../controllers/chartController");

router.post('/generate-mitra-performance', handleAsyncErrors(generateMitraPerformanceChart));

router.post('/generate-mitra-performance-formula', handleAsyncErrors(async (req, res) => {
  let inputPath = null;
  let outputPath = null;

  try {
    console.log('Starting mitra performance chart generation with formulas...');
    await ensureTempDir();

    const chartData = req.body;

    if (!chartData || !chartData.profile || !chartData.metrics) {
      return res.status(400).json({
        success: false,
        message: "Invalid data format",
        error: "Missing required performance data"
      });
    }

    const dataQuality = chartData.dataQuality || {};
    const hasValidTrends = Array.isArray(dataQuality) ? dataQuality[0]?.hasValidTrends : dataQuality.hasValidTrends;
    const trendCount = Array.isArray(dataQuality) ? dataQuality[0]?.trendCount : dataQuality.trendCount;
    const shipmentCount = Array.isArray(dataQuality) ? dataQuality[0]?.shipmentCount : dataQuality.shipmentCount;

    console.log(`Data quality check: hasValidTrends=${hasValidTrends}, trendCount=${trendCount}, shipmentCount=${shipmentCount}`);

    if (shipmentCount === 0) {
      return res.status(400).json({
        success: false,
        message: "No shipment data available",
        error: "Cannot generate report without shipment data"
      });
    }

    if (!hasValidTrends && (!chartData.shipmentData || chartData.shipmentData.length === 0)) {
      return res.status(400).json({
        success: false,
        message: "Insufficient data for formula-based export",
        error: "Shipment data required for formula-based export"
      });
    }

    console.log('Processing formula-based chart data for:', chartData.profile.name);
    console.log('Shipment data records:', chartData.shipmentData?.length || 0);

    const inputFilename = generateUniqueFilename("mitra_performance_formula", "json");
    const outputFilename = generateUniqueFilename("mitra_performance_formula", "xlsx");

    inputPath = path.join(TEMP_DIR, inputFilename);
    outputPath = path.join(TEMP_DIR, outputFilename);

    console.log('Writing data to:', inputPath);
    await fs.writeFile(inputPath, JSON.stringify(chartData, null, 2), "utf-8");

    const PYTHON_SCRIPT_FORMULA = path.join(__dirname, "..", "utils", "mitraPerformanceChartGeneratorFormula.py");
    
    console.log('Executing Python script for formula generation...');
    const result = await executePythonScript(PYTHON_SCRIPT_FORMULA, inputPath, outputPath);

    if (!result.success) {
      throw new Error(result.error || "Chart generation failed");
    }

    console.log('Checking output file...');
    const fileExists = await fs.access(outputPath).then(() => true).catch(() => false);
    if (!fileExists) {
      throw new Error("Output file was not created");
    }

    const fileBuffer = await fs.readFile(outputPath);
    
    let fileName = `Mitra_Performance_Formula_${chartData.profile.name}_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}`;
    if (!hasValidTrends) {
      fileName += '_LIMITED';
    }
    fileName += '.xlsx';

    console.log('Sending file to client...');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', fileBuffer.length);

    res.send(fileBuffer);

  } catch (error) {
    console.error("Generate mitra performance chart with formulas error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate performance chart with formulas",
      error: error.message || "Chart generation failed",
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
}));

router.post('/generate-mitra-performance-quick', handleAsyncErrors(async (req, res) => {
  let inputPath = null;
  let outputPath = null;

  try {
    console.log('Starting mitra performance quick chart generation...');
    await ensureTempDir();

    const chartData = req.body;

    if (!chartData || !chartData.profile || !chartData.metrics) {
      return res.status(400).json({
        success: false,
        message: "Invalid data format",
        error: "Missing required performance data"
      });
    }

    const dataQuality = chartData.dataQuality || {};
    const hasValidTrends = Array.isArray(dataQuality) ? dataQuality[0]?.hasValidTrends : dataQuality.hasValidTrends;
    const trendCount = Array.isArray(dataQuality) ? dataQuality[0]?.trendCount : dataQuality.trendCount;

    console.log(`Quick export - Data quality: hasValidTrends=${hasValidTrends}, trendCount=${trendCount}`);

    console.log('Processing quick chart data for:', chartData.profile.name);

    const quickData = {
      profile: chartData.profile,
      metrics: chartData.metrics,
      trends: chartData.trends,
      projectBreakdown: chartData.projectBreakdown,
      radarData: chartData.radarData,
      performanceScore: chartData.performanceScore,
      insights: chartData.insights,
      generatedAt: chartData.generatedAt,
      dataQuality: dataQuality
    };

    const inputFilename = generateUniqueFilename("mitra_performance_quick", "json");
    const outputFilename = generateUniqueFilename("mitra_performance_quick", "xlsx");

    inputPath = path.join(TEMP_DIR, inputFilename);
    outputPath = path.join(TEMP_DIR, outputFilename);

    console.log('Writing data to:', inputPath);
    await fs.writeFile(inputPath, JSON.stringify(quickData, null, 2), "utf-8");

    const PYTHON_SCRIPT_QUICK = path.join(__dirname, "..", "utils", "mitraPerformanceChartGeneratorQuick.py");
    
    console.log('Executing Python script for quick generation...');
    const result = await executePythonScript(PYTHON_SCRIPT_QUICK, inputPath, outputPath);

    if (!result.success) {
      throw new Error(result.error || "Quick chart generation failed");
    }

    console.log('Checking output file...');
    const fileExists = await fs.access(outputPath).then(() => true).catch(() => false);
    if (!fileExists) {
      throw new Error("Output file was not created");
    }

    const fileBuffer = await fs.readFile(outputPath);
    
    let fileName = `Mitra_Performance_Quick_${chartData.profile.name}_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}`;
    if (!hasValidTrends) {
      fileName += '_LIMITED';
    }
    fileName += '.xlsx';

    console.log('Sending file to client...');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', fileBuffer.length);

    res.send(fileBuffer);

  } catch (error) {
    console.error("Generate mitra performance quick chart error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate quick performance chart",
      error: error.message || "Quick chart generation failed",
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
}));

router.post('/generate-mitra-analysis', handleAsyncErrors(async (req, res) => {
  let inputPath = null;
  let outputPath = null;

  try {
    console.log('Starting mitra analysis complete export...');
    console.log('Request body keys:', Object.keys(req.body));
    await ensureTempDir();

    const exportData = req.body;

    validateMitraAnalysisData(exportData);

    const mitraCount = exportData.mitraAnalysis?.length || 0;
    const shipmentCount = exportData.shipmentData?.length || 0;
    const periodType = exportData.periodType || 'monthly';

    console.log(`✓ Processing mitra analysis: ${mitraCount} mitras, ${shipmentCount} shipments, period: ${periodType}`);

    const completeData = {
      metadata: exportData.metadata,
      mitraAnalysis: exportData.mitraAnalysis,
      shipmentData: exportData.shipmentData,
      trends: exportData.trends || [],
      summary: exportData.summary || [],
      mitraSummary: exportData.mitraSummary || [],
      hubAnalysis: exportData.hubAnalysis || [],
      clientAnalysis: exportData.clientAnalysis || [],
      insightsAnalysis: exportData.insightsAnalysis || [],
      insightsManagement: exportData.insightsManagement || [],
      insightsOperational: exportData.insightsOperational || [],
      periodType: periodType,
      appliedFilters: exportData.appliedFilters || {},
      generatedAt: new Date().toISOString()
    };

    console.log('✓ Complete export data prepared with all divisions');

    const inputFilename = generateUniqueFilename("mitra_analysis_complete", "json");
    const outputFilename = generateUniqueFilename("mitra_analysis_complete", "xlsx");

    inputPath = path.join(TEMP_DIR, inputFilename);
    outputPath = path.join(TEMP_DIR, outputFilename);

    console.log('Writing data to:', inputPath);
    await fs.writeFile(inputPath, JSON.stringify(completeData, null, 2), "utf-8");

    console.log('Python script path:', PYTHON_SCRIPT_MITRA_ANALYSIS);
    console.log('Python script exists:', await fs.access(PYTHON_SCRIPT_MITRA_ANALYSIS).then(() => true).catch(() => false));
    
    console.log('Executing Python script for complete analysis generation...');
    const result = await executePythonScript(PYTHON_SCRIPT_MITRA_ANALYSIS, inputPath, outputPath);

    if (!result.success) {
      throw new Error(result.error || "Complete analysis generation failed");
    }

    console.log('Checking output file...');
    const fileExists = await fs.access(outputPath).then(() => true).catch(() => false);
    if (!fileExists) {
      throw new Error("Output file was not created");
    }

    const fileBuffer = await fs.readFile(outputPath);
    
    const fileName = `Mitra_Analysis_Complete_${periodType}_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.xlsx`;

    console.log('✓ Sending complete analysis file to client...');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', fileBuffer.length);

    res.send(fileBuffer);

  } catch (error) {
    console.error("Generate complete mitra analysis error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate complete mitra analysis",
      error: error.message || "Analysis generation failed",
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
}));

router.post('/generate-project-analysis', handleAsyncErrors(async (req, res) => {
  let inputPath = null;
  let outputPath = null;

  try {
    console.log('Starting project analysis export (STATIC MODE)...');
    console.log('Request body keys:', Object.keys(req.body));
    await ensureTempDir();

    const exportData = req.body;

    validateProjectAnalysisData(exportData);

    const projectCount = exportData.projectAnalysis?.length || 0;
    const shipmentCount = exportData.shipmentData?.length || 0;
    const periodType = exportData.periodType || 'monthly';

    console.log(`✓ Processing project analysis (STATIC): ${projectCount} projects, ${shipmentCount} shipments, period: ${periodType}`);

    const completeData = {
      metadata: exportData.metadata,
      projectAnalysis: exportData.projectAnalysis,
      shipmentData: exportData.shipmentData,
      trends: exportData.trends || [],
      summary: exportData.summary || [],
      projectSummary: exportData.projectSummary || [],
      hubAnalysis: exportData.hubAnalysis || [],
      insightsAnalysis: exportData.insightsAnalysis || [],
      insightsManagement: exportData.insightsManagement || [],
      insightsOperational: exportData.insightsOperational || [],
      periodType: periodType,
      appliedFilters: exportData.appliedFilters || {},
      generatedAt: new Date().toISOString()
    };

    console.log('✓ Complete export data prepared (STATIC MODE)');

    const inputFilename = generateUniqueFilename("project_analysis_static", "json");
    const outputFilename = generateUniqueFilename("project_analysis_static", "xlsx");

    inputPath = path.join(TEMP_DIR, inputFilename);
    outputPath = path.join(TEMP_DIR, outputFilename);

    console.log('Writing data to:', inputPath);
    await fs.writeFile(inputPath, JSON.stringify(completeData, null, 2), "utf-8");

    console.log('Python script path:', PYTHON_SCRIPT_PROJECT_ANALYSIS);
    console.log('Python script exists:', await fs.access(PYTHON_SCRIPT_PROJECT_ANALYSIS).then(() => true).catch(() => false));
    
    console.log('Executing Python script (STATIC MODE)...');
    const result = await executePythonScript(PYTHON_SCRIPT_PROJECT_ANALYSIS, inputPath, outputPath, 'static');

    if (!result.success) {
      throw new Error(result.error || "Static project analysis generation failed");
    }

    console.log('Checking output file...');
    const fileExists = await fs.access(outputPath).then(() => true).catch(() => false);
    if (!fileExists) {
      throw new Error("Output file was not created");
    }

    const fileBuffer = await fs.readFile(outputPath);
    
    const fileName = `Project_Analysis_Static_${periodType}_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.xlsx`;

    console.log('✓ Sending static project analysis file to client...');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', fileBuffer.length);

    res.send(fileBuffer);

  } catch (error) {
    console.error("Generate static project analysis error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate static project analysis",
      error: error.message || "Analysis generation failed",
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
}));

router.post('/generate-project-analysis-formula', handleAsyncErrors(async (req, res) => {
  let inputPath = null;
  let outputPath = null;

  try {
    console.log('Starting project analysis export (FORMULA MODE)...');
    console.log('Request body keys:', Object.keys(req.body));
    await ensureTempDir();

    const exportData = req.body;

    validateProjectAnalysisData(exportData);

    const projectCount = exportData.projectAnalysis?.length || 0;
    const shipmentCount = exportData.shipmentData?.length || 0;
    const periodType = exportData.periodType || 'monthly';

    console.log(`✓ Processing project analysis (FORMULA): ${projectCount} projects, ${shipmentCount} shipments, period: ${periodType}`);

    const completeData = {
      metadata: exportData.metadata,
      projectAnalysis: exportData.projectAnalysis,
      shipmentData: exportData.shipmentData,
      trends: exportData.trends || [],
      summary: exportData.summary || [],
      projectSummary: exportData.projectSummary || [],
      hubAnalysis: exportData.hubAnalysis || [],
      insightsAnalysis: exportData.insightsAnalysis || [],
      insightsManagement: exportData.insightsManagement || [],
      insightsOperational: exportData.insightsOperational || [],
      periodType: periodType,
      appliedFilters: exportData.appliedFilters || {},
      generatedAt: new Date().toISOString()
    };

    console.log('✓ Complete export data prepared (FORMULA MODE)');

    const inputFilename = generateUniqueFilename("project_analysis_formula", "json");
    const outputFilename = generateUniqueFilename("project_analysis_formula", "xlsx");

    inputPath = path.join(TEMP_DIR, inputFilename);
    outputPath = path.join(TEMP_DIR, outputFilename);

    console.log('Writing data to:', inputPath);
    await fs.writeFile(inputPath, JSON.stringify(completeData, null, 2), "utf-8");

    console.log('Python script path:', PYTHON_SCRIPT_PROJECT_ANALYSIS);
    console.log('Python script exists:', await fs.access(PYTHON_SCRIPT_PROJECT_ANALYSIS).then(() => true).catch(() => false));
    
    console.log('Executing Python script (FORMULA MODE)...');
    const result = await executePythonScript(PYTHON_SCRIPT_PROJECT_ANALYSIS, inputPath, outputPath, 'formula');

    if (!result.success) {
      throw new Error(result.error || "Formula-based project analysis generation failed");
    }

    console.log('Checking output file...');
    const fileExists = await fs.access(outputPath).then(() => true).catch(() => false);
    if (!fileExists) {
      throw new Error("Output file was not created");
    }

    const fileBuffer = await fs.readFile(outputPath);
    
    const fileName = `Project_Analysis_Formula_${periodType}_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.xlsx`;

    console.log('✓ Sending formula-based project analysis file to client...');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', fileBuffer.length);

    res.send(fileBuffer);

  } catch (error) {
    console.error("Generate formula-based project analysis error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate formula-based project analysis",
      error: error.message || "Analysis generation failed",
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
}));

console.log('✅ Chart routes registered:');
console.log('   - POST /api/chart/generate-dashboard-chart');
console.log('   - POST /api/chart/generate-performance-chart');
console.log('   - POST /api/chart/generate-mitra-performance');
console.log('   - POST /api/chart/generate-mitra-performance-formula');
console.log('   - POST /api/chart/generate-mitra-performance-quick');
console.log('   - POST /api/chart/generate-mitra-analysis');
console.log('   - POST /api/chart/generate-project-analysis (STATIC MODE)');
console.log('   - POST /api/chart/generate-project-analysis-formula (FORMULA MODE)');
console.log('   - GET /api/chart/health');
console.log('');
console.log('📊 Export Modes Available:');
console.log('   1. Formula Mode: Excel formulas for dynamic calculation');
console.log('   2. Static Mode: Pre-calculated values for instant display');
console.log('');
console.log('✅ Using unified Python script for Project Analysis:');
console.log(`   Script: ${PYTHON_SCRIPT_PROJECT_ANALYSIS}`);

router.use(handleErrors);

module.exports = router;