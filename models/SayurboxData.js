const mongoose = require('mongoose');

const SayurboxDataSchema = new mongoose.Schema({
  orderNo: {
    type: String,
    required: true,
    trim: true
  },
  timeSlot: {
    type: String,
    trim: true,
    default: ''
  },
  channel: {
    type: String,
    trim: true,
    default: ''
  },
  deliveryDate: {
    type: String,
    trim: true,
    default: ''
  },
  driverName: {
    type: String,
    required: true,
    trim: true
  },
  hubName: {
    type: String,
    required: true,
    trim: true
  },
  shippedAt: {
    type: String,
    trim: true,
    default: ''
  },
  deliveredAt: {
    type: String,
    trim: true,
    default: ''
  },
  puOrder: {
    type: String,
    trim: true,
    default: ''
  },
  timeSlotStart: {
    type: String,
    trim: true,
    default: ''
  },
  latePickupMinute: {
    type: Number,
    default: 0
  },
  puAfterTsMinute: {
    type: Number,
    default: 0
  },
  timeSlotEnd: {
    type: String,
    trim: true,
    default: ''
  },
  lateDeliveryMinute: {
    type: Number,
    default: 0
  },
  isOntime: {
    type: Boolean,
    default: false
  },
  distanceInKm: {
    type: Number,
    default: 0
  },
  totalWeightPerorder: {
    type: Number,
    default: 0
  },
  paymentMethod: {
    type: String,
    trim: true,
    default: ''
  },
  monthly: {
    type: String,
    trim: true,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

SayurboxDataSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

SayurboxDataSchema.index({ orderNo: 1, hubName: 1, driverName: 1 });
SayurboxDataSchema.index({ hubName: 1 });
SayurboxDataSchema.index({ driverName: 1 });
SayurboxDataSchema.index({ deliveryDate: 1 });

module.exports = mongoose.model('SayurboxData', SayurboxDataSchema);