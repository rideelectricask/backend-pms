const express = require('express');
const router = express.Router();
const deliveryController = require('../controllers/deliveryController.js');

router.post('/:project/upload', deliveryController.uploadData);
router.get('/:project/all', deliveryController.getAllData);
router.delete('/:project/all', deliveryController.deleteAllData);
router.get('/:project/:id', deliveryController.getDataById);
router.put('/:project/:id', deliveryController.updateData);
router.delete('/:project/:id', deliveryController.deleteData);

module.exports = router;