const mongoose = require('mongoose');

const sellerSchema = new mongoose.Schema({
  joinDate: {
    type: String,
    trim: true
  },
  resignDate: {
    type: String,
    trim: true
  },
  sellerId: {
    type: String,
    trim: true,
    sparse: true,
    index: true
  },
  password: {
    type: String,
    trim: true
  },
  emailIseller: {
    type: String,
    trim: true,
    lowercase: true,
    sparse: true,
    index: true
  },
  nama: {
    type: String,
    required: [true, 'Nama is required'],
    trim: true
  },
  noKtp: {
    type: String,
    trim: true,
    sparse: true,
    index: true
  },
  noTelepon: {
    type: String,
    trim: true,
    sparse: true,
    index: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  namaOutlet: {
    type: String,
    trim: true
  },
  reason: {
    type: String,
    trim: true
  },
  status: {
    type: String,
    trim: true,
    default: 'Active'
  },
  remark: {
    type: String,
    trim: true
  },
  motorPribadi: {
    type: String,
    trim: true
  },
  client: {
    type: String,
    trim: true
  },
  tanggalMundur: {
    type: String,
    trim: true
  },
  alasanMundur: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

sellerSchema.index({ sellerId: 1 }, { unique: true, sparse: true });
sellerSchema.index({ emailIseller: 1 }, { unique: true, sparse: true });
sellerSchema.index({ noKtp: 1 }, { unique: true, sparse: true });
sellerSchema.index({ noTelepon: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Seller', sellerSchema);