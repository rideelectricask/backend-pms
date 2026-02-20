const express = require("express");
const router = express.Router();
const {
uploadData,
getAllData,
getDataByClient,
replaceData,
appendData,
deleteData,
compareDistanceByOrderCode,
batchCompareAll,
} = require("../controllers/uploadController");

router.post("/upload", uploadData);
router.post("/append", appendData);
router.post("/replace", replaceData);
router.post("/delete", deleteData);
router.post("/compare-distance", compareDistanceByOrderCode);
router.post("/batch-compare", batchCompareAll);
router.get("/data", getAllData);
router.get("/data/:client", getDataByClient);

module.exports = router;