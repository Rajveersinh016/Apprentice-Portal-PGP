const loginFailStore = new Map(); // ip -> { count, resetTime }
const uploadStore = new Map();    // ip -> { count, resetTime }
const exportStore = new Map();    // ip -> { count, resetTime }

// 1. Failed Login Tracker (IP-based, 5 failed attempts per minute)
const loginFailTracker = {
  isBlocked(ip) {
    const record = loginFailStore.get(ip);
    if (record && Date.now() < record.resetTime && record.count >= 5) {
      return true;
    }
    return false;
  },
  getRemainingTime(ip) {
    const record = loginFailStore.get(ip);
    if (record) {
      return Math.ceil((record.resetTime - Date.now()) / 1000);
    }
    return 0;
  },
  recordFail(ip) {
    const now = Date.now();
    const limitWindow = 60 * 1000; // 1 minute
    let record = loginFailStore.get(ip);
    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + limitWindow };
    } else {
      record.count++;
    }
    loginFailStore.set(ip, record);
  },
  reset(ip) {
    loginFailStore.delete(ip);
  }
};

// 2. Upload Rate Limiter (Bypassed to allow unlimited uploads)
const uploadRateLimiter = (req, res, next) => {
  next();
};

// 3. Export Rate Limiter (Max 50 exports per hour per IP)
const exportRateLimiter = (req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const now = Date.now();
  const limitWindow = 60 * 60 * 1000; // 1 hour
  const limitCount = 50;

  let record = exportStore.get(ip);
  if (!record || now > record.resetTime) {
    record = { count: 1, resetTime: now + limitWindow };
    exportStore.set(ip, record);
    return next();
  }

  if (record.count >= limitCount) {
    return res.status(429).json({
      success: false,
      error: 'Too many report exports. Maximum of 50 exports per hour per user.'
    });
  }

  record.count++;
  next();
};

module.exports = {
  loginFailTracker,
  uploadRateLimiter,
  exportRateLimiter
};
