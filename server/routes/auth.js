const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { SignJWT, createSecretKey } = require('jose');
const { authRateLimitMiddleware } = require('../middleware/rateLimiter');
const auth = require('../middleware/auth');
const pool = require('../config/db');
const emailVerificationService = require('../services/emailVerificationService');
const passwordResetService = require('../services/passwordResetService');
const securityLogger = require('../middleware/securityLogger');
const { validateBody, validateParams } = require('../middleware/inputValidation');

// Apply abuse protection middleware (will be attached via req.abuseProtection)
const withAbuseProtection = (req, res, next) => {
  if (!req.abuseProtection) {
    return next(); // Skip if not initialized
  }
  next();
};

// @route   GET api/auth/csrf-token
// @desc    Get CSRF token (public endpoint for establishing session)
// @access  Public
router.get('/csrf-token', (req, res) => {
  // CSRF middleware already sets the cookie, just return success
  res.json({ msg: 'CSRF token set' });
});

// @route   GET api/auth
// @desc    Get user by token
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const query = `
      SELECT 
        u.id, 
        u.username, 
        u.email,
        u.city,
        u.bio,
        u.fitness_level,
        u.profile_picture,
        u.xp, 
        u.level, 
        u.streak,
        COALESCE(u.total_xp, 0) as "totalDistance",
        COALESCE(u.territories_captured, 0) as "totalTiles",
        COALESCE(u.total_territory_area, 0) as "weeklyMileage"
      FROM users u
      WHERE u.id = $1
    `;
    const result = await pool.query(query, [req.user.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ msg: 'User not found' });
    }
    
    const userData = result.rows[0];
    
    // Convert relative profile_picture URL to full URL if it exists
    if (userData.profile_picture && userData.profile_picture.startsWith('/uploads/')) {
      userData.profile_picture = `${req.protocol}://${req.get('host')}${userData.profile_picture}`;
    }
    
    res.json(userData);
  } catch (err) {
    console.error('Error in auth middleware:', err.message);
    res.status(500).send('Server Error');
  }
});

// @route   POST api/auth/register
// @desc    Register user
// @access  Public - Rate limited: 3 per hour per IP
router.post('/register', 
  authRateLimitMiddleware,
  validateBody({
    username: { type: 'username', required: true },
    email: { type: 'email', required: true },
    password: { type: 'password', required: true }
  }),
  (req, res, next) => {
    // Additional abuse protection
    if (req.abuseProtection) {
      return req.abuseProtection.rateLimit(
        req.abuseProtection.registrationLimiter,
        {
          keyGenerator: (req) => `ip_${req.ip}`,
          errorMessage: 'Too many registration attempts. Please try again later.',
          logViolation: true
        }
      )(req, res, next);
    }
    next();
  },
  async (req, res) => {
  const { username, email, password } = req.validated;

  try {
    // Check if email already exists
    let existingEmail = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existingEmail.rows.length > 0) {
      return res.status(400).json({ msg: 'Email already registered' });
    }

    // Check if username already exists
    let existingUsername = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (existingUsername.rows.length > 0) {
      return res.status(400).json({ msg: 'Username already taken' });
    }

    // Encrypt password (use configured salt rounds, minimum 12)
    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
    const salt = await bcrypt.genSalt(Math.max(saltRounds, 12));
    const hashedPassword = await bcrypt.hash(password, salt);

    // Insert user into database
    const newUser = await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email',
      [username, email, hashedPassword]
    );

    // Log security event
    await pool.query(
      `INSERT INTO security_events (user_id, event_type, ip_address, details)
       VALUES ($1, 'registration', $2, $3)`,
      [newUser.rows[0].id, req.ip, JSON.stringify({ username })]
    );

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error('CRITICAL: JWT_SECRET is not set in environment variables');
      return res.status(500).json({ msg: 'Server configuration error. Please contact administrator.' });
    }

    const crypto = require('crypto');
    const secret = new TextEncoder().encode(jwtSecret);
    const tokenJti = crypto.randomUUID(); // Unique token ID for blacklist
    
    const token = await new SignJWT({ user: { id: newUser.rows[0].id } })
      .setProtectedHeader({ alg: 'HS256' })
      .setJti(tokenJti) // Add unique ID for blacklist support
      .setIssuedAt()
      .setExpirationTime('12h') // Reduced from 24h to 12h
      .sign(secret);

    // Set secure cookie (httpOnly prevents XSS, secure requires HTTPS)
    res.cookie('token', token, {
      httpOnly: true, // Prevents JavaScript access (XSS protection)
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict', // Allow cross-origin in production
      maxAge: 12 * 60 * 60 * 1000, // 12 hours (reduced from 24h)
      path: '/',
      domain: undefined
    });

    // Send verification email (non-blocking)
    try {
      await emailVerificationService.sendVerificationEmail(
        newUser.rows[0].id,
        newUser.rows[0].email,
        newUser.rows[0].username
      );
      console.log(`Verification email sent to ${newUser.rows[0].email}`);
    } catch (emailError) {
      console.error('Failed to send verification email:', emailError.message);
      // Don't fail registration if email fails
    }

    // Return token + full user profile (same as login)
    const fullUserResult = await pool.query(
      `SELECT 
        id, username, email, city, bio, fitness_level,
        profile_picture, xp, level, streak,
        COALESCE(total_xp, 0) as "totalDistance",
        COALESCE(territories_captured, 0) as "totalTiles",
        COALESCE(total_territory_area, 0) as "weeklyMileage",
        email_verified as "emailVerified"
       FROM users WHERE id = $1`,
      [newUser.rows[0].id]
    );
    const fullUser = fullUserResult.rows[0];

    res.json({ 
      token: token,
      user: fullUser,
      msg: 'Registration successful. Please check your email to verify your account.'
    });
  } catch (err) {
    console.error('Registration error:', err.message);
    
    // Handle duplicate key errors gracefully
    if (err.code === '23505') {
      // PostgreSQL unique violation
      if (err.detail && err.detail.includes('username')) {
        return res.status(400).json({ msg: 'Username already taken' });
      }
      if (err.detail && err.detail.includes('email')) {
        return res.status(400).json({ msg: 'Email already registered' });
      }
    }
    
    console.error('Error details:', err);
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

// @route   POST api/auth/login
// @desc    Authenticate user & get token
// @access  Public - Rate limited: 5 per 15 minutes per IP
router.post('/login',
  authRateLimitMiddleware,
  (req, res, next) => {
    // Additional abuse protection
    if (req.abuseProtection) {
      return req.abuseProtection.rateLimit(
        req.abuseProtection.loginLimiter,
        {
          keyGenerator: (req) => `ip_${req.ip}`,
          errorMessage: 'Too many login attempts. Please try again in 15 minutes.',
          logViolation: true
        }
      )(req, res, next);
    }
    next();
  },
  async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      return res.status(400).json({ msg: 'Please provide email and password' });
    }

    // Check if user exists
    const normalizedEmail = typeof email === 'string' ? email.toLowerCase() : String(email).toLowerCase();
    let user = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
    if (user.rows.length === 0) {
      console.log(`Login failed: User not found for email ${email}`);
      return res.status(400).json({ msg: 'Invalid credentials' });
    }

    const userData = user.rows[0];

    // Check if account is locked due to too many failed attempts
    if (userData.account_locked && userData.lockout_until > new Date()) {
      const lockoutMinutes = Math.ceil((userData.lockout_until - new Date()) / 60000);
      
      // Log locked account attempt
      securityLogger.logAuthAttempt({
        success: false,
        userId: userData.id,
        email: email,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        reason: 'account_locked',
        attemptCount: null
      });
      
      return res.status(429).json({ 
        msg: `Account temporarily locked. Try again in ${lockoutMinutes} minutes.` 
      });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, userData.password_hash);
    if (!isMatch) {
      // Log failed attempt
      await pool.query(
        `INSERT INTO login_attempts (user_id, ip_address, attempted_at)
         VALUES ($1, $2, NOW())`,
        [userData.id, req.ip]
      );

      // Update last failed login
      await pool.query(
        'UPDATE users SET last_failed_login = NOW() WHERE id = $1',
        [userData.id]
      );

      // Check if should lock account (5 failed attempts in 30 minutes)
      const recentAttempts = await pool.query(
        `SELECT COUNT(*) FROM login_attempts 
         WHERE user_id = $1 AND attempted_at > NOW() - INTERVAL '30 minutes'`,
        [userData.id]
      );

      const attemptCount = parseInt(recentAttempts.rows[0].count);
      
      // Log failed login attempt
      securityLogger.logAuthAttempt({
        success: false,
        userId: userData.id,
        email: email,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        reason: 'invalid_password',
        attemptCount: attemptCount
      });
      if (attemptCount >= 5) {
        // Lock account for 30 minutes
        const lockoutUntil = new Date(Date.now() + 30 * 60 * 1000);
        await pool.query(
          `UPDATE users 
           SET account_locked = true, lockout_until = $1 
           WHERE id = $2`,
          [lockoutUntil, userData.id]
        );

        // Log security event
        await pool.query(
          `INSERT INTO security_events (user_id, event_type, ip_address, details)
           VALUES ($1, 'account_locked', $2, $3)`,
          [userData.id, req.ip, JSON.stringify({ attempts: attemptCount })]
        );

        return res.status(429).json({ 
          msg: 'Account locked due to too many failed attempts. Try again in 30 minutes.' 
        });
      }

      return res.status(400).json({ 
        msg: `Invalid credentials. ${5 - attemptCount} attempts remaining.` 
      });
    }

    // Successful login - clear failed attempts
    await pool.query(
      `DELETE FROM login_attempts WHERE user_id = $1`,
      [userData.id]
    );

    // Unlock account if it was locked
    if (userData.account_locked) {
      await pool.query(
        `UPDATE users 
         SET account_locked = false, lockout_until = NULL 
         WHERE id = $1`,
        [userData.id]
      );
    }

    // Log successful login
    securityLogger.logAuthAttempt({
      success: true,
      userId: userData.id,
      email: email,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      reason: null,
      attemptCount: 0
    });

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error('CRITICAL: JWT_SECRET is not set in environment variables');
      return res.status(500).json({ msg: 'Server configuration error. Please contact administrator.' });
    }

    const crypto = require('crypto');
    const secret = new TextEncoder().encode(jwtSecret);
    const tokenJti = crypto.randomUUID();
    
    const token = await new SignJWT({ user: { id: userData.id } })
      .setProtectedHeader({ alg: 'HS256' })
      .setJti(tokenJti)
      .setIssuedAt()
      .setExpirationTime('12h')
      .sign(secret);

    // Set secure cookie (for same-origin requests)
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      maxAge: 12 * 60 * 60 * 1000,
      path: '/',
      domain: process.env.NODE_ENV === 'production' ? undefined : undefined
    });

    // Log successful login
    await pool.query(
      `INSERT INTO security_events (user_id, event_type, ip_address)
       VALUES ($1, 'login_success', $2)`,
      [userData.id, req.ip]
    );

    // Return token + full user profile for cross-origin requests (Vercel → Render)
    // Fetch full user data (same as /auth GET) so Profile page renders immediately
    const fullUserResult = await pool.query(
      `SELECT 
        id, username, email, city, bio, fitness_level,
        profile_picture, xp, level, streak,
        COALESCE(total_xp, 0) as "totalDistance",
        COALESCE(territories_captured, 0) as "totalTiles",
        COALESCE(total_territory_area, 0) as "weeklyMileage",
        email_verified as "emailVerified"
       FROM users WHERE id = $1`,
      [userData.id]
    );
    const fullUser = fullUserResult.rows[0];
    
    // Convert relative profile_picture URL to full URL if it exists
    if (fullUser.profile_picture && fullUser.profile_picture.startsWith('/uploads/')) {
      fullUser.profile_picture = `${req.protocol}://${req.get('host')}${fullUser.profile_picture}`;
    }

    res.json({ 
      token: token,
      user: fullUser
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

// @route   POST api/auth/logout
// @desc    Logout user & clear cookie
// @access  Public
router.post('/logout', auth, async (req, res) => {
  try {
    // Get token from cookie to extract JTI
    const token = req.cookies.token;
    
    if (token) {
      // Decode token to get JTI (without full verification)
      const { jwtVerify } = require('jose');
      const secret = new TextEncoder().encode(process.env.JWT_SECRET);
      
      try {
        const { payload } = await jwtVerify(token, secret);
        
        // Add token to blacklist
        if (payload.jti && payload.exp) {
          await pool.query(
            `INSERT INTO token_blacklist (token_jti, expires_at)
             VALUES ($1, to_timestamp($2))`,
            [payload.jti, payload.exp]
          );
          
          // Log security event
          await pool.query(
            `INSERT INTO security_events (user_id, event_type, ip_address)
             VALUES ($1, 'logout', $2)`,
            [req.user.id, req.ip]
          );
        }
      } catch (err) {
        // Token might be invalid, but still clear cookie
        console.warn('Could not decode token for blacklist:', err.message);
      }
    }
    
    // Clear cookie
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/'
    });
    
    res.json({ msg: 'Logged out successfully' });
  } catch (err) {
    console.error('Logout error:', err.message);
    // Still clear cookie even if error occurs
    res.clearCookie('token', { path: '/' });
    res.json({ msg: 'Logged out successfully' });
  }
});

// @route   POST api/auth/verify-email
// @desc    Verify email with token
// @access  Public
router.post('/verify-email', authRateLimitMiddleware, async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ msg: 'Verification token is required' });
  }

  try {
    const result = await emailVerificationService.verifyToken(token);

    if (!result.success) {
      return res.status(400).json({ msg: result.error });
    }

    res.json({
      msg: 'Email verified successfully',
      userId: result.userId,
      email: result.email
    });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ msg: 'Server error during verification' });
  }
});

// @route   POST api/auth/resend-verification
// @desc    Resend verification email
// @access  Private
router.post('/resend-verification', auth, authRateLimitMiddleware, async (req, res) => {
  try {
    const result = await emailVerificationService.resendVerificationEmail(req.user.id);

    res.json({
      msg: 'Verification email resent',
      expiresAt: result.expiresAt
    });
  } catch (error) {
    console.error('Resend verification error:', error);
    
    if (error.message.includes('already verified')) {
      return res.status(400).json({ msg: 'Email already verified' });
    }
    
    if (error.message.includes('Too many requests')) {
      return res.status(429).json({ msg: error.message });
    }

    res.status(500).json({ msg: 'Failed to resend verification email' });
  }
});

// @route   GET api/auth/verification-status
// @desc    Check user's verification status
// @access  Private
router.get('/verification-status', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT email_verified, email FROM users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ msg: 'User not found' });
    }

    res.json({
      emailVerified: result.rows[0].email_verified,
      email: result.rows[0].email
    });
  } catch (error) {
    console.error('Verification status check error:', error);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   POST api/auth/forgot-password
// @desc    Request password reset email
// @access  Public
router.post('/forgot-password', authRateLimitMiddleware, async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ msg: 'Email is required' });
  }

  try {
    const result = await passwordResetService.requestPasswordReset(email);
    res.json(result);
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   POST api/auth/reset-password
// @desc    Reset password with token
// @access  Public - Rate limited: 3 per hour per IP
router.post('/reset-password',
  authRateLimitMiddleware,
  (req, res, next) => {
    if (req.abuseProtection) {
      return req.abuseProtection.rateLimit(
        req.abuseProtection.passwordResetLimiter,
        {
          keyGenerator: (req) => `ip_${req.ip}`,
          errorMessage: 'Too many password reset attempts. Try again in 1 hour.',
          logViolation: true
        }
      )(req, res, next);
    }
    next();
  },
  async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ msg: 'Token and new password are required' });
  }

  try {
    const result = await passwordResetService.resetPassword(token, newPassword);

    if (!result.success) {
      return res.status(400).json({ msg: result.error });
    }

    res.json({ msg: result.msg });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;