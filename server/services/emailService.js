/**
 * Centralized Email Service for ZoneRush
 * Uses Resend HTTP API (port 443) — no SMTP ports needed, never blocked.
 * Forwards all emails to terra93005@gmail.com (Resend free tier restriction).
 * Original recipient info is preserved in the email content.
 */

class EmailService {
  constructor() {
    this.verifiedEmail = process.env.RESEND_VERIFIED_RECIPIENT || 'terra93005@gmail.com';
    this.initialized = false;
  }

  /**
   * Initialize email service (validates API key exists)
   */
  initialize() {
    if (this.initialized) return;

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn('⚠️  RESEND_API_KEY not set — email sending will be disabled');
    } else {
      console.log('✅ Email service ready (Resend HTTP API — no SMTP ports needed)');
    }
    this.initialized = true;
  }


  /**
   * Send email via Resend HTTP API
   * All emails are forwarded to terra93005@gmail.com (Resend free tier restriction).
   * Original recipient is embedded in the subject + body so no info is lost.
   *
   * @param {Object} options
   * @param {string} options.to        - Original recipient email
   * @param {string} options.subject   - Email subject
   * @param {string} options.html      - HTML content
   * @param {string} options.text      - Plain text content (optional)
   * @param {string} options.from      - Sender display name (optional)
   */
  async sendEmail(options) {
    const { to, subject, html, text, from = 'ZoneRush' } = options;
    const apiKey = process.env.RESEND_API_KEY;

    if (!apiKey) {
      console.warn('⚠️  RESEND_API_KEY not set — cannot send email to', to);
      return { success: false, reason: 'RESEND_API_KEY not configured' };
    }

    // Resend free tier can ONLY deliver to the verified signup email.
    // Embed original recipient in subject/body so the alert is not lost.
    const actualTo = this.verifiedEmail;
    const redirectedSubject = `[To: ${to}] ${subject}`;
    const redirectedHtml = `
      <div style="background:#fff3cd;border:1px solid #ffc107;padding:10px;margin-bottom:15px;border-radius:5px;font-family:Arial,sans-serif">
        <strong>📬 Originally addressed to:</strong> ${to}<br/>
        <small style="color:#856404">Redirected — Resend free tier only delivers to verified email</small>
      </div>
      ${html}
    `;

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'onboarding@resend.dev',
          to: actualTo,
          subject: redirectedSubject,
          html: redirectedHtml,
          text: text ? `[Originally to: ${to}]\n\n${text}` : undefined,
        }),
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`Resend API ${response.status}: ${errBody || response.statusText}`);
      }

      const result = await response.json();
      console.log(`✅ Email sent to ${to} (via Resend HTTP API → ${actualTo})`, result.id);
      return { success: true, messageId: result.id, recipient: to, forwardedTo: actualTo };
    } catch (error) {
      console.error(`❌ Email failed for ${to}:`, error.message);
      return { success: false, reason: error.message };
    }
  }

  /**
   * Send SOS Emergency Alert Email
   */
  async sendSOSEmail(options) {
    const { to, userName, location, mapsLink, customMessage } = options;

    const html = `
      <h1 style="color: #dc3545;">🚨 SOS EMERGENCY ALERT</h1>
      <p style="font-size: 18px;"><strong>${userName}</strong> needs emergency assistance!</p>
      
      <div style="background: #fff3cd; border: 2px solid #ffc107; padding: 15px; margin: 20px 0;">
        <p style="margin: 5px 0;"><strong>📍 Location:</strong> ${location}</p>
        <p style="margin: 5px 0;"><strong>🗺️ View on Map:</strong> <a href="${mapsLink}" style="color: #007bff;">Click here</a></p>
        ${customMessage ? `<p style="margin: 5px 0;"><strong>💬 Message:</strong> ${customMessage}</p>` : ''}
        <p style="margin: 5px 0;"><strong>⏰ Time:</strong> ${new Date().toLocaleString()}</p>
      </div>

      <p style="color: #666;">Please contact them immediately or alert emergency services.</p>
    `;

    const text = `
SOS EMERGENCY ALERT

${userName} needs emergency assistance!

Location: ${location}
Map: ${mapsLink}
${customMessage ? `Message: ${customMessage}` : ''}
Time: ${new Date().toLocaleString()}

Please contact them immediately or alert emergency services.
    `;

    return this.sendEmail({
      to,
      subject: `🚨 SOS EMERGENCY ALERT - ${userName}`,
      html,
      text,
      from: `SOS Alert - ${userName}`
    });
  }

  /**
   * Send Email Verification
   */
  async sendVerificationEmail(options) {
    const { to, username, verificationLink } = options;

    const html = `
      <h1 style="color: #4CAF50;">🏃‍♂️ Welcome to ZoneRush!</h1>
      <p>Hi <strong>${username}</strong>,</p>
      <p>Please verify your email address by clicking the button below:</p>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${verificationLink}" 
           style="background: #4CAF50; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-size: 16px; display: inline-block;">
          Verify Email Address
        </a>
      </div>

      <p style="color: #666; font-size: 14px;">Or copy and paste this link:</p>
      <p style="word-break: break-all; color: #007bff;">${verificationLink}</p>
      
      <p style="color: #999; font-size: 12px;">This link will expire in 24 hours.</p>
    `;

    const text = `
Welcome to ZoneRush!

Hi ${username},

Please verify your email by clicking this link:
${verificationLink}

This link will expire in 24 hours.
    `;

    return this.sendEmail({
      to,
      subject: '🏃‍♂️ Verify Your ZoneRush Account',
      html,
      text,
      from: 'ZoneRush Verification'
    });
  }

  /**
   * Send Password Reset Email
   */
  async sendPasswordResetEmail(options) {
    const { to, username, resetLink } = options;

    const html = `
      <h1 style="color: #2196F3;">🔐 Password Reset Request</h1>
      <p>Hi <strong>${username}</strong>,</p>
      <p>We received a request to reset your password. Click the button below to reset it:</p>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${resetLink}" 
           style="background: #2196F3; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-size: 16px; display: inline-block;">
          Reset Password
        </a>
      </div>

      <p style="color: #666; font-size: 14px;">Or copy and paste this link:</p>
      <p style="word-break: break-all; color: #007bff;">${resetLink}</p>
      
      <p style="color: #999; font-size: 12px;">This link will expire in 1 hour.</p>
      <p style="color: #999; font-size: 12px;">If you didn't request this, please ignore this email.</p>
    `;

    const text = `
Password Reset Request

Hi ${username},

We received a request to reset your password. Click this link to reset it:
${resetLink}

This link will expire in 1 hour.

If you didn't request this, please ignore this email.
    `;

    return this.sendEmail({
      to,
      subject: '🔐 Reset Your ZoneRush Password',
      html,
      text,
      from: 'ZoneRush Password Reset'
    });
  }
}

// Export singleton instance
module.exports = new EmailService();
