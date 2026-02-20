const mongoose = require('mongoose');

const merchantOrderSchema = new mongoose.Schema({
  merchant_order_id: { type: String, required: true, trim: true },
  weight: { type: Number, required: true, default: 0 },
  width: { type: Number, default: 0 },
  height: { type: Number, default: 0 },
  length: { type: Number, default: 0 },
  payment_type: { type: String, required: true, enum: ['cod', 'non_cod'], default: 'non_cod' },
  cod_amount: { type: Number, default: 0 },
  sender_name: { type: String, required: true, trim: true },
  sender_phone: { type: String, required: true, trim: true },
  pickup_instructions: { type: String, trim: true, default: '' },
  consignee_name: { type: String, required: true, trim: true },
  consignee_phone: { type: String, required: true, trim: true },
  destination_district: { type: String, trim: true, default: '' },
  destination_city: { type: String, required: true, trim: true },
  destination_province: { type: String, trim: true, default: '' },
  destination_postalcode: { type: String, trim: true, default: '' },
  destination_address: { type: String, required: true, trim: true },
  dropoff_lat: { type: Number, default: 0 },
  dropoff_long: { type: Number, default: 0 },
  dropoff_instructions: { type: String, trim: true, default: '' },
  item_value: { type: Number, default: 0 },
  product_details: { type: String, trim: true, default: '' },
  assigned_to_driver_id: { type: String, trim: true, default: null },
  assigned_to_driver_name: { type: String, trim: true, default: null },
  assigned_to_driver_phone: { type: String, trim: true, default: null },
  assigned_at: { type: Date, default: null },
  assignment_status: {
    type: String,
    enum: ['unassigned', 'assigned', 'created', 'in_progress', 'completed', 'cancelled'],
    default: 'unassigned'
  },
  batch_id: { type: Number, default: null }
}, { timestamps: true });

merchantOrderSchema.index({ merchant_order_id: 1 });
merchantOrderSchema.index({ destination_city: 1 });
merchantOrderSchema.index({ payment_type: 1 });
merchantOrderSchema.index({ assigned_to_driver_id: 1 });
merchantOrderSchema.index({ assignment_status: 1 });
merchantOrderSchema.index({ batch_id: 1 });
merchantOrderSchema.index({ sender_name: 1 });

const adminPanelValidationSchema = new mongoose.Schema({
  sender_name: { type: String, required: true, unique: true, trim: true },
  business: { type: Number, required: true },
  city: { type: Number, required: true },
  service_type: { type: Number, required: true },
  business_hub: { type: Number, required: true },
  location: {
    type: { type: String, enum: ['Point'], required: true },
    coordinates: { type: [Number], required: true }
  }
}, { timestamps: true });

adminPanelValidationSchema.index({ location: '2dsphere' });
adminPanelValidationSchema.index({ sender_name: 1 });

const getModel = (project) => {
  const collectionName = `${project}_merchant_orders`;
  if (mongoose.models[collectionName]) return mongoose.models[collectionName];
  return mongoose.model(collectionName, merchantOrderSchema, collectionName);
};

const getAdminPanelValidationModel = () => {
  const collectionName = 'adminpanel_validations';
  if (mongoose.models[collectionName]) return mongoose.models[collectionName];
  return mongoose.model(collectionName, adminPanelValidationSchema, collectionName);
};

const validateBlitzRequiredFields = (order) => {
  const errors = [];
  if (!order.merchant_order_id?.trim()) errors.push('merchant_order_id missing');
  if (!order.weight || order.weight <= 0) errors.push('weight must be greater than 0');
  if (!order.sender_name?.trim()) errors.push('sender_name missing');
  if (!order.sender_phone?.trim()) errors.push('sender_phone missing');
  if (!order.consignee_name?.trim()) errors.push('consignee_name missing');
  if (!order.consignee_phone?.trim()) errors.push('consignee_phone missing');
  if (!order.destination_city?.trim()) errors.push('destination_city missing');
  if (!order.destination_postalcode?.trim()) errors.push('destination_postalcode missing');
  if (!order.destination_address?.trim()) errors.push('destination_address missing');
  if (order.payment_type !== 'cod' && order.payment_type !== 'non_cod') errors.push('payment_type must be cod or non_cod');
  return errors;
};

const getDriverProjects = async (project, driverId) => {
  try {
    const collectionName = `${project}_delivery`;
    const collection = mongoose.connection.db.collection(collectionName);
    const driverData = await collection.findOne({ driver_id: driverId.toString() });
    if (!driverData || !Array.isArray(driverData.projects) || driverData.projects.length === 0) {
      return null;
    }
    return driverData.projects;
  } catch {
    return null;
  }
};

exports.uploadMerchantOrders = async (req, res) => {
  try {
    const { project } = req.params;
    const { data } = req.body;

    if (!data || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ success: false, message: 'No data provided or invalid format' });
    }

    const Model = getModel(project);
    const bulkOps = data.map(item => ({
      updateOne: {
        filter: { merchant_order_id: item.merchant_order_id },
        update: { $set: item },
        upsert: true
      }
    }));

    const result = await Model.bulkWrite(bulkOps);

    res.json({
      success: true,
      message: 'Merchant orders uploaded successfully',
      count: data.length,
      inserted: result.upsertedCount,
      updated: result.modifiedCount,
      collection: `${project}_merchant_orders`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to upload merchant orders', error: error.message });
  }
};

exports.getAllMerchantOrdersAdmin = async (req, res) => {
  try {
    const { project } = req.params;
    const Model = getModel(project);
    const data = await Model.find().sort({ createdAt: -1 });

    res.json({ success: true, count: data.length, data, collection: `${project}_merchant_orders` });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch merchant orders', error: error.message });
  }
};

exports.getAllMerchantOrders = async (req, res) => {
  try {
    const { project } = req.params;
    const { driver_id } = req.mitra;

    const Model = getModel(project);

    const driverProjects = await getDriverProjects(project, driver_id);

    let query = {};
    if (driverProjects && driverProjects.length > 0) {
      query = { sender_name: { $in: driverProjects } };
    }

    const data = await Model.find(query).sort({ createdAt: -1 });

    res.json({ success: true, count: data.length, data, collection: `${project}_merchant_orders` });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch merchant orders', error: error.message });
  }
};

exports.deleteAllMerchantOrders = async (req, res) => {
  try {
    const { project } = req.params;
    const Model = getModel(project);
    const result = await Model.deleteMany({});

    res.json({
      success: true,
      message: 'All merchant orders deleted successfully',
      deletedCount: result.deletedCount,
      collection: `${project}_merchant_orders`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete merchant orders', error: error.message });
  }
};

exports.getMerchantOrderById = async (req, res) => {
  try {
    const { project, id } = req.params;
    const Model = getModel(project);
    const data = await Model.findById(id);

    if (!data) return res.status(404).json({ success: false, message: 'Merchant order not found' });

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch merchant order', error: error.message });
  }
};

exports.updateMerchantOrder = async (req, res) => {
  try {
    const { project, id } = req.params;
    const updateData = req.body;
    const Model = getModel(project);

    const data = await Model.findByIdAndUpdate(id, { $set: updateData }, { new: true, runValidators: true });

    if (!data) return res.status(404).json({ success: false, message: 'Merchant order not found' });

    res.json({ success: true, message: 'Merchant order updated successfully', data });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update merchant order', error: error.message });
  }
};

exports.deleteMerchantOrder = async (req, res) => {
  try {
    const { project, id } = req.params;
    const Model = getModel(project);
    const data = await Model.findByIdAndDelete(id);

    if (!data) return res.status(404).json({ success: false, message: 'Merchant order not found' });

    res.json({ success: true, message: 'Merchant order deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete merchant order', error: error.message });
  }
};

exports.validateSender = async (req, res) => {
  try {
    const { project } = req.params;
    const { senderName } = req.body;

    if (!senderName) return res.status(400).json({ success: false, message: 'Sender name is required' });

    const ValidationModel = getAdminPanelValidationModel();
    const validation = await ValidationModel.findOne({ sender_name: senderName });

    if (!validation) {
      return res.status(404).json({
        success: false,
        message: `Sender "${senderName}" not registered in AdminPanel Validations`
      });
    }

    res.json({ success: true, message: 'Sender validated successfully', data: validation });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to validate sender', error: error.message });
  }
};

exports.validateMultipleSenders = async (req, res) => {
  try {
    const { project } = req.params;
    const { senderNames } = req.body;

    if (!senderNames || !Array.isArray(senderNames) || senderNames.length === 0) {
      return res.status(400).json({ success: false, message: 'senderNames array is required' });
    }

    const ValidationModel = getAdminPanelValidationModel();
    const uniqueSenderNames = [...new Set(senderNames)];

    const validationEntries = await ValidationModel.find({ sender_name: { $in: uniqueSenderNames } });
    const validationMap = {};
    validationEntries.forEach(entry => { validationMap[entry.sender_name] = entry; });

    const invalidSenders = uniqueSenderNames.filter(name => !validationMap[name]);

    if (invalidSenders.length > 0) {
      return res.status(404).json({
        success: false,
        message: `Sender berikut tidak terdaftar di AdminPanel Validations: ${invalidSenders.join(', ')}`,
        invalidSenders
      });
    }

    res.json({ success: true, message: 'All senders validated successfully', data: validationMap });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to validate senders', error: error.message });
  }
};

exports.assignWithBlitz = async (req, res) => {
  try {
    const { project } = req.params;
    const { orderIds, driverId, driverName, driverPhone, activeBatchId, validationData } = req.body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ success: false, message: 'No order IDs provided' });
    }

    if (!driverId || !driverName || !driverPhone) {
      return res.status(400).json({ success: false, message: 'Driver information incomplete' });
    }

    if (!validationData) {
      return res.status(400).json({ success: false, message: 'Validation data is required' });
    }

    const authorizationHeader = req.headers.authorization;

    const Model = getModel(project);
    const objectIds = orderIds.map(id => {
      try { return new mongoose.Types.ObjectId(id); }
      catch { return null; }
    }).filter(Boolean);

    const ordersToAssign = await Model.find({ _id: { $in: objectIds } });

    const invalidOrders = [];
    for (const order of ordersToAssign) {
      const errors = validateBlitzRequiredFields(order);
      if (errors.length > 0) invalidOrders.push({ merchantOrderId: order.merchant_order_id, errors });
    }

    if (invalidOrders.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot assign: ${invalidOrders.length} order(s) have missing or invalid required fields`,
        invalidOrders,
        suggestion: 'Please check and fix the order data before assigning.'
      });
    }

    const result = await Model.updateMany(
      { _id: { $in: objectIds } },
      {
        $set: {
          assigned_to_driver_id: driverId.toString(),
          assigned_to_driver_name: driverName,
          assigned_to_driver_phone: driverPhone,
          assigned_at: new Date(),
          assignment_status: 'assigned'
        }
      }
    );

    const axios = require('axios');

    const forwardHeaders = {
      'Content-Type': 'application/json',
      ...(authorizationHeader ? { Authorization: authorizationHeader } : {})
    };

    if (activeBatchId) {
      const merchantOrderIds = ordersToAssign.map(o => o.merchant_order_id);

      try {
        const validateResponse = await axios.post(
          'http://localhost:5000/api/blitz-proxy/validate-batch-orders',
          { sequenceType: 1, batchId: activeBatchId, merchantOrderIds, hubId: validationData.business_hub },
          { headers: forwardHeaders, timeout: 60000 }
        );

        if (!validateResponse.data.result) throw new Error('Validation failed');

        const addResponse = await axios.post(
          'http://localhost:5000/api/blitz-proxy/add-batch-orders',
          { sequenceType: 1, batchId: activeBatchId, merchantOrderIds, hubId: validationData.business_hub },
          { headers: forwardHeaders, timeout: 60000 }
        );

        if (addResponse.data.result) {
          await Model.updateMany(
            { _id: { $in: objectIds } },
            { $set: { batch_id: activeBatchId, assignment_status: 'in_progress' } }
          );

          return res.json({
            success: true,
            message: `Successfully added ${ordersToAssign.length} orders to existing batch`,
            assignedCount: ordersToAssign.length,
            batchId: activeBatchId,
            addedToExistingBatch: true,
            blitzSynced: true,
            driverInfo: {
              driverId,
              driverName,
              assignmentId: addResponse.data.data?.assignment?.id
            }
          });
        }
      } catch (addError) {
        console.error('Failed to add to existing batch:', addError.message);
      }
    }

    try {
      const createBatchResponse = await axios.post(
        'http://localhost:5000/api/blitz-proxy/create-batch-with-driver',
        {
          orders: ordersToAssign,
          driverId,
          driverName,
          driverPhone,
          business: validationData.business,
          city: validationData.city,
          serviceType: validationData.service_type,
          hubId: validationData.business_hub,
          coordinates: validationData.location.coordinates
        },
        { headers: forwardHeaders, timeout: 180000 }
      );

      if (createBatchResponse.data.success) {
        const batchId = createBatchResponse.data.batchId;

        await Model.updateMany(
          { _id: { $in: objectIds } },
          { $set: { batch_id: batchId, assignment_status: 'in_progress' } }
        );

        return res.json({
          success: true,
          message: `Successfully created batch and assigned ${ordersToAssign.length} orders`,
          assignedCount: ordersToAssign.length,
          batchId,
          blitzSynced: true,
          uploaded: createBatchResponse.data.uploaded || false,
          uploadedCount: createBatchResponse.data.uploadedCount || 0,
          driverInfo: {
            driverId,
            driverName,
            assignmentId: createBatchResponse.data.assignmentId
          }
        });
      }

      throw new Error(createBatchResponse.data.message || 'Batch creation failed');
    } catch (blitzError) {
      return res.status(500).json({
        success: false,
        message: 'Orders assigned in PMS but Blitz integration failed',
        error: blitzError.response?.data?.message || blitzError.message,
        assignedCount: result.modifiedCount
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to assign orders', error: error.message });
  }
};

exports.unassignOrder = async (req, res) => {
  try {
    const { project, orderId } = req.params;
    const Model = getModel(project);

    const result = await Model.findByIdAndUpdate(
      orderId,
      {
        $set: {
          assigned_to_driver_id: null,
          assigned_to_driver_name: null,
          assigned_to_driver_phone: null,
          assigned_at: null,
          assignment_status: 'unassigned',
          batch_id: null
        }
      },
      { new: true }
    );

    if (!result) return res.status(404).json({ success: false, message: 'Order not found' });

    res.json({ success: true, message: 'Order unassigned successfully', data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to unassign order', error: error.message });
  }
};