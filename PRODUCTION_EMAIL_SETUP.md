# Production Email Service Setup Guide

This guide explains how to configure email services for the ZoneRush application in production environments.

## Problem
Resend API works locally but fails after deployment due to:
- Environment variables not being set in production
- Network/firewall restrictions in production
- Different domain verification requirements
- Port blocking on hosting platforms

## Solution: Multi-Provider Email Service

The application now uses a production-ready email service that automatically tries multiple email providers in order:

### 1. Resend (Primary)
- **Environment Variables:**
  ```
  RESEND_API_KEY=your_resend_api_key
  EMAIL_SERVICE=resend
  ```
- **Notes:** Works best with verified domain. In production, emails are forwarded to terra93005@gmail.com

### 2. Gmail (Secondary)
- **Environment Variables:**
  ```
  GMAIL_USER=your_email@gmail.com
  GMAIL_APP_PASSWORD=your_app_password
  ```
- **Setup:**
  1. Enable 2-factor authentication on your Gmail account
  2. Generate an App Password: https://myaccount.google.com/apppasswords
  3. Use the App Password (not your regular password)

### 3. SendGrid (Tertiary)
- **Environment Variables:**
  ```
  SENDGRID_API_KEY=your_sendgrid_api_key
  ```
- **Notes:** Requires SendGrid account and API key

### 4. Mailgun (Quaternary)
- **Environment Variables:**
  ```
  MAILGUN_SMTP_LOGIN=postmaster@your_domain.com
  MAILGUN_SMTP_PASSWORD=your_mailgun_password
  MAILGUN_SMTP_SERVER=smtp.mailgun.org
  ```
- **Notes:** Requires Mailgun account and domain setup

### 5. Ethereal (Development Fallback)
- **No configuration required**
- **Notes:** Test email service for development only
- **Access:** https://ethereal.email/messages

## Deployment Configuration

### For Render.com
Add these environment variables in your Render dashboard:

```
NODE_ENV=production
RESEND_API_KEY=your_resend_api_key
GMAIL_USER=your_email@gmail.com
GMAIL_APP_PASSWORD=your_app_password
EMAIL_FROM=your_email@gmail.com
```

### For Vercel/Netlify
Add these to your environment variables:
```
RESEND_API_KEY=your_resend_api_key
GMAIL_USER=your_email@gmail.com
GMAIL_APP_PASSWORD=your_app_password
```

### For Docker/Heroku
Set environment variables:
```bash
export RESEND_API_KEY=your_resend_api_key
export GMAIL_USER=your_email@gmail.com
export GMAIL_APP_PASSWORD=your_app_password
export NODE_ENV=production
```

## Troubleshooting

### Connection Timeout Issues
1. **Check firewall rules:** Ensure SMTP ports (587, 465) are open
2. **Verify API keys:** Make sure API keys are correct and active
3. **Test locally:** Use the test-email.js script to verify configuration

### Domain Verification Issues
1. **Resend:** Add and verify your custom domain in Resend dashboard
2. **SendGrid:** Authenticate your sending domain
3. **Mailgun:** Verify your domain in Mailgun control panel

### SSL/TLS Issues
The production email service automatically handles:
- SSL/TLS configuration
- Certificate validation
- Secure connections

## Testing

### Test Email Configuration
```bash
cd server
node test-email.js
```

### Test SOS Email
```bash
cd server
node test-sos-email-now.js
```

## Fallback Behavior

If all email services fail:
1. Emails are logged to `server/logs/email-fallback.log`
2. No SOS alerts are lost
3. Full email content is preserved for manual review

## Security Notes

1. **Never commit API keys** to version control
2. **Use environment variables** for all sensitive data
3. **Rotate API keys** regularly
4. **Monitor email logs** for delivery issues

## Production Best Practices

1. **Set up email monitoring** to track delivery rates
2. **Configure bounce handling** for invalid emails
3. **Use dedicated IP addresses** for high volume sending
4. **Implement rate limiting** to prevent spam flags
5. **Set up DKIM/SPF records** for better deliverability

## Support

If you continue to experience issues:
1. Check the application logs for specific error messages
2. Verify all environment variables are set correctly
3. Test each email service individually
4. Consider using a professional email service for production

The multi-provider approach ensures that emails will be sent even if one service experiences issues.
