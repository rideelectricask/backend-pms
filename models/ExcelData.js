const mongoose = require("mongoose");

const calculateWeightMetrics = (weight) => {
const numericWeight = Number(weight) || 0;
const integerPart = Math.floor(numericWeight);
const decimalPart = numericWeight - integerPart;
const roundDown = numericWeight < 1 ? 0 : integerPart;
const roundUp = decimalPart > 0.30 ? integerPart + 1 : integerPart;
const weightDecimal = Number((numericWeight - roundDown).toFixed(2));
return { roundDown, roundUp, weightDecimal };
};

const calculateDistanceMetrics = (distance) => {
const distanceVal = Number(distance) || 0;
const integerPart = Math.floor(distanceVal);
const decimalPart = distanceVal - integerPart;
const roundDownDistance = distanceVal < 1 ? 0 : integerPart;
const roundUpDistance = decimalPart > 0.30 ? integerPart + 1 : integerPart;
return { roundDownDistance, roundUpDistance };
};

const DataSchema = new mongoose.Schema({
"Client Name": String,
"Project Name": String,
"Date": String,
"Drop Point": String,
"HUB": String,
"Order Code": {
type: String,
required: true
},
Weight: String,
RoundDown: Number,
RoundUp: Number,
WeightDecimal: Number,
Distance: Number,
"RoundDown Distance": Number,
"RoundUp Distance": Number,
"Payment Term": String,
"Cnee Name": String,
"Cnee Address 1": String,
"Cnee Address 2": String,
"Cnee Area": String,
lat_long: String,
"Location Expected": String,
"Additional Notes For Address": Number,
"Slot Time": String,
"Cnee Phone": String,
"Courier Code": String,
"Courier Name": String,
"Driver Phone": String,
"Receiver": String,
"Recipient Email": String,
"Items Name": String,
"Photo Delivery": String,
"Batch": String,
ETA: String,
"Receiving Date": String,
"Receiving Time": String,
"Delivery Start Date": String,
"Delivery Start Time": String,
"Pickup Done": String,
"DropOff Done": String,
"Delivery Start": String,
"Add Charge 1": String,
"Add Charge 2": Number,
"Cost": Number,
"Add Cost 1": Number,
"Add Cost 2": Number,
"Selling Price": Number,
"Zona": String,
"Total Pengiriman": Number,
"Unit": String,
"Delivery Status": {
type: String,
enum: ["ONTIME", "LATE", ""],
default: ""
}
}, {
timestamps: true,
strict: false
});

DataSchema.methods.calculateDeliveryStatus = function() {
if (!this["Receiving Time"] || !this.ETA || this.ETA === "INVALID" || this.ETA === "No valid time") {
return "";
}

const parseTime = (timeStr) => {
if (!timeStr || typeof timeStr !== "string") return null;
const cleanTime = timeStr.split(" ")[0];
const timeParts = cleanTime.split(":");
if (timeParts.length < 2) return null;
const hours = parseInt(timeParts[0], 10);
const minutes = parseInt(timeParts[1], 10);
if (isNaN(hours) || isNaN(minutes)) return null;
if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
return hours * 60 + minutes;
};

const receivingMinutes = parseTime(this["Receiving Time"]);
const etaMinutes = parseTime(this.ETA);

if (receivingMinutes === null || etaMinutes === null) {
return "";
}

return receivingMinutes <= etaMinutes ? "ONTIME" : "LATE";
};

DataSchema.pre('save', function(next) {
if (this.isModified('Receiving Time') || this.isModified('ETA')) {
this["Delivery Status"] = this.calculateDeliveryStatus();
}

if (this.isModified('Weight') && this.Weight) {
const weightMetrics = calculateWeightMetrics(this.Weight);
this.RoundDown = weightMetrics.roundDown;
this.RoundUp = weightMetrics.roundUp;
this.WeightDecimal = weightMetrics.weightDecimal;
}

if (this.isModified('Distance') && this.Distance !== null && this.Distance !== undefined) {
const distanceMetrics = calculateDistanceMetrics(this.Distance);
this["RoundDown Distance"] = distanceMetrics.roundDownDistance;
this["RoundUp Distance"] = distanceMetrics.roundUpDistance;
}

next();
});

DataSchema.pre('updateOne', function(next) {
const update = this.getUpdate();

if (update.$set) {
if (update.$set['Receiving Time'] || update.$set['ETA']) {
const doc = this.getOptions().document || {};
const receivingTime = update.$set['Receiving Time'] || doc['Receiving Time'];
const eta = update.$set['ETA'] || doc['ETA'];

if (receivingTime && eta) {
const tempDoc = { 
"Receiving Time": receivingTime, 
ETA: eta,
calculateDeliveryStatus: DataSchema.methods.calculateDeliveryStatus
};
update.$set["Delivery Status"] = tempDoc.calculateDeliveryStatus();
}
}

if (update.$set['Weight']) {
const weightMetrics = calculateWeightMetrics(update.$set['Weight']);
update.$set['RoundDown'] = weightMetrics.roundDown;
update.$set['RoundUp'] = weightMetrics.roundUp;
update.$set['WeightDecimal'] = weightMetrics.weightDecimal;
}

if (update.$set['Distance'] !== null && update.$set['Distance'] !== undefined) {
const distanceMetrics = calculateDistanceMetrics(update.$set['Distance']);
update.$set['RoundDown Distance'] = distanceMetrics.roundDownDistance;
update.$set['RoundUp Distance'] = distanceMetrics.roundUpDistance;
}
}

next();
});

DataSchema.pre('findOneAndUpdate', function(next) {
const update = this.getUpdate();

if (update.$set) {
if (update.$set['Receiving Time'] || update.$set['ETA']) {
const doc = this.getOptions().document || {};
const receivingTime = update.$set['Receiving Time'] || doc['Receiving Time'];
const eta = update.$set['ETA'] || doc['ETA'];

if (receivingTime && eta) {
const tempDoc = { 
"Receiving Time": receivingTime, 
ETA: eta,
calculateDeliveryStatus: DataSchema.methods.calculateDeliveryStatus
};
update.$set["Delivery Status"] = tempDoc.calculateDeliveryStatus();
}
}

if (update.$set['Weight']) {
const weightMetrics = calculateWeightMetrics(update.$set['Weight']);
update.$set['RoundDown'] = weightMetrics.roundDown;
update.$set['RoundUp'] = weightMetrics.roundUp;
update.$set['WeightDecimal'] = weightMetrics.weightDecimal;
}

if (update.$set['Distance'] !== null && update.$set['Distance'] !== undefined) {
const distanceMetrics = calculateDistanceMetrics(update.$set['Distance']);
update.$set['RoundDown Distance'] = distanceMetrics.roundDownDistance;
update.$set['RoundUp Distance'] = distanceMetrics.roundUpDistance;
}
}

next();
});

DataSchema.index({ "Client Name": 1, "Order Code": 1 }, { unique: true });
DataSchema.index({ "Order Code": 1 }, { unique: true });
DataSchema.index({ "Courier Code": 1 });
DataSchema.index({ "HUB": 1 });
DataSchema.index({ "Delivery Status": 1 });

module.exports = mongoose.model("ExcelData", DataSchema);