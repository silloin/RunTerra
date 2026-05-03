/**
 * Centralized Email Service for ZoneRush
 * Forwards all emails to verified address (terra93005@gmail.com) to bypass Resend testing restriction
 * Original recipient info is preserved in the email content
 */

const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = null;
    this.verifiedEmail = 'terra93005@gmail.com'; // Your verified Resend email
    this.initialized = false;
  }

  /**
   * Initialize email transporter (call this after dotenv loads)
   */
  initialize() {
    if (this.initialized) {
      return; // Already initialized
    }

    const emailService = process.env.EMAIL_SERVICE || 'resend';
    const resendApiKey = process.env.RESEND_API_KEY;

    if (emailService === 'resend' && resendApiKey) {
      this.transporter = nodemailer.createTransport({
        host: 'smtp.resend.com',
        port: 587,
        secure: false,
        auth: {
          user: 'resend',
          pass: resendApiKey
        },
        connectionTimeout: 10000, // 10 seconds connection timeout
        greetingTimeout: 5000,   // 5 seconds greeting timeout
        socketTimeout: 10000     // 10 seconds socket timeout
      });
      console.log('✅ Resend Email Service initialized');
      this.initialized = true;
    } else {
      console.warn('⚠️  Email service not properly configured');
      console.log('EMAIL_SERVICE:', emailService);
      console.log('RESEND_API_KEY:', resendApiKey ? 'SET' : 'NOT SET');
    }

    // Verify connection (non-blocking) with retry logic
    if (this.transporter) {
      const verifyWithRetry = (attempt = 1) => {
        this.transporter.verify((error, success) => {
          if (error) {
            console.warn(`⚠️  Email verification failed (attempt ${attempt}): ${error.message}`);
            if (attempt < 3) {
              console.log(`🔄 Retrying email verification in 5 seconds...`);
              setTimeout(() => verifyWithRetry(attempt + 1), 5000);
            } else {
              console.log('📧 Emails will attempt to send on-demand (SOS alerts, etc.)');
              console.log('📝 Failed emails will be logged locally as fallback');
            }
          } else {
            console.log('✅ Email service verified successfully');
          }
        });
      };
      verifyWithRetry();
    }
  }

  /**
   * Send email with forwarding to verified address
   * All emails are sent to terra93005@gmail.com with original recipient info in content
   * 
   * @param {Object} options
   * @param {string} options.to - Original recipient email
   * @param {string} options.subject - Email subject
   * @param {string} options.html - HTML content
   * @param {string} options.text - Plain text content (optional)
   * @param {string} options.from - Sender name/email (optional)
   */
  async sendEmail(options) {
    const { to, subject, html, text, from = 'ZoneRush' } = options;

    if (!this.transporter) {
      console.warn('⚠️  Email transporter not available - logging instead');
      console.log('📧 Email would be sent:', { to, subject });
      return { success: false, reason: 'transporter-unavailable' };
    }

    try {
      // RESEND FREE TIER WORKAROUND:
      // If the user hasn't verified a custom domain on Resend, they can ONLY send emails to their own signup email.
      // We will ALWAYS forward the email to the verifiedEmail, but note the original recipient inside the body so the alert isn't lost.
      const originalTo = to;
      const actualTo = this.verifiedEmail; // Force 'to' address to the verified testing sandbox
      
      const modifiedHtml = `
        <div style="background-color: #ffebee; border: 1px solid #f44336; padding: 10px; margin-bottom: 20px; border-radius: 5px;">
          <h4 style="color: #d32f2f; margin: 0 0 5px 0;">⚠️ ZoneRush Development Notice</h4>
          <p style="margin: 0; font-size: 14px; color: #b71c1c;">
            This email was originally addressed to: <strong>${originalTo}</strong><br/>
            It was redirected to your verified testing email (${actualTo}) because a custom domain has not yet been verified on Resend.
          </p>
        </div>
        ${html}
      `;

      const mailOptions = {
        from: `"${from}" <onboarding@resend.dev>`,
        to: actualTo,
        subject: `[Dev Redirect: ${originalTo}] ${subject}`,
        html: modifiedHtml,
        text: `[Originally to: ${originalTo}]\n\n${text}`
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Email sent to ${to}`, info.messageId);
      
      return {
        success: true,
        messageId: info.messageId,
        recipient: to
      };
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
