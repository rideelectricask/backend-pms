const mongoose = require('mongoose');

const LoginDataSchema = new mongoose.Schema({
  user_id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    index: true
  },
  role: {
    type: String,
    enum: ['admin', 'user', 'developer', 'support', 'owner'],
    default: 'user',
    index: true
  },
  last_login: {
    type: Date,
    default: null
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active',
    index: true
  }
}, {
  timestamps: true,
  collection: 'logins'
});

LoginDataSchema.index({ username: 1 });
LoginDataSchema.index({ email: 1 });
LoginDataSchema.index({ user_id: 1 });
LoginDataSchema.index({ status: 1 });

module.exports = mongoose.model('LoginData', LoginDataSchema);