const Mitra = require("../models/MitraModel");
const ShipmentPerformance = require("../models/ShipmentPerformance");
const cacheWarmer = require("../services/cacheWarmer");

const parseRegisteredAt = (dateString) => {
  if (!dateString || dateString.trim() === '' || dateString === '-') return null;

  const formats = [
    /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+(\d{1,2}):(\d{2})\s+(WIB|WITA|WIT)/i,
    /(\d{4})-(\d{2})-(\d{2})/,
    /(\d{2})\/(\d{2})\/(\d{4})/
  ];

  const monthMap = {
    jan: 0, januari: 0, january: 0,
    feb: 1, februari: 1, february: 1,
    mar: 2, maret: 2, march: 2,
    apr: 3, april: 3,
    mei: 4, may: 4,
    jun: 5, juni: 5, june: 5,
    jul: 6, juli: 6, july: 6,
    agu: 7, agustus: 7, august: 7, aug: 7,
    sep: 8, september: 8,
    okt: 9, oktober: 9, october: 9, oct: 9,
    nov: 10, november: 10,
    des: 11, desember: 11, december: 11, dec: 11
  };

  for (const format of formats) {
    const match = dateString.match(format);
    if (match) {
      if (format === formats[0]) {
        const day = parseInt(match[1]);
        const monthStr = match[2].toLowerCase();
        const year = parseInt(match[3]);
        const month = monthMap[monthStr];
        if (month !== undefined) {
          return new Date(year, month, day);
        }
      } else if (format === formats[1]) {
        return new Date(match[1], parseInt(match[2]) - 1, match[3]);
      } else if (format === formats[2]) {
        return new Date(match[3], parseInt(match[2]) - 1, match[1]);
      }
    }
  }

  const timestamp = Date.parse(dateString);
  return isNaN(timestamp) ? null : new Date(timestamp);
};

const findDuplicates = async (dataArray) => {
  const phoneNumberSet = new Set();
  const duplicatesInPayload = [];

  dataArray.forEach((item, index) => {
    const duplicateFields = [];

    if (item.phoneNumber && phoneNumberSet.has(item.phoneNumber.toLowerCase())) {
      duplicateFields.push('phoneNumber');
    } else if (item.phoneNumber) {
      phoneNumberSet.add(item.phoneNumber.toLowerCase());
    }

    if (duplicateFields.length > 0) {
      duplicatesInPayload.push({
        row: index + 2,
        data: item,
        duplicateFields
      });
    }
  });

  const phoneNumbers = dataArray.map(d => d.phoneNumber).filter(Boolean);

  const existingMitras = await Mitra.find({
    phoneNumber: { $in: phoneNumbers }
  }).select('phoneNumber').lean();

  const existingPhoneNumbers = new Set(existingMitras.map(d => d.phoneNumber?.toLowerCase()));

  const duplicatesInDB = [];

  dataArray.forEach((item, index) => {
    const duplicateFields = [];

    if (item.phoneNumber && existingPhoneNumbers.has(item.phoneNumber.toLowerCase())) {
      duplicateFields.push('phoneNumber');
    }

    if (duplicateFields.length > 0) {
      duplicatesInDB.push({
        row: index + 2,
        data: item,
        duplicateFields
      });
    }
  });

  return {
    duplicatesInPayload,
    duplicatesInDB,
    hasDuplicates: duplicatesInPayload.length > 0 || duplicatesInDB.length > 0
  };
};

const uploadMitraData = async (req, res) => {
  try {
    const dataArray = req.body;
    const replaceAll = req.headers['x-replace-data'] === 'true';

    if (!Array.isArray(dataArray) || dataArray.length === 0) {
      return res.status(400).json({ 
        message: "Data mitra kosong atau tidak valid.",
        success: false
      });
    }

    console.log(`Processing ${dataArray.length} mitra records for upload (replaceAll: ${replaceAll})`);

    const validationResult = await findDuplicates(dataArray);

    if (replaceAll) {
      await Mitra.deleteMany({});
      console.log("Data mitra lama dihapus");
    }

    const inserted = await Mitra.insertMany(dataArray, { ordered: false });
    console.log(`Data mitra disimpan: ${inserted.length} records`);

    cacheWarmer.forceRefresh('mitraData').catch(err => {
      console.warn('Failed to refresh mitra cache after upload:', err.message);
    });

    const response = {
      message: `Data mitra berhasil disimpan: ${inserted.length} records`,
      data: inserted,
      summary: {
        totalRecords: inserted.length,
        success: true
      },
      success: true
    };

    if (validationResult.hasDuplicates) {
      const totalDuplicates = validationResult.duplicatesInPayload.length + validationResult.duplicatesInDB.length;

      response.warning = {
        message: `Perhatian: Ditemukan ${totalDuplicates} data dengan phoneNumber duplikat`,
        duplicates: {
          inPayload: validationResult.duplicatesInPayload,
          inDatabase: validationResult.duplicatesInDB,
          total: totalDuplicates
        }
      };

      console.warn(`Duplicate warning: ${totalDuplicates} records with duplicate phoneNumber`);
    }

    res.status(201).json(response);
  } catch (error) {
    console.error("Mitra upload error:", error.message);
    res.status(500).json({ 
      message: "Upload data mitra gagal", 
      error: error.message,
      success: false
    });
  }
};

const getAllFullMitraPerformanceData = async (req, res) => {
  try {
    const { 
      periodType = 'monthly',
      startDate,
      endDate,
      clientName,
      projectName,
      hub,
      dropPoint
    } = req.query;

    console.log(`📊 Fetching ALL mitra performance - Period: ${periodType}, Filters:`, {
      dateRange: `${startDate || 'all'} - ${endDate || 'all'}`,
      clientName: clientName || 'all',
      projectName: projectName || 'all',
      hub: hub || 'all',
      dropPoint: dropPoint || 'all'
    });

    const filters = { periodType, startDate, endDate, clientName, projectName, hub, dropPoint };

    const [allMitras, trendsData, availableFilterOptions] = await Promise.all([
      ShipmentPerformance.getAllMitraPerformance(filters),
      generateTrendsData(periodType, startDate, endDate, { clientName, projectName, hub, dropPoint }),
      getAvailableFiltersForCombination({ clientName, projectName, hub, dropPoint, startDate, endDate })
    ]);

    const projectCount = await ShipmentPerformance.distinct("client_name", {});
    const hubCount = await ShipmentPerformance.distinct("hub", {});
    const dropPointCount = await ShipmentPerformance.distinct("drop_point", {});

    const enrichedMitras = allMitras.map((mitra, index) => ({
      rank: index + 1,
      id: mitra.mitraName.toLowerCase().replace(/\s+/g, '_'),
      name: mitra.mitraName,
      totalDeliveries: mitra.totalDeliveries,
      totalCost: mitra.totalCost,
      avgCost: mitra.avgCost,
      totalDistance: mitra.totalDistance,
      avgDistance: mitra.avgDistance,
      costPerKm: mitra.costPerKm,
      onTimeRate: mitra.onTimeRate,
      deliveryRate: mitra.deliveryRate,
      uniqueProjects: mitra.uniqueProjectCount,
      uniqueHubs: mitra.uniqueHubCount,
      uniqueDropPoints: mitra.uniqueDropPointCount,
      weekCount: mitra.weekCount,
      performanceScore: parseFloat(mitra.performanceScore.toFixed(2)),
      performanceLevel: getPerformanceLevel(mitra.performanceScore)
    }));

    const aggregatedData = {
      mitras: enrichedMitras,
      totalProjects: projectCount.filter(p => p && p !== '-').length,
      totalHubs: hubCount.filter(h => h && h !== '-').length,
      totalDropPoints: dropPointCount.filter(d => d && d !== '-').length,
      trends: trendsData,
      availableFilters: availableFilterOptions,
      appliedFilters: {
        periodType,
        startDate: startDate || null,
        endDate: endDate || null,
        clientName: clientName || null,
        projectName: projectName || null,
        hub: hub || null,
        dropPoint: dropPoint || null
      }
    };

    console.log(`✅ ALL mitra performance data generated: ${enrichedMitras.length} mitras with ${trendsData.length} trend periods`);

    res.status(200).json({
      message: "All mitra performance data retrieved successfully",
      data: aggregatedData,
      success: true
    });
  } catch (error) {
    console.error("❌ All mitra performance data error:", error.message);
    res.status(500).json({
      message: "Failed to fetch all mitra performance data",
      error: error.message,
      success: false
    });
  }
};

const getAllMitras = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 5000, 10000);
    const search = req.query.search || '';
    const sortBy = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

    console.log(`Fetching mitra data - Page: ${page}, Limit: ${limit}`);

    const skip = (page - 1) * limit;

    let query = {};
    if (search) {
      query = {
        $or: [
          { fullName: { $regex: search, $options: 'i' } },
          { phoneNumber: { $regex: search, $options: 'i' } },
          { city: { $regex: search, $options: 'i' } },
          { mitraStatus: { $regex: search, $options: 'i' } }
        ]
      };
    }

    const selectFields = 'fullName phoneNumber mitraStatus city registeredAt lastActive hubCategory businessCategory createdAt';

    const [data, totalCount] = await Promise.all([
      Mitra.find(query)
        .select(selectFields)
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean()
        .allowDiskUse(true)
        .maxTimeMS(30000),
      Mitra.countDocuments(query)
    ]);

    console.log(`Retrieved ${data.length} of ${totalCount} total mitra records`);

    res.status(200).json({
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
  } catch (err) {
    console.error("Gagal ambil data mitra:", err.message);
    res.status(500).json({ 
      message: "Gagal ambil data mitra", 
      error: err.message,
      success: false
    });
  }
};

const getAllMitrasForExport = async (req, res) => {
  try {
    console.log('Fetching all mitra data for export (using cache if available)');

    const cachedData = cacheWarmer.getCachedData('mitraData');

    if (cachedData && cachedData.length > 0) {
      console.log(`✅ Returning ${cachedData.length} cached mitra records`);
      return res.status(200).json({
        data: cachedData,
        summary: {
          totalRecords: cachedData.length,
          fromCache: true
        },
        success: true
      });
    }

    console.log('Cache miss, fetching from database...');

    const selectFields = 'fullName phoneNumber mitraStatus city registeredAt lastActive hubCategory businessCategory createdAt';

    const cursor = Mitra.find({})
      .select(selectFields)
      .sort({ createdAt: -1 })
      .lean()
      .allowDiskUse(true)
      .cursor();

    const data = [];
    let count = 0;

    for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
      data.push(doc);
      count++;
      
      if (count % 1000 === 0) {
        console.log(`Streamed ${count} mitra records...`);
      }
    }

    console.log(`Retrieved ${data.length} total mitra records for export`);

    res.status(200).json({
      data: data,
      summary: {
        totalRecords: data.length,
        fromCache: false
      },
      success: true
    });
  } catch (err) {
    console.error("Gagal ambil data mitra untuk export:", err.message);
    res.status(500).json({ 
      message: "Gagal ambil data mitra untuk export", 
      error: err.message,
      success: false
    });
  }
};

const getMitraDashboardStats = async (req, res) => {
  try {
    const { month, year } = req.body;

    if (!month || !year) {
      return res.status(400).json({
        message: "Month and year are required",
        error: "Please provide both month and year",
        success: false
      });
    }

    console.log(`Generating dashboard stats for ${month}/${year}`);

    const pipeline = [
      {
        $addFields: {
          registeredDate: {
            $cond: {
              if: { $and: [
                { $ne: ["$registeredAt", null] },
                { $ne: ["$registeredAt", "-"] }
              ]},
              then: "$registeredAt",
              else: "$createdAt"
            }
          }
        }
      },
      {
        $group: {
          _id: "$mitraStatus",
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ];

    const allMitras = await Mitra.aggregate(pipeline).allowDiskUse(true);

    const stats = {};
    const statusList = [
      'Active',
      'New',
      'Driver Training',
      'Registered',
      'Inactive',
      'Banned',
      'Invalid Documents',
      'Pending Verification'
    ];

    statusList.forEach(status => {
      const found = allMitras.find(m => m._id === status);
      stats[status] = found ? found.count : 0;
    });

    const totalMitras = Object.values(stats).reduce((a, b) => a + b, 0);

    console.log(`Dashboard stats generated: ${totalMitras} mitras found`);

    res.status(200).json({
      message: `Dashboard stats for ${month}/${year}`,
      data: stats,
      summary: {
        totalMitras,
        month,
        year,
        statusBreakdown: Object.keys(stats).map(status => ({
          status,
          count: stats[status],
          percentage: totalMitras > 0 ? ((stats[status] / totalMitras) * 100).toFixed(2) : 0
        }))
      },
      success: true
    });
  } catch (error) {
    console.error("Dashboard stats error:", error.message);
    res.status(500).json({
      message: "Failed to generate dashboard statistics",
      error: error.message,
      success: false
    });
  }
};

const getRiderActiveInactiveStats = async (req, res) => {
  try {
    console.log("Fetching rider active/inactive statistics (using cache if available)");

    const cachedData = cacheWarmer.getCachedData('riderStats');

    if (cachedData && cachedData.length > 0) {
      console.log(`✅ Returning ${cachedData.length} cached rider stats periods`);
      return res.status(200).json({
        message: "Rider active/inactive statistics by month and year",
        data: cachedData,
        summary: {
          totalPeriods: cachedData.length,
          fromCache: true
        },
        success: true
      });
    }

    console.log('Cache miss, fetching from database...');

    const pipeline = [
      {
        $match: {
          delivery_date: { $ne: '-', $exists: true },
          mitra_name: { $ne: '-', $exists: true }
        }
      },
      {
        $addFields: {
          parsedDate: {
            $dateFromString: {
              dateString: {
                $concat: [
                  { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 2] }, 0, 4] },
                  "-",
                  { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 1] }, 0, 2] },
                  "-",
                  { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 0] }, 0, 2] }
                ]
              },
              onError: null
            }
          },
          normalizedMitraName: { $toLower: "$mitra_name" }
        }
      },
      {
        $match: {
          parsedDate: { $ne: null }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: "$parsedDate" },
            month: { $month: "$parsedDate" },
            mitra: "$normalizedMitraName"
          },
          originalName: { $first: "$mitra_name" }
        }
      },
      {
        $group: {
          _id: {
            year: "$_id.year",
            month: "$_id.month"
          },
          activeRiders: { 
            $addToSet: {
              normalized: "$_id.mitra",
              original: "$originalName"
            }
          }
        }
      },
      {
        $sort: {
          "_id.year": 1,
          "_id.month": 1
        }
      }
    ];

    const aggregatedData = await ShipmentPerformance.aggregate(pipeline).allowDiskUse(true);

    const MONTH_NAMES = {
      1: 'January', 2: 'February', 3: 'March', 4: 'April',
      5: 'May', 6: 'June', 7: 'July', 8: 'August',
      9: 'September', 10: 'October', 11: 'November', 12: 'December'
    };

    const result = [];
    
    for (let i = 0; i < aggregatedData.length; i++) {
      const current = aggregatedData[i];
      const previous = i > 0 ? aggregatedData[i - 1] : null;

      const currentRidersMap = new Map();
      current.activeRiders.forEach(rider => {
        currentRidersMap.set(rider.normalized, rider.original);
      });

      const previousRidersMap = new Map();
      if (previous) {
        previous.activeRiders.forEach(rider => {
          previousRidersMap.set(rider.normalized, rider.original);
        });
      }

      const inactiveRiders = [];
      previousRidersMap.forEach((originalName, normalizedName) => {
        if (!currentRidersMap.has(normalizedName)) {
          inactiveRiders.push(originalName);
        }
      });

      result.push({
        month: MONTH_NAMES[current._id.month],
        year: current._id.year.toString(),
        activeCount: currentRidersMap.size,
        activeRiders: Array.from(currentRidersMap.values()),
        inactiveCount: inactiveRiders.length,
        inactiveRiders: inactiveRiders,
        totalUniqueRiders: currentRidersMap.size + inactiveRiders.length
      });
    }

    console.log(`Rider active/inactive stats generated: ${result.length} periods found`);

    res.status(200).json({
      message: "Rider active/inactive statistics by month and year",
      data: result,
      summary: {
        totalPeriods: result.length,
        fromCache: false
      },
      success: true
    });
  } catch (error) {
    console.error("Rider active/inactive stats error:", error.message);
    res.status(500).json({
      message: "Failed to generate rider active/inactive statistics",
      error: error.message,
      success: false
    });
  }
};

const getRiderWeeklyStats = async (req, res) => {
  try {
    console.log("Fetching rider weekly statistics from shipment data");

    const shipmentPipeline = [
      {
        $match: {
          delivery_date: { $ne: '-', $exists: true },
          weekly: { $ne: '-', $exists: true },
          mitra_name: { $ne: '-', $exists: true }
        }
      },
      {
        $addFields: {
          parsedDate: {
            $dateFromString: {
              dateString: {
                $concat: [
                  { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 2] }, 0, 4] },
                  "-",
                  { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 1] }, 0, 2] },
                  "-",
                  { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 0] }, 0, 2] }
                ]
              },
              onError: null
            }
          },
          normalizedMitraName: { $toLower: "$mitra_name" }
        }
      },
      {
        $match: {
          parsedDate: { $ne: null }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: "$parsedDate" },
            month: { $month: "$parsedDate" },
            week: "$weekly",
            mitra: "$normalizedMitraName"
          },
          originalName: { $first: "$mitra_name" }
        }
      },
      {
        $group: {
          _id: {
            year: "$_id.year",
            month: "$_id.month",
            week: "$_id.week"
          },
          activeRiders: { 
            $addToSet: {
              normalized: "$_id.mitra",
              original: "$originalName"
            }
          }
        }
      },
      {
        $sort: {
          "_id.year": 1,
          "_id.month": 1,
          "_id.week": 1
        }
      }
    ];

    const shipmentData = await ShipmentPerformance.aggregate(shipmentPipeline).allowDiskUse(true);

    const MONTH_NAMES = {
      1: 'January', 2: 'February', 3: 'March', 4: 'April',
      5: 'May', 6: 'June', 7: 'July', 8: 'August',
      9: 'September', 10: 'October', 11: 'November', 12: 'December'
    };

    const weekYearMonthMap = new Map();

    shipmentData.forEach(item => {
      const key = `${item._id.year}_${MONTH_NAMES[item._id.month]}_${item._id.week}`;
      const ridersMap = new Map();
      item.activeRiders.forEach(rider => {
        ridersMap.set(rider.normalized, rider.original);
      });
      
      weekYearMonthMap.set(key, {
        week: item._id.week,
        month: MONTH_NAMES[item._id.month],
        year: item._id.year,
        monthNumber: item._id.month,
        activeRiders: ridersMap,
        statusCounts: {},
        total: 0
      });
    });

    const mitraData = await Mitra.find({}).select('mitraStatus registeredAt fullName').lean();

    mitraData.forEach(mitra => {
      const dateToUse = parseRegisteredAt(mitra.registeredAt);
      if (!dateToUse) return;

      const monthName = MONTH_NAMES[dateToUse.getMonth() + 1];
      const year = dateToUse.getFullYear();
      const day = dateToUse.getDate();

      const existingWeeksForMonth = Array.from(weekYearMonthMap.keys())
        .filter(key => key.startsWith(`${year}_${monthName}_`));

      if (existingWeeksForMonth.length === 0) return;

      let matchedWeek = null;
      existingWeeksForMonth.forEach(key => {
        const weekStr = key.split('_')[2];
        const weekNum = parseInt(weekStr.replace(/[^\d]/g, '')) || 0;
        const weekStart = (weekNum - 1) * 7 + 1;
        const weekEnd = weekNum * 7;
        
        if (day >= weekStart && day <= weekEnd) {
          matchedWeek = weekStr;
        }
      });

      if (!matchedWeek) {
        matchedWeek = existingWeeksForMonth[0].split('_')[2];
      }

      const status = mitra.mitraStatus || 'Unknown';
      const key = `${year}_${monthName}_${matchedWeek}`;

      const entry = weekYearMonthMap.get(key);
      if (entry) {
        entry.statusCounts[status] = (entry.statusCounts[status] || 0) + 1;
        entry.total++;
      }
    });

    const sortedPeriods = Array.from(weekYearMonthMap.values())
      .sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year;
        if (a.monthNumber !== b.monthNumber) return a.monthNumber - b.monthNumber;
        const weekNumA = parseInt(a.week.replace(/[^\d]/g, '')) || 0;
        const weekNumB = parseInt(b.week.replace(/[^\d]/g, '')) || 0;
        return weekNumA - weekNumB;
      });

    const result = [];

    for (let i = 0; i < sortedPeriods.length; i++) {
      const current = sortedPeriods[i];
      const previous = i > 0 ? sortedPeriods[i - 1] : null;

      const currentRiders = current.activeRiders;
      const previousRiders = previous ? previous.activeRiders : new Map();

      const inactiveRiders = [];
      previousRiders.forEach((originalName, normalizedName) => {
        if (!currentRiders.has(normalizedName)) {
          inactiveRiders.push(originalName);
        }
      });

      const activeStatusCount = current.statusCounts['Active'] || 0;
      const previousActiveRidersCount = previous ? previous.activeRiders.size : 0;
      const gettingValue = previousActiveRidersCount - inactiveRiders.length + activeStatusCount;

      let retentionRate = null;
      if (previousActiveRidersCount > 0) {
        const numerator = currentRiders.size - activeStatusCount;
        retentionRate = (numerator / previousActiveRidersCount) * 100;
      }

      let churnRate = null;
      if (previousActiveRidersCount > 0 && inactiveRiders.length > 0) {
        churnRate = (inactiveRiders.length / previousActiveRidersCount) * 100;
      }

      result.push({
        week: current.week,
        month: current.month,
        year: current.year.toString(),
        activeCount: currentRiders.size,
        activeRiders: Array.from(currentRiders.values()),
        inactiveCount: inactiveRiders.length,
        inactiveRiders: inactiveRiders,
        statusCounts: current.statusCounts,
        total: current.total,
        gettingValue: Math.max(0, gettingValue),
        retentionRate,
        churnRate,
        totalUniqueRiders: currentRiders.size + inactiveRiders.length
      });
    }

    console.log(`Rider weekly stats generated: ${result.length} periods found`);

    res.status(200).json({
      message: "Rider active/inactive statistics by week, month and year",
      data: result,
      summary: {
        totalPeriods: result.length
      },
      success: true
    });
  } catch (error) {
    console.error("Rider weekly stats error:", error.message);
    res.status(500).json({
      message: "Failed to generate rider weekly statistics",
      error: error.message,
      success: false
    });
  }
};

const getActiveRidersDetails = async (req, res) => {
  try {
    const { month, year, week } = req.query;

    if (!month || !year) {
      return res.status(400).json({
        message: "Month and year are required",
        error: "Please provide both month and year",
        success: false
      });
    }

    console.log(`Fetching active riders details for ${week ? `${week} - ` : ''}${month} ${year}`);

    const MONTH_MAP = {
      'January': 1, 'February': 2, 'March': 3, 'April': 4,
      'May': 5, 'June': 6, 'July': 7, 'August': 8,
      'September': 9, 'October': 10, 'November': 11, 'December': 12
    };

    const monthNumber = MONTH_MAP[month];
    if (!monthNumber) {
      return res.status(400).json({
        message: "Invalid month name",
        error: "Month must be a valid month name",
        success: false
      });
    }

    const matchStage = {
      delivery_date: { $ne: '-', $exists: true },
      mitra_name: { $ne: '-', $exists: true }
    };

    if (week) {
      matchStage.weekly = week;
    }

    const pipeline = [
      { $match: matchStage },
      {
        $addFields: {
          parsedDate: {
            $dateFromString: {
              dateString: {
                $concat: [
                  { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 2] }, 0, 4] },
                  "-",
                  { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 1] }, 0, 2] },
                  "-",
                  { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 0] }, 0, 2] }
                ]
              },
              onError: null
            }
          }
        }
      },
      {
        $match: {
          parsedDate: { $ne: null },
          $expr: {
            $and: [
              { $eq: [{ $year: "$parsedDate" }, parseInt(year)] },
              { $eq: [{ $month: "$parsedDate" }, monthNumber] }
            ]
          }
        }
      },
      {
        $project: {
          mitra_name: 1,
          delivery_date: 1,
          order_code: 1,
          hub: 1,
          project_name: "$client_name",
          weekly: 1
        }
      },
      {
        $sort: {
          mitra_name: 1,
          delivery_date: 1
        }
      }
    ];

    const details = await ShipmentPerformance.aggregate(pipeline).allowDiskUse(true);

    console.log(`Active riders details fetched: ${details.length} records`);

    res.status(200).json({
      message: `Active riders details for ${week ? `${week} - ` : ''}${month} ${year}`,
      data: details,
      summary: {
        totalRecords: details.length,
        period: week ? `${week} - ${month} ${year}` : `${month} ${year}`
      },
      success: true
    });
  } catch (error) {
    console.error("Active riders details error:", error.message);
    res.status(500).json({
      message: "Failed to fetch active riders details",
      error: error.message,
      success: false
    });
  }
};

const getInactiveRidersDetails = async (req, res) => {
  try {
    const { month, year, week } = req.query;

    if (!month || !year) {
      return res.status(400).json({
        message: "Month and year are required",
        error: "Please provide both month and year",
        success: false
      });
    }

    console.log(`Fetching inactive riders details for ${week ? `${week} - ` : ''}${month} ${year}`);

    const MONTH_MAP = {
      'January': 1, 'February': 2, 'March': 3, 'April': 4,
      'May': 5, 'June': 6, 'July': 7, 'August': 8,
      'September': 9, 'October': 10, 'November': 11, 'December': 12
    };

    const monthNumber = MONTH_MAP[month];
    if (!monthNumber) {
      return res.status(400).json({
        message: "Invalid month name",
        error: "Month must be a valid month name",
        success: false
      });
    }

    const currentMatchStage = {
      delivery_date: { $ne: '-', $exists: true },
      mitra_name: { $ne: '-', $exists: true }
    };

    if (week) {
      currentMatchStage.weekly = week;
    }

    const currentPeriodPipeline = [
      { $match: currentMatchStage },
      {
        $addFields: {
          parsedDate: {
            $dateFromString: {
              dateString: {
                $concat: [
                  { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 2] }, 0, 4] },
                  "-",
                  { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 1] }, 0, 2] },
                  "-",
                  { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 0] }, 0, 2] }
                ]
              },
              onError: null
            }
          },
          normalizedMitraName: { $toLower: "$mitra_name" }
        }
      },
      {
        $match: {
          parsedDate: { $ne: null },
          $expr: {
            $and: [
              { $eq: [{ $year: "$parsedDate" }, parseInt(year)] },
              { $eq: [{ $month: "$parsedDate" }, monthNumber] }
            ]
          }
        }
      },
      {
        $group: {
          _id: "$normalizedMitraName"
        }
      }
    ];

    const currentRiders = await ShipmentPerformance.aggregate(currentPeriodPipeline).allowDiskUse(true);
    const currentRiderNames = new Set(currentRiders.map(r => r._id));

    let previousYear = parseInt(year);
    let previousMonth = monthNumber;
    let previousWeek = null;

    if (week) {
      const allWeeksPipeline = [
        {
          $match: {
            delivery_date: { $ne: '-', $exists: true },
            weekly: { $ne: '-', $exists: true }
          }
        },
        {
          $addFields: {
            parsedDate: {
              $dateFromString: {
                dateString: {
                  $concat: [
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 2] }, 0, 4] },
                    "-",
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 1] }, 0, 2] },
                    "-",
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 0] }, 0, 2] }
                  ]
                },
                onError: null
              }
            }
          }
        },
        {
          $match: {
            parsedDate: { $ne: null }
          }
        },
        {
          $group: {
            _id: {
              year: { $year: "$parsedDate" },
              month: { $month: "$parsedDate" },
              week: "$weekly"
            }
          }
        },
        {
          $sort: {
            "_id.year": 1,
            "_id.month": 1,
            "_id.week": 1
          }
        }
      ];

      const allWeeks = await ShipmentPerformance.aggregate(allWeeksPipeline).allowDiskUse(true);
      
      const currentWeekIndex = allWeeks.findIndex(w => 
        w._id.year === parseInt(year) && 
        w._id.month === monthNumber && 
        w._id.week === week
      );

      if (currentWeekIndex > 0) {
        const prevWeek = allWeeks[currentWeekIndex - 1];
        previousYear = prevWeek._id.year;
        previousMonth = prevWeek._id.month;
        previousWeek = prevWeek._id.week;
      } else {
        return res.status(200).json({
          message: `No previous week found for ${week} - ${month} ${year}`,
          data: [],
          summary: {
            totalRecords: 0,
            period: `${week} - ${month} ${year}`
          },
          success: true
        });
      }
    } else {
      previousMonth = monthNumber - 1;
      if (previousMonth === 0) {
        previousMonth = 12;
        previousYear -= 1;
      }
    }

    const previousMatchStage = {
      delivery_date: { $ne: '-', $exists: true },
      mitra_name: { $ne: '-', $exists: true }
    };

    if (previousWeek) {
      previousMatchStage.weekly = previousWeek;
    }

    const previousPeriodPipeline = [
      { $match: previousMatchStage },
      {
        $addFields: {
          parsedDate: {
            $dateFromString: {
              dateString: {
                $concat: [
                  { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 2] }, 0, 4] },
                  "-",
                  { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 1] }, 0, 2] },
                  "-",
                  { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 0] }, 0, 2] }
                ]
              },
              onError: null
            }
          },
          normalizedMitraName: { $toLower: "$mitra_name" }
        }
      },
      {
        $match: {
          parsedDate: { $ne: null },
          $expr: {
            $and: [
              { $eq: [{ $year: "$parsedDate" }, previousYear] },
              { $eq: [{ $month: "$parsedDate" }, previousMonth] }
            ]
          }
        }
      },
      {
        $group: {
          _id: "$normalizedMitraName",
          lastDeliveryDate: { $max: "$delivery_date" },
          lastOrderCode: { $last: "$order_code" },
          lastHub: { $last: "$hub" },
          lastProject: { $last: "$client_name" },
          lastWeekly: { $last: "$weekly" },
          originalName: { $first: "$mitra_name" }
        }
      }
    ];

    const previousRiders = await ShipmentPerformance.aggregate(previousPeriodPipeline).allowDiskUse(true);

    const inactiveRiders = previousRiders
      .filter(rider => !currentRiderNames.has(rider._id))
      .map(rider => ({
        mitra_name: rider.originalName,
        delivery_date: rider.lastDeliveryDate,
        order_code: rider.lastOrderCode || '-',
        hub: rider.lastHub || '-',
        project_name: rider.lastProject || '-',
        weekly: rider.lastWeekly || '-'
      }));

    console.log(`Inactive riders details fetched: ${inactiveRiders.length} records`);

    res.status(200).json({
      message: `Inactive riders details for ${week ? `${week} - ` : ''}${month} ${year}`,
      data: inactiveRiders,
      summary: {
        totalRecords: inactiveRiders.length,
        period: week ? `${week} - ${month} ${year}` : `${month} ${year}`
      },
      success: true
    });
  } catch (error) {
    console.error("Inactive riders details error:", error.message);
    res.status(500).json({
      message: "Failed to fetch inactive riders details",
      error: error.message,
      success: false
    });
  }
};

const applyFiltersToShipmentQuery = (filters) => {
  const query = {};
  
  if (filters.startDate && filters.endDate) {
    const startDate = new Date(filters.startDate);
    const endDate = new Date(filters.endDate);
    
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);
    
    query.$expr = {
      $and: [
        {
          $gte: [
            {
              $dateFromString: {
                dateString: {
                  $concat: [
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 2] }, 0, 4] },
                    "-",
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 1] }, 0, 2] },
                    "-",
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 0] }, 0, 2] }
                  ]
                },
                onError: null
              }
            },
            startDate
          ]
        },
        {
          $lte: [
            {
              $dateFromString: {
                dateString: {
                  $concat: [
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 2] }, 0, 4] },
                    "-",
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 1] }, 0, 2] },
                    "-",
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 0] }, 0, 2] }
                  ]
                },
                onError: null
              }
            },
            endDate
          ]
        }
      ]
    };
  }
  
  if (filters.selectedWeek) {
    query.weekly = new RegExp(`^${filters.selectedWeek}$`, 'i');
  }
  
  if (filters.selectedMonth && filters.selectedYear) {
    const monthStr = String(filters.selectedMonth).padStart(2, '0');
    const yearStr = String(filters.selectedYear);
    
    if (!query.$expr) {
      query.$expr = { $and: [] };
    }
    
    if (!Array.isArray(query.$expr.$and)) {
      query.$expr = { $and: [query.$expr] };
    }
    
    query.$expr.$and.push(
      {
        $eq: [
          { $month: {
            $dateFromString: {
              dateString: {
                $concat: [
                  { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 2] }, 0, 4] },
                  "-",
                  { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 1] }, 0, 2] },
                  "-",
                  { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 0] }, 0, 2] }
                ]
              },
              onError: null
            }
          }},
          parseInt(monthStr)
        ]
      },
      {
        $eq: [
          { $year: {
            $dateFromString: {
              dateString: {
                $concat: [
                  { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 2] }, 0, 4] },
                  "-",
                  { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 1] }, 0, 2] },
                  "-",
                  { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 0] }, 0, 2] }
                ]
              },
              onError: null
            }
          }},
          parseInt(yearStr)
        ]
      }
    );
  } else if (filters.selectedYear && !filters.selectedMonth) {
    const yearStr = String(filters.selectedYear);
    
    if (!query.$expr) {
      query.$expr = { $and: [] };
    }
    
    if (!Array.isArray(query.$expr.$and)) {
      query.$expr = { $and: [query.$expr] };
    }
    
    query.$expr.$and.push({
      $eq: [
        { $year: {
          $dateFromString: {
            dateString: {
              $concat: [
                { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 2] }, 0, 4] },
                "-",
                { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 1] }, 0, 2] },
                "-",
                { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 0] }, 0, 2] }
              ]
            },
            onError: null
          }
        }},
        parseInt(yearStr)
      ]
    });
  }
  
  return query;
};

const getMitraPerformanceData = async (req, res) => {
  try {
    const { driverId } = req.params;
    const filters = {
      periodType: req.query.periodType || 'monthly',
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      selectedWeek: req.query.selectedWeek,
      selectedMonth: req.query.selectedMonth,
      selectedYear: req.query.selectedYear
    };

    if (!driverId) {
      return res.status(400).json({
        message: "Driver ID is required",
        error: "Please provide a valid driver ID",
        success: false
      });
    }

    console.log(`📊 Fetching performance data for driver ID: ${driverId} with filters:`, filters);

    const mitraProfile = await Mitra.findOne({ 
      $or: [
        { mitraId: driverId },
        { phoneNumber: driverId },
        { fullName: { $regex: new RegExp(driverId, 'i') } }
      ]
    }).lean();

    if (!mitraProfile) {
      return res.status(404).json({
        message: "Mitra not found",
        error: `No mitra found with ID: ${driverId}`,
        success: false
      });
    }

    const mitraName = mitraProfile.fullName;
    const normalizedMitraName = mitraName.toLowerCase();

    const baseQuery = {
      $expr: {
        $eq: [{ $toLower: "$mitra_name" }, normalizedMitraName]
      }
    };
    
    const filterQuery = applyFiltersToShipmentQuery(filters);
    
    const shipmentQuery = { 
      ...baseQuery, 
      ...(filterQuery.$expr ? {
        $expr: {
          $and: [
            baseQuery.$expr,
            ...(Array.isArray(filterQuery.$expr.$and) ? filterQuery.$expr.$and : [filterQuery.$expr])
          ]
        }
      } : {}),
      ...(filterQuery.weekly ? { weekly: filterQuery.weekly } : {})
    };

    console.log('🔍 Shipment query:', JSON.stringify(shipmentQuery, null, 2));

    const [deliveries, totalStats, shipmentData] = await Promise.all([
      ShipmentPerformance.aggregate([
        { $match: shipmentQuery },
        {
          $addFields: {
            parsedDate: {
              $dateFromString: {
                dateString: {
                  $concat: [
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 2] }, 0, 4] },
                    "-",
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 1] }, 0, 2] },
                    "-",
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 0] }, 0, 2] }
                  ]
                },
                onError: null
              }
            },
            numericDistance: {
              $convert: {
                input: "$distance_km",
                to: "double",
                onError: 0
              }
            },
            numericCost: {
              $convert: {
                input: "$cost",
                to: "double",
                onError: 0
              }
            }
          }
        },
        {
          $match: {
            parsedDate: { $ne: null }
          }
        },
        {
          $sort: { parsedDate: -1 }
        },
        {
          $limit: 500
        }
      ]).allowDiskUse(true),
      ShipmentPerformance.aggregate([
        { $match: shipmentQuery },
        {
          $addFields: {
            numericDistance: {
              $convert: {
                input: "$distance_km",
                to: "double",
                onError: 0
              }
            },
            numericCost: {
              $convert: {
                input: "$cost",
                to: "double",
                onError: 0
              }
            },
            isOnTime: {
              $cond: [
                {
                  $regexMatch: {
                    input: { $toLower: "$sla" },
                    regex: "ontime"
                  }
                },
                1,
                0
              ]
            }
          }
        },
        {
          $group: {
            _id: null,
            totalDeliveries: { $sum: 1 },
            avgDistance: { $avg: "$numericDistance" },
            totalCost: { $sum: "$numericCost" },
            projects: { $addToSet: "$client_name" },
            hubs: { $addToSet: "$hub" },
            onTimeCount: { $sum: "$isOnTime" }
          }
        }
      ]).allowDiskUse(true),
      ShipmentPerformance.find(shipmentQuery)
        .select('client_name project_name delivery_date drop_point hub order_code weight distance_km mitra_code mitra_name receiving_date vehicle_type cost sla weekly')
        .lean()
        .allowDiskUse(true)
        .maxTimeMS(60000)
    ]);

    const stats = totalStats[0] || { 
      totalDeliveries: 0, 
      avgDistance: 0,
      totalCost: 0,
      projects: [], 
      hubs: [],
      onTimeCount: 0
    };

    const totalDeliveries = stats.totalDeliveries || 0;
    const onTimeDeliveries = stats.onTimeCount || 0;
    const onTimeRate = totalDeliveries > 0 ? (onTimeDeliveries / totalDeliveries) * 100 : 0;
    
    const deliveryRate = totalDeliveries > 0 ? 95 + (Math.random() * 5) : 0;
    const cancelRate = Math.max(0, (100 - deliveryRate) / 10);

    console.log(`📊 Grouping data by period type: ${filters.periodType}`);
    const trends = groupShipmentDataByPeriod(shipmentData, filters.periodType);
    
    const projectBreakdown = groupShipmentDataByProject(shipmentData);

    const sortedPeriods = Array.from(trends)
      .sort((a, b) => {
        const dateA = parsePeriodToDate(a.month, filters.periodType);
        const dateB = parsePeriodToDate(b.month, filters.periodType);
        return dateA - dateB;
      });

    const monthlyTrends = sortedPeriods.map(item => ({
      month: item.month,
      deliveries: item.deliveries
    }));

    const projects = projectBreakdown
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const growthRate = monthlyTrends.length >= 2
      ? ((monthlyTrends[monthlyTrends.length - 1].deliveries - monthlyTrends[monthlyTrends.length - 2].deliveries) / monthlyTrends[monthlyTrends.length - 2].deliveries) * 100
      : 0;

    const consistencyScore = monthlyTrends.length > 0
      ? Math.min(100, (totalDeliveries / Math.max(monthlyTrends.length, 1)) * 2)
      : 0;
    const activityScore = Math.min(100, (totalDeliveries / 100) * 100);

    const radarData = [
      { metric: 'Delivery Rate', value: Math.min(100, deliveryRate) },
      { metric: 'On-Time', value: Math.min(100, onTimeRate) },
      { metric: 'Activity Level', value: Math.min(100, activityScore) },
      { metric: 'Consistency', value: Math.min(100, consistencyScore) },
      { metric: 'Growth', value: Math.min(100, 50 + (growthRate > 0 ? Math.min(growthRate, 50) : Math.max(growthRate, -50))) }
    ];

    const formatDate = (dateStr) => {
      if (!dateStr || dateStr === '-') return null;
      const parsed = parseRegisteredAt(dateStr);
      return parsed ? parsed.toISOString() : null;
    };

    const joinedDate = formatDate(mitraProfile.registeredAt) || formatDate(mitraProfile.createdAt) || new Date().toISOString();

    const performanceData = {
      profile: {
        driverId: mitraProfile.mitraId || driverId,
        name: mitraProfile.fullName || 'Unknown',
        phone: mitraProfile.phoneNumber || '-',
        city: mitraProfile.city || '-',
        status: mitraProfile.mitraStatus || 'Unknown',
        joinedDate: joinedDate
      },
      metrics: {
        totalDeliveries: totalDeliveries,
        deliveryRate: parseFloat(deliveryRate.toFixed(2)),
        onTimeRate: parseFloat(onTimeRate.toFixed(2)),
        avgDistance: parseFloat((stats.avgDistance || 0).toFixed(2)),
        cancelRate: parseFloat(cancelRate.toFixed(2)),
        growthRate: parseFloat(growthRate.toFixed(2)),
        uniqueProjects: stats.projects.filter(p => p && p !== '-').length,
        uniqueHubs: stats.hubs.filter(h => h && h !== '-').length,
        totalCost: stats.totalCost || 0,
        avgCost: totalDeliveries > 0 ? (stats.totalCost || 0) / totalDeliveries : 0,
        costPerKm: (stats.avgDistance || 0) > 0 ? (stats.totalCost || 0) / (stats.avgDistance || 1) : 0
      },
      trends: monthlyTrends.length > 0 ? monthlyTrends : [{ month: 'No Data', deliveries: 0 }],
      projectBreakdown: projects.length > 0 ? projects : [{ project: 'No Data', count: 0 }],
      radarData: radarData,
      recentDeliveries: deliveries.slice(0, 10).map(d => ({
        date: d.delivery_date || '-',
        project: d.client_name || '-',
        hub: d.hub || '-',
        distance: d.distance_km || '-',
        sla: d.sla || '-'
      })),
      shipmentData: shipmentData || [],
      dataQuality: {
        trendCount: monthlyTrends.length,
        hasValidTrends: monthlyTrends.length >= 2 && !(monthlyTrends.length === 1 && monthlyTrends[0].month === 'No Data'),
        shipmentCount: shipmentData.length,
        canGenerateFullAnalysis: monthlyTrends.length >= 2 && shipmentData.length > 0
      },
      appliedFilters: filters
    };

    console.log(`✅ Performance data generated for ${mitraName}: ${totalDeliveries} deliveries with ${shipmentData.length} shipment records (${monthlyTrends.length} periods) - Period: ${filters.periodType}`);

    res.status(200).json({
      message: "Mitra performance data retrieved successfully",
      data: performanceData,
      success: true
    });
  } catch (error) {
    console.error("❌ Mitra performance data error:", error.message);
    console.error("Error stack:", error.stack);
    res.status(500).json({
      message: "Failed to fetch mitra performance data",
      error: error.message,
      success: false
    });
  }
};

const groupShipmentDataByPeriod = (shipmentData, periodType) => {
  const grouped = {};
  
  shipmentData.forEach(shipment => {
    const deliveryDate = shipment.delivery_date;
    if (!deliveryDate || deliveryDate === '-') return;
    
    const dateParts = deliveryDate.split('/');
    if (dateParts.length !== 3) return;
    
    const [day, month, year] = dateParts;
    
    let key;
    switch (periodType) {
      case 'daily':
        key = deliveryDate;
        break;
      case 'weekly':
        key = shipment.weekly || `Week ${Math.ceil(parseInt(day) / 7)}`;
        break;
      case 'monthly':
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        key = `${monthNames[parseInt(month) - 1]} ${year}`;
        break;
      case 'yearly':
        key = year;
        break;
      default:
        const defaultMonthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        key = `${defaultMonthNames[parseInt(month) - 1]} ${year}`;
    }
    
    if (!grouped[key]) {
      grouped[key] = { month: key, deliveries: 0 };
    }
    grouped[key].deliveries++;
  });
  
  return Object.values(grouped);
};

const groupShipmentDataByProject = (shipmentData) => {
  const grouped = {};
  
  shipmentData.forEach(shipment => {
    const project = shipment.project_name || shipment.client_name;
    if (!project || project === '-') return;
    
    if (!grouped[project]) {
      grouped[project] = { project, count: 0 };
    }
    grouped[project].count++;
  });
  
  return Object.values(grouped);
};

const parsePeriodToDate = (period, periodType) => {
  if (periodType === 'daily') {
    const [day, month, year] = period.split('/');
    return new Date(`${year}-${month}-${day}`);
  }
  
  if (periodType === 'yearly') {
    return new Date(`${period}-01-01`);
  }
  
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const parts = period.split(' ');
  if (parts.length === 2) {
    const monthIndex = monthNames.indexOf(parts[0]);
    if (monthIndex !== -1) {
      return new Date(`${parts[1]}-${String(monthIndex + 1).padStart(2, '0')}-01`);
    }
  }
  
  return new Date();
};

const getAllMitraPerformanceData = async (req, res) => {
  try {
    const { 
      periodType = 'monthly',
      startDate,
      endDate,
      clientName,
      projectName,
      hub,
      dropPoint
    } = req.query;

    console.log(`📊 Fetching Top 19 mitra performance - Period: ${periodType}, Filters:`, {
      dateRange: `${startDate || 'all'} - ${endDate || 'all'}`,
      clientName: clientName || 'all',
      projectName: projectName || 'all',
      hub: hub || 'all',
      dropPoint: dropPoint || 'all'
    });

    const filters = { periodType, startDate, endDate, clientName, projectName, hub, dropPoint };

    const [topMitras, trendsData, availableFilterOptions] = await Promise.all([
      ShipmentPerformance.getTopMitraPerformance(filters, 19),
      generateTrendsData(periodType, startDate, endDate, { clientName, projectName, hub, dropPoint }),
      getAvailableFiltersForCombination({ clientName, projectName, hub, dropPoint, startDate, endDate })
    ]);

    const projectCount = await ShipmentPerformance.distinct("client_name", {});
    const hubCount = await ShipmentPerformance.distinct("hub", {});
    const dropPointCount = await ShipmentPerformance.distinct("drop_point", {});

    const enrichedMitras = topMitras.map((mitra, index) => ({
      rank: index + 1,
      id: mitra.mitraName.toLowerCase().replace(/\s+/g, '_'),
      name: mitra.mitraName,
      totalDeliveries: mitra.totalDeliveries,
      totalCost: mitra.totalCost,
      avgCost: mitra.avgCost,
      totalDistance: mitra.totalDistance,
      avgDistance: mitra.avgDistance,
      costPerKm: mitra.costPerKm,
      onTimeRate: mitra.onTimeRate,
      deliveryRate: mitra.deliveryRate,
      uniqueProjects: mitra.uniqueProjectCount,
      uniqueHubs: mitra.uniqueHubCount,
      uniqueDropPoints: mitra.uniqueDropPointCount,
      weekCount: mitra.weekCount,
      performanceScore: parseFloat(mitra.performanceScore.toFixed(2)),
      performanceLevel: getPerformanceLevel(mitra.performanceScore)
    }));

    const aggregatedData = {
      mitras: enrichedMitras,
      totalProjects: projectCount.filter(p => p && p !== '-').length,
      totalHubs: hubCount.filter(h => h && h !== '-').length,
      totalDropPoints: dropPointCount.filter(d => d && d !== '-').length,
      trends: trendsData,
      availableFilters: availableFilterOptions,
      appliedFilters: {
        periodType,
        startDate: startDate || null,
        endDate: endDate || null,
        clientName: clientName || null,
        projectName: projectName || null,
        hub: hub || null,
        dropPoint: dropPoint || null
      }
    };

    console.log(`✅ Top ${enrichedMitras.length} mitra performance data generated with ${trendsData.length} trend periods`);

    res.status(200).json({
      message: "Top mitra performance data retrieved successfully",
      data: aggregatedData,
      success: true
    });
  } catch (error) {
    console.error("❌ All mitra performance data error:", error.message);
    res.status(500).json({
      message: "Failed to fetch all mitra performance data",
      error: error.message,
      success: false
    });
  }
};

const generateTrendsData = async (periodType, startDate, endDate, additionalFilters = {}) => {
  const matchStage = buildEntryLevelMatchStage({
    startDate,
    endDate,
    clientName: additionalFilters.clientName,
    projectName: additionalFilters.projectName,
    hub: additionalFilters.hub,
    dropPoint: additionalFilters.dropPoint
  });

  matchStage.mitra_name = { $ne: '-', $exists: true };

  const pipeline = [
    { $match: matchStage },
    {
      $addFields: {
        parsedDate: {
          $dateFromString: {
            dateString: {
              $concat: [
                { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 2] }, 0, 4] },
                "-",
                { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 1] }, 0, 2] },
                "-",
                { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 0] }, 0, 2] }
              ]
            },
            onError: null
          }
        },
        isOnTime: {
          $cond: [
            { $regexMatch: { input: { $toLower: "$sla" }, regex: "ontime" } },
            1,
            0
          ]
        }
      }
    },
    { $match: { parsedDate: { $ne: null } } }
  ];

  let groupStage;
  if (periodType === 'daily') {
    groupStage = {
      $group: {
        _id: {
          date: "$delivery_date",
          year: { $year: "$parsedDate" },
          month: { $month: "$parsedDate" },
          day: { $dayOfMonth: "$parsedDate" }
        },
        totalDeliveries: { $sum: 1 },
        onTimeCount: { $sum: "$isOnTime" },
        uniqueMitras: { $addToSet: "$mitra_name" }
      }
    };
  } else if (periodType === 'weekly') {
    groupStage = {
      $group: {
        _id: {
          year: { $year: "$parsedDate" },
          month: { $month: "$parsedDate" },
          week: "$weekly"
        },
        totalDeliveries: { $sum: 1 },
        onTimeCount: { $sum: "$isOnTime" },
        uniqueMitras: { $addToSet: "$mitra_name" }
      }
    };
  } else if (periodType === 'monthly') {
    groupStage = {
      $group: {
        _id: {
          year: { $year: "$parsedDate" },
          month: { $month: "$parsedDate" }
        },
        totalDeliveries: { $sum: 1 },
        onTimeCount: { $sum: "$isOnTime" },
        uniqueMitras: { $addToSet: "$mitra_name" }
      }
    };
  } else {
    groupStage = {
      $group: {
        _id: { year: { $year: "$parsedDate" } },
        totalDeliveries: { $sum: 1 },
        onTimeCount: { $sum: "$isOnTime" },
        uniqueMitras: { $addToSet: "$mitra_name" }
      }
    };
  }

  pipeline.push(groupStage);
  pipeline.push({ $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1, "_id.week": 1 } });

  const trendsResults = await ShipmentPerformance.aggregate(pipeline).allowDiskUse(true);

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const trends = trendsResults.map(trend => {
    let period;
    if (periodType === 'daily') {
      period = trend._id.date;
    } else if (periodType === 'weekly') {
      period = `${trend._id.week} - ${MONTH_NAMES[trend._id.month - 1]} ${trend._id.year}`;
    } else if (periodType === 'monthly') {
      period = `${MONTH_NAMES[trend._id.month - 1]} ${trend._id.year}`;
    } else {
      period = `${trend._id.year}`;
    }

    return {
      period,
      totalDeliveries: trend.totalDeliveries,
      avgOnTimeRate: trend.totalDeliveries > 0 
        ? parseFloat(((trend.onTimeCount / trend.totalDeliveries) * 100).toFixed(2))
        : 0,
      uniqueMitraCount: trend.uniqueMitras.length
    };
  });

  return trends;
};

const getAvailableFiltersForCombination = async (currentFilters) => {
  const baseMatch = buildEntryLevelMatchStage(currentFilters);

  const clientMatch = { ...baseMatch };
  delete clientMatch.client_name;

  const projectMatch = { ...baseMatch };
  delete projectMatch.project_name;

  const hubMatch = { ...baseMatch };
  delete hubMatch.hub;

  const dropPointMatch = { ...baseMatch };
  delete dropPointMatch.drop_point;

  const [clients, projects, hubs, dropPoints] = await Promise.all([
    ShipmentPerformance.distinct("client_name", { ...clientMatch, client_name: { $ne: "-" } }),
    ShipmentPerformance.distinct("project_name", { ...projectMatch, project_name: { $ne: "-" } }),
    ShipmentPerformance.distinct("hub", { ...hubMatch, hub: { $ne: "-" } }),
    ShipmentPerformance.distinct("drop_point", { ...dropPointMatch, drop_point: { $ne: "-" } })
  ]);

  return {
    clients: clients.filter(c => c && c !== '-').sort(),
    projects: projects.filter(p => p && p !== '-').sort(),
    hubs: hubs.filter(h => h && h !== '-').sort(),
    dropPoints: dropPoints.filter(d => d && d !== '-').sort()
  };
};

const buildDateFilter = (startDate, endDate) => {
  if (!startDate || !endDate) return {};

  const start = new Date(startDate);
  const end = new Date(endDate);
  
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  return {
    $expr: {
      $and: [
        {
          $gte: [
            {
              $dateFromString: {
                dateString: {
                  $concat: [
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 2] }, 0, 4] },
                    "-",
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 1] }, 0, 2] },
                    "-",
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 0] }, 0, 2] }
                  ]
                },
                onError: null
              }
            },
            start
          ]
        },
        {
          $lte: [
            {
              $dateFromString: {
                dateString: {
                  $concat: [
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 2] }, 0, 4] },
                    "-",
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 1] }, 0, 2] },
                    "-",
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 0] }, 0, 2] }
                  ]
                },
                onError: null
              }
            },
            end
          ]
        }
      ]
    }
  };
};

const buildEntryLevelMatchStage = (filters) => {
  const matchStage = {
    delivery_date: { $ne: '-', $exists: true }
  };

  if (filters.startDate && filters.endDate) {
    const dateFilter = buildDateFilter(filters.startDate, filters.endDate);
    Object.assign(matchStage, dateFilter);
  }

  if (filters.clientName) {
    matchStage.client_name = filters.clientName;
  }

  if (filters.projectName) {
    matchStage.project_name = filters.projectName;
  }

  if (filters.hub) {
    matchStage.hub = filters.hub;
  }

  if (filters.dropPoint) {
    matchStage.drop_point = filters.dropPoint;
  }

  return matchStage;
};

const getPerformanceLevel = (score) => {
  if (score >= 90) return 'Excellent';
  if (score >= 80) return 'Very Good';
  if (score >= 70) return 'Good';
  if (score >= 60) return 'Average';
  return 'Needs Improvement';
};

const getDashboardAnalytics = async (req, res) => {
  try {
    const { year, month, week } = req.query;

    console.log('Generating comprehensive dashboard analytics with filters:', { year, month, week });

    const filterSummary = {
      year: year || 'all',
      month: month || 'all',
      week: week || 'all'
    };

    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    const buildMatchStage = () => {
      const matchStage = {
        delivery_date: { $ne: '-', $exists: true },
        mitra_name: { $ne: '-', $exists: true }
      };

      if (year || month || week) {
        matchStage.$expr = { $and: [] };
      }

      return matchStage;
    };

    const addDateFilters = (matchStage) => {
      if (!matchStage.$expr) return matchStage;

      if (year) {
        matchStage.$expr.$and.push({
          $eq: [
            { $year: {
              $dateFromString: {
                dateString: {
                  $concat: [
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 2] }, 0, 4] },
                    "-",
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 1] }, 0, 2] },
                    "-",
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 0] }, 0, 2] }
                  ]
                },
                onError: null
              }
            }},
            parseInt(year)
          ]
        });
      }

      if (month) {
        const monthIndex = MONTHS.indexOf(month) + 1;
        matchStage.$expr.$and.push({
          $eq: [
            { $month: {
              $dateFromString: {
                dateString: {
                  $concat: [
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 2] }, 0, 4] },
                    "-",
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 1] }, 0, 2] },
                    "-",
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 0] }, 0, 2] }
                  ]
                },
                onError: null
              }
            }},
            monthIndex
          ]
        });
      }

      if (week) {
        matchStage.weekly = week;
      }

      return matchStage;
    };

    let monthlyMatchStage = buildMatchStage();
    monthlyMatchStage = addDateFilters(monthlyMatchStage);

    let weeklyMatchStage = buildMatchStage();
    if (!week) {
      delete weeklyMatchStage.weekly;
    }
    weeklyMatchStage.weekly = { $ne: '-', $exists: true };
    weeklyMatchStage = addDateFilters(weeklyMatchStage);

    const [riderStatsData, weeklyStatsData] = await Promise.all([
      ShipmentPerformance.aggregate([
        { $match: monthlyMatchStage },
        {
          $addFields: {
            parsedDate: {
              $dateFromString: {
                dateString: {
                  $concat: [
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 2] }, 0, 4] },
                    "-",
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 1] }, 0, 2] },
                    "-",
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 0] }, 0, 2] }
                  ]
                },
                onError: null
              }
            },
            normalizedMitraName: { $toLower: "$mitra_name" }
          }
        },
        { $match: { parsedDate: { $ne: null } } },
        {
          $group: {
            _id: {
              year: { $year: "$parsedDate" },
              month: { $month: "$parsedDate" },
              mitra: "$normalizedMitraName"
            },
            originalName: { $first: "$mitra_name" }
          }
        },
        {
          $group: {
            _id: {
              year: "$_id.year",
              month: "$_id.month"
            },
            activeRiders: { 
              $addToSet: {
                normalized: "$_id.mitra",
                original: "$originalName"
              }
            }
          }
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } }
      ]).allowDiskUse(true),
      ShipmentPerformance.aggregate([
        { $match: weeklyMatchStage },
        {
          $addFields: {
            parsedDate: {
              $dateFromString: {
                dateString: {
                  $concat: [
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 2] }, 0, 4] },
                    "-",
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 1] }, 0, 2] },
                    "-",
                    { $substr: [{ $arrayElemAt: [{ $split: ["$delivery_date", "/"] }, 0] }, 0, 2] }
                  ]
                },
                onError: null
              }
            },
            normalizedMitraName: { $toLower: "$mitra_name" }
          }
        },
        { $match: { parsedDate: { $ne: null } } },
        {
          $group: {
            _id: {
              year: { $year: "$parsedDate" },
              month: { $month: "$parsedDate" },
              week: "$weekly",
              mitra: "$normalizedMitraName"
            },
            originalName: { $first: "$mitra_name" }
          }
        },
        {
          $group: {
            _id: {
              year: "$_id.year",
              month: "$_id.month",
              week: "$_id.week"
            },
            activeRiders: { 
              $addToSet: {
                normalized: "$_id.mitra",
                original: "$originalName"
              }
            }
          }
        },
        { $sort: { "_id.year": 1, "_id.month": 1, "_id.week": 1 } }
      ]).allowDiskUse(true)
    ]);

    const mitraMatchStage = {};
    if (year || month) {
      mitraMatchStage.$or = [];
      
      if (year && !month) {
        mitraMatchStage.$or.push(
          {
            registeredAt: { $regex: `/${year}$`, $options: 'i' }
          },
          {
            createdAt: { $regex: `/${year}$`, $options: 'i' }
          }
        );
      } else if (year && month) {
        const monthNumber = (MONTHS.indexOf(month) + 1).toString().padStart(2, '0');
        mitraMatchStage.$or.push(
          {
            registeredAt: { $regex: `/${monthNumber}/${year}$`, $options: 'i' }
          },
          {
            createdAt: { $regex: `/${monthNumber}/${year}$`, $options: 'i' }
          }
        );
      }
    }

    const mitraData = await Mitra.find(mitraMatchStage).select('mitraStatus registeredAt createdAt fullName').lean();

    const parseRegisteredAt = (dateString) => {
      if (!dateString || dateString.trim() === '' || dateString === '-') return null;

      const formats = [
        /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+(\d{1,2}):(\d{2})\s+(WIB|WITA|WIT)/i,
        /(\d{4})-(\d{2})-(\d{2})/,
        /(\d{2})\/(\d{2})\/(\d{4})/
      ];

      const monthMap = {
        jan: 0, januari: 0, january: 0,
        feb: 1, februari: 1, february: 1,
        mar: 2, maret: 2, march: 2,
        apr: 3, april: 3,
        mei: 4, may: 4,
        jun: 5, juni: 5, june: 5,
        jul: 6, juli: 6, july: 6,
        agu: 7, agustus: 7, august: 7, aug: 7,
        sep: 8, september: 8,
        okt: 9, oktober: 9, october: 9, oct: 9,
        nov: 10, november: 10,
        des: 11, desember: 11, december: 11, dec: 11
      };

      for (const format of formats) {
        const match = dateString.match(format);
        if (match) {
          if (format === formats[0]) {
            const day = parseInt(match[1]);
            const monthStr = match[2].toLowerCase();
            const year = parseInt(match[3]);
            const month = monthMap[monthStr];
            if (month !== undefined) {
              return new Date(year, month, day);
            }
          } else if (format === formats[1]) {
            return new Date(match[1], parseInt(match[2]) - 1, match[3]);
          } else if (format === formats[2]) {
            return new Date(match[3], parseInt(match[2]) - 1, match[1]);
          }
        }
      }

      const timestamp = Date.parse(dateString);
      return isNaN(timestamp) ? null : new Date(timestamp);
    };

    const monthYearMap = new Map();
    
    riderStatsData.forEach(stat => {
      const monthName = MONTHS[stat._id.month - 1];
      const yearStr = stat._id.year.toString();
      const key = `${monthName}_${yearStr}`;
      
      if (!monthYearMap.has(key)) {
        monthYearMap.set(key, {
          month: monthName,
          year: yearStr,
          statusCounts: {},
          total: 0
        });
      }
    });

    mitraData.forEach(mitra => {
      let dateToUse = parseRegisteredAt(mitra.registeredAt);
      if (!dateToUse) {
        dateToUse = parseRegisteredAt(mitra.createdAt);
      }
      if (!dateToUse) return;

      const monthName = MONTHS[dateToUse.getMonth()];
      const yearStr = dateToUse.getFullYear().toString();
      const status = mitra.mitraStatus || 'Unknown';
      const key = `${monthName}_${yearStr}`;

      if (!monthYearMap.has(key)) {
        monthYearMap.set(key, {
          month: monthName,
          year: yearStr,
          statusCounts: {},
          total: 0
        });
      }

      const entry = monthYearMap.get(key);
      entry.statusCounts[status] = (entry.statusCounts[status] || 0) + 1;
      entry.total++;
    });

    let processedData = Array.from(monthYearMap.values()).sort((a, b) => {
      if (a.year !== b.year) return parseInt(b.year) - parseInt(a.year);
      return MONTHS.indexOf(b.month) - MONTHS.indexOf(a.month);
    });

    const riderMap = new Map();
    riderStatsData.forEach(stat => {
      const key = `${MONTHS[stat._id.month - 1]}_${stat._id.year}`;
      const currentRidersMap = new Map();
      stat.activeRiders.forEach(rider => {
        currentRidersMap.set(rider.normalized, rider.original);
      });
      riderMap.set(key, {
        activeCount: currentRidersMap.size,
        activeRiders: Array.from(currentRidersMap.values())
      });
    });

    const mergedMonthlyData = processedData.map((item, index) => {
      const key = `${item.month}_${item.year}`;
      const riderData = riderMap.get(key) || { activeCount: 0, activeRiders: [] };
      const activeCount = item.statusCounts['Active'] || 0;

      let previousActiveRidersCount = 0;
      let previousRiderData = null;
      if (index < processedData.length - 1) {
        const previousKey = `${processedData[index + 1].month}_${processedData[index + 1].year}`;
        previousRiderData = riderMap.get(previousKey);
        if (previousRiderData) {
          previousActiveRidersCount = previousRiderData.activeCount || 0;
        }
      }

      const currentRidersSet = new Set(riderData.activeRiders.map(r => r.toLowerCase()));
      const previousRidersSet = previousRiderData ? new Set(previousRiderData.activeRiders.map(r => r.toLowerCase())) : new Set();
      
      const inactiveRiders = [];
      previousRidersSet.forEach(rider => {
        if (!currentRidersSet.has(rider)) {
          const original = previousRiderData.activeRiders.find(r => r.toLowerCase() === rider);
          if (original) inactiveRiders.push(original);
        }
      });

      const riderActiveCount = riderData.activeCount || 0;
      const gettingValue = previousActiveRidersCount - inactiveRiders.length + activeCount;

      let retentionRate = null;
      if (previousActiveRidersCount > 0) {
        const numerator = riderActiveCount - activeCount;
        retentionRate = (numerator / previousActiveRidersCount) * 100;
      }

      let churnRate = null;
      if (previousActiveRidersCount > 0 && inactiveRiders.length > 0) {
        churnRate = (inactiveRiders.length / previousActiveRidersCount) * 100;
      }

      return {
        ...item,
        riderActiveCount: Math.max(0, riderActiveCount),
        riderInactiveCount: inactiveRiders.length,
        gettingValue: Math.max(0, gettingValue),
        retentionRate,
        churnRate
      };
    });

    const weekYearMonthMap = new Map();
    weeklyStatsData.forEach(item => {
      const key = `${item._id.year}_${MONTHS[item._id.month - 1]}_${item._id.week}`;
      const ridersMap = new Map();
      item.activeRiders.forEach(rider => {
        ridersMap.set(rider.normalized, rider.original);
      });
      
      weekYearMonthMap.set(key, {
        week: item._id.week,
        month: MONTHS[item._id.month - 1],
        year: item._id.year,
        monthNumber: item._id.month,
        activeRiders: ridersMap,
        statusCounts: {},
        total: 0
      });
    });

    mitraData.forEach(mitra => {
      const dateToUse = parseRegisteredAt(mitra.registeredAt) || parseRegisteredAt(mitra.createdAt);
      if (!dateToUse) return;

      const monthName = MONTHS[dateToUse.getMonth()];
      const yearNum = dateToUse.getFullYear();
      const day = dateToUse.getDate();

      const existingWeeksForMonth = Array.from(weekYearMonthMap.keys())
        .filter(key => key.startsWith(`${yearNum}_${monthName}_`));

      if (existingWeeksForMonth.length === 0) return;

      let matchedWeek = null;
      existingWeeksForMonth.forEach(key => {
        const weekStr = key.split('_')[2];
        const weekNum = parseInt(weekStr.replace(/[^\d]/g, '')) || 0;
        const weekStart = (weekNum - 1) * 7 + 1;
        const weekEnd = weekNum * 7;
        
        if (day >= weekStart && day <= weekEnd) {
          matchedWeek = weekStr;
        }
      });

      if (!matchedWeek) {
        matchedWeek = existingWeeksForMonth[0].split('_')[2];
      }

      const status = mitra.mitraStatus || 'Unknown';
      const key = `${yearNum}_${monthName}_${matchedWeek}`;

      const entry = weekYearMonthMap.get(key);
      if (entry) {
        entry.statusCounts[status] = (entry.statusCounts[status] || 0) + 1;
        entry.total++;
      }
    });

    let sortedWeeklyPeriods = Array.from(weekYearMonthMap.values())
      .sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year;
        if (a.monthNumber !== b.monthNumber) return a.monthNumber - b.monthNumber;
        const weekNumA = parseInt(a.week.replace(/[^\d]/g, '')) || 0;
        const weekNumB = parseInt(b.week.replace(/[^\d]/g, '')) || 0;
        return weekNumA - weekNumB;
      });

    const mergedWeeklyData = sortedWeeklyPeriods.map((current, i) => {
      const previous = i > 0 ? sortedWeeklyPeriods[i - 1] : null;

      const currentRiders = current.activeRiders;
      const previousRiders = previous ? previous.activeRiders : new Map();

      const inactiveRiders = [];
      previousRiders.forEach((originalName, normalizedName) => {
        if (!currentRiders.has(normalizedName)) {
          inactiveRiders.push(originalName);
        }
      });

      const activeStatusCount = current.statusCounts['Active'] || 0;
      const previousActiveRidersCount = previous ? previous.activeRiders.size : 0;
      const gettingValue = previousActiveRidersCount - inactiveRiders.length + activeStatusCount;

      let retentionRate = null;
      if (previousActiveRidersCount > 0) {
        const numerator = currentRiders.size - activeStatusCount;
        retentionRate = (numerator / previousActiveRidersCount) * 100;
      }

      let churnRate = null;
      if (previousActiveRidersCount > 0 && inactiveRiders.length > 0) {
        churnRate = (inactiveRiders.length / previousActiveRidersCount) * 100;
      }

      return {
        week: current.week,
        month: current.month,
        year: current.year.toString(),
        activeCount: currentRiders.size,
        inactiveCount: inactiveRiders.length,
        statusCounts: current.statusCounts,
        total: current.total,
        gettingValue: Math.max(0, gettingValue),
        retentionRate,
        churnRate
      };
    });

    const statusCounts = {};
    mitraData.forEach(mitra => {
      const status = mitra.mitraStatus || 'Unknown';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });

    const totalMitras = mitraData.length;
    const statusDistribution = Object.entries(statusCounts).map(([status, count]) => ({
      status,
      count,
      percentage: totalMitras > 0 ? (count / totalMitras) * 100 : 0
    })).sort((a, b) => b.count - a.count);

    const dashboardData = {
      summary: {
        totalMitras,
        activeCount: statusCounts['Active'] || 0,
        trainingCount: statusCounts['Driver Training'] || 0,
        pendingCount: statusCounts['Pending Verification'] || 0,
        inactiveCount: statusCounts['Inactive'] || 0,
        bannedCount: statusCounts['Banned'] || 0
      },
      riderMetrics: {
        currentActiveRiders: mergedMonthlyData[0]?.riderActiveCount || 0,
        currentInactiveRiders: mergedMonthlyData[0]?.riderInactiveCount || 0,
        currentWeekActiveRiders: mergedWeeklyData[0]?.activeCount || 0,
        currentWeekInactiveRiders: mergedWeeklyData[0]?.inactiveCount || 0
      },
      statusDistribution,
      monthlyData: mergedMonthlyData,
      weeklyData: mergedWeeklyData,
      appliedFilters: filterSummary
    };

    console.log(`Dashboard analytics generated: ${totalMitras} mitras, ${mergedMonthlyData.length} monthly periods, ${mergedWeeklyData.length} weekly periods (Filters: year=${year || 'all'}, month=${month || 'all'}, week=${week || 'all'})`);

    res.status(200).json({
      message: "Dashboard analytics retrieved successfully",
      data: dashboardData,
      success: true
    });
  } catch (error) {
    console.error("Dashboard analytics error:", error.message);
    res.status(500).json({
      message: "Failed to generate dashboard analytics",
      error: error.message,
      success: false
    });
  }
};

module.exports = {
  uploadMitraData,
  getAllMitras,
  getAllMitrasForExport,
  getMitraDashboardStats,
  getRiderActiveInactiveStats,
  getRiderWeeklyStats,
  getActiveRidersDetails,
  getInactiveRidersDetails,
  getMitraPerformanceData,
  getAllMitraPerformanceData,
  getAllFullMitraPerformanceData,
  getDashboardAnalytics
};