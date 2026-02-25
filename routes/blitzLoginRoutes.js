const express = require('express');
const router = express.Router();
const blitzLoginController = require('../controllers/blitzLoginController.js');

router.get('/all', blitzLoginController.getAllBlitzLogins);
router.get('/by-driver/:driverId', blitzLoginController.getBlitzLoginByDriverId);
router.get('/by-user/:userId', blitzLoginController.getBlitzLoginByUserId);
router.post('/create', blitzLoginController.createBlitzLogin);
router.put('/update/:userId', blitzLoginController.updateBlitzLogin);
router.delete('/delete/:userId', blitzLoginController.deleteBlitzLogin);

module.exports = router;