const mongoose = require("mongoose");

const ChecklistItemSchema = new mongoose.Schema({
  rem: { type: String, enum: ["Baik","Cukup","Bermasalah"] },
  ban: { type: String, enum: ["Baik","Cukup","Bermasalah"] },
  lampu: { type: String, enum: ["Baik","Cukup","Bermasalah"] },
  suspensi: { type: String, enum: ["Baik","Cukup","Bermasalah"] },
  dashboard: { type: String, enum: ["Baik","Cukup","Bermasalah"] },
  sistemKelistrikan: { type: String, enum: ["Baik","Cukup","Bermasalah"] },
  frameBody: { type: String, enum: ["Baik","Cukup","Bermasalah"] },
  sistemBaterai: { type: String, enum: ["Baik","Cukup","Bermasalah"] },
}, { _id: false });

const RatingSchema = new mongoose.Schema({
  kenyamananUnit: { type: Number, min: 1, max: 5 },
  akselerasi: { type: Number, min: 1, max: 5 },
  stabilitas: { type: Number, min: 1, max: 5 },
  efisiensiBaterai: { type: Number, min: 1, max: 5 },
  kepuasanOperasional: { type: Number, min: 1, max: 5 },
}, { _id: false });

const RideExperienceSchema = new mongoose.Schema({
  driver_name: String,
  area_operasional: String,
  tanggal_operasi: Date,
  project: String,
  shift: { type: String, enum: ["Pagi","Siang","Malam"] },
  unit: {
    odometer_awal: Number,
    odometer_akhir: Number,
    total_km: Number,
  },
  baterai: {
    awal: { type: Number, min: 0, max: 100 },
    akhir: { type: Number, min: 0, max: 100 },
    jumlah_charging: Number,
    lokasi_charging: String,
    konsumsi_baterai: Number,
    efisiensi_km_per_persen: Number,
  },
  kondisi_motor: {
    tarikan: { type: String, enum: ["Normal","Kurang tenaga"] },
    ada_kendala: { type: String, enum: ["Ada","Tidak"] },
    detail_kendala: String,
  },
  downtime: {
    terjadi: { type: String, enum: ["Ya","Tidak"] },
    durasi_menit: Number,
  },
  foto: {
    odometer: String,
    dashboard_baterai: String,
    motor: String,
  },
  checklist: ChecklistItemSchema,
  kendala: {
    teknis: String,
    keluhan_performa: String,
    insiden_kecelakaan: String,
  },
  rating: RatingSchema,
  rekomendasi: {
    layak_operasional_besok: Boolean,
    perlu_maintenance_ringan: Boolean,
    perlu_maintenance_berat: Boolean,
    perlu_penggantian_unit: Boolean,
    perlu_audit_teknis: Boolean,
  },
  kpi: { health_score: Number },
  status_operasional_besok: String,
}, { timestamps: true });

module.exports = mongoose.model("RideExperience", RideExperienceSchema);