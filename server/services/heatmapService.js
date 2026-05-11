const pool = require('../config/db');
const ngeohash = require('ngeohash');

class HeatmapService {
  constructor() {
    this.HEATMAP_PRECISION = 7; // ~153m x 153m cells
  }

  // Process run and update heatmap
  async processRunForHeatmap(runId) {
    try {
      // Extract numeric ID from string format like "run-1778500990444"
      let numericRunId = typeof runId === 'string' ? runId.replace('run-', '') : runId;
      
      // Convert to BigInt to handle large timestamp values
      numericRunId = BigInt(numericRunId).toString();
      
      // Get route points - cast run_id to BIGINT for comparison
      const pointsQuery = `
        SELECT 
          ST_X(location::geometry) as lng,
          ST_Y(location::geometry) as lat
        FROM route_points
        WHERE run_id::bigint = $1::bigint
        ORDER BY sequence_order
      `;
      
      const result = await pool.query(pointsQuery, [numericRunId]);
      const points = result.rows;
      
      if (points.length === 0) return;
      
      // Group points by geohash
      const geohashCounts = new Map();
      
      for (const point of points) {
        const hash = ngeohash.encode(point.lat, point.lng, this.HEATMAP_PRECISION);
        geohashCounts.set(hash, (geohashCounts.get(hash) || 0) + 1);
      }
      
      // Update heatmap table
      for (const [geohash, count] of geohashCounts.entries()) {
        const coords = ngeohash.decode(geohash);
        
        await pool.query(
          `INSERT INTO route_heatmap (location, geohash, run_count, total_runners)
           VALUES (ST_SetSRID(ST_MakePoint($1, $2), 4326), $3, 1, 1)
           ON CONFLICT (geohash) DO UPDATE SET
             run_count = route_heatmap.run_count + 1,
             last_updated = CURRENT_TIMESTAMP`,
          [coords.longitude, coords.latitude, geohash]
        );
      }
      
      return geohashCounts.size;
    } catch (error) {
      console.error('Error processing run for heatmap:', error);
      throw error;
    }
  }

  // Get heatmap data for map bounds
  async getHeatmapData(minLat, minLng, maxLat, maxLng, minIntensity = 5) {
    try {
      console.log('📊 Heatmap Query Params:', { minLat, minLng, maxLat, maxLng, minIntensity });
      
      const query = `
        SELECT 
          ST_X(location) as lng,
          ST_Y(location) as lat,
          run_count,
          total_runners
        FROM route_heatmap
        WHERE ST_Intersects(
          location,
          ST_MakeEnvelope($1, $2, $3, $4, 4326)
        )
        AND run_count >= $5
        ORDER BY run_count DESC
        LIMIT 10000
      `;
      
      const result = await pool.query(query, [
        parseFloat(minLng), 
        parseFloat(minLat), 
        parseFloat(maxLng), 
        parseFloat(maxLat), 
        parseInt(minIntensity)
      ]);
      
      console.log(`✅ Found ${result.rows.length} heatmap points`);

      // Format for Mapbox heatmap layer
      return {
        type: 'FeatureCollection',
        features: result.rows.map(row => ({
          type: 'Feature',
          properties: {
            intensity: row.run_count,
            runners: row.total_runners
          },
          geometry: {
            type: 'Point',
            coordinates: [parseFloat(row.lng), parseFloat(row.lat)]
          }
        }))
      };
    } catch (error) {
      console.error('❌ Heatmap Service Error:', error);
      throw error;
    }
  }

  // Get user's personal heatmap
  async getUserHeatmap(userId) {
    try {
      const query = `
        SELECT 
          ST_X(ST_SnapToGrid(rp.location::geometry, 0.0005)) as lng,
          ST_Y(ST_SnapToGrid(rp.location::geometry, 0.0005)) as lat,
          COUNT(*) as frequency
        FROM route_points rp
        JOIN runs r ON rp.run_id = r.id
        WHERE r.user_id = $1
        GROUP BY ST_SnapToGrid(rp.location::geometry, 0.0005)
        ORDER BY frequency DESC
        LIMIT 5000
      `;
      
      const result = await pool.query(query, [userId]);
      
      return {
        type: 'FeatureCollection',
        features: result.rows.map(row => ({
          type: 'Feature',
          properties: {
            intensity: row.frequency
          },
          geometry: {
            type: 'Point',
            coordinates: [row.lng, row.lat]
          }
        }))
      };
    } catch (error) {
      console.error('Error fetching user heatmap:', error);
      throw error;
    }
  }

  // Get popular routes in area
  async getPopularRoutes(lat, lng, radiusMeters = 5000, limit = 10) {
    try {
      const query = `
        SELECT 
          r.id,
          r.distance,
          r.user_id,
          u.username,
          ST_AsGeoJSON(r.route_geometry) as route_json,
          (
            SELECT COUNT(*)
            FROM route_heatmap rh
            WHERE ST_DWithin(
              rh.location::geography,
              r.route_geometry::geography,
              100
            )
            AND rh.run_count >= 10
          ) as popularity_score
        FROM runs r
        JOIN users u ON r.user_id = u.id
        WHERE ST_DWithin(
          r.start_location::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
          $3
        )
        GROUP BY r.id, u.username
        ORDER BY popularity_score DESC
        LIMIT $4
      `;
      
      const result = await pool.query(query, [lat, lng, radiusMeters, limit]);
      
      return result.rows.map(row => ({
        ...row,
        route_geometry: JSON.parse(row.route_json)
      }));
    } catch (error) {
      console.error('Error fetching popular routes:', error);
      throw error;
    }
  }

  // Get heatmap statistics
  async getHeatmapStats() {
    try {
      const query = `
        SELECT 
          COUNT(*) as total_cells,
          SUM(run_count) as total_runs,
          AVG(run_count) as avg_runs_per_cell,
          MAX(run_count) as max_runs_in_cell,
          COUNT(DISTINCT CASE WHEN run_count >= 10 THEN geohash END) as popular_cells
        FROM route_heatmap
      `;
      
      const result = await pool.query(query);
      return result.rows[0];
    } catch (error) {
      console.error('Error fetching heatmap stats:', error);
      throw error;
    }
  }

  // Clean old heatmap data (maintenance function)
  async cleanOldHeatmapData(daysOld = 180) {
    try {
      const safeDays = Math.max(1, Math.min(3650, parseInt(daysOld) || 180));
      const query = `
        DELETE FROM route_heatmap
        WHERE run_count < 3
        AND last_updated < CURRENT_DATE - ($1 || ' days')::INTERVAL
      `;
      const result = await pool.query(query, [safeDays]);
      return result.rowCount;
    } catch (error) {
      console.error('Error cleaning heatmap data:', error);
      throw error;
    }
  }

  // Get hotspots (most popular running areas)
  async getHotspots(limit = 20) {
    try {
      const query = `
        SELECT 
          ST_X(location::geometry) as lng,
          ST_Y(location::geometry) as lat,
          run_count,
          total_runners,
          geohash
        FROM route_heatmap
        WHERE run_count >= 50
        ORDER BY run_count DESC
        LIMIT $1
      `;
      
      const result = await pool.query(query, [limit]);
      
      return result.rows.map(row => ({
        coordinates: [row.lng, row.lat],
        intensity: row.run_count,
        runners: row.total_runners,
        geohash: row.geohash
      }));
    } catch (error) {
      console.error('Error fetching hotspots:', error);
      throw error;
    }
  }

  // Generate heatmap for specific time period
  async getTimeBasedHeatmap(startDate, endDate, minLat, minLng, maxLat, maxLng) {
    try {
      const query = `
        SELECT 
          ST_X(ST_SnapToGrid(rp.location::geometry, 0.001)) as lng,
          ST_Y(ST_SnapToGrid(rp.location::geometry, 0.001)) as lat,
          COUNT(*) as intensity
        FROM route_points rp
        JOIN runs r ON rp.run_id = r.id
        WHERE r.completed_at BETWEEN $1 AND $2
        AND ST_Intersects(
          rp.location,
          ST_MakeEnvelope($3, $4, $5, $6, 4326)
        )
        GROUP BY ST_SnapToGrid(rp.location::geometry, 0.001)
        HAVING COUNT(*) >= 3
        ORDER BY intensity DESC
        LIMIT 5000
      `;
      
      const result = await pool.query(query, [startDate, endDate, minLng, minLat, maxLng, maxLat]);
      
      return {
        type: 'FeatureCollection',
        features: result.rows.map(row => ({
          type: 'Feature',
          properties: {
            intensity: row.intensity
          },
          geometry: {
            type: 'Point',
            coordinates: [row.lng, row.lat]
          }
        }))
      };
    } catch (error) {
      console.error('Error fetching time-based heatmap:', error);
      throw error;
    }
  }
}

module.exports = new HeatmapService();
