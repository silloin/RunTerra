const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const tileService = require('../services/tileService');
const segmentService = require('../services/segmentService');
const achievementService = require('../services/achievementService');
const challengeService = require('../services/challengeService');
const statsService = require('../services/statsService');
const weatherService = require('../services/weatherService');
const authenticateToken = require('../middleware/auth');
const { checkOwnership } = require('../middleware/idorProtection');
const { antiCheatMiddleware } = require('../middleware/anticheat');

// Get weather-based training recommendation
router.get('/weather-recommendation', authenticateToken, async (req, res) => {
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
    console.error('Error getting weather recommendation:', error);
    res.status(500).json({ error: 'Failed to fetch weather recommendation' });
  }
});

// Get all runs for user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const userId = req.user.id;
    
    const query = `
      SELECT 
        r.*,
        r.pace as avgpace,
        ST_AsGeoJSON(r.route_geometry) as route_json,
        ST_AsGeoJSON(r.start_location) as start_json,
        ST_AsGeoJSON(r.end_location) as end_json
      FROM runs r
      WHERE r.user_id = $1
      ORDER BY r.completed_at DESC
      LIMIT $2 OFFSET $3
    `;
    
    const result = await pool.query(query, [userId, limit, offset]);
    
    const runs = result.rows.map(row => ({
      ...row,
      route_geometry: row.route_json ? JSON.parse(row.route_json) : null,
      start_location: row.start_json ? JSON.parse(row.start_json) : null,
      end_location: row.end_json ? JSON.parse(row.end_json) : null
    }));
    
    res.json(runs);
  } catch (error) {
    console.error('❌ Error fetching runs:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to fetch runs',
      message: error.message,
      detail: error.detail,
      hint: error.hint
    });
  }
});

// Get all runs for specific user ID (backward compatibility or admin)
router.get('/user/:userId', authenticateToken, async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    
    const query = `
      SELECT 
        r.*,
        r.pace as avgpace,
        ST_AsGeoJSON(r.route_geometry) as route_json,
        ST_AsGeoJSON(r.start_location) as start_json,
        ST_AsGeoJSON(r.end_location) as end_json
      FROM runs r
      WHERE r.user_id = $1
      ORDER BY r.completed_at DESC
      LIMIT $2 OFFSET $3
    `;
    
    const result = await pool.query(query, [req.params.userId, limit, offset]);
    
    const runs = result.rows.map(row => ({
      ...row,
      route_geometry: row.route_json ? JSON.parse(row.route_json) : null,
      start_location: row.start_json ? JSON.parse(row.start_json) : null,
      end_location: row.end_json ? JSON.parse(row.end_json) : null
    }));
    
    res.json(runs);
  } catch (error) {
    console.error('Error fetching runs:', error);
    res.status(500).json({ error: 'Failed to fetch runs' });
  }
});

// Get single run details - IDOR PROTECTED
router.get('/:runId', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        r.*,
        ST_AsGeoJSON(r.route_geometry) as route_json,
        ST_AsGeoJSON(r.start_location) as start_json,
        ST_AsGeoJSON(r.end_location) as end_json,
        u.username
      FROM runs r
      JOIN users u ON r.user_id = u.id
      WHERE r.id = $1
    `;
    
    const result = await pool.query(query, [req.params.runId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Run not found' });
    }
    
    const runData = result.rows[0];
    
    // IDOR CHECK: Only allow access if user owns this run
    if (String(runData.user_id) !== String(req.user.id)) {
      // Log unauthorized access attempt
      await pool.query(
        `INSERT INTO security_events (user_id, event_type, ip_address, details)
         VALUES ($1, 'unauthorized_access', $2, $3)`,
        [req.user.id, req.ip, JSON.stringify({
          type: 'run',
          runId: req.params.runId,
          runOwner: runData.user_id,
          attempt: 'IDOR'
        })]
      );
      
      return res.status(403).json({ error: 'Access denied. You do not own this run.' });
    }
    
    const run = {
      ...runData,
      route_geometry: runData.route_json ? JSON.parse(runData.route_json) : null,
      start_location: runData.start_json ? JSON.parse(runData.start_json) : null,
      end_location: runData.end_json ? JSON.parse(runData.end_json) : null
    };
    
    // Get route points
    const pointsQuery = `
      SELECT 
        ST_AsGeoJSON(location) as location_json,
        altitude,
        speed,
        heading,
        recorded_at,
        sequence_order
      FROM route_points
      WHERE run_id = $1
      ORDER BY sequence_order ASC
    `;
    
    const pointsResult = await pool.query(pointsQuery, [req.params.runId]);
    run.route_points = pointsResult.rows.map(row => ({
      ...row,
      location: JSON.parse(row.location_json)
    }));
    
    res.json(run);
  } catch (error) {
    console.error('Error fetching run:', error);
    res.status(500).json({ error: 'Failed to fetch run' });
  }
});

// Create new run
router.post('/', authenticateToken, antiCheatMiddleware, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const {
      distance = 0,
      duration = 0,
      pace = 0,
      calories = 0,
      elevation_gain = 0,
      route_points,
      started_at,
      completed_at
    } = req.body;
    
    const userId = req.user.id;
    
    // Check for required fields more robustly
    if (!route_points || route_points.length < 2 || !started_at || !completed_at) {
      return res.status(400).json({ 
        error: route_points?.length < 2 ? 'Run must have at least 2 points' : 'Missing required fields',
        received: { 
          distance, 
          duration, 
          route_points_count: route_points?.length,
          started_at,
          completed_at
        }
      });
    }
    
    // Create LineString from route points - filter out duplicate consecutive points
    // Frontend sends {lat, lng}, convert to {lng, lat} for GeoJSON
    const uniquePoints = [];
    for (let i = 0; i < route_points.length; i++) {
      const p = route_points[i];

      // Handle both formats: {lat, lng} and {lng, lat}
      let lng, lat;
      if (p.lng !== undefined && p.lat !== undefined) {
        // Standard format: {lat, lng}
        lng = parseFloat(p.lng);
        lat = parseFloat(p.lat);
      } else if (p[0] !== undefined && p[1] !== undefined) {
        // Array format: [lng, lat]
        lng = parseFloat(p[0]);
        lat = parseFloat(p[1]);
      } else {
        continue;
      }

      // Validate coordinates are proper numbers
      if (typeof lng !== 'number' || typeof lat !== 'number' || isNaN(lng) || isNaN(lat)) continue;

      if (uniquePoints.length === 0 ||
          lng !== uniquePoints[uniquePoints.length - 1].lng ||
          lat !== uniquePoints[uniquePoints.length - 1].lat) {
        uniquePoints.push({ lng, lat });
      }
    }

    // Still need at least 2 unique points for a LINESTRING
    if (uniquePoints.length < 2) {
      // If we only have 1 unique point, we can't make a LINESTRING. 
      // We could either return an error or duplicate the point (not ideal but avoids crash).
      // Let's return a descriptive error.
      return res.status(400).json({ 
        error: 'Run must have at least 2 distinct GPS locations',
        received_points: route_points.length,
        unique_points: uniquePoints.length
      });
    }

    const coordinates = uniquePoints.map(p => `${p.lng} ${p.lat}`).join(', ');
    const lineString = `LINESTRING(${coordinates})`;
    const startPoint = `POINT(${uniquePoints[0].lng} ${uniquePoints[0].lat})`;
    const endPoint = `POINT(${uniquePoints[uniquePoints.length - 1].lng} ${uniquePoints[uniquePoints.length - 1].lat})`;
    
    // Insert run
    const runQuery = `
      INSERT INTO runs 
      (user_id, distance, duration, pace, calories, elevation_gain, 
       route_geometry, start_location, end_location, started_at, completed_at)
      VALUES ($1, $2, $3, $4, $5, $6, 
              ST_GeomFromText($7, 4326), ST_GeomFromText($8, 4326), 
              ST_GeomFromText($9, 4326), $10, $11)
      RETURNING *
    `;
    
    // Calculate territory area for this run (50m buffer)
    const territoryAreaResult = await client.query(
      `SELECT ST_Area(ST_Buffer(ST_GeomFromText($1, 4326)::geography, 50)) / 1000000 as area_km2`,
      [lineString]
    );
    const territoryArea = parseFloat(territoryAreaResult.rows[0].area_km2);

    const runResult = await client.query(runQuery, [
      userId, distance, duration, pace, calories, elevation_gain,
      lineString, startPoint, endPoint, started_at, completed_at
    ]);
    
    const run = runResult.rows[0];
    
    // Insert route points
    for (let i = 0; i < route_points.length; i++) {
      const p = route_points[i];

      // Handle both formats: {lat, lng} and {lng, lat}
      let lng, lat;
      if (p.lng !== undefined && p.lat !== undefined) {
        lng = parseFloat(p.lng);
        lat = parseFloat(p.lat);
      } else if (p[0] !== undefined && p[1] !== undefined) {
        lng = parseFloat(p[0]);
        lat = parseFloat(p[1]);
      } else {
        continue;
      }

      // Validate coordinates
      if (typeof lng !== 'number' || typeof lat !== 'number' || isNaN(lng) || isNaN(lat)) continue;

      const pointQuery = `
        INSERT INTO route_points
        (run_id, location, altitude, speed, heading, accuracy, recorded_at, sequence_order)
        VALUES ($1, ST_GeomFromText($2, 4326), $3, $4, $5, $6, $7, $8)
      `;

      await client.query(pointQuery, [
        run.id,
        `POINT(${lng} ${lat})`,
        p.altitude || null,
        p.speed || null,
        p.heading || null,
        p.accuracy || null,
        p.timestamp || new Date(),
        i
      ]);
    }
    
    await client.query('COMMIT');
    
    console.log('✅ Run saved to database, ID:', run.id);
    console.log('📍 Processing route points for tile capture:', route_points.length, 'points');
    
    // Post-commit processing (run row now exists in DB)
    let capturedTiles = [];
    try {
      capturedTiles = await tileService.processRouteForTiles(userId, route_points, run.id);
      console.log('🏆 Tile capture complete:', capturedTiles.length, 'new tiles');
    } catch(e) {
      console.error('❌ tileService failed:', e.message);
      console.error(e);
    }
    let segments = [];
    try { 
      segments = await segmentService.detectSegments(lineString); 
    } catch(e) { 
      console.error('❌ segmentService failed:', e.message); 
    }
    let unlockedAchievements = [];
    try { 
      unlockedAchievements = await achievementService.checkAchievements(userId); 
    } catch(e) { 
      console.error('❌ achievementService failed:', e.message); 
    }
    try { 
      await challengeService.processRunForChallenges(userId, { distance, duration, pace, tilesCapture: capturedTiles.length }); 
    } catch(e) { 
      console.error('❌ challengeService failed:', e.message); 
    }
    try { 
      await statsService.calculateStreak(userId); 
    } catch(e) { 
      console.error('❌ statsService failed:', e.message); 
    }
    
    res.status(201).json({
      run: {
        ...run,
        territory_area_km2: territoryArea
      },
      capturedTiles: capturedTiles.length,
      segments: segments.length,
      unlockedAchievements
    });
    
  } catch (error) {
    try { 
      await client.query('ROLLBACK'); 
    } catch (rollbackError) {
      console.error('Failed to rollback transaction:', rollbackError.message);
    }
    console.error('❌ Error creating run:', error);
    res.status(500).json({ 
      error: 'Failed to create run',
      message: error.message,
      detail: error.detail,
      hint: error.hint
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// Delete run - IDOR PROTECTED
router.delete('/:runId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Verify ownership
    const checkQuery = 'SELECT user_id FROM runs WHERE id = $1';
    const checkResult = await pool.query(checkQuery, [req.params.runId]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Run not found' });
    }
    
    if (String(checkResult.rows[0].user_id) !== String(userId)) {
      // Log unauthorized access attempt
      await pool.query(
        `INSERT INTO security_events (user_id, event_type, ip_address, details)
         VALUES ($1, 'unauthorized_access', $2, $3)`,
        [userId, req.ip, JSON.stringify({
          type: 'run_delete',
          runId: req.params.runId,
          runOwner: checkResult.rows[0].user_id,
          attempt: 'IDOR'
        })]
      );
      
      return res.status(403).json({ error: 'Access denied. You do not own this run.' });
    }
    
    const deleteQuery = 'DELETE FROM runs WHERE id = $1';
    await pool.query(deleteQuery, [req.params.runId]);
    
    // Log successful deletion
    await pool.query(
      `INSERT INTO security_events (user_id, event_type, details)
       VALUES ($1, 'run_deleted', $2)`,
      [userId, JSON.stringify({ runId: req.params.runId })]
    );
    
    res.json({ message: 'Run deleted successfully' });
  } catch (error) {
    console.error('Error deleting run:', error);
    res.status(500).json({ error: 'Failed to delete run' });
  }
});

// Get user statistics
router.get('/user/:userId/stats', authenticateToken, async (req, res) => {
  try {
    const stats = await statsService.getUserStats(req.params.userId);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Get activity heatmap
router.get('/user/:userId/heatmap', authenticateToken, async (req, res) => {
  try {
    const { days = 365 } = req.query;
    const heatmap = await statsService.getActivityHeatmap(req.params.userId, parseInt(days));
    res.json(heatmap);
  } catch (error) {
    console.error('Error fetching heatmap:', error);
    res.status(500).json({ error: 'Failed to fetch heatmap' });
  }
});

// Get pace progression
router.get('/user/:userId/pace-progression', authenticateToken, async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const progression = await statsService.getPaceProgression(req.params.userId, parseInt(limit));
    res.json(progression);
  } catch (error) {
    console.error('Error fetching pace progression:', error);
    res.status(500).json({ error: 'Failed to fetch pace progression' });
  }
});

// Get distance progression
router.get('/user/:userId/distance-progression', authenticateToken, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const progression = await statsService.getDistanceProgression(req.params.userId, parseInt(days));
    res.json(progression);
  } catch (error) {
    console.error('Error fetching distance progression:', error);
    res.status(500).json({ error: 'Failed to fetch distance progression' });
  }
});

module.exports = router;
