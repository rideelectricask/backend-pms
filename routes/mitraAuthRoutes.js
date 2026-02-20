const express = require('express');
const router = express.Router();
const { mitraLogin, mitraLogout, verifyMitraToken } = require('../controllers/mitraAuthController');
const { authenticateMitra } = require('../middleware/mitraAuthMiddleware');

router.post('/login', mitraLogin);
router.post('/logout', authenticateMitra, mitraLogout);
router.get('/verify', authenticateMitra, verifyMitraToken);

module.exports = router;