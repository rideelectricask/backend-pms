const mongoose = require("mongoose");

const MitraSchema = new mongoose.Schema({
  mitraId: String,
  username: String,
  fullName: String,
  phoneNumber: {
    type: String,
    required: true
  },
  unitName: String,
  assistantCoordinator: String,
  commissionFee: String,
  mitraStatus: String,
  city: String,
  attendance: String,
  otp: String,
  bankInfoProvided: String,
  appVersion: String,
  appVersionCode: String,
  appApiVersion: String,
  androidVersion: String,
  lastActive: String,
  createdAt: String,
  registeredAt: String,
  hubCategory: String,
  businessCategory: String
}, {
  timestamps: true
});

MitraSchema.index({ phoneNumber: 1 });
MitraSchema.index({ fullName: 1 });
MitraSchema.index({ mitraStatus: 1 });
MitraSchema.index({ city: 1 });
MitraSchema.index({ createdAt: -1 });
MitraSchema.index({ registeredAt: 1 });
MitraSchema.index({ hubCategory: 1 });
MitraSchema.index({ businessCategory: 1 });
MitraSchema.index({ mitraStatus: 1, city: 1 });
MitraSchema.index({ fullName: 1, phoneNumber: 1 });

module.exports = mongoose.model("Mitra", MitraSchema);