const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');
const {
uploadTaskData,
getAllTaskData,
exportTaskData,
getTaskFilters,
deleteTaskData,
deleteAllTaskData,
deleteMultipleTaskData,
updateTaskData,
getTaskInfo,
getTaskById,
getUserRoles
} = require('../controllers/taskManagementController');

const {
getPerformanceAnalytics,
getUserPerformance,
getPerformanceSummary,
exportPerformanceReport,
generatePerformanceChart
} = require('../controllers/analyticsController');

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

const validateBatchTaskData = (req, res, next) => {
if (req.method === 'POST' && (req.url === '/upload' || req.url === '/')) {
console.log('Validating task batch data for upload');

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

const requiredFields = ['fullName'];
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

console.log(`Validation passed: ${req.body.length} task records with required fields`);
}

next();
};

const validateSingleTaskData = (req, res, next) => {
if (req.method === 'PUT' && req.url.includes('/data/')) {
console.log('Validating single task data for update');

if (!req.body || typeof req.body !== 'object') {
return res.status(400).json({
message: 'Invalid request: No data provided',
error: 'Request body with task data is required',
success: false
});
}

const requiredFields = ['fullName'];
const missingFields = requiredFields.filter(field => !req.body[field] || !req.body[field].toString().trim());

if (missingFields.length > 0) {
return res.status(400).json({
message: `Field wajib tidak boleh kosong: ${missingFields.join(', ')}`,
error: `Task data harus mengandung ${requiredFields.join(', ')} yang tidak kosong`,
success: false
});
}

console.log('Validation passed: Single task data with required fields');
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
message = 'Task data validation failed';
errorDetails = err.message;
} else if (err.name === 'CastError' && err.kind === 'ObjectId') {
statusCode = 400;
message = 'Invalid task ID';
errorDetails = 'Task ID format tidak valid';
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

router.post('/upload', authenticate, validateBatchTaskData, handleAsyncErrors(uploadTaskData));
router.post('/', authenticate, validateBatchTaskData, handleAsyncErrors(uploadTaskData));
router.post('/export', authenticate, handleAsyncErrors(exportTaskData));
router.get('/filters', authenticate, handleAsyncErrors(getTaskFilters));
router.get('/user-roles', authenticate, handleAsyncErrors(getUserRoles));
router.get('/data', authenticate, handleAsyncErrors(getAllTaskData));
router.get('/data/:id', authenticate, handleAsyncErrors(getTaskById));
router.get('/info', authenticate, handleAsyncErrors(getTaskInfo));
router.put('/data/:id', authenticate, validateSingleTaskData, handleAsyncErrors(updateTaskData));
router.delete('/data/bulk-delete', authenticate, validateBulkDelete, handleAsyncErrors(deleteMultipleTaskData));
router.delete('/data/:id', authenticate, handleAsyncErrors(deleteTaskData));
router.delete('/data', authenticate, handleAsyncErrors(deleteAllTaskData));
router.get('/analytics/performance', authenticate, handleAsyncErrors(getPerformanceAnalytics));
router.get('/analytics/user/:userName', authenticate, handleAsyncErrors(getUserPerformance));
router.get('/analytics/summary', authenticate, handleAsyncErrors(getPerformanceSummary));
router.post('/analytics/export', authenticate, handleAsyncErrors(exportPerformanceReport));
router.post('/analytics/generate-chart', authenticate, handleAsyncErrors(generatePerformanceChart));

router.use(handleErrors);

module.exports = router;