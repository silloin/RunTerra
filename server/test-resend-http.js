/**
 * Quick test: Resend HTTP API (no SMTP - uses port 443 HTTPS only)
 * Run: node test-resend-http.js
 */
require('dotenv').config();

const apiKey = process.env.RESEND_API_KEY;
const recipient = process.env.RESEND_VERIFIED_RECIPIENT || 'terra93005@gmail.com';

if (!apiKey) {
  console.error('❌ RESEND_API_KEY not set in .env');
  process.exit(1);
}

console.log('🧪 Testing Resend HTTP API...');
console.log('   API Key:', apiKey.slice(0, 8) + '...');
console.log('   Sending to:', recipient);

fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    from: 'onboarding@resend.dev',
    to: recipient,
    subject: '✅ ZoneRush SOS Email Test — HTTP API Working',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px">
        <h2 style="color:#22c55e">✅ Email Test Successful!</h2>
        <p>The Resend HTTP API is working correctly for ZoneRush SOS alerts.</p>
        <p><strong>Method:</strong> HTTPS (port 443) — no SMTP ports needed</p>
        <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
        <hr/>
        <p style="color:#666;font-size:13px">
          SOS alerts will now be delivered reliably without connection timeouts.
        </p>
      </div>
    `,
    text: `ZoneRush Email Test - Resend HTTP API working at ${new Date().toLocaleString()}`,
  }),
})
  .then(async (res) => {
    const body = await res.json().catch(() => res.text());
    if (res.ok) {
      console.log('✅ SUCCESS! Email sent via Resend HTTP API');
      console.log('   Message ID:', body.id);
      console.log('   Check your inbox at:', recipient);
    } else {
      console.error('❌ Resend API error:', res.status, body);
    }
  })
  .catch((err) => {
    console.error('❌ Network error (check internet connection):', err.message);
  });
