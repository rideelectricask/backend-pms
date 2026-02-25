const https = require('https');
const LarkConfig = require('../models/LarkConfig');

const formatValue = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && value > 1000000000) {
    const date = new Date(value);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '';
    if (typeof value[0] === 'object' && value[0].name) {
      return value.map(item => item.name).join(', ');
    }
    return value.join(', ');
  }
  if (typeof value === 'object' && value.name) return value.name;
  return String(value);
};

const fetchNikFromLark = async () => {
  try {
    const config = await LarkConfig.findOne().sort({ createdAt: -1 }).lean();
    
    if (!config || !config.tenant_access_token) {
      throw new Error('Lark token not found');
    }

    const appToken = 'BviZb6erxaOkK0sXrQtlCLACgEd';
    const activeTableId = 'tblQXkV230drxppx';
    const inactiveTableId = 'tblvqBF3sX44DyEj';
    
    const fetchRecords = async (tableId) => {
      const allRecords = [];
      let hasMore = true;
      let pageToken = null;

      while (hasMore) {
        const records = await new Promise((resolve, reject) => {
          let path = `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=500`;
          if (pageToken) {
            path += `&page_token=${pageToken}`;
          }

          const options = {
            hostname: 'open.larksuite.com',
            path: path,
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${config.tenant_access_token}`,
              'Content-Type': 'application/json'
            },
            timeout: 30000
          };

          const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
              data += chunk;
            });

            res.on('end', () => {
              try {
                const response = JSON.parse(data);
                if (response.code === 0 && response.data) {
                  resolve(response.data);
                } else {
                  reject(new Error('Invalid Lark response'));
                }
              } catch (error) {
                reject(error);
              }
            });
          });

          req.on('error', (error) => {
            reject(error);
          });

          req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
          });

          req.end();
        });

        if (records.items && records.items.length > 0) {
          allRecords.push(...records.items);
        }

        hasMore = records.has_more || false;
        pageToken = records.page_token || null;
      }

      return allRecords;
    };

    const [activeRecords, inactiveRecords] = await Promise.all([
      fetchRecords(activeTableId),
      fetchRecords(inactiveTableId)
    ]);

    console.log(`Fetched ${activeRecords.length} active and ${inactiveRecords.length} inactive records`);

    const inactiveRecordMap = new Map();
    inactiveRecords.forEach(record => {
      const fields = record.fields || {};
      const platNomor = String(formatValue(fields['NOMOR PLAT'])).trim();
      const namaLengkap = String(formatValue(fields['NAMA LENGKAP USER SESUAI KTP'])).trim();
      const tanggalMasuk = fields['TANGGAL MASUK UNIT'];

      if (platNomor && namaLengkap && platNomor !== '-' && namaLengkap !== '-') {
        const recordKey = `${platNomor.toLowerCase()}###${namaLengkap.toLowerCase()}`;
        inactiveRecordMap.set(recordKey, { tanggalMasuk });
      }
    });

    const calculateUsageDays = (tanggalKeluar, tanggalMasuk) => {
      if (!tanggalKeluar || !tanggalMasuk) return '';

      try {
        let keluarDate, masukDate;

        if (typeof tanggalKeluar === 'string' && tanggalKeluar.includes('/')) {
          const parts = tanggalKeluar.split('/');
          if (parts.length === 3) {
            keluarDate = new Date(parts[2], parts[1] - 1, parts[0]);
          }
        } else {
          keluarDate = new Date(tanggalKeluar);
        }

        if (typeof tanggalMasuk === 'string' && tanggalMasuk.includes('/')) {
          const parts = tanggalMasuk.split('/');
          if (parts.length === 3) {
            masukDate = new Date(parts[2], parts[1] - 1, parts[0]);
          }
        } else {
          masukDate = new Date(tanggalMasuk);
        }

        if (isNaN(keluarDate.getTime()) || isNaN(masukDate.getTime())) return '';
        if (masukDate <= keluarDate) return '';

        const diffTime = masukDate.getTime() - keluarDate.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        return diffDays > 0 ? `${diffDays} hari` : '';
      } catch (error) {
        return '';
      }
    };

    const nikData = activeRecords.map(record => {
      const fields = record.fields || {};
      
      const platNomor = String(formatValue(fields['NOMOR PLAT'])).trim();
      const namaLengkap = String(formatValue(fields['NAMA LENGKAP USER SESUAI KTP'])).trim();
      const tanggalKeluar = fields['TANGGAL KELUAR UNIT'];

      const recordKey = `${platNomor.toLowerCase()}###${namaLengkap.toLowerCase()}`;
      const matchedInactive = inactiveRecordMap.get(recordKey);

      const isInactive = matchedInactive !== undefined;
      let tanggalPengembalian = '';
      let lamaPemakaian = '';
      let status = isInactive ? 'INACTIVE' : 'ACTIVE';

      if (isInactive && matchedInactive.tanggalMasuk) {
        tanggalPengembalian = formatValue(matchedInactive.tanggalMasuk);
        lamaPemakaian = calculateUsageDays(tanggalKeluar, matchedInactive.tanggalMasuk);
      }

      return {
        nik: String(formatValue(fields['NIK USER'])).trim(),
        tanggal_keluar_unit: formatValue(tanggalKeluar),
        plat_nomor: platNomor,
        merk_unit: formatValue(fields['MERK UNIT']),
        alamat: formatValue(fields['ALAMAT LENGKAP USER']),
        tanggal_pengembalian_unit: tanggalPengembalian,
        lama_pemakaian: lamaPemakaian,
        status: status
      };
    }).filter(item => item.nik && item.nik !== '-' && item.nik !== '');
    
    console.log(`NIK data prepared: ${nikData.length} records with status`);
    return nikData;
  } catch (error) {
    throw new Error(`Failed to fetch Lark data: ${error.message}`);
  }
};

module.exports = { fetchNikFromLark };