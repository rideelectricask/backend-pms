const mongoose = require("mongoose");

const DriverSchema = new mongoose.Schema({
username: String,
fullName: String,
courierId: String,
hubLocation: String,
askor: String,
fee: String,
unit: String,
business: String
});

module.exports = mongoose.model("Driver", DriverSchema);