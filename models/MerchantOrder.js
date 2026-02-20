const mongoose = require('mongoose');

const merchantOrderSchema = new mongoose.Schema({
  merchant_order_id: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  weight: {
    type: Number,
    required: true,
    default: 0
  },
  width: {
    type: Number,
    default: 0
  },
  height: {
    type: Number,
    default: 0
  },
  length: {
    type: Number,
    default: 0
  },
  payment_type: {
    type: String,
    required: true,
    enum: ['cod', 'non_cod'],
    default: 'non_cod'
  },
  cod_amount: {
    type: Number,
    default: 0
  },
  sender_name: {
    type: String,
    required: true,
    trim: true
  },
  sender_phone: {
    type: String,
    required: true,
    trim: true
  },
  pickup_instructions: {
    type: String,
    trim: true,
    default: ''
  },
  consignee_name: {
    type: String,
    required: true,
    trim: true
  },
  consignee_phone: {
    type: String,
    required: true,
    trim: true
  },
  destination_district: {
    type: String,
    trim: true,
    default: ''
  },
  destination_city: {
    type: String,
    required: true,
    trim: true
  },
  destination_province: {
    type: String,
    trim: true,
    default: ''
  },
  destination_postalcode: {
    type: String,
    trim: true,
    default: ''
  },
  destination_address: {
    type: String,
    required: true,
    trim: true
  },
  dropoff_lat: {
    type: Number,
    default: 0
  },
  dropoff_long: {
    type: Number,
    default: 0
  },
  dropoff_instructions: {
    type: String,
    trim: true,
    default: ''
  },
  item_value: {
    type: Number,
    default: 0
  },
  product_details: {
    type: String,
    trim: true,
    default: ''
  },
  assigned_to_driver_id: {
    type: String,
    trim: true,
    default: null
  },
  assigned_to_driver_name: {
    type: String,
    trim: true,
    default: null
  },
  assigned_to_driver_phone: {
    type: String,
    trim: true,
    default: null
  },
  assigned_at: {
    type: Date,
    default: null
  },
  assignment_status: {
    type: String,
    enum: ['unassigned', 'assigned', 'in_progress', 'completed', 'cancelled'],
    default: 'unassigned'
  }
}, {
  timestamps: true
});

merchantOrderSchema.index({ merchant_order_id: 1, sender_name: 1 });
merchantOrderSchema.index({ destination_city: 1 });
merchantOrderSchema.index({ payment_type: 1 });
merchantOrderSchema.index({ createdAt: -1 });
merchantOrderSchema.index({ assigned_to_driver_id: 1 });
merchantOrderSchema.index({ assignment_status: 1 });

module.exports = mongoose.model('MerchantOrder', merchantOrderSchema);