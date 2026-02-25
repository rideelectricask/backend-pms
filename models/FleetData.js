const mongoose = require('mongoose');

const FleetDataSchema = new mongoose.Schema({
name: {
type: String,
required: true,
trim: true,
index: true
},
phoneNumber: {
type: String,
trim: true,
default: ''
},
status: {
type: String,
trim: true,
default: '',
index: true
},
molis: {
type: String,
trim: true,
default: ''
},
deductionAmount: {
type: String,
trim: true,
default: ''
},
statusSecond: {
type: String,
trim: true,
default: ''
},
project: {
type: String,
trim: true,
default: '',
index: true
},
distribusi: {
type: String,
trim: true,
default: ''
},
rushHour: {
type: String,
trim: true,
default: ''
},
vehNumb: {
type: String,
required: true,
trim: true,
uppercase: true,
index: true
},
type: {
type: String,
trim: true,
default: '',
index: true
},
notes: {
type: String,
trim: true,
default: ''
},
createdAt: {
type: Date,
default: Date.now,
index: true
},
updatedAt: {
type: Date,
default: Date.now
}
});

FleetDataSchema.pre('save', function(next) {
this.updatedAt = Date.now();
next();
});

FleetDataSchema.index({ vehNumb: 1 });
FleetDataSchema.index({ name: 1 });
FleetDataSchema.index({ status: 1 });
FleetDataSchema.index({ project: 1 });
FleetDataSchema.index({ type: 1 });
FleetDataSchema.index({ createdAt: -1 });

FleetDataSchema.index({ 
name: 'text', 
vehNumb: 'text', 
project: 'text',
type: 'text',
molis: 'text',
distribusi: 'text',
phoneNumber: 'text'
});

FleetDataSchema.index({ status: 1, project: 1 });
FleetDataSchema.index({ project: 1, type: 1 });
FleetDataSchema.index({ createdAt: -1, status: 1 });

module.exports = mongoose.model('FleetData', FleetDataSchema);