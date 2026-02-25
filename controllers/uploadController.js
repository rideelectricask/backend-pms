const ExcelData = require("../models/ExcelData");
const EData = require("../models/EData");
const cacheWarmer = require("../services/cacheWarmer");

const calculateWeightMetrics = (weight) => {
  const numericWeight = Number(weight) || 0;
  const integerPart = Math.floor(numericWeight);
  const decimalPart = numericWeight - integerPart;
  const roundDown = numericWeight < 1 ? 0 : integerPart;
  const roundUp = decimalPart > 0.30 ? integerPart + 1 : integerPart;
  const weightDecimal = Number((numericWeight - roundDown).toFixed(2));
  return { roundDown, roundUp, weightDecimal };
};

const calculateDistanceMetrics = (distance) => {
  const distanceVal = Number(distance) || 0;
  const integerPart = Math.floor(distanceVal);
  const decimalPart = distanceVal - integerPart;
  const roundDownDistance = distanceVal < 1 ? 0 : integerPart;
  const roundUpDistance = decimalPart > 0.30 ? integerPart + 1 : integerPart;
  return { roundDownDistance, roundUpDistance };
};

const validateAndSanitizeData = (data) => {
  const validatedData = { ...data };

  if (validatedData["Delivery Status"]) {
    const status = validatedData["Delivery Status"].toString().trim().toUpperCase();
    const validStatuses = ["ONTIME", "LATE", "DELAY", "EARLY"];
    if (!validStatuses.includes(status)) {
      if (status === "PENDING" || status === "ON TIME") {
        validatedData["Delivery Status"] = "ONTIME";
      } else if (status === "DELAYED") {
        validatedData["Delivery Status"] = "DELAY";
      } else {
        validatedData["Delivery Status"] = "ONTIME";
      }
    } else {
      validatedData["Delivery Status"] = status;
    }
  }

  const numericFields = [
    'Cost', 'Add Cost 1', 'Add Cost 2', 'Add Charge 1', 'Add Charge 2',
    'Selling Price', 'RoundDown', 'RoundUp', 'WeightDecimal', 
    'Distance', 'RoundDown Distance', 'RoundUp Distance'
  ];

  numericFields.forEach(field => {
    if (validatedData[field] !== undefined && validatedData[field] !== null) {
      const numValue = parseFloat(validatedData[field]);
      validatedData[field] = isNaN(numValue) ? 0 : numValue;
    }
  });

  const integerFields = ['Total Pengiriman', 'Additional Notes For Address'];
  integerFields.forEach(field => {
    if (validatedData[field] !== undefined && validatedData[field] !== null) {
      const intValue = parseInt(validatedData[field]);
      validatedData[field] = isNaN(intValue) ? 0 : intValue;
    }
  });

  const stringFields = [
    'Client Name', 'Project Name', 'Order Code', 'HUB', 'Courier Name', 
    'Courier Code', 'Drop Point', 'Cnee Name', 'Cnee Address 1', 
    'Cnee Address 2', 'Cnee Area', 'Weight', 'Zona', 'Payment Term'
  ];

  stringFields.forEach(field => {
    if (validatedData[field] !== undefined && validatedData[field] !== null) {
      validatedData[field] = validatedData[field].toString().trim();
    }
  });

  return validatedData;
};

const uploadData = async (req, res) => {
  try {
    const dataArray = req.body.records || req.body;

    if (!Array.isArray(dataArray) || dataArray.length === 0) {
      return res.status(400).json({ message: "Data tidak valid atau kosong." });
    }

    console.log(`Starting upload process for ${dataArray.length} records`);

    const validData = dataArray.filter(item => 
      item && typeof item === 'object' && Object.keys(item).length > 0
    );

    if (validData.length === 0) {
      return res.status(400).json({ message: "Tidak ada data valid untuk disimpan" });
    }

    const orderCodes = new Set();
    const duplicateErrors = [];

    validData.forEach((item, index) => {
      const orderCode = item["Order Code"];
      if (orderCode) {
        const trimmedOrderCode = orderCode.toString().trim();
        if (orderCodes.has(trimmedOrderCode)) {
          duplicateErrors.push(`Data ke-${index + 1}: Order Code '${trimmedOrderCode}' duplikat dalam file`);
        } else {
          orderCodes.add(trimmedOrderCode);
        }
      }
    });

    if (duplicateErrors.length > 0) {
      return res.status(400).json({ 
        message: `Duplikasi Order Code ditemukan dalam file: ${duplicateErrors.length} duplikat`,
        errors: duplicateErrors
      });
    }

    const session = await ExcelData.db.startSession();
    session.startTransaction();

    try {
      await ExcelData.deleteMany({}, { session });
      console.log("Existing data cleared");

      const batchSize = 1000;
      let totalInserted = 0;
      const insertErrors = [];

      for (let i = 0; i < validData.length; i += batchSize) {
        const batch = validData.slice(i, i + batchSize).map(validateAndSanitizeData);
        console.log(`Inserting batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(validData.length / batchSize)} - ${batch.length} records`);

        try {
          const result = await ExcelData.insertMany(batch, { 
            session, 
            ordered: false
          });

          const insertedCount = Array.isArray(result) ? result.length : result.length;
          totalInserted += insertedCount;

          console.log(`Batch inserted: ${insertedCount} records, Total so far: ${totalInserted}`);
        } catch (batchError) {
          if (batchError.code === 11000) {
            const duplicateKeys = batchError.writeErrors?.map(err => {
              const keyValue = err.keyValue || {};
              return `Order Code: ${keyValue["Order Code"] || "unknown"}`;
            }) || ["Unknown duplicate"];

            insertErrors.push(`Batch ${Math.floor(i / batchSize) + 1}: Duplikasi ditemukan - ${duplicateKeys.join(", ")}`);
          } else {
            insertErrors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${batchError.message}`);
          }
          throw batchError;
        }
      }

      await session.commitTransaction();
      console.log(`Upload completed successfully: ${totalInserted} total records inserted`);

      const finalCount = await ExcelData.countDocuments();
      console.log(`Database count after upload: ${finalCount}`);

      setImmediate(() => {
        cacheWarmer.forceRefresh('excelData');
      });

      res.status(201).json({
        message: `Data berhasil disimpan: ${totalInserted} records. Data lama dihapus.`,
        summary: {
          totalRecords: totalInserted,
          finalDatabaseCount: finalCount,
          success: true
        }
      });

    } catch (transactionError) {
      await session.abortTransaction();

      if (transactionError.code === 11000) {
        const duplicateKey = transactionError.keyValue ? 
          `Order Code: ${transactionError.keyValue["Order Code"]}` : 
          "Unknown duplicate key";

        return res.status(400).json({ 
          message: `Duplikasi Order Code ditemukan di database: ${duplicateKey}`,
          error: "Duplicate key error"
        });
      }
      throw transactionError;
    } finally {
      session.endSession();
    }

  } catch (error) {
    console.error("Upload error:", error.message);
    res.status(500).json({ 
      message: "Upload gagal", 
      error: error.message
    });
  }
};

const appendData = async (req, res) => {
  try {
    const dataArray = req.body.records || req.body;

    if (!Array.isArray(dataArray) || dataArray.length === 0) {
      return res.status(400).json({ message: "Data tidak valid atau kosong." });
    }

    console.log(`Starting append process for ${dataArray.length} records`);

    const countBefore = await ExcelData.countDocuments();
    console.log(`Records before append: ${countBefore}`);

    const validData = dataArray.filter(item => 
      item && typeof item === 'object' && Object.keys(item).length > 0
    );

    if (validData.length === 0) {
      return res.status(400).json({ message: "Tidak ada data valid untuk ditambahkan" });
    }

    const orderCodes = new Set();
    const duplicateErrors = [];

    validData.forEach((item, index) => {
      const orderCode = item["Order Code"];
      if (orderCode) {
        const trimmedOrderCode = orderCode.toString().trim();
        if (orderCodes.has(trimmedOrderCode)) {
          duplicateErrors.push(`Data ke-${index + 1}: Order Code '${trimmedOrderCode}' duplikat dalam file`);
        } else {
          orderCodes.add(trimmedOrderCode);
        }
      }
    });

    if (duplicateErrors.length > 0) {
      return res.status(400).json({ 
        message: `Duplikasi Order Code ditemukan dalam file: ${duplicateErrors.length} duplikat`,
        errors: duplicateErrors
      });
    }

    const uniqueOrderCodes = Array.from(orderCodes);
    const existingRecords = await ExcelData.find(
      { "Order Code": { $in: uniqueOrderCodes } },
      { "Order Code": 1, "Client Name": 1, Weight: 1, RoundDown: 1, RoundUp: 1, WeightDecimal: 1 }
    ).lean();

    const existingOrderCodes = new Map();
    existingRecords.forEach(record => {
      existingOrderCodes.set(record["Order Code"], {
        clientName: record["Client Name"],
        weight: record.Weight,
        roundDown: record.RoundDown,
        roundUp: record.RoundUp,
        weightDecimal: record.WeightDecimal
      });
    });

    const newData = [];
    const conflictingData = [];

    validData.forEach((item, index) => {
      const orderCode = item["Order Code"];
      const trimmedOrderCode = orderCode?.toString().trim();

      if (trimmedOrderCode && existingOrderCodes.has(trimmedOrderCode)) {
        const existingRecord = existingOrderCodes.get(trimmedOrderCode);
        conflictingData.push({
          index: index + 1,
          orderCode: trimmedOrderCode,
          clientName: item["Client Name"],
          existingClientName: existingRecord.clientName
        });
      } else {
        newData.push(item);
      }
    });

    if (conflictingData.length > 0) {
      console.log(`Found ${conflictingData.length} conflicting records, proceeding with selective update`);

      const session = await ExcelData.db.startSession();
      session.startTransaction();

      try {
        let updatedCount = 0;
        let insertedCount = 0;
        const batchSize = 500;
        const processedRecords = [];

        for (let i = 0; i < validData.length; i += batchSize) {
          const batch = validData.slice(i, i + batchSize);
          console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(validData.length / batchSize)} - ${batch.length} records`);

          for (const item of batch) {
            const orderCode = item["Order Code"]?.toString().trim();
            const clientName = item["Client Name"]?.toString().trim();

            if (!orderCode || !clientName) continue;

            try {
              const validatedItem = validateAndSanitizeData(item);
              const existingRecord = await ExcelData.findOne({
                "Order Code": orderCode
              }).session(session);

              if (existingRecord) {
                const existingWeight = existingOrderCodes.get(orderCode);
                
                const updateFields = { ...validatedItem };
                
                if (existingWeight) {
                  updateFields.Weight = existingWeight.weight;
                  updateFields.RoundDown = existingWeight.roundDown;
                  updateFields.RoundUp = existingWeight.roundUp;
                  updateFields.WeightDecimal = existingWeight.weightDecimal;
                }

                const updateResult = await ExcelData.updateOne(
                  { "Order Code": orderCode },
                  { $set: updateFields },
                  { session, runValidators: true }
                );

                if (updateResult.modifiedCount > 0) {
                  updatedCount++;
                  processedRecords.push({
                    action: 'updated',
                    orderCode,
                    clientName,
                    weightPreserved: !!existingWeight
                  });
                }
              } else {
                await ExcelData.create([validatedItem], { session });
                insertedCount++;
                processedRecords.push({
                  action: 'inserted',
                  orderCode,
                  clientName
                });
              }
            } catch (itemError) {
              console.error(`Error processing ${orderCode}:`, itemError.message);
            }
          }
        }

        await session.commitTransaction();

        const countAfter = await ExcelData.countDocuments();
        console.log(`Records after append: ${countAfter}`);

        setImmediate(() => {
          cacheWarmer.forceRefresh('excelData');
        });

        res.status(201).json({
          message: `Proses selesai: ${insertedCount} data baru ditambahkan, ${updatedCount} data diperbarui (Weight dipertahankan). Total data: ${countAfter}`,
          summary: {
            dataBefore: countBefore,
            dataInserted: insertedCount,
            dataUpdated: updatedCount,
            dataAfter: countAfter,
            totalProcessed: insertedCount + updatedCount,
            weightFieldsPreserved: updatedCount,
            success: true
          },
          processedRecords: processedRecords.slice(0, 50)
        });

      } catch (transactionError) {
        await session.abortTransaction();
        throw transactionError;
      } finally {
        session.endSession();
      }

    } else {
      const session = await ExcelData.db.startSession();
      session.startTransaction();

      try {
        console.log(`Valid records to append: ${newData.length}`);

        const batchSize = 1000;
        let totalInserted = 0;

        for (let i = 0; i < newData.length; i += batchSize) {
          const batch = newData.slice(i, i + batchSize).map(validateAndSanitizeData);
          console.log(`Appending batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(newData.length / batchSize)} - ${batch.length} records`);

          try {
            const result = await ExcelData.insertMany(batch, { 
              session, 
              ordered: false
            });

            const insertedCount = Array.isArray(result) ? result.length : result.length;
            totalInserted += insertedCount;

            console.log(`Batch appended: ${insertedCount} records, Total appended so far: ${totalInserted}`);
          } catch (batchError) {
            if (batchError.code === 11000) {
              const duplicateKeys = batchError.writeErrors?.map(err => {
                const keyValue = err.keyValue || {};
                return `Order Code: ${keyValue["Order Code"] || "unknown"}`;
              }) || ["Unknown duplicate"];

              throw new Error(`Duplikasi Order Code ditemukan: ${duplicateKeys.join(", ")}`);
            }
            throw batchError;
          }
        }

        await session.commitTransaction();

        const countAfter = await ExcelData.countDocuments();
        console.log(`Records after append: ${countAfter}`);

        setImmediate(() => {
          cacheWarmer.forceRefresh('excelData');
        });

        res.status(201).json({
          message: `${totalInserted} data baru berhasil ditambahkan. Total data: ${countAfter}`,
          summary: {
            dataBefore: countBefore,
            dataAdded: totalInserted,
            dataAfter: countAfter,
            success: true
          }
        });

      } catch (transactionError) {
        await session.abortTransaction();

        if (transactionError.message.includes("Duplikasi Order Code")) {
          return res.status(400).json({ 
            message: transactionError.message,
            error: "Duplicate key error"
          });
        }
        throw transactionError;
      } finally {
        session.endSession();
      }
    }

  } catch (error) {
    console.error("Append error:", error.message);
    res.status(500).json({ 
      message: "Append gagal", 
      error: error.message
    });
  }
};

const replaceData = async (req, res) => {
  try {
    const dataArray = req.body.records || req.body;

    if (!Array.isArray(dataArray) || dataArray.length === 0) {
      return res.status(400).json({ message: "Data replace tidak valid atau kosong." });
    }

    console.log(`Starting replace process for ${dataArray.length} records`);

    const session = await ExcelData.db.startSession();
    session.startTransaction();

    try {
      let successCount = 0;
      let failedCount = 0;
      let updatedRecords = [];
      let notFoundRecords = [];

      for (const item of dataArray) {
        const { clientName, orderCode, updateData } = item;

        if (!clientName || !orderCode) {
          failedCount++;
          notFoundRecords.push({ 
            clientName: clientName || "N/A", 
            orderCode: orderCode || "N/A", 
            error: "Client Name atau Order Code kosong" 
          });
          continue;
        }

        try {
          const trimmedClientName = clientName.toString().trim();
          const trimmedOrderCode = orderCode.toString().trim();

          const filter = {
            "Client Name": trimmedClientName,
            "Order Code": trimmedOrderCode
          };

          console.log(`Searching for: Client Name="${trimmedClientName}", Order Code="${trimmedOrderCode}"`);

          let existingRecord = await ExcelData.findOne(filter).session(session);

          if (!existingRecord) {
            const caseInsensitiveFilter = {
              "Client Name": { $regex: new RegExp(`^${trimmedClientName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
              "Order Code": { $regex: new RegExp(`^${trimmedOrderCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") }
            };
            existingRecord = await ExcelData.findOne(caseInsensitiveFilter).session(session);
          }

          if (!existingRecord) {
            failedCount++;
            notFoundRecords.push({ 
              clientName: trimmedClientName, 
              orderCode: trimmedOrderCode, 
              error: "Data tidak ditemukan di database" 
            });
            console.log(`Record not found: ${trimmedClientName} - ${trimmedOrderCode}`);
            continue;
          }

          if (!updateData || typeof updateData !== 'object') {
            failedCount++;
            notFoundRecords.push({ 
              clientName: trimmedClientName, 
              orderCode: trimmedOrderCode, 
              error: "Update data tidak valid" 
            });
            continue;
          }

          const validatedUpdateData = validateAndSanitizeData(updateData);

          const protectedFields = ['Weight', 'RoundDown', 'RoundUp', 'WeightDecimal'];
          protectedFields.forEach(field => {
            if (existingRecord[field] !== undefined && existingRecord[field] !== null) {
              validatedUpdateData[field] = existingRecord[field];
            }
          });

          const updateResult = await ExcelData.updateOne(
            { _id: existingRecord._id },
            { $set: validatedUpdateData },
            { session, runValidators: true }
          );

          if (updateResult.modifiedCount > 0) {
            successCount++;
            updatedRecords.push({
              clientName: trimmedClientName,
              orderCode: trimmedOrderCode,
              updatedFields: Object.keys(validatedUpdateData),
              recordId: existingRecord._id,
              weightPreserved: true
            });
            console.log(`Successfully updated: ${trimmedClientName} - ${trimmedOrderCode} (Weight preserved)`);
          } else {
            successCount++;
            updatedRecords.push({
              clientName: trimmedClientName,
              orderCode: trimmedOrderCode,
              updatedFields: Object.keys(validatedUpdateData),
              recordId: existingRecord._id,
              note: "No changes detected but operation successful"
            });
            console.log(`No changes but operation successful: ${trimmedClientName} - ${trimmedOrderCode}`);
          }

        } catch (updateError) {
          console.error(`Error updating ${clientName} - ${orderCode}:`, updateError.message);
          failedCount++;
          notFoundRecords.push({ 
            clientName, 
            orderCode, 
            error: updateError.message 
          });
        }
      }

      await session.commitTransaction();

      const responseMessage = `Replace selesai. ${successCount} data berhasil diproses (Weight fields preserved), ${failedCount} data gagal.`;
      console.log(`Replace completed: ${successCount} successful, ${failedCount} failed`);

      setImmediate(() => {
        cacheWarmer.forceRefresh('excelData');
      });

      res.status(200).json({
        message: responseMessage,
        summary: {
          totalProcessed: dataArray.length,
          successfulUpdates: successCount,
          failed: failedCount,
          weightFieldsPreserved: successCount,
          success: true
        },
        updatedRecords: updatedRecords.slice(0, 50),
        notFoundRecords: notFoundRecords.slice(0, 50)
      });

    } catch (transactionError) {
      await session.abortTransaction();
      throw transactionError;
    } finally {
      session.endSession();
    }

  } catch (error) {
    console.error("Replace error:", error.message);
    res.status(500).json({ 
      message: "Replace gagal", 
      error: error.message
    });
  }
};

const deleteData = async (req, res) => {
  try {
    const dataArray = req.body.records || req.body;

    if (!Array.isArray(dataArray) || dataArray.length === 0) {
      return res.status(400).json({ message: "Data delete tidak valid atau kosong." });
    }

    console.log(`Starting delete process for ${dataArray.length} records`);

    const session = await ExcelData.db.startSession();
    session.startTransaction();

    try {
      let deletedCount = 0;
      let notFoundCount = 0;
      let deletedRecords = [];
      let notFoundRecords = [];

      const batchSize = 500;
      const totalBatches = Math.ceil(dataArray.length / batchSize);

      for (let i = 0; i < dataArray.length; i += batchSize) {
        const batch = dataArray.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;

        console.log(`Processing delete batch ${batchNumber}/${totalBatches} - ${batch.length} records`);

        for (const item of batch) {
          const { clientName, orderCode } = item;

          if (!clientName || !orderCode) {
            notFoundCount++;
            notFoundRecords.push({ clientName, orderCode, error: "Client Name atau Order Code kosong" });
            continue;
          }

          try {
            const filter = {
              "Client Name": { $regex: new RegExp(`^${clientName}$`, "i") },
              "Order Code": { $regex: new RegExp(`^${orderCode}$`, "i") }
            };

            const deleteResult = await ExcelData.deleteOne(filter, { session });

            if (deleteResult.deletedCount > 0) {
              deletedCount++;
              deletedRecords.push({ clientName, orderCode });
            } else {
              notFoundCount++;
              notFoundRecords.push({ clientName, orderCode, error: "Data tidak ditemukan" });
            }

          } catch (deleteError) {
            console.error(`Error deleting ${clientName} - ${orderCode}:`, deleteError.message);
            notFoundCount++;
            notFoundRecords.push({ 
              clientName, 
              orderCode, 
              error: deleteError.message 
            });
          }
        }

        console.log(`Delete batch ${batchNumber} completed`);
      }

      await session.commitTransaction();

      const responseMessage = `Delete selesai. ${deletedCount} data berhasil dihapus, ${notFoundCount} data tidak ditemukan.`;
      console.log(`Delete completed: ${deletedCount} successful, ${notFoundCount} failed`);

      setImmediate(() => {
        cacheWarmer.forceRefresh('excelData');
      });

      res.status(200).json({
        message: responseMessage,
        summary: {
          totalProcessed: dataArray.length,
          successfulDeletes: deletedCount,
          notFound: notFoundCount,
          batchesProcessed: totalBatches,
          success: true
        },
        deletedRecords: deletedRecords.slice(0, 100),
        notFoundRecords: notFoundRecords.slice(0, 100)
      });

    } catch (transactionError) {
      await session.abortTransaction();
      throw transactionError;
    } finally {
      session.endSession();
    }

  } catch (error) {
    console.error("Delete error:", error.message);
    res.status(500).json({ 
      message: "Delete gagal", 
      error: error.message
    });
  }
};

const compareDistanceByOrderCode = async (req, res) => {
  const startTime = Date.now();
  const { orderCode } = req.body;

  try {
    if (!orderCode || typeof orderCode !== 'string' || !orderCode.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Order Code tidak valid atau kosong'
      });
    }

    const trimmedOrderCode = orderCode.trim();

    console.log(`Starting compare distance for Order Code: ${trimmedOrderCode}`);

    const session = await ExcelData.db.startSession();
    session.startTransaction();

    try {
      const excelRecord = await ExcelData.findOne({ 
        "Order Code": { $regex: new RegExp(`^${trimmedOrderCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") }
      }).session(session);

      if (!excelRecord) {
        await session.abortTransaction();
        return res.status(404).json({
          success: false,
          message: `Order Code '${trimmedOrderCode}' tidak ditemukan di ExcelData`
        });
      }

      const eDataRecord = await EData.findOne({
        orderNo: { $regex: new RegExp(`^${trimmedOrderCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") }
      }).session(session);

      if (!eDataRecord) {
        await session.abortTransaction();
        return res.status(404).json({
          success: false,
          message: `Order Code '${trimmedOrderCode}' tidak ditemukan di EData`
        });
      }

      const currentDistance = parseFloat(excelRecord.Distance) || 0;
      const currentWeight = excelRecord.Weight || '';
      const newDistance = parseFloat(eDataRecord.distanceInKm) || 0;
      const newWeight = eDataRecord.totalWeightPerorder || '';

      console.log(`Current Distance: ${currentDistance}, New Distance: ${newDistance}, Current Weight: ${currentWeight}, New Weight: ${newWeight}`);

      const distanceChanged = Math.abs(currentDistance - newDistance) >= 0.01;
      const weightChanged = currentWeight.toString() !== newWeight.toString();

      if (!distanceChanged && !weightChanged) {
        await session.commitTransaction();
        return res.status(200).json({
          success: true,
          updated: false,
          message: `Distance dan Weight sudah sesuai (Distance: ${currentDistance} km, Weight: ${currentWeight})`,
          orderCode: trimmedOrderCode,
          oldDistance: currentDistance,
          newDistance: newDistance,
          oldWeight: currentWeight,
          newWeight: newWeight
        });
      }

      const updateFields = {};

      if (distanceChanged) {
        updateFields.Distance = newDistance;
        const distanceMetrics = calculateDistanceMetrics(newDistance);
        updateFields["RoundDown Distance"] = distanceMetrics.roundDownDistance;
        updateFields["RoundUp Distance"] = distanceMetrics.roundUpDistance;
      }

      if (weightChanged) {
        updateFields.Weight = newWeight;
        const weightMetrics = calculateWeightMetrics(newWeight);
        updateFields.RoundDown = weightMetrics.roundDown;
        updateFields.RoundUp = weightMetrics.roundUp;
        updateFields.WeightDecimal = weightMetrics.weightDecimal;
      }

      const updateResult = await ExcelData.updateOne(
        { _id: excelRecord._id },
        { $set: updateFields },
        { session, runValidators: true }
      );

      if (updateResult.modifiedCount > 0) {
        const updateMessages = [];
        if (distanceChanged) {
          updateMessages.push(`Distance dari ${currentDistance} km menjadi ${newDistance} km`);
        }
        if (weightChanged) {
          updateMessages.push(`Weight dari ${currentWeight} menjadi ${newWeight}`);
        }

        console.log(`Data updated successfully for Order Code: ${trimmedOrderCode}`);

        await session.commitTransaction();

        setImmediate(() => {
          cacheWarmer.forceRefresh('excelData');
        });

        return res.status(200).json({
          success: true,
          updated: true,
          message: `Data berhasil diperbarui: ${updateMessages.join(', ')}`,
          orderCode: trimmedOrderCode,
          oldDistance: currentDistance,
          newDistance: newDistance,
          oldWeight: currentWeight,
          newWeight: newWeight,
          modifiedCount: updateResult.modifiedCount
        });
      } else {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `Gagal memperbarui data untuk Order Code: ${trimmedOrderCode}`,
          orderCode: trimmedOrderCode
        });
      }
    } catch (transactionError) {
      await session.abortTransaction();
      throw transactionError;
    } finally {
      session.endSession();
    }

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('Compare distance error:', error.message);
    res.status(500).json({
      success: false,
      message: `Compare distance gagal: ${error.message}`,
      error: error.message,
      duration: `${duration}ms`
    });
  }
};

const batchCompareAll = async (req, res) => {
  const startTime = Date.now();
  const { updateData } = req.body;

  try {
    if (!updateData || !Array.isArray(updateData) || updateData.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Update data array tidak valid atau kosong'
      });
    }

    console.log(`Starting batch compare for ${updateData.length} order codes`);

    const validUpdateData = updateData.filter(item => 
      item && item.orderCode && typeof item.orderCode === 'string' && item.orderCode.trim()
    );

    if (validUpdateData.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Tidak ada update data yang valid'
      });
    }

    const session = await ExcelData.db.startSession();
    session.startTransaction();

    try {
      let totalProcessed = 0;
      let totalUpdated = 0;
      let errors = [];

      const batchSize = 50;
      const totalBatches = Math.ceil(validUpdateData.length / batchSize);

      for (let i = 0; i < validUpdateData.length; i += batchSize) {
        const batch = validUpdateData.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;

        console.log(`Processing batch ${batchNumber}/${totalBatches} - ${batch.length} order codes`);

        for (const updateItem of batch) {
          const { orderCode, distance, weight } = updateItem;
          const trimmedOrderCode = orderCode.trim();
          totalProcessed++;

          try {
            const excelRecord = await ExcelData.findOne({ 
              "Order Code": { $regex: new RegExp(`^${trimmedOrderCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") }
            }).session(session);

            if (!excelRecord) {
              errors.push(`${trimmedOrderCode}: Tidak ditemukan di ExcelData`);
              continue;
            }

            const currentDistance = parseFloat(excelRecord.Distance) || 0;
            const currentWeight = excelRecord.Weight || '';
            const newDistance = parseFloat(distance) || 0;
            const newWeight = weight || '';

            const distanceChanged = Math.abs(currentDistance - newDistance) >= 0.01;
            const weightChanged = currentWeight.toString() !== newWeight.toString();

            if (distanceChanged || weightChanged) {
              const updateFields = {};

              if (distanceChanged) {
                updateFields.Distance = newDistance;
                const distanceMetrics = calculateDistanceMetrics(newDistance);
                updateFields["RoundDown Distance"] = distanceMetrics.roundDownDistance;
                updateFields["RoundUp Distance"] = distanceMetrics.roundUpDistance;
              }

              if (weightChanged) {
                updateFields.Weight = newWeight;
                const weightMetrics = calculateWeightMetrics(newWeight);
                updateFields.RoundDown = weightMetrics.roundDown;
                updateFields.RoundUp = weightMetrics.roundUp;
                updateFields.WeightDecimal = weightMetrics.weightDecimal;
              }

              const updateResult = await ExcelData.updateOne(
                { _id: excelRecord._id },
                { $set: updateFields },
                { session, runValidators: true }
              );

              if (updateResult.modifiedCount > 0) {
                totalUpdated++;
              } else {
                errors.push(`${trimmedOrderCode}: Update gagal`);
              }
            }

          } catch (error) {
            console.error(`Error processing ${trimmedOrderCode}:`, error.message);
            errors.push(`${trimmedOrderCode}: ${error.message}`);
          }
        }

        if (batchNumber < totalBatches) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      await session.commitTransaction();

      const duration = Date.now() - startTime;
      console.log(`Batch compare completed: ${totalUpdated} updated out of ${totalProcessed} processed`);

      setImmediate(() => {
        cacheWarmer.forceRefresh('excelData');
      });

      res.status(200).json({
        success: true,
        message: `Batch compare selesai: ${totalUpdated} data berhasil diperbarui dari ${totalProcessed} data`,
        totalProcessed: totalProcessed,
        totalUpdated: totalUpdated,
        errors: errors.slice(0, 100),
        summary: {
          processed: totalProcessed,
          updated: totalUpdated,
          failed: errors.length,
          successRate: totalProcessed > 0 ? Math.round((totalUpdated / totalProcessed) * 100) : 0
        },
        duration: `${duration}ms`
      });

    } catch (transactionError) {
      await session.abortTransaction();
      throw transactionError;
    } finally {
      session.endSession();
    }

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('Batch compare error:', error.message);
    res.status(500).json({
      success: false,
      message: `Batch compare gagal: ${error.message}`,
      error: error.message,
      duration: `${duration}ms`
    });
  }
};

const getAllData = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 0;
    const skip = limit > 0 ? (page - 1) * limit : 0;

    console.log(`Fetching Excel data - Page: ${page}, Limit: ${limit}`);

    const cachedData = cacheWarmer.getCachedData('excelData');

    if (cachedData && cachedData.length > 0) {
      const totalRecords = cachedData.length;

      if (limit > 0) {
        const paginatedData = cachedData.slice(skip, skip + limit);
        console.log(`✅ Served from cache: ${paginatedData.length} of ${totalRecords} records`);

        return res.status(200).json(paginatedData);
      } else {
        console.log(`✅ Served all data from cache: ${totalRecords} records`);
        return res.status(200).json(cachedData);
      }
    }

    console.log('Cache miss, fetching from database...');

    const query = ExcelData.find()
      .select('-__v')
      .lean()
      .allowDiskUse(true);

    if (limit > 0) {
      query.skip(skip).limit(limit);
    }

    const [data, total] = await Promise.all([
      query,
      ExcelData.countDocuments()
    ]);

    console.log(`Data fetched: ${data.length} records${limit > 0 ? ` (page ${page})` : ' (all data)'}, Total in DB: ${total}`);

    if (limit > 0) {
      return res.status(200).json(data);
    }

    res.status(200).json(data);
  } catch (error) {
    console.error("Get data error:", error.message);
    res.status(500).json({ 
      message: "Gagal mengambil data", 
      error: error.message
    });
  }
};

const getDataByClient = async (req, res) => {
  try {
    const client = req.params.client;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 0;
    const skip =     limit > 0 ? (page - 1) * limit : 0;

    console.log(`Searching for client: ${client}`);

    const cachedData = cacheWarmer.getCachedData('excelData');

    if (cachedData && cachedData.length > 0) {
      const filteredData = cachedData.filter(record => 
        record["Client Name"] && record["Client Name"].toLowerCase().includes(client.toLowerCase())
      );

      const totalRecords = filteredData.length;

      if (limit > 0) {
        const paginatedData = filteredData.slice(skip, skip + limit);
        console.log(`✅ Served from cache: ${paginatedData.length} of ${totalRecords} client records`);

        return res.status(200).json({
          data: paginatedData,
          totalRecords: totalRecords,
          fetchedRecords: paginatedData.length,
          pagination: {
            page,
            limit,
            total: totalRecords,
            totalPages: Math.ceil(totalRecords / limit)
          }
        });
      } else {
        console.log(`✅ Served all client data from cache: ${totalRecords} records`);
        return res.status(200).json({
          data: filteredData,
          totalRecords: totalRecords,
          fetchedRecords: totalRecords
        });
      }
    }

    console.log('Cache miss, fetching client data from database...');

    const filter = { "Client Name": { $regex: new RegExp(client, "i") } };
    const selectFields = 'Client Name Order Code Courier Name Courier Code HUB Cost Add Cost 1 Add Cost 2 Add Charge 1 Add Charge 2 Selling Price Zona Delivery Status Weight RoundUp Distance RoundUp Distance Date';

    const query = ExcelData.find(filter)
      .select(selectFields)
      .lean()
      .allowDiskUse(true);

    if (limit > 0) {
      query.skip(skip).limit(limit);
    }

    const [data, total] = await Promise.all([
      query,
      ExcelData.countDocuments(filter)
    ]);

    console.log(`Client data found: ${data.length} records${limit > 0 ? ` (page ${page})` : ' (all data)'}`);

    const response = {
      data,
      totalRecords: total,
      fetchedRecords: data.length
    };

    if (limit > 0) {
      response.pagination = {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      };
    }

    res.status(200).json(response);
  } catch (error) {
    console.error("Get client data error:", error.message);
    res.status(500).json({ 
      message: "Gagal ambil data client", 
      error: error.message 
    });
  }
};

module.exports = {
  uploadData,
  appendData,
  getAllData,
  getDataByClient,
  replaceData,
  deleteData,
  compareDistanceByOrderCode,
  batchCompareAll,
};