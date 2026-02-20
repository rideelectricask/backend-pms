const mongoose = require('mongoose');

const mitraExtendedSchema = new mongoose.Schema({
  driver_id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  name: {
    type: String,
    default: '',
    index: true
  },
  phone_number: {
    type: String,
    default: ''
  },
  city: {
    type: String,
    default: '',
    index: true
  },
  status: {
    type: String,
    default: '',
    index: true
  },
  attendance: {
    type: String,
    default: ''
  },
  otp: {
    type: String,
    default: ''
  },
  bank_info_provided: {
    type: Boolean,
    default: false,
    index: true
  },
  app_version_name: {
    type: String,
    default: ''
  },
  app_version_code: {
    type: String,
    default: ''
  },
  app_android_version: {
    type: String,
    default: ''
  },
  android_version: {
    type: String,
    default: ''
  },
  last_active: {
    type: String,
    default: ''
  },
  registered_at: {
    type: String,
    default: ''
  },
  hubs: {
    type: String,
    default: ''
  },
  businesses: {
    type: String,
    default: ''
  },
  reason: {
    type: String,
    default: '',
    index: true
  },
  nik: {
    type: String,
    default: '',
    index: true,
    sparse: true
  },
  lark_tanggal_keluar_unit: {
    type: String,
    default: ''
  },
  lark_nomor_plat: {
    type: String,
    default: ''
  },
  lark_merk_unit: {
    type: String,
    default: ''
  },
  lark_alamat: {
    type: String,
    default: ''
  },
  lark_tanggal_pengembalian_unit: {
    type: String,
    default: ''
  },
  lark_lama_pemakaian: {
    type: String,
    default: ''
  },
  lark_status: {
    type: String,
    default: '',
    index: true,
    sparse: true
  },
  lark_matched_at: {
    type: Date,
    default: null
  },
  vehicle: {
    type: String,
    default: ''
  },
  operating_division: {
    type: String,
    default: '',
    index: true,
    sparse: true
  },
  remark: {
    type: String,
    default: ''
  },
  date_photo: {
    type: Date,
    default: null
  },
  doc_photo: {
    type: String,
    default: ''
  },
  bank_name: {
    type: String,
    default: ''
  },
  bank_account_number: {
    type: String,
    default: ''
  },
  bank_account_holder: {
    type: String,
    default: ''
  },
  bank_detail_fetched_at: {
    type: Date,
    default: null
  },
  bank_detail_status: {
    type: String,
    enum: ['pending', 'success', 'failed', 'not_provided'],
    default: 'pending',
    index: true
  },
  bank_detail_error: {
    type: String,
    default: ''
  },
  current_lat: {
    type: Number,
    default: null
  },
  current_lon: {
    type: Number,
    default: null
  },
  sim_number: {
    type: String,
    default: ''
  },
  sim_expiry: {
    type: String,
    default: ''
  },
  hub_data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  business_data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  created_at: {
    type: Date,
    default: Date.now,
    index: true
  },
  updated_at: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

mitraExtendedSchema.index({ driver_id: 1 });
mitraExtendedSchema.index({ updated_at: -1 });
mitraExtendedSchema.index({ created_at: -1 });
mitraExtendedSchema.index({ status: 1, city: 1 });
mitraExtendedSchema.index({ bank_info_provided: 1, bank_detail_status: 1 });
mitraExtendedSchema.index({ nik: 1 }, { sparse: true });
mitraExtendedSchema.index({ operating_division: 1 }, { sparse: true });

mitraExtendedSchema.pre('save', function(next) {
  this.updated_at = new Date();
  next();
});

const MitraExtended = mongoose.model('MitraExtended', mitraExtendedSchema);

module.exports = MitraExtended;