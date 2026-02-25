const DriverBonus = require("../models/DriverBonus");

const uploadBonusData = async (req, res) => {
try {
const dataArray = req.body;

if (!Array.isArray(dataArray) || dataArray.length === 0) {
return res.status(400).json({ 
message: "Data bonus tidak valid atau kosong." 
});
}

console.log("Uploading driver bonus data...");

await DriverBonus.deleteMany({});
console.log("Data bonus lama dihapus");

const transformedData = dataArray.map(item => {
if (!item.hub || !item.driverName) {
throw new Error("Hub dan Driver Name wajib diisi");
}

return {
hub: item.hub,
driverName: item.driverName,
festiveBonus: item.festiveBonus || 0,
afterRekon: item.afterRekon || 0,
addPersonal: item.addPersonal || 0,
incentives: item.incentives || 0
};
});

const inserted = await DriverBonus.insertMany(transformedData);
console.log("Data bonus disimpan:", inserted.length);

res.status(201).json({
message: "Data bonus berhasil disimpan ke database",
count: inserted.length,
data: inserted
});

} catch (error) {
console.error("Upload bonus error:", error.message);
res.status(500).json({ 
message: "Upload data bonus gagal", 
error: error.message 
});
}
};

const appendBonusData = async (req, res) => {
try {
const dataArray = req.body;

if (!Array.isArray(dataArray) || dataArray.length === 0) {
return res.status(400).json({ 
message: "Data bonus tidak valid atau kosong." 
});
}

console.log("Appending driver bonus data...");

const transformedData = dataArray.map(item => {
if (!item.hub || !item.driverName) {
throw new Error("Hub dan Driver Name wajib diisi");
}

return {
hub: item.hub,
driverName: item.driverName,
festiveBonus: item.festiveBonus || 0,
afterRekon: item.afterRekon || 0,
addPersonal: item.addPersonal || 0,
incentives: item.incentives || 0
};
});

const bulkOps = transformedData.map(item => ({
updateOne: {
filter: { hub: item.hub, driverName: item.driverName },
update: { $set: item },
upsert: true
}
}));

const result = await DriverBonus.bulkWrite(bulkOps);
console.log("Data bonus appended:", result.upsertedCount + result.modifiedCount);

res.status(201).json({
message: "Data bonus berhasil ditambahkan ke database",
count: result.upsertedCount + result.modifiedCount,
upserted: result.upsertedCount,
modified: result.modifiedCount
});

} catch (error) {
console.error("Append bonus error:", error.message);
res.status(500).json({ 
message: "Append data bonus gagal", 
error: error.message 
});
}
};

const getAllBonusData = async (req, res) => {
try {
const data = await DriverBonus.find().sort({ hub: 1, driverName: 1 });

res.status(200).json({
message: "Data bonus berhasil diambil",
count: data.length,
data: data
});
} catch (error) {
console.error("Get bonus error:", error.message);
res.status(500).json({ 
message: "Gagal mengambil data bonus", 
error: error.message 
});
}
};

const getBonusDataByHub = async (req, res) => {
try {
const hub = req.params.hub;
console.log("Mencari data bonus untuk hub:", hub);

const data = await DriverBonus.find({
hub: { $regex: new RegExp(hub, "i") }
}).sort({ driverName: 1 });

console.log("Jumlah data bonus ditemukan:", data.length);

res.status(200).json({
message: `Data bonus untuk hub ${hub} berhasil diambil`,
count: data.length,
data: data
});
} catch (error) {
console.error("Get bonus by hub error:", error.message);
res.status(500).json({ 
message: "Gagal mengambil data bonus berdasarkan hub", 
error: error.message 
});
}
};

const deleteBonusData = async (req, res) => {
try {
const result = await DriverBonus.deleteMany({});

res.status(200).json({
message: "Semua data bonus berhasil dihapus",
deletedCount: result.deletedCount
});
} catch (error) {
console.error("Delete bonus error:", error.message);
res.status(500).json({ 
message: "Gagal menghapus data bonus", 
error: error.message 
});
}
};

module.exports = {
uploadBonusData,
appendBonusData,
getAllBonusData,
getBonusDataByHub,
deleteBonusData
};