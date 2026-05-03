/**
 * Production-Ready Email Service
 *
 * PRIMARY:  Resend HTTP API  (HTTPS port 443 — never blocked by firewalls/ISPs)
 * FALLBACK: Gmail SMTP       (requires GMAIL_USER + GMAIL_APP_PASSWORD in .env)
 * LAST:     Ethereal SMTP    (dev-only test sink, needs port 587)
 *
 * The Resend free tier can only deliver to the email you signed up with.
 * All emails are forwarded to RESEND_VERIFIED_RECIPIENT (terra93005@gmail.com)
 * with the original recipient embedded in the subject and body.
 */

const nodemailer = require('nodemailer');

class ProductionEmailService {
  constructor() {
    this._transporter = null; // used only for SMTP fallbacks
    this.serviceType = null;
    this.initialized = false;
    this.testAccount = null;
  }

  // ─── Truthy check used by emergencyController ──────────────────────────────
  // `if (productionEmailService.transporter)` must be true when resend-api is active.
  get transporter() {
    return this._transporter || (this.serviceType === 'resend-api' ? true : null);
  }

  set transporter(val) {
    this._transporter = val;
  }

  // ─── Initialisation ─────────────────────────────────────────────────────────
  async initialize() {
    if (this.initialized) return;

    // 1. Resend HTTP API — primary, zero SMTP ports needed
    if (process.env.RESEND_API_KEY) {
      this.serviceType = 'resend-api';
      console.log('✅ Email service: Resend HTTP API (port 443, no SMTP required)');
      this.initialized = true;
      return;
    }

    // 2. Gmail SMTP fallback (needs App Password)
    try {
      await this.initializeGmail();
      if (this._transporter) { this.initialized = true; return; }
    } catch (e) {
      console.warn('Gmail SMTP unavailable:', e.message);
    }

    // 3. Ethereal dev sink (last resort, may still fail on blocked networks)
    try {
      await this.initializeEthereal();
      if (this._transporter) { this.initialized = true; return; }
    } catch (e) {
      console.warn('Ethereal SMTP unavailable:', e.message);
    }

    console.warn('⚠️  No email service available — alerts will be logged locally only');
    this.initialized = true;
  }

  // ─── SMTP provider initialisers (only used when Resend API key is absent) ──

  async initializeGmail() {
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) return;

    this._transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
      connectionTimeout: 30000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });

    await this._verifyConnection();
    this.serviceType = 'gmail';
    console.log('✅ Email service: Gmail SMTP');
  }

  async initializeEthereal() {
    const account = await nodemailer.createTestAccount();
    this._transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: account.user, pass: account.pass },
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
    await this._verifyConnection();
    this.serviceType = 'ethereal';
    this.testAccount = account;
    console.log('✅ Email service: Ethereal (dev-only) — view at https://ethereal.email/messages');
  }

  async _verifyConnection() {
    return new Promise((resolve, reject) => {
      this._transporter.verify((err, ok) => (err ? reject(err) : resolve(ok)));
    });
  }

  // ─── Send ────────────────────────────────────────────────────────────────────

  async sendEmail(options) {
    // Always use HTTP API when Resend key is present
    if (this.serviceType === 'resend-api') {
      return this._sendResendHTTP(options);
    }

    // SMTP fallback (Gmail / Ethereal)
    if (!this._transporter) {
      console.warn('⚠️  No email transporter available');
      return { success: false, reason: 'no-transporter' };
    }
    return this._sendSMTP(options);
  }

  // Resend HTTP API — the primary send path
  async _sendResendHTTP(options) {
    const { to, subject, html, text } = options;
    const apiKey = process.env.RESEND_API_KEY;

    if (!apiKey) {
      return { success: false, reason: 'RESEND_API_KEY not set', service: 'resend-api' };
    }

    // Free tier: can ONLY deliver to the verified signup email.
    // Embed original recipient so no alert info is lost.
    const verifiedEmail = process.env.RESEND_VERIFIED_RECIPIENT || 'terra93005@gmail.com';
    const redirectedSubject = `[To: ${to}] ${subject}`;
    const redirectedHtml = `
      <div style="background:#fff3cd;border:1px solid #ffc107;padding:10px;margin-bottom:15px;border-radius:5px;font-family:Arial,sans-serif">
        <strong>📬 Originally addressed to:</strong> ${to}<br/>
        <small style="color:#856404">Redirected — Resend free tier delivers to verified email only</small>
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
          to: verifiedEmail,
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
      console.log(`✅ Email sent via Resend HTTP API (→ ${verifiedEmail})`, result.id);
      return { success: true, messageId: result.id, service: 'resend-api', forwardedTo: verifiedEmail };
    } catch (error) {
      console.error(`❌ Resend HTTP API failed:`, error.message);
      return { success: false, reason: error.message, service: 'resend-api' };
    }
  }

  // SMTP send path (Gmail / Ethereal fallbacks)
  async _sendSMTP(options) {
    const { to, subject, html, text, from = 'ZoneRush' } = options;
    try {
      const fromAddr = this.serviceType === 'ethereal'
        ? `"${from}" <${this.testAccount.user}>`
        : `"${from}" <${process.env.GMAIL_USER}>`;

      const subjectPrefix = this.serviceType === 'ethereal' ? '[TEST] ' : '';

      const info = await this._transporter.sendMail({
        from: fromAddr,
        to,
        subject: subjectPrefix + subject,
        html,
        text,
      });

      console.log(`✅ Email sent via ${this.serviceType} to ${to}`, info.messageId);
      return { success: true, messageId: info.messageId, service: this.serviceType };
    } catch (error) {
      console.error(`❌ Email failed via ${this.serviceType}:`, error.message);
      return { success: false, reason: error.message, service: this.serviceType };
    }
  }

  // ─── Convenience senders ─────────────────────────────────────────────────────

  async sendSOSEmail(options) {
    const { to, userName, location, mapsLink, customMessage } = options;

    const subject = `🚨 SOS ALERT — ${userName}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#f44336;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0">
          <h1 style="margin:0;font-size:24px">🚨 EMERGENCY SOS ALERT</h1>
        </div>
        <div style="background:#fff;padding:20px;border:1px solid #ddd;border-radius:0 0 8px 8px">
          <p><strong>User:</strong> ${userName}</p>
          <p><strong>Location:</strong> ${location}</p>
          ${mapsLink ? `<p><strong>Maps Link:</strong> <a href="${mapsLink}" style="color:#f44336">View Location</a></p>` : ''}
          <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
          ${customMessage ? `<p><strong>Message:</strong> ${customMessage}</p>` : ''}
          <hr style="margin:20px 0"/>
          <p style="color:#666;font-size:14px">
            This is an automated emergency alert from ZoneRush. Please respond immediately.
          </p>
        </div>
      </div>
    `;

    const text = `SOS ALERT — User: ${userName}, Location: ${location}, Time: ${new Date().toLocaleString()}`;

    return this.sendEmail({ to, subject, html, text, from: 'ZoneRush SOS' });
  }

  async sendVerificationEmail(options) {
    const { to, username, verificationLink } = options;

    const html = `
      <h1 style="color:#4CAF50">🏃‍♂️ Welcome to ZoneRush!</h1>
      <p>Hi <strong>${username}</strong>,</p>
      <p>Please verify your email address:</p>
      <div style="text-align:center;margin:30px 0">
        <a href="${verificationLink}" style="background:#4CAF50;color:white;padding:15px 30px;text-decoration:none;border-radius:5px;font-size:16px;display:inline-block">
          Verify Email Address
        </a>
      </div>
      <p style="color:#666;font-size:14px">Or copy and paste: <span style="color:#007bff">${verificationLink}</span></p>
      <p style="color:#999;font-size:12px">This link expires in 24 hours.</p>
    `;

    return this.sendEmail({
      to,
      subject: '🏃‍♂️ Verify Your ZoneRush Account',
      html,
      text: `Welcome to ZoneRush!\n\nVerify your email: ${verificationLink}\n\nExpires in 24 hours.`,
      from: 'ZoneRush Verification',
    });
  }

  async sendPasswordResetEmail(options) {
    const { to, username, resetLink } = options;

    const html = `
      <h1 style="color:#2196F3">🔐 Password Reset Request</h1>
      <p>Hi <strong>${username}</strong>,</p>
      <p>Click below to reset your password:</p>
      <div style="text-align:center;margin:30px 0">
        <a href="${resetLink}" style="background:#2196F3;color:white;padding:15px 30px;text-decoration:none;border-radius:5px;font-size:16px;display:inline-block">
          Reset Password
        </a>
      </div>
      <p style="color:#666;font-size:14px">Or copy and paste: <span style="color:#007bff">${resetLink}</span></p>
      <p style="color:#999;font-size:12px">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
    `;

    return this.sendEmail({
      to,
      subject: '🔐 Reset Your ZoneRush Password',
      html,
      text: `Password Reset\n\nReset link: ${resetLink}\n\nExpires in 1 hour.`,
      from: 'ZoneRush Password Reset',
    });
  }
}

module.exports = new ProductionEmailService();
