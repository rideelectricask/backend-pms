const express = require('express');
const router = express.Router();
const blitzSyncController = require('../controllers/blitzSyncController');

router.post('/sync', blitzSyncController.syncToBlitz);
router.post('/assign-driver', blitzSyncController.assignDriverToExistingBatch);
router.get('/status', blitzSyncController.syncStatus);

module.exports = router;