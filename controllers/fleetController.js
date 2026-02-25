const FleetData = require("../models/FleetData");
const XLSX = require('xlsx');

const BATCH_SIZE = 1000;

const findDuplicates = async (dataArray) => {
  const nameSet = new Set();
  const phoneNumberSet = new Set();
  const vehNumbSet = new Set();
  const duplicatesInPayload = [];

  dataArray.forEach((item, index) => {
    const duplicateFields = [];

    if (item.name && nameSet.has(item.name.toLowerCase())) {
      duplicateFields.push('name');
    } else if (item.name) {
      nameSet.add(item.name.toLowerCase());
    }

    if (item.phoneNumber && phoneNumberSet.has(item.phoneNumber.toLowerCase())) {
      duplicateFields.push('phoneNumber');
    } else if (item.phoneNumber) {
      phoneNumberSet.add(item.phoneNumber.toLowerCase());
    }

    if (item.vehNumb && vehNumbSet.has(item.vehNumb.toUpperCase())) {
      duplicateFields.push('vehNumb');
    } else if (item.vehNumb) {
      vehNumbSet.add(item.vehNumb.toUpperCase());
    }

    if (duplicateFields.length > 0) {
      duplicatesInPayload.push({
        row: index + 2,
        data: item,
        duplicateFields
      });
    }
  });

  const names = dataArray.map(d => d.name).filter(Boolean);
  const phoneNumbers = dataArray.map(d => d.phoneNumber).filter(Boolean);
  const vehNumbs = dataArray.map(d => d.vehNumb).filter(Boolean);

  const existingFleet = await FleetData.find({
    $or: [
      { name: { $in: names } },
      { phoneNumber: { $in: phoneNumbers } },
      { vehNumb: { $in: vehNumbs.map(v => v.toUpperCase()) } }
    ]
  });

  const existingNames = new Set(existingFleet.map(d => d.name?.toLowerCase()));
  const existingPhoneNumbers = new Set(existingFleet.map(d => d.phoneNumber?.toLowerCase()));
  const existingVehNumbs = new Set(existingFleet.map(d => d.vehNumb?.toUpperCase()));

  const duplicatesInDB = [];

  dataArray.forEach((item, index) => {
    const duplicateFields = [];

    if (item.name && existingNames.has(item.name.toLowerCase())) {
      duplicateFields.push('name');
    }

    if (item.phoneNumber && existingPhoneNumbers.has(item.phoneNumber.toLowerCase())) {
      duplicateFields.push('phoneNumber');
    }

    if (item.vehNumb && existingVehNumbs.has(item.vehNumb.toUpperCase())) {
      duplicateFields.push('vehNumb');
    }

    if (duplicateFields.length > 0) {
      duplicatesInDB.push({
        row: index + 2,
        data: item,
        duplicateFields
      });
    }
  });

  return {
    duplicatesInPayload,
    duplicatesInDB,
    hasDuplicates: duplicatesInPayload.length > 0 || duplicatesInDB.length > 0
  };
};

const validateRequiredFields = (item, index) => {
  const requiredFields = ['name', 'vehNumb'];
  const missingFields = requiredFields.filter(field => !item[field] || !item[field].toString().trim());

  if (missingFields.length > 0) {
    throw new Error(`Record ${index + 1}: Field wajib tidak boleh kosong - ${missingFields.join(', ')}`);
  }
};

const transformFleetItem = (item) => ({
  name: String(item.name || '').trim(),
  phoneNumber: String(item.phoneNumber || item['No Telepon'] || '').trim(),
  status: String(item.status || '').trim(),
  molis: String(item.molis || '').trim(),
  deductionAmount: String(item.deductionAmount || '').trim(),
  statusSecond: String(item.statusSecond || '').trim(),
  project: String(item.project || '').trim(),
  distribusi: String(item.distribusi || '').trim(),
  rushHour: String(item.rushHour || '').trim(),
  vehNumb: String(item.vehNumb || '').trim().toUpperCase(),
  type: String(item.type || '').trim(),
  notes: String(item.notes || '').trim()
});

const transformFleetData = (dataArray) => {
  return dataArray.map((item, index) => {
    validateRequiredFields(item, index);
    return transformFleetItem(item);
  });
};

const handleBatchUpsert = async (batch, batchNum, totalBatches) => {
  console.log(`Processing fleet batch ${batchNum}/${totalBatches} (${batch.length} records)`);

  try {
    const bulkOps = batch.map(item => ({
      updateOne: {
        filter: { vehNumb: item.vehNumb },
        update: { $set: { ...item, updatedAt: Date.now() } },
        upsert: true
      }
    }));

    const result = await FleetData.bulkWrite(bulkOps, { ordered: false });

    const insertedCount = result.upsertedCount || 0;
    const updatedCount = result.modifiedCount || 0;
    const totalProcessed = insertedCount + updatedCount;

    console.log(`Batch ${batchNum} completed: ${insertedCount} inserted, ${updatedCount} updated`);

    return {
      batchNum,
      inserted: insertedCount,
      updated: updatedCount,
      processed: totalProcessed,
      records: batch.length,
      success: true
    };
  } catch (error) {
    console.error(`Batch ${batchNum} failed:`, error.message);
    throw new Error(`Database operation failed at batch ${batchNum}: ${error.message}`);
  }
};

const processBatchUpserts = async (transformedData) => {
  let totalProcessed = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  const batchResults = [];

  const totalBatches = Math.ceil(transformedData.length / BATCH_SIZE);

  for (let i = 0; i < transformedData.length; i += BATCH_SIZE) {
    const batch = transformedData.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    const result = await handleBatchUpsert(batch, batchNum, totalBatches);

    totalProcessed += result.processed;
    totalInserted += result.inserted;
    totalUpdated += result.updated;
    batchResults.push(result);
  }

  return { totalProcessed, totalInserted, totalUpdated, batchResults };
};

const uploadFleetData = async (req, res) => {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Starting fleet data upload...`);

  try {
    const dataArray = req.body;
    const replaceAll = req.headers['x-replace-data'] === 'true';

    if (!Array.isArray(dataArray) || dataArray.length === 0) {
      console.error("Invalid fleet data format received");
      return res.status(400).json({ 
        message: "Data fleet tidak valid atau kosong",
        error: "Expected non-empty array"
      });
    }

    console.log(`Processing fleet batch with ${dataArray.length} records (replaceAll: ${replaceAll})`);

    let transformedData;
    try {
      transformedData = transformFleetData(dataArray);
      console.log(`Fleet data transformation completed: ${transformedData.length} valid records`);
    } catch (transformError) {
      console.error("Fleet data transformation failed:", transformError.message);
      return res.status(400).json({
        message: "Fleet data validation failed",
        error: transformError.message
      });
    }

    const validationResult = await findDuplicates(transformedData);

    if (validationResult.hasDuplicates && !replaceAll) {
      const totalDuplicates = validationResult.duplicatesInPayload.length + validationResult.duplicatesInDB.length;

      console.warn(`Duplicate data detected: ${totalDuplicates} records`);

      return res.status(409).json({
        message: `Ditemukan ${totalDuplicates} data duplikat yang perlu diperbaiki`,
        success: false,
        duplicates: {
          inPayload: validationResult.duplicatesInPayload,
          inDatabase: validationResult.duplicatesInDB,
          total: totalDuplicates
        },
        details: {
          totalRecords: transformedData.length,
          duplicatesInFile: validationResult.duplicatesInPayload.length,
          duplicatesInDatabase: validationResult.duplicatesInDB.length
        }
      });
    }

    const { totalProcessed, totalInserted, totalUpdated, batchResults } = await processBatchUpserts(transformedData);

    const duration = Date.now() - startTime;

    console.log(`Fleet batch upload completed successfully:`);
    console.log(`- Records processed: ${transformedData.length}`);
    console.log(`- Records inserted: ${totalInserted}`);
    console.log(`- Records updated: ${totalUpdated}`);
    console.log(`- Total processed: ${totalProcessed}`);
    console.log(`- Duration: ${duration}ms`);

    const currentCount = await FleetData.countDocuments();
    console.log(`Current total fleet records in database: ${currentCount}`);

    res.status(201).json({
      message: `Data fleet berhasil disimpan ke database`,
      count: totalProcessed,
      summary: {
        totalRecords: totalProcessed,
        insertedRecords: totalInserted,
        updatedRecords: totalUpdated,
        processedRecords: transformedData.length,
        databaseTotal: currentCount,
        success: true,
        duration: `${duration}ms`,
        batchResults
      },
      success: true
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`Upload fleet failed after ${duration}ms:`, error.message);
    console.error("Error stack:", error.stack);

    res.status(500).json({
      message: "Upload data fleet gagal",
      error: error.message,
      duration: `${duration}ms`,
      success: false
    });
  }
};

const buildSearchQuery = (searchTerm) => {
  if (!searchTerm || searchTerm.length < 2) return {};

  const searchRegex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  return {
    $or: [
      { name: searchRegex },
      { vehNumb: searchRegex },
      { status: searchRegex },
      { project: searchRegex },
      { type: searchRegex },
      { molis: searchRegex },
      { distribusi: searchRegex },
      { phoneNumber: searchRegex }
    ]
  };
};

const buildFilterQuery = (filters) => {
  const query = {};

  if (filters.status) {
    query.status = new RegExp(filters.status.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }

  if (filters.project) {
    query.project = new RegExp(filters.project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }

  if (filters.type) {
    query.type = new RegExp(filters.type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }

  if (filters.statusFilter && filters.statusFilter !== 'all') {
    if (filters.statusFilter === 'active') {
      query.status = { $regex: /^ACTIVE$/i };
    } else if (filters.statusFilter === 'inactive') {
      query.status = { $not: { $regex: /^ACTIVE$/i } };
    }
  }

  return query;
};

const buildSortQuery = (sortKey, sortDirection) => {
  const sortObj = {};

  if (sortKey === 'createdAt' || sortKey === 'name' || sortKey === 'vehNumb' || sortKey === 'status' || sortKey === 'project' || sortKey === 'type' || sortKey === 'phoneNumber') {
    sortObj[sortKey] = sortDirection === 'asc' ? 1 : -1;
  } else {
    sortObj.createdAt = -1;
  }

  return sortObj;
};

const getAllFleetData = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 25,
      search = '',
      sortKey = 'createdAt',
      sortDirection = 'desc',
      status = '',
      project = '',
      type = '',
      statusFilter = 'all'
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const searchQuery = buildSearchQuery(search);
    const filterQuery = buildFilterQuery({ status, project, type, statusFilter });
    const sortQuery = buildSortQuery(sortKey, sortDirection);

    const combinedQuery = { ...searchQuery, ...filterQuery };

    console.log(`Fetching fleet data - page: ${pageNum}, limit: ${limitNum}, filters: ${JSON.stringify(combinedQuery)}`);

    const [data, total] = await Promise.all([
      FleetData.find(combinedQuery).sort(sortQuery).skip(skip).limit(limitNum).lean().exec(),
      FleetData.countDocuments(combinedQuery)
    ]);

    console.log(`Fleet data fetched: ${data.length} records, Total matching: ${total}`);

    const response = {
      message: "Data fleet berhasil diambil",
      count: data.length,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      hasMore: pageNum * limitNum < total,
      data
    };

    res.status(200).json(response);
  } catch (error) {
    console.error("Get fleet data error:", error.message);
    res.status(500).json({ 
      message: "Gagal mengambil data fleet", 
      error: error.message 
    });
  }
};

const exportFleetData = async (req, res) => {
  try {
    const { search = '', sortKey = 'createdAt', sortDirection = 'desc', status = '', project = '', type = '' } = req.body;

    const searchQuery = buildSearchQuery(search);
    const filterQuery = buildFilterQuery({ status, project, type });
    const sortQuery = buildSortQuery(sortKey, sortDirection);
    const combinedQuery = { ...searchQuery, ...filterQuery };

    console.log(`Exporting fleet data with filters: ${JSON.stringify(combinedQuery)}`);

    const data = await FleetData.find(combinedQuery).sort(sortQuery).lean();

    console.log(`Exporting ${data.length} fleet records`);

    const exportData = data.map(item => ({
      'Name': item.name,
      'Phone Number': item.phoneNumber,
      'Status': item.status,
      'Molis': item.molis,
      'Deduction Amount': item.deductionAmount,
      'Project': item.project,
      'Distribusi': item.distribusi,
      'Rush Hour': item.rushHour,
      'Veh Numb': item.vehNumb,
      'Type': item.type,
      'Notes': item.notes,
      'Created At': new Date(item.createdAt).toLocaleString('id-ID'),
      'Updated At': new Date(item.updatedAt).toLocaleString('id-ID')
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Fleet Data');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Fleet_Data_${new Date().toISOString().split('T')[0]}.xlsx`);
    res.send(buffer);

    console.log(`Fleet data exported successfully: ${data.length} records`);
  } catch (error) {
    console.error("Export fleet data error:", error.message);
    res.status(500).json({ 
      message: "Gagal export data fleet", 
      error: error.message 
    });
  }
};

const updateFleetData = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    console.log(`Updating fleet data with ID: ${id}`);

    const transformedData = transformFleetItem(updateData);

    const updatedFleet = await FleetData.findByIdAndUpdate(
      id,
      { ...transformedData, updatedAt: Date.now() },
      { new: true, runValidators: true }
    ).lean();

    if (!updatedFleet) {
      return res.status(404).json({
        message: "Data fleet tidak ditemukan",
        error: "Fleet dengan ID tersebut tidak ada"
      });
    }

    console.log(`✅ Fleet data updated successfully: ${updatedFleet.name}`);

    res.status(200).json({
      message: "Data fleet berhasil diperbarui",
      data: updatedFleet
    });
  } catch (error) {
    console.error("Update fleet data error:", error.message);
    res.status(500).json({ 
      message: "Gagal memperbarui data fleet", 
      error: error.message 
    });
  }
};

const deleteFleetData = async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`Deleting fleet data with ID: ${id}`);

    const deletedFleet = await FleetData.findByIdAndDelete(id).lean();

    if (!deletedFleet) {
      return res.status(404).json({
        message: "Data fleet tidak ditemukan",
        error: "Fleet dengan ID tersebut tidak ada"
      });
    }

    console.log(`✅ Fleet data deleted successfully: ${deletedFleet.name}`);

    res.status(200).json({
      message: "Data fleet berhasil dihapus",
      data: deletedFleet
    });
  } catch (error) {
    console.error("Delete fleet data error:", error.message);
    res.status(500).json({ 
      message: "Gagal menghapus data fleet", 
      error: error.message 
    });
  }
};

const deleteMultipleFleetData = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        message: "Invalid request: No IDs provided",
        error: "Array of IDs is required"
      });
    }

    console.log(`Deleting ${ids.length} fleet records`);

    const result = await FleetData.deleteMany({ _id: { $in: ids } });

    console.log(`Bulk delete completed: ${result.deletedCount} records deleted`);

    res.status(200).json({
      message: `${result.deletedCount} data fleet berhasil dihapus`,
      deletedCount: result.deletedCount,
      requestedCount: ids.length
    });
  } catch (error) {
    console.error("Bulk delete fleet data error:", error.message);
    res.status(500).json({ 
      message: "Gagal menghapus data fleet", 
      error: error.message 
    });
  }
};

const deleteAllFleetData = async (req, res) => {
  try {
    const result = await FleetData.deleteMany({});

    console.log(`Deleted ${result.deletedCount} fleet records`);

    res.status(200).json({
      message: "Semua data fleet berhasil dihapus",
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error("Delete all fleet data error:", error.message);
    res.status(500).json({ 
      message: "Gagal menghapus data fleet", 
      error: error.message 
    });
  }
};

const getFleetFilters = async (req, res) => {
  try {
    const [statuses, projects, types] = await Promise.all([
      FleetData.distinct('status', { status: { $ne: '', $exists: true } }),
      FleetData.distinct('project', { project: { $ne: '', $exists: true } }),
      FleetData.distinct('type', { type: { $ne: '', $exists: true } })
    ]);

    const [activeCount, totalCount] = await Promise.all([
      FleetData.countDocuments({ status: { $regex: /^ACTIVE$/i } }),
      FleetData.countDocuments()
    ]);

    res.status(200).json({
      statuses: statuses.sort(),
      projects: projects.sort(),
      types: types.sort(),
      statistics: {
        total: totalCount,
        active: activeCount,
        inactive: totalCount - activeCount
      }
    });
  } catch (error) {
    console.error("Get fleet filters error:", error.message);
    res.status(500).json({ 
      message: "Gagal mengambil filter fleet", 
      error: error.message 
    });
  }
};

const getFleetDataByPlat = async (req, res) => {
  try {
    const vehNumb = req.params.plat;
    console.log(`Mencari data fleet untuk nomor kendaraan: ${vehNumb}`);

    const data = await FleetData.find({ 
      vehNumb: { $regex: new RegExp(vehNumb, "i") } 
    }).lean();

    if (!data || data.length === 0) {
      return res.status(404).json({
        message: `Data fleet untuk nomor kendaraan ${vehNumb} tidak ditemukan`,
        count: 0,
        data: []
      });
    }

    console.log(`Data fleet ditemukan untuk nomor kendaraan ${vehNumb}: ${data.length} records`);

    res.status(200).json({
      message: `Data fleet untuk nomor kendaraan ${vehNumb} berhasil diambil`,
      count: data.length,
      data: data
    });
  } catch (error) {
    console.error(`Get fleet by vehicle number error:`, error.message);
    res.status(500).json({ 
      message: `Gagal mengambil data fleet berdasarkan nomor kendaraan`, 
      error: error.message 
    });
  }
};

const getFleetInfo = async (req, res) => {
  try {
    const fleetCount = await FleetData.countDocuments();

    res.status(200).json({
      fleetCount,
      message: "Fleet info retrieved successfully"
    });
  } catch (error) {
    console.error("Get fleet info error:", error.message);
    res.status(500).json({ 
      message: "Gagal mengambil info fleet", 
      error: error.message 
    });
  }
};

module.exports = {
  uploadFleetData,
  getAllFleetData,
  exportFleetData,
  getFleetFilters,
  getFleetDataByPlat,
  deleteFleetData,
  deleteAllFleetData,
  deleteMultipleFleetData,
  updateFleetData,
  getFleetInfo
};