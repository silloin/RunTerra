const pool = require('../config/db');

class StatsService {
  // Get comprehensive user statistics
  async getUserStats(userId) {
    const basicStats = await this.getBasicStats(userId);
    const weeklyStats = await this.getWeeklyStats(userId);
    const monthlyStats = await this.getMonthlyStats(userId);
    const personalBests = await this.getPersonalBests(userId);
    
    return {
      ...basicStats,
      weekly: weeklyStats,
      monthly: monthlyStats,
      personalBests
    };
  }

  // Get basic statistics
async getBasicStats(userId) {
    const query = `
      SELECT 
        u.id,
        u.username,
        COALESCE((SELECT SUM(distance) FROM runs WHERE user_id = u.id), 0) as total_distance,
        COALESCE((SELECT COUNT(*) FROM captured_tiles WHERE user_id = u.id), 0) as total_tiles,
        COALESCE(u.weekly_mileage, 0) as weekly_mileage,
        COALESCE(u.xp, 0) as xp,
        COALESCE(u.level, 1) as level,
        COALESCE(u.streak, 0) as streak,
        COALESCE(u.territory_points, 0) as territory_points,
        COALESCE(u.total_territory_area, 0) as total_territory_area,
        COALESCE((SELECT COUNT(*) FROM captured_tiles WHERE user_id = u.id), 0) as territories_captured,
        COUNT(DISTINCT ua.achievement_id) as achievements_unlocked
      FROM users u
      LEFT JOIN user_achievements ua ON u.id = ua.user_id
      WHERE u.id = $1
      GROUP BY u.id, u.username, u.weekly_mileage, u.xp, u.level, u.streak, u.territory_points, u.total_territory_area
    `;
    
    const result = await pool.query(query, [userId]);
    let stats = result.rows[0] || this.getDefaultStats();
    
    // Debug logging for tiles
    const tilesDebug = await pool.query('SELECT COUNT(*) as count FROM captured_tiles WHERE user_id = $1', [userId]);
    console.log(`🔍 DEBUG: User ${userId} has ${tilesDebug.rows[0].count} captured tiles`);
    
    // Ensure total_tiles and territories_captured are consistent
    const tileCount = parseInt(tilesDebug.rows[0].count) || 0;
    stats.total_tiles = tileCount;
    stats.territories_captured = tileCount;
    
    // Ensure all fields exist even if NULL from DB
    return {
      ...this.getDefaultStats(),
      ...stats
    };
  }

  // Get weekly statistics
  async getWeeklyStats(userId) {
    const query = `
      SELECT 
        COUNT(*) as runs_this_week,
        COALESCE(SUM(distance), 0) as distance_this_week,
        COALESCE(SUM(duration), 0) as duration_this_week,
        COALESCE(AVG(pace), 0) as avg_pace_this_week
      FROM runs
      WHERE user_id = $1
      AND completed_at >= CURRENT_DATE - INTERVAL '7 days'
    `;
    
    const result = await pool.query(query, [userId]);
    return result.rows[0];
  }

  // Get monthly statistics
  async getMonthlyStats(userId) {
    const query = `
      SELECT 
        COUNT(*) as runs_this_month,
        COALESCE(SUM(distance), 0) as distance_this_month,
        COALESCE(SUM(duration), 0) as duration_this_month,
        COALESCE(AVG(pace), 0) as avg_pace_this_month
      FROM runs
      WHERE user_id = $1
      AND completed_at >= DATE_TRUNC('month', CURRENT_DATE)
    `;
    
    const result = await pool.query(query, [userId]);
    return result.rows[0];
  }

  // Get personal bests
  async getPersonalBests(userId) {
    const query = `
      SELECT 
        MIN(pace) as best_pace,
        MAX(distance) as longest_distance,
        MAX(duration) as longest_duration,
        (SELECT distance FROM runs WHERE user_id = $1 AND pace = MIN(r.pace) LIMIT 1) as best_pace_distance
      FROM runs r
      WHERE user_id = $1
    `;
    
    const result = await pool.query(query, [userId]);
    return result.rows[0];
  }

  // Get activity heatmap data
  async getActivityHeatmap(userId, days = 365) {
    const safeDays = Math.max(1, Math.min(3650, parseInt(days) || 365));
    const query = `
      SELECT 
        DATE(completed_at) as date,
        COUNT(*) as run_count,
        SUM(distance) as total_distance
      FROM runs
      WHERE user_id = $1
      AND completed_at >= CURRENT_DATE - ($2 || ' days')::INTERVAL
      GROUP BY DATE(completed_at)
      ORDER BY date ASC
    `;
    
    const result = await pool.query(query, [userId, safeDays]);
    return result.rows;
  }

  // Get pace progression over time
  async getPaceProgression(userId, limit = 20) {
    const query = `
      SELECT 
        DATE(completed_at) as date,
        pace,
        distance
      FROM runs
      WHERE user_id = $1
      ORDER BY completed_at DESC
      LIMIT $2
    `;
    
    const result = await pool.query(query, [userId, limit]);
    return result.rows.reverse();
  }

  // Get distance progression
  async getDistanceProgression(userId, days = 30) {
    const safeDays = Math.max(1, Math.min(3650, parseInt(days) || 30));
    const query = `
      SELECT 
        DATE(completed_at) as date,
        SUM(distance) as total_distance,
        COUNT(*) as run_count
      FROM runs
      WHERE user_id = $1
      AND completed_at >= CURRENT_DATE - ($2 || ' days')::INTERVAL
      GROUP BY DATE(completed_at)
      ORDER BY date ASC
    `;
    
    const result = await pool.query(query, [userId, safeDays]);
    return result.rows;
  }

  // Calculate streak
  async calculateStreak(userId) {
    const query = `
      SELECT DISTINCT DATE(completed_at) as run_date
      FROM runs
      WHERE user_id = $1
      ORDER BY run_date DESC
    `;
    
    const result = await pool.query(query, [userId]);
    const dates = result.rows.map(row => new Date(row.run_date));
    
    if (dates.length === 0) return { current: 0, longest: 0 };
    
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 1;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const lastRun = new Date(dates[0]);
    lastRun.setHours(0, 0, 0, 0);
    
    const daysDiff = Math.floor((today - lastRun) / (1000 * 60 * 60 * 24));
    
    if (daysDiff <= 1) {
      currentStreak = 1;
      
      for (let i = 1; i < dates.length; i++) {
        const prevDate = new Date(dates[i - 1]);
        const currDate = new Date(dates[i]);
        const diff = Math.floor((prevDate - currDate) / (1000 * 60 * 60 * 24));
        
        if (diff === 1) {
          currentStreak++;
          tempStreak++;
        } else {
          break;
        }
      }
    }
    
    tempStreak = 1;
    for (let i = 1; i < dates.length; i++) {
      const prevDate = new Date(dates[i - 1]);
      const currDate = new Date(dates[i]);
      const diff = Math.floor((prevDate - currDate) / (1000 * 60 * 60 * 24));
      
      if (diff === 1) {
        tempStreak++;
        longestStreak = Math.max(longestStreak, tempStreak);
      } else {
        tempStreak = 1;
      }
    }
    
    longestStreak = Math.max(longestStreak, currentStreak);
    
    await pool.query(
      'UPDATE users SET streak = $1 WHERE id = $2',
      [currentStreak, userId]
    );
    
    return { current: currentStreak, longest: longestStreak };
  }

  // Get default stats
  getDefaultStats() {
    return {
      id: null,
      username: '',
      total_distance: 0,
      total_tiles: 0,
      weekly_mileage: 0,
      xp: 0,
      level: 1,
      streak: 0,
      territory_points: 0,
      total_territory_area: 0,
      territories_captured: 0,
      achievements_unlocked: 0
    };
  }

  // Get leaderboard
  async getLeaderboard(type = 'distance', limit = 50) {
    const allowedTypes = {
      distance: 'u.total_distance DESC',
      runs: '(SELECT COUNT(*) FROM runs WHERE user_id = u.id) DESC',
      tiles: 'u.total_tiles DESC',
      xp: 'u.xp DESC',
      streak: 'u.streak DESC'
    };
    const orderBy = allowedTypes[type] || allowedTypes.distance;
    const safeLimit = Math.max(1, Math.min(100, parseInt(limit) || 50));

    const queries = {
      distance: `SELECT u.id, u.username, u.level, u.xp, u.total_distance, u.total_tiles, u.streak, (SELECT MIN(pace) FROM runs WHERE user_id = u.id) as best_pace, (SELECT COUNT(*) FROM runs WHERE user_id = u.id) as total_runs, ROW_NUMBER() OVER (ORDER BY u.total_distance DESC) as rank FROM users u ORDER BY u.total_distance DESC LIMIT $1`,
      runs: `SELECT u.id, u.username, u.level, u.xp, u.total_distance, u.total_tiles, u.streak, (SELECT MIN(pace) FROM runs WHERE user_id = u.id) as best_pace, (SELECT COUNT(*) FROM runs WHERE user_id = u.id) as total_runs, ROW_NUMBER() OVER (ORDER BY (SELECT COUNT(*) FROM runs WHERE user_id = u.id) DESC) as rank FROM users u ORDER BY (SELECT COUNT(*) FROM runs WHERE user_id = u.id) DESC LIMIT $1`,
      tiles: `SELECT u.id, u.username, u.level, u.xp, u.total_distance, u.total_tiles, u.streak, (SELECT MIN(pace) FROM runs WHERE user_id = u.id) as best_pace, (SELECT COUNT(*) FROM runs WHERE user_id = u.id) as total_runs, ROW_NUMBER() OVER (ORDER BY u.total_tiles DESC) as rank FROM users u ORDER BY u.total_tiles DESC LIMIT $1`,
      xp: `SELECT u.id, u.username, u.level, u.xp, u.total_distance, u.total_tiles, u.streak, (SELECT MIN(pace) FROM runs WHERE user_id = u.id) as best_pace, (SELECT COUNT(*) FROM runs WHERE user_id = u.id) as total_runs, ROW_NUMBER() OVER (ORDER BY u.xp DESC) as rank FROM users u ORDER BY u.xp DESC LIMIT $1`,
      streak: `SELECT u.id, u.username, u.level, u.xp, u.total_distance, u.total_tiles, u.streak, (SELECT MIN(pace) FROM runs WHERE user_id = u.id) as best_pace, (SELECT COUNT(*) FROM runs WHERE user_id = u.id) as total_runs, ROW_NUMBER() OVER (ORDER BY u.streak DESC) as rank FROM users u ORDER BY u.streak DESC LIMIT $1`,
    };
    const query = queries[type] || queries.distance;

    const result = await pool.query(query, [safeLimit]);
    return result.rows;
  }
}

module.exports = new StatsService();
