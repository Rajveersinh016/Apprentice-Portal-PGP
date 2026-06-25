const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const authRoutes = require('./routes/auth');
const apprenticeRoutes = require('./routes/apprentices');
const uploadRoutes = require('./routes/upload');
const usersRoutes = require('./routes/users');
const locationsRoutes = require('./routes/locations');
const departmentsRoutes = require('./routes/departments');
const sheetsService = require('./services/sheetsService');
const { uploadRateLimiter, exportRateLimiter } = require('./middleware/rateLimiter');

// Load .env first, then .env.local as fallback (supports both local dev and Vercel deployments)
const envPath = path.resolve(__dirname, '../.env');
const envLocalPath = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
} else {
  dotenv.config(); // default fallback
}

// ============================================================
// PRIORITY 8 — PRODUCTION ENVIRONMENT VALIDATION
// ============================================================
if (process.env.NODE_ENV === 'production') {
  const requiredEnv = ['JWT_SECRET', 'SPREADSHEET_ID'];
  const missing = requiredEnv.filter(name => !process.env[name]);

  const keyPath = path.resolve(__dirname, process.env.GOOGLE_APPLICATION_CREDENTIALS || './config/service-account.json');
  const hasCreds = process.env.GOOGLE_CREDS_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS || fs.existsSync(keyPath);

  if (missing.length > 0 || !hasCreds) {
    console.error('\n===================================================');
    console.error('CRITICAL STARTUP FAILURE: Missing Production Environment Configuration');
    if (missing.length > 0) {
      console.error(`Missing required variables: ${missing.join(', ')}`);
    }
    if (!hasCreds) {
      console.error('Missing Google Service Account credentials. Please set GOOGLE_CREDS_JSON or GOOGLE_APPLICATION_CREDENTIALS.');
    }
    console.error('===================================================\n');
    process.exit(1);
  }
}

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================================
// PRIORITY 1 — SECURITY HEADERS MIDDLEWARE
// ============================================================
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; img-src 'self' data:; connect-src 'self' *; frame-ancestors 'none';");
  next();
});

// CORS setup — allow localhost, 127.0.0.1, and any local network IP on port 8080/3001
const isLocalOrigin = (origin) => {
  if (!origin) return true; // server-to-server / curl
  try {
    const url = new URL(origin);
    const host = url.hostname;
    // Allow any private/loopback IP or hostname on common dev ports
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') return true;
    // Allow Vercel deployments
    if (host.endsWith('.vercel.app')) return true;
    if (/^10\./.test(host)) return true;        // 10.x.x.x
    if (/^192\.168\./.test(host)) return true; // 192.168.x.x
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true; // 172.16-31.x.x
    // Also allow explicitly configured origins
    if (process.env.ALLOWED_ORIGINS) {
      const configured = process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
      if (configured.includes(origin) || configured.includes('*')) return true;
    }
  } catch (e) { /* invalid URL */ }
  return false;
};

app.use(cors({
  origin: function (origin, callback) {
    if (isLocalOrigin(origin)) return callback(null, true);
    return callback(new Error('CORS policy block: origin not allowed.'), false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Disposition', 'Content-Length']
}));

app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));

// ============================================================
// PRIORITY 3 — HEALTH CHECK ENDPOINT
// ============================================================
app.get('/api/health', async (req, res) => {
  try {
    await sheetsService.ensureSheetsExist();
    return res.json({
      status: "ok",
      database: "connected",
      cache: "active",
      version: "1.0.0"
    });
  } catch (err) {
    console.error("Health check error:", err.message);
    return res.status(500).json({
      status: "error",
      database: "disconnected",
      cache: "inactive",
      version: "1.0.0"
    });
  }
});

// Register api routers
app.use('/api/auth', authRoutes);
app.use('/api/apprentices', apprenticeRoutes);
app.use('/api/upload', uploadRateLimiter, uploadRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/locations', locationsRoutes);
app.use('/api/departments', departmentsRoutes);
app.use('/api/reports', exportRateLimiter, require('./routes/reports'));

// ============================================================
// SERVE FRONTEND STATIC FILES
// ============================================================
const frontendPath = path.resolve(__dirname, '..');
app.use(express.static(frontendPath));
// Fallback: serve index.html for unknown routes (SPA-like)
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Global Error Handler
app.use((err, req, res, next) => {
  // Handle CORS policy blocks gracefully — don't log full stack, just return 403
  if (err.message && err.message.includes('CORS policy block')) {
    return res.status(403).json({ success: false, error: 'CORS: Request origin not allowed.' });
  }
  console.error('Unhandled Server Error:', err);
  return res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production'
      ? 'An unexpected server error occurred. Please contact the administrator if the issue persists.'
      : 'Internal Server Error: ' + err.message
  });
});

app.listen(PORT, async () => {
  // Try to connect to Google Sheets on start to verify setup and warm cache
  try {
    await sheetsService.ensureSheetsExist();
    console.log('[STARTUP] Preloading Google Sheets data caches...');
    const startTime = Date.now();
    await Promise.all([
      sheetsService.getActiveApprentices(),
      sheetsService.getCompletedApprentices(),
      sheetsService.getAllUsers()
    ]);
    console.log(`[STARTUP] Google Sheets caches warmed successfully in ${Date.now() - startTime}ms!`);
  } catch (err) {
    console.error('[CRITICAL] sheetsService failed to connect to Google Sheet:', err.message);
  }
});

module.exports = app;

