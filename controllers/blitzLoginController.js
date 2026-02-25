const mongoose = require('mongoose');

const blitzLoginSchema = new mongoose.Schema({
  user_id: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  username: {
    type: String,
    required: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    trim: true
  },
  role: {
    type: String,
    default: 'fleet',
    trim: true
  },
  last_login: {
    type: Date,
    default: null
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  timestamps: true
});

blitzLoginSchema.index({ user_id: 1 });
blitzLoginSchema.index({ username: 1 });
blitzLoginSchema.index({ status: 1 });

const BlitzLogin = mongoose.model('BlitzLogin', blitzLoginSchema, 'blitz_logins');

exports.getAllBlitzLogins = async (req, res) => {
  try {
    const logins = await BlitzLogin.find({ status: 'active' }).sort({ updatedAt: -1 });

    res.json({
      success: true,
      count: logins.length,
      data: logins
    });

  } catch (error) {
    console.error('Get all blitz logins error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch blitz logins',
      error: error.message
    });
  }
};

exports.getBlitzLoginByDriverId = async (req, res) => {
  try {
    const { driverId } = req.params;
    const { project } = req.query;

    if (!project) {
      return res.status(400).json({
        success: false,
        message: 'Project parameter is required'
      });
    }

    const deliveryCollectionName = `${project}_delivery`;
    const DeliveryModel = mongoose.model(
      deliveryCollectionName,
      new mongoose.Schema({}, { strict: false }),
      deliveryCollectionName
    );

    const driverData = await DeliveryModel.findOne({ driver_id: driverId.toString() });

    if (!driverData) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found in delivery collection'
      });
    }

    const userId = driverData.user_id;

    if (!userId) {
      return res.status(404).json({
        success: false,
        message: 'User ID not found for this driver'
      });
    }

    const blitzLogin = await BlitzLogin.findOne({ user_id: userId, status: 'active' });

    if (!blitzLogin) {
      return res.status(404).json({
        success: false,
        message: 'Blitz login credentials not found for this user'
      });
    }

    res.json({
      success: true,
      data: {
        user_id: blitzLogin.user_id,
        username: blitzLogin.username,
        password: blitzLogin.password,
        email: blitzLogin.email,
        role: blitzLogin.role,
        driver_id: driverId,
        driver_name: driverData.driver_name,
        driver_phone: driverData.driver_phone
      }
    });

  } catch (error) {
    console.error('Get blitz login by driver ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch blitz login',
      error: error.message
    });
  }
};

exports.getBlitzLoginByUserId = async (req, res) => {
  try {
    const { userId } = req.params;

    const blitzLogin = await BlitzLogin.findOne({ user_id: userId, status: 'active' });

    if (!blitzLogin) {
      return res.status(404).json({
        success: false,
        message: 'Blitz login not found'
      });
    }

    res.json({
      success: true,
      data: blitzLogin
    });

  } catch (error) {
    console.error('Get blitz login by user ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch blitz login',
      error: error.message
    });
  }
};

exports.createBlitzLogin = async (req, res) => {
  try {
    const { user_id, username, password, email, role, status } = req.body;

    if (!user_id || !username || !password || !email) {
      return res.status(400).json({
        success: false,
        message: 'user_id, username, password, and email are required'
      });
    }

    const existingLogin = await BlitzLogin.findOne({ user_id });

    if (existingLogin) {
      return res.status(409).json({
        success: false,
        message: 'Blitz login already exists for this user_id'
      });
    }

    const newLogin = new BlitzLogin({
      user_id,
      username,
      password,
      email,
      role: role || 'fleet',
      status: status || 'active'
    });

    await newLogin.save();

    res.status(201).json({
      success: true,
      message: 'Blitz login created successfully',
      data: newLogin
    });

  } catch (error) {
    console.error('Create blitz login error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create blitz login',
      error: error.message
    });
  }
};

exports.updateBlitzLogin = async (req, res) => {
  try {
    const { userId } = req.params;
    const updateData = req.body;

    const blitzLogin = await BlitzLogin.findOneAndUpdate(
      { user_id: userId },
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!blitzLogin) {
      return res.status(404).json({
        success: false,
        message: 'Blitz login not found'
      });
    }

    res.json({
      success: true,
      message: 'Blitz login updated successfully',
      data: blitzLogin
    });

  } catch (error) {
    console.error('Update blitz login error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update blitz login',
      error: error.message
    });
  }
};

exports.deleteBlitzLogin = async (req, res) => {
  try {
    const { userId } = req.params;

    const blitzLogin = await BlitzLogin.findOneAndUpdate(
      { user_id: userId },
      { $set: { status: 'inactive' } },
      { new: true }
    );

    if (!blitzLogin) {
      return res.status(404).json({
        success: false,
        message: 'Blitz login not found'
      });
    }

    res.json({
      success: true,
      message: 'Blitz login deleted successfully'
    });

  } catch (error) {
    console.error('Delete blitz login error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete blitz login',
      error: error.message
    });
  }
};