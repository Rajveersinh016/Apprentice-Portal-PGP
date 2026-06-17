const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ success: false, error: 'Authorization header is missing' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, error: 'Token is missing' });
  }

  const jwtSecret = process.env.JWT_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';
  const isDefaultSecret = !jwtSecret || jwtSecret === 'pgp_glass_apprentice_portal_secret_key_2026';

  if (isProduction && isDefaultSecret) {
    return res.status(500).json({ success: false, error: 'Security configuration error: A custom, secure JWT_SECRET environment variable is required in production.' });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret || 'pgp_glass_apprentice_portal_secret_key_2026');
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ success: false, error: 'Invalid or expired token' });
  }
}

module.exports = authMiddleware;

