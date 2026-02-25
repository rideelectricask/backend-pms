const express = require('express');
const https = require('https');
const querystring = require('querystring');
const ExcelJS = require('exceljs');
const LarkConfig = require('../models/LarkConfig');
const { refreshTokenIfNeeded, forceRefreshTokens } = require('../services/larkTokenService');

const router = express.Router();

class LarkSuiteClient {
  constructor(tenantAccessToken, userAccessToken) {
    this.tenantAccessToken = tenantAccessToken;
    this.userAccessToken = userAccessToken;
    this.baseUrl = 'open.larksuite.com';
  }

  async getRecords(appToken, tableId, options = {}) {
    const {
      viewId,
      filter,
      sort,
      fieldNames,
      textFieldAsArray = false,
      userIdType = 'open_id',
      displayFormulaRef = false,
      automaticFields = false,
      pageToken,
      pageSize = 1
    } = options;

    const queryParams = {};

    if (viewId) queryParams.view_id = viewId;
    if (filter) queryParams.filter = filter;
    if (sort) queryParams.sort = JSON.stringify(sort);
    if (fieldNames) queryParams.field_names = JSON.stringify(fieldNames);
    if (textFieldAsArray) queryParams.text_field_as_array = textFieldAsArray;
    if (userIdType) queryParams.user_id_type = userIdType;
    if (displayFormulaRef) queryParams.display_formula_ref = displayFormulaRef;
    if (automaticFields) queryParams.automatic_fields = automaticFields;
    if (pageToken) queryParams.page_token = pageToken;
    if (pageSize) queryParams.page_size = pageSize;

    const queryString = querystring.stringify(queryParams);
    const path = `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records${queryString ? '?' + queryString : ''}`;

    const options_req = {
      hostname: this.baseUrl,
      path: path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.tenantAccessToken}`,
        'Content-Type': 'application/json; charset=utf-8'
      }
    };

    return new Promise((resolve, reject) => {
      const req = https.request(options_req, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            if (response.code === 0) {
              resolve(response.data);
            } else {
              reject(new Error(`API Error: ${response.code} - ${response.msg}`));
            }
          } catch (error) {
            reject(new Error(`Parse Error: ${error.message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Request Error: ${error.message}`));
      });

      req.end();
    });
  }

  async getAllRecords(appToken, tableId, options = {}) {
    const allRecords = [];
    let hasMore = true;
    let pageToken = null;
    let requestCount = 0;
    const maxRequests = 1000;

    console.log('Starting to fetch all Lark records...');

    while (hasMore && requestCount < maxRequests) {
      const requestOptions = { ...options, pageSize: 500 };
      if (pageToken) {
        requestOptions.pageToken = pageToken;
      }

      try {
        const response = await this.getRecords(appToken, tableId, requestOptions);
        const itemsCount = response.items?.length || 0;
        
        allRecords.push(...(response.items || []));
        hasMore = response.has_more;
        pageToken = response.page_token;
        requestCount++;

        console.log(`Fetched batch ${requestCount}: ${itemsCount} records (Total: ${allRecords.length})`);

        if (hasMore && pageToken) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      } catch (error) {
        console.error(`Error fetching batch ${requestCount}:`, error.message);
        
        if (error.message.includes('Missing access token')) {
          throw error;
        }
        
        if (requestCount < 3) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
        
        throw error;
      }
    }

    console.log(`Completed fetching all records: ${allRecords.length} total`);
    return allRecords;
  }
}

class DataProcessor {
  static formatValue(value) {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) {
      if (value.length === 0) return '';
      if (typeof value[0] === 'object' && value[0].name) {
        return value.map(item => item.name).join(', ');
      }
      if (typeof value[0] === 'object' && value[0].file_token) {
        return value.map(item => item.name || 'File').join(', ');
      }
      return value.join(', ');
    }
    if (typeof value === 'object' && value.name) return value.name;
    if (typeof value === 'object' && value.file_token) return value.name || 'File';
    if (typeof value === 'number' && value > 1000000000) {
      return new Date(value).toLocaleDateString('id-ID');
    }
    return String(value);
  }

  static getFileUrls(value) {
    if (!value || !Array.isArray(value)) return [];
    return value.map(file => ({
      name: file.name || 'File',
      url: file.url || file.tmp_url,
      type: file.type
    }));
  }

  static calculateUsageDays(tanggalKeluar, tanggalMasuk) {
    if (!tanggalKeluar || !tanggalMasuk) return '';

    try {
      let keluarDate, masukDate;

      if (typeof tanggalKeluar === 'number') {
        keluarDate = new Date(tanggalKeluar);
      } else if (typeof tanggalKeluar === 'string') {
        const parts = tanggalKeluar.split('/');
        if (parts.length === 3) {
          keluarDate = new Date(parts[2], parts[1] - 1, parts[0]);
        } else {
          keluarDate = new Date(tanggalKeluar);
        }
      } else {
        return '';
      }

      if (typeof tanggalMasuk === 'number') {
        masukDate = new Date(tanggalMasuk);
      } else if (typeof tanggalMasuk === 'string') {
        const parts = tanggalMasuk.split('/');
        if (parts.length === 3) {
          masukDate = new Date(parts[2], parts[1] - 1, parts[0]);
        } else {
          masukDate = new Date(tanggalMasuk);
        }
      } else {
        return '';
      }

      if (isNaN(keluarDate.getTime()) || isNaN(masukDate.getTime())) return '';
      if (masukDate <= keluarDate) return '';

      const diffTime = masukDate.getTime() - keluarDate.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      return diffDays > 0 ? `${diffDays} hari` : '';
    } catch (error) {
      return '';
    }
  }

  static processRecords(records) {
    const fieldsToShow = [
      { key: 'SN', label: 'No.', type: 'text' },
      { key: 'NAMA LENGKAP USER SESUAI KTP', label: 'Nama Lengkap', type: 'text' },
      { key: 'NIK USER', label: 'NIK', type: 'text' },
      { key: 'NOMOR PLAT', label: 'Nomor Plat', type: 'text' },
      { key: 'MERK UNIT', label: 'Merk Unit', type: 'text' },
      { key: 'KOTA TEMPAT TINGGAL USER', label: 'Kota', type: 'text' },
      { key: 'NOMOR SIM C USER', label: 'SIM C', type: 'text' },
      { key: 'ALAMAT LENGKAP USER', label: 'Alamat', type: 'text' },
      { key: 'No Telp User', label: 'No Telepon', type: 'text' },
      { key: 'NAMA PROJECT', label: 'Nama Project', type: 'text' },
      { key: 'PIC PENANGGUNGJAWAB', label: 'PIC', type: 'text' },
      { key: 'TANGGAL KELUAR UNIT', label: 'Tanggal Keluar Unit', type: 'date' },
      { key: 'Submitted on', label: 'Tanggal Submit', type: 'date' },
      { key: 'STATUS', label: 'Status', type: 'text' },
      { key: 'CATATAN TAMBAHAN', label: 'Catatan', type: 'text' },
      { key: 'KELENGKAPAN UNIT', label: 'Kelengkapan Unit', type: 'text' },
      { key: 'KTP ASLI', label: 'KTP', type: 'file' },
      { key: 'KK', label: 'KK', type: 'file' },
      { key: 'SIM C ASLI', label: 'SIM C', type: 'file' },
      { key: 'SKCK', label: 'SKCK', type: 'file' },
      { key: 'SURAT KETERANGAN DOMISILI', label: 'Surat Domisili', type: 'file' },
      { key: 'STNK UNIT', label: 'STNK Unit', type: 'file' },
      { key: 'FOTO UNIT BERSAMA USER', label: 'Foto Unit', type: 'file' },
      { key: 'BAST', label: 'BAST', type: 'file' },
      { key: 'Surat Pernyataan Peminjaman', label: 'Surat Pernyataan', type: 'file' }
    ];

    const processedData = records.map(record => {
      const processedRecord = {};

      fieldsToShow.forEach(field => {
        let value = record.fields[field.key];

        if (field.key === 'MERK UNIT' && this.formatValue(value) === 'LAINNYA') {
          const customValue = record.fields['MERK UNIT-LAINNYA-Text'];
          if (customValue) value = customValue;
        }

        if (field.key === 'KOTA TEMPAT TINGGAL USER' && this.formatValue(value) === 'Lainnya') {
          const customValue = record.fields['KOTA TEMPAT TINGGAL USER-Lainnya-Text'];
          if (customValue) value = customValue;
        }

        if (field.type === 'file') {
          processedRecord[field.key] = this.getFileUrls(value);
          processedRecord[`${field.key}_display`] = this.formatValue(value);
        } else {
          processedRecord[field.key] = this.formatValue(value);
        }
      });
      processedRecord.record_id = record.record_id;
      return processedRecord;
    });

    return { fields: fieldsToShow, data: processedData };
  }

  static processActiveData(activeData, inactiveData) {
    const activeFields = [
      { key: 'SN', label: 'No.', type: 'text' },
      { key: 'TANGGAL KELUAR UNIT', label: 'Tanggal Keluar Unit', type: 'date' },
      { key: 'NAMA LENGKAP USER SESUAI KTP', label: 'Nama Lengkap', type: 'text' },
      { key: 'NIK USER', label: 'NIK', type: 'text' },
      { key: 'NOMOR PLAT', label: 'Nomor Plat', type: 'text' },
      { key: 'MERK UNIT', label: 'Merk Unit', type: 'text' },
      { key: 'NOMOR SIM C USER', label: 'SIM C', type: 'text' },
      { key: 'ALAMAT LENGKAP USER', label: 'Alamat', type: 'text' },
      { key: 'KOTA TEMPAT TINGGAL USER', label: 'Kota', type: 'text' },
      { key: 'No Telp User', label: 'No Telepon', type: 'text' },
      { key: 'NAMA PROJECT', label: 'Nama Project', type: 'text' },
      { key: 'PIC PENANGGUNGJAWAB', label: 'PIC', type: 'text' },
      { key: 'TANGGAL MASUK UNIT', label: 'Tanggal Pengembalian Unit', type: 'date' },
      { key: 'LAMA PEMAKAIAN', label: 'Lama Pemakaian', type: 'text' },
      { key: 'BIAYA KLAIM', label: 'Biaya Klaim', type: 'text' },
      { key: 'RINCIAN KERUSAKAN DAN NILAI KLAIM PER KERUSAKAN', label: 'Rincian Kerusakan', type: 'text' },
      { key: 'STATUS', label: 'Status', type: 'text' }
    ];

    console.log(`Processing ${activeData.length} active records and ${inactiveData.length} inactive records`);

    const inactiveRecordMap = new Map();
    inactiveData.forEach((record, index) => {
      const fields = record.fields || {};
      const platNomor = this.formatValue(fields['NOMOR PLAT']).trim();
      const namaLengkap = this.formatValue(fields['NAMA LENGKAP USER SESUAI KTP']).trim();
      const tanggalMasuk = fields['TANGGAL MASUK UNIT'];
      const biayaKlaim = this.formatValue(fields['BIAYA KLAIM']);
      const rincianKerusakan = this.formatValue(fields['RINCIAN KERUSAKAN DAN NILAI KLAIM PER KERUSAKAN']);

      console.log(`Inactive record ${index + 1}: Plat=${platNomor}, Nama=${namaLengkap}, TanggalMasuk=${tanggalMasuk}`);

      if (platNomor && namaLengkap && platNomor !== '-' && namaLengkap !== '-') {
        const recordKey = `${platNomor.toLowerCase()}###${namaLengkap.toLowerCase()}`;
        inactiveRecordMap.set(recordKey, { 
          tanggalMasuk, 
          platNomor, 
          namaLengkap,
          biayaKlaim,
          rincianKerusakan
        });
      }
    });

    console.log(`Created ${inactiveRecordMap.size} inactive record mappings`);

    const processedData = activeData.map((record, index) => {
      const processedRecord = {};
      const fields = record.fields || {};

      activeFields.forEach(field => {
        if (field.key === 'TANGGAL MASUK UNIT' || 
            field.key === 'LAMA PEMAKAIAN' || 
            field.key === 'STATUS' ||
            field.key === 'BIAYA KLAIM' ||
            field.key === 'RINCIAN KERUSAKAN DAN NILAI KLAIM PER KERUSAKAN') {
          return;
        }

        let value = fields[field.key];

        if (field.key === 'MERK UNIT' && this.formatValue(value) === 'LAINNYA') {
          const customValue = fields['MERK UNIT-LAINNYA-Text'];
          if (customValue) value = customValue;
        }

        if (field.key === 'KOTA TEMPAT TINGGAL USER' && this.formatValue(value) === 'Lainnya') {
          const customValue = fields['KOTA TEMPAT TINGGAL USER-Lainnya-Text'];
          if (customValue) value = customValue;
        }

        processedRecord[field.key] = this.formatValue(value);
      });

      const platNomor = this.formatValue(fields['NOMOR PLAT']).trim();
      const namaLengkap = this.formatValue(fields['NAMA LENGKAP USER SESUAI KTP']).trim();
      const tanggalKeluar = fields['TANGGAL KELUAR UNIT'];

      const recordKey = `${platNomor.toLowerCase()}###${namaLengkap.toLowerCase()}`;
      const matchedInactive = inactiveRecordMap.get(recordKey);

      const isInactive = matchedInactive !== undefined;
      processedRecord['STATUS'] = isInactive ? 'INACTIVE' : 'ACTIVE';

      if (isInactive && matchedInactive.tanggalMasuk) {
        processedRecord['TANGGAL MASUK UNIT'] = this.formatValue(matchedInactive.tanggalMasuk);
        const lamaPemakaian = this.calculateUsageDays(tanggalKeluar, matchedInactive.tanggalMasuk);
        processedRecord['LAMA PEMAKAIAN'] = lamaPemakaian;
        processedRecord['BIAYA KLAIM'] = matchedInactive.biayaKlaim || '';
        processedRecord['RINCIAN KERUSAKAN DAN NILAI KLAIM PER KERUSAKAN'] = matchedInactive.rincianKerusakan || '';
        console.log(`Match found for ${platNomor}: TanggalKeluar=${this.formatValue(tanggalKeluar)}, TanggalMasuk=${this.formatValue(matchedInactive.tanggalMasuk)}, Duration=${lamaPemakaian}`);
      } else {
        processedRecord['TANGGAL MASUK UNIT'] = '';
        processedRecord['LAMA PEMAKAIAN'] = '';
        processedRecord['BIAYA KLAIM'] = '';
        processedRecord['RINCIAN KERUSAKAN DAN NILAI KLAIM PER KERUSAKAN'] = '';
      }

      processedRecord.record_id = record.record_id;
      return processedRecord;
    });

    const inactiveCount = processedData.filter(record => record.STATUS === 'INACTIVE').length;
    console.log(`Processed ${processedData.length} records, ${inactiveCount} marked as INACTIVE`);

    return { fields: activeFields, data: processedData };
  }

  static async generateExcel(data, fields) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Larksuite Data');

    const allFields = fields.filter(field => field.key !== 'SN');
    const headers = ['No', ...allFields.map(field => field.label)];

    worksheet.addRow(headers);

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE6E6FA' }
    };

    data.forEach((record, index) => {
      const row = [
        index + 1,
        ...allFields.map(field => {
          if (field.type === 'file') {
            return record[`${field.key}_display`] || '-';
          }
          return record[field.key] || '-';
        })
      ];
      worksheet.addRow(row);
    });

    allFields.forEach((field, index) => {
      worksheet.getColumn(index + 2).width = Math.min(Math.max(field.label.length, 15), 50);
    });

    return workbook;
  }

  static generateCSV(data, fields) {
    const allFields = fields.filter(field => field.key !== 'SN');
    const headers = ['No', ...allFields.map(field => field.label)];

    let csv = headers.join(',') + '\n';

    data.forEach((record, index) => {
      const row = [
        index + 1,
        ...allFields.map(field => {
          let value;
          if (field.type === 'file') {
            value = record[`${field.key}_display`] || '-';
          } else {
            value = record[field.key] || '-';
          }
          return `"${value.toString().replace(/"/g, '""')}"`;
        })
      ];
      csv += row.join(',') + '\n';
    });

    return csv;
  }
}

async function getLarkClient() {
  const tokens = await refreshTokenIfNeeded();
  return new LarkSuiteClient(tokens.tenant_access_token, tokens.user_access_token);
}

router.get('/records', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 50;
    const appToken = 'BviZb6erxaOkK0sXrQtlCLACgEd';
    const tableId = 'tblQXkV230drxppx';

    const client = await getLarkClient();

    const data = await client.getRecords(appToken, tableId, {
      viewId: 'vew9gGopfl',
      automaticFields: true,
      pageSize: pageSize
    });

    const processedData = DataProcessor.processRecords(data.items);

    res.json({
      success: true,
      data: {
        ...data,
        processedData
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get('/records/all', async (req, res) => {
  try {
    const appToken = 'BviZb6erxaOkK0sXrQtlCLACgEd';
    const tableId = 'tblQXkV230drxppx';

    const client = await getLarkClient();

    const allRecords = await client.getAllRecords(appToken, tableId, {
      viewId: 'vew9gGopfl',
      automaticFields: true,
      pageSize: 500
    });

    const processedData = DataProcessor.processRecords(allRecords);

    res.json({
      success: true,
      data: {
        total: allRecords.length,
        items: allRecords,
        processedData
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get('/records/active', async (req, res) => {
  try {
    const appToken = 'BviZb6erxaOkK0sXrQtlCLACgEd';
    const activeTableId = 'tblQXkV230drxppx';
    const inactiveTableId = 'tblvqBF3sX44DyEj';

    const client = await getLarkClient();

    const [activeRecords, inactiveRecords] = await Promise.all([
      client.getAllRecords(appToken, activeTableId, {
        viewId: 'vew9gGopfl',
        automaticFields: true,
        pageSize: 500
      }),
      client.getAllRecords(appToken, inactiveTableId, {
        automaticFields: true,
        pageSize: 500
      })
    ]);

    console.log(`Fetched ${activeRecords.length} active records and ${inactiveRecords.length} inactive records`);

    const processedData = DataProcessor.processActiveData(activeRecords, inactiveRecords);

    res.json({
      success: true,
      data: {
        total: activeRecords.length,
        items: activeRecords,
        processedData,
        debug: {
          activeCount: activeRecords.length,
          inactiveCount: inactiveRecords.length,
          processedCount: processedData.data.length
        }
      }
    });
  } catch (error) {
    console.error('Error fetching active records:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/records/export', async (req, res) => {
  try {
    const { format = 'xlsx', data: exportData, fields } = req.body;

    if (!exportData || !Array.isArray(exportData) || !fields) {
      return res.status(400).json({
        success: false,
        error: 'Invalid export data provided'
      });
    }

    const dataToExport = exportData;
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `corefm_full_data_${timestamp}`;

    console.log(`Exporting ${dataToExport.length} records to ${format.toUpperCase()}`);

    if (format.toLowerCase() === 'xlsx') {
      const workbook = await DataProcessor.generateExcel(dataToExport, fields);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      await workbook.xlsx.write(res);
    } else if (format.toLowerCase() === 'csv') {
      const csv = DataProcessor.generateCSV(dataToExport, fields);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send(csv);
    } else {
      res.status(400).json({
        success: false,
        error: 'Unsupported format. Use xlsx or csv.'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get('/records/export', async (req, res) => {
  try {
    const { format = 'xlsx' } = req.query;
    const appToken = 'BviZb6erxaOkK0sXrQtlCLACgEd';
    const activeTableId = 'tblQXkV230drxppx';
    const inactiveTableId = 'tblvqBF3sX44DyEj';

    const client = await getLarkClient();

    const [activeRecords, inactiveRecords] = await Promise.all([
      client.getAllRecords(appToken, activeTableId, {
        viewId: 'vew9gGopfl',
        automaticFields: true,
        pageSize: 500
      }),
      client.getAllRecords(appToken, inactiveTableId, {
        automaticFields: true,
        pageSize: 500
      })
    ]);

    const processedData = DataProcessor.processActiveData(activeRecords, inactiveRecords);

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `larksuite_full_data_${timestamp}`;

    if (format.toLowerCase() === 'xlsx') {
      const workbook = await DataProcessor.generateExcel(processedData.data, processedData.fields);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      await workbook.xlsx.write(res);
    } else if (format.toLowerCase() === 'csv') {
      const csv = DataProcessor.generateCSV(processedData.data, processedData.fields);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send(csv);
    } else {
      res.status(400).json({
        success: false,
        error: 'Unsupported format. Use xlsx or csv.'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/lark/refresh-token', async (req, res) => {
  try {
    const tokens = await forceRefreshTokens();

    res.json({
      success: true,
      message: 'Lark tokens force refreshed and saved to database successfully',
      data: {
        tenant_access_token: tokens.tenant_access_token ? '***' : '',
        user_access_token: tokens.user_access_token ? '***' : '',
        app_access_token: tokens.app_access_token ? '***' : '',
        expires_in_seconds: tokens.expire || 0
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get('/records/nik-data', async (req, res) => {
  try {
    const appToken = 'BviZb6erxaOkK0sXrQtlCLACgEd';
    const activeTableId = 'tblQXkV230drxppx';
    const inactiveTableId = 'tblvqBF3sX44DyEj';

    const client = await getLarkClient();

    const [activeRecords, inactiveRecords] = await Promise.all([
      client.getAllRecords(appToken, activeTableId, {
        viewId: 'vew9gGopfl',
        automaticFields: true,
        pageSize: 500
      }),
      client.getAllRecords(appToken, inactiveTableId, {
        automaticFields: true,
        pageSize: 500
      })
    ]);

    console.log(`Fetched ${activeRecords.length} active and ${inactiveRecords.length} inactive records for NIK matching`);

    const inactiveRecordMap = new Map();
    inactiveRecords.forEach(record => {
      const fields = record.fields || {};
      const platNomor = DataProcessor.formatValue(fields['NOMOR PLAT']).trim();
      const namaLengkap = DataProcessor.formatValue(fields['NAMA LENGKAP USER SESUAI KTP']).trim();
      const tanggalMasuk = fields['TANGGAL MASUK UNIT'];

      if (platNomor && namaLengkap && platNomor !== '-' && namaLengkap !== '-') {
        const recordKey = `${platNomor.toLowerCase()}###${namaLengkap.toLowerCase()}`;
        inactiveRecordMap.set(recordKey, { 
          tanggalMasuk, 
          platNomor, 
          namaLengkap
        });
      }
    });

    console.log(`Created ${inactiveRecordMap.size} inactive record mappings`);

    const nikData = activeRecords.map(record => {
      const fields = record.fields || {};
      
      const platNomor = DataProcessor.formatValue(fields['NOMOR PLAT']).trim();
      const namaLengkap = DataProcessor.formatValue(fields['NAMA LENGKAP USER SESUAI KTP']).trim();
      const tanggalKeluar = fields['TANGGAL KELUAR UNIT'];

      const recordKey = `${platNomor.toLowerCase()}###${namaLengkap.toLowerCase()}`;
      const matchedInactive = inactiveRecordMap.get(recordKey);

      const isInactive = matchedInactive !== undefined;
      let tanggalPengembalian = '';
      let lamaPemakaian = '';
      let status = isInactive ? 'INACTIVE' : 'ACTIVE';

      if (isInactive && matchedInactive.tanggalMasuk) {
        tanggalPengembalian = DataProcessor.formatValue(matchedInactive.tanggalMasuk);
        lamaPemakaian = DataProcessor.calculateUsageDays(tanggalKeluar, matchedInactive.tanggalMasuk);
      }

      return {
        driver_name: namaLengkap || '',
        nik: DataProcessor.formatValue(fields['NIK USER']) || '',
        plat_nomor: platNomor || '',
        tanggal_keluar_unit: DataProcessor.formatValue(tanggalKeluar) || '',
        merk_unit: DataProcessor.formatValue(fields['MERK UNIT']) || '',
        alamat: DataProcessor.formatValue(fields['ALAMAT LENGKAP USER']) || '',
        tanggal_pengembalian_unit: tanggalPengembalian,
        lama_pemakaian: lamaPemakaian,
        status: status
      };
    }).filter(item => item.nik && item.nik !== '-');

    const inactiveCount = nikData.filter(item => item.status === 'INACTIVE').length;
    console.log(`NIK data prepared: ${nikData.length} records, ${inactiveCount} INACTIVE`);

    res.json({
      success: true,
      data: nikData,
      total: nikData.length,
      stats: {
        active: nikData.length - inactiveCount,
        inactive: inactiveCount
      }
    });
  } catch (error) {
    console.error('Error fetching NIK data from Lark:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;