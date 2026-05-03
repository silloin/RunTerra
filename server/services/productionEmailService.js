/**
 * Production-Ready Email Service with Multiple Providers
 * Handles deployment-specific email service issues
 */

const nodemailer = require('nodemailer');

class ProductionEmailService {
  constructor() {
    this.transporter = null;
    this.serviceType = null;
    this.initialized = false;
    this.isProduction = process.env.NODE_ENV === 'production';
  }

  async initialize() {
    if (this.initialized) return;

    // Try different email services based on environment
    const services = [
      () => this.initializeResend(),
      () => this.initializeGmail(),
      () => this.initializeSendGrid(),
      () => this.initializeMailgun(),
      () => this.initializeEthereal()
    ];

    for (const initService of services) {
      try {
        await initService();
        if (this.transporter) {
          break;
        }
      } catch (error) {
        console.log(`Email service failed: ${error.message}`);
      }
    }

    if (!this.transporter) {
      console.warn('⚠️  All email services failed - will use local logging fallback');
    }

    this.initialized = true;
  }

  async initializeResend() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return;

    try {
      this.transporter = nodemailer.createTransport({
        host: 'smtp.resend.com',
        port: this.isProduction ? 465 : 587, // Use SSL in production
        secure: this.isProduction, // true for 465, false for 587
        auth: {
          user: 'resend',
          pass: apiKey
        },
        connectionTimeout: 15000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
        tls: {
          rejectUnauthorized: false // More permissive for production
        }
      });

      await this.verifyConnection();
      this.serviceType = 'resend';
      console.log('✅ Resend Email Service initialized');
    } catch (error) {
      console.warn('Resend initialization failed:', error.message);
      throw error;
    }
  }

  async initializeGmail() {
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) return;

    try {
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass },
        connectionTimeout: 15000,
        greetingTimeout: 10000,
        socketTimeout: 15000
      });

      await this.verifyConnection();
      this.serviceType = 'gmail';
      console.log('✅ Gmail Email Service initialized');
    } catch (error) {
      console.warn('Gmail initialization failed:', error.message);
      throw error;
    }
  }

  async initializeSendGrid() {
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) return;

    try {
      this.transporter = nodemailer.createTransport({
        host: 'smtp.sendgrid.net',
        port: 587,
        secure: false,
        auth: {
          user: 'apikey',
          pass: apiKey
        },
        connectionTimeout: 15000,
        greetingTimeout: 10000,
        socketTimeout: 15000
      });

      await this.verifyConnection();
      this.serviceType = 'sendgrid';
      console.log('✅ SendGrid Email Service initialized');
    } catch (error) {
      console.warn('SendGrid initialization failed:', error.message);
      throw error;
    }
  }

  async initializeMailgun() {
    const user = process.env.MAILGUN_SMTP_LOGIN;
    const pass = process.env.MAILGUN_SMTP_PASSWORD;
    if (!user || !pass) return;

    try {
      this.transporter = nodemailer.createTransport({
        host: process.env.MAILGUN_SMTP_SERVER || 'smtp.mailgun.org',
        port: 587,
        secure: false,
        auth: { user, pass },
        connectionTimeout: 15000,
        greetingTimeout: 10000,
        socketTimeout: 15000
      });

      await this.verifyConnection();
      this.serviceType = 'mailgun';
      console.log('✅ Mailgun Email Service initialized');
    } catch (error) {
      console.warn('Mailgun initialization failed:', error.message);
      throw error;
    }
  }

  async initializeEthereal() {
    try {
      const account = await nodemailer.createTestAccount();
      
      this.transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: account.user,
          pass: account.pass
        },
        connectionTimeout: 15000,
        greetingTimeout: 10000,
        socketTimeout: 15000
      });

      await this.verifyConnection();
      this.serviceType = 'ethereal';
      this.testAccount = account;
      console.log('✅ Ethereal Email Service initialized');
      console.log('📧 Test emails at: https://ethereal.email/messages');
    } catch (error) {
      console.warn('Ethereal initialization failed:', error.message);
      throw error;
    }
  }

  async verifyConnection() {
    return new Promise((resolve, reject) => {
      this.transporter.verify((error, success) => {
        if (error) {
          reject(error);
        } else {
          resolve(success);
        }
      });
    });
  }

  async sendEmail(options) {
    const { to, subject, html, text, from = 'ZoneRush' } = options;

    if (!this.transporter) {
      console.warn('⚠️  Email transporter not available');
      return { success: false, reason: 'no-transporter' };
    }

    try {
      let mailOptions;

      if (this.serviceType === 'resend') {
        // Resend specific configuration
        mailOptions = {
          from: `"${from}" <onboarding@resend.dev>`,
          to: this.isProduction ? 'terra93005@gmail.com' : to, // Forward in production
          subject: this.isProduction ? `[Dev Redirect: ${to}] ${subject}` : subject,
          html: this.isProduction ? this.addDevNotice(to, html) : html,
          text: text
        };
      } else if (this.serviceType === 'ethereal') {
        // Ethereal test configuration
        mailOptions = {
          from: `"${from}" <${this.testAccount.user}>`,
          to: to,
          subject: `[TEST] ${subject}`,
          html: html,
          text: text
        };
      } else {
        // Other services (Gmail, SendGrid, Mailgun)
        mailOptions = {
          from: `"${from}" <${process.env.EMAIL_FROM || process.env.GMAIL_USER}>`,
          to: to,
          subject: subject,
          html: html,
          text: text
        };
      }

      const info = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Email sent via ${this.serviceType} to ${to}`, info.messageId);
      
      return {
        success: true,
        messageId: info.messageId,
        service: this.serviceType,
        forwardedTo: this.serviceType === 'resend' && this.isProduction ? 'terra93005@gmail.com' : null
      };
    } catch (error) {
      console.error(`❌ Email failed via ${this.serviceType}:`, error.message);
      return { success: false, reason: error.message, service: this.serviceType };
    }
  }

  addDevNotice(originalTo, html) {
    return `
      <div style="background-color: #ffebee; border: 1px solid #f44336; padding: 10px; margin-bottom: 20px; border-radius: 5px;">
        <h4 style="color: #d32f2f; margin: 0 0 5px 0;">⚠️ ZoneRush Production Notice</h4>
        <p style="margin: 0; font-size: 14px; color: #b71c1c;">
          This email was originally addressed to: <strong>${originalTo}</strong><br/>
          It was redirected to your verified email due to production deployment restrictions.
        </p>
      </div>
      ${html}
    `;
  }

  async sendSOSEmail(options) {
    const { to, userName, location, mapsLink, customMessage } = options;
    
    const subject = `🚨 SOS ALERT - ${userName}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f44336; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">🚨 EMERGENCY SOS ALERT</h1>
        </div>
        <div style="background-color: #ffffff; padding: 20px; border: 1px solid #ddd; border-radius: 0 0 8px 8px;">
          <p><strong>User:</strong> ${userName}</p>
          <p><strong>Location:</strong> ${location}</p>
          ${mapsLink ? `<p><strong>Maps Link:</strong> <a href="${mapsLink}" style="color: #f44336;">View Location</a></p>` : ''}
          <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
          ${customMessage ? `<p><strong>Message:</strong> ${customMessage}</p>` : ''}
          <hr style="margin: 20px 0;">
          <p style="color: #666; font-size: 14px;">
            This is an automated emergency alert from ZoneRush. Please respond immediately.
          </p>
        </div>
      </div>
    `;
    
    const text = `SOS ALERT - User: ${userName}, Location: ${location}, Time: ${new Date().toLocaleString()}`;

    return this.sendEmail({
      to,
      subject,
      html,
      text,
      from: 'ZoneRush SOS'
    });
  }
}

module.exports = new ProductionEmailService();
