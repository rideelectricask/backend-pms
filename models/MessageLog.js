const mongoose = require("mongoose");

const messageLogSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  normalizedPhone: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  message: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ["pending", "success", "failed"],
    default: "pending",
    index: true
  },
  attempts: {
    type: Number,
    default: 0
  },
  lastAttemptAt: {
    type: Date
  },
  successAt: {
    type: Date
  },
  errorMessage: {
    type: String
  },
  errorCode: {
    type: String
  },
  isWhatsAppRegistered: {
    type: Boolean
  },
  batchId: {
    type: String,
    required: true,
    index: true
  },
  wahaResponse: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  wahaMessageId: {
    type: String,
    default: null
  },
  actualDeliveryStatus: {
    type: String,
    default: null
  }
}, {
  timestamps: true,
  strict: false
});

messageLogSchema.index({ batchId: 1, status: 1 });
messageLogSchema.index({ normalizedPhone: 1, status: 1 });
messageLogSchema.index({ phone: 1, batchId: 1 });

module.exports = mongoose.model("MessageLog", messageLogSchema);