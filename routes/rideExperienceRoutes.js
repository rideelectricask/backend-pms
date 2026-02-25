const express = require("express");
const router = express.Router();
const multer = require("multer");
const rideExperienceController = require("../controllers/rideExperienceController");

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Hanya file gambar yang diizinkan"), false);
  },
});

const fotoFields = upload.fields([
  { name: "foto_odometer", maxCount: 1 },
  { name: "foto_dashboard_baterai", maxCount: 1 },
  { name: "foto_motor", maxCount: 1 },
]);

router.post("/", fotoFields, rideExperienceController.createEntry);
router.get("/", rideExperienceController.getAllEntries);
router.delete("/", rideExperienceController.deleteAllEntries);
router.get("/:id", rideExperienceController.getEntryById);
router.put("/:id", fotoFields, rideExperienceController.updateEntry);
router.delete("/:id", rideExperienceController.deleteEntry);

module.exports = router;