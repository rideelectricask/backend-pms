const axios = require('axios');
const MitraExtended = require('../models/MitraExtended');
const { fetchNikFromLark } = require('../controllers/larkController');

const RIDEBLITZ_API_CONFIG = {
  BASE_URL: 'https://driver-api.rideblitz.id',
  AUTH_TOKEN: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoyNSwidXNlcl9uYW1lIjoibWVyYXBpIiwicm9sZSI6InBhbmVsIiwic2NvcGUiOlsicGFuZWwiLCJkcml2ZXJhcHAtYW5kcm9pZCJdLCJleHAiOjE3NzM5ODk0MjMsImp0aSI6Im1lcmFwaSIsImlhdCI6MTc3MTM5NzQyM30.h-RUgSerIhQFjecxDr7yUZ25zpJGCA8zMKMuadmtOaE',
  BANK_API_URL: 'https://user.rideblitz.id/v1/app/users/bank_detail/drivers',
  TIMEOUT: 15000,
  MAX_RETRIES: 1,
  RETRY_DELAY: 1000,
  BATCH_SIZE: 200,
  CONCURRENT_REQUESTS: 5
};

class CancellationToken {
  constructor() {
    this.cancelled = false;
    this.reason = null;
  }

  cancel(reason = 'Cancelled by user') {
    if (this.cancelled) return;
    this.cancelled = true;
    this.reason = reason;
    console.log(`🛑 CANCELLATION TOKEN ACTIVATED: ${reason}`);
  }

  throwIfCancelled() {
    if (this.cancelled) {
      const error = new Error(this.reason || 'Operation cancelled');
      error.isCancelled = true;
      throw error;
    }
  }

  get isCancelled() {
    return this.cancelled;
  }
}

const activeCancellationTokens = new Map();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const formatDateTime = (dateString) => {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '-';
    
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const formattedHours = hours % 12 || 12;
    
    return `${day}/${month}/${year} ${formattedHours}:${minutes}${ampm}`;
  } catch (error) {
    return '-';
  }
};

const formatDateOnly = (dateString) => {
  if (!dateString) return null;
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;
    
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    
    return `${day}/${month}/${year}`;
  } catch (error) {
    return null;
  }
};

const formatHubBusinessData = (data) => {
  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
    return '';
  }
  return Object.entries(data)
    .map(([id, name]) => `${name} (${id})`)
    .join(', ');
};

const fetchAllDriversWithPagination = async (progressCallback, cancellationToken) => {
  const allDrivers = [];
  let currentPage = 1;
  const OFFSET = 100;
  const MAX_PAGES = 100;

  cancellationToken.throwIfCancelled();

  progressCallback?.({
    stage: 'rideblitz_fetch',
    message: 'Fetching driver data from Rideblitz...',
    percentage: 5
  });

  while (currentPage <= MAX_PAGES) {
    if (cancellationToken.isCancelled) {
      console.log(`⚠️ Pagination stopped at page ${currentPage} due to cancellation`);
      break;
    }

    try {
      const axiosSource = axios.CancelToken.source();
      
      const timeoutId = setTimeout(() => {
        if (cancellationToken.isCancelled) {
          axiosSource.cancel('Request cancelled by user');
        }
      }, 100);

      const response = await axios.get(`${RIDEBLITZ_API_CONFIG.BASE_URL}/v2/panel/driver-list`, {
        params: {
          sort: -1,
          status: [1, 2, 8, 3, 4, 5, 6, 7],
          attendance: '',
          page: currentPage,
          offset: OFFSET,
          term: '',
          app_version_name: '',
          bank_info_provided: 'undefined'
        },
        headers: {
          'Authorization': RIDEBLITZ_API_CONFIG.AUTH_TOKEN,
          'Accept': 'application/json'
        },
        timeout: RIDEBLITZ_API_CONFIG.TIMEOUT,
        cancelToken: axiosSource.token
      });

      clearTimeout(timeoutId);

      cancellationToken.throwIfCancelled();

      if (response.data?.data?.driver_list_response) {
        const drivers = response.data.data.driver_list_response;
        
        if (drivers.length > 0) {
          allDrivers.push(...drivers);
          
          progressCallback?.({
            stage: 'rideblitz_fetch',
            message: `Fetched ${allDrivers.length} drivers from Rideblitz...`,
            percentage: Math.min(15, 5 + (currentPage * 0.5))
          });

          if (drivers.length < OFFSET) {
            break;
          } else {
            currentPage++;
            await sleep(300);
          }
        } else {
          break;
        }
      } else {
        break;
      }
    } catch (error) {
      if (axios.isCancel(error) || error.isCancelled || cancellationToken.isCancelled) {
        console.log(`⚠️ Driver list fetch cancelled at page ${currentPage}`);
        break;
      }
      console.error(`Error fetching page ${currentPage}:`, error.message);
      break;
    }
  }

  return allDrivers;
};

const fetchBankDetails = async (userId, cancellationToken) => {
  if (cancellationToken.isCancelled || !userId) {
    return null;
  }

  try {
    const axiosSource = axios.CancelToken.source();
    
    const checkCancellation = setInterval(() => {
      if (cancellationToken.isCancelled) {
        axiosSource.cancel('Bank fetch cancelled');
      }
    }, 100);

    const response = await axios.get(`${RIDEBLITZ_API_CONFIG.BANK_API_URL}/${userId}`, {
      headers: {
        'Authorization': RIDEBLITZ_API_CONFIG.AUTH_TOKEN,
        'Accept': 'application/json'
      },
      timeout: RIDEBLITZ_API_CONFIG.TIMEOUT,
      cancelToken: axiosSource.token
    });

    clearInterval(checkCancellation);

    if (cancellationToken.isCancelled) {
      return null;
    }

    if (response.data?.result && response.data?.data) {
      return {
        bank_name: response.data.data.bank || '',
        bank_account_number: response.data.data.account_number || '',
        bank_account_holder: response.data.data.beneficiary_name || ''
      };
    }

    return null;
  } catch (error) {
    if (axios.isCancel(error) || error.isCancelled || cancellationToken.isCancelled) {
      return null;
    }
    return null;
  }
};

const fetchDriverProfileFromRideblitz = async (driverId, userId, cancellationToken) => {
  if (cancellationToken.isCancelled) {
    return null;
  }

  try {
    const axiosSource = axios.CancelToken.source();
    
    const checkCancellation = setInterval(() => {
      if (cancellationToken.isCancelled) {
        axiosSource.cancel('Profile fetch cancelled');
      }
    }, 100);

    const response = await axios.get(`${RIDEBLITZ_API_CONFIG.BASE_URL}/panel/driver-profile/${driverId}`, {
      headers: {
        'Authorization': RIDEBLITZ_API_CONFIG.AUTH_TOKEN,
        'Accept': 'application/json'
      },
      timeout: RIDEBLITZ_API_CONFIG.TIMEOUT,
      cancelToken: axiosSource.token
    });

    clearInterval(checkCancellation);

    if (cancellationToken.isCancelled) {
      return null;
    }

    if (!response.data?.result || !response.data?.data) {
      return null;
    }

    const data = response.data.data;
    const driverProfile = data.driver_profile || {};
    const documents = driverProfile.documents || [];
    const currentCoords = data.current_cordinates || {};
    const businessHub = data.business_hub || {};

    const ktpDoc = documents.find(d => d.fields?.key === 'ktp');
    const simDoc = documents.find(d => d.fields?.key === 'sim');

    const bankDetails = await fetchBankDetails(userId, cancellationToken);

    return {
      driver_id: String(driverId),
      current_lat: currentCoords.lat || null,
      current_lon: currentCoords.lon || null,
      nik: ktpDoc?.fields?.value?.nik || '',
      sim_number: simDoc?.fields?.value?.sim || '',
      sim_expiry: simDoc?.fields?.value?.expiry_date || '',
      bank_name: bankDetails?.bank_name || '',
      bank_account_holder: bankDetails?.bank_account_holder || '',
      bank_account_number: bankDetails?.bank_account_number || '',
      hub_data: businessHub.hub_data || {},
      business_data: businessHub.business_data || {}
    };
  } catch (error) {
    if (axios.isCancel(error) || error.isCancelled || cancellationToken.isCancelled) {
      return null;
    }
    return null;
  }
};

const matchNikWithLarkData = (driverProfile, larkDataArray) => {
  if (!driverProfile.nik || !larkDataArray || larkDataArray.length === 0) {
    return null;
  }

  const cleanNik = String(driverProfile.nik).trim();
  if (!cleanNik || cleanNik === '-') return null;

  const matchedLarkRecord = larkDataArray.find(larkItem => 
    String(larkItem.nik || '').trim() === cleanNik
  );

  if (!matchedLarkRecord) return null;

  return {
    lark_tanggal_keluar_unit: matchedLarkRecord.tanggal_keluar_unit || '',
    lark_nomor_plat: matchedLarkRecord.plat_nomor || '',
    lark_merk_unit: matchedLarkRecord.merk_unit || '',
    lark_alamat: matchedLarkRecord.alamat || '',
    lark_tanggal_pengembalian_unit: matchedLarkRecord.tanggal_pengembalian_unit || '',
    lark_lama_pemakaian: matchedLarkRecord.lama_pemakaian || '',
    lark_status: matchedLarkRecord.status || '',
    lark_matched_at: new Date()
  };
};

const processBatchProfiles = async (batchIds, driverList, larkData, cancellationToken) => {
  if (cancellationToken.isCancelled) {
    return [];
  }

  const results = [];
  const concurrentLimit = RIDEBLITZ_API_CONFIG.CONCURRENT_REQUESTS;

  for (let i = 0; i < batchIds.length; i += concurrentLimit) {
    if (cancellationToken.isCancelled) {
      console.log(`⚠️ Batch processing stopped at ${i}/${batchIds.length}`);
      break;
    }

    const concurrentBatch = batchIds.slice(i, i + concurrentLimit);
    
    const promises = concurrentBatch.map(driverId => {
      const driverInfo = driverList.find(item => String(item.drivers?.id) === String(driverId));
      const userId = driverInfo?.drivers?.user_id;
      return fetchDriverProfileFromRideblitz(driverId, userId, cancellationToken);
    });

    const profiles = await Promise.all(promises);

    if (cancellationToken.isCancelled) {
      break;
    }

    for (const profile of profiles) {
      if (!profile) continue;

      const driverInfo = driverList.find(item => String(item.drivers?.id) === String(profile.driver_id));
      const driverData = driverInfo?.drivers || {};
      const accountState = driverData.account_state || {};
      
      const getStatusDisplay = (status) => {
        const statusMap = {
          'registered': 'Registered',
          'active': 'Active',
          'pending': 'Pending Verification',
          'new': 'New',
          'inactive': 'Inactive',
          'banned': 'Banned'
        };
        return statusMap[status?.toLowerCase()] || status || '-';
      };
      
      const larkMatch = matchNikWithLarkData(profile, larkData);
      
      const updateData = {
        driver_id: profile.driver_id,
        name: driverData.name || '',
        phone_number: driverData.phone_number || '',
        city: driverData.city_name || '',
        status: getStatusDisplay(accountState.status),
        attendance: driverData.attendance_status || '',
        otp: driverData.otp || '',
        bank_info_provided: driverData.bank_info_provided || false,
        app_version_name: driverData.app_version_name || '',
        app_version_code: driverData.app_version || '',
        app_android_version: driverData.app_android_version || '',
        android_version: driverData.android_version || '',
        last_active: formatDateTime(driverData.last_active),
        registered_at: formatDateTime(driverInfo?.registered_at),
        hubs: formatHubBusinessData(profile.hub_data),
        businesses: formatHubBusinessData(profile.business_data),
        reason: driverData.reason || '',
        current_lat: profile.current_lat,
        current_lon: profile.current_lon,
        nik: profile.nik,
        sim_number: profile.sim_number,
        sim_expiry: profile.sim_expiry,
        bank_name: profile.bank_name,
        bank_account_holder: profile.bank_account_holder,
        bank_account_number: profile.bank_account_number,
        hub_data: profile.hub_data,
        business_data: profile.business_data,
        lark_tanggal_keluar_unit: '',
        lark_nomor_plat: '',
        lark_merk_unit: '',
        lark_alamat: '',
        lark_tanggal_pengembalian_unit: '',
        lark_lama_pemakaian: '',
        lark_status: '',
        updated_at: new Date()
      };

      if (larkMatch) {
        Object.assign(updateData, larkMatch);
      }

      results.push(updateData);
    }
  }

  return results;
};

const manualSyncMitraExtended = async (syncId, progressCallback) => {
  const startTime = Date.now();
  const cancellationToken = new CancellationToken();
  
  activeCancellationTokens.set(syncId, cancellationToken);
  
  try {
    cancellationToken.throwIfCancelled();

    progressCallback?.({
      stage: 'init',
      message: 'Initializing sync process...',
      percentage: 0
    });

    console.log(`🔵 Starting sync ${syncId}...`);
    
    const driverList = await fetchAllDriversWithPagination(progressCallback, cancellationToken);
    
    if (cancellationToken.isCancelled) {
      throw new Error('Sync cancelled during driver fetch');
    }

    console.log(`📊 Fetched ${driverList.length} drivers from Rideblitz`);
    
    progressCallback?.({
      stage: 'lark_fetch',
      message: 'Fetching data from Larksuite...',
      percentage: 20
    });

    const larkData = await fetchNikFromLark();
    
    if (cancellationToken.isCancelled) {
      throw new Error('Sync cancelled during Lark fetch');
    }

    console.log(`📊 Fetched ${larkData.length} records from Lark`);

    progressCallback?.({
      stage: 'validation',
      message: 'Validating and transforming data...',
      percentage: 30
    });

    const driverIds = driverList
      .map(item => item.drivers?.id)
      .filter(id => id);

    console.log(`📊 Total driver IDs to process: ${driverIds.length}`);

    cancellationToken.throwIfCancelled();

    await MitraExtended.deleteMany({});
    console.log('🗑️ Cleared existing MitraExtended data');

    progressCallback?.({
      stage: 'processing',
      message: 'Processing driver profiles...',
      percentage: 35
    });

    let processedCount = 0;
    let successCount = 0;
    let larkMatchCount = 0;
    const totalDrivers = driverIds.length;

    for (let i = 0; i < totalDrivers; i += RIDEBLITZ_API_CONFIG.BATCH_SIZE) {
      if (cancellationToken.isCancelled) {
        console.log(`⚠️ Processing stopped at ${processedCount}/${totalDrivers} records`);
        console.log(`📊 Successfully saved ${successCount} records before cancellation`);
        
        const cancelError = new Error(`Sync cancelled - ${successCount} records saved`);
        cancelError.isCancelled = true;
        cancelError.successCount = successCount;
        throw cancelError;
      }

      const batchIds = driverIds.slice(i, i + RIDEBLITZ_API_CONFIG.BATCH_SIZE);
      const batchNumber = Math.floor(i / RIDEBLITZ_API_CONFIG.BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(totalDrivers / RIDEBLITZ_API_CONFIG.BATCH_SIZE);

      console.log(`🔄 Processing batch ${batchNumber}/${totalBatches} (${batchIds.length} drivers)...`);

      const batchProfiles = await processBatchProfiles(batchIds, driverList, larkData, cancellationToken);

      if (cancellationToken.isCancelled) {
        console.log(`⚠️ Batch processing cancelled`);
        console.log(`📊 Successfully saved ${successCount} records before cancellation`);
        
        const cancelError = new Error(`Sync cancelled - ${successCount} records saved`);
        cancelError.isCancelled = true;
        cancelError.successCount = successCount;
        throw cancelError;
      }

      if (batchProfiles.length > 0) {
        const bulkOps = batchProfiles.map(profile => ({
          updateOne: {
            filter: { driver_id: profile.driver_id },
            update: { $set: profile },
            upsert: true
          }
        }));

        try {
          const result = await MitraExtended.bulkWrite(bulkOps, { ordered: false });

          const batchSuccess = result.upsertedCount + result.modifiedCount;
          const batchLarkMatches = batchProfiles.filter(p => p.lark_matched_at).length;

          successCount += batchSuccess;
          larkMatchCount += batchLarkMatches;

          console.log(`✅ Batch ${batchNumber}: Saved ${batchSuccess}/${batchProfiles.length} records (Lark: ${batchLarkMatches})`);
        } catch (bulkError) {
          console.error(`❌ Batch ${batchNumber} save error:`, bulkError.message);
        }
      }

      processedCount += batchIds.length;

      const progressPercent = 35 + Math.round((processedCount / totalDrivers) * 60);
      
      if (!cancellationToken.isCancelled) {
        progressCallback?.({
          stage: 'saving',
          message: `Saving data: ${processedCount}/${totalDrivers} records processed...`,
          percentage: progressPercent,
          successCount: successCount
        });
      }

      console.log(`📊 Overall Progress: ${processedCount}/${totalDrivers} (${progressPercent}%) | Saved: ${successCount}`);

      if (i + RIDEBLITZ_API_CONFIG.BATCH_SIZE < totalDrivers && !cancellationToken.isCancelled) {
        await sleep(300);
      }
    }

    if (cancellationToken.isCancelled) {
      const cancelError = new Error(`Sync cancelled - ${successCount} records saved`);
      cancelError.isCancelled = true;
      cancelError.successCount = successCount;
      throw cancelError;
    }

    progressCallback?.({
      stage: 'finalizing',
      message: 'Finalizing sync process...',
      percentage: 95
    });

    const duration = Date.now() - startTime;
    const summary = {
      totalDrivers: driverIds.length,
      successCount,
      larkMatchCount,
      durationMs: duration,
      durationMinutes: (duration / 1000 / 60).toFixed(2),
      timestamp: new Date().toISOString(),
      aborted: false
    };

    progressCallback?.({
      stage: 'complete',
      message: `Sync completed: ${summary.successCount}/${summary.totalDrivers} records saved`,
      percentage: 100
    });

    console.log(`✅ Sync ${syncId} completed: ${summary.successCount}/${summary.totalDrivers} | Lark: ${summary.larkMatchCount} | Duration: ${summary.durationMinutes}min`);

    return summary;

  } catch (error) {
    if (error.isCancelled || cancellationToken.isCancelled || error.message.includes('cancel')) {
      const savedCount = error.successCount || 0;
      console.log(`⚠️ Sync ${syncId} CANCELLED - ${savedCount} records were saved before cancellation`);
      
      const cancelError = new Error(`Sync cancelled by user - ${savedCount} records saved`);
      cancelError.isCancelled = true;
      cancelError.successCount = savedCount;
      throw cancelError;
    }
    console.error(`❌ Sync ${syncId} failed:`, error.message);
    throw error;
  } finally {
    activeCancellationTokens.delete(syncId);
  }
};

const cancelSync = (syncId) => {
  const cancellationToken = activeCancellationTokens.get(syncId);
  if (cancellationToken) {
    cancellationToken.cancel('Cancelled by user request');
    console.log(`🛑 Cancellation requested for sync ${syncId}`);
    return true;
  }
  console.log(`⚠️ No active sync found with ID ${syncId}`);
  return false;
};

const cancelAllSyncs = () => {
  let cancelledCount = 0;
  for (const [syncId, cancellationToken] of activeCancellationTokens.entries()) {
    cancellationToken.cancel('All syncs cancelled');
    cancelledCount++;
    console.log(`🛑 Cancelled sync ${syncId}`);
  }
  activeCancellationTokens.clear();
  return cancelledCount;
};

module.exports = { 
  manualSyncMitraExtended,
  cancelSync,
  cancelAllSyncs
};