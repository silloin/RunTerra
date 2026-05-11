const ngeohash = require('ngeohash');
const pool = require('../config/db');

class TileService {
  constructor() {
    this.TILE_PRECISION = 9; // ~19m x 19m tiles - smaller tiles for more granular territory control
  }

  // Generate geohash for a coordinate
  generateGeohash(lat, lng, precision = this.TILE_PRECISION) {
    return ngeohash.encode(lat, lng, precision);
  }

  // Get tile bounds from geohash
  getTileBounds(geohash) {
    return ngeohash.decode_bbox(geohash);
  }

  // Create tile polygon geometry
  createTileGeometry(geohash) {
    const [minLat, minLng, maxLat, maxLng] = this.getTileBounds(geohash);
    return `POLYGON((${minLng} ${minLat}, ${maxLng} ${minLat}, ${maxLng} ${maxLat}, ${minLng} ${maxLat}, ${minLng} ${minLat}))`;
  }

  // Get or create tile
  async getOrCreateTile(lat, lng) {
    const geohash = this.generateGeohash(lat, lng);
    
    const checkQuery = 'SELECT * FROM tiles WHERE geohash = $1';
    const result = await pool.query(checkQuery, [geohash]);
    
    if (result.rows.length > 0) {
      console.log(`  ℹ️  Tile already exists in DB: ${geohash}`);
      return result.rows[0];
    }

    console.log(`  ✨ Creating new tile in DB: ${geohash}`);
    const geometry = this.createTileGeometry(geohash);
    const centerPoint = `POINT(${lng} ${lat})`;
    
    const insertQuery = `
      INSERT INTO tiles (geohash, geometry, center_point, value)
      VALUES ($1, ST_GeomFromText($2, 4326), ST_GeomFromText($3, 4326), 1)
      RETURNING *
    `;
    
    const insertResult = await pool.query(insertQuery, [geohash, geometry, centerPoint]);
    return insertResult.rows[0];
  }

  // Capture tile for user
  async captureTile(userId, lat, lng, runId = null) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const tile = await this.getOrCreateTile(lat, lng);
      
      // Check if tile already has an owner (someone else captured it first)
      const previousOwnerResult = await client.query(
        'SELECT user_id FROM captured_tiles WHERE tile_id = $1 ORDER BY first_captured_at ASC LIMIT 1',
        [tile.id]
      );
      const previousOwner = previousOwnerResult.rows[0];
      const hasDifferentOwner = previousOwner && previousOwner.user_id !== userId;
      
      // Use SELECT FOR UPDATE to prevent race conditions during concurrent captures
      await client.query('SELECT * FROM tiles WHERE id = $1 FOR UPDATE', [tile.id]);
      
      // Extract numeric ID from string format like "run-1778500990444"
      let numericRunId = runId;
      if (typeof runId === 'string') {
        numericRunId = runId.replace('run-', '');
      }
      // Convert to BigInt string to handle large values, or null if not provided
      numericRunId = numericRunId ? BigInt(numericRunId).toString() : null;
      
      // First, update any existing records to ensure this capture becomes the most recent
      await client.query(
        'UPDATE captured_tiles SET last_captured_at = NOW() WHERE tile_id = $1 AND user_id = $2',
        [tile.id, userId]
      );
      
      const captureQuery = `
        INSERT INTO captured_tiles (tile_id, user_id, run_id, capture_count, first_captured_at, last_captured_at)
        VALUES ($1, $2, $3::bigint, 1, NOW(), NOW())
        ON CONFLICT (tile_id, user_id) DO UPDATE SET
          capture_count = captured_tiles.capture_count + 1,
          last_captured_at = NOW(),
          run_id = EXCLUDED.run_id
        RETURNING *, (xmax = 0) as is_new_capture
      `;
      
      const result = await client.query(captureQuery, [tile.id, userId, numericRunId]);
      
      // If there's a different owner, we should mark their capture as older
      if (hasDifferentOwner && previousOwner) {
        await client.query(
          'UPDATE captured_tiles SET last_captured_at = NOW() - INTERVAL \'1 second\' WHERE tile_id = $1 AND user_id = $2 AND user_id != $3',
          [tile.id, previousOwner.user_id, userId]
        );
      }
      const isNew = result.rows[0].is_new_capture;
      
      if (isNew) {
        console.log(`  ✅ New tile capture recorded for user ${userId}`);
      } else {
        console.log(`  🔄 Tile recaptured, incremented count for user ${userId}`);
      }
      
      await client.query('COMMIT');
      
      return { 
        captured: true, 
        tile, 
        isNew,
        previousOwner: hasDifferentOwner ? previousOwner : null
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getUserCapturedTiles(currentUserId) {
    // Get the most recent capture for each tile (to show current owner)
    const query = `
      SELECT t.geohash, ct.user_id,
             ct.user_id = $1 as is_mine,
             t.geometry,
             t.center_point,
             u.username as owner_username
      FROM tiles t
      JOIN captured_tiles ct ON t.id = ct.tile_id
      JOIN users u ON ct.user_id = u.id
      WHERE ct.last_captured_at = (
        SELECT MAX(last_captured_at) 
        FROM captured_tiles 
        WHERE tile_id = t.id
      )
      ORDER BY ct.last_captured_at DESC
    `;
    const result = await pool.query(query, [currentUserId]);
    return result.rows;
  }

  // Get tiles in bounding box
  async getTilesInBounds(minLat, minLng, maxLat, maxLng) {
    const query = `
      SELECT t.*, 
             u.username as owner_username,
             ct.user_id as owner_id,
             ST_AsGeoJSON(t.geometry) as geometry_json
      FROM tiles t
      LEFT JOIN captured_tiles ct ON t.id = ct.tile_id
      LEFT JOIN users u ON ct.user_id = u.id
      WHERE ST_Intersects(
        t.geometry,
        ST_MakeEnvelope($1, $2, $3, $4, 4326)
      )
    `;
    
    const result = await pool.query(query, [minLng, minLat, maxLng, maxLat]);
    return result.rows.map(row => ({
      ...row,
      geometry: row.geometry_json ? JSON.parse(row.geometry_json) : null
    }));
  }

  // Process route and capture tiles
  async processRouteForTiles(userId, routePoints, runId) {
    const capturedTiles = [];
    const uniqueGeohashes = new Set();

    console.log(`🗺️ Processing route for tile capture: ${routePoints.length} points`);

    // Ensure at least the first point is captured for very short runs
    if (routePoints.length > 0) {
      const firstPoint = routePoints[0];
      const firstGeohash = this.generateGeohash(firstPoint.lat, firstPoint.lng);
      
      console.log(`📍 Capturing starting tile: ${firstGeohash} at (${firstPoint.lat}, ${firstPoint.lng})`);
      const result = await this.captureTile(userId, firstPoint.lat, firstPoint.lng, runId);
      
      if (result.isNew) {
        console.log(`✅ New tile captured: ${firstGeohash}`);
        capturedTiles.push(result.tile);
      } else {
        console.log(`ℹ️  Tile already owned, incremented capture count: ${firstGeohash}`);
      }
      
      uniqueGeohashes.add(firstGeohash);
    }

    for (const point of routePoints) {
      const geohash = this.generateGeohash(point.lat, point.lng);
      
      if (!uniqueGeohashes.has(geohash)) {
        uniqueGeohashes.add(geohash);
        console.log(`📍 Capturing tile: ${geohash} at (${point.lat}, ${point.lng})`);
        const result = await this.captureTile(userId, point.lat, point.lng, runId);
        
        if (result.isNew) {
          console.log(`✅ New tile captured: ${geohash}`);
          capturedTiles.push(result.tile);
        } else {
          console.log(`ℹ️  Tile already owned, incremented capture count: ${geohash}`);
        }
      }
    }

    console.log(`🏆 Total new tiles captured: ${capturedTiles.length}`);
    return capturedTiles;
  }

  // Get tile capture statistics
  async getTileStats(userId) {
    const query = `
      SELECT 
        COUNT(*) as total_tiles,
        COUNT(DISTINCT DATE(last_captured_at)) as days_active,
        MIN(first_captured_at) as first_capture,
        MAX(last_captured_at) as last_capture
      FROM captured_tiles
      WHERE user_id = $1
    `;
    
    const result = await pool.query(query, [userId]);
    return result.rows[0];
  }
}

module.exports = new TileService();
