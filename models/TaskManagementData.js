const mongoose = require('mongoose');

const EditHistorySchema = new mongoose.Schema({
  fieldName: {
    type: String,
    required: true
  },
  oldValue: String,
  newValue: String,
  editedAt: {
    type: Date,
    default: Date.now
  },
  editedBy: String
}, { _id: false });

const TaskManagementDataSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  phoneNumber: {
    type: String,
    trim: true,
    default: '',
    unique: true,
    sparse: true,
    index: true
  },
  domicile: {
    type: String,
    trim: true,
    default: ''
  },
  city: {
    type: String,
    trim: true,
    default: '',
    index: true
  },
  project: {
    type: String,
    trim: true,
    default: '',
    index: true
  },
  user: {
    type: String,
    trim: true,
    default: '',
    index: true,
    set: v => v ? v.toLowerCase() : '',
    get: v => v
  },
  note: {
    type: String,
    trim: true,
    default: ''
  },
  nik: {
    type: String,
    trim: true,
    default: '',
    index: true
  },
  replyRecord: {
    type: String,
    enum: ['', 'Invited', 'Changed Mind', 'No Responses', '-'],
    default: ''
  },
  finalStatus: {
    type: String,
    enum: ['', 'Eligible', 'Not Eligible (Changed Project)', 'Not Eligible (Cancel)', '-'],
    default: ''
  },
  date: {
    type: Date,
    default: Date.now,
    index: true
  },
  replyRecordHistory: [EditHistorySchema],
  finalStatusHistory: [EditHistorySchema],
  editHistory: [EditHistorySchema],
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  toJSON: { getters: true },
  toObject: { getters: true }
});

TaskManagementDataSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  
  if (this.phoneNumber === '') {
    this.phoneNumber = undefined;
  }
  
  if (this.user) {
    this.user = this.user.toLowerCase();
  }
  
  next();
});

TaskManagementDataSchema.index({ fullName: 1 });
TaskManagementDataSchema.index({ phoneNumber: 1 });
TaskManagementDataSchema.index({ city: 1 });
TaskManagementDataSchema.index({ project: 1 });
TaskManagementDataSchema.index({ user: 1 });
TaskManagementDataSchema.index({ nik: 1 });
TaskManagementDataSchema.index({ replyRecord: 1 });
TaskManagementDataSchema.index({ finalStatus: 1 });
TaskManagementDataSchema.index({ date: -1 });
TaskManagementDataSchema.index({ createdAt: -1 });

TaskManagementDataSchema.index({ 
  fullName: 'text', 
  phoneNumber: 'text',
  domicile: 'text',
  city: 'text',
  project: 'text',
  user: 'text',
  note: 'text',
  nik: 'text'
});

TaskManagementDataSchema.index({ city: 1, project: 1 });
TaskManagementDataSchema.index({ user: 1, project: 1 });
TaskManagementDataSchema.index({ createdAt: -1, city: 1 });
TaskManagementDataSchema.index({ date: -1, city: 1 });

module.exports = mongoose.model('TaskManagementData', TaskManagementDataSchema);