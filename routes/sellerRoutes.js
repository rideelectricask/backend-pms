const express = require('express');
const router = express.Router();
const sellerController = require('../controllers/sellerController');

router.post('/upload', sellerController.uploadSellers);
router.get('/data', sellerController.getAllSellers);
router.put('/data/:id', sellerController.updateSeller);
router.delete('/data/:id', sellerController.deleteSeller);
router.delete('/data/bulk-delete', sellerController.bulkDeleteSellers);

module.exports = router;