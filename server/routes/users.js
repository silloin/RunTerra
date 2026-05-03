const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const auth = require('../middleware/auth');
const statsService = require('../services/statsService');
const weatherService = require('../services/weatherService');
const { redisClient, isRedisAvailable } = require('../middleware/rateLimiter');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/db');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'profiles');
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter - only allow images
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'));
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: fileFilter
});

// @route   GET api/users/leaderboard
// @desc    Get global or city leaderboard
// @access  Public
router.get('/leaderboard', userController.getLeaderboard);

// @route   POST api/users/prize-draw
// @desc    Random monthly prize draw from top users
// @access  Private/Admin
router.post('/prize-draw', userController.monthlyPrizeDraw);

// @route   GET api/users/profile
// @desc    Get current user's full profile
// @access  Private
router.get('/profile', auth, userController.getProfile);

// @route   PUT api/users/profile
// @desc    Update user profile (username, city)
// @access  Private
router.put('/profile', auth, userController.updateProfile);

// @route   PUT api/users/profile/photo
// @desc    Update user profile photo URL
// @access  Private
router.put('/profile/photo', auth, userController.updateProfilePhoto);

// @route   POST api/users/profile/photo/upload
// @desc    Upload profile photo from device
// @access  Private
router.post('/profile/photo/upload', auth, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ msg: 'No file uploaded' });
    }

    // Create public URL for the uploaded file
    const relativeUrl = `/uploads/profiles/${req.file.filename}`;
    // Construct full URL using request protocol and host
    const fullUrl = `${req.protocol}://${req.get('host')}${relativeUrl}`;

    // Update user profile with new photo URL
    const userId = parseInt(req.user.id, 10);
    const pool = require('../config/db');
    const result = await pool.query(
      `UPDATE users 
       SET profile_picture = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, profile_picture`,
      [relativeUrl, userId]  // Store relative URL in database
    );

    res.json({
      msg: 'Profile photo uploaded successfully',
      profilePhotoUrl: fullUrl,  // Return full URL to frontend
      user: {
        ...result.rows[0],
        profile_picture: fullUrl  // Include full URL in user object
      }
    });
  } catch (err) {
    console.error('Error uploading profile photo:', err.message);
    res.status(500).json({ msg: 'Server Error', error: err.message });
  }
});

// @route   GET api/users/stats/:userId
// @desc    Get user statistics
// @access  Private
router.get('/stats/:userId', auth, async (req, res) => {
  const userId = req.params.userId;
  const cacheKey = `stats:${userId}`;

  try {
    // Try to get from Redis cache (skip if Redis not available)
    if (isRedisAvailable() && redisClient) {
      try {
        const cachedStats = await redisClient.get(cacheKey);
        if (cachedStats) {
          return res.json(JSON.parse(cachedStats));
        }
      } catch (cacheError) {
        console.warn('⚠️ Redis cache error, fetching from database:', cacheError.message);
      }
    }

    const stats = await statsService.getBasicStats(userId);

    // Cache in Redis for 30 seconds (skip if not available)
    if (isRedisAvailable() && redisClient) {
      try {
        await redisClient.setEx(cacheKey, 30, JSON.stringify(stats));
      } catch (cacheError) {
        console.warn('⚠️ Redis cache set error:', cacheError.message);
      }
    }

    res.json(stats);
  } catch (error) {
    console.error('❌ STATS API ERROR');
    console.error('UserId:', userId);
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to fetch stats', 
      message: error.message,
      detail: error.detail,
      hint: error.hint
    });
  }
});

// @route   GET api/users/weekly-stats/:userId
// @desc    Get user weekly statistics
// @access  Private
router.get('/weekly-stats/:userId', auth, async (req, res) => {
  const userId = req.params.userId;
  const cacheKey = `weekly_stats:${userId}`;

  try {
    // Try to get from Redis cache (skip if Redis not available)
    if (isRedisAvailable() && redisClient) {
      try {
        const cachedStats = await redisClient.get(cacheKey);
        if (cachedStats) {
          return res.json(JSON.parse(cachedStats));
        }
      } catch (cacheError) {
        console.warn('⚠️ Redis cache error, fetching from database:', cacheError.message);
      }
    }

    const weeklyStats = await statsService.getWeeklyStats(userId);

    // Cache in Redis for 30 seconds (skip if not available)
    if (isRedisAvailable() && redisClient) {
      try {
        await redisClient.setEx(cacheKey, 30, JSON.stringify(weeklyStats));
      } catch (cacheError) {
        console.warn('⚠️ Redis cache set error:', cacheError.message);
      }
    }

    res.json(weeklyStats);
  } catch (error) {
    console.error('❌ WEEKLY STATS API ERROR');
    console.error('UserId:', userId);
    console.error('Error:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch weekly stats', 
      message: error.message
    });
  }
});

// @route   GET api/users/hr-zones/:userId
// @desc    Get heart rate zones based on age
// @access  Private
router.get('/hr-zones/:userId', auth, async (req, res) => {
  try {
    const userResult = await pool.query('SELECT created_at FROM users WHERE id = $1', [req.params.userId]);
    if (userResult.rows.length === 0) return res.status(404).json({ msg: 'User not found' });
    
    // Assume age 30 if not available, or calculate from birth_date if we had it
    // For now, let's use a default or mock age
    const age = 30; 
    const maxHR = 220 - age;
    
    const zones = {
      maxHR,
      zones: {
        zone1: { name: 'Recovery', min: Math.round(maxHR * 0.50), max: Math.round(maxHR * 0.60) },
        zone2: { name: 'Aerobic', min: Math.round(maxHR * 0.60), max: Math.round(maxHR * 0.70) },
        zone3: { name: 'Tempo', min: Math.round(maxHR * 0.70), max: Math.round(maxHR * 0.80) },
        zone4: { name: 'Threshold', min: Math.round(maxHR * 0.80), max: Math.round(maxHR * 0.90) },
        zone5: { name: 'VO2 Max', min: Math.round(maxHR * 0.90), max: maxHR }
      }
    };
    
    res.json(zones);
  } catch (err) {
    console.error('❌ Error fetching HR zones:', err.message);
    res.status(500).json({ 
      error: err.message,
      detail: err.detail
    });
  }
});

// @route   GET api/users/weather
// @desc    Get current weather for user's location
// @access  Private
router.get('/weather', auth, async (req, res) => {
  try {
    const { lat, lng } = req.query;
    
    if (!lat || !lng) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }
    
    const weather = await weatherService.getWeatherData(parseFloat(lat), parseFloat(lng));
    const recommendation = weatherService.getTrainingRecommendation(weather);
    
    res.json({
      weather,
      recommendation
    });
  } catch (error) {
    console.error('Error fetching weather:', error);
    res.status(500).json({ error: 'Failed to fetch weather data' });
  }
});

module.exports = router;

