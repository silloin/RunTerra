/**
 * Fallback Email Service - Uses Ethereal for testing when Gmail fails
 */

const nodemailer = require('nodemailer');
const crypto = require('crypto');
const pool = require('../config/db');

class EmailFallbackService {
  constructor() {
    this.transporter = null;
    this.initializeEtherealTransporter();
  }

  async initializeEtherealTransporter() {
    try {
      console.log('Initializing Ethereal Email for testing...');
      const account = await nodemailer.createTestAccount();
      
      this.transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: account.user,
          pass: account.pass
        },
        connectionTimeout: 15000, // 15 seconds connection timeout
        greetingTimeout: 10000,   // 10 seconds greeting timeout
        socketTimeout: 15000     // 15 seconds socket timeout
      });

      console.log('Email test URLs: https://ethereal.email/messages');
      this.testAccount = account;
    } catch (error) {
      console.error('Failed to initialize Ethereal Email:', error);
    }
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
    if (!this.transporter) {
      console.log('Email service unavailable - skipping verification email');
      return {
        success: true,
        messageId: 'email-disabled',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        note: 'Email verification skipped - service unavailable'
      };
    }

    try {
      const verification = await this.createVerificationRecord(userId, email);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const verificationLink = `${frontendUrl}/verify-email?token=${verification.token}`;

      const mailOptions = {
        from: `"ZoneRush Test" <${this.testAccount.user}>`,
        to: email,
        subject: 'Test: ZoneRush Email Verification',
        html: `
          <h2>Email Service Test</h2>
          <p>This is a test email from ZoneRush deployment.</p>
          <p><strong>Verification Link:</strong> <a href="${verificationLink}">${verificationLink}</a></p>
          <p><strong>User:</strong> ${username}</p>
          <p><strong>Email:</strong> ${email}</p>
          <hr>
          <p><small>This is a test email using Ethereal Email service.</small></p>
        `,
        text: `Test email for ${username} (${email}). Verification link: ${verificationLink}`
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log('Test email sent:', info.messageId);
      console.log('Preview URL:', nodemailer.getTestMessageUrl(info));

      return {
        success: true,
        messageId: info.messageId,
        expiresAt: verification.expires_at,
        previewUrl: nodemailer.getTestMessageUrl(info),
        note: 'Test email sent via Ethereal - check preview URL'
      };
    } catch (error) {
      console.warn('Test email failed:', error.message);
      return {
        success: true,
        messageId: 'test-failed',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        note: 'Email test failed - app continues without email'
      };
    }
  }

  async sendSOSEmail(emergencyContact, userInfo, location) {
    if (!this.transporter) {
      console.log('SOS email unavailable - using console log');
      console.log('SOS ALERT:', { emergencyContact, userInfo, location });
      return { success: false, reason: 'email-unavailable' };
    }

    try {
      const mailOptions = {
        from: `"ZoneRush SOS" <${this.testAccount.user}>`,
        to: emergencyContact.email,
        subject: 'SOS ALERT - Test Message',
        html: `
          <h1>TEST SOS ALERT</h1>
          <p>This is a test SOS alert from ZoneRush.</p>
          <p><strong>User:</strong> ${userInfo.username}</p>
          <p><strong>Location:</strong> ${location.lat}, ${location.lng}</p>
          <p><strong>Time:</strong> ${new Date().toISOString()}</p>
          <hr>
          <p><small>This is a test using Ethereal Email service.</small></p>
        `
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log('Test SOS email sent:', info.messageId);
      console.log('Preview URL:', nodemailer.getTestMessageUrl(info));

      return {
        success: true,
        messageId: info.messageId,
        previewUrl: nodemailer.getTestMessageUrl(info),
        note: 'Test SOS email sent via Ethereal'
      };
    } catch (error) {
      console.warn('Test SOS email failed:', error.message);
      return { success: false, reason: 'send-failed' };
    }
  }
}

module.exports = new EmailFallbackService();
