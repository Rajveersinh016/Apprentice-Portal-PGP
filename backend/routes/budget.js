/**
 * budget.js -- Budget Management Module V2 Routes
 *
 * GET   /api/budget               -- Dashboard: location & department actuals vs budgets
 * GET   /api/budget/config        -- Master configuration (with filters & search)
 * POST  /api/budget/item          -- Create new budget entry (Super HR)
 * PUT   /api/budget/item/:id      -- Update budget entry (Super HR)
 * PATCH /api/budget/item/:id/status-- Toggle budget status ACTIVE/INACTIVE (Super HR)
 * POST  /api/budget/duplicate     -- Duplicate budget to target location (Super HR)
 * POST  /api/budget/department    -- Create master department (Super HR)
 * GET   /api/budget/departments   -- Get master departments list
 * POST  /api/budget/import        -- Bulk import budgets (Super HR)
 * GET   /api/budget/history       -- Audit log (newest first)
 *
 * All routes require valid JWT (authMiddleware).
 * Mutating endpoints additionally require role === 'Super HR'.
 */

'use strict';

const express        = require('express');
const router         = express.Router();
const authMiddleware = require('../middleware/auth');
const budgetService  = require('../services/budgetService');
const { requestStorage } = require('../utils/logger');

function setRecordCount(n) {
  const store = requestStorage.getStore();
  if (store) store.recordCount = n;
}

function checkSuperHR(req, res) {
  if (!req.user || req.user.role !== 'Super HR') {
    res.status(403).json({
      success: false,
      error: 'Permission denied. Only Super HR can perform this operation.'
    });
    return false;
  }
  return true;
}

// ── GET /api/budget (Dashboard) ──────────────────────────────────────────────
router.get('/', authMiddleware, async function(req, res) {
  try {
    const filters = {
      location:   req.query.location,
      plant:      req.query.plant,
      department: req.query.department,
      section:    req.query.section,
      search:     req.query.search
    };
    const data = await budgetService.getBudgetDashboard(filters);
    setRecordCount(data.sections ? data.sections.length : 0);
    return res.json({ success: true, ...data });
  } catch (err) {
    console.error('Budget Dashboard Error:', err);
    return res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred while loading the budget dashboard.'
        : 'Budget Dashboard Error: ' + err.message
    });
  }
});

// ── GET /api/budget/config (Master Budget Configuration) ────────────────────
router.get('/config', authMiddleware, async function(req, res) {
  try {
    const options = {
      showInactive: req.query.showInactive,
      location:     req.query.location,
      plant:        req.query.plant,
      department:   req.query.department,
      section:      req.query.section,
      status:       req.query.status,
      search:       req.query.search
    };
    const config = await budgetService.getBudgetConfiguration(options);
    setRecordCount(config.length);
    return res.json({ success: true, config });
  } catch (err) {
    console.error('Budget Config Fetch Error:', err);
    return res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred while loading budget configuration.'
        : 'Budget Config Error: ' + err.message
    });
  }
});

// ── POST /api/budget/item (Create Budget) ────────────────────────────────────
router.post('/item', authMiddleware, async function(req, res) {
  if (!checkSuperHR(req, res)) return;

  try {
    const newBudget = await budgetService.createBudget(req.body, req.user);
    return res.json({
      success: true,
      message: `Budget created for "${newBudget['Location']}" - "${newBudget['Department']}".`,
      budget: newBudget
    });
  } catch (err) {
    console.error('Create Budget Error:', err);
    return res.status(400).json({ success: false, error: err.message });
  }
});

// ── PUT /api/budget/item/:id (Update Budget) ────────────────────────────────
router.put('/item/:id', authMiddleware, async function(req, res) {
  if (!checkSuperHR(req, res)) return;

  try {
    const updated = await budgetService.updateBudget(req.params.id, req.body, req.user);
    return res.json({
      success: true,
      message: `Budget "${req.params.id}" updated successfully.`,
      budget: updated
    });
  } catch (err) {
    console.error('Update Budget Error:', err);
    return res.status(400).json({ success: false, error: err.message });
  }
});

// ── PATCH /api/budget/item/:id/status (Deactivate / Reactivate) ─────────────
router.patch('/item/:id/status', authMiddleware, async function(req, res) {
  if (!checkSuperHR(req, res)) return;

  const { status } = req.body;
  if (!status || (status !== 'ACTIVE' && status !== 'INACTIVE')) {
    return res.status(400).json({ success: false, error: 'Status must be ACTIVE or INACTIVE.' });
  }

  try {
    const updated = await budgetService.toggleBudgetStatus(req.params.id, status, req.user);
    return res.json({
      success: true,
      message: `Budget "${req.params.id}" marked as ${status}.`,
      budget: updated
    });
  } catch (err) {
    console.error('Toggle Budget Status Error:', err);
    return res.status(400).json({ success: false, error: err.message });
  }
});

// ── POST /api/budget/duplicate (Duplicate Budget to Location) ────────────────
router.post('/duplicate', authMiddleware, async function(req, res) {
  if (!checkSuperHR(req, res)) return;

  const { sourceBudgetId, targetLocation } = req.body;
  if (!sourceBudgetId || !targetLocation) {
    return res.status(400).json({ success: false, error: 'sourceBudgetId and targetLocation are required.' });
  }

  try {
    const duplicated = await budgetService.duplicateBudget(sourceBudgetId, targetLocation, req.user);
    return res.json({
      success: true,
      message: `Budget duplicated to "${targetLocation}" successfully.`,
      budget: duplicated
    });
  } catch (err) {
    console.error('Duplicate Budget Error:', err);
    return res.status(400).json({ success: false, error: err.message });
  }
});

// ── POST /api/budget/department (Create Master Department) ─────────────────
router.post('/department', authMiddleware, async function(req, res) {
  if (!checkSuperHR(req, res)) return;

  const { departmentName } = req.body;
  if (!departmentName) {
    return res.status(400).json({ success: false, error: 'departmentName is required.' });
  }

  try {
    const result = await budgetService.createDepartment(departmentName, req.user);
    return res.json({
      success: true,
      message: `Department "${result.department}" added to Master list.`,
      department: result
    });
  } catch (err) {
    console.error('Create Department Error:', err);
    return res.status(400).json({ success: false, error: err.message });
  }
});

// ── GET /api/budget/departments (Get Master Departments) ───────────────────
router.get('/departments', authMiddleware, async function(req, res) {
  try {
    const depts = await budgetService.getDepartmentMaster();
    return res.json({ success: true, departments: depts });
  } catch (err) {
    console.error('Get Department Master Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/budget/import (Bulk Import Excel) ──────────────────────────────
router.post('/import', authMiddleware, async function(req, res) {
  if (!checkSuperHR(req, res)) return;

  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ success: false, error: 'Request body must contain an array of rows.' });
  }

  try {
    const result = await budgetService.importBudgets(rows, req.user);
    return res.json({
      success: true,
      message: `Import complete: ${result.created} created, ${result.updated} updated.`,
      result: result
    });
  } catch (err) {
    console.error('Import Budgets Error:', err);
    return res.status(400).json({ success: false, error: err.message });
  }
});

// ── GET /api/budget/history (Audit Trail) ───────────────────────────────────
router.get('/history', authMiddleware, async function(req, res) {
  try {
    const history = await budgetService.getBudgetHistory();
    setRecordCount(history.length);
    return res.json({ success: true, history });
  } catch (err) {
    console.error('Budget History Error:', err);
    return res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred while loading budget history.'
        : 'Budget History Error: ' + err.message
    });
  }
});

module.exports = router;