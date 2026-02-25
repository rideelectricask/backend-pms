const express = require('express');
const router = express.Router();
const { login, logout, verifyToken } = require('../controllers/loginController');
const { authenticate } = require('../middleware/authMiddleware');

router.post('/login', login);
router.post('/logout', authenticate, logout);
router.get('/verify', authenticate, verifyToken);

module.exports = router;