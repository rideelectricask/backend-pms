const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const mongoose = require('mongoose');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');

const AUTOMATION_SCRIPT_PATH = path.join(__dirname, '..', 'utils', 'automation.py');
const BLITZ_BATCH_DETAILS_URL = 'https://bmc.rideblitz.id/v1/batches/details';
const BLITZ_GENERATE_BATCH_URL = 'https://bmc.rideblitz.id/v1/generate/batch';
const BLITZ_ASSIGN_DRIVER_URL = 'https://amc.rideblitz.id/v1/batch/assign/driver';
const BLITZ_LOGIN_URL = 'https://driver-api.rideblitz.id/panel/login';
const BLITZ_ADMIN_APIS_ORDERS_URL = 'https://adminapis.rideblitz.id/api/v1/orders';

const JWT_SECRET = process.env.JWT_MITRA_SECRET || 'pms-mitra-secret-key-2025';

const HUB_LAT = -6.2093097;
const HUB_LON = 106.9151781;

const DELETED_BATCH_STATUSES = ['deleted', 'cancelled', 'expired'];

const getValidationDataBySenderName = async (senderName) => {
  const collection = mongoose.connection.db.collection('adminpanel_validations');
  return collection.findOne({ sender_name: senderName });
};

const getValidationDataForOrders = async (orders) => {
  const uniqueSenderNames = [...new Set(orders.map(o => o.sender_name).filter(Boolean))];
  const collection = mongoose.connection.db.collection('adminpanel_validations');
  const validations = await collection.find({ sender_name: { $in: uniqueSenderNames } }).toArray();
  const validationMap = {};
  validations.forEach(v => { validationMap[v.sender_name] = v; });
  return validationMap;
};

const getBlitzCredentials = async (req) => {
  if (req && req.headers && req.headers.authorization) {
    const authHeader = req.headers.authorization;
    if (authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.blitz_username && decoded.blitz_password) {
          return { username: decoded.blitz_username, password: decoded.blitz_password };
        }
      } catch (e) {
      }
    }
  }

  if (req && req.body && req.body.blitzUsername && req.body.blitzPassword) {
    return { username: req.body.blitzUsername, password: req.body.blitzPassword };
  }

  const collection = mongoose.connection.db.collection('blitz_logins');
  const credential = await collection.findOne({ status: 'active' });
  if (!credential) throw new Error('No active Blitz credentials found in database');
  return { username: credential.username, password: credential.password };
};

const checkAutomationScript = () => {
  if (!fs.existsSync(AUTOMATION_SCRIPT_PATH)) {
    throw new Error(`automation.py not found at: ${AUTOMATION_SCRIPT_PATH}`);
  }
};

const loginToBlitz = async (username, password) => {
  try {
    console.log('🔐 Logging in to Blitz...');

    const response = await axios.post(BLITZ_LOGIN_URL, {
      username,
      password
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 30000
    });

    if (response.data.result) {
      console.log('✅ Blitz login successful');
      return response.data.data.access_token;
    }
    throw new Error('Login failed: ' + (response.data.message || 'Unknown error'));
  } catch (error) {
    console.error('❌ Blitz login error:', error.message);
    throw error;
  }
};

const checkInvoiceInAdminAPIs = async (merchantOrderId, accessToken) => {
  try {
    const startDate = new Date('1970-01-01').toISOString().split('T')[0] + '+07:00:00';
    const endDate = new Date().toISOString().split('T')[0] + '+19:23:20';

    const response = await axios.get(BLITZ_ADMIN_APIS_ORDERS_URL, {
      params: {
        sort: 'created_at',
        dir: '-1',
        page: 1,
        instant_type: 'non-instant',
        start_date: startDate,
        end_date: endDate,
        q: merchantOrderId,
        limit: 100,
        pickup_schedule_type: 'standard,scheduled,immediate',
        pickup_sla_model: 'pickup_slots,operational_hours'
      },
      headers: {
        'Accept': 'application/json',
        'Authorization': accessToken
      },
      timeout: 30000
    });

    if (response.data.results && response.data.results.length > 0) {
      const order = response.data.results[0];
      return {
        exists: true,
        orderId: order.id,
        awbNumber: order.awb_number,
        orderStatus: order.order_status,
        batchId: order.batch_id
      };
    }

    return { exists: false };
  } catch (error) {
    console.error(`❌ Error checking invoice ${merchantOrderId}:`, error.message);
    return { exists: false };
  }
};

const checkMultipleInvoices = async (orders, accessToken) => {
  console.log(`\n🔍 Checking ${orders.length} invoices in AdminAPIs...`);

  const results = {
    existing: [],
    missing: []
  };

  for (const order of orders) {
    const check = await checkInvoiceInAdminAPIs(order.merchant_order_id, accessToken);

    if (check.exists) {
      console.log(`   ✅ ${order.merchant_order_id} exists (ID: ${check.orderId})`);
      results.existing.push({
        ...order,
        blitzOrderId: check.orderId,
        awbNumber: check.awbNumber,
        orderStatus: check.orderStatus,
        batchId: check.batchId
      });
    } else {
      console.log(`   ❌ ${order.merchant_order_id} NOT FOUND`);
      results.missing.push(order);
    }

    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log(`\n📊 Check summary: ${results.existing.length} existing, ${results.missing.length} missing`);

  return results;
};

const createExcelFromOrders = async (orders) => {
  const { Workbook } = require('exceljs');
  const workbook = new Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');

  const headers = [
    'merchant_order_id*', 'weight*', 'width', 'height', 'length',
    'payment_type*', 'cod_amount', 'sender_name*', 'sender_phone*',
    'pickup_instructions', 'consignee_name*', 'consignee_phone*',
    'destination_district', 'destination_city*', 'destination_province',
    'destination_postalcode*', 'destination_address*', 'dropoff_lat',
    'dropoff_long', 'dropoff_instructions', 'item_value*', 'product_details*'
  ];

  worksheet.addRow(headers);

  worksheet.getRow(1).eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: 'Calibri' };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  for (const order of orders) {
    worksheet.addRow([
      order.merchant_order_id || '',
      order.weight || 0,
      order.width || 0,
      order.height || 0,
      order.length || 0,
      order.payment_type || 'non_cod',
      order.cod_amount || 0,
      order.sender_name || '',
      order.sender_phone || '',
      order.pickup_instructions || '',
      order.consignee_name || '',
      order.consignee_phone || '',
      order.destination_district || '',
      order.destination_city || '',
      order.destination_province || '',
      order.destination_postalcode || '',
      order.destination_address || '',
      order.dropoff_lat || 0,
      order.dropoff_long || 0,
      order.dropoff_instructions || '',
      order.item_value || 0,
      order.product_details || ''
    ]);
  }

  const tempDir = os.tmpdir();
  const tempFile = path.join(tempDir, `orders_${uuidv4()}.xlsx`);

  await workbook.xlsx.writeFile(tempFile);

  console.log(`✅ Excel file created: ${tempFile}`);
  console.log(`   Size: ${fs.statSync(tempFile).size} bytes`);

  return tempFile;
};

const uploadInvoicesToAdminPanel = async (orders, validationMap, blitzUsername, blitzPassword) => {
  console.log(`\n📤 Uploading ${orders.length} invoices to AdminPanel...`);

  checkAutomationScript();

  const excelFile = await createExcelFromOrders(orders);

  const firstSenderName = orders[0]?.sender_name;
  const validation = validationMap[firstSenderName];

  const business = validation?.business || 12;
  const city = validation?.city || 9;
  const serviceType = validation?.service_type || 2;
  const hubId = validation?.business_hub || 59;

  console.log(`\n📋 Upload parameters:`);
  console.log(`   Business: ${business}`);
  console.log(`   City: ${city}`);
  console.log(`   Service Type: ${serviceType}`);
  console.log(`   Hub ID: ${hubId}`);

  return new Promise((resolve, reject) => {
    const pythonProcess = spawn('python3', [AUTOMATION_SCRIPT_PATH], {
      env: {
        ...process.env,
        BLITZ_USERNAME: blitzUsername,
        BLITZ_PASSWORD: blitzPassword,
        BLITZ_FILE_PATH: excelFile,
        BLITZ_BUSINESS: business.toString(),
        BLITZ_CITY: city.toString(),
        BLITZ_SERVICE_TYPE: serviceType.toString(),
        BLITZ_BUSINESS_HUB: hubId.toString(),
        BLITZ_AUTO_SUBMIT: 'true',
        BLITZ_GOOGLE_SHEET_URL: '',
        BLITZ_KEEP_FILE: 'false',
        BLITZ_UPLOAD_ONLY: 'true'
      }
    });

    let outputData = '';
    let errorData = '';

    pythonProcess.stdout.on('data', (data) => {
      const output = data.toString();
      outputData += output;
      console.log(output);
    });

    pythonProcess.stderr.on('data', (data) => {
      errorData += data.toString();
      console.error(data.toString());
    });

    pythonProcess.on('close', async (code) => {
      try {
        if (fs.existsSync(excelFile)) {
          fs.unlinkSync(excelFile);
          console.log(`\n🗑️  Temporary file removed: ${excelFile}`);
        }
      } catch (cleanupError) {
        console.error(`⚠️ Failed to cleanup temp file: ${cleanupError.message}`);
      }

      if (code === 0) {
        console.log('✅ Upload to AdminPanel completed successfully');
        resolve({ success: true, output: outputData });
      } else {
        console.error('❌ Upload to AdminPanel failed');
        reject(new Error(`Upload failed with code ${code}: ${errorData}`));
      }
    });
  });
};

const getBatchCurrentStatus = async (batchId, accessToken) => {
  try {
    const response = await axios.get(`${BLITZ_BATCH_DETAILS_URL}/${batchId}`, {
      headers: {
        'Accept': 'application/json',
        'Authorization': accessToken,
        'bt': '2'
      },
      timeout: 30000
    });

    if (response.data.result && response.data.data) {
      const batchData = response.data.data;
      const driver = batchData.driver || {};
      const assignment = batchData.assignment || {};
      const batch = batchData.batch || {};
      const orders = batchData.orders || [];

      const batchStatus = (batch.status || '').toLowerCase();
      const isDeleted = DELETED_BATCH_STATUSES.includes(batchStatus);
      const ordersCount = orders.length;

      console.log(`📊 Batch ${batchId} status:`, {
        batchStatus,
        isDeleted,
        ordersCount,
        driverId: driver.id,
        assignmentId: assignment.id
      });

      if (ordersCount === 0) {
        console.log(`⚠️ Batch ${batchId} is EMPTY (0 orders)`);
        return {
          found: true,
          batchStatus,
          isDeleted: true,
          isEmpty: true,
          assignmentId: 0,
          driverId: 0,
          driverName: '',
          driverMobile: '',
          isAssigned: false
        };
      }

      return {
        found: true,
        batchStatus,
        isDeleted,
        isEmpty: false,
        ordersCount,
        assignmentId: assignment.id || 0,
        driverId: driver.id || 0,
        driverName: driver.name || '',
        driverMobile: driver.mobile || '',
        isAssigned: !isDeleted && (driver.id || 0) > 0 && (assignment.id || 0) > 0
      };
    }
    return { found: false, isDeleted: false, isEmpty: false };
  } catch (error) {
    console.error(`❌ Error getting batch ${batchId} status:`, error.message);
    return { found: false, isDeleted: false, isEmpty: false };
  }
};

const resetBatchIdInPMS = async (project, orderIds) => {
  try {
    const collectionName = `${project}_merchant_orders`;
    const collection = mongoose.connection.db.collection(collectionName);

    const objectIds = orderIds.map(id => {
      try {
        return new mongoose.Types.ObjectId(id);
      } catch {
        return id;
      }
    });

    const result = await collection.updateMany(
      { _id: { $in: objectIds } },
      {
        $set: {
          batch_id: null,
          assignment_status: 'assigned'
        }
      }
    );

    console.log(`✅ Reset batch_id for ${result.modifiedCount} orders in ${collectionName}`);
    return result.modifiedCount;
  } catch (error) {
    console.error('❌ Error resetting batch_id in PMS:', error.message);
    return 0;
  }
};

const generateBatch = async (batchId, accessToken) => {
  try {
    console.log(`🔄 Generating batch ${batchId}...`);
    const response = await axios.get(`${BLITZ_GENERATE_BATCH_URL}/${batchId}`, {
      headers: {
        'Accept': 'application/json',
        'Authorization': accessToken,
        'bt': '2'
      },
      timeout: 30000
    });

    if (response.data.result) {
      console.log(`✅ Batch ${batchId} generated successfully`);
      return { success: true, alreadyGenerated: false };
    }

    console.warn(`⚠️ Batch ${batchId} generate returned non-result:`, response.data.message);
    return { success: false, alreadyGenerated: false };
  } catch (error) {
    const statusCode = error.response?.status;
    if (statusCode === 424) {
      console.log(`✅ Batch ${batchId} already generated (424), proceeding to assign...`);
      return { success: true, alreadyGenerated: true };
    }
    console.error(`❌ Error generating batch ${batchId}: ${error.message}`);
    return { success: false, alreadyGenerated: false };
  }
};

const tryAssignDriver = async (batchId, driverId, lat, lng, accessToken) => {
  const payload = {
    batch_id: parseInt(batchId),
    driver_id: parseInt(driverId),
    lat: parseFloat(lat),
    lng: parseFloat(lng),
    radius: '20km',
    allow_route_change: false,
    decline_batch_before_accept: false,
    accept_timer: 0,
    cancel_at_first_pickup: false,
    cancel_timer: 0
  };

  console.log(`📤 Assign driver payload:`, payload);

  const response = await axios.post(BLITZ_ASSIGN_DRIVER_URL, payload, {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': accessToken,
      'bt': '2'
    },
    timeout: 30000
  });

  return response.data;
};

exports.assignDriverToExistingBatch = async (req, res) => {
  try {
    const { batchId, driverId, driverName, driverPhone, project, orderIds } = req.body;

    console.log('\n==============================================');
    console.log('🚀 ASSIGN DRIVER TO EXISTING BATCH');
    console.log('==============================================');
    console.log(`Batch ID: ${batchId}`);
    console.log(`Driver ID: ${driverId}`);
    console.log(`Driver Name: ${driverName}`);
    console.log(`Project: ${project || 'mup'}`);
    console.log('==============================================\n');

    if (!batchId || !driverId) {
      return res.status(400).json({
        success: false,
        message: 'Batch ID and Driver ID are required'
      });
    }

    const credentials = await getBlitzCredentials(req);

    let accessToken;
    try {
      accessToken = await loginToBlitz(credentials.username, credentials.password);
    } catch (loginError) {
      console.error('❌ Failed to login to Blitz:', loginError.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to authenticate with Blitz system',
        error: loginError.message
      });
    }

    const projectName = project || 'mup';

    const currentStatus = await getBatchCurrentStatus(batchId, accessToken);

    console.log('📋 Current batch status:', {
      found: currentStatus.found,
      batchStatus: currentStatus.batchStatus,
      isDeleted: currentStatus.isDeleted,
      isEmpty: currentStatus.isEmpty,
      ordersCount: currentStatus.ordersCount,
      isAssigned: currentStatus.isAssigned,
      assignmentId: currentStatus.assignmentId,
      driverId: currentStatus.driverId,
      driverName: currentStatus.driverName
    });

    if (currentStatus.isDeleted || currentStatus.isEmpty) {
      console.log(`❌ Batch ${batchId} is ${currentStatus.isEmpty ? 'EMPTY' : 'deleted'} (status: ${currentStatus.batchStatus}), resetting PMS...`);

      if (orderIds && orderIds.length > 0) {
        await resetBatchIdInPMS(projectName, orderIds);
      }

      return res.status(422).json({
        success: false,
        batchDeleted: true,
        message: `Batch ${batchId} ${currentStatus.isEmpty ? 'sudah kosong (empty)' : 'sudah dihapus'} di Blitz. Silakan assign ulang order untuk membuat batch baru.`,
        batchStatus: currentStatus.batchStatus,
        batchId
      });
    }

    if (currentStatus.isAssigned) {
      const assignedDriverId = parseInt(currentStatus.driverId);
      const requestDriverId = parseInt(driverId);

      if (assignedDriverId === requestDriverId) {
        console.log(`✅ Batch ${batchId} already assigned to driver ${driverId}`);
        return res.json({
          success: true,
          message: 'Batch already assigned to this driver',
          batchId,
          driverId: currentStatus.driverId,
          assignmentId: currentStatus.assignmentId,
          alreadyAssigned: true
        });
      } else {
        console.log(`❌ Batch ${batchId} already assigned to different driver ${assignedDriverId}`);
        return res.status(409).json({
          success: false,
          message: `Batch ${batchId} sudah di-assign ke driver lain (${currentStatus.driverName})`,
          batchId,
          currentDriverId: assignedDriverId,
          currentDriverName: currentStatus.driverName,
          requestedDriverId: requestDriverId,
          conflict: true
        });
      }
    }

    const generateResult = await generateBatch(batchId, accessToken);
    if (!generateResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate batch',
        batchId
      });
    }

    if (!generateResult.alreadyGenerated) {
      console.log('⏳ Waiting 2 seconds after batch generation...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    let assignResponse;
    let lastError;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`\n📍 Assign attempt ${attempt}/3 for batch ${batchId}, driver ${driverId}`);
        assignResponse = await tryAssignDriver(
          batchId,
          driverId,
          HUB_LAT,
          HUB_LON,
          accessToken
        );

        console.log(`📥 Assign response:`, assignResponse);

        if (assignResponse.result) {
          console.log(`✅ Assignment successful on attempt ${attempt}`);
          break;
        }

        lastError = assignResponse.message || 'Assignment failed';
        console.warn(`⚠️ Attempt ${attempt} failed: ${lastError}`);

        if (attempt < 3) {
          console.log('⏳ Waiting 1.5 seconds before retry...');
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      } catch (attemptError) {
        lastError = attemptError.response?.data?.error?.message || attemptError.message;
        console.error(`❌ Attempt ${attempt} error: ${lastError}`);

        if (attempt < 3) {
          console.log('⏳ Waiting 1.5 seconds before retry...');
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }
    }

    if (assignResponse?.result) {
      return res.json({
        success: true,
        message: 'Driver assigned to batch successfully',
        batchId,
        driverId: assignResponse.data.driver_id,
        assignmentId: assignResponse.data.assignment_id
      });
    }

    console.log('🔍 Verifying assignment status after all attempts...');
    const verifyStatus = await getBatchCurrentStatus(batchId, accessToken);
    if (verifyStatus.isAssigned && parseInt(verifyStatus.driverId) === parseInt(driverId)) {
      console.log('✅ Assignment verified successful');
      return res.json({
        success: true,
        message: 'Driver assigned to batch successfully (verified)',
        batchId,
        driverId: verifyStatus.driverId,
        assignmentId: verifyStatus.assignmentId
      });
    }

    console.error('❌ All assignment attempts failed');

    const finalStatus = await getBatchCurrentStatus(batchId, accessToken);

    console.log('📋 Final batch status after all attempts:', finalStatus);

    if (finalStatus.isAssigned && parseInt(finalStatus.driverId) === parseInt(driverId)) {
      console.log('✅ Assignment verified successful despite error responses');
      return res.json({
        success: true,
        message: 'Driver assigned to batch successfully (verified)',
        batchId,
        driverId: finalStatus.driverId,
        assignmentId: finalStatus.assignmentId
      });
    }

    let errorMessage = lastError || 'All assignment attempts failed';
    let suggestion = 'Silakan cek Blitz Admin Panel dan assign driver secara manual.';

    if (errorMessage.includes('Cannot assign driver')) {
      suggestion = 'Kemungkinan penyebab:\n' +
        '1. Driver sedang offline di aplikasi Blitz\n' +
        '2. Batch dalam status yang tidak bisa di-assign\n' +
        '3. Driver sudah memiliki batch aktif lain\n\n' +
        'Solusi: Cek status driver di aplikasi Blitz atau assign manual di Admin Panel.';
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to assign driver to batch',
      error: errorMessage,
      suggestion: suggestion,
      batchId,
      driverId,
      batchUrl: `https://admin-manage.rideblitz.id/batch-list/${batchId}/batch-details`
    });

  } catch (error) {
    console.error('\n❌ CRITICAL ERROR in assignDriverToExistingBatch:', error);
    console.error('Stack trace:', error.stack);

    let errorMessage = error.message;
    let errorDetails = null;

    if (error.response?.data) {
      errorDetails = error.response.data;
      errorMessage = error.response.data.message || error.response.data.error?.message || errorMessage;
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to assign driver to batch',
      error: errorMessage,
      details: errorDetails
    });
  }
};

exports.syncToBlitz = async (req, res) => {
  try {
    const { project, orderIds, driverId, driverName, driverPhone, driverLat, driverLon } = req.body;

    console.log('\n==============================================');
    console.log('🚀 SYNC TO BLITZ WITH INVOICE CHECK');
    console.log('==============================================');
    console.log(`Project: ${project}`);
    console.log(`Driver ID: ${driverId}`);
    console.log(`Order IDs count: ${orderIds?.length || 0}`);
    console.log('==============================================\n');

    if (!project || !orderIds || orderIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Project and orderIds are required'
      });
    }

    if (!driverId) {
      return res.status(400).json({
        success: false,
        message: 'Driver ID is required'
      });
    }

    const credentials = await getBlitzCredentials(req);

    let accessToken;
    try {
      accessToken = await loginToBlitz(credentials.username, credentials.password);
    } catch (loginError) {
      console.error('❌ Failed to login to Blitz:', loginError.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to authenticate with Blitz system',
        error: loginError.message
      });
    }

    const collectionName = `${project}_merchant_orders`;
    const collection = mongoose.connection.db.collection(collectionName);

    const objectIds = orderIds.map(id => {
      try {
        return new mongoose.Types.ObjectId(id);
      } catch {
        return id;
      }
    });

    const orders = await collection.find({ _id: { $in: objectIds } }).toArray();

    if (orders.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No orders found'
      });
    }

    console.log(`📦 Found ${orders.length} orders to process`);

    const validationMap = await getValidationDataForOrders(orders);

    const missingSenders = [...new Set(orders.map(o => o.sender_name).filter(Boolean))].filter(
      senderName => !validationMap[senderName]
    );

    if (missingSenders.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Sender berikut tidak terdaftar di adminpanel_validations: ${missingSenders.join(', ')}`
      });
    }

    const invoiceCheck = await checkMultipleInvoices(orders, accessToken);

    if (invoiceCheck.missing.length > 0) {
      console.log(`\n📤 Uploading ${invoiceCheck.missing.length} missing invoices...`);

      try {
        await uploadInvoicesToAdminPanel(invoiceCheck.missing, validationMap, credentials.username, credentials.password);
        console.log('✅ Upload completed, waiting 5 seconds for processing...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (uploadError) {
        console.error('❌ Upload failed:', uploadError.message);
        return res.status(500).json({
          success: false,
          message: 'Failed to upload missing invoices to AdminPanel',
          error: uploadError.message,
          missingCount: invoiceCheck.missing.length
        });
      }
    }

    console.log('\n🔄 Re-checking all invoices after upload...');
    const recheckResults = await checkMultipleInvoices(orders, accessToken);

    if (recheckResults.missing.length > 0) {
      return res.status(500).json({
        success: false,
        message: `${recheckResults.missing.length} invoices still not found after upload`,
        missingInvoices: recheckResults.missing.map(o => o.merchant_order_id)
      });
    }

    console.log('\n✅ All invoices verified in AdminAPIs');

    let existingBatchIds = [...new Set(
      recheckResults.existing
        .filter(order => order.batchId && order.batchId > 0)
        .map(order => order.batchId)
    )];

    console.log(`\n📋 Batch IDs from invoices: ${existingBatchIds.join(', ') || 'None'}`);

    if (existingBatchIds.length === 0) {
      console.log(`\n⚠️ No batch_id found in invoices after upload!`);

      await new Promise(resolve => setTimeout(resolve, 3000));

      const finalCheck = await checkMultipleInvoices(orders, accessToken);
      existingBatchIds = [...new Set(
        finalCheck.existing
          .filter(order => order.batchId && order.batchId > 0)
          .map(order => order.batchId)
      )];

      if (existingBatchIds.length === 0) {
        return res.status(500).json({
          success: false,
          message: 'Invoices uploaded but no batch_id assigned. Please check AdminPanel manually.',
          invoices: finalCheck.existing.map(o => ({
            merchantOrderId: o.merchant_order_id,
            orderId: o.blitzOrderId,
            batchId: o.batchId
          }))
        });
      }

      console.log(`✅ Found batch IDs after delay: ${existingBatchIds.join(', ')}`);
    }

    if (existingBatchIds.length > 0) {
      const batchId = existingBatchIds[0];
      console.log(`\n📦 Processing batch: ${batchId}`);

      const firstOrder = orders[0];
      const firstValidation = validationMap[firstOrder.sender_name];
      const hubId = firstValidation?.business_hub || 59;
      const sequenceType = 1;

      const batchStatus = await getBatchCurrentStatus(batchId, accessToken);

      if (batchStatus.isDeleted || batchStatus.isEmpty) {
        console.log(`❌ Batch ${batchId} is ${batchStatus.isEmpty ? 'empty' : 'deleted'}`);
        return res.status(500).json({
          success: false,
          message: `Batch ${batchId} is ${batchStatus.isEmpty ? 'empty' : 'deleted'}`,
          batchId
        });
      } else if (batchStatus.isAssigned) {
        if (parseInt(batchStatus.driverId) === parseInt(driverId)) {
          console.log(`✅ Batch ${batchId} already assigned to this driver`);

          try {
            await collection.updateMany(
              { _id: { $in: objectIds } },
              {
                $set: {
                  batch_id: batchId,
                  assignment_status: 'in_progress'
                }
              }
            );
          } catch (updateError) {
            console.error('Failed to update PMS:', updateError);
          }

          return res.json({
            success: true,
            message: 'Orders already synced to existing batch',
            batchId,
            driverId: batchStatus.driverId,
            assignmentId: batchStatus.assignmentId,
            assignedCount: orders.length,
            blitzSynced: true,
            driverInfo: {
              driverId: batchStatus.driverId,
              driverName: batchStatus.driverName,
              assignmentId: batchStatus.assignmentId
            }
          });
        } else {
          return res.status(409).json({
            success: false,
            message: `Batch ${batchId} already assigned to different driver`,
            batchId,
            currentDriverId: batchStatus.driverId,
            currentDriverName: batchStatus.driverName
          });
        }
      } else {
        const generateResult = await generateBatch(batchId, accessToken);

        if (generateResult.success) {
          await new Promise(resolve => setTimeout(resolve, 2000));

          let assignResponse;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              assignResponse = await tryAssignDriver(batchId, driverId, driverLat || HUB_LAT, driverLon || HUB_LON, accessToken);

              if (assignResponse.result) {
                break;
              }

              if (attempt < 3) {
                await new Promise(resolve => setTimeout(resolve, 1500));
              }
            } catch (error) {
              if (attempt === 3) {
                throw error;
              }
              await new Promise(resolve => setTimeout(resolve, 1500));
            }
          }

          if (assignResponse?.result) {
            try {
              await collection.updateMany(
                { _id: { $in: objectIds } },
                {
                  $set: {
                    batch_id: batchId,
                    assignment_status: 'in_progress'
                  }
                }
              );
            } catch (updateError) {
              console.error('Failed to update PMS:', updateError);
            }

            return res.json({
              success: true,
              message: 'Orders synced and driver assigned successfully',
              batchId,
              assignedCount: orders.length,
              blitzSynced: true,
              driverId: assignResponse.data.driver_id,
              assignmentId: assignResponse.data.assignment_id,
              driverInfo: {
                driverId: assignResponse.data.driver_id,
                driverName: driverName,
                assignmentId: assignResponse.data.assignment_id
              }
            });
          }
        }
      }
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to assign driver to batch after all attempts',
      note: 'Batch exists but driver assignment failed'
    });

  } catch (error) {
    console.error('❌ syncToBlitz error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync to Blitz',
      error: error.message
    });
  }
};

exports.syncStatus = async (req, res) => {
  try {
    const scriptExists = fs.existsSync(AUTOMATION_SCRIPT_PATH);
    res.json({
      success: true,
      available: scriptExists,
      scriptPath: AUTOMATION_SCRIPT_PATH,
      message: scriptExists ? 'Blitz automation is available' : 'automation.py not found'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to check automation status',
      error: error.message
    });
  }
};