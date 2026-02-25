const ShipmentPerformance = require("../models/ShipmentPerformance");
const cacheWarmer = require("../services/cacheWarmer");

const validateShipmentData = (dataArray) => {
  if (!Array.isArray(dataArray) || dataArray.length === 0) {
    throw new Error("Data shipment kosong atau tidak valid.");
  }

  const requiredField = 'mitra_name';

  dataArray.forEach((item, index) => {
    if (!item[requiredField] || String(item[requiredField]).trim() === '') {
      throw new Error(`Baris ${index + 2}: Field '${requiredField}' wajib diisi`);
    }
  });
};

const sanitizeShipmentData = (dataArray) => {
  return dataArray.map(item => ({
    client_name: String(item.client_name || '').trim() || '-',
    project_name: String(item.project_name || '').trim() || '-',
    delivery_date: String(item.delivery_date || '').trim() || '-',
    drop_point: String(item.drop_point || '').trim() || '-',
    hub: String(item.hub || '').trim() || '-',
    order_code: String(item.order_code || '').trim() || '-',
    weight: String(item.weight || '').trim() || '-',
    distance_km: String(item.distance_km || '').trim() || '-',
    mitra_code: String(item.mitra_code || '').trim() || '-',
    mitra_name: String(item.mitra_name || '').trim(),
    receiving_date: String(item.receiving_date || '').trim() || '-',
    vehicle_type: String(item.vehicle_type || '').trim() || '-',
    cost: String(item.cost || '').trim() || '-',
    sla: String(item.sla || '').trim() || '-',
    weekly: String(item.weekly || '').trim() || '-'
  }));
};

const uploadShipmentData = async (req, res) => {
  try {
    const dataArray = req.body;
    const replaceAll = req.headers['x-replace-data'] === 'true';

    validateShipmentData(dataArray);
    const sanitizedData = sanitizeShipmentData(dataArray);

    console.log(`Processing ${sanitizedData.length} shipment records for upload (replaceAll: ${replaceAll})`);

    if (replaceAll) {
      await ShipmentPerformance.deleteMany({});
      console.log("Data shipment lama dihapus");
    }

    const inserted = await ShipmentPerformance.insertMany(sanitizedData, { ordered: false });
    console.log(`Data shipment disimpan: ${inserted.length} records`);

    setImmediate(() => {
      cacheWarmer.forceRefresh('shipmentData');
      cacheWarmer.forceRefresh('shipmentStats');
      cacheWarmer.forceRefresh('shipmentFilters');
      cacheWarmer.forceRefresh('availableYears');
    });

    res.status(201).json({
      message: `Data shipment berhasil disimpan: ${inserted.length} records`,
      data: inserted,
      summary: {
        totalRecords: inserted.length,
        success: true
      },
      success: true
    });
  } catch (error) {
    console.error("Shipment upload error:", error.message);

    const statusCode = error.message.includes('wajib diisi') ? 400 : 500;

    res.status(statusCode).json({ 
      message: "Upload data shipment gagal", 
      error: error.message,
      success: false
    });
  }
};

const getAllShipments = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 10000), 10000);
    const search = req.query.search || '';
    const sortBy = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const year = req.query.year ? parseInt(req.query.year) : null;

    console.log(`📥 GET /api/shipment/data - Page: ${page}, Limit: ${limit}, Year: ${year || 'all'}, Search: "${search}"`);

    if (year && (isNaN(year) || year < 1900 || year > 2100)) {
      console.warn(`⚠️ Invalid year parameter: ${req.query.year}`);
      return res.status(400).json({
        message: "Invalid year parameter",
        error: "Year must be a valid number between 1900-2100",
        success: false
      });
    }

    let dataSource = null;
    let fromCache = false;

    if (year) {
      const cachedData = cacheWarmer.getCachedShipmentByYear(year);
      if (cachedData && Array.isArray(cachedData)) {
        dataSource = cachedData;
        fromCache = true;
        console.log(`✅ Using cached data for year ${year}: ${cachedData.length} records`);
      }
    }

    if (!dataSource || !Array.isArray(dataSource)) {
      console.log(`📊 Fetching from database (year: ${year || 'all'})...`);
      
      const skip = (page - 1) * limit;
      let query = {};
      
      if (year) {
        query.delivery_date = { $regex: `/${year}$` };
      }
      
      if (search) {
        const searchConditions = [
          { client_name: { $regex: search, $options: 'i' } },
          { project_name: { $regex: search, $options: 'i' } },
          { hub: { $regex: search, $options: 'i' } },
          { mitra_name: { $regex: search, $options: 'i' } },
          { order_code: { $regex: search, $options: 'i' } }
        ];
        
        if (query.delivery_date) {
          query.$and = [
            { delivery_date: query.delivery_date },
            { $or: searchConditions }
          ];
          delete query.delivery_date;
        } else {
          query.$or = searchConditions;
        }
      }

      const [data, totalCount] = await Promise.all([
        ShipmentPerformance.find(query)
          .select('client_name project_name delivery_date drop_point hub order_code weight distance_km mitra_code mitra_name receiving_date vehicle_type cost sla weekly')
          .sort({ [sortBy]: sortOrder })
          .skip(skip)
          .limit(limit)
          .lean()
          .maxTimeMS(180000)
          .exec(),
        ShipmentPerformance.countDocuments(query)
      ]);

      console.log(`✅ Database query complete: ${data.length} of ${totalCount} records`);

      return res.status(200).json({
        data: data,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
          totalRecords: totalCount,
          recordsPerPage: limit,
          hasNextPage: skip + data.length < totalCount,
          hasPrevPage: page > 1
        },
        success: true
      });
    }

    let filteredData = dataSource;

    if (search) {
      const searchLower = search.toLowerCase();
      filteredData = filteredData.filter(record => 
        (record.client_name && record.client_name.toLowerCase().includes(searchLower)) ||
        (record.project_name && record.project_name.toLowerCase().includes(searchLower)) ||
        (record.hub && record.hub.toLowerCase().includes(searchLower)) ||
        (record.mitra_name && record.mitra_name.toLowerCase().includes(searchLower)) ||
        (record.order_code && record.order_code.toLowerCase().includes(searchLower))
      );
    }

    filteredData.sort((a, b) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortOrder === 1 ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortOrder === 1 ? (aVal > bVal ? 1 : -1) : (aVal < bVal ? 1 : -1);
    });

    const totalCount = filteredData.length;
    const skip = (page - 1) * limit;
    const paginatedData = filteredData.slice(skip, skip + limit);

    console.log(`✅ Served from cache: ${paginatedData.length} of ${totalCount} records (filtered: ${search ? 'yes' : 'no'})`);

    res.status(200).json({
      data: paginatedData,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        totalRecords: totalCount,
        recordsPerPage: limit,
        hasNextPage: skip + paginatedData.length < totalCount,
        hasPrevPage: page > 1
      },
      meta: {
        fromCache: fromCache,
        year: year
      },
      success: true
    });

  } catch (err) {
    console.error("❌ Gagal ambil data shipment:", err.message);
    console.error("Stack trace:", err.stack);
    
    res.status(500).json({ 
      message: "Gagal ambil data shipment", 
      error: err.message,
      success: false
    });
  }
};

const getShipmentStats = async (req, res) => {
  try {
    console.log('📊 Fetching shipment statistics...');

    const cachedStats = cacheWarmer.getCachedData('shipmentStats');
    
    if (cachedStats) {
      console.log('✅ Served stats from cache');
      return res.status(200).json({
        data: cachedStats,
        success: true
      });
    }

    const stats = await ShipmentPerformance.aggregate([
      {
        $facet: {
          total: [{ $count: "count" }],
          uniqueClients: [
            { $match: { client_name: { $ne: '-' } } },
            { $group: { _id: "$client_name" } },
            { $count: "count" }
          ],
          uniqueProjects: [
            { $match: { project_name: { $ne: '-' } } },
            { $group: { _id: "$project_name" } },
            { $count: "count" }
          ],
          uniqueHubs: [
            { $match: { hub: { $ne: '-' } } },
            { $group: { _id: "$hub" } },
            { $count: "count" }
          ],
          uniqueMitras: [
            { $match: { mitra_name: { $ne: '-' } } },
            { $group: { _id: "$mitra_name" } },
            { $count: "count" }
          ],
          uniqueWeeks: [
            { $match: { weekly: { $ne: '-' } } },
            { $group: { _id: "$weekly" } },
            { $count: "count" }
          ]
        }
      }
    ]).allowDiskUse(true);

    const result = {
      total: stats[0].total[0]?.count || 0,
      uniqueClients: stats[0].uniqueClients[0]?.count || 0,
      uniqueProjects: stats[0].uniqueProjects[0]?.count || 0,
      uniqueHubs: stats[0].uniqueHubs[0]?.count || 0,
      uniqueMitras: stats[0].uniqueMitras[0]?.count || 0,
      uniqueWeeks: stats[0].uniqueWeeks[0]?.count || 0
    };

    console.log('✅ Statistics fetched successfully');

    res.status(200).json({
      data: result,
      success: true
    });
  } catch (err) {
    console.error("❌ Gagal ambil statistik shipment:", err.message);
    res.status(500).json({ 
      message: "Gagal ambil statistik shipment", 
      error: err.message,
      success: false
    });
  }
};

const getShipmentFilters = async (req, res) => {
  try {
    console.log('📊 Fetching shipment filter options...');

    const cachedFilters = cacheWarmer.getCachedData('shipmentFilters');
    
    if (cachedFilters) {
      console.log('✅ Served filters from cache');
      return res.status(200).json({
        data: cachedFilters,
        success: true
      });
    }

    const filters = await ShipmentPerformance.aggregate([
      {
        $facet: {
          clients: [
            { $match: { client_name: { $ne: '-', $exists: true } } },
            { $group: { _id: "$client_name" } },
            { $sort: { _id: 1 } },
            { $limit: 100 }
          ],
          projects: [
            { $match: { project_name: { $ne: '-', $exists: true } } },
            { $group: { _id: "$project_name" } },
            { $sort: { _id: 1 } },
            { $limit: 100 }
          ],
          hubs: [
            { $match: { hub: { $ne: '-', $exists: true } } },
            { $group: { _id: "$hub" } },
            { $sort: { _id: 1 } },
            { $limit: 100 }
          ],
          vehicleTypes: [
            { $match: { vehicle_type: { $ne: '-', $exists: true } } },
            { $group: { _id: "$vehicle_type" } },
            { $sort: { _id: 1 } },
            { $limit: 50 }
          ],
          slas: [
            { $match: { sla: { $ne: '-', $exists: true } } },
            { $group: { _id: "$sla" } },
            { $sort: { _id: 1 } }
          ],
          weeklys: [
            { $match: { weekly: { $ne: '-', $exists: true } } },
            { $group: { _id: "$weekly" } },
            { $sort: { _id: 1 } },
            { $limit: 100 }
          ]
        }
      }
    ]).allowDiskUse(true);

    const result = {
      client_name: filters[0].clients.map(f => f._id),
      project_name: filters[0].projects.map(f => f._id),
      hub: filters[0].hubs.map(f => f._id),
      vehicle_type: filters[0].vehicleTypes.map(f => f._id),
      sla: filters[0].slas.map(f => f._id),
      weekly: filters[0].weeklys.map(f => f._id)
    };

    console.log('✅ Filter options fetched successfully');

    res.status(200).json({
      data: result,
      success: true
    });
  } catch (err) {
    console.error("❌ Gagal ambil filter options:", err.message);
    res.status(500).json({ 
      message: "Gagal ambil filter options", 
      error: err.message,
      success: false
    });
  }
};

const getAvailableYears = async (req, res) => {
  try {
    console.log('📊 Fetching available years from shipment data...');

    const cachedYears = cacheWarmer.getCachedData('availableYears');
    
    if (cachedYears && Array.isArray(cachedYears) && cachedYears.length > 0) {
      console.log('✅ Served years from cache:', cachedYears);
      return res.status(200).json({
        data: cachedYears,
        success: true
      });
    }

    const years = await ShipmentPerformance.aggregate([
      {
        $match: {
          delivery_date: { $ne: '-', $exists: true }
        }
      },
      {
        $project: {
          year: {
            $toInt: {
              $arrayElemAt: [
                { $split: ["$delivery_date", "/"] },
                2
              ]
            }
          }
        }
      },
      {
        $match: {
          year: { $ne: null, $exists: true }
        }
      },
      {
        $group: {
          _id: "$year"
        }
      },
      {
        $sort: { _id: -1 }
      }
    ]).allowDiskUse(true);

    const availableYears = years.map(item => item._id).filter(year => year && !isNaN(year));

    console.log(`✅ Available years fetched: ${availableYears.join(', ')}`);

    res.status(200).json({
      data: availableYears,
      success: true
    });
  } catch (err) {
    console.error("❌ Gagal ambil available years:", err.message);
    res.status(500).json({ 
      message: "Gagal ambil available years", 
      error: err.message,
      success: false
    });
  }
};

const getProjectAnalysis = async (req, res) => {
  try {
    const { year, project, hub } = req.query;
    const filters = {};
    
    if (year) filters.year = year;
    if (project) filters.project = project;
    if (hub) filters.hub = hub;

    console.log('📊 Fetching project analysis data with filters:', filters);

    const data = await ShipmentPerformance.getProjectAnalysisData(filters);

    res.status(200).json({
      data: data,
      success: true
    });
  } catch (err) {
    console.error("❌ Gagal ambil project analysis:", err.message);
    res.status(500).json({ 
      message: "Gagal ambil project analysis", 
      error: err.message,
      success: false
    });
  }
};

const getProjectWeeklyAnalysis = async (req, res) => {
  try {
    const { year, project, hub } = req.query;
    const filters = {};
    
    if (year) filters.year = year;
    if (project) filters.project = project;
    if (hub) filters.hub = hub;

    console.log('📊 Fetching project weekly analysis with filters:', filters);

    const data = await ShipmentPerformance.getProjectWeeklyData(filters);

    res.status(200).json({
      data: data,
      success: true
    });
  } catch (err) {
    console.error("❌ Gagal ambil project weekly analysis:", err.message);
    res.status(500).json({ 
      message: "Gagal ambil project weekly analysis", 
      error: err.message,
      success: false
    });
  }
};

const getMitraAnalysis = async (req, res) => {
  try {
    const { year, client, hub, mitra } = req.query;
    const filters = {};
    
    if (year) filters.year = year;
    if (client) filters.client = client;
    if (hub) filters.hub = hub;
    if (mitra) filters.mitra = mitra;

    console.log('📊 Fetching mitra analysis data with filters:', filters);

    const data = await ShipmentPerformance.getMitraAnalysisData(filters);

    res.status(200).json({
      data: data,
      success: true
    });
  } catch (err) {
    console.error("❌ Gagal ambil mitra analysis:", err.message);
    res.status(500).json({ 
      message: "Gagal ambil mitra analysis", 
      error: err.message,
      success: false
    });
  }
};

const getMitraWeeklyAnalysis = async (req, res) => {
  try {
    const { year, client, hub, mitra } = req.query;
    const filters = {};
    
    if (year) filters.year = year;
    if (client) filters.client = client;
    if (hub) filters.hub = hub;
    if (mitra) filters.mitra = mitra;

    console.log('📊 Fetching mitra weekly analysis with filters:', filters);

    const data = await ShipmentPerformance.getMitraWeeklyData(filters);

    res.status(200).json({
      data: data,
      success: true
    });
  } catch (err) {
    console.error("❌ Gagal ambil mitra weekly analysis:", err.message);
    res.status(500).json({ 
      message: "Gagal ambil mitra weekly analysis", 
      error: err.message,
      success: false
    });
  }
};

const updateShipmentData = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    console.log(`🔄 Updating shipment ID: ${id}`);

    if (!id) {
      return res.status(400).json({
        message: "ID shipment tidak valid",
        error: "Shipment ID is required",
        success: false
      });
    }

    const sanitizedUpdate = {
      client_name: String(updateData.client_name || '').trim() || '-',
      project_name: String(updateData.project_name || '').trim() || '-',
      delivery_date: String(updateData.delivery_date || '').trim() || '-',
      drop_point: String(updateData.drop_point || '').trim() || '-',
      hub: String(updateData.hub || '').trim() || '-',
      order_code: String(updateData.order_code || '').trim() || '-',
      weight: String(updateData.weight || '').trim() || '-',
      distance_km: String(updateData.distance_km || '').trim() || '-',
      mitra_code: String(updateData.mitra_code || '').trim() || '-',
      mitra_name: String(updateData.mitra_name || '').trim(),
      receiving_date: String(updateData.receiving_date || '').trim() || '-',
      vehicle_type: String(updateData.vehicle_type || '').trim() || '-',
      cost: String(updateData.cost || '').trim() || '-',
      sla: String(updateData.sla || '').trim() || '-',
      weekly: String(updateData.weekly || '').trim() || '-',
      updatedAt: Date.now()
    };

    if (!sanitizedUpdate.mitra_name || sanitizedUpdate.mitra_name === '') {
      return res.status(400).json({
        message: "Field 'mitra_name' wajib diisi",
        error: "mitra_name is required",
        success: false
      });
    }

    const existingShipment = await ShipmentPerformance.findById(id).lean();
    if (!existingShipment) {
      console.warn(`⚠️ Shipment not found: ${id}`);
      return res.status(404).json({
        message: "Shipment tidak ditemukan",
        error: "Shipment with specified ID does not exist",
        success: false
      });
    }

    const updatedShipment = await ShipmentPerformance.findByIdAndUpdate(
      id,
      sanitizedUpdate,
      { new: true, runValidators: true }
    );

    console.log(`✅ Shipment updated: ${updatedShipment.mitra_name}`);

    setImmediate(() => {
      cacheWarmer.forceRefresh('shipmentData');
    });

    res.status(200).json({
      message: "Data shipment berhasil diperbarui",
      data: updatedShipment,
      success: true
    });
  } catch (error) {
    console.error("❌ Update shipment error:", error.message);

    if (error.name === 'CastError') {
      return res.status(400).json({
        message: "ID shipment tidak valid",
        error: "Invalid shipment ID format",
        success: false
      });
    }

    res.status(500).json({
      message: "Gagal memperbarui data shipment",
      error: error.message,
      success: false
    });
  }
};

const deleteShipmentData = async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`🗑️ Deleting shipment ID: ${id}`);

    if (!id) {
      return res.status(400).json({
        message: "ID shipment tidak valid",
        error: "Shipment ID is required",
        success: false
      });
    }

    const deletedShipment = await ShipmentPerformance.findByIdAndDelete(id);

    if (!deletedShipment) {
      console.warn(`⚠️ Shipment not found: ${id}`);
      return res.status(404).json({
        message: "Shipment tidak ditemukan",
        error: "Shipment with specified ID does not exist",
        success: false
      });
    }

    console.log(`✅ Shipment deleted: ${deletedShipment.mitra_name}`);

    setImmediate(() => {
      cacheWarmer.forceRefresh('shipmentData');
      cacheWarmer.forceRefresh('shipmentStats');
    });

    res.status(200).json({
      message: "Data shipment berhasil dihapus",
      data: deletedShipment,
      success: true
    });
  } catch (error) {
    console.error("❌ Delete shipment error:", error.message);

    if (error.name === 'CastError') {
      return res.status(400).json({
        message: "ID shipment tidak valid",
        error: "Invalid shipment ID format",
        success: false
      });
    }

    res.status(500).json({
      message: "Gagal menghapus data shipment",
      error: error.message,
      success: false
    });
  }
};

const deleteMultipleShipmentData = async (req, res) => {
  try {
    const { ids } = req.body;

    console.log(`🗑️ Bulk delete request for ${ids.length} shipments`);

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        message: "ID shipment tidak valid",
        error: "Array of shipment IDs is required",
        success: false
      });
    }

    const result = await ShipmentPerformance.deleteMany({ _id: { $in: ids } });

    console.log(`✅ Bulk delete completed: ${result.deletedCount} shipments deleted`);

    setImmediate(() => {
      cacheWarmer.forceRefresh('shipmentData');
      cacheWarmer.forceRefresh('shipmentStats');
    });

    res.status(200).json({
      message: `Berhasil menghapus ${result.deletedCount} data shipment`,
      deletedCount: result.deletedCount,
      success: true
    });
  } catch (error) {
    console.error("❌ Bulk delete shipment error:", error.message);

    res.status(500).json({
      message: "Gagal menghapus data shipment",
      error: error.message,
      success: false
    });
  }
};

module.exports = {
  uploadShipmentData,
  getAllShipments,
  getShipmentStats,
  getShipmentFilters,
  getAvailableYears,
  getProjectAnalysis,
  getProjectWeeklyAnalysis,
  getMitraAnalysis,
  getMitraWeeklyAnalysis,
  updateShipmentData,
  deleteShipmentData,
  deleteMultipleShipmentData
};