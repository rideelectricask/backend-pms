const SayurboxData = require("../models/SayurboxData");
const ExcelData = require("../models/ExcelData");
const EData = require("../models/EData");

const BATCH_SIZE = 3000;
const COMPARE_BATCH_SIZE = 500;
const DISPLAY_LIMIT = 50;

const WEIGHT_CONFIG = {
  THRESHOLD: 0.30,
  BASE: 10,
  CHARGE_RATE: 400
};

const DISTANCE_CONFIG = {
  THRESHOLD: 0.30
};

const formatWeight = (weight) => {
  const numericWeight = Number(weight) || 0;
  return numericWeight % 1 === 0 ? numericWeight.toString() : numericWeight.toFixed(2);
};

const calculateWeightMetrics = (weight) => {
  const numericWeight = Number(weight) || 0;
  const integerPart = Math.floor(numericWeight);
  const decimalPart = numericWeight - integerPart;

  const roundDown = numericWeight < 1 ? 0 : integerPart;
  const roundUp = decimalPart > WEIGHT_CONFIG.THRESHOLD ? integerPart + 1 : integerPart;
  const weightDecimal = Number((numericWeight - roundDown).toFixed(2));
  const addCharge1 = roundUp < WEIGHT_CONFIG.BASE ? 0 : (roundUp - WEIGHT_CONFIG.BASE) * WEIGHT_CONFIG.CHARGE_RATE;

  return {
    weight: formatWeight(numericWeight),
    roundDown,
    roundUp,
    weightDecimal,
    addCharge1: addCharge1.toString()
  };
};

const calculateDistanceMetrics = (distance) => {
  const distanceVal = Number(distance) || 0;
  const integerPart = Math.floor(distanceVal);
  const decimalPart = distanceVal - integerPart;

  const roundDown = distanceVal < 1 ? 0 : integerPart;
  const roundUp = decimalPart > DISTANCE_CONFIG.THRESHOLD ? integerPart + 1 : integerPart;

  return {
    distance: distanceVal,
    roundDownDistance: roundDown,
    roundUpDistance: roundUp
  };
};

const validateRequiredFields = (item, index) => {
  const requiredFields = ['order_no'];
  const missingFields = requiredFields.filter(field => {
    const value = item[field];
    return !value && value !== 0 && value !== '';
  });

  if (missingFields.length > 0) {
    throw new Error(`Record ${index + 1}: ${missingFields.join(', ')} wajib diisi`);
  }
};

const validateEDataRequiredFields = (item, index) => {
  const requiredFields = ['order_no'];
  const missingFields = requiredFields.filter(field => {
    const value = item[field];
    return !value && value !== 0 && value !== '';
  });

  if (missingFields.length > 0) {
    throw new Error(`Record ${index + 1}: ${missingFields.join(', ')} wajib diisi`);
  }
};

const transformSayurboxItem = (item) => ({
  orderNo: String(item.order_no || '').trim(),
  timeSlot: String(item.time_slot || '').trim(),
  channel: String(item.channel || '').trim(),
  deliveryDate: String(item.delivery_date || '').trim(),
  driverName: String(item.driver_name || '').trim(),
  hubName: String(item.hub_name || '').trim(),
  shippedAt: String(item.shipped_at || '').trim(),
  deliveredAt: String(item.delivered_at || '').trim(),
  puOrder: String(item.pu_order || '').trim(),
  timeSlotStart: String(item.time_slot_start || '').trim(),
  latePickupMinute: parseFloat(item.late_pickup_minute) || 0,
  puAfterTsMinute: parseFloat(item.pu_after_ts_minute) || 0,
  timeSlotEnd: String(item.time_slot_end || '').trim(),
  lateDeliveryMinute: parseFloat(item.late_delivery_minute) || 0,
  isOntime: item.is_ontime === true || item.is_ontime === 'true' || item.is_ontime === '1',
  distanceInKm: parseFloat(item.distance_in_km) || 0,
  totalWeightPerorder: parseFloat(item.total_weight_perorder) || 0,
  paymentMethod: String(item.payment_method || '').trim(),
  monthly: String(item.monthly || item.Monthly || '').trim()
});

const transformEDataItem = (item) => ({
  driverName: String(item.driver_name || '').trim(),
  district: String(item.district || '').trim(),
  customerName: String(item.customer_name || '').trim(),
  deliveryDate: String(item.delivery_date || '').trim(),
  address: String(item.address || '').trim(),
  addressNote: String(item.address_note || '').trim(),
  orderNo: String(item.order_no || '').trim(),
  packagingOption: String(item.packaging_option || '').trim(),
  distanceInKm: parseFloat(item.distance_in_km) || 0,
  hubs: String(item.hubs || '').trim(),
  totalPrice: parseFloat(item.total_price) || 0,
  externalNote: String(item.external_note || '').trim(),
  internalNote: String(item.internal_note || '').trim(),
  customerNote: String(item.customer_note || '').trim(),
  timeSlot: String(item.time_slot || '').trim(),
  noPlastic: String(item.no_plastic || '').trim(),
  paymentMethod: String(item.payment_method || '').trim(),
  latitude: parseFloat(item.latitude) || 0,
  longitude: parseFloat(item.longitude) || 0,
  shippingNumber: String(item.shipping_number || '').trim()
});

const transformSayurboxData = (dataArray) => {
  return dataArray.map((item, index) => {
    validateRequiredFields(item, index);
    return transformSayurboxItem(item);
  }).filter(item => item.orderNo.trim() !== '');
};

const transformEDataArray = (dataArray) => {
  return dataArray.map((item, index) => {
    validateEDataRequiredFields(item, index);
    return transformEDataItem(item);
  }).filter(item => item.orderNo.trim() !== '');
};

const createUploadState = () => ({
  isInitialized: false,
  totalProcessed: 0,
  reset() {
    this.isInitialized = false;
    this.totalProcessed = 0;
    console.log('Upload state reset');
  }
});

const createEDataUploadState = () => ({
  isInitialized: false,
  totalProcessed: 0,
  reset() {
    this.isInitialized = false;
    this.totalProcessed = 0;
    console.log('EData upload state reset');
  }
});

const uploadState = createUploadState();
const eDataUploadState = createEDataUploadState();

const logBatchOperation = (operation, batchNum, totalBatches, count, total = null) => {
  const message = total 
    ? `${operation} segment ${batchNum}/${totalBatches} (${count} records): ${total} total`
    : `${operation} segment ${batchNum}/${totalBatches} (${count} records)`;
  console.log(message);
};

const handleBatchUpsert = async (batch, batchNum, totalBatches, Model, keyField = 'orderNo') => {
  logBatchOperation('Upserting', batchNum, totalBatches, batch.length);

  try {
    const bulkOps = batch.map(item => ({
      replaceOne: {
        filter: { [keyField]: item[keyField] },
        replacement: item,
        upsert: true
      }
    }));

    const bulkResult = await Model.bulkWrite(bulkOps, { ordered: false });
    const processedCount = bulkResult.upsertedCount + bulkResult.modifiedCount;

    logBatchOperation('Upsert completed', batchNum, totalBatches, processedCount, batch.length);

    return {
      batchNum,
      inserted: bulkResult.upsertedCount,
      updated: bulkResult.modifiedCount,
      processed: processedCount,
      records: batch.length,
      actualSaved: processedCount,
      success: true
    };
  } catch (upsertError) {
    console.error(`Batch ${batchNum} upsert failed:`, upsertError.message);
    throw new Error(`Database upsert failed at segment ${batchNum}: ${upsertError.message}`);
  }
};

const processBatchUpserts = async (transformedData, Model, keyField = 'orderNo') => {
  let totalProcessed = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalActualSaved = 0;
  const upsertResults = [];

  const totalBatches = Math.ceil(transformedData.length / BATCH_SIZE);

  for (let i = 0; i < transformedData.length; i += BATCH_SIZE) {
    const batch = transformedData.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    const result = await handleBatchUpsert(batch, batchNum, totalBatches, Model, keyField);

    totalProcessed += result.processed;
    totalInserted += result.inserted;
    totalUpdated += result.updated;
    totalActualSaved += result.actualSaved;
    upsertResults.push(result);
  }

  return { totalProcessed, totalInserted, totalUpdated, totalActualSaved, upsertResults };
};

const createUpsertResponse = (totalActualSaved, totalInserted, totalUpdated, processedRecords, sessionTotal, databaseTotal, duration, upsertResults, dataType) => ({
  message: `Data ${dataType} berhasil disimpan ke database`,
  count: totalActualSaved,
  summary: {
    totalRecords: totalActualSaved,
    insertedRecords: totalInserted,
    updatedRecords: totalUpdated,
    processedRecords,
    sessionTotal,
    databaseTotal,
    success: true,
    duration: `${duration}ms`,
    upsertResults
  }
});

const createErrorResponse = (message, error, duration) => ({
  message,
  error: error.message,
  duration: `${duration}ms`
});

const resetUploadState = async (req, res) => {
  try {
    uploadState.reset();
    console.log('Upload state has been reset manually');

    res.status(200).json({ 
      message: "Upload state reset successfully",
      success: true 
    });
  } catch (error) {
    console.error("Reset upload state error:", error.message);
    res.status(500).json({ 
      message: "Reset upload state failed", 
      error: error.message 
    });
  }
};

const resetEDataUploadState = async (req, res) => {
  try {
    eDataUploadState.reset();
    console.log('EData upload state has been reset manually');

    res.status(200).json({ 
      message: "EData upload state reset successfully",
      success: true 
    });
  } catch (error) {
    console.error("Reset EData upload state error:", error.message);
    res.status(500).json({ 
      message: "Reset EData upload state failed", 
      error: error.message 
    });
  }
};

const uploadSayurboxData = async (req, res) => {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Starting sayurbox data upload...`);

  try {
    const dataArray = req.body;

    if (!Array.isArray(dataArray) || dataArray.length === 0) {
      console.error("Invalid data format received");
      return res.status(400).json({ 
        message: "Data sayurbox tidak valid atau kosong",
        error: "Expected non-empty array"
      });
    }

    console.log(`Processing segment with ${dataArray.length} records...`);

    let transformedData;
    try {
      transformedData = transformSayurboxData(dataArray);
      console.log(`Data transformation completed: ${transformedData.length} valid records from ${dataArray.length} input records`);
    } catch (transformError) {
      console.error("Data transformation failed:", transformError.message);
      return res.status(400).json({
        message: "Data validation failed",
        error: transformError.message
      });
    }

    if (transformedData.length === 0) {
      console.error("No valid records after transformation");
      return res.status(400).json({
        message: "Tidak ada data valid setelah transformasi",
        error: "All records failed validation"
      });
    }

    const { totalProcessed, totalInserted, totalUpdated, totalActualSaved, upsertResults } = await processBatchUpserts(transformedData, SayurboxData);

    uploadState.totalProcessed += totalActualSaved;
    const duration = Date.now() - startTime;

    console.log(`Sayurbox batch upload completed successfully:`);
    console.log(`- Input records: ${dataArray.length}`);
    console.log(`- Valid records after transformation: ${transformedData.length}`);
    console.log(`- Records inserted: ${totalInserted}`);
    console.log(`- Records updated: ${totalUpdated}`);
    console.log(`- Total actually saved: ${totalActualSaved}`);
    console.log(`- Total saved in session: ${uploadState.totalProcessed}`);
    console.log(`- Duration: ${duration}ms`);

    const currentCount = await SayurboxData.countDocuments();
    console.log(`Current total records in database: ${currentCount}`);

    const response = createUpsertResponse(
      totalActualSaved,
      totalInserted,
      totalUpdated,
      transformedData.length, 
      uploadState.totalProcessed, 
      currentCount, 
      duration, 
      upsertResults,
      "sayurbox"
    );

    res.status(201).json(response);

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`Upload sayurbox failed after ${duration}ms:`, error.message);
    console.error("Error stack:", error.stack);

    res.status(500).json(createErrorResponse("Upload data sayurbox gagal", error, duration));
  }
};

const uploadEData = async (req, res) => {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Starting edata upload...`);

  try {
    const dataArray = req.body;

    if (!Array.isArray(dataArray) || dataArray.length === 0) {
      console.error("Invalid edata format received");
      return res.status(400).json({ 
        message: "Data edata tidak valid atau kosong",
        error: "Expected non-empty array"
      });
    }

    console.log(`Processing edata segment with ${dataArray.length} records...`);

    let transformedData;
    try {
      transformedData = transformEDataArray(dataArray);
      console.log(`EData transformation completed: ${transformedData.length} valid records from ${dataArray.length} input records`);
    } catch (transformError) {
      console.error("EData transformation failed:", transformError.message);
      return res.status(400).json({
        message: "EData validation failed",
        error: transformError.message
      });
    }

    if (transformedData.length === 0) {
      console.error("No valid edata records after transformation");
      return res.status(400).json({
        message: "Tidak ada data edata valid setelah transformasi",
        error: "All records failed validation"
      });
    }

    const { totalProcessed, totalInserted, totalUpdated, totalActualSaved, upsertResults } = await processBatchUpserts(transformedData, EData);

    eDataUploadState.totalProcessed += totalActualSaved;
    const duration = Date.now() - startTime;

    console.log(`EData batch upload completed successfully:`);
    console.log(`- Input records: ${dataArray.length}`);
    console.log(`- Valid records after transformation: ${transformedData.length}`);
    console.log(`- Records inserted: ${totalInserted}`);
    console.log(`- Records updated: ${totalUpdated}`);
    console.log(`- Total actually saved: ${totalActualSaved}`);
    console.log(`- Total saved in session: ${eDataUploadState.totalProcessed}`);
    console.log(`- Duration: ${duration}ms`);

    const currentCount = await EData.countDocuments();
    console.log(`Current total edata records in database: ${currentCount}`);

    const response = createUpsertResponse(
      totalActualSaved,
      totalInserted,
      totalUpdated,
      transformedData.length, 
      eDataUploadState.totalProcessed, 
      currentCount, 
      duration, 
      upsertResults,
      "edata"
    );

    res.status(201).json(response);

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`Upload edata failed after ${duration}ms:`, error.message);
    console.error("Error stack:", error.stack);

    res.status(500).json(createErrorResponse("Upload data edata gagal", error, duration));
  }
};

const getAllSayurboxData = async (req, res) => {
  try {
    const { page = 1, limit = 1000 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    console.log(`Fetching sayurbox data - page: ${pageNum}, limit: ${limitNum}`);

    const query = SayurboxData.find()
      .select('orderNo driverName hubName distanceInKm totalWeightPerorder deliveryDate timeSlot channel shippedAt deliveredAt isOntime paymentMethod monthly')
      .sort({ hubName: 1, driverName: 1, deliveryDate: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean()
      .allowDiskUse(true);

    const [data, total] = await Promise.all([
      query,
      SayurboxData.countDocuments()
    ]);

    console.log(`Sayurbox data fetched: ${data.length} records, Total in DB: ${total}`);

    res.status(200).json({
      message: "Data sayurbox berhasil diambil",
      count: data.length,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      data
    });
  } catch (error) {
    console.error("Get sayurbox error:", error.message);
    res.status(500).json({ 
      message: "Gagal mengambil data sayurbox", 
      error: error.message 
    });
  }
};

const getAllEData = async (req, res) => {
  try {
    const { page = 1, limit = 0 } = req.query;

    console.log(`Fetching edata - page: ${page}, limit: ${limit}`);

    const skip = limit > 0 ? (page - 1) * limit : 0;
    const query = EData.find()
      .sort({ hubs: 1, driverName: 1, deliveryDate: -1 })
      .lean();

    if (limit > 0) {
      query.skip(skip).limit(parseInt(limit));
    }

    const [data, total] = await Promise.all([
      query,
      EData.countDocuments()
    ]);

    console.log(`EData fetched: ${data.length} records, Total in DB: ${total}`);

    const response = {
      message: "Data edata berhasil diambil",
      count: data.length,
      total,
      data
    };

    if (limit > 0) {
      response.page = parseInt(page);
      response.totalPages = Math.ceil(total / limit);
    }

    res.status(200).json(response);
  } catch (error) {
    console.error("Get edata error:", error.message);
    res.status(500).json({ 
      message: "Gagal mengambil data edata", 
      error: error.message 
    });
  }
};

const createFilterQuery = (field, value) => ({
  [field]: { $regex: new RegExp(value, "i") }
});

const getSayurboxDataByFilter = async (req, res, filterField, filterValue, filterName) => {
  try {
    const { page = 1, limit = 1000 } = req.query;
    const skip = (page - 1) * limit;

    console.log(`Mencari data sayurbox untuk ${filterName}: ${filterValue}`);

    const filterQuery = createFilterQuery(filterField, filterValue);
    const sortQuery = filterField === 'hubName' 
      ? { driverName: 1, deliveryDate: -1 }
      : { deliveryDate: -1, hubName: 1 };

    const data = await SayurboxData.find(filterQuery)
      .sort(sortQuery)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await SayurboxData.countDocuments(filterQuery);

    console.log(`Jumlah data sayurbox ditemukan untuk ${filterName} ${filterValue}: ${total}`);

    res.status(200).json({
      message: `Data sayurbox untuk ${filterName} ${filterValue} berhasil diambil`,
      count: data.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit),
      data
    });
  } catch (error) {
    console.error(`Get sayurbox by ${filterName} error:`, error.message);
    res.status(500).json({ 
      message: `Gagal mengambil data sayurbox berdasarkan ${filterName}`, 
      error: error.message 
    });
  }
};

const getEDataByFilter = async (req, res, filterField, filterValue, filterName) => {
  try {
    const { page = 1, limit = 1000 } = req.query;
    const skip = (page - 1) * limit;

    console.log(`Mencari edata untuk ${filterName}: ${filterValue}`);

    const filterQuery = createFilterQuery(filterField, filterValue);
    const sortQuery = filterField === 'hubs' 
      ? { driverName: 1, deliveryDate: -1 }
      : { deliveryDate: -1, hubs: 1 };

    const data = await EData.find(filterQuery)
      .sort(sortQuery)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await EData.countDocuments(filterQuery);

    console.log(`Jumlah edata ditemukan untuk ${filterName} ${filterValue}: ${total}`);

    res.status(200).json({
      message: `Data edata untuk ${filterName} ${filterValue} berhasil diambil`,
      count: data.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit),
      data
    });
  } catch (error) {
    console.error(`Get edata by ${filterName} error:`, error.message);
    res.status(500).json({ 
      message: `Gagal mengambil data edata berdasarkan ${filterName}`, 
      error: error.message 
    });
  }
};

const getSayurboxDataByHub = async (req, res) => {
  const hub = req.params.hub;
  await getSayurboxDataByFilter(req, res, 'hubName', hub, 'hub');
};

const getSayurboxDataByDriver = async (req, res) => {
  const driver = req.params.driver;
  await getSayurboxDataByFilter(req, res, 'driverName', driver, 'driver');
};

const getEDataByHub = async (req, res) => {
  const hub = req.params.hub;
  await getEDataByFilter(req, res, 'hubs', hub, 'hub');
};

const getEDataByDriver = async (req, res) => {
  const driver = req.params.driver;
  await getEDataByFilter(req, res, 'driverName', driver, 'driver');
};

const deleteSayurboxData = async (req, res) => {
  try {
    const result = await SayurboxData.deleteMany({});
    uploadState.reset();

    console.log(`Deleted ${result.deletedCount} sayurbox records`);

    res.status(200).json({
      message: "Semua data sayurbox berhasil dihapus",
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error("Delete sayurbox error:", error.message);
    res.status(500).json({ 
      message: "Gagal menghapus data sayurbox", 
      error: error.message 
    });
  }
};

const deleteEData = async (req, res) => {
  try {
    const result = await EData.deleteMany({});
    eDataUploadState.reset();

    console.log(`Deleted ${result.deletedCount} edata records`);

    res.status(200).json({
      message: "Semua data edata berhasil dihapus",
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error("Delete edata error:", error.message);
    res.status(500).json({ 
      message: "Gagal menghapus data edata", 
      error: error.message 
    });
  }
};

const getDataInfo = async (req, res) => {
  try {
    const [sayurboxCount, excelCount] = await Promise.all([
      SayurboxData.countDocuments(),
      ExcelData.countDocuments()
    ]);

    res.status(200).json({
      sayurboxCount,
      excelCount,
      estimatedMatches: Math.min(sayurboxCount, excelCount),
      uploadState: {
        isInitialized: uploadState.isInitialized,
        totalProcessed: uploadState.totalProcessed
      }
    });
  } catch (error) {
    console.error("Get data info error:", error.message);
    res.status(500).json({ 
      message: "Gagal mengambil info data", 
      error: error.message 
    });
  }
};

const getEDataInfo = async (req, res) => {
  try {
    const edataCount = await EData.countDocuments();

    res.status(200).json({
      edataCount,
      uploadState: {
        isInitialized: eDataUploadState.isInitialized,
        totalProcessed: eDataUploadState.totalProcessed
      }
    });
  } catch (error) {
    console.error("Get edata info error:", error.message);
    res.status(500).json({ 
      message: "Gagal mengambil info edata", 
      error: error.message 
    });
  }
};

const validateDataForComparison = async () => {
  const [sayurboxCount, excelCount] = await Promise.all([
    SayurboxData.countDocuments(),
    ExcelData.countDocuments()
  ]);

  if (sayurboxCount === 0) {
    throw new Error("Tidak ada data Sayurbox untuk dibandingkan. Silakan upload data Sayurbox terlebih dahulu.");
  }

  if (excelCount === 0) {
    throw new Error("Tidak ada data Excel untuk dibandingkan. Silakan upload data Excel terlebih dahulu.");
  }

  return { sayurboxCount, excelCount };
};

const createSayurboxMap = (sayurboxData) => {
  const sayurboxMap = new Map();
  const sayurboxOrderNos = new Set();

  sayurboxData.forEach(item => {
    if (item.orderNo) {
      const trimmedOrderNo = item.orderNo.toString().trim();
      sayurboxMap.set(trimmedOrderNo, {
        distanceInKm: parseFloat(item.distanceInKm) || 0,
        totalWeightPerorder: parseFloat(item.totalWeightPerorder) || 0
      });
      sayurboxOrderNos.add(trimmedOrderNo);
    }
  });

  return { sayurboxMap, sayurboxOrderNos };
};

const processBatchComparison = async (excelBatch, sayurboxMap, session) => {
  const bulkOps = [];
  let batchChecked = 0;
  let batchMatched = 0;
  const batchUnmatchedExcel = [];
  const batchProcessedExcel = new Set();

  for (const excelItem of excelBatch) {
    batchChecked++;
    const orderCode = excelItem["Order Code"];

    if (orderCode) {
      const trimmedOrderCode = orderCode.toString().trim();
      batchProcessedExcel.add(trimmedOrderCode);

      if (sayurboxMap.has(trimmedOrderCode)) {
        const sayurboxItem = sayurboxMap.get(trimmedOrderCode);
        batchMatched++;

        const distanceMetrics = calculateDistanceMetrics(sayurboxItem.distanceInKm);
        const weightMetrics = calculateWeightMetrics(sayurboxItem.totalWeightPerorder);

        bulkOps.push({
          updateOne: {
            filter: { _id: excelItem._id },
            update: {
              $set: {
                Distance: distanceMetrics.distance,
                "RoundDown Distance": distanceMetrics.roundDownDistance,
                "RoundUp Distance": distanceMetrics.roundUpDistance,
                Weight: weightMetrics.weight,
                RoundDown: weightMetrics.roundDown,
                RoundUp: weightMetrics.roundUp,
                WeightDecimal: weightMetrics.weightDecimal
              }
            }
          }
        });
      } else {
        batchUnmatchedExcel.push(trimmedOrderCode);
      }
    }
  }

  let batchUpdated = 0;
  if (bulkOps.length > 0) {
    const result = await ExcelData.bulkWrite(bulkOps, { session });
    batchUpdated = result.modifiedCount;
  }

  return {
    batchChecked,
    batchMatched,
    batchUpdated,
    batchUnmatchedExcel,
    batchProcessedExcel
  };
};

const compareOrderCodeData = async (req, res) => {
  const startTime = Date.now();
  const orderCode = req.body.orderCode.trim();

  console.log(`[${new Date().toISOString()}] Starting individual compare for order: ${orderCode}`);

  try {
    const [sayurboxRecord, excelRecord] = await Promise.all([
      SayurboxData.findOne({ orderNo: orderCode }).lean(),
      ExcelData.findOne({ "Order Code": orderCode }).lean()
    ]);

    if (!sayurboxRecord) {
      return res.status(404).json({
        success: false,
        message: `Order Code ${orderCode} tidak ditemukan di SayurboxData`,
        updated: false,
        orderCode
      });
    }

    if (!excelRecord) {
      return res.status(404).json({
        success: false,
        message: `Order Code ${orderCode} tidak ditemukan di ExcelData`,
        updated: false,
        orderCode
      });
    }

    const currentDistance = parseFloat(excelRecord.Distance) || 0;
    const currentWeight = excelRecord.Weight || '';
    const newDistance = parseFloat(sayurboxRecord.distanceInKm) || 0;
    const newWeight = sayurboxRecord.totalWeightPerorder || '';

    const distanceMetrics = calculateDistanceMetrics(newDistance);
    const weightMetrics = calculateWeightMetrics(newWeight);

    const updateData = {
      Distance: distanceMetrics.distance,
      "RoundDown Distance": distanceMetrics.roundDownDistance,
      "RoundUp Distance": distanceMetrics.roundUpDistance,
      Weight: weightMetrics.weight,
      RoundDown: weightMetrics.roundDown,
      RoundUp: weightMetrics.roundUp,
      WeightDecimal: weightMetrics.weightDecimal
    };

    await ExcelData.updateOne(
      { "Order Code": orderCode },
      { $set: updateData }
    );

    const duration = Date.now() - startTime;

    console.log(`Individual compare completed for ${orderCode}: Distance ${currentDistance} -> ${newDistance}, Weight ${currentWeight} -> ${newWeight} (${duration}ms)`);

    res.status(200).json({
      success: true,
      message: `Order Code ${orderCode} berhasil diperbarui`,
      updated: true,
      orderCode,
      changes: {
        distance: { from: currentDistance, to: newDistance },
        weight: { from: currentWeight, to: newWeight }
      },
      duration: `${duration}ms`
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`Individual compare failed for ${orderCode} after ${duration}ms:`, error.message);

    res.status(500).json({
      success: false,
      message: `Compare gagal untuk Order Code ${orderCode}`,
      error: error.message,
      updated: false,
      orderCode,
      duration: `${duration}ms`
    });
  }
};

const createComparisonSummary = (totalChecked, totalUpdated, matchedRecords, unmatchedExcelCodes, unmatchedSayurboxCodes, duration) => ({
  totalChecked,
  totalUpdated,
  matchedRecords,
  notMatchedRecords: totalChecked - matchedRecords,
  unmatchedExcelCount: unmatchedExcelCodes.length,
  unmatchedSayurboxCount: unmatchedSayurboxCodes.length,
  processingTime: `${duration}ms`,
  success: true
});

const createComparisonResponse = (summary, unmatchedExcelCodes, unmatchedSayurboxCodes, duration) => ({
  message: `Data comparison completed successfully in ${duration}ms`,
  summary,
  unmatchedExcelCodes: unmatchedExcelCodes.slice(0, DISPLAY_LIMIT),
  unmatchedSayurboxCodes: unmatchedSayurboxCodes.slice(0, DISPLAY_LIMIT),
  displayInfo: {
    excelDisplayed: Math.min(unmatchedExcelCodes.length, DISPLAY_LIMIT),
    excelTotal: unmatchedExcelCodes.length,
    sayurboxDisplayed: Math.min(unmatchedSayurboxCodes.length, DISPLAY_LIMIT),
    sayurboxTotal: unmatchedSayurboxCodes.length,
    displayLimit: DISPLAY_LIMIT
  }
});

const handleComparisonError = (error, duration) => {
  let errorMessage = error.message;
  let statusCode = 500;

  if (error.message.includes('Sayurbox data empty') || error.message.includes('Excel data empty')) {
    statusCode = 400;
  } else if (error.name === 'MongoTimeoutError') {
    errorMessage = 'Database timeout - proses compare membutuhkan waktu lama. Silakan coba lagi.';
  } else if (error.name === 'MongoNetworkError') {
    errorMessage = 'Database connection error. Silakan coba lagi.';
  }

  return {
    statusCode,
    response: {
      message: "Compare data gagal",
      error: errorMessage,
      duration: `${duration}ms`,
      success: false
    }
  };
};

const compareDataSayurbox = async (req, res) => {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Starting data comparison process...`);

  try {
    const { sayurboxCount, excelCount } = await validateDataForComparison();
    console.log(`Found ${sayurboxCount} Sayurbox records and ${excelCount} Excel records`);

    const session = await ExcelData.db.startSession();
    session.startTransaction();

    try {
      const sayurboxData = await SayurboxData.find({}, { 
        orderNo: 1, 
        distanceInKm: 1,
        totalWeightPerorder: 1
      }).lean();

      console.log(`Retrieved ${sayurboxData.length} Sayurbox records for comparison`);

      const { sayurboxMap, sayurboxOrderNos } = createSayurboxMap(sayurboxData);

      let totalUpdated = 0;
      let totalChecked = 0;
      let matchedRecords = 0;
      let unmatchedExcelCodes = [];
      const processedExcelCodes = new Set();

      console.log(`Processing Excel data in segments of ${COMPARE_BATCH_SIZE}...`);

      for (let skip = 0; skip < excelCount; skip += COMPARE_BATCH_SIZE) {
        const excelBatch = await ExcelData.find({}, { "Order Code": 1, Distance: 1, Weight: 1 })
          .skip(skip)
          .limit(COMPARE_BATCH_SIZE)
          .lean();

        const batchResult = await processBatchComparison(excelBatch, sayurboxMap, session);

        totalChecked += batchResult.batchChecked;
        matchedRecords += batchResult.batchMatched;
        totalUpdated += batchResult.batchUpdated;
        unmatchedExcelCodes.push(...batchResult.batchUnmatchedExcel);

        batchResult.batchProcessedExcel.forEach(code => processedExcelCodes.add(code));

        console.log(`Segment processed: ${batchResult.batchMatched} matches found, ${batchResult.batchUpdated} updated`);

        if (skip + COMPARE_BATCH_SIZE < excelCount) {
          console.log(`Processed ${skip + COMPARE_BATCH_SIZE}/${excelCount} Excel records...`);
        }
      }

      const unmatchedSayurboxCodes = Array.from(sayurboxOrderNos).filter(orderNo => 
        !processedExcelCodes.has(orderNo)
      );

      await session.commitTransaction();

      const duration = Date.now() - startTime;

      console.log(`Comparison completed successfully in ${duration}ms:`);
      console.log(`- Total checked: ${totalChecked}`);
      console.log(`- Total updated: ${totalUpdated}`);
      console.log(`- Matched records: ${matchedRecords}`);
      console.log(`- Unmatched Excel codes: ${unmatchedExcelCodes.length}`);
      console.log(`- Unmatched Sayurbox codes: ${unmatchedSayurboxCodes.length}`);

      const summary = createComparisonSummary(
        totalChecked, 
        totalUpdated, 
        matchedRecords, 
        unmatchedExcelCodes, 
        unmatchedSayurboxCodes, 
        duration
      );

      const response = createComparisonResponse(summary, unmatchedExcelCodes, unmatchedSayurboxCodes, duration);
      res.status(200).json(response);

    } catch (transactionError) {
      await session.abortTransaction();
      throw transactionError;
    } finally {
      session.endSession();
    }

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`Compare data failed after ${duration}ms:`, error.message);
    console.error("Error stack:", error.stack);

    const { statusCode, response } = handleComparisonError(error, duration);
    res.status(statusCode).json(response);
  }
};

module.exports = {
  uploadSayurboxData,
  resetUploadState,
  getAllSayurboxData,
  getSayurboxDataByHub,
  getSayurboxDataByDriver,
  deleteSayurboxData,
  compareDataSayurbox,
  compareOrderCodeData,
  getDataInfo,
  uploadEData,
  resetEDataUploadState,
  getAllEData,
  getEDataByHub,
  getEDataByDriver,
  deleteEData,
  getEDataInfo
};  