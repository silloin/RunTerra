/**
 * Local Email Fallback Service - Logs emails to local file when external services fail
 */

const fs = require('fs');
const path = require('path');

class EmailLocalFallback {
  constructor() {
    this.logFile = path.join(__dirname, '../logs/email-fallback.log');
    this.ensureLogDirectory();
  }

  ensureLogDirectory() {
    const logDir = path.dirname(this.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  async sendEmail(options) {
    const { to, subject, html, text, from = 'ZoneRush' } = options;
    
    try {
      const timestamp = new Date().toISOString();
      const logEntry = {
        timestamp,
        from,
        to,
        subject,
        html,
        text,
        status: 'logged-locally'
      };

      // Append to log file
      const logLine = JSON.stringify(logEntry) + '\n';
      fs.appendFileSync(this.logFile, logLine);

      console.log(`📝 Email logged locally to ${this.logFile}`);
      console.log(`📧 To: ${to}`);
      console.log(`📋 Subject: ${subject}`);
      
      return {
        success: true,
        messageId: `local-${timestamp}`,
        status: 'logged-locally',
        logFile: this.logFile
      };
    } catch (error) {
      console.error('❌ Local email logging failed:', error.message);
      return {
        success: false,
        reason: 'local-logging-failed',
        error: error.message
      };
    }
  }

  async sendSOSEmail(emergencyContact, userInfo, location) {
    const subject = `🚨 SOS ALERT - ${userInfo.username}`;
    const html = `
      <h1>🚨 SOS EMERGENCY ALERT</h1>
      <p><strong>User:</strong> ${userInfo.username}</p>
      <p><strong>Contact:</strong> ${emergencyContact.contact_name}</p>
      <p><strong>Email:</strong> ${emergencyContact.email}</p>
      <p><strong>Location:</strong> ${location.lat}, ${location.lng}</p>
      <p><strong>Time:</strong> ${new Date().toISOString()}</p>
      <hr>
      <p><em>This alert was logged locally due to email service issues.</em></p>
    `;
    const text = `SOS ALERT - User: ${userInfo.username}, Location: ${location.lat}, ${location.lng}, Time: ${new Date().toISOString()}`;

    return this.sendEmail({
      to: emergencyContact.email,
      subject,
      html,
      text,
      from: 'ZoneRush SOS'
    });
  }

  getLogStats() {
    try {
      if (!fs.existsSync(this.logFile)) {
        return { total: 0, today: 0 };
      }

      const content = fs.readFileSync(this.logFile, 'utf8');
      const lines = content.trim().split('\n').filter(line => line);
      
      const today = new Date().toDateString();
      const todayCount = lines.filter(line => {
        try {
          const entry = JSON.parse(line);
          return new Date(entry.timestamp).toDateString() === today;
        } catch {
          return false;
        }
      }).length;

      return {
        total: lines.length,
        today: todayCount
      };
    } catch (error) {
      console.error('Error reading email log stats:', error.message);
      return { total: 0, today: 0 };
    }
  }
}

module.exports = new EmailLocalFallback();
