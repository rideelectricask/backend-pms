const XLSX = require("xlsx");
const PhoneMessage = require("../models/PhoneMessage");
const MessageLog = require("../models/MessageLog");

const WAHA_SERVICE_URL = process.env.WAHA_SERVICE_URL || "https://gallant-wonder-production-01e0.up.railway.app";
const WAHA_API_KEY = process.env.WAHA_API_KEY || "1c67560aad774aa7a5f7fdf28ae01ae7";

const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;
const MIN_MESSAGE_DELAY = 30000;
const MAX_MESSAGE_DELAY = 60000;
const REQUEST_TIMEOUT = 30000;
const TYPING_DELAY_PER_CHAR = 50;
const MIN_TYPING_DELAY = 2000;
const MAX_TYPING_DELAY = 8000;

function normalizePhone(phone) {
  const cleaned = phone.replace(/\D/g, '');
  
  if (cleaned.startsWith('62')) {
    return cleaned;
  } else if (cleaned.startsWith('0')) {
    return '62' + cleaned.substring(1);
  } else if (cleaned.startsWith('8')) {
    return '62' + cleaned;
  }
  
  return cleaned;
}

function getRandomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function calculateTypingDelay(message) {
  const baseDelay = Math.min(message.length * TYPING_DELAY_PER_CHAR, MAX_TYPING_DELAY);
  return Math.max(baseDelay, MIN_TYPING_DELAY);
}

function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT) {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), timeout)
    )
  ]);
}

async function sendSeen(chatId) {
  try {
    await fetchWithTimeout(
      `${WAHA_SERVICE_URL}/api/sendSeen`,
      {
        method: "POST",
        headers: {
          "x-api-key": WAHA_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chatId: chatId,
          session: "default"
        })
      },
      10000
    );
  } catch (error) {
    console.warn(`Failed to send seen for ${chatId}:`, error.message);
  }
}

async function startTyping(chatId) {
  try {
    await fetchWithTimeout(
      `${WAHA_SERVICE_URL}/api/startTyping`,
      {
        method: "POST",
        headers: {
          "x-api-key": WAHA_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chatId: chatId,
          session: "default"
        })
      },
      10000
    );
  } catch (error) {
    console.warn(`Failed to start typing for ${chatId}:`, error.message);
  }
}

async function stopTyping(chatId) {
  try {
    await fetchWithTimeout(
      `${WAHA_SERVICE_URL}/api/stopTyping`,
      {
        method: "POST",
        headers: {
          "x-api-key": WAHA_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chatId: chatId,
          session: "default"
        })
      },
      10000
    );
  } catch (error) {
    console.warn(`Failed to stop typing for ${chatId}:`, error.message);
  }
}

async function verifyMessageDelivery(messageId, retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetchWithTimeout(
        `${WAHA_SERVICE_URL}/api/messages/${messageId}`,
        {
          method: "GET",
          headers: {
            "x-api-key": WAHA_API_KEY,
            "Accept": "application/json"
          }
        },
        10000
      );

      if (response.ok) {
        const data = await response.json();
        return {
          verified: true,
          status: data.ack || data.status || 'unknown',
          data: data
        };
      }
    } catch (error) {
      if (i === retries - 1) {
        return { verified: false, status: 'verification_failed' };
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  return { verified: false, status: 'verification_failed' };
}

async function sendWhatsAppMessageWithHumanBehavior(phone, message, retryCount = 0) {
  const chatId = `${phone}@c.us`;
  
  try {
    await sendSeen(chatId);
    await new Promise(resolve => setTimeout(resolve, getRandomDelay(500, 1500)));
    
    await startTyping(chatId);
    
    const typingDelay = calculateTypingDelay(message);
    await new Promise(resolve => setTimeout(resolve, typingDelay));
    
    await stopTyping(chatId);
    await new Promise(resolve => setTimeout(resolve, getRandomDelay(300, 800)));
    
    console.log(`[SEND] Attempting to send to ${phone} (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);
    
    const response = await fetchWithTimeout(
      `${WAHA_SERVICE_URL}/api/sendText`,
      {
        method: "POST",
        headers: {
          "x-api-key": WAHA_API_KEY,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          chatId: chatId,
          text: message,
          session: "default"
        })
      },
      45000
    );

    console.log(`[RESPONSE] Status ${response.status} for ${phone}`);

    let responseData;
    try {
      responseData = await response.json();
      console.log(`[RESPONSE_DATA] ${phone}:`, JSON.stringify(responseData).substring(0, 200));
    } catch (parseError) {
      console.error(`[PARSE_ERROR] Failed to parse response for ${phone}:`, parseError.message);
      
      if (response.status >= 200 && response.status < 300) {
        console.log(`[SUCCESS_ASSUMED] Response OK but parse failed for ${phone}, assuming success`);
        return {
          success: true,
          data: { status: 'assumed_success' },
          messageId: 'parse_error_but_ok',
          verified: false,
          deliveryStatus: 'unknown'
        };
      }
      
      throw new Error(`Response parse error: ${parseError.message}`);
    }

    if ((response.status >= 200 && response.status < 300) || responseData.id || responseData.messageId) {
      console.log(`[SUCCESS] Message sent to ${phone}`);
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      let messageId = responseData.id || responseData.messageId;
      
      if (messageId && typeof messageId === 'object') {
        console.log(`[MESSAGE_ID_OBJECT] ${phone}:`, messageId);
        messageId = messageId.id || messageId._serialized || JSON.stringify(messageId);
      }
      
      let verificationResult = { verified: false };
      
      if (messageId && typeof messageId === 'string') {
        verificationResult = await verifyMessageDelivery(messageId);
      }

      return {
        success: true,
        data: responseData,
        messageId: messageId || 'unknown',
        verified: verificationResult.verified,
        deliveryStatus: verificationResult.status
      };
    }

    console.log(`[FAILED] Message failed for ${phone}, status: ${response.status}, error: ${responseData.message || responseData.error}`);

    const errorMessage = responseData.message || responseData.error || '';
    const isNotRegistered = 
      response.status === 404 ||
      errorMessage.toLowerCase().includes('participant not found') ||
      errorMessage.toLowerCase().includes('jid not found') ||
      errorMessage.toLowerCase().includes('not exists');

    if (isNotRegistered) {
      console.log(`[NOT_REGISTERED] ${phone} - Number not on WhatsApp`);
      return {
        success: false,
        error: "Number not registered on WhatsApp",
        code: "NOT_REGISTERED",
        data: responseData,
        shouldRetry: false,
        isNotRegistered: true
      };
    }

    if (response.status === 429 && retryCount < MAX_RETRIES) {
      const retryDelay = RETRY_DELAY * (retryCount + 2);
      console.log(`[RETRY_429] Rate limit for ${phone}, retrying in ${retryDelay}ms`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      return sendWhatsAppMessageWithHumanBehavior(phone, message, retryCount + 1);
    }

    if (response.status >= 500 && retryCount < MAX_RETRIES) {
      const retryDelay = RETRY_DELAY * (retryCount + 1);
      console.log(`[RETRY_5XX] Server error for ${phone}, retrying in ${retryDelay}ms`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      return sendWhatsAppMessageWithHumanBehavior(phone, message, retryCount + 1);
    }
    
    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        error: "WhatsApp session not authenticated. Please scan QR code.",
        code: "SESSION_UNAUTHORIZED",
        data: responseData,
        shouldRetry: false
      };
    }

    return {
      success: false,
      error: responseData.message || responseData.error || `HTTP ${response.status}`,
      code: response.status.toString(),
      data: responseData,
      shouldRetry: response.status >= 500 || response.status === 429
    };

  } catch (error) {
    console.error(`[EXCEPTION] Error sending to ${phone}:`, error.message);
    
    const isRetryable = error.message === 'Request timeout' || error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET';
    
    if (retryCount < MAX_RETRIES && isRetryable) {
      const retryDelay = RETRY_DELAY * (retryCount + 1);
      console.log(`[RETRY_TIMEOUT] Timeout for ${phone}, retrying in ${retryDelay}ms`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      return sendWhatsAppMessageWithHumanBehavior(phone, message, retryCount + 1);
    }

    return {
      success: false,
      error: error.message,
      code: error.code || 'NETWORK_ERROR',
      shouldRetry: isRetryable && retryCount < MAX_RETRIES
    };
  }
}

exports.uploadExcel = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded"
      });
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    if (data.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Excel file is empty"
      });
    }

    const phoneMessages = data.map(row => ({
      phone: row.phone || row.Phone || "",
      message: row.message || row.Message || "",
      deliveryStatus: "pending"
    })).filter(item => item.phone && item.message);

    if (phoneMessages.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid phone and message data found in Excel"
      });
    }

    await PhoneMessage.deleteMany({});
    await MessageLog.deleteMany({});
    
    const result = await PhoneMessage.insertMany(phoneMessages);

    res.json({
      success: true,
      message: `Successfully uploaded ${result.length} records`,
      count: result.length,
      warning: "⚠️ IMPORTANT: Use SAFE MODE to avoid account restrictions. Send max 20-30 messages per hour with breaks."
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to upload Excel file",
      error: error.message
    });
  }
};

exports.getAllMessages = async (req, res) => {
  try {
    const messages = await PhoneMessage.find().sort({ uploadedAt: -1 });
    res.json({
      success: true,
      count: messages.length,
      data: messages
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch messages",
      error: error.message
    });
  }
};

exports.deleteAllMessages = async (req, res) => {
  try {
    await PhoneMessage.deleteMany({});
    await MessageLog.deleteMany({});
    res.json({
      success: true,
      message: "All messages and logs deleted successfully"
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to delete messages",
      error: error.message
    });
  }
};

exports.sendMessages = async (req, res) => {
  try {
    // FIX: Dynamic import untuk kompatibilitas ESM/CJS
    const { v4: uuidv4 } = await import("uuid");

    const { customMessage, safeMode = true, messagesPerBatch = 20 } = req.body;

    await PhoneMessage.updateMany(
      { deliveryStatus: { $exists: false } },
      { $set: { deliveryStatus: "pending" } }
    );

    const processedPhones = await MessageLog.find({ 
      status: { $in: ["success", "failed"] }
    }).distinct("normalizedPhone");

    const allMessages = await PhoneMessage.find().sort({ uploadedAt: -1 });
    
    const messagesToSend = allMessages.filter(msg => {
      const normalized = normalizePhone(msg.phone);
      return !processedPhones.includes(normalized);
    });

    if (messagesToSend.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No pending messages found. All contacts have been processed (either SENT or FAILED)."
      });
    }

    if (!safeMode && messagesToSend.length > 50) {
      return res.status(400).json({
        success: false,
        message: "⚠️ UNSAFE MODE blocked for bulk sending. Use SAFE MODE to prevent account restriction.",
        recommendation: "Enable Safe Mode and send max 20-30 messages per batch with 1 hour breaks."
      });
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const batchId = uuidv4();
    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let processedCount = 0;

    const sendProgress = (data) => {
      res.write(JSON.stringify(data) + '\n');
    };

    const totalToSend = safeMode ? Math.min(messagesToSend.length, messagesPerBatch) : messagesToSend.length;

    sendProgress({
      type: 'start',
      total: totalToSend,
      batchId: batchId,
      safeMode: safeMode,
      warning: safeMode ? `Safe Mode: Sending ${totalToSend} messages with human-like delays (30-60s between messages)` : "Unsafe Mode: Faster but risky"
    });

    const messagesToProcess = messagesToSend.slice(0, totalToSend);

    for (const msg of messagesToProcess) {
      const phone = msg.phone.trim();
      const normalizedPhone = normalizePhone(phone);
      let textToSend = customMessage && customMessage.trim() ? customMessage : msg.message;

      const existingLog = await MessageLog.findOne({
        normalizedPhone: normalizedPhone
      }).sort({ createdAt: -1 });

      if (existingLog && (existingLog.status === "success" || existingLog.status === "failed")) {
        skippedCount++;
        processedCount++;
        sendProgress({
          type: 'progress',
          phone: normalizedPhone,
          status: 'skipped',
          processed: processedCount,
          total: totalToSend,
          successCount,
          failedCount,
          skippedCount,
          message: existingLog.status === "success" ? 'Already sent successfully' : 'Previously failed - will not retry'
        });
        continue;
      }

      sendProgress({
        type: 'progress',
        phone: normalizedPhone,
        status: 'sending',
        processed: processedCount,
        total: totalToSend,
        message: safeMode ? 'Simulating human behavior (seen → typing → send)...' : 'Sending...'
      });

      const sendResult = await sendWhatsAppMessageWithHumanBehavior(normalizedPhone, textToSend);

      if (sendResult.success) {
        let wahaMessageId = sendResult.messageId;
        
        if (wahaMessageId && typeof wahaMessageId === 'object') {
          wahaMessageId = wahaMessageId.id || wahaMessageId._serialized || 'object_type';
        }

        console.log(`[SAVE_SUCCESS_LOG] ${normalizedPhone} - MessageID: ${wahaMessageId}`);

        try {
          await MessageLog.create({
            phone: phone,
            normalizedPhone: normalizedPhone,
            message: textToSend,
            status: "success",
            attempts: 1,
            lastAttemptAt: new Date(),
            successAt: new Date(),
            isWhatsAppRegistered: true,
            batchId: batchId,
            wahaResponse: sendResult.data,
            wahaMessageId: wahaMessageId || 'unknown',
            actualDeliveryStatus: sendResult.deliveryStatus
          });

          await PhoneMessage.updateOne(
            { _id: msg._id },
            { $set: { deliveryStatus: "sent" } }
          );

          successCount++;
        } catch (logError) {
          console.error(`[LOG_ERROR] Failed to save success log for ${normalizedPhone}:`, logError.message);
          
          await MessageLog.create({
            phone: phone,
            normalizedPhone: normalizedPhone,
            message: textToSend,
            status: "success",
            attempts: 1,
            lastAttemptAt: new Date(),
            successAt: new Date(),
            isWhatsAppRegistered: true,
            batchId: batchId,
            wahaResponse: null,
            wahaMessageId: 'log_error',
            actualDeliveryStatus: 'unknown'
          });
          
          successCount++;
        }
        
        processedCount++;
        sendProgress({
          type: 'progress',
          phone: normalizedPhone,
          status: 'success',
          processed: processedCount,
          total: totalToSend,
          successCount,
          failedCount,
          skippedCount,
          messageId: wahaMessageId
        });
      } else {
        const isSessionError = sendResult.code === "SESSION_UNAUTHORIZED" || 
          sendResult.code === '401' || 
          sendResult.code === '403';

        const isNotRegistered = sendResult.isNotRegistered === true || 
          sendResult.code === "NOT_REGISTERED";

        let finalStatus = "failed";
        let errorReason = sendResult.error || 'Unknown error';
        let errorCode = sendResult.code || 'UNKNOWN';

        console.log(`[SAVE_FAILED_LOG] ${normalizedPhone} - Status: ${finalStatus}, Error: ${errorReason}, Code: ${errorCode}`);

        try {
          await MessageLog.create({
            phone: phone,
            normalizedPhone: normalizedPhone,
            message: textToSend,
            status: finalStatus,
            attempts: 1,
            lastAttemptAt: new Date(),
            errorMessage: errorReason,
            errorCode: errorCode,
            isWhatsAppRegistered: isNotRegistered ? false : null,
            batchId: batchId,
            wahaResponse: sendResult.data
          });

          await PhoneMessage.updateOne(
            { _id: msg._id },
            { $set: { deliveryStatus: "failed" } }
          );

          failedCount++;
        } catch (logError) {
          console.error(`[LOG_ERROR] Failed to save error log for ${normalizedPhone}:`, logError.message);
          
          await MessageLog.create({
            phone: phone,
            normalizedPhone: normalizedPhone,
            message: textToSend,
            status: "failed",
            attempts: 1,
            lastAttemptAt: new Date(),
            errorMessage: `Log save error: ${logError.message}`,
            errorCode: 'LOG_ERROR',
            isWhatsAppRegistered: null,
            batchId: batchId,
            wahaResponse: null
          });
          
          failedCount++;
        }

        processedCount++;
        sendProgress({
          type: 'progress',
          phone: normalizedPhone,
          status: 'failed',
          error: errorReason,
          errorCode: errorCode,
          processed: processedCount,
          total: totalToSend,
          successCount,
          failedCount,
          skippedCount
        });
        
        if (isSessionError) {
          sendProgress({
            type: 'error',
            error: '⚠️ CRITICAL: WhatsApp session not authenticated. Please scan QR code in WAHA Controls section and retry.',
            stopBatch: true
          });
          break;
        }
      }

      if (processedCount < totalToSend) {
        const delay = safeMode ? getRandomDelay(MIN_MESSAGE_DELAY, MAX_MESSAGE_DELAY) : getRandomDelay(3000, 5000);
        sendProgress({
          type: 'waiting',
          phone: normalizedPhone,
          delay: Math.floor(delay / 1000),
          message: safeMode ? `Waiting ${Math.floor(delay / 1000)}s before next message (human-like pattern)...` : `Waiting ${Math.floor(delay / 1000)}s...`
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    const remainingMessages = messagesToSend.length - totalToSend;
    const recommendation = remainingMessages > 0 
      ? `⏰ ${remainingMessages} messages remaining. Wait 1 hour before sending next batch to avoid restrictions.`
      : "✅ All pending messages processed.";

    sendProgress({
      type: 'complete',
      batchId: batchId,
      total: totalToSend,
      successCount,
      failedCount,
      skippedCount,
      remainingMessages,
      message: `Completed: ${successCount} sent, ${failedCount} failed (permanent), ${skippedCount} skipped`,
      recommendation
    });

    res.end();

  } catch (error) {
    console.error("Send messages error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Failed to send messages",
        error: error.message
      });
    } else {
      res.write(JSON.stringify({
        type: 'error',
        error: error.message
      }) + '\n');
      res.end();
    }
  }
};

exports.getMessageLogs = async (req, res) => {
  try {
    const { status, batchId } = req.query;
    
    const filter = {};
    if (status && status !== 'all') filter.status = status;
    if (batchId) filter.batchId = batchId;

    const logs = await MessageLog.find(filter).sort({ createdAt: -1 }).limit(1000);

    res.json({
      success: true,
      count: logs.length,
      data: logs
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch message logs",
      error: error.message
    });
  }
};

exports.exportMessageLogs = async (req, res) => {
  try {
    const { batchId } = req.query;
    
    const filter = batchId ? { batchId } : {};
    const logs = await MessageLog.find(filter).sort({ createdAt: -1 });

    const exportData = logs.map(log => ({
      "Phone Number": log.phone,
      "Normalized Phone": log.normalizedPhone,
      "Message": log.message,
      "Status": log.status.toUpperCase(),
      "Attempts": log.attempts,
      "WhatsApp Registered": log.isWhatsAppRegistered === null ? "Unknown" : log.isWhatsAppRegistered ? "Yes" : "No",
      "Error Message": log.errorMessage || "-",
      "Error Code": log.errorCode || "-",
      "Last Attempt": log.lastAttemptAt ? new Date(log.lastAttemptAt).toLocaleString() : "-",
      "Success Time": log.successAt ? new Date(log.successAt).toLocaleString() : "-",
      "Batch ID": log.batchId,
      "Message ID": log.wahaMessageId || "-",
      "Delivery Status": log.actualDeliveryStatus || "-"
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Message Logs");

    const excelBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=message-logs-${Date.now()}.xlsx`);
    res.send(excelBuffer);

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to export message logs",
      error: error.message
    });
  }
};

exports.getStatistics = async (req, res) => {
  try {
    const { batchId } = req.query;
    
    const filter = batchId ? { batchId } : {};

    const stats = await MessageLog.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 }
        }
      }
    ]);

    const result = {
      total: 0,
      success: 0,
      failed: 0,
      pending: 0
    };

    stats.forEach(stat => {
      result[stat._id] = stat.count;
      result.total += stat.count;
    });

    const latestBatch = await MessageLog.findOne(filter).sort({ createdAt: -1 });

    res.json({
      success: true,
      statistics: result,
      latestBatchId: latestBatch ? latestBatch.batchId : null
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch statistics",
      error: error.message
    });
  }
};