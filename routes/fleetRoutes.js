const express = require('express');
const router = express.Router();
const {
uploadFleetData,
getAllFleetData,
exportFleetData,
getFleetFilters,
getFleetDataByPlat,
deleteFleetData,
deleteAllFleetData,
deleteMultipleFleetData,
updateFleetData,
getFleetInfo
} = require('../controllers/fleetController');

const logRequest = (req, res, next) => {
const startTime = Date.now();
const requestId = `${req.method}_${req.originalUrl}_${Date.now()}`;

console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - Request ID: ${requestId}`);

if (req.body && typeof req.body === 'object') {
if (Array.isArray(req.body)) {
console.log(`Request body: Array with ${req.body.length} items`);
} else {
console.log(`Request body size: ${JSON.stringify(req.body).length} bytes`);
}
}

req.requestId = requestId;

res.on('finish', () => {
const duration = Date.now() - startTime;
console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms) - ID: ${requestId}`);
});

next();
};

const validateBatchFleetData = (req, res, next) => {
if (req.method === 'POST' && (req.url === '/upload' || req.url === '/')) {
console.log('Validating fleet batch data for upload');

if (!req.body) {
console.error('Validation failed: No request body');
return res.status(400).json({
message: 'Invalid request: No data provided',
error: 'Request body is required',
success: false
});
}

if (!Array.isArray(req.body)) {
console.error('Validation failed: Data is not an array');
console.error('Received data type:', typeof req.body);
return res.status(400).json({
message: 'Invalid data format: Expected array',
error: 'Data must be an array of objects',
received: typeof req.body,
success: false
});
}

if (req.body.length === 0) {
console.error('Validation failed: Empty data array');
return res.status(400).json({
message: 'Empty data array',
error: 'At least one record is required',
success: false
});
}

const requiredFields = ['name', 'vehNumb'];
const firstRecord = req.body[0];

if (!firstRecord || typeof firstRecord !== 'object') {
console.error('Validation failed: Invalid first record');
return res.status(400).json({
message: 'Invalid record format',
error: 'Each record must be an object',
success: false
});
}

const missingFields = requiredFields.filter(field => !firstRecord[field] || !firstRecord[field].toString().trim());

if (missingFields.length > 0) {
console.error(`Validation failed: Missing required fields: ${missingFields.join(', ')}`);
return res.status(400).json({
message: `Field wajib tidak boleh kosong: ${missingFields.join(', ')}`,
error: `Setiap record harus mengandung ${requiredFields.join(', ')} yang tidak kosong`,
firstRecord: firstRecord,
success: false
});
}

console.log(`Validation passed: ${req.body.length} fleet records with required fields`);
}

next();
};

const validateSingleFleetData = (req, res, next) => {
if (req.method === 'PUT' && req.url.includes('/data/')) {
console.log('Validating single fleet data for update');

if (!req.body || typeof req.body !== 'object') {
return res.status(400).json({
message: 'Invalid request: No data provided',
error: 'Request body with fleet data is required',
success: false
});
}

const requiredFields = ['name', 'vehNumb'];
const missingFields = requiredFields.filter(field => !req.body[field] || !req.body[field].toString().trim());

if (missingFields.length > 0) {
return res.status(400).json({
message: `Field wajib tidak boleh kosong: ${missingFields.join(', ')}`,
error: `Fleet data harus mengandung ${requiredFields.join(', ')} yang tidak kosong`,
success: false
});
}

console.log('Validation passed: Single fleet data with required fields');
}

next();
};

const validateBulkDelete = (req, res, next) => {
if (req.method === 'DELETE' && req.url === '/data/bulk-delete') {
console.log('Validating bulk delete request');

if (!req.body || !req.body.ids) {
return res.status(400).json({
message: 'Invalid request: No IDs provided',
error: 'Array of IDs is required for bulk delete',
success: false
});
}

if (!Array.isArray(req.body.ids) || req.body.ids.length === 0) {
return res.status(400).json({
message: 'Invalid data format: Expected non-empty array of IDs',
error: 'IDs must be provided as array',
success: false
});
}

console.log(`Validation passed: ${req.body.ids.length} IDs for bulk delete`);
}

next();
};

const handleAsyncErrors = (fn) => {
return (req, res, next) => {
Promise.resolve(fn(req, res, next)).catch(next);
};
};

const handleErrors = (err, req, res, next) => {
const errorId = `ERROR_${Date.now()}`;
const timestamp = new Date().toISOString();

console.error(`[${timestamp}] Error ID: ${errorId} in ${req.method} ${req.originalUrl}:`);
console.error(`Error message: ${err.message}`);
console.error(`Error stack: ${err.stack}`);

let statusCode = 500;
let message = 'Internal server error';
let errorDetails = process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong';

if (err.name === 'ValidationError') {
statusCode = 400;
message = 'Fleet data validation failed';
errorDetails = err.message;
} else if (err.name === 'CastError' && err.kind === 'ObjectId') {
statusCode = 400;
message = 'Invalid fleet ID';
errorDetails = 'Fleet ID format tidak valid';
} else if (err.name === 'MongoError' || err.name === 'MongoServerError') {
console.error('MongoDB Error Details:', {
code: err.code,
codeName: err.codeName,
keyPattern: err.keyPattern,
keyValue: err.keyValue
});

statusCode = 400;
message = 'Database operation failed';
errorDetails = 'Database operation error';
} else if (err.name === 'MongoTimeoutError') {
statusCode = 408;
message = 'Database timeout';
errorDetails = 'Operation took too long to complete';
} else if (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED') {
statusCode = 408;
message = 'Request timeout';
errorDetails = 'Operation took too long to complete';
}

res.status(statusCode).json({
message: message,
error: errorDetails,
errorId: errorId,
timestamp: timestamp,
success: false
});
};

router.use(logRequest);

router.post('/upload', validateBatchFleetData, handleAsyncErrors(uploadFleetData));

router.post('/', validateBatchFleetData, handleAsyncErrors(uploadFleetData));

router.post('/export', handleAsyncErrors(exportFleetData));

router.get('/data', handleAsyncErrors(getAllFleetData));

router.get('/filters', handleAsyncErrors(getFleetFilters));

router.get('/info', handleAsyncErrors(getFleetInfo));

router.put('/data/:id', validateSingleFleetData, handleAsyncErrors(updateFleetData));

router.delete('/data/bulk-delete', validateBulkDelete, handleAsyncErrors(deleteMultipleFleetData));

router.delete('/data/:id', handleAsyncErrors(deleteFleetData));

router.delete('/data', handleAsyncErrors(deleteAllFleetData));

router.get('/plat/:plat', handleAsyncErrors(getFleetDataByPlat));

router.use(handleErrors);

module.exports = router;