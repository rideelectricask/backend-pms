const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const FOTO_LABEL_MAP = {
  odometer: "Foto_Odometer",
  dashboard_baterai: "Foto_Dashboard_Baterai",
  motor: "Foto_Motor",
};

const formatDateFolder = (tanggal) => {
  const d = tanggal ? new Date(tanggal) : new Date();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const y = d.getFullYear();
  return `${m}-${day}-${y}`;
};

const formatTimeFolder = (driverName) => {
  const now = new Date();
  let h = now.getHours();
  const min = String(now.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const safeName = (driverName || "unknown").replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
  return `${h}.${min}_${ampm}_${safeName}`;
};

const uploadFotoToCloudinary = ({ buffer, mimetype, driverName, project, tanggal, shift, fotoType }) => {
  return new Promise((resolve, reject) => {
    const safeProject = (project || "noproject").replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
    const safeShift = (shift || "noshift").replace(/\s+/g, "_");
    const dateFolder = formatDateFolder(tanggal);
    const timeFolder = formatTimeFolder(driverName);
    const fotoLabel = FOTO_LABEL_MAP[fotoType] || fotoType;
    const publicId = `ride-experience/${dateFolder}/${timeFolder}/${fotoLabel}_${safeProject}_${safeShift}`;

    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        resource_type: "image",
        overwrite: false,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({
          fileId: result.public_id,
          webViewLink: result.secure_url,
          fileName: `${fotoLabel}_${safeProject}_${safeShift}`,
        });
      }
    );

    stream.end(buffer);
  });
};

module.exports = { uploadFotoToCloudinary };