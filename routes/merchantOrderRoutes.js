const express = require('express');
const router = express.Router();
const merchantOrderController = require('../controllers/merchantOrderController');
const { authenticateMitra } = require('../middleware/mitraAuthMiddleware');

router.post('/:project/upload', merchantOrderController.uploadMerchantOrders);
router.get('/:project/all', merchantOrderController.getAllMerchantOrdersAdmin);
router.get('/:project/mitra/all', authenticateMitra, merchantOrderController.getAllMerchantOrders);
router.delete('/:project/all', merchantOrderController.deleteAllMerchantOrders);
router.post('/:project/validate-sender', merchantOrderController.validateSender);
router.post('/:project/validate-multiple-senders', merchantOrderController.validateMultipleSenders);
router.post('/:project/assign-with-blitz', authenticateMitra, merchantOrderController.assignWithBlitz);
router.get('/:project/:id', merchantOrderController.getMerchantOrderById);
router.put('/:project/:id', merchantOrderController.updateMerchantOrder);
router.delete('/:project/:id', merchantOrderController.deleteMerchantOrder);

module.exports = router;