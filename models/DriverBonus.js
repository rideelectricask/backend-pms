const mongoose = require('mongoose');

const DriverBonusSchema = new mongoose.Schema({
  hub: {
    type: String,
    required: true,
    trim: true
  },
  driverName: {
    type: String,
    required: true,
    trim: true
  },
  festiveBonus: {
    type: Number,
    default: 0
  },
  afterRekon: {
    type: Number,
    default: 0
  },
  addPersonal: {
    type: Number,
    default: 0
  },
  incentives: {
    type: Number,
    default: 0
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

DriverBonusSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('DriverBonus', DriverBonusSchema);