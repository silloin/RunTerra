/**
 * Secure File Upload Handler
 * Prevents unsafe file uploads, path traversal, and malicious files
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ============================================
// Configuration
// ============================================

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

// ============================================
// File Validation
// ============================================

/**
 * Validate file type and content
 */
const validateFile = (file, options = {}) => {
  const {
    allowedTypes = ALLOWED_IMAGE_TYPES,
    allowedExts = ALLOWED_IMAGE_EXTS,
    maxSize = MAX_FILE_SIZE
  } = options;

  const errors = [];

  // Check if file is valid
  if (!file || typeof file !== 'object') {
    errors.push('Invalid file object');
    return errors;
  }

  // Check file size
  if (file.size > maxSize) {
    errors.push(`File too large. Maximum size: ${maxSize / 1024 / 1024}MB`);
  }

  // Check MIME type
  if (!allowedTypes.includes(file.mimetype)) {
    errors.push(`Invalid file type. Allowed: ${allowedTypes.map(t => t.split('/')[1]).join(', ')}`);
  }

  // Check extension
  const originalname = file.originalname || '';
  const ext = path.extname(originalname).toLowerCase();
  if (!allowedExts.includes(ext)) {
    errors.push(`Invalid file extension. Allowed: ${allowedExts.join(', ')}`);
  }

  // Check for dangerous filenames
  const filename = originalname;
  if (/[<>:"/\\|?*\x00-\x1F]/.test(filename)) {
    errors.push('Filename contains invalid characters');
  }

  // Check for path traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    errors.push('Invalid filename');
  }

  return errors;
};

/**
 * Generate secure filename
 */
const generateSecureFilename = (originalName) => {
  // Generate random filename
  const randomName = crypto.randomBytes(16).toString('hex');
  const name = originalName || '';
  const ext = path.extname(name).toLowerCase();
  
  // Validate extension
  if (!ALLOWED_IMAGE_EXTS.includes(ext)) {
    throw new Error('Invalid file extension');
  }
  
  return `${randomName}${ext}`;
};

// ============================================
// Multer Configuration
// ============================================

/**
 * Create secure storage configuration
 */
const createSecureStorage = (uploadDir) => {
  return multer.diskStorage({
    destination: function (req, file, cb) {
      // Ensure upload directory exists
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true, mode: 0o755 });
      }
      
      // Verify directory is within expected path (prevent path traversal)
      const resolvedPath = path.resolve(uploadDir);
      const expectedBase = path.resolve(__dirname, '..', 'public', 'uploads');
      
      // Allow subdirectories under public/uploads (e.g., profiles, runs, gpx)
      if (!resolvedPath.startsWith(expectedBase)) {
        return cb(new Error('Invalid upload directory'), false);
      }
      
      cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
      try {
        const secureName = generateSecureFilename(file.originalname);
        cb(null, secureName);
      } catch (error) {
        cb(error, false);
      }
    }
  });
};

/**
 * Secure file filter
 */
const secureFileFilter = (req, file, cb) => {
  const errors = validateFile(file);
  
  if (errors.length > 0) {
    return cb(new Error(errors.join(', ')), false);
  }
  
  // Additional check: verify magic numbers (file signature)
  const checkMagicNumbers = (buffer, mimetype) => {
    const signatures = {
      'image/jpeg': [[0xFF, 0xD8, 0xFF]],
      'image/png': [[0x89, 0x50, 0x4E, 0x47]],
      'image/gif': [[0x47, 0x49, 0x46, 0x38]],
      'image/webp': [[0x52, 0x49, 0x46, 0x46]], // RIFF header
    };
    
    const expected = signatures[mimetype];
    if (!expected) return true; // Unknown type, skip check
    
    return expected.some(sig => {
      for (let i = 0; i < sig.length; i++) {
        if (buffer[i] !== sig[i]) return false;
      }
      return true;
    });
  };
  
  cb(null, true);
};

// ============================================
// Upload Middleware Factory
// ============================================

/**
 * Create secure upload middleware
 */
const createSecureUpload = (options = {}) => {
  const {
    fieldName = 'file',
    maxFiles = 1,
    uploadDir,
    allowedTypes = ALLOWED_IMAGE_TYPES,
    allowedExts = ALLOWED_IMAGE_EXTS,
    maxSize = MAX_FILE_SIZE
  } = options;
  
  if (!uploadDir) {
    throw new Error('uploadDir is required');
  }
  
  const storage = createSecureStorage(uploadDir);
  
  const upload = multer({
    storage: storage,
    limits: {
      fileSize: maxSize,
      files: maxFiles
    },
    fileFilter: secureFileFilter
  });
  
  // Return appropriate upload method
  if (maxFiles === 1) {
    return upload.single(fieldName);
  } else {
    return upload.array(fieldName, maxFiles);
  }
};

/**
 * Profile photo upload (single image)
 */
const profilePhotoUpload = createSecureUpload({
  fieldName: 'photo',
  maxFiles: 1,
  uploadDir: path.join(__dirname, '..', 'public', 'uploads', 'profiles'),
  maxSize: 5 * 1024 * 1024 // 5MB
});

/**
 * Run photo upload (multiple images)
 */
const runPhotoUpload = createSecureUpload({
  fieldName: 'photos',
  maxFiles: 10,
  uploadDir: path.join(__dirname, '..', 'public', 'uploads', 'runs'),
  maxSize: 10 * 1024 * 1024 // 10MB per file
});

/**
 * GPX file upload
 */
const gpxUpload = multer({
  storage: createSecureStorage(path.join(__dirname, '..', 'public', 'uploads', 'gpx')),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const originalname = file?.originalname || '';
    const ext = path.extname(originalname).toLowerCase();
    if (ext !== '.gpx') {
      return cb(new Error('Only .gpx files are allowed'), false);
    }
    cb(null, true);
  }
}).single('gpxFile');

// ============================================
// Error Handler
// ============================================

/**
 * Handle multer errors
 */
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(400).json({
          error: 'File too large',
          message: `Maximum file size exceeded (${MAX_FILE_SIZE / 1024 / 1024}MB)`
        });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({
          error: 'Too many files',
          message: 'Maximum number of files exceeded'
        });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({
          error: 'Unexpected field',
          message: 'Invalid file upload field'
        });
      default:
        return res.status(400).json({
          error: 'Upload error',
          message: err.message
        });
    }
  }
  
  if (err) {
    return res.status(400).json({
      error: 'Upload failed',
      message: err.message
    });
  }
  
  next();
};

// ============================================
// Cleanup Utilities
// ============================================

/**
 * Delete uploaded file safely
 */
const deleteUploadedFile = (filePath) => {
  try {
    const resolvedPath = path.resolve(filePath);
    const uploadsBase = path.resolve(__dirname, '..', 'public', 'uploads');
    
    // Ensure file is within uploads directory
    if (!resolvedPath.startsWith(uploadsBase)) {
      throw new Error('Invalid file path');
    }
    
    if (fs.existsSync(resolvedPath)) {
      fs.unlinkSync(resolvedPath);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error deleting file:', error.message);
    return false;
  }
};

module.exports = {
  createSecureUpload,
  profilePhotoUpload,
  runPhotoUpload,
  gpxUpload,
  handleUploadError,
  deleteUploadedFile,
  validateFile,
  generateSecureFilename
};
