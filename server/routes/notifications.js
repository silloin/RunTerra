const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// Get notification service instance (will be set from server.js)
let notificationService = null;

const setNotificationService = (service) => {
  notificationService = service;
};

const getNotificationService = () => notificationService;

// ============================================
// CREATE NOTIFICATION
// POST /api/notifications
// ============================================
router.post('/', auth, async (req, res) => {
  const { type, title, content, delayMinutes, triggerTime, data } = req.body;
  const userId = req.user.id;

  try {
    if (!type || !title) {
      return res.status(400).json({ message: 'Type and title are required' });
    }

    if (!notificationService) {
      return res.status(503).json({ 
        message: 'Notification service not available. Please try again later.' 
      });
    }

    let notification;

    switch (type) {
      case 'scheduled':
        if (!triggerTime) {
          return res.status(400).json({ message: 'triggerTime is required for scheduled notifications' });
        }
        notification = await notificationService.createScheduledNotification(
          userId,
          title,
          content,
          new Date(triggerTime),
          data || {}
        );
        break;

      case 'delayed':
        if (!delayMinutes || delayMinutes <= 0) {
          return res.status(400).json({ message: 'Valid delayMinutes is required for delayed notifications' });
        }
        notification = await notificationService.createDelayedNotification(
          userId,
          title,
          content,
          delayMinutes,
          data || {}
        );
        break;

      case 'event':
        notification = await notificationService.createEventNotification(
          userId,
          title,
          content,
          'event',
          data || {}
        );
        break;

      default:
        return res.status(400).json({ message: 'Invalid notification type' });
    }

    res.status(201).json({
      message: 'Notification created successfully',
      notification
    });
  } catch (err) {
    console.error('Error creating notification:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ============================================
// GET USER NOTIFICATIONS
// ============================================
router.get('/', auth, async (req, res) => {
  const userId = req.user.id;
  const limit = parseInt(req.query.limit) || 50;
  const unreadOnly = req.query.unread === 'true';

  try {
    let query;
    if (unreadOnly) {
      query = `
        SELECT * FROM notifications 
        WHERE user_id = $1 AND is_read = FALSE 
        ORDER BY created_at DESC 
        LIMIT $2`;
    } else {
      query = `
        SELECT * FROM notifications 
        WHERE user_id = $1 
        ORDER BY created_at DESC 
        LIMIT $2`;
    }

    const result = await pool.query(query, [userId, limit]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching notifications:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ============================================
// GET UNREAD COUNT
// ============================================
router.get('/unread/count', auth, async (req, res) => {
  const userId = req.user.id;

  try {
    // If notification service is available, use it
    if (notificationService) {
      const count = await notificationService.getUnreadCount(userId);
      return res.json({ count });
    }

    // Fallback: query database directly
    const result = await pool.query(
      'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = FALSE',
      [userId]
    );
    
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (err) {
    console.error('❌ Error fetching unread count:', err.message);
    console.error('Stack:', err.stack);
    res.status(500).json({ 
      message: 'Server error', 
      error: err.message,
      detail: err.detail,
      hint: err.hint
    });
  }
});

// ============================================
// GET NOTIFICATION STATISTICS
// ============================================
router.get('/stats', auth, async (req, res) => {
  const userId = req.user.id;

  try {
    if (notificationService) {
      const stats = await notificationService.getNotificationStats(userId);
      return res.json(stats);
    }

    // Fallback: basic stats from database
    const totalResult = await pool.query(
      'SELECT COUNT(*) FROM notifications WHERE user_id = $1',
      [userId]
    );
    const unreadResult = await pool.query(
      'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = FALSE',
      [userId]
    );
    
    res.json({
      total: parseInt(totalResult.rows[0].count),
      unread: parseInt(unreadResult.rows[0].count),
      read: parseInt(totalResult.rows[0].count) - parseInt(unreadResult.rows[0].count)
    });
  } catch (err) {
    console.error('❌ Error fetching notification stats:', err.message);
    res.status(500).json({ 
      message: 'Server error', 
      error: err.message,
      detail: err.detail
    });
  }
});

// ============================================
// MARK NOTIFICATION AS READ
// ============================================
router.put('/read/:notificationId', auth, async (req, res) => {
  const userId = req.user.id;
  const notificationId = req.params.notificationId;

  try {
    // Guard: if notification service is not set, use DB fallback
    if (!notificationService) {
      const result = await pool.query(
        'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2 RETURNING *',
        [notificationId, userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'Notification not found' });
      }
      return res.json({ message: 'Notification marked as read' });
    }

    const success = await notificationService.markAsRead(notificationId, userId);
    
    if (!success) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    res.json({ message: 'Notification marked as read' });
  } catch (err) {
    console.error('Error marking notification as read:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ============================================
// MARK ALL NOTIFICATIONS AS READ
// ============================================
router.put('/read-all', auth, async (req, res) => {
  const userId = req.user.id;

  try {
    // Guard: if notification service is not set, use DB fallback
    if (!notificationService) {
      const result = await pool.query(
        'UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE RETURNING id',
        [userId]
      );
      return res.json({ 
        message: 'All notifications marked as read',
        markedCount: result.rowCount
      });
    }

    const markedCount = await notificationService.markAllAsRead(userId);

    res.json({ 
      message: 'All notifications marked as read',
      markedCount
    });
  } catch (err) {
    console.error('Error marking all notifications as read:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ============================================
// DELETE NOTIFICATION
// ============================================
router.delete('/:notificationId', auth, async (req, res) => {
  const userId = req.user.id;
  const notificationId = req.params.notificationId;

  try {
    // Guard: if notification service is not set, use DB fallback
    if (!notificationService) {
      const result = await pool.query(
        'DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id',
        [notificationId, userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'Notification not found' });
      }
      return res.json({ message: 'Notification deleted successfully' });
    }

    const success = await notificationService.deleteNotification(notificationId, userId);

    if (!success) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    res.json({ message: 'Notification deleted successfully' });
  } catch (err) {
    console.error('Error deleting notification:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ============================================
// GET NOTIFICATION PREFERENCES
// ============================================
router.get('/preferences', auth, async (req, res) => {
  const userId = req.user.id;

  try {
    // Guard: if notification service is not set, return default preferences
    if (!notificationService) {
      return res.json({
        user_id: userId,
        tile_capture_alerts: true,
        training_reminders: true,
        friend_activity: true,
        email_notifications: true,
        push_notifications: true
      });
    }

    const preferences = await notificationService.getPreferences(userId);
    res.json(preferences);
  } catch (err) {
    console.error('Error fetching notification preferences:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ============================================
// UPDATE NOTIFICATION PREFERENCES
// ============================================
router.put('/preferences', auth, async (req, res) => {
  const userId = req.user.id;
  const preferences = req.body;

  try {
    // Guard: if notification service is not set, store fallback
    if (!notificationService) {
      // Just return success - no persistent storage without service
      return res.json({
        message: 'Preferences updated (notification service unavailable)',
        preferences: { ...preferences, user_id: userId }
      });
    }

    const updated = await notificationService.updatePreferences(userId, preferences);
    res.json({
      message: 'Preferences updated successfully',
      preferences: updated
    });
  } catch (err) {
    console.error('Error updating notification preferences:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ============================================
// SAVE FCM TOKEN
// ============================================
router.post('/fcm-token', auth, async (req, res) => {
  const { token, deviceInfo } = req.body;
  const userId = req.user.id;

  try {
    if (!token) {
      return res.status(400).json({ message: 'FCM token is required' });
    }

    // Upsert token (insert or update)
    const result = await pool.query(
      `INSERT INTO user_fcm_tokens (user_id, token, device_info, last_used_at, is_active)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, TRUE)
       ON CONFLICT (token) 
       DO UPDATE SET 
         user_id = $1,
         last_used_at = CURRENT_TIMESTAMP,
         is_active = TRUE,
         device_info = COALESCE($3, user_fcm_tokens.device_info)
       RETURNING *`,
      [userId, token, deviceInfo]
    );

    res.json({
      message: 'FCM token saved successfully',
      token: result.rows[0]
    });
  } catch (err) {
    console.error('Error saving FCM token:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ============================================
// DEACTIVATE FCM TOKEN
// ============================================
router.delete('/fcm-token/:token', auth, async (req, res) => {
  const userId = req.user.id;
  const token = req.params.token;

  try {
    const result = await pool.query(
      `UPDATE user_fcm_tokens 
       SET is_active = FALSE 
       WHERE user_id = $1 AND token = $2
       RETURNING *`,
      [userId, token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'FCM token not found' });
    }

    res.json({ message: 'FCM token deactivated' });
  } catch (err) {
    console.error('Error deactivating FCM token:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
module.exports.setNotificationService = setNotificationService;
module.exports.getNotificationService = getNotificationService;
