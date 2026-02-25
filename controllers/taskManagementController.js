const TaskManagementData = require("../models/TaskManagementData");
const LoginData = require("../models/LoginData");
const XLSX = require('xlsx');

const BATCH_SIZE = 1000;
const VALID_REPLY_RECORDS = ['Invited', 'Changed Mind', 'No Responses', '-'];
const VALID_FINAL_STATUSES = ['Eligible', 'Not Eligible (Changed Project)', 'Not Eligible (Cancel)', '-'];
const PROTECTED_ROLES = ['admin', 'developer', 'support'];

const normalizeRole = (role) => {
  return role ? role.toLowerCase().trim() : '';
};

const isProtectedRole = (role) => {
  const normalizedRole = normalizeRole(role);
  return PROTECTED_ROLES.some(r => r.toLowerCase() === normalizedRole);
};

const getEditedByInfo = (req) => {
  if (req.user && req.user.username) {
    return req.user.username;
  }
  return 'System';
};

const checkDeletePermission = async (req, taskId) => {
  try {
    const currentUserRole = req.user?.role;
    
    if (!isProtectedRole(currentUserRole)) {
      return { allowed: false, message: 'Anda tidak memiliki izin untuk menghapus data. Hanya admin, developer, dan support yang dapat menghapus data.' };
    }

    const task = await TaskManagementData.findById(taskId);
    if (!task) {
      return { allowed: false, message: 'Data tidak ditemukan' };
    }

    return { allowed: true };
  } catch (error) {
    return { allowed: false, message: error.message };
  }
};

const findDuplicates = async (dataArray) => {
  const phoneNumberSet = new Set();
  const duplicatesInPayload = [];

  dataArray.forEach((item, index) => {
    const duplicateFields = [];

    if (item.phoneNumber && phoneNumberSet.has(item.phoneNumber.toLowerCase())) {
      duplicateFields.push('phoneNumber');
    } else if (item.phoneNumber) {
      phoneNumberSet.add(item.phoneNumber.toLowerCase());
    }

    if (duplicateFields.length > 0) {
      duplicatesInPayload.push({
        row: index + 2,
        data: item,
        duplicateFields
      });
    }
  });

  const phoneNumbers = dataArray.map(d => d.phoneNumber).filter(Boolean);

  const existingTasks = await TaskManagementData.find({
    phoneNumber: { $in: phoneNumbers }
  });

  const existingPhoneNumbers = new Set(existingTasks.map(d => d.phoneNumber?.toLowerCase()).filter(Boolean));

  const duplicatesInDB = [];

  dataArray.forEach((item, index) => {
    const duplicateFields = [];

    if (item.phoneNumber && existingPhoneNumbers.has(item.phoneNumber.toLowerCase())) {
      duplicateFields.push('phoneNumber');
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
  if (!item.fullName || !item.fullName.toString().trim()) {
    throw new Error(`Record ${index + 1}: Field wajib tidak boleh kosong - fullName`);
  }
};

const transformTaskItem = (item) => {
  const transformed = {
    fullName: String(item.fullName || '').trim(),
    phoneNumber: String(item.phoneNumber || '').trim(),
    domicile: String(item.domicile || '').trim(),
    city: String(item.city || '').trim(),
    project: String(item.project || '').trim(),
    user: String(item.user || '').trim().toLowerCase(),
    note: String(item.note || '').trim(),
    nik: String(item.nik || '').trim(),
    replyRecord: String(item.replyRecord || '').trim(),
    finalStatus: String(item.finalStatus || '').trim()
  };

  if (item.date instanceof Date && !isNaN(item.date.getTime())) {
    transformed.date = item.date;
  } else if (typeof item.date === 'string' && item.date.trim() !== '') {
    const parsedDate = new Date(item.date);
    if (!isNaN(parsedDate.getTime())) {
      transformed.date = parsedDate;
    } else {
      transformed.date = new Date();
    }
  } else {
    transformed.date = new Date();
  }

  return transformed;
};

const transformTaskData = (dataArray) => {
  return dataArray.map((item, index) => {
    validateRequiredFields(item, index);
    return transformTaskItem(item);
  });
};

const handleBatchUpsert = async (batch, batchNum, totalBatches) => {
  console.log(`Processing task batch ${batchNum}/${totalBatches} (${batch.length} records)`);

  try {
    const bulkOps = batch.map(item => ({
      updateOne: {
        filter: { phoneNumber: item.phoneNumber },
        update: { $set: { ...item, updatedAt: Date.now() } },
        upsert: true
      }
    }));

    const result = await TaskManagementData.bulkWrite(bulkOps, { ordered: false });

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

const uploadTaskData = async (req, res) => {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Starting task data upload...`);

  try {
    const dataArray = req.body;
    const replaceAll = req.headers['x-replace-data'] === 'true';

    if (!Array.isArray(dataArray) || dataArray.length === 0) {
      console.error("Invalid task data format received");
      return res.status(400).json({ 
        message: "Data task tidak valid atau kosong",
        error: "Expected non-empty array"
      });
    }

    console.log(`Processing task batch with ${dataArray.length} records (replaceAll: ${replaceAll})`);

    let transformedData;
    try {
      transformedData = transformTaskData(dataArray);
      console.log(`Task data transformation completed: ${transformedData.length} valid records`);
    } catch (transformError) {
      console.error("Task data transformation failed:", transformError.message);
      return res.status(400).json({
        message: "Task data validation failed",
        error: transformError.message
      });
    }

    const validationResult = await findDuplicates(transformedData);

    if (validationResult.hasDuplicates && !replaceAll) {
      const totalDuplicates = validationResult.duplicatesInPayload.length + validationResult.duplicatesInDB.length;

      console.warn(`Duplicate phone numbers detected: ${totalDuplicates} records`);

      return res.status(409).json({
        message: `Ditemukan ${totalDuplicates} nomor telepon duplikat yang perlu diperbaiki`,
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

    console.log(`Task batch upload completed successfully:`);
    console.log(`- Records processed: ${transformedData.length}`);
    console.log(`- Records inserted: ${totalInserted}`);
    console.log(`- Records updated: ${totalUpdated}`);
    console.log(`- Total processed: ${totalProcessed}`);
    console.log(`- Duration: ${duration}ms`);

    const currentCount = await TaskManagementData.countDocuments();
    console.log(`Current total task records in database: ${currentCount}`);

    res.status(201).json({
      message: `Data task berhasil disimpan ke database`,
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
    console.error(`Upload task failed after ${duration}ms:`, error.message);
    console.error("Error stack:", error.stack);

    res.status(500).json({
      message: "Upload data task gagal",
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
      { fullName: searchRegex },
      { phoneNumber: searchRegex },
      { domicile: searchRegex },
      { city: searchRegex },
      { project: searchRegex },
      { user: searchRegex },
      { note: searchRegex },
      { nik: searchRegex }
    ]
  };
};

const buildFilterQuery = (filters) => {
  const query = {};

  if (filters.city) {
    query.city = new RegExp(filters.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }

  if (filters.project) {
    query.project = new RegExp(filters.project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }

  if (filters.user) {
    query.user = filters.user.toLowerCase();
  }

  if (filters.replyRecord) {
    query.replyRecord = filters.replyRecord;
  }

  if (filters.finalStatus) {
    query.finalStatus = filters.finalStatus;
  }

  return query;
};

const buildSortQuery = (sortKey, sortDirection) => {
  const sortObj = {};

  if (['createdAt', 'fullName', 'city', 'project', 'user', 'replyRecord', 'finalStatus', 'date'].includes(sortKey)) {
    sortObj[sortKey] = sortDirection === 'asc' ? 1 : -1;
  } else {
    sortObj.createdAt = -1;
  }

  return sortObj;
};

const getAllTaskData = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 25,
      search = '',
      sortKey = 'createdAt',
      sortDirection = 'desc',
      city = '',
      project = '',
      user = '',
      replyRecord = '',
      finalStatus = ''
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const searchQuery = buildSearchQuery(search);
    const filterQuery = buildFilterQuery({ city, project, user, replyRecord, finalStatus });
    const sortQuery = buildSortQuery(sortKey, sortDirection);

    const combinedQuery = { ...searchQuery, ...filterQuery };

    console.log(`Fetching task data - page: ${pageNum}, limit: ${limitNum}, filters: ${JSON.stringify(combinedQuery)}`);

    const [data, total] = await Promise.all([
      TaskManagementData.find(combinedQuery).sort(sortQuery).skip(skip).limit(limitNum).lean().exec(),
      TaskManagementData.countDocuments(combinedQuery)
    ]);

    console.log(`Task data fetched: ${data.length} records, Total matching: ${total}`);

    const response = {
      message: "Data task berhasil diambil",
      count: data.length,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      hasMore: pageNum * limitNum < total,
      data
    };

    res.status(200).json(response);
  } catch (error) {
    console.error("Get task data error:", error.message);
    res.status(500).json({ 
      message: "Gagal mengambil data task", 
      error: error.message 
    });
  }
};

const getUserRoles = async (req, res) => {
  try {
    console.log('Fetching user roles from logins collection');

    const users = await LoginData.find({ status: 'active' }, { username: 1, role: 1, _id: 0 }).lean();

    const roleMap = users.reduce((acc, user) => {
      acc[user.username] = user.role;
      return acc;
    }, {});

    console.log(`User roles fetched: ${Object.keys(roleMap).length} users`);

    res.status(200).json({
      message: "User roles berhasil diambil",
      roles: roleMap,
      protectedRoles: PROTECTED_ROLES
    });
  } catch (error) {
    console.error("Get user roles error:", error.message);
    res.status(500).json({ 
      message: "Gagal mengambil user roles", 
      error: error.message 
    });
  }
};

const formatHistoryForExport = (historyArray, historyType) => {
  if (!historyArray || historyArray.length === 0) return '';
  
  return historyArray.map(h => {
    const date = h.editedAt ? new Date(h.editedAt).toLocaleString('id-ID') : '-';
    const editor = h.editedBy || 'System';
    const oldVal = h.oldValue || '-';
    const newVal = h.newValue || '-';
    
    if (historyType === 'edit') {
      return `[${date}] ${h.fieldName}: "${oldVal}" → "${newVal}" (by ${editor})`;
    } else if (historyType === 'replyRecord') {
      return `[${date}] "${oldVal}" → "${newVal}" (by ${editor})`;
    } else if (historyType === 'finalStatus') {
      return `[${date}] "${oldVal}" → "${newVal}" (by ${editor})`;
    }
    return '';
  }).join(' | ');
};

const exportTaskData = async (req, res) => {
  try {
    const { search = '', sortKey = 'createdAt', sortDirection = 'desc', city = '', project = '', user = '', replyRecord = '', finalStatus = '' } = req.body;

    const searchQuery = buildSearchQuery(search);
    const filterQuery = buildFilterQuery({ city, project, user, replyRecord, finalStatus });
    const sortQuery = buildSortQuery(sortKey, sortDirection);
    const combinedQuery = { ...searchQuery, ...filterQuery };

    console.log(`Exporting task data with filters: ${JSON.stringify(combinedQuery)}`);

    const data = await TaskManagementData.find(combinedQuery).sort(sortQuery).lean();

    console.log(`Exporting ${data.length} task records`);

    const exportData = data.map(item => ({
      'User': item.user,
      'Full Name': item.fullName,
      'Date': item.date ? new Date(item.date).toLocaleDateString('id-ID') : '',
      'Phone Number': item.phoneNumber,
      'Domicile': item.domicile,
      'City': item.city,
      'Project': item.project,
      'Reply Record': item.replyRecord,
      'Final Status': item.finalStatus,
      'Note': item.note,
      'NIK': item.nik,
      'Edit History': formatHistoryForExport(item.editHistory, 'edit'),
      'Reply Record History': formatHistoryForExport(item.replyRecordHistory, 'replyRecord'),
      'Final Status History': formatHistoryForExport(item.finalStatusHistory, 'finalStatus'),
      'Created At': new Date(item.createdAt).toLocaleString('id-ID'),
      'Updated At': new Date(item.updatedAt).toLocaleString('id-ID')
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    
    const wscols = [
      { wch: 15 },
      { wch: 30 },
      { wch: 12 },
      { wch: 20 },
      { wch: 20 },
      { wch: 20 },
      { wch: 20 },
      { wch: 20 },
      { wch: 30 },
      { wch: 30 },
      { wch: 20 },
      { wch: 50 },
      { wch: 50 },
      { wch: 50 },
      { wch: 20 },
      { wch: 20 }
    ];
    ws['!cols'] = wscols;
    
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Task Data');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Task_Data_${new Date().toISOString().split('T')[0]}.xlsx`);
    res.send(buffer);

    console.log(`Task data exported successfully: ${data.length} records`);
  } catch (error) {
    console.error("Export task data error:", error.message);
    res.status(500).json({ 
      message: "Gagal export data task", 
      error: error.message 
    });
  }
};

const updateTaskData = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    console.log(`Updating task data with ID: ${id}`);

    const existingTask = await TaskManagementData.findById(id);

    if (!existingTask) {
      return res.status(404).json({
        message: "Data task tidak ditemukan",
        error: "Task dengan ID tersebut tidak ada"
      });
    }

    const transformedData = transformTaskItem(updateData);
    const editHistoryEntries = [];
    const now = new Date();
    const editedBy = getEditedByInfo(req);

    console.log(`Update performed by: ${editedBy}`);

    if (transformedData.replyRecord !== existingTask.replyRecord) {
      const replyHistoryEntry = {
        fieldName: 'replyRecord',
        oldValue: existingTask.replyRecord || '',
        newValue: transformedData.replyRecord,
        editedAt: now,
        editedBy: editedBy
      };

      existingTask.replyRecordHistory = existingTask.replyRecordHistory || [];
      existingTask.replyRecordHistory.push(replyHistoryEntry);
      editHistoryEntries.push(replyHistoryEntry);
    }

    if (transformedData.finalStatus !== existingTask.finalStatus) {
      const statusHistoryEntry = {
        fieldName: 'finalStatus',
        oldValue: existingTask.finalStatus || '',
        newValue: transformedData.finalStatus,
        editedAt: now,
        editedBy: editedBy
      };

      existingTask.finalStatusHistory = existingTask.finalStatusHistory || [];
      existingTask.finalStatusHistory.push(statusHistoryEntry);
      editHistoryEntries.push(statusHistoryEntry);
    }

    Object.keys(transformedData).forEach(key => {
      if (key !== 'replyRecord' && key !== 'finalStatus' && transformedData[key] !== existingTask[key]) {
        const historyEntry = {
          fieldName: key,
          oldValue: existingTask[key] || '',
          newValue: transformedData[key],
          editedAt: now,
          editedBy: editedBy
        };

        existingTask.editHistory = existingTask.editHistory || [];
        existingTask.editHistory.push(historyEntry);
      }
    });

    Object.assign(existingTask, transformedData);
    existingTask.updatedAt = now;

    await existingTask.save();

    console.log(`✅ Task data updated successfully: ${existingTask.fullName} by ${editedBy}`);

    res.status(200).json({
      message: "Data task berhasil diperbarui",
      data: existingTask,
      editHistory: editHistoryEntries,
      success: true
    });
  } catch (error) {
    console.error("Update task data error:", error.message);
    res.status(500).json({ 
      message: "Gagal memperbarui data task", 
      error: error.message 
    });
  }
};

const deleteTaskData = async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`Attempting to delete task data with ID: ${id} by user: ${req.user?.username} (${req.user?.role})`);

    const permission = await checkDeletePermission(req, id);
    if (!permission.allowed) {
      console.log(`Delete permission denied for user: ${req.user?.username} (${req.user?.role})`);
      return res.status(403).json({
        message: permission.message,
        error: "Insufficient permissions",
        success: false
      });
    }

    const deletedTask = await TaskManagementData.findByIdAndDelete(id).lean();

    if (!deletedTask) {
      return res.status(404).json({
        message: "Data task tidak ditemukan",
        error: "Task dengan ID tersebut tidak ada"
      });
    }

    console.log(`✅ Task data deleted successfully: ${deletedTask.fullName} by ${req.user?.username}`);

    res.status(200).json({
      message: "Data task berhasil dihapus",
      data: deletedTask
    });
  } catch (error) {
    console.error("Delete task data error:", error.message);
    res.status(500).json({ 
      message: "Gagal menghapus data task", 
      error: error.message 
    });
  }
};

const deleteMultipleTaskData = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        message: "Invalid request: No IDs provided",
        error: "Array of IDs is required"
      });
    }

    const currentUserRole = req.user?.role;
    console.log(`Attempting bulk delete by user: ${req.user?.username} (${currentUserRole})`);
    
    if (!isProtectedRole(currentUserRole)) {
      console.log(`Bulk delete permission denied for user: ${req.user?.username} (${currentUserRole})`);
      return res.status(403).json({
        message: 'Anda tidak memiliki izin untuk menghapus data. Hanya admin, developer, dan support yang dapat menghapus data.',
        error: 'Insufficient permissions',
        success: false
      });
    }

    console.log(`Deleting ${ids.length} task records`);

    const result = await TaskManagementData.deleteMany({ _id: { $in: ids } });

    console.log(`Bulk delete completed: ${result.deletedCount} records deleted by ${req.user?.username}`);

    res.status(200).json({
      message: `${result.deletedCount} data task berhasil dihapus`,
      deletedCount: result.deletedCount,
      requestedCount: ids.length
    });
  } catch (error) {
    console.error("Bulk delete task data error:", error.message);
    res.status(500).json({ 
      message: "Gagal menghapus data task", 
      error: error.message 
    });
  }
};

const deleteAllTaskData = async (req, res) => {
  try {
    const currentUserRole = req.user?.role;
    console.log(`Attempting delete all by user: ${req.user?.username} (${currentUserRole})`);
    
    if (!isProtectedRole(currentUserRole)) {
      console.log(`Delete all permission denied for user: ${req.user?.username} (${currentUserRole})`);
      return res.status(403).json({
        message: 'Anda tidak memiliki izin untuk menghapus data. Hanya admin, developer, dan support yang dapat menghapus data.',
        error: 'Insufficient permissions',
        success: false
      });
    }

    const result = await TaskManagementData.deleteMany({});

    console.log(`Deleted ${result.deletedCount} task records by ${req.user?.username}`);

    res.status(200).json({
      message: "Semua data task berhasil dihapus",
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error("Delete all task data error:", error.message);
    res.status(500).json({ 
      message: "Gagal menghapus data task", 
      error: error.message 
    });
  }
};

const getTaskFilters = async (req, res) => {
  try {
    const [cities, projects, users, replyRecords, finalStatuses] = await Promise.all([
      TaskManagementData.distinct('city', { city: { $ne: '', $exists: true } }),
      TaskManagementData.distinct('project', { project: { $ne: '', $exists: true } }),
      TaskManagementData.distinct('user', { user: { $ne: '', $exists: true } }),
      TaskManagementData.distinct('replyRecord', { replyRecord: { $ne: '', $exists: true } }),
      TaskManagementData.distinct('finalStatus', { finalStatus: { $ne: '', $exists: true } })
    ]);

    const totalCount = await TaskManagementData.countDocuments();

    res.status(200).json({
      cities: cities.sort(),
      projects: projects.sort(),
      users: users.sort(),
      replyRecords: VALID_REPLY_RECORDS,
      finalStatuses: VALID_FINAL_STATUSES,
      statistics: {
        total: totalCount
      }
    });
  } catch (error) {
    console.error("Get task filters error:", error.message);
    res.status(500).json({ 
      message: "Gagal mengambil filter task", 
      error: error.message 
    });
  }
};

const getTaskInfo = async (req, res) => {
  try {
    const taskCount = await TaskManagementData.countDocuments();

    res.status(200).json({
      taskCount,
      message: "Task info retrieved successfully"
    });
  } catch (error) {
    console.error("Get task info error:", error.message);
    res.status(500).json({ 
      message: "Gagal mengambil info task", 
      error: error.message 
    });
  }
};

const getTaskById = async (req, res) => {
  try {
    const { id } = req.params;

    const task = await TaskManagementData.findById(id).lean();

    if (!task) {
      return res.status(404).json({
        message: "Data task tidak ditemukan",
        error: "Task dengan ID tersebut tidak ada"
      });
    }

    res.status(200).json({
      message: "Data task berhasil diambil",
      data: task
    });
  } catch (error) {
    console.error("Get task by ID error:", error.message);
    res.status(500).json({ 
      message: "Gagal mengambil data task", 
      error: error.message 
    });
  }
};

module.exports = {
  uploadTaskData,
  getAllTaskData,
  exportTaskData,
  getTaskFilters,
  deleteTaskData,
  deleteAllTaskData,
  deleteMultipleTaskData,
  updateTaskData,
  getTaskInfo,
  getTaskById,
  getUserRoles
};