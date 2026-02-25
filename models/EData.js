const mongoose = require('mongoose');

const EDataSchema = new mongoose.Schema({
driverName: {
type: String,
trim: true,
default: ''
},
district: {
type: String,
trim: true,
default: ''
},
customerName: {
type: String,
trim: true,
default: ''
},
deliveryDate: {
type: String,
trim: true,
default: ''
},
address: {
type: String,
trim: true,
default: ''
},
addressNote: {
type: String,
trim: true,
default: ''
},
orderNo: {
type: String,
required: true,
trim: true
},
packagingOption: {
type: String,
trim: true,
default: ''
},
distanceInKm: {
type: Number,
required: true,
default: 0
},
hubs: {
type: String,
trim: true,
default: ''
},
totalPrice: {
type: Number,
default: 0
},
externalNote: {
type: String,
trim: true,
default: ''
},
internalNote: {
type: String,
trim: true,
default: ''
},
customerNote: {
type: String,
trim: true,
default: ''
},
timeSlot: {
type: String,
trim: true,
default: ''
},
noPlastic: {
type: String,
trim: true,
default: ''
},
paymentMethod: {
type: String,
trim: true,
default: ''
},
latitude: {
type: Number,
default: 0
},
longitude: {
type: Number,
default: 0
},
shippingNumber: {
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

EDataSchema.pre('save', function(next) {
this.updatedAt = Date.now();
next();
});

EDataSchema.index({ orderNo: 1, hubs: 1, driverName: 1 });
EDataSchema.index({ hubs: 1 });
EDataSchema.index({ driverName: 1 });
EDataSchema.index({ deliveryDate: 1 });

module.exports = mongoose.model('EData', EDataSchema);