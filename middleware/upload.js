const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directory exists
const uploadDir = path.resolve(__dirname, '../public/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Storage configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const basename = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${basename}-${uniqueSuffix}${ext}`);
  }
});

// File filter for safety
const fileFilter = (req, file, cb) => {
  const allowedExtensions = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.zip', '.png', '.jpg', '.jpeg'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file format (${ext}). Allowed: ${allowedExtensions.join(', ')}`), false);
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 25 * 1024 * 1024 // 25 MB max file size
  },
  fileFilter: fileFilter
});

module.exports = upload;
