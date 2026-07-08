const express = require('express');
const router = express.Router();
const sheetsService = require('../services/sheetsService');
const authMiddleware = require('../middleware/auth');
const { requestStorage } = require('../utils/logger');

/**
 * GET /api/locations
 * Returns a sorted array of unique location values derived from
 * the live apprentice data (active + completed sheets).
 * Uses the server-side sheetsService cache — zero extra API calls
 * when cache is warm.
 *
 * Response: { success: true, locations: ["Halol", "Jambusar", "Kosamba", "Vadodara"] }
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const activeRaw = await sheetsService.getActiveApprentices();
    const completedRaw = await sheetsService.getCompletedApprentices();

    const locationSet = new Set();

    activeRaw.forEach(row => {
      const loc = String(row['Location'] || '').trim();
      if (loc) locationSet.add(loc);
    });

    completedRaw.forEach(row => {
      const loc = String(row['Location'] || '').trim();
      if (loc) locationSet.add(loc);
    });

    // Sort alphabetically for consistent ordering
    const locations = Array.from(locationSet).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );

    const store = requestStorage.getStore();
    if (store) {
      store.recordCount = locations.length;
    }

    return res.json({ success: true, locations });
  } catch (err) {
    console.error('Locations Fetch Error:', err);
    const sanitizedError = err.message.replace(/([a-zA-Z]:\\[\w\\.-]+)/g, '[Internal Path]');
    return res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred while fetching locations.'
        : 'Failed to fetch locations: ' + sanitizedError
    });
  }
});

module.exports = router;
