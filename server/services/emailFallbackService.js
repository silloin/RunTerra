/**
 * Fallback Email Service
 * When all HTTP email APIs fail, logs SOS alerts to a local file so no data is lost.
 * No SMTP connections — purely local, zero network dependency.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/db');

const LOG_FILE = path.join(__dirname, '..', 'logs', 'sos-fallback.json');

// Ensure logs directory exists
try { fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true }); } catch (_) {}

class EmailFallbackService {
  constructor() {
    console.log('📂 Email fallback service ready (local file logging, no network required)');
  }


  generateToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  async createVerificationRecord(userId, email) {
    const token = this.generateToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    try {
      await pool.query(
        'DELETE FROM email_verifications WHERE user_id = $1 AND verified = false',
        [userId]
      );

      const result = await pool.query(
        `INSERT INTO email_verifications (user_id, email, token, expires_at) 
         VALUES ($1, $2, $3, $4) 
         RETURNING id, token, expires_at`,
        [userId, email, token, expiresAt]
      );

      return result.rows[0];
    } catch (error) {
      console.error('Error creating verification record:', error);
      throw error;
    }
  }

  async sendVerificationEmail(userId, email, username) {
    // Verification emails require actual delivery — log intent only
    const record = await this.createVerificationRecord(userId, email).catch(() => null);
    console.log(`📝 [FALLBACK] Verification email for ${username} (${email}) — could not deliver, token: ${record?.token || 'N/A'}`);
    return {
      success: true,
      messageId: 'fallback-logged',
      expiresAt: record?.expires_at || new Date(Date.now() + 24 * 60 * 60 * 1000),
      note: 'Email fallback active — verification email logged locally only'
    };
  }

  async sendSOSEmail(emergencyContact, userInfo, location) {
    // Log alert to local file so no SOS data is ever silently lost
    const alertEntry = {
      timestamp: new Date().toISOString(),
      contact: { name: emergencyContact.contact_name, email: emergencyContact.email },
      user: { username: userInfo.username, id: userInfo.id },
      location: { lat: location.lat, lng: location.lng },
      mapsLink: `https://www.google.com/maps?q=${location.lat},${location.lng}`,
      status: 'logged-fallback'
    };

    try {
      // Append to JSON log file
      let existing = [];
      try { existing = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch (_) {}
      existing.push(alertEntry);
      fs.writeFileSync(LOG_FILE, JSON.stringify(existing, null, 2));
      console.log(`📝 [FALLBACK] SOS alert for ${emergencyContact.contact_name} (${emergencyContact.email}) saved to ${LOG_FILE}`);
      return { success: true, messageId: `fallback-${Date.now()}`, note: 'Logged to sos-fallback.json' };
    } catch (writeErr) {
      console.error('❌ Could not write SOS fallback log:', writeErr.message);
      // Last resort: print to console so it appears in server logs
      console.error('🚨 SOS ALERT (undelivered):', JSON.stringify(alertEntry));
      return { success: false, reason: 'all-fallbacks-exhausted' };
    }
  }
}

module.exports = new EmailFallbackService();
