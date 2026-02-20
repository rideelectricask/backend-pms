const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/authMiddleware');
const {
  getExtendedDataByDriverId,
  getBulkMitraExtendedData,
  createOrUpdateExtendedData,
  deleteExtendedData,
  manualSyncController,
  cancelSyncEndpoint
} = require('../controllers/mitraExtendedController');

router.get('/extended/bulk-all', getBulkMitraExtendedData);
router.post('/extended/manual-sync', authenticate, authorize('owner'), manualSyncController);
router.post('/extended/cancel-sync', authenticate, authorize('owner'), cancelSyncEndpoint);
router.get('/extended/:driver_id', getExtendedDataByDriverId);
router.put('/extended/:driver_id', createOrUpdateExtendedData);
router.delete('/extended/:driver_id', deleteExtendedData);

module.exports = router;