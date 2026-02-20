const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_MITRA_SECRET || 'pms-mitra-secret-key-2025';
const JWT_EXPIRES_IN = '7d';

const getDriverCollection = (project) => {
  return mongoose.connection.db.collection(`${project}_delivery`);
};

const getBlitzLoginCollection = () => {
  return mongoose.connection.db.collection('blitz_logins');
};

exports.mitraLogin = async (req, res) => {
  try {
    const { driver_id, driver_phone, project } = req.body;

    if (!driver_id || !driver_phone) {
      return res.status(400).json({
        success: false,
        message: 'Driver ID and phone number are required'
      });
    }

    if (!project) {
      return res.status(400).json({
        success: false,
        message: 'Project selection is required'
      });
    }

    const validProjects = ['jne', 'mup', 'indomaret', 'unilever', 'wings'];
    if (!validProjects.includes(project)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid project selected'
      });
    }

    const deliveryCollection = getDriverCollection(project);

    const driver = await deliveryCollection.findOne({
      driver_id: driver_id.toString(),
      driver_phone: driver_phone.toString()
    });

    if (!driver) {
      return res.status(401).json({
        success: false,
        message: 'Invalid driver ID or phone number'
      });
    }

    const userId = driver.user_id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User ID not configured for this driver'
      });
    }

    const blitzLoginCollection = getBlitzLoginCollection();

    console.log('==================================================');
    console.log('[LOGIN DEBUG] Project       :', project);
    console.log('[LOGIN DEBUG] Driver ID     :', driver.driver_id);
    console.log('[LOGIN DEBUG] Driver Name   :', driver.driver_name);
    console.log('[LOGIN DEBUG] Driver Phone  :', driver.driver_phone);
    console.log('[LOGIN DEBUG] user_id found :', userId);
    console.log('==================================================');

    const blitzCredentials = await blitzLoginCollection.findOne({
      user_id: userId,
      status: 'active'
    });

    if (!blitzCredentials) {
      console.log('[LOGIN DEBUG] ❌ No blitz_logins entry found for user_id:', userId);
      return res.status(401).json({
        success: false,
        message: 'Blitz login credentials not configured for this driver'
      });
    }

    console.log('[LOGIN DEBUG] ✅ blitz_logins entry found:');
    console.log('[LOGIN DEBUG]    user_id  :', blitzCredentials.user_id);
    console.log('[LOGIN DEBUG]    username :', blitzCredentials.username);
    console.log('[LOGIN DEBUG]    password :', blitzCredentials.password);
    console.log('==================================================');

    await blitzLoginCollection.updateOne(
      { user_id: userId },
      { $set: { last_login: new Date() } }
    );

    const token = jwt.sign(
      {
        driver_id: driver.driver_id,
        driver_name: driver.driver_name,
        driver_phone: driver.driver_phone,
        user_id: userId,
        blitz_username: blitzCredentials.username,
        blitz_password: blitzCredentials.password,
        project: project,
        type: 'mitra'
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      driver: {
        driver_id: driver.driver_id,
        driver_name: driver.driver_name,
        driver_phone: driver.driver_phone,
        driver_status: driver.driver_status,
        distance: driver.distance,
        lat: driver.lat,
        lon: driver.lon,
        project: project,
        user_id: userId,
        blitz_username: blitzCredentials.username,
        blitz_password: blitzCredentials.password
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
};

exports.mitraLogout = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Logout failed',
      error: error.message
    });
  }
};

exports.verifyMitraToken = async (req, res) => {
  try {
    const { driver_id, project, user_id, blitz_username, blitz_password } = req.mitra;

    const deliveryCollection = getDriverCollection(project);
    const driver = await deliveryCollection.findOne({
      driver_id: driver_id.toString()
    });

    if (!driver) {
      return res.status(403).json({
        success: false,
        message: 'Driver not found'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Token is valid',
      driver: {
        driver_id: driver.driver_id,
        driver_name: driver.driver_name,
        driver_phone: driver.driver_phone,
        driver_status: driver.driver_status,
        distance: driver.distance,
        lat: driver.lat,
        lon: driver.lon,
        project: project,
        user_id: user_id,
        blitz_username: blitz_username,
        blitz_password: blitz_password
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Token verification failed',
      error: error.message
    });
  }
};