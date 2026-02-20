const MitraExtended = require("../models/MitraExtended");
const ShipmentPerformance = require("../models/ShipmentPerformance");

class CacheWarmerService {
  constructor() {
    this.cache = {
      mitraExtended: null,
      shipmentData: {},
      shipmentStats: null,
      shipmentFilters: null,
      availableYears: null,
      lastUpdated: {
        mitraExtended: null,
        shipmentData: {},
        shipmentStats: null,
        shipmentFilters: null,
        availableYears: null
      },
      isWarming: {
        mitraExtended: false,
        shipmentData: {},
        shipmentStats: false,
        shipmentFilters: false,
        availableYears: false
      }
    };
  }

  async warmMitraExtendedCache() {
    if (this.cache.isWarming.mitraExtended) {
      console.log('⏳ MitraExtended cache warming already in progress');
      
      while (this.cache.isWarming.mitraExtended) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      return this.cache.mitraExtended;
    }

    try {
      this.cache.isWarming.mitraExtended = true;
      console.log('📊 Loading MitraExtended data from database...');
      const startTime = Date.now();

      const projection = {
        driver_id: 1, name: 1, phone_number: 1, city: 1, status: 1,
        attendance: 1, bank_info_provided: 1, app_version_name: 1,
        last_active: 1, hubs: 1, businesses: 1, nik: 1,
        bank_name: 1, bank_account_number: 1, bank_account_holder: 1,
        vehicle: 1, lark_status: 1, lark_tanggal_keluar_unit: 1, 
        lark_nomor_plat: 1, lark_merk_unit: 1, current_lat: 1, 
        current_lon: 1, sim_number: 1, reason: 1, updated_at: 1, _id: 0
      };

      const data = await MitraExtended.find({}, projection)
        .sort({ updated_at: -1 })
        .lean()
        .hint({ driver_id: 1 })
        .maxTimeMS(30000)
        .exec();

      this.cache.mitraExtended = data;
      this.cache.lastUpdated.mitraExtended = new Date();

      const duration = Date.now() - startTime;
      console.log(`✅ MitraExtended cache ready: ${data.length.toLocaleString()} records (${duration}ms)`);

      return data;
    } catch (error) {
      console.error('❌ MitraExtended cache warming error:', error.message);
      this.cache.mitraExtended = null;
      this.cache.lastUpdated.mitraExtended = null;
      throw error;
    } finally {
      this.cache.isWarming.mitraExtended = false;
    }
  }

  async warmShipmentCacheByYear(year) {
    const yearKey = String(year);
    
    if (this.cache.isWarming.shipmentData[yearKey]) {
      console.log(`⏳ Shipment cache for year ${year} already warming`);
      
      while (this.cache.isWarming.shipmentData[yearKey]) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      return this.cache.shipmentData[yearKey];
    }

    try {
      this.cache.isWarming.shipmentData[yearKey] = true;
      console.log(`📊 Warming shipment cache for year ${year}...`);
      const startTime = Date.now();

      const query = { delivery_date: { $regex: `/${year}$` } };
      
      const data = await ShipmentPerformance.find(query)
        .select('client_name project_name delivery_date drop_point hub order_code weight distance_km mitra_code mitra_name receiving_date vehicle_type cost sla weekly')
        .lean()
        .maxTimeMS(180000)
        .exec();

      this.cache.shipmentData[yearKey] = data;
      this.cache.lastUpdated.shipmentData[yearKey] = new Date();

      const duration = Date.now() - startTime;
      console.log(`✅ Shipment cache ready for year ${year}: ${data.length.toLocaleString()} records (${duration}ms)`);

      return data;
    } catch (error) {
      console.error(`❌ Shipment cache warming error for year ${year}:`, error.message);
      this.cache.shipmentData[yearKey] = null;
      this.cache.lastUpdated.shipmentData[yearKey] = null;
      throw error;
    } finally {
      this.cache.isWarming.shipmentData[yearKey] = false;
    }
  }

  async warmShipmentStatsCache() {
    if (this.cache.isWarming.shipmentStats) {
      console.log('⏳ Shipment stats cache warming already in progress');
      while (this.cache.isWarming.shipmentStats) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      return this.cache.shipmentStats;
    }

    try {
      this.cache.isWarming.shipmentStats = true;
      console.log('📊 Warming shipment stats cache...');

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

      this.cache.shipmentStats = result;
      this.cache.lastUpdated.shipmentStats = new Date();

      console.log('✅ Shipment stats cache ready');
      return result;
    } catch (error) {
      console.error('❌ Shipment stats cache warming error:', error.message);
      this.cache.shipmentStats = null;
      this.cache.lastUpdated.shipmentStats = null;
      throw error;
    } finally {
      this.cache.isWarming.shipmentStats = false;
    }
  }

  async warmShipmentFiltersCache() {
    if (this.cache.isWarming.shipmentFilters) {
      console.log('⏳ Shipment filters cache warming already in progress');
      while (this.cache.isWarming.shipmentFilters) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      return this.cache.shipmentFilters;
    }

    try {
      this.cache.isWarming.shipmentFilters = true;
      console.log('📊 Warming shipment filters cache...');

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

      this.cache.shipmentFilters = result;
      this.cache.lastUpdated.shipmentFilters = new Date();

      console.log('✅ Shipment filters cache ready');
      return result;
    } catch (error) {
      console.error('❌ Shipment filters cache warming error:', error.message);
      this.cache.shipmentFilters = null;
      this.cache.lastUpdated.shipmentFilters = null;
      throw error;
    } finally {
      this.cache.isWarming.shipmentFilters = false;
    }
  }

  async warmAvailableYearsCache() {
    if (this.cache.isWarming.availableYears) {
      console.log('⏳ Available years cache warming already in progress');
      while (this.cache.isWarming.availableYears) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      return this.cache.availableYears;
    }

    try {
      this.cache.isWarming.availableYears = true;
      console.log('📊 Warming available years cache...');

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

      this.cache.availableYears = availableYears;
      this.cache.lastUpdated.availableYears = new Date();

      console.log(`✅ Available years cache ready: ${availableYears.join(', ')}`);
      return availableYears;
    } catch (error) {
      console.error('❌ Available years cache warming error:', error.message);
      this.cache.availableYears = null;
      this.cache.lastUpdated.availableYears = null;
      throw error;
    } finally {
      this.cache.isWarming.availableYears = false;
    }
  }

  getCachedData(key) {
    if (key === 'mitraExtended') {
      return this.cache.mitraExtended;
    }
    if (key === 'shipmentStats') {
      return this.cache.shipmentStats;
    }
    if (key === 'shipmentFilters') {
      return this.cache.shipmentFilters;
    }
    if (key === 'availableYears') {
      return this.cache.availableYears;
    }
    return null;
  }

  setCachedData(key, data) {
    if (key === 'mitraExtended') {
      this.cache.mitraExtended = data;
      this.cache.lastUpdated.mitraExtended = new Date();
    }
  }

  getCachedShipmentByYear(year) {
    const yearKey = String(year);
    return this.cache.shipmentData[yearKey] || null;
  }

  getCacheStatus() {
    return {
      mitraExtended: {
        cached: this.cache.mitraExtended !== null,
        recordCount: this.cache.mitraExtended ? this.cache.mitraExtended.length : 0,
        lastUpdated: this.cache.lastUpdated.mitraExtended,
        isWarming: this.cache.isWarming.mitraExtended
      },
      shipmentData: Object.keys(this.cache.shipmentData).reduce((acc, year) => {
        acc[year] = {
          cached: this.cache.shipmentData[year] !== null,
          recordCount: this.cache.shipmentData[year] ? this.cache.shipmentData[year].length : 0,
          lastUpdated: this.cache.lastUpdated.shipmentData[year],
          isWarming: this.cache.isWarming.shipmentData[year] || false
        };
        return acc;
      }, {}),
      shipmentStats: {
        cached: this.cache.shipmentStats !== null,
        lastUpdated: this.cache.lastUpdated.shipmentStats,
        isWarming: this.cache.isWarming.shipmentStats
      },
      shipmentFilters: {
        cached: this.cache.shipmentFilters !== null,
        lastUpdated: this.cache.lastUpdated.shipmentFilters,
        isWarming: this.cache.isWarming.shipmentFilters
      },
      availableYears: {
        cached: this.cache.availableYears !== null,
        years: this.cache.availableYears || [],
        lastUpdated: this.cache.lastUpdated.availableYears,
        isWarming: this.cache.isWarming.availableYears
      }
    };
  }

  clearCache(type = 'all') {
    console.log(`🗑️ Clearing cache: ${type}...`);
    
    if (type === 'all' || type === 'mitraExtended') {
      this.cache.mitraExtended = null;
      this.cache.lastUpdated.mitraExtended = null;
    }
    
    if (type === 'all' || type === 'shipmentData') {
      this.cache.shipmentData = {};
      this.cache.lastUpdated.shipmentData = {};
    }
    
    if (type === 'all' || type === 'shipmentStats') {
      this.cache.shipmentStats = null;
      this.cache.lastUpdated.shipmentStats = null;
    }
    
    if (type === 'all' || type === 'shipmentFilters') {
      this.cache.shipmentFilters = null;
      this.cache.lastUpdated.shipmentFilters = null;
    }
    
    if (type === 'all' || type === 'availableYears') {
      this.cache.availableYears = null;
      this.cache.lastUpdated.availableYears = null;
    }
    
    console.log(`✅ Cache cleared: ${type}`);
  }

  async refreshCache(type = 'all') {
    console.log(`🔄 Refreshing cache: ${type}...`);
    
    if (type === 'all' || type === 'mitraExtended') {
      this.clearCache('mitraExtended');
      await this.warmMitraExtendedCache();
    }
    
    if (type === 'all' || type === 'shipmentStats') {
      this.clearCache('shipmentStats');
      await this.warmShipmentStatsCache();
    }
    
    if (type === 'all' || type === 'shipmentFilters') {
      this.clearCache('shipmentFilters');
      await this.warmShipmentFiltersCache();
    }
    
    if (type === 'all' || type === 'availableYears') {
      this.clearCache('availableYears');
      await this.warmAvailableYearsCache();
    }
    
    console.log(`✅ Cache refreshed: ${type}`);
  }

  async forceRefresh(type = 'all') {
    return await this.refreshCache(type);
  }
}

const cacheWarmerInstance = new CacheWarmerService();

module.exports = cacheWarmerInstance;