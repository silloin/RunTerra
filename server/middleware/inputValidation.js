/**
 * Comprehensive Input Validation & Sanitization
 * Prevents SQL injection, XSS, command injection, and unsafe file uploads
 */

const validator = require('validator');
const path = require('path');

// ============================================
// Sanitization Functions
// ============================================

/**
 * Sanitize string to prevent XSS
 * Removes or escapes dangerous characters
 */
const sanitizeString = (str, options = {}) => {
  if (typeof str !== 'string') return str;
  
  const {
    allowHtml = false,
    maxLength = 1000,
    trim = true
  } = options;

  let sanitized = trim ? str.trim() : str;

  // Truncate to max length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  if (!allowHtml) {
    // Escape HTML entities
    sanitized = sanitized
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  return sanitized;
};

/**
 * Sanitize HTML (allow safe tags only)
 */
const sanitizeHtml = (str, maxLength = 5000) => {
  if (typeof str !== 'string') return '';
  
  let sanitized = str.trim().substring(0, maxLength);

  // Remove dangerous tags
  const dangerousTags = /<(script|iframe|object|embed|form|input|textarea|select|button|link|style|meta|base)\b[^>]*>[\s\S]*?<\/\1>/gi;
  sanitized = sanitized.replace(dangerousTags, '');

  // Remove event handlers
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*\S+/gi, '');

  // Remove javascript: protocol
  sanitized = sanitized.replace(/javascript\s*:/gi, '');

  return sanitized;
};

/**
 * Sanitize filename to prevent directory traversal
 */
const sanitizeFilename = (filename) => {
  if (typeof filename !== 'string') return 'unnamed';
  
  // Remove path components
  let sanitized = path.basename(filename);
  
  // Remove dangerous characters
  sanitized = sanitized.replace(/[^\w\s\.\-]/g, '');
  
  // Remove leading dots (hidden files)
  sanitized = sanitized.replace(/^\.+/, '');
  
  // Limit length
  if (sanitized.length > 100) {
    const ext = path.extname(sanitized);
    sanitized = sanitized.substring(0, 100 - ext.length) + ext;
  }
  
  return sanitized || 'unnamed';
};

/**
 * Sanitize number input
 */
const sanitizeNumber = (value, options = {}) => {
  const {
    min = -Infinity,
    max = Infinity,
    integer = false,
    required = false
  } = options;

  if (value === undefined || value === null) {
    return required ? null : undefined;
  }

  let num = Number(value);

  if (isNaN(num) || !isFinite(num)) {
    return null;
  }

  if (integer && !Number.isInteger(num)) {
    return null;
  }

  if (num < min || num > max) {
    return null;
  }

  return num;
};

/**
 * Sanitize email
 */
const sanitizeEmail = (email) => {
  if (typeof email !== 'string') return null;
  
  const sanitized = email.trim().toLowerCase();
  
  if (!validator.isEmail(sanitized)) {
    return null;
  }
  
  // Limit length
  return sanitized.substring(0, 254);
};

/**
 * Sanitize URL
 */
const sanitizeUrl = (url) => {
  if (typeof url !== 'string') return null;
  
  const trimmed = url.trim();
  
  if (!validator.isURL(trimmed, { protocols: ['http', 'https'], require_protocol: true })) {
    return null;
  }
  
  return trimmed.substring(0, 2048);
};

// ============================================
// Validation Functions
// ============================================

/**
 * Validate string input
 */
const validateString = (value, options = {}) => {
  const {
    required = false,
    minLength = 0,
    maxLength = 1000,
    pattern = null,
    patternName = 'format',
    allowEmpty = false
  } = options;

  if (value === undefined || value === null) {
    if (required) {
      return { valid: false, error: 'This field is required' };
    }
    return { valid: true, value: undefined };
  }

  if (typeof value !== 'string') {
    return { valid: false, error: 'Must be a string' };
  }

  const trimmed = value.trim();

  if (!allowEmpty && trimmed.length === 0) {
    if (required) {
      return { valid: false, error: 'This field cannot be empty' };
    }
    return { valid: true, value: '' };
  }

  if (trimmed.length < minLength) {
    return { valid: false, error: `Must be at least ${minLength} characters` };
  }

  if (trimmed.length > maxLength) {
    return { valid: false, error: `Must be less than ${maxLength} characters` };
  }

  if (pattern && !pattern.test(trimmed)) {
    return { valid: false, error: `Invalid ${patternName} format` };
  }

  return { valid: true, value: trimmed };
};

/**
 * Validate ID parameter (prevent SQL injection)
 */
const validateId = (value, fieldName = 'ID') => {
  if (value === undefined || value === null) {
    return { valid: false, error: `${fieldName} is required` };
  }

  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    return { valid: false, error: `${fieldName} must be a positive integer` };
  }

  // Prevent excessively large IDs
  if (id > Number.MAX_SAFE_INTEGER) {
    return { valid: false, error: `${fieldName} is too large` };
  }

  return { valid: true, value: id };
};

/**
 * Validate username
 */
const validateUsername = (username) => {
  return validateString(username, {
    required: true,
    minLength: 3,
    maxLength: 30,
    pattern: /^[a-zA-Z0-9_-]+$/,
    patternName: 'username'
  });
};

/**
 * Validate password strength
 */
const validatePassword = (password) => {
  const validation = validateString(password, {
    required: true,
    minLength: 6,
    maxLength: 128
  });

  return validation;
};

/**
 * Validate email
 */
const validateEmailField = (email) => {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is required' };
  }

  const sanitized = sanitizeEmail(email);

  if (!sanitized) {
    return { valid: false, error: 'Invalid email format' };
  }

  return { valid: true, value: sanitized };
};

/**
 * Validate geographic coordinates
 */
const validateCoordinates = (lat, lng) => {
  const latitude = sanitizeNumber(lat, { min: -90, max: 90 });
  const longitude = sanitizeNumber(lng, { min: -180, max: 180 });

  if (latitude === null || longitude === null) {
    return {
      valid: false,
      error: 'Invalid coordinates. Latitude: -90 to 90, Longitude: -180 to 180'
    };
  }

  return { valid: true, value: { lat: latitude, lng: longitude } };
};

/**
 * Validate date
 */
const validateDate = (date, options = {}) => {
  const {
    required = false,
    minDate = null,
    maxDate = null
  } = options;

  if (!date) {
    if (required) {
      return { valid: false, error: 'Date is required' };
    }
    return { valid: true, value: undefined };
  }

  const parsed = new Date(date);

  if (isNaN(parsed.getTime())) {
    return { valid: false, error: 'Invalid date format' };
  }

  if (minDate && parsed < new Date(minDate)) {
    return { valid: false, error: `Date must be after ${minDate}` };
  }

  if (maxDate && parsed > new Date(maxDate)) {
    return { valid: false, error: `Date must be before ${maxDate}` };
  }

  return { valid: true, value: parsed };
};

/**
 * Validate phone number
 */
const validatePhone = (phone) => {
  if (!phone || typeof phone !== 'string') {
    return { valid: false, error: 'Phone number is required' };
  }

  // Remove spaces, dashes, parentheses
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');

  // Validate format (E.164 international format preferred)
  if (!/^\+?[0-9]{7,15}$/.test(cleaned)) {
    return { valid: false, error: 'Invalid phone number format' };
  }

  return { valid: true, value: cleaned };
};

// ============================================
// Validation Middleware Generators
// ============================================

/**
 * Create validation middleware for request body
 */
const validateBody = (schema) => {
  return (req, res, next) => {
    const errors = {};
    const sanitized = {};

    for (const [field, rules] of Object.entries(schema)) {
      const value = req.body[field];
      let result;

      // Apply appropriate validator
      if (rules.type === 'string') {
        result = validateString(value, rules);
      } else if (rules.type === 'email') {
        result = validateEmailField(value);
      } else if (rules.type === 'password') {
        result = validatePassword(value);
      } else if (rules.type === 'username') {
        result = validateUsername(value);
      } else if (rules.type === 'phone') {
        result = validatePhone(value);
      } else if (rules.type === 'id') {
        result = validateId(value, field);
      } else if (rules.type === 'number') {
        result = {
          valid: value !== undefined,
          value: sanitizeNumber(value, {
            min: rules.min,
            max: rules.max,
            integer: rules.integer,
            required: rules.required
          })
        };
        if (result.value === null && rules.required) {
          result.valid = false;
          result.error = `${field} must be a valid number`;
        }
      } else if (rules.type === 'date') {
        result = validateDate(value, rules);
      } else if (rules.type === 'coordinates') {
        result = validateCoordinates(req.body.lat, req.body.lng);
      } else if (rules.type === 'url') {
        const sanitized_url = sanitizeUrl(value);
        result = {
          valid: value === undefined || sanitized_url !== null,
          value: sanitized_url
        };
        if (!result.valid && rules.required) {
          result.error = 'Invalid URL format';
        }
      } else if (rules.type === 'html') {
        if (value === undefined || value === null) {
          result = { valid: !rules.required, value: undefined };
        } else {
          result = {
            valid: true,
            value: sanitizeHtml(value, rules.maxLength || 5000)
          };
        }
      } else {
        // Generic validation
        result = { valid: true, value };
      }

      if (!result.valid) {
        errors[field] = result.error;
      } else if (result.value !== undefined) {
        sanitized[field] = result.value;
      }
    }

    // If validation failed, return errors
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors
      });
    }

    // Replace request body with sanitized values
    req.body = { ...req.body, ...sanitized };
    req.validated = sanitized;

    next();
  };
};

/**
 * Create validation middleware for request params
 */
const validateParams = (schema) => {
  return (req, res, next) => {
    const errors = {};
    const sanitized = {};

    for (const [field, rules] of Object.entries(schema)) {
      const value = req.params[field];
      let result;

      if (rules.type === 'id') {
        result = validateId(value, field);
      } else if (rules.type === 'string') {
        result = validateString(value, rules);
      } else {
        result = { valid: true, value };
      }

      if (!result.valid) {
        errors[field] = result.error;
      } else if (result.value !== undefined) {
        sanitized[field] = result.value;
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        error: 'Invalid URL parameters',
        details: errors
      });
    }

    req.params = { ...req.params, ...sanitized };
    req.validatedParams = sanitized;

    next();
  };
};

/**
 * Create validation middleware for query parameters
 */
const validateQuery = (schema) => {
  return (req, res, next) => {
    const errors = {};
    const sanitized = {};

    for (const [field, rules] of Object.entries(schema)) {
      const value = req.query[field];
      let result;

      if (rules.type === 'number') {
        result = {
          valid: true,
          value: sanitizeNumber(value, {
            min: rules.min,
            max: rules.max,
            integer: rules.integer
          })
        };
      } else if (rules.type === 'string') {
        result = validateString(value, rules);
      } else if (rules.type === 'date') {
        result = validateDate(value, rules);
      } else if (rules.type === 'enum') {
        if (value === undefined) {
          result = { valid: true, value: rules.default };
        } else if (rules.values.includes(value)) {
          result = { valid: true, value };
        } else {
          result = {
            valid: false,
            error: `${field} must be one of: ${rules.values.join(', ')}`
          };
        }
      } else {
        result = { valid: true, value };
      }

      if (!result.valid) {
        errors[field] = result.error;
      } else if (result.value !== undefined) {
        sanitized[field] = result.value;
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: errors
      });
    }

    req.query = { ...req.query, ...sanitized };
    req.validatedQuery = sanitized;

    next();
  };
};

module.exports = {
  // Sanitization functions
  sanitizeString,
  sanitizeHtml,
  sanitizeFilename,
  sanitizeNumber,
  sanitizeEmail,
  sanitizeUrl,
  
  // Validation functions
  validateString,
  validateId,
  validateUsername,
  validatePassword,
  validateEmailField,
  validateCoordinates,
  validateDate,
  validatePhone,
  
  // Middleware generators
  validateBody,
  validateParams,
  validateQuery
};
