const mongoose = require("mongoose");

const phoneMessageSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    trim: true
  },
  message: {
    type: String,
    required: true
  },
  deliveryStatus: {
    type: String,
    enum: ["pending", "sent", "failed"],
    default: "pending",
    index: true
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

phoneMessageSchema.index({ deliveryStatus: 1 });

module.exports = mongoose.model("PhoneMessage", phoneMessageSchema);