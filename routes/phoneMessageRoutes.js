const express = require("express");
const router = express.Router();
const multer = require("multer");
const phoneMessageController = require("../controllers/phoneMessageController");

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel"
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only Excel files are allowed"));
    }
  }
});

router.post("/upload", upload.single("file"), phoneMessageController.uploadExcel);
router.get("/all", phoneMessageController.getAllMessages);
router.delete("/all", phoneMessageController.deleteAllMessages);
router.post("/send", phoneMessageController.sendMessages);
router.get("/logs", phoneMessageController.getMessageLogs);
router.get("/export", phoneMessageController.exportMessageLogs);
router.get("/statistics", phoneMessageController.getStatistics);

module.exports = router;