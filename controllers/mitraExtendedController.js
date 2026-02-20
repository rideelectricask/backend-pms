const MitraExtended = require('../models/MitraExtended');
const cacheWarmer = require('../services/cacheWarmer');
const { 
  manualSyncMitraExtended,
  cancelSync,
  cancelAllSyncs 
} = require('../services/mitraExtendedSyncService');

const getBulkMitraExtendedData = async (req, res) => {
  const startTime = Date.now();
  
  req.on('close', () => {
    if (!res.writableEnded) {
      console.log('⚠️ Client disconnected, aborting query...');
    }
  });
  
  try {
    console.log(`📡 Request for all MitraExtended data...`);
    
    let cachedData = cacheWarmer.getCachedData('mitraExtended');
    
    if (!cachedData) {
      console.log('📊 Cache miss - loading from database...');
      
      cachedData = await MitraExtended.find({})
        .select('driver_id name phone_number city status attendance bank_info_provided app_version_name last_active hubs businesses hub_data business_data nik bank_name bank_account_number bank_account_holder vehicle lark_status lark_nomor_plat lark_merk_unit lark_tanggal_keluar_unit lark_tanggal_pengembalian_unit lark_lama_pemakaian lark_alamat current_lat current_lon sim_number sim_expiry reason remark operating_division date_photo doc_photo registered_at updated_at')
        .lean()
        .hint({ driver_id: 1 })
        .maxTimeMS(30000)
        .exec();
      
      if (cachedData && cachedData.length > 0) {
        cacheWarmer.setCachedData('mitraExtended', cachedData);
      }
    } else {
      console.log(`📦 Cache hit - serving ${cachedData.length} records from cache`);
    }

    if (req.aborted || res.writableEnded) {
      console.log('⚠️ Request aborted by client');
      return;
    }

    if (!cachedData || cachedData.length === 0) {
      console.log('⚠️ No data found in MitraExtended collection');
      return res.status(200).json({
        success: true,
        data: [],
        pagination: {
          currentPage: 1,
          totalPages: 0,
          totalRecords: 0,
          hasNextPage: false
        },
        meta: {
          queryTime: Date.now() - startTime,
          timestamp: new Date().toISOString(),
          source: 'database'
        }
      });
    }

    const duration = Date.now() - startTime;
    console.log(`✅ Served ${cachedData.length.toLocaleString()} records in ${duration}ms`);

    return res.status(200).json({
      success: true,
      data: cachedData,
      pagination: {
        currentPage: 1,
        totalPages: 1,
        totalRecords: cachedData.length,
        hasNextPage: false
      },
      meta: {
        queryTime: duration,
        timestamp: new Date().toISOString(),
        source: cachedData ? 'cache' : 'database'
      }
    });

  } catch (error) {
    if (req.aborted || res.writableEnded) {
      console.log('⚠️ Request aborted during query execution');
      return;
    }
    
    const duration = Date.now() - startTime;
    console.error(`❌ Error after ${duration}ms:`, error.message);
    
    res.status(500).json({
      success: false,
      message: 'Failed to fetch mitra extended data',
      error: error.message,
      queryTime: duration
    });
  }
};

const manualSyncController = async (req, res) => {
  const syncId = `sync_${Date.now()}`;

  if (req.user.role !== 'owner') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Only owner role can perform manual sync.'
    });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let streamClosed = false;
  let lastSavedCount = 0;

  const sendProgress = (data) => {
    if (!streamClosed && !res.writableEnded) {
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (error) {
        console.log(`⚠️ Error sending progress: ${error.message}`);
        streamClosed = true;
      }
    }
  };

  const closeStream = () => {
    if (streamClosed || res.writableEnded) return;
    streamClosed = true;
    
    try {
      res.end();
    } catch (error) {
      console.log(`⚠️ Error closing stream: ${error.message}`);
    }
  };

  req.on('close', () => {
    console.log(`🛑 CLIENT DISCONNECTED - Cancelling sync ${syncId} immediately`);
    cancelSync(syncId);
    streamClosed = true;
  });

  req.on('error', (error) => {
    console.log(`⚠️ Request error - cancelling sync ${syncId}:`, error.message);
    cancelSync(syncId);
    streamClosed = true;
  });

  try {
    console.log(`🔄 Manual sync started by ${req.user.username} (${req.user.role}) - ID: ${syncId}`);
    
    sendProgress({
      type: 'progress',
      stage: 'init',
      message: 'Starting sync process...',
      percentage: 0,
      syncId: syncId
    });

    const result = await manualSyncMitraExtended(
      syncId,
      (progress) => {
        if (!streamClosed) {
          if (progress.successCount) {
            lastSavedCount = progress.successCount;
          }
          sendProgress({
            type: 'progress',
            ...progress,
            syncId: syncId
          });
        }
      }
    );

    if (streamClosed) {
      console.log(`⚠️ Sync ${syncId} stream already closed`);
      return;
    }

    cacheWarmer.clearCache('mitraExtended');
    await cacheWarmer.warmMitraExtendedCache();
    
    sendProgress({
      type: 'complete',
      stage: 'complete',
      message: 'Sync completed successfully',
      percentage: 100,
      syncId: syncId
    });

    console.log(`✅ Sync ${syncId} completed successfully`);
    
    setTimeout(() => {
      closeStream();
    }, 500);
    
  } catch (error) {
    console.error(`❌ Sync ${syncId} error:`, error.message);
    
    const isCancellation = error.isCancelled || 
                          error.message.includes('cancel') ||
                          streamClosed;
    
    if (!streamClosed && !res.writableEnded) {
      if (isCancellation) {
        console.log(`⚠️ Sync ${syncId} CANCELLED - but data may be partially saved`);
        
        console.log(`🔄 Refreshing cache after cancellation (${lastSavedCount} records may exist)...`);
        cacheWarmer.clearCache('mitraExtended');
        
        try {
          await cacheWarmer.warmMitraExtendedCache();
          console.log(`✅ Cache refreshed after cancellation`);
        } catch (cacheError) {
          console.error(`❌ Cache refresh failed:`, cacheError.message);
        }
        
        sendProgress({
          type: 'cancelled',
          stage: 'cancelled',
          message: `Sync cancelled - ${lastSavedCount} records saved before cancellation`,
          percentage: 0,
          syncId: syncId,
          savedCount: lastSavedCount
        });
      } else {
        sendProgress({
          type: 'error',
          stage: 'error',
          message: 'Sync failed',
          error: error.message,
          syncId: syncId
        });
      }

      setTimeout(() => {
        closeStream();
      }, 500);
    } else {
      console.log(`🔄 Stream closed - refreshing cache silently...`);
      cacheWarmer.clearCache('mitraExtended');
      cacheWarmer.warmMitraExtendedCache().catch(err => {
        console.error(`❌ Silent cache refresh failed:`, err.message);
      });
    }
  }
};

const cancelSyncEndpoint = async (req, res) => {
  try {
    if (req.user.role !== 'owner') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only owner role can cancel sync.'
      });
    }

    const { syncId } = req.body;

    if (syncId) {
      const cancelled = cancelSync(syncId);
      
      if (cancelled) {
        console.log(`✅ Sync ${syncId} cancelled via endpoint by ${req.user.username}`);
        
        console.log(`🔄 Clearing cache after manual cancellation...`);
        cacheWarmer.clearCache('mitraExtended');
        
        return res.status(200).json({
          success: true,
          message: `Sync ${syncId} cancelled successfully`,
          syncId: syncId
        });
      } else {
        return res.status(404).json({
          success: false,
          message: `Sync ${syncId} not found or already completed`,
          syncId: syncId
        });
      }
    } else {
      const cancelledCount = cancelAllSyncs();
      
      console.log(`✅ Cancelled ${cancelledCount} active sync(s) by ${req.user.username}`);
      
      console.log(`🔄 Clearing cache after cancelling all syncs...`);
      cacheWarmer.clearCache('mitraExtended');
      
      return res.status(200).json({
        success: true,
        message: `Cancelled ${cancelledCount} active sync process(es)`,
        cancelledCount
      });
    }
  } catch (error) {
    console.error('Cancel sync error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel sync',
      error: error.message
    });
  }
};

const getExtendedDataByDriverId = async (req, res) => {
  try {
    const { driver_id } = req.params;

    if (!driver_id) {
      return res.status(400).json({
        success: false,
        message: 'Driver ID is required'
      });
    }

    const extendedData = await MitraExtended.findOne({ driver_id }).lean().exec();

    if (!extendedData) {
      return res.status(404).json({
        success: false,
        message: 'Extended data not found'
      });
    }

    res.status(200).json({
      success: true,
      data: extendedData
    });

  } catch (error) {
    console.error('Error fetching extended data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch extended data',
      error: error.message
    });
  }
};

const createOrUpdateExtendedData = async (req, res) => {
  try {
    const { driver_id } = req.params;
    const updateData = req.body;

    if (!driver_id) {
      return res.status(400).json({
        success: false,
        message: 'Driver ID is required'
      });
    }

    const extendedData = await MitraExtended.findOneAndUpdate(
      { driver_id },
      { 
        $set: {
          ...updateData,
          driver_id,
          updated_at: new Date()
        }
      },
      { 
        new: true, 
        upsert: true,
        runValidators: true,
        lean: true
      }
    );

    cacheWarmer.clearCache('mitraExtended');

    res.status(200).json({
      success: true,
      message: 'Extended data saved successfully',
      data: extendedData
    });

  } catch (error) {
    console.error('Error saving extended data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save extended data',
      error: error.message
    });
  }
};

const deleteExtendedData = async (req, res) => {
  try {
    const { driver_id } = req.params;

    if (!driver_id) {
      return res.status(400).json({
        success: false,
        message: 'Driver ID is required'
      });
    }

    const deletedData = await MitraExtended.findOneAndDelete({ driver_id }).lean();

    if (!deletedData) {
      return res.status(404).json({
        success: false,
        message: 'Extended data not found'
      });
    }

    cacheWarmer.clearCache('mitraExtended');

    res.status(200).json({
      success: true,
      message: 'Extended data deleted successfully',
      data: deletedData
    });

  } catch (error) {
    console.error('Error deleting extended data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete extended data',
      error: error.message
    });
  }
};

module.exports = {
  getExtendedDataByDriverId,
  createOrUpdateExtendedData,
  deleteExtendedData,
  getBulkMitraExtendedData,
  manualSyncController,
  cancelSyncEndpoint
};