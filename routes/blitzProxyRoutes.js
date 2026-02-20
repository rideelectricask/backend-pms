const express = require('express');
const router = express.Router();
const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { Workbook } = require('exceljs');
const os = require('os');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_MITRA_SECRET || 'pms-mitra-secret-key-2025';

const BLITZ_LOGIN_URL = 'https://driver-api.rideblitz.id/panel/login';
const BLITZ_ORDERS_SEARCH_URL = 'https://adminapis.rideblitz.id/api/v1/orders';
const BLITZ_VALIDATE_BATCH_URL = 'https://bmc.rideblitz.id/v2/validate/batch/orders';
const BLITZ_ADD_BATCH_URL = 'https://bmc.rideblitz.id/v2/add/batch/orders';
const BLITZ_BATCH_DETAILS_URL = 'https://bmc.rideblitz.id/v1/batches/details';
const BLITZ_GENERATE_BATCH_URL = 'https://bmc.rideblitz.id/v1/generate/batch';
const BLITZ_NEARBY_DRIVERS_URL = 'https://driver-api.rideblitz.id/panel/driver';
const BLITZ_ASSIGN_DRIVER_URL = 'https://amc.rideblitz.id/v1/batch/assign/driver';
const BLITZ_DRIVER_LIST_URL = 'https://driver-api.rideblitz.id/v2/panel/driver-list';
const BLITZ_DRIVER_PERFORMANCE_URL = 'https://driver-api.rideblitz.id/v1/panel/driver/performance/batch';
const BLITZ_REMOVE_VALIDATE_URL = 'https://bmc.rideblitz.id/v2/validate/remove/batch/order';
const BLITZ_REMOVE_ORDER_URL = 'https://bmc.rideblitz.id/v2/remove/batch/orders';
const BLITZ_DRIVER_PROFILE_URL = 'https://driver-api.rideblitz.id/panel/driver-profile';

const AUTOMATION_SCRIPT_PATH = path.join(__dirname, '..', 'utils', 'automation.py');

const tokenCache = {};

const getValidationDataBySenderName = async (senderName) => {
  const collection = mongoose.connection.db.collection('adminpanel_validations');
  return collection.findOne({ sender_name: senderName });
};

const getValidationDataByMerchantOrderId = async (project, merchantOrderId) => {
  const orderCollection = mongoose.connection.db.collection(`${project}_merchant_orders`);
  const order = await orderCollection.findOne({ merchant_order_id: merchantOrderId });
  if (!order || !order.sender_name) return null;
  return getValidationDataBySenderName(order.sender_name);
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
        if (decoded.user_id) {
          const collection = mongoose.connection.db.collection('blitz_logins');
          const credential = await collection.findOne({ user_id: decoded.user_id, status: 'active' });
          if (credential) {
            return { username: credential.username, password: credential.password };
          }
        }
      } catch (e) {
        console.log('[CREDS] JWT verify failed:', e.message);
      }
    }
  }

  const collection = mongoose.connection.db.collection('blitz_logins');
  const credential = await collection.findOne({ status: 'active' });
  if (!credential) throw new Error('No active Blitz credentials found in database');
  return { username: credential.username, password: credential.password };
};

const loginToBlitz = async (username, password) => {
  const response = await axios.post(BLITZ_LOGIN_URL, { username, password }, {
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    timeout: 30000
  });
  if (response.data.result) {
    return response.data.data.access_token;
  }
  throw new Error('Login failed: ' + (response.data.message || 'Unknown error'));
};

const getAccessToken = async (req) => {
  const credentials = await getBlitzCredentials(req);
  const cacheKey = credentials.username;
  if (tokenCache[cacheKey] && tokenCache[cacheKey].expiry && Date.now() < tokenCache[cacheKey].expiry) {
    return tokenCache[cacheKey].token;
  }
  const accessToken = await loginToBlitz(credentials.username, credentials.password);
  tokenCache[cacheKey] = { token: accessToken, expiry: Date.now() + 60 * 60 * 1000 };
  return accessToken;
};

const createExcelFromOrders = async (orders) => {
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
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: 'Calibri' };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  for (const order of orders) {
    worksheet.addRow([
      order.merchant_order_id || '', order.weight || 0, order.width || 0,
      order.height || 0, order.length || 0, order.payment_type || 'non_cod',
      order.cod_amount || 0, order.sender_name || '', order.sender_phone || '',
      order.pickup_instructions || '', order.consignee_name || '', order.consignee_phone || '',
      order.destination_district || '', order.destination_city || '', order.destination_province || '',
      order.destination_postalcode || '', order.destination_address || '',
      order.dropoff_lat || 0, order.dropoff_long || 0, order.dropoff_instructions || '',
      order.item_value || 0, order.product_details || ''
    ]);
  }

  const tempFile = path.join(os.tmpdir(), `blitz_upload_${Date.now()}.xlsx`);
  await workbook.xlsx.writeFile(tempFile);
  return tempFile;
};

const runAutomationScript = async (excelFilePath, business, city, serviceType, hubId, blitzUsername, blitzPassword) => {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(AUTOMATION_SCRIPT_PATH)) {
      return reject(new Error(`automation.py not found at: ${AUTOMATION_SCRIPT_PATH}`));
    }

    const pythonProcess = spawn('python3', [AUTOMATION_SCRIPT_PATH], {
      env: {
        ...process.env,
        BLITZ_USERNAME: blitzUsername,
        BLITZ_PASSWORD: blitzPassword,
        BLITZ_FILE_PATH: excelFilePath,
        BLITZ_BUSINESS_HUB: hubId.toString(),
        BLITZ_BUSINESS: business.toString(),
        BLITZ_CITY: city.toString(),
        BLITZ_SERVICE_TYPE: serviceType.toString(),
        BLITZ_AUTO_SUBMIT: 'true',
        BLITZ_GOOGLE_SHEET_URL: '',
        BLITZ_KEEP_FILE: 'false'
      }
    });

    let outputData = '';
    let errorData = '';

    pythonProcess.stdout.on('data', (data) => { outputData += data.toString(); console.log(data.toString().trim()); });
    pythonProcess.stderr.on('data', (data) => { errorData += data.toString(); console.error(data.toString().trim()); });

    pythonProcess.on('close', (code) => {
      if (fs.existsSync(excelFilePath)) {
        try { fs.unlinkSync(excelFilePath); } catch (err) { console.warn(`Cleanup failed: ${err.message}`); }
      }
      if (code === 0) {
        resolve({ success: true, output: outputData });
      } else {
        reject(new Error(`Automation failed: ${errorData || 'Unknown error'}`));
      }
    });

    pythonProcess.on('error', (error) => {
      reject(new Error(`Failed to start automation: ${error.message}`));
    });
  });
};

const searchSingleOrderInBlitz = async (merchantOrderId, accessToken) => {
  try {
    const response = await axios.get(BLITZ_ORDERS_SEARCH_URL, {
      params: {
        sort: 'created_at', dir: '-1', page: 1, instant_type: 'non-instant',
        start_date: '1970-01-01+07:00:00',
        end_date: new Date().toISOString().split('T')[0] + '+23:59:59',
        q: merchantOrderId, limit: 50,
        pickup_schedule_type: 'standard,scheduled,immediate',
        pickup_sla_model: 'pickup_slots,operational_hours'
      },
      headers: { 'Accept': 'application/json', 'Authorization': accessToken },
      timeout: 15000
    });

    if (response.data.results && response.data.results.length > 0) {
      return response.data.results.find((r) => r.merchant_order_id === merchantOrderId) || null;
    }
    return null;
  } catch {
    return null;
  }
};

const checkSingleOrderInBlitz = async (merchantOrderId, accessToken) => {
  return (await searchSingleOrderInBlitz(merchantOrderId, accessToken)) !== null;
};

const waitUntilOrdersAppearInBlitz = async (merchantOrderIds, accessToken, maxRetries = 5, intervalMs = 5000) => {
  console.log(`Waiting for ${merchantOrderIds.length} order(s) to appear in Blitz...`);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const stillMissing = [];
    for (const merchantOrderId of merchantOrderIds) {
      const found = await checkSingleOrderInBlitz(merchantOrderId, accessToken);
      if (!found) stillMissing.push(merchantOrderId);
    }
    if (stillMissing.length === 0) return { success: true, missing: [] };
    if (attempt < maxRetries) await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  const finalMissing = [];
  for (const merchantOrderId of merchantOrderIds) {
    const found = await checkSingleOrderInBlitz(merchantOrderId, accessToken);
    if (!found) finalMissing.push(merchantOrderId);
  }
  return { success: finalMissing.length === 0, missing: finalMissing };
};

router.get('/token', async (req, res) => {
  try {
    const credentials = await getBlitzCredentials(req);
    delete tokenCache[credentials.username];
    const accessToken = await loginToBlitz(credentials.username, credentials.password);
    tokenCache[credentials.username] = { token: accessToken, expiry: Date.now() + 60 * 60 * 1000 };
    res.json({ success: true, token: accessToken });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/add-to-existing-batch', async (req, res) => {
  try {
    const { orders, batchId, hubId, business, city, serviceType } = req.body;

    console.log(`ADD TO EXISTING BATCH: ${batchId}, ${orders.length} orders`);

    const credentials = await getBlitzCredentials(req);
    const accessToken = await loginToBlitz(credentials.username, credentials.password);
    tokenCache[credentials.username] = { token: accessToken, expiry: Date.now() + 60 * 60 * 1000 };

    const merchantOrderIds = orders.map(o => o.merchant_order_id);

    console.log(`Step 1: Uploading all ${orders.length} orders to AdminPanel first...`);
    const excelFile = await createExcelFromOrders(orders);

    try {
      await runAutomationScript(
        excelFile,
        business || 12,
        city || 9,
        serviceType || 2,
        hubId,
        credentials.username,
        credentials.password
      );
    } catch (uploadError) {
      console.error('Upload failed:', uploadError.message);
      return res.status(500).json({ success: false, message: `Upload failed: ${uploadError.message}` });
    }

    console.log(`Step 2: Waiting for orders to appear in Blitz...`);
    const recheckResult = await waitUntilOrdersAppearInBlitz(merchantOrderIds, accessToken, 6, 6000);

    const availableOrderIds = [];
    for (const merchantOrderId of merchantOrderIds) {
      const found = await checkSingleOrderInBlitz(merchantOrderId, accessToken);
      if (found) availableOrderIds.push(merchantOrderId);
    }

    if (availableOrderIds.length === 0) {
      return res.status(500).json({
        success: false,
        message: `Upload ke AdminPanel berhasil, namun order belum muncul di Blitz. Silakan coba assign kembali.`,
        missingOrders: merchantOrderIds
      });
    }

    console.log(`Step 3: Validating ${availableOrderIds.length} orders for batch ${batchId}...`);
    const validateResponse = await axios.post(
      BLITZ_VALIDATE_BATCH_URL,
      { batchId: parseInt(batchId), hub_id: hubId, sequence_type: 1, merchant_order_ids: availableOrderIds },
      {
        headers: { 'Accept': 'application/json', 'Authorization': accessToken, 'Content-Type': 'application/json', 'bt': '2' },
        timeout: 30000
      }
    );

    console.log(`Validation result: ${validateResponse.data.result}`);

    console.log(`Step 4: Adding ${availableOrderIds.length} orders to batch ${batchId}...`);
    let addResponse;
    try {
      addResponse = await axios.post(
        BLITZ_ADD_BATCH_URL,
        { sequence_type: 1, batch_id: parseInt(batchId), merchant_order_ids: availableOrderIds, hub_id: hubId },
        {
          headers: { 'Accept': 'application/json', 'Authorization': accessToken, 'Content-Type': 'application/json', 'bt': '2' },
          timeout: 30000
        }
      );
    } catch (addError) {
      const errData = addError.response?.data;
      const errMsg = errData?.error?.message || errData?.message || addError.message;
      return res.status(addError.response?.status || 500).json({
        success: false,
        message: `Failed to add to batch: ${errMsg}`,
        blitz_error: errData
      });
    }

    if (!addResponse.data.result) {
      const errMsg = addResponse.data.error?.message || addResponse.data.message || 'Add to batch failed';
      return res.status(400).json({ success: false, message: errMsg });
    }

    const notAvailable = merchantOrderIds.filter(id => !availableOrderIds.includes(id));

    res.json({
      success: true,
      batchId,
      uploadedCount: orders.length,
      addedCount: availableOrderIds.length,
      skippedCount: notAvailable.length,
      skippedOrders: notAvailable,
      data: addResponse.data.data
    });

  } catch (error) {
    console.error('Add to existing batch error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/search-orders', async (req, res) => {
  try {
    const { merchantOrderIds } = req.body;

    if (!merchantOrderIds || !Array.isArray(merchantOrderIds) || merchantOrderIds.length === 0) {
      return res.status(400).json({ success: false, message: 'merchantOrderIds array is required' });
    }

    const accessToken = await getAccessToken(req);
    const today = new Date();
    const startDate = '1970-01-01+07:00:00';
    const endDate = today.toISOString().split('T')[0] + '+23:59:59';

    const results = {};
    const batchSize = 3;

    for (let i = 0; i < merchantOrderIds.length; i += batchSize) {
      const batch = merchantOrderIds.slice(i, i + batchSize);

      const promises = batch.map(async (merchantOrderId) => {
        try {
          const response = await axios.get(BLITZ_ORDERS_SEARCH_URL, {
            params: {
              sort: 'created_at', dir: '-1', page: 1, instant_type: 'non-instant',
              start_date: startDate, end_date: endDate, q: merchantOrderId, limit: 50,
              pickup_schedule_type: 'standard,scheduled,immediate',
              pickup_sla_model: 'pickup_slots,operational_hours'
            },
            headers: { 'Accept': 'application/json', 'Authorization': accessToken },
            timeout: 15000
          });

          if (response.data.results && response.data.results.length > 0) {
            const exactMatch = response.data.results.find((r) => r.merchant_order_id === merchantOrderId);
            if (exactMatch) {
              results[merchantOrderId] = {
                exists: true, order_id: exactMatch.id, awb_number: exactMatch.awb_number,
                order_status: exactMatch.order_status, batch_id: exactMatch.batch_id
              };
            } else {
              results[merchantOrderId] = { exists: false };
            }
          } else {
            results[merchantOrderId] = { exists: false };
          }
        } catch (error) {
          results[merchantOrderId] = { exists: false, error: error.message };
        }
      });

      await Promise.all(promises);
      if (i + batchSize < merchantOrderIds.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    const foundCount = Object.keys(results).filter(k => results[k]?.exists).length;
    res.json({ success: true, data: results, totalSearched: merchantOrderIds.length, totalFound: foundCount });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to search Blitz orders', error: error.message });
  }
});

router.get('/batch-details/:batchId', async (req, res) => {
  try {
    const { batchId } = req.params;
    const accessToken = await getAccessToken(req);

    const response = await axios.get(`${BLITZ_BATCH_DETAILS_URL}/${batchId}`, {
      headers: { 'Accept': 'application/json', 'Authorization': accessToken, 'bt': '2' },
      timeout: 30000
    });

    if (response.data.result && response.data.data) {
      return res.json(response.data);
    }
    res.status(404).json({ result: false, message: 'Batch not found' });

  } catch (error) {
    res.status(500).json({ result: false, message: 'Failed to get batch details', error: error.message });
  }
});

router.get('/active-batch/:driverId', async (req, res) => {
  try {
    const { driverId } = req.params;
    const accessToken = await getAccessToken(req);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);

    const formatDate = (date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    const response = await axios.get(`${BLITZ_DRIVER_PERFORMANCE_URL}/${driverId}`, {
      params: {
        sort: '-1', batchType: '', statusId: '', page: 1, offset: 100,
        term: '', createdFrom: formatDate(sevenDaysAgo), createdTo: formatDate(today), _t: Date.now()
      },
      headers: { 'Accept': 'application/json', 'Authorization': accessToken },
      timeout: 30000
    });

    if (!response.data?.result || !response.data?.data) {
      return res.json({ success: true, batchId: null });
    }

    const batches = response.data.data.driver_batch_performance_list;
    if (!Array.isArray(batches) || batches.length === 0) {
      return res.json({ success: true, batchId: null });
    }

    const activeBatch = batches.find(batch => batch.assignment_status === 1);
    if (!activeBatch) return res.json({ success: true, batchId: null });

    const batchId = activeBatch.id;
    const detailsResponse = await axios.get(`${BLITZ_BATCH_DETAILS_URL}/${batchId}`, {
      headers: { 'Accept': 'application/json', 'Authorization': accessToken, 'bt': '2' },
      timeout: 30000
    });

    if (detailsResponse.data.result && detailsResponse.data.data) {
      const ordersCount = (detailsResponse.data.data.orders || []).length;
      if (ordersCount === 0) return res.json({ success: true, batchId: null });
      return res.json({ success: true, batchId });
    }

    res.json({ success: true, batchId: null });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to get active batch', error: error.message });
  }
});

router.get('/driver-attendance/:driverPhone', async (req, res) => {
  try {
    const { driverPhone } = req.params;
    const accessToken = await getAccessToken(req);

    const response = await axios.get(BLITZ_DRIVER_LIST_URL, {
      params: {
        sort: '-1', status: '1,2,8,3,4,5,6,7', attendance: '',
        page: 1, offset: 100, term: driverPhone,
        app_version_name: '', bank_info_provided: 'undefined', _t: Date.now()
      },
      headers: { 'Accept': 'application/json', 'Authorization': accessToken },
      timeout: 30000
    });

    if (response.data.result && response.data.data?.driver_list_response?.length > 0) {
      const driverData = response.data.data.driver_list_response[0];
      const attendanceStatus = driverData.drivers?.attendance_status || 'offline';
      return res.json({ success: true, status: attendanceStatus });
    }

    res.json({ success: true, status: 'offline' });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to get driver attendance', error: error.message, status: 'offline' });
  }
});

router.get('/driver-profile/:driverId', async (req, res) => {
  try {
    const { driverId } = req.params;
    const accessToken = await getAccessToken(req);

    const response = await axios.get(`${BLITZ_DRIVER_PROFILE_URL}/${driverId}`, {
      headers: { 'Accept': 'application/json', 'Authorization': accessToken },
      timeout: 30000
    });

    if (response.data.result) {
      return res.json({ success: true, data: response.data.data });
    }
    res.json({ success: false, message: 'Driver profile not found' });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to get driver profile', error: error.message });
  }
});

router.post('/nearby-drivers', async (req, res) => {
  try {
    const { lat, lon } = req.body;
    const accessToken = await getAccessToken(req);

    const response = await axios.post(BLITZ_NEARBY_DRIVERS_URL, {
      lat: parseFloat(lat), lon: parseFloat(lon), radius: '20km', hub_ids: [], business_ids: []
    }, {
      headers: { 'Accept': 'application/json', 'Authorization': accessToken, 'Content-Type': 'application/json' },
      timeout: 30000
    });

    if (response.data.result) {
      return res.json({ success: true, data: response.data.data });
    }
    res.json({ success: false, message: 'Failed to fetch nearby drivers' });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to get nearby drivers', error: error.message });
  }
});

router.post('/validate-batch-orders', async (req, res) => {
  try {
    const { sequenceType, batchId, merchantOrderIds, hubId } = req.body;
    const accessToken = await getAccessToken(req);

    const response = await axios.post(BLITZ_VALIDATE_BATCH_URL, {
      sequence_type: sequenceType, batch_id: batchId, merchant_order_ids: merchantOrderIds, hub_id: hubId
    }, {
      headers: { 'Accept': 'application/json', 'Authorization': accessToken, 'Content-Type': 'application/json', 'bt': '2' },
      timeout: 30000
    });

    res.json(response.data);

  } catch (error) {
    res.status(500).json({ result: false, message: 'Failed to validate batch orders', error: error.message });
  }
});

router.post('/add-batch-orders', async (req, res) => {
  try {
    const { sequenceType, batchId, merchantOrderIds, hubId } = req.body;
    const accessToken = await getAccessToken(req);

    try {
      const response = await axios.post(BLITZ_ADD_BATCH_URL, {
        sequence_type: sequenceType, batch_id: batchId, merchant_order_ids: merchantOrderIds, hub_id: hubId
      }, {
        headers: { 'Accept': 'application/json', 'Authorization': accessToken, 'Content-Type': 'application/json', 'bt': '2' },
        timeout: 30000
      });
      res.json(response.data);
    } catch (axiosError) {
      const status = axiosError.response?.status;
      const errorData = axiosError.response?.data;
      const blitzMessage = errorData?.error?.message || errorData?.message || axiosError.message;
      res.status(status || 500).json({ result: false, message: blitzMessage, blitz_error: errorData });
    }

  } catch (error) {
    res.status(500).json({ result: false, message: 'Failed to add batch orders', error: error.message });
  }
});

router.post('/create-batch-with-driver', async (req, res) => {
  try {
    const { orders, driverId, driverName, driverPhone, business, city, serviceType, hubId, coordinates } = req.body;

    const credentials = await getBlitzCredentials(req);
    const accessToken = await loginToBlitz(credentials.username, credentials.password);
    tokenCache[credentials.username] = { token: accessToken, expiry: Date.now() + 60 * 60 * 1000 };

    const merchantOrderIds = orders.map(o => o.merchant_order_id);

    console.log(`Uploading all ${orders.length} orders to AdminPanel...`);
    const excelFile = await createExcelFromOrders(orders);

    try {
      await runAutomationScript(
        excelFile, business || 12, city || 9, serviceType || 2, hubId,
        credentials.username, credentials.password
      );
    } catch (uploadError) {
      return res.status(500).json({ success: false, message: 'Failed to upload orders', error: uploadError.message });
    }

    const recheckResult = await waitUntilOrdersAppearInBlitz(merchantOrderIds, accessToken, 5, 6000);

    if (!recheckResult.success) {
      return res.status(500).json({
        success: false,
        message: `Upload berhasil namun ${recheckResult.missing.length} order masih belum muncul di Blitz.`,
        missingOrders: recheckResult.missing
      });
    }

    const validateResponse = await axios.post(BLITZ_VALIDATE_BATCH_URL, {
      batchId: 0, hub_id: hubId, sequence_type: 1, merchant_order_ids: merchantOrderIds
    }, {
      headers: { 'Accept': 'application/json', 'Authorization': accessToken, 'Content-Type': 'application/json', 'bt': '2' },
      timeout: 30000
    });

    if (!validateResponse.data.result) {
      const validateErrors = validateResponse.data.data?.map(o =>
        `${o.merchant_order_id}: ${o.validation?.message || 'validation failed'}`
      ).join(', ');
      throw new Error(`Validation failed: ${validateErrors || 'Unknown error'}`);
    }

    let saveResponse;
    try {
      saveResponse = await axios.post('https://bmc.rideblitz.id/v1/save/batch/orders', {
        batchId: 0, hub_id: hubId, sequence_type: 1, merchant_order_ids: merchantOrderIds
      }, {
        headers: { 'Accept': 'application/json', 'Authorization': accessToken, 'Content-Type': 'application/json', 'bt': '2' },
        timeout: 30000
      });
    } catch (saveError) {
      const saveErrorData = saveError.response?.data;
      throw new Error(`Save batch failed: ${saveErrorData?.error?.message || saveErrorData?.message || saveError.message}`);
    }

    if (!saveResponse.data.result) {
      throw new Error(saveResponse.data.error?.message || saveResponse.data.message || 'Save batch failed');
    }

    const batchId = saveResponse.data.data.batch_id;

    const generateResponse = await axios.get(`${BLITZ_GENERATE_BATCH_URL}/${batchId}`, {
      headers: { 'Accept': 'application/json', 'Authorization': accessToken, 'bt': '2' },
      timeout: 30000
    });

    if (!generateResponse.data.result) {
      console.warn(`Generate returned false, continuing...`);
    }

    await new Promise(resolve => setTimeout(resolve, 2000));

    const lat = coordinates[0];
    const lon = coordinates[1];

    let assignResponse;
    try {
      assignResponse = await axios.post(BLITZ_ASSIGN_DRIVER_URL, {
        batch_id: parseInt(batchId), driver_id: parseInt(driverId),
        lat: parseFloat(lat), lng: parseFloat(lon), radius: '20km',
        allow_route_change: false, decline_batch_before_accept: false,
        accept_timer: 0, cancel_at_first_pickup: false, cancel_timer: 0
      }, {
        headers: { 'Accept': 'application/json', 'Authorization': accessToken, 'Content-Type': 'application/json', 'bt': '2' },
        timeout: 30000
      });
    } catch (assignError) {
      const assignErrorData = assignError.response?.data;
      throw new Error(`Driver assignment failed: ${assignErrorData?.error?.message || assignErrorData?.message || assignError.message}`);
    }

    if (!assignResponse.data.result) {
      throw new Error(assignResponse.data.error?.message || assignResponse.data.message || 'Driver assignment failed');
    }

    res.json({
      success: true, batchId,
      uploadedCount: orders.length,
      assignmentId: assignResponse.data.data.assignment_id,
      driverId: assignResponse.data.data.driver_id
    });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to create batch with driver', error: error.message });
  }
});

router.post('/remove-order-from-batch', async (req, res) => {
  try {
    const { batchId, merchantOrderId, orderId, project } = req.body;

    const validationData = await getValidationDataByMerchantOrderId(project, merchantOrderId);
    if (!validationData) {
      return res.status(400).json({
        success: false,
        message: `Validation data not found for order ${merchantOrderId}.`
      });
    }

    const hubId = validationData.business_hub;
    const accessToken = await getAccessToken(req);

    const validateResponse = await axios.post(
      `${BLITZ_REMOVE_VALIDATE_URL}/${batchId}`,
      { merchant_order_id: merchantOrderId },
      {
        headers: { 'Accept': 'application/json', 'Authorization': accessToken, 'Content-Type': 'application/json', 'bt': '2' },
        timeout: 30000
      }
    );

    if (validateResponse.status !== 200) throw new Error('Validation failed');

    const removeResponse = await axios.post(BLITZ_REMOVE_ORDER_URL, {
      sequence_type: 1, batch_id: batchId, merchant_order_ids: [merchantOrderId], hub_id: hubId
    }, {
      headers: { 'Accept': 'application/json', 'Authorization': accessToken, 'Content-Type': 'application/json', 'bt': '2' },
      timeout: 30000
    });

    if (removeResponse.status !== 200) throw new Error('Remove from Blitz failed');

    const collection = mongoose.connection.db.collection(`${project}_merchant_orders`);
    const objectId = new mongoose.Types.ObjectId(orderId);

    await collection.updateOne(
      { _id: objectId },
      {
        $set: {
          assigned_to_driver_id: null, assigned_to_driver_name: null,
          assigned_to_driver_phone: null, assigned_at: null,
          assignment_status: 'unassigned', batch_id: null
        }
      }
    );

    res.json({ success: true, message: 'Order removed successfully' });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to remove order from batch', error: error.message });
  }
});

router.post('/refresh-token', async (req, res) => {
  try {
    const credentials = await getBlitzCredentials(req);
    delete tokenCache[credentials.username];
    const accessToken = await loginToBlitz(credentials.username, credentials.password);
    tokenCache[credentials.username] = { token: accessToken, expiry: Date.now() + 60 * 60 * 1000 };
    res.json({ success: true, message: 'Token refreshed successfully', expiresIn: '1 hour' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to refresh token', error: error.message });
  }
});

router.post('/clear-cache', async (req, res) => {
  try {
    const credentials = await getBlitzCredentials(req);
    const cacheKey = credentials.username;
    if (tokenCache[cacheKey]) delete tokenCache[cacheKey];
    res.json({ success: true, message: `Token cache cleared for ${cacheKey}` });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to clear cache', error: error.message });
  }
});

module.exports = router;
