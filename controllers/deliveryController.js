const mongoose = require('mongoose');

const deliverySchema = new mongoose.Schema({
  user_id: {
    type: String,
    required: true,
    trim: true
  },
  driver_id: {
    type: String,
    required: true,
    trim: true
  },
  driver_name: {
    type: String,
    required: true,
    trim: true
  },
  driver_phone: {
    type: String,
    required: true,
    trim: true
  }
}, {
  timestamps: true
});

deliverySchema.index({ user_id: 1, driver_id: 1 }, { unique: true });
deliverySchema.index({ driver_id: 1 });

const getModel = (project) => {
  const collectionName = `${project}_delivery`;
  
  if (mongoose.models[collectionName]) {
    return mongoose.models[collectionName];
  }
  
  return mongoose.model(collectionName, deliverySchema, collectionName);
};

exports.uploadData = async (req, res) => {
  try {
    const { project } = req.params;
    const { data } = req.body;

    if (!data || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No data provided or invalid format'
      });
    }

    const Model = getModel(project);

    const bulkOps = data.map(item => {
      const cleanItem = {
        user_id: item.user_id,
        driver_id: item.driver_id,
        driver_name: item.driver_name,
        driver_phone: item.driver_phone
      };

      return {
        updateOne: {
          filter: { user_id: item.user_id, driver_id: item.driver_id },
          update: { $set: cleanItem },
          upsert: true
        }
      };
    });

    const result = await Model.bulkWrite(bulkOps);

    res.json({
      success: true,
      message: 'Data uploaded successfully',
      count: data.length,
      inserted: result.upsertedCount,
      updated: result.modifiedCount
    });

  } catch (error) {
    console.error('Upload data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload data',
      error: error.message
    });
  }
};

exports.getAllData = async (req, res) => {
  try {
    const { project } = req.params;
    const Model = getModel(project);
    
    const data = await Model.find().sort({ driver_id: 1 });

    res.json({
      success: true,
      count: data.length,
      data
    });

  } catch (error) {
    console.error('Get all data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch data',
      error: error.message
    });
  }
};

exports.deleteAllData = async (req, res) => {
  try {
    const { project } = req.params;
    const Model = getModel(project);
    
    const result = await Model.deleteMany({});

    res.json({
      success: true,
      message: 'All data deleted successfully',
      deletedCount: result.deletedCount
    });

  } catch (error) {
    console.error('Delete all data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete data',
      error: error.message
    });
  }
};

exports.getDataById = async (req, res) => {
  try {
    const { project, id } = req.params;
    const Model = getModel(project);
    
    const data = await Model.findById(id);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Data not found'
      });
    }

    res.json({
      success: true,
      data
    });

  } catch (error) {
    console.error('Get data by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch data',
      error: error.message
    });
  }
};

exports.updateData = async (req, res) => {
  try {
    const { project, id } = req.params;
    const updateData = req.body;
    const Model = getModel(project);

    const cleanUpdateData = {
      user_id: updateData.user_id,
      driver_id: updateData.driver_id,
      driver_name: updateData.driver_name,
      driver_phone: updateData.driver_phone
    };

    Object.keys(cleanUpdateData).forEach(key => 
      cleanUpdateData[key] === undefined && delete cleanUpdateData[key]
    );

    const data = await Model.findByIdAndUpdate(
      id,
      { $set: cleanUpdateData },
      { new: true, runValidators: true }
    );

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Data not found'
      });
    }

    res.json({
      success: true,
      message: 'Data updated successfully',
      data
    });

  } catch (error) {
    console.error('Update data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update data',
      error: error.message
    });
  }
};

exports.deleteData = async (req, res) => {
  try {
    const { project, id } = req.params;
    const Model = getModel(project);
    
    const data = await Model.findByIdAndDelete(id);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Data not found'
      });
    }

    res.json({
      success: true,
      message: 'Data deleted successfully'
    });

  } catch (error) {
    console.error('Delete data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete data',
      error: error.message
    });
  }
};