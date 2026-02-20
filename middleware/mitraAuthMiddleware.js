const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_MITRA_SECRET || 'pms-mitra-secret-key-2025';

const authenticateMitra = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.type !== 'mitra') {
      return res.status(403).json({
        success: false,
        message: 'Invalid token type'
      });
    }

    req.mitra = {
      driver_id: decoded.driver_id,
      driver_name: decoded.driver_name,
      driver_phone: decoded.driver_phone,
      project: decoded.project,
      user_id: decoded.user_id,
      blitz_username: decoded.blitz_username,
      blitz_password: decoded.blitz_password
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Authentication failed',
      error: error.message
    });
  }
};

module.exports = { authenticateMitra };