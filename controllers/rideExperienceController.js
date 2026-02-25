const RideExperience = require("../models/RideExperience");
const { uploadFotoToCloudinary } = require("../services/cloudinaryService");
const mongoose = require("mongoose");

const toNum = (v) => {
  if (v === "" || v === null || v === undefined) return undefined;
  const n = Number(v);
  return isNaN(n) ? undefined : n;
};

const toStr = (v) => {
  if (v === "" || v === null || v === undefined) return undefined;
  return String(v);
};

const sanitizeEnum = (v, allowed) => (!v || !allowed.includes(v) ? undefined : v);

const parseSub = (body, key) => {
  if (!body[key]) return {};
  try { return typeof body[key] === "string" ? JSON.parse(body[key]) : body[key]; }
  catch { return {}; }
};

const sanitizeChecklist = (raw) => {
  if (!raw) return undefined;
  const c = typeof raw === "string" ? JSON.parse(raw) : raw;
  const allowed = ["Baik", "Cukup", "Bermasalah"];
  const fields = ["rem", "ban", "lampu", "suspensi", "dashboard", "sistemKelistrikan", "frameBody", "sistemBaterai"];
  const result = {};
  for (const f of fields) {
    const v = sanitizeEnum(c[f], allowed);
    if (v) result[f] = v;
  }
  return Object.keys(result).length ? result : undefined;
};

const sanitizeRating = (raw) => {
  if (!raw) return undefined;
  const r = typeof raw === "string" ? JSON.parse(raw) : raw;
  const fields = ["kenyamananUnit", "akselerasi", "stabilitas", "efisiensiBaterai", "kepuasanOperasional"];
  const result = {};
  for (const f of fields) {
    const v = toNum(r[f]);
    if (v !== undefined) result[f] = v;
  }
  return Object.keys(result).length ? result : undefined;
};

const sanitizeRekomendasi = (raw) => {
  if (!raw) return undefined;
  const r = typeof raw === "string" ? JSON.parse(raw) : raw;
  const fields = ["layak_operasional_besok", "perlu_maintenance_ringan", "perlu_maintenance_berat", "perlu_penggantian_unit", "perlu_audit_teknis"];
  const result = {};
  for (const f of fields) {
    if (r[f] !== undefined) result[f] = r[f] === true || r[f] === "true";
  }
  return Object.keys(result).length ? result : undefined;
};

const computeKPI = (body) => {
  const { unit, baterai, checklist } = body;
  const total_km = (unit?.odometer_akhir || 0) - (unit?.odometer_awal || 0);
  const konsumsi_baterai = (baterai?.awal || 0) - (baterai?.akhir || 0);
  const efisiensi_km_per_persen = konsumsi_baterai > 0 ? total_km / konsumsi_baterai : 0;
  const issueCount = checklist ? Object.values(checklist).filter(v => v === "Bermasalah").length : 0;
  const health_score = Math.max(0, 100 - issueCount * 10);
  return { total_km, konsumsi_baterai, efisiensi_km_per_persen, health_score };
};

const buildCleanBody = (body) => {
  const unit = parseSub(body, "unit");
  const baterai = parseSub(body, "baterai");
  const kondisi_motor = parseSub(body, "kondisi_motor");
  const downtime = parseSub(body, "downtime");
  const kendala = parseSub(body, "kendala");

  return {
    driver_name: toStr(body.driver_name),
    area_operasional: toStr(body.area_operasional),
    tanggal_operasi: body.tanggal_operasi ? new Date(body.tanggal_operasi) : undefined,
    project: toStr(body.project),
    shift: sanitizeEnum(body.shift, ["Pagi", "Siang", "Malam"]),
    unit: {
      odometer_awal: toNum(unit.odometer_awal),
      odometer_akhir: toNum(unit.odometer_akhir),
    },
    baterai: {
      awal: toNum(baterai.awal),
      akhir: toNum(baterai.akhir),
      jumlah_charging: toNum(baterai.jumlah_charging),
      lokasi_charging: toStr(baterai.lokasi_charging),
    },
    kondisi_motor: {
      tarikan: sanitizeEnum(kondisi_motor.tarikan, ["Normal", "Kurang tenaga"]),
      ada_kendala: sanitizeEnum(kondisi_motor.ada_kendala, ["Ada", "Tidak"]),
      detail_kendala: toStr(kondisi_motor.detail_kendala),
    },
    downtime: {
      terjadi: sanitizeEnum(downtime.terjadi, ["Ya", "Tidak"]),
      durasi_menit: toNum(downtime.durasi_menit),
    },
    checklist: sanitizeChecklist(body.checklist),
    kendala: {
      teknis: toStr(kendala.teknis),
      keluhan_performa: toStr(kendala.keluhan_performa),
      insiden_kecelakaan: toStr(kendala.insiden_kecelakaan),
    },
    rating: sanitizeRating(body.rating),
    rekomendasi: sanitizeRekomendasi(body.rekomendasi),
  };
};

const buildPayload = (clean, kpi, foto = {}) => ({
  ...clean,
  foto,
  unit: { ...clean.unit, total_km: kpi.total_km },
  baterai: {
    ...clean.baterai,
    konsumsi_baterai: kpi.konsumsi_baterai,
    efisiensi_km_per_persen: kpi.efisiensi_km_per_persen,
  },
  kpi: { health_score: kpi.health_score },
  status_operasional_besok:
    kpi.health_score >= 80 ? "Layak"
    : kpi.health_score >= 60 ? "Perlu Maintenance"
    : "Tidak Layak",
});

const checkDbConnection = () => {
  const state = mongoose.connection.readyState;
  if (state !== 1) {
    const states = { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" };
    throw new Error(`Database tidak terhubung. Status: ${states[state] || state}`);
  }
};

const uploadFotoBackground = (entryId, files, driverName, project, tanggal, shift) => {
  const uploads = [
    { key: "odometer", field: "foto_odometer" },
    { key: "dashboard_baterai", field: "foto_dashboard_baterai" },
    { key: "motor", field: "foto_motor" },
  ];

  Promise.all(
    uploads.map(async ({ key, field }) => {
      const file = files?.[field]?.[0];
      if (!file) return null;
      try {
        const result = await uploadFotoToCloudinary({
          buffer: file.buffer,
          mimetype: file.mimetype,
          driverName,
          project,
          tanggal,
          shift,
          fotoType: key,
        });
        return { key, url: result.webViewLink };
      } catch (err) {
        console.error(`[Cloudinary] Upload ${key} gagal:`, err.message);
        return null;
      }
    })
  ).then(async (results) => {
    const foto = {};
    for (const item of results) {
      if (!item) continue;
      foto[item.key] = item.url;
    }
    if (Object.keys(foto).length > 0) {
      await RideExperience.findByIdAndUpdate(entryId, { foto });
      console.log(`[Cloudinary] Foto berhasil diupdate untuk entry ${entryId}`);
    }
  }).catch((err) => {
    console.error(`[Cloudinary] Background upload error untuk entry ${entryId}:`, err.message);
  });
};

const createEntry = async (req, res) => {
  try {
    checkDbConnection();

    const clean = buildCleanBody(req.body);
    const kpi = computeKPI(clean);

    const fotoPlaceholder = {};
    const fileKeys = { foto_odometer: "odometer", foto_dashboard_baterai: "dashboard_baterai", foto_motor: "motor" };
    for (const [field, label] of Object.entries(fileKeys)) {
      if (req.files?.[field]?.[0]) fotoPlaceholder[label] = "uploading";
    }

    const payload = buildPayload(clean, kpi, fotoPlaceholder);
    console.log("[createEntry] Menyimpan data ke MongoDB...");

    const entry = await RideExperience.create(payload);
    console.log(`[createEntry] Berhasil disimpan dengan ID: ${entry._id}`);

    if (Object.keys(fotoPlaceholder).length > 0) {
      uploadFotoBackground(entry._id, req.files, clean.driver_name, clean.project, clean.tanggal_operasi, clean.shift);
    }

    res.status(201).json({ success: true, data: entry });
  } catch (error) {
    console.error("[createEntry] ERROR:", error.message, error.stack);
    res.status(500).json({
      success: false,
      message: error.message.includes("Database") ? error.message : "Gagal menyimpan data",
      error: error.message,
    });
  }
};

const getAllEntries = async (req, res) => {
  try {
    checkDbConnection();
    const { project, from, to } = req.query;
    const filter = {};
    if (project) filter.project = project;
    if (from || to) {
      filter.tanggal_operasi = {};
      if (from) filter.tanggal_operasi.$gte = new Date(from);
      if (to) filter.tanggal_operasi.$lte = new Date(to);
    }
    console.log("[getAllEntries] Filter:", JSON.stringify(filter));
    const data = await RideExperience.find(filter).sort({ createdAt: -1 });
    console.log(`[getAllEntries] Ditemukan ${data.length} dokumen`);
    res.status(200).json({ success: true, total: data.length, data });
  } catch (error) {
    console.error("[getAllEntries] ERROR:", error.message);
    res.status(500).json({ success: false, message: "Gagal mengambil data", error: error.message });
  }
};

const getEntryById = async (req, res) => {
  try {
    checkDbConnection();
    const entry = await RideExperience.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: "Data tidak ditemukan" });
    res.status(200).json({ success: true, data: entry });
  } catch (error) {
    console.error("[getEntryById] ERROR:", error.message);
    res.status(500).json({ success: false, message: "Gagal mengambil data", error: error.message });
  }
};

const updateEntry = async (req, res) => {
  try {
    checkDbConnection();
    const clean = buildCleanBody(req.body);
    const kpi = computeKPI(clean);

    const fotoPlaceholder = {};
    const fileKeys = { foto_odometer: "odometer", foto_dashboard_baterai: "dashboard_baterai", foto_motor: "motor" };
    for (const [field, label] of Object.entries(fileKeys)) {
      if (req.files?.[field]?.[0]) fotoPlaceholder[label] = "uploading";
    }

    const updated = await RideExperience.findByIdAndUpdate(
      req.params.id,
      buildPayload(clean, kpi, fotoPlaceholder),
      { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: "Data tidak ditemukan" });

    if (Object.keys(fotoPlaceholder).length > 0) {
      uploadFotoBackground(updated._id, req.files, clean.driver_name, clean.project, clean.tanggal_operasi, clean.shift);
    }

    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    console.error("[updateEntry] ERROR:", error.message);
    res.status(500).json({ success: false, message: "Gagal memperbarui data", error: error.message });
  }
};

const deleteEntry = async (req, res) => {
  try {
    checkDbConnection();
    const deleted = await RideExperience.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: "Data tidak ditemukan" });
    res.status(200).json({ success: true, data: deleted });
  } catch (error) {
    console.error("[deleteEntry] ERROR:", error.message);
    res.status(500).json({ success: false, message: "Gagal menghapus data", error: error.message });
  }
};

const deleteAllEntries = async (req, res) => {
  try {
    checkDbConnection();
    const { project } = req.query;
    const filter = project ? { project } : {};
    const result = await RideExperience.deleteMany(filter);
    res.status(200).json({ success: true, deletedCount: result.deletedCount });
  } catch (error) {
    console.error("[deleteAllEntries] ERROR:", error.message);
    res.status(500).json({ success: false, message: "Gagal menghapus semua data", error: error.message });
  }
};

module.exports = { createEntry, getAllEntries, getEntryById, updateEntry, deleteEntry, deleteAllEntries };