const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sheetsService = require('../services/sheetsService');
const { loginFailTracker } = require('../middleware/rateLimiter');

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (loginFailTracker.isBlocked(ip)) {
    const remaining = loginFailTracker.getRemainingTime(ip);
    return res.status(429).json({
      success: false,
      error: `Too many failed login attempts. Please try again in ${remaining} seconds.`
    });
  }

  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password are required.' });
  }

  try {
    const users = await sheetsService.getAllUsers();
    // Normalize email for lookup
    const user = users.find(u => String(u.Email).toLowerCase().trim() === String(email).toLowerCase().trim());

    if (!user) {
      loginFailTracker.recordFail(ip);
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    if (user.Status !== 'Active') {
      return res.status(403).json({ success: false, error: 'User account is inactive. Please contact system admin.' });
    }

    const passwordMatch = await bcrypt.compare(password, user.PasswordHash);
    if (!passwordMatch) {
      loginFailTracker.recordFail(ip);
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    // Success: reset rate limit tracking for this IP
    loginFailTracker.reset(ip);

    const payload = {
      id: user.UserID,
      name: user.Name,
      email: user.Email,
      role: user.Role,
      location: user.Location
    };

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret && process.env.NODE_ENV === 'production') {
      return res.status(500).json({ success: false, error: 'Security configuration error: JWT_SECRET environment variable is missing.' });
    }

    const token = jwt.sign(
      payload,
      jwtSecret || 'pgp_glass_apprentice_portal_secret_key_2026',
      { expiresIn: '8h' }
    );

    return res.json({
      success: true,
      token: token,
      user: {
        name: user.Name,
        email: user.Email,
        role: user.Role,
        location: user.Location
      }
    });

  } catch (err) {
    console.error('Auth Route Error:', err);
    return res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred. Please try again later.'
        : 'Server error: ' + err.message
    });
  }
});

module.exports = router;

