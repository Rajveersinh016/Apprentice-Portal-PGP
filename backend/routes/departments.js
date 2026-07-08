const express = require('express');
const router = express.Router();
const sheetsService = require('../services/sheetsService');
const authMiddleware = require('../middleware/auth');
const { requestStorage } = require('../utils/logger');

/**
 * GET /api/departments
 * Returns a sorted array of unique department values derived from
 * the live apprentice data (active + completed sheets).
 * Uses the server-side sheetsService cache — zero extra API calls
 * when cache is warm.
 *
 * Response: { success: true, departments: ["Engineering", "HR", "Logistics", ...] }
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const activeRaw = await sheetsService.getActiveApprentices();
    const completedRaw = await sheetsService.getCompletedApprentices();

    const deptSet = new Set();

    activeRaw.forEach(row => {
      const dept = String(row['Department'] || '').trim();
      if (dept) deptSet.add(dept);
    });

    completedRaw.forEach(row => {
      const dept = String(row['Department'] || '').trim();
      if (dept) deptSet.add(dept);
    });

    // Sort alphabetically for consistent ordering
    const departments = Array.from(deptSet).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );

    const store = requestStorage.getStore();
    if (store) {
      store.recordCount = departments.length;
    }

    return res.json({ success: true, departments });
  } catch (err) {
    console.error('Departments Fetch Error:', err);
    const sanitizedError = err.message.replace(/([a-zA-Z]:\\[\w\\.-]+)/g, '[Internal Path]');
    return res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred while fetching departments.'
        : 'Failed to fetch departments: ' + sanitizedError
    });
  }
});

module.exports = router;
