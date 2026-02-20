const Seller = require('../models/Seller');

const checkDuplicates = async (sellersData) => {
  const duplicates = {
    inPayload: [],
    inDatabase: [],
    total: 0
  };

  const seenInPayload = {
    sellerId: new Map(),
    emailIseller: new Map(),
    noKtp: new Map(),
    noTelepon: new Map()
  };

  sellersData.forEach((seller, index) => {
    const row = index + 2;
    const duplicateFields = [];

    if (seller.sellerId && seller.sellerId.trim() !== '') {
      if (seenInPayload.sellerId.has(seller.sellerId)) {
        duplicateFields.push('sellerId');
      } else {
        seenInPayload.sellerId.set(seller.sellerId, row);
      }
    }

    if (seller.emailIseller && seller.emailIseller.trim() !== '') {
      if (seenInPayload.emailIseller.has(seller.emailIseller)) {
        duplicateFields.push('emailIseller');
      } else {
        seenInPayload.emailIseller.set(seller.emailIseller, row);
      }
    }

    if (seller.noKtp && seller.noKtp.trim() !== '') {
      if (seenInPayload.noKtp.has(seller.noKtp)) {
        duplicateFields.push('noKtp');
      } else {
        seenInPayload.noKtp.set(seller.noKtp, row);
      }
    }

    if (seller.noTelepon && seller.noTelepon.trim() !== '') {
      if (seenInPayload.noTelepon.has(seller.noTelepon)) {
        duplicateFields.push('noTelepon');
      } else {
        seenInPayload.noTelepon.set(seller.noTelepon, row);
      }
    }

    if (duplicateFields.length > 0) {
      duplicates.inPayload.push({
        row,
        data: seller,
        duplicateFields
      });
    }
  });

  const sellerIds = sellersData.map(s => s.sellerId).filter(id => id && id.trim() !== '');
  const emailIsellers = sellersData.map(s => s.emailIseller).filter(email => email && email.trim() !== '');
  const noKtps = sellersData.map(s => s.noKtp).filter(ktp => ktp && ktp.trim() !== '');
  const noTelepons = sellersData.map(s => s.noTelepon).filter(telp => telp && telp.trim() !== '');

  const queryConditions = [];
  if (sellerIds.length > 0) queryConditions.push({ sellerId: { $in: sellerIds } });
  if (emailIsellers.length > 0) queryConditions.push({ emailIseller: { $in: emailIsellers } });
  if (noKtps.length > 0) queryConditions.push({ noKtp: { $in: noKtps } });
  if (noTelepons.length > 0) queryConditions.push({ noTelepon: { $in: noTelepons } });

  if (queryConditions.length === 0) {
    duplicates.total = duplicates.inPayload.length;
    return duplicates;
  }

  const existingSellers = await Seller.find({ $or: queryConditions });

  const existingMap = {
    sellerId: new Map(existingSellers.filter(s => s.sellerId).map(s => [s.sellerId, s])),
    emailIseller: new Map(existingSellers.filter(s => s.emailIseller).map(s => [s.emailIseller, s])),
    noKtp: new Map(existingSellers.filter(s => s.noKtp).map(s => [s.noKtp, s])),
    noTelepon: new Map(existingSellers.filter(s => s.noTelepon).map(s => [s.noTelepon, s]))
  };

  sellersData.forEach((seller, index) => {
    const row = index + 2;
    const duplicateFields = [];

    if (seller.sellerId && seller.sellerId.trim() !== '' && existingMap.sellerId.has(seller.sellerId)) {
      duplicateFields.push('sellerId');
    }
    if (seller.emailIseller && seller.emailIseller.trim() !== '' && existingMap.emailIseller.has(seller.emailIseller)) {
      duplicateFields.push('emailIseller');
    }
    if (seller.noKtp && seller.noKtp.trim() !== '' && existingMap.noKtp.has(seller.noKtp)) {
      duplicateFields.push('noKtp');
    }
    if (seller.noTelepon && seller.noTelepon.trim() !== '' && existingMap.noTelepon.has(seller.noTelepon)) {
      duplicateFields.push('noTelepon');
    }

    if (duplicateFields.length > 0) {
      duplicates.inDatabase.push({
        row,
        data: seller,
        duplicateFields
      });
    }
  });

  duplicates.total = duplicates.inPayload.length + duplicates.inDatabase.length;

  return duplicates;
};

exports.uploadSellers = async (req, res) => {
  try {
    const sellersData = req.body;

    if (!Array.isArray(sellersData) || sellersData.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No seller data provided'
      });
    }

    const invalidRows = [];
    sellersData.forEach((seller, index) => {
      if (!seller.nama || seller.nama.trim() === '') {
        invalidRows.push(index + 2);
      }
    });

    if (invalidRows.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Field 'Nama' is required. Missing at rows: ${invalidRows.join(', ')}`
      });
    }

    const duplicates = await checkDuplicates(sellersData);

    if (duplicates.total > 0) {
      return res.status(409).json({
        success: false,
        message: `Found ${duplicates.total} duplicate entries`,
        duplicates
      });
    }

    const result = await Seller.insertMany(sellersData, { ordered: false });

    res.status(201).json({
      success: true,
      message: `Successfully uploaded ${result.length} seller records`,
      data: result
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload seller data',
      error: error.message
    });
  }
};

exports.getAllSellers = async (req, res) => {
  try {
    const sellers = await Seller.find().sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      data: sellers
    });
  } catch (error) {
    console.error('Fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch seller data',
      error: error.message
    });
  }
};

exports.updateSeller = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    if (!updateData.nama || updateData.nama.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Field Nama is required'
      });
    }

    const existingSeller = await Seller.findById(id);
    if (!existingSeller) {
      return res.status(404).json({
        success: false,
        message: 'Seller not found'
      });
    }

    const duplicateConditions = [];
    if (updateData.sellerId && updateData.sellerId.trim() !== '') {
      duplicateConditions.push({ sellerId: updateData.sellerId });
    }
    if (updateData.emailIseller && updateData.emailIseller.trim() !== '') {
      duplicateConditions.push({ emailIseller: updateData.emailIseller });
    }
    if (updateData.noKtp && updateData.noKtp.trim() !== '') {
      duplicateConditions.push({ noKtp: updateData.noKtp });
    }
    if (updateData.noTelepon && updateData.noTelepon.trim() !== '') {
      duplicateConditions.push({ noTelepon: updateData.noTelepon });
    }

    if (duplicateConditions.length > 0) {
      const duplicateCheck = await Seller.findOne({
        _id: { $ne: id },
        $or: duplicateConditions
      });

      if (duplicateCheck) {
        const duplicateFields = [];
        if (updateData.sellerId && duplicateCheck.sellerId === updateData.sellerId) {
          duplicateFields.push('sellerId');
        }
        if (updateData.emailIseller && duplicateCheck.emailIseller === updateData.emailIseller) {
          duplicateFields.push('emailIseller');
        }
        if (updateData.noKtp && duplicateCheck.noKtp === updateData.noKtp) {
          duplicateFields.push('noKtp');
        }
        if (updateData.noTelepon && duplicateCheck.noTelepon === updateData.noTelepon) {
          duplicateFields.push('noTelepon');
        }

        return res.status(409).json({
          success: false,
          message: `Duplicate found in fields: ${duplicateFields.join(', ')}`
        });
      }
    }

    const updatedSeller = await Seller.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true
    });

    res.status(200).json({
      success: true,
      message: 'Seller updated successfully',
      data: updatedSeller
    });
  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update seller',
      error: error.message
    });
  }
};

exports.deleteSeller = async (req, res) => {
  try {
    const { id } = req.params;

    const seller = await Seller.findByIdAndDelete(id);
    if (!seller) {
      return res.status(404).json({
        success: false,
        message: 'Seller not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Seller deleted successfully'
    });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete seller',
      error: error.message
    });
  }
};

exports.bulkDeleteSellers = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No seller IDs provided'
      });
    }

    const result = await Seller.deleteMany({ _id: { $in: ids } });

    res.status(200).json({
      success: true,
      message: `Successfully deleted ${result.deletedCount} sellers`
    });
  } catch (error) {
    console.error('Bulk delete error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete sellers',
      error: error.message
    });
  }
};