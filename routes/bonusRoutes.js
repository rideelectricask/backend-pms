const express = require('express');
const router = express.Router();
const {
uploadBonusData,
appendBonusData,
getAllBonusData,
getBonusDataByHub,
deleteBonusData
} = require('../controllers/bonusController');

router.post('/upload', uploadBonusData);

router.post('/append', appendBonusData);

router.get('/data', getAllBonusData);

router.get('/hub/:hub', getBonusDataByHub);

router.delete('/data', deleteBonusData);

module.exports = router;