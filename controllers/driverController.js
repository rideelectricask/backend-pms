const Driver = require("../models/Driver");

const findDuplicates = async (dataArray) => {
  const usernameSet = new Set();
  const fullNameSet = new Set();
  const courierIdSet = new Set();
  const duplicatesInPayload = [];

  dataArray.forEach((item, index) => {
    const duplicateFields = [];
    
    if (item.username && usernameSet.has(item.username.toLowerCase())) {
      duplicateFields.push('username');
    } else if (item.username) {
      usernameSet.add(item.username.toLowerCase());
    }

    if (item.fullName && fullNameSet.has(item.fullName.toLowerCase())) {
      duplicateFields.push('fullName');
    } else if (item.fullName) {
      fullNameSet.add(item.fullName.toLowerCase());
    }

    if (item.courierId && courierIdSet.has(item.courierId.toLowerCase())) {
      duplicateFields.push('courierId');
    } else if (item.courierId) {
      courierIdSet.add(item.courierId.toLowerCase());
    }

    if (duplicateFields.length > 0) {
      duplicatesInPayload.push({
        row: index + 2,
        data: item,
        duplicateFields
      });
    }
  });

  const usernames = dataArray.map(d => d.username).filter(Boolean);
  const fullNames = dataArray.map(d => d.fullName).filter(Boolean);
  const courierIds = dataArray.map(d => d.courierId).filter(Boolean);

  const existingDrivers = await Driver.find({
    $or: [
      { username: { $in: usernames } },
      { fullName: { $in: fullNames } },
      { courierId: { $in: courierIds } }
    ]
  });

  const existingUsernames = new Set(existingDrivers.map(d => d.username?.toLowerCase()));
  const existingFullNames = new Set(existingDrivers.map(d => d.fullName?.toLowerCase()));
  const existingCourierIds = new Set(existingDrivers.map(d => d.courierId?.toLowerCase()));

  const duplicatesInDB = [];

  dataArray.forEach((item, index) => {
    const duplicateFields = [];

    if (item.username && existingUsernames.has(item.username.toLowerCase())) {
      duplicateFields.push('username');
    }

    if (item.fullName && existingFullNames.has(item.fullName.toLowerCase())) {
      duplicateFields.push('fullName');
    }

    if (item.courierId && existingCourierIds.has(item.courierId.toLowerCase())) {
      duplicateFields.push('courierId');
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

const uploadDriverData = async (req, res) => {
  try {
    const dataArray = req.body;
    const replaceAll = req.headers['x-replace-data'] === 'true';

    if (!Array.isArray(dataArray) || dataArray.length === 0) {
      return res.status(400).json({ 
        message: "Data driver kosong atau tidak valid.",
        success: false
      });
    }

    console.log(`Processing ${dataArray.length} driver records for upload (replaceAll: ${replaceAll})`);

    const validationResult = await findDuplicates(dataArray);

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
          totalRecords: dataArray.length,
          duplicatesInFile: validationResult.duplicatesInPayload.length,
          duplicatesInDatabase: validationResult.duplicatesInDB.length
        }
      });
    }

    if (replaceAll) {
      await Driver.deleteMany({});
      console.log("🗑️ Data driver lama dihapus");
    }

    const inserted = await Driver.insertMany(dataArray);
    console.log(`✅ Data driver disimpan: ${inserted.length} records`);

    res.status(201).json({
      message: `Data driver berhasil disimpan: ${inserted.length} records`,
      data: inserted,
      summary: {
        totalRecords: inserted.length,
        success: true
      },
      success: true
    });
  } catch (error) {
    console.error("Driver upload error:", error.message);
    res.status(500).json({ 
      message: "Upload data driver gagal", 
      error: error.message,
      success: false
    });
  }
};

const getAllDrivers = async (req, res) => {
  try {
    console.log("Fetching all driver data");

    const data = await Driver.find().sort({ createdAt: -1 });

    console.log(`✅ Retrieved ${data.length} driver records`);

    res.status(200).json(data);
  } catch (err) {
    console.error("Gagal ambil data driver:", err.message);
    res.status(500).json({ 
      message: "Gagal ambil data driver", 
      error: err.message,
      success: false
    });
  }
};

const updateDriverData = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    console.log(`Updating driver ID: ${id}`);

    if (!id) {
      return res.status(400).json({
        message: "ID driver tidak valid",
        error: "Driver ID is required",
        success: false
      });
    }

    const existingDriver = await Driver.findById(id);
    if (!existingDriver) {
      console.warn(`Driver not found: ${id}`);
      return res.status(404).json({
        message: "Driver tidak ditemukan",
        error: "Driver with specified ID does not exist",
        success: false
      });
    }

    const duplicateChecks = [];
    
    if (updateData.username && updateData.username !== existingDriver.username) {
      const usernameDuplicate = await Driver.findOne({ 
        username: updateData.username,
        _id: { $ne: id }
      });
      if (usernameDuplicate) {
        duplicateChecks.push('username');
      }
    }

    if (updateData.fullName && updateData.fullName !== existingDriver.fullName) {
      const fullNameDuplicate = await Driver.findOne({ 
        fullName: updateData.fullName,
        _id: { $ne: id }
      });
      if (fullNameDuplicate) {
        duplicateChecks.push('fullName');
      }
    }

    if (updateData.courierId && updateData.courierId !== existingDriver.courierId) {
      const courierIdDuplicate = await Driver.findOne({ 
        courierId: updateData.courierId,
        _id: { $ne: id }
      });
      if (courierIdDuplicate) {
        duplicateChecks.push('courierId');
      }
    }

    if (duplicateChecks.length > 0) {
      return res.status(409).json({
        message: `Data duplikat ditemukan pada field: ${duplicateChecks.join(', ')}`,
        error: "Duplicate data detected",
        duplicateFields: duplicateChecks,
        success: false
      });
    }

    const updatedDriver = await Driver.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    console.log(`✅ Driver updated successfully: ${updatedDriver.fullName}`);

    res.status(200).json({
      message: "Data driver berhasil diperbarui",
      data: updatedDriver,
      success: true
    });
  } catch (error) {
    console.error("Update driver error:", error.message);

    if (error.name === 'CastError') {
      return res.status(400).json({
        message: "ID driver tidak valid",
        error: "Invalid driver ID format",
        success: false
      });
    }

    res.status(500).json({
      message: "Gagal memperbarui data driver",
      error: error.message,
      success: false
    });
  }
};

const deleteDriverData = async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`Deleting driver ID: ${id}`);

    if (!id) {
      return res.status(400).json({
        message: "ID driver tidak valid",
        error: "Driver ID is required",
        success: false
      });
    }

    const deletedDriver = await Driver.findByIdAndDelete(id);

    if (!deletedDriver) {
      console.warn(`Driver not found: ${id}`);
      return res.status(404).json({
        message: "Driver tidak ditemukan",
        error: "Driver with specified ID does not exist",
        success: false
      });
    }

    console.log(`✅ Driver deleted successfully: ${deletedDriver.fullName}`);

    res.status(200).json({
      message: "Data driver berhasil dihapus",
      data: deletedDriver,
      success: true
    });
  } catch (error) {
    console.error("Delete driver error:", error.message);

    if (error.name === 'CastError') {
      return res.status(400).json({
        message: "ID driver tidak valid",
        error: "Invalid driver ID format",
        success: false
      });
    }

    res.status(500).json({
      message: "Gagal menghapus data driver",
      error: error.message,
      success: false
    });
  }
};

const deleteMultipleDriverData = async (req, res) => {
  try {
    const { ids } = req.body;

    console.log(`Bulk delete request for ${ids.length} drivers`);

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        message: "ID driver tidak valid",
        error: "Array of driver IDs is required",
        success: false
      });
    }

    const result = await Driver.deleteMany({ _id: { $in: ids } });

    console.log(`✅ Bulk delete completed: ${result.deletedCount} drivers deleted`);

    res.status(200).json({
      message: `Berhasil menghapus ${result.deletedCount} data driver`,
      deletedCount: result.deletedCount,
      success: true
    });
  } catch (error) {
    console.error("Bulk delete driver error:", error.message);

    res.status(500).json({
      message: "Gagal menghapus data driver",
      error: error.message,
      success: false
    });
  }
};

module.exports = {
  uploadDriverData,
  getAllDrivers,
  updateDriverData,
  deleteDriverData,
  deleteMultipleDriverData
};