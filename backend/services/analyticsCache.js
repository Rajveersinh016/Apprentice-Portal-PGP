// Analytics computation cache — TTL 300 seconds (5 minutes)
const analyticsCache = {
  caches: {},
  TTL: 300 * 1000,
  
  get(key) {
    const entry = this.caches[key];
    if (entry && (Date.now() - entry.ts) < this.TTL) {
      return entry.data;
    }
    return null;
  },

  set(key, data) {
    this.caches[key] = {
      data,
      ts: Date.now()
    };
  },

  invalidate() {
    this.caches = {};
    // console.log('analyticsCache: Cache invalidated.');
  }
};

module.exports = analyticsCache;
