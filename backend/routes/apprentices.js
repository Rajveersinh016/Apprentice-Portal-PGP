const express = require('express');
const router = express.Router();
const sheetsService = require('../services/sheetsService');
const authMiddleware = require('../middleware/auth');

const analyticsCache = require('../services/analyticsCache');

// Mapping helper (exact copy of front-end mapper for server-side normalization)
function mapSheetToInternal(row, isCompleted) {
  const mapped = {
    code: row["Employee Code"] || "",
    name: row["Full Name"] || "",
    location: row["Location"] || "",
    dept: row["Department"] || "",
    joined: row["Joining Date"] ? String(row["Joining Date"]).split("T")[0] : "",
    sex: row["Sex"] || "Male",
    age: row["Age"] ? parseInt(row["Age"]) : 22,
    phone: row["Phone"] || "",
    email: row["Email"] || "",
    address: row["Address"] || "",
    remarks: row["Remarks"] || "",
    contractId: row["Employee Contract ID"] || "Pending",
    portalEnrollmentNumber: row["Portal Enrollment Number"] || "Pending",
    portalName: row["Portal Name"] || "Pending",
    status: isCompleted ? "Completed" : (row["Record Status"] || "Active"),
    completionDate: isCompleted ? (row["Completion Date"] ? String(row["Completion Date"]).split("T")[0] : "") : "",
    completedBy: isCompleted ? (row["Completed By"] || "") : "",
    completionReason: isCompleted ? (row["Completion Reason"] || "") : "",
    otherCompletionReason: isCompleted ? (row["Other Completion Reason"] || "") : "",
    completionRemarks: isCompleted ? (row["Completion Remarks"] || "") : "",
    updatedBy: row["Updated By"] || "",
    updatedDate: row["Updated Date"] || ""
  };

  // Dynamically attach any other fields from the spreadsheet row
  Object.keys(row).forEach(key => {
    if (key.startsWith('__')) return; // skip row number metadata
    if (!mapped.hasOwnProperty(key)) {
      mapped[key] = row[key];
    }
  });

  return mapped;
}

// 1. GET all apprentices (active or completed, branch-restricted if Branch HR)
router.get('/', authMiddleware, async (req, res) => {
  const { type, location } = req.query; // type: active | completed | all
  const user = req.user;

  try {
    let active = [];
    let completed = [];

    if (type === 'active' || type === 'all' || !type) {
      const activeRaw = await sheetsService.getActiveApprentices();
      active = activeRaw.map(r => mapSheetToInternal(r, false));
    }

    if (type === 'completed' || type === 'all') {
      const completedRaw = await sheetsService.getCompletedApprentices();
      completed = completedRaw.map(r => mapSheetToInternal(r, true));
    }

    let combined = [...active, ...completed];

    // Branch HR Filtering
    if (user.role === 'Branch HR') {
      const branchLoc = user.location;
      combined = combined.filter(app => String(app.location).toLowerCase().trim() === String(branchLoc).toLowerCase().trim());
    } else if (user.role === 'Super HR' && location && location !== 'All Locations') {
      // Super HR filtering by location param
      combined = combined.filter(app => String(app.location).toLowerCase().trim() === String(location).toLowerCase().trim());
    }

    return res.json({ success: true, apprentices: combined });
  } catch (err) {
    console.error('Get Apprentices Error:', err);
    const sanitizedError = err.message.replace(/([a-zA-Z]:\\[\w\\\.-]+)/g, '[Internal Path]');
    return res.status(500).json({ 
      success: false, 
      error: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred while fetching apprentices.'
        : 'Failed to fetch apprentices: ' + sanitizedError 
    });
  }
});

// 2. GET analytics summary counts (respects branch restrictions)
router.get('/analytics', authMiddleware, async (req, res) => {
  const user = req.user;
  const { location } = req.query;

  const cacheKey = `${user.role}_${user.location || 'All'}_${location || 'All'}`;
  const cachedData = analyticsCache.get(cacheKey);
  if (cachedData) {
    return res.json({ success: true, analytics: cachedData, cached: true });
  }

  try {
    const activeRaw = await sheetsService.getActiveApprentices();
    const completedRaw = await sheetsService.getCompletedApprentices();

    let activeMapped = activeRaw.map(r => mapSheetToInternal(r, false));
    let completedMapped = completedRaw.map(r => mapSheetToInternal(r, true));

    // Filter by branch/location
    if (user.role === 'Branch HR') {
      const branchLoc = user.location;
      activeMapped = activeMapped.filter(app => String(app.location).toLowerCase().trim() === String(branchLoc).toLowerCase().trim());
      completedMapped = completedMapped.filter(app => String(app.location).toLowerCase().trim() === String(branchLoc).toLowerCase().trim());
    } else if (user.role === 'Super HR' && location && location !== 'All Locations') {
      activeMapped = activeMapped.filter(app => String(app.location).toLowerCase().trim() === String(location).toLowerCase().trim());
      completedMapped = completedMapped.filter(app => String(app.location).toLowerCase().trim() === String(location).toLowerCase().trim());
    }

    const totalActive = activeMapped.length;
    const totalCompleted = completedMapped.length;
    const total = totalActive + totalCompleted;

    const contractIdMissing = activeMapped.filter(app => !app.contractId || app.contractId === 'Pending' || app.contractId === '').length;
    const portalEnrollmentMissing = activeMapped.filter(app => !app.portalEnrollmentNumber || app.portalEnrollmentNumber === 'Pending' || app.portalEnrollmentNumber === '').length;
    const portalNameMissing = activeMapped.filter(app => !app.portalName || app.portalName === 'Pending' || app.portalName === '').length;

    const analyticsResult = {
      total,
      active: totalActive,
      completed: totalCompleted,
      contractIdMissing,
      portalEnrollmentMissing,
      portalNameMissing
    };

    // Cache the computed result
    analyticsCache.set(cacheKey, analyticsResult);

    return res.json({ success: true, analytics: analyticsResult });
  } catch (err) {
    console.error('Analytics Fetch Error:', err);
    const sanitizedError = err.message.replace(/([a-zA-Z]:\\[\w\\\.-]+)/g, '[Internal Path]');
    return res.status(500).json({ 
      success: false, 
      error: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred while fetching analytics.'
        : 'Failed to fetch analytics: ' + sanitizedError 
    });
  }
});

// 3a. GET single apprentice by employee code (profile page optimization)
// Returns only the requested employee — server uses data cache, profile page
// never needs to load the full dataset.
router.get('/:code', authMiddleware, async (req, res) => {
  const { code } = req.params;
  const user = req.user;

  try {
    // Both calls use server cache if warm — no extra Sheets API calls
    const activeRaw = await sheetsService.getActiveApprentices();
    const completedRaw = await sheetsService.getCompletedApprentices();

    const activeRecord = activeRaw.find(r => String(r["Employee Code"]).trim() === String(code).trim());
    const completedRecord = completedRaw.find(r => String(r["Employee Code"]).trim() === String(code).trim());
    const rawRecord = activeRecord || completedRecord;
    const isCompleted = !!completedRecord;

    if (!rawRecord) {
      return res.status(404).json({ success: false, error: `Apprentice with code '${code}' not found.` });
    }

    // Branch HR: can only view records in their own location
    if (user.role === 'Branch HR') {
      const appBranch = String(rawRecord["Location"] || '').trim().toLowerCase();
      const userBranch = String(user.location || '').trim().toLowerCase();
      if (appBranch !== userBranch) {
        return res.status(403).json({ success: false, error: 'Permission denied. Branch HR can only view profiles from their own branch.' });
      }
    }

    return res.json({ success: true, apprentice: mapSheetToInternal(rawRecord, isCompleted) });
  } catch (err) {
    console.error('Get Single Apprentice Error:', err);
    const sanitizedError = err.message.replace(/([a-zA-Z]:\\[\w\\\.-]+)/g, '[Internal Path]');
    return res.status(500).json({ 
      success: false, 
      error: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred while fetching the apprentice profile.'
        : 'Failed to fetch apprentice: ' + sanitizedError 
    });
  }
});

// 3. PUT update apprentice profile fields (Super HR and Branch HR)
router.put('/:code', authMiddleware, async (req, res) => {
  const { code } = req.params;
  const fields = req.body;
  const user = req.user;

  try {
    // 1. Fetch current apprentice state to check location and completion status
    const activeRaw = await sheetsService.getActiveApprentices();
    let apprentice = activeRaw.find(r => String(r["Employee Code"]).trim() === String(code).trim());

    if (!apprentice) {
      const completedRaw = await sheetsService.getCompletedApprentices();
      const completedApprentice = completedRaw.find(r => String(r["Employee Code"]).trim() === String(code).trim());
      if (completedApprentice) {
        return res.status(400).json({ success: false, error: 'Cannot edit profile. Completed apprentices are read-only.' });
      }
      return res.status(404).json({ success: false, error: 'This record was modified or removed by another user. Please refresh and try again.' });
    }

    // 2. Enforce Location Security for Branch HR
    if (user.role === 'Branch HR') {
      const appBranch = String(apprentice["Location"]).trim().toLowerCase();
      const userBranch = String(user.location).trim().toLowerCase();
      if (appBranch !== userBranch) {
        return res.status(403).json({ success: false, error: 'Permission denied. Branch HR can only edit profiles belonging to their own branch location.' });
      }
    } else if (user.role !== 'Super HR') {
      return res.status(403).json({ success: false, error: 'Permission denied. Unauthorized role.' });
    }

    // 3. Normalize fields to fit standard/dynamic columns in sheets
    const mappedFields = {};
    const stdFieldMap = {
      phone: "Phone",
      email: "Email",
      address: "Address",
      remarks: "Remarks",
      contractId: "Employee Contract ID",
      portalEnrollmentNumber: "Portal Enrollment Number",
      portalName: "Portal Name"
    };

    // Standard fields mapping
    Object.keys(fields).forEach(key => {
      if (stdFieldMap[key] !== undefined) {
        mappedFields[stdFieldMap[key]] = fields[key];
      } else {
        // Dynamic fields: retain raw column names, skip system metadata keys
        const excludedKeys = [
          "Employee Code", "Full Name", "Location", "Department", "Joining Date", 
          "Sex", "Age", "Phone", "Email", "Address", "Remarks", 
          "Employee Contract ID", "Portal Enrollment Number", "Portal Name", 
          "Record Status", "Updated By", "Updated Date", 
          "Completion Date", "Completed By", "code", "name", "location", 
          "dept", "joined", "sex", "age", "status", "completionDate", 
          "completedBy", "updatedBy", "updatedDate", "__rowNum"
        ];
        if (!excludedKeys.includes(key)) {
          mappedFields[key] = fields[key];
        }
      }
    });

    const updatedBy = `${user.role === 'Super HR' ? 'Super HR Admin' : user.location + ' HR'} (${user.name})`;
    await sheetsService.updateApprentice(code, mappedFields, updatedBy);
    analyticsCache.invalidate(); // profile update may change KPI metrics

    return res.json({ success: true, message: 'Apprentice profile updated successfully.' });
  } catch (err) {
    console.error('Update Apprentice Error:', err);
    const sanitizedError = err.message.replace(/([a-zA-Z]:\\[\w\\\.-]+)/g, '[Internal Path]');
    return res.status(500).json({ 
      success: false, 
      error: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred while updating the apprentice profile.'
        : 'Failed to update apprentice: ' + sanitizedError 
    });
  }
});

// 3b. GET apprentice audit history logs
router.get('/:code/audit', authMiddleware, async (req, res) => {
  const { code } = req.params;
  try {
    const auditLogs = await sheetsService.getProfileAuditLogs(code);
    return res.json({ success: true, logs: auditLogs });
  } catch (err) {
    console.error('Fetch Profile Audit Logs Error:', err);
    const sanitizedError = err.message.replace(/([a-zA-Z]:\\[\w\\\.-]+)/g, '[Internal Path]');
    return res.status(500).json({ 
      success: false, 
      error: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred while fetching profile history.'
        : 'Failed to fetch profile history: ' + sanitizedError 
    });
  }
});

// 4. POST mark completion (Active -> Completed)
router.post('/:code/complete', authMiddleware, async (req, res) => {
  const { code } = req.params;
  const { reason, otherReason, remarks } = req.body;
  const user = req.user;

  // Enforce role-based access: ONLY Branch HR can sign off on completions
  if (user.role !== 'Branch HR') {
    return res.status(403).json({ success: false, error: 'Permission denied. Only Branch HR accounts can sign off on apprentice completions.' });
  }

  if (!reason || !remarks || String(remarks).trim() === '') {
    return res.status(400).json({ success: false, error: 'Completion reason and remarks are required.' });
  }

  // Validate remarks quality (trimmed, min 10 chars, check weak words)
  const trimmedRemarks = String(remarks).trim();
  const weakRemarks = ['ok', 'done', 'completed', 'yes', 'test', 'na', 'n/a'];
  if (trimmedRemarks.length < 10 || weakRemarks.includes(trimmedRemarks.toLowerCase())) {
    return res.status(400).json({ success: false, error: 'Please provide meaningful completion remarks (minimum 10 characters).' });
  }

  // Validate otherReason if reason is Other
  if (reason === 'Other' && (!otherReason || String(otherReason).trim() === '')) {
    return res.status(400).json({ success: false, error: 'Other completion reason is required.' });
  }

  try {
    const completedBy = `${user.location} HR Lead (${user.name})`;
    
    const activeRaw = await sheetsService.getActiveApprentices();
    const apprentice = activeRaw.find(r => String(r["Employee Code"]).trim() === String(code).trim());
    
    if (!apprentice) {
      // Check if already completed
      const completedRaw = await sheetsService.getCompletedApprentices();
      const isCompleted = completedRaw.some(r => String(r["Employee Code"]).trim() === String(code).trim());
      if (isCompleted) {
        return res.status(400).json({ success: false, error: 'Apprentice is already marked as completed.' });
      }
      return res.status(404).json({ success: false, error: 'Active apprentice not found.' });
    }

    // For Branch HR, verify they own this apprentice's location
    if (user.role === 'Branch HR') {
      if (String(apprentice["Location"]).toLowerCase().trim() !== String(user.location).toLowerCase().trim()) {
        return res.status(403).json({ success: false, error: 'Permission denied. Branch HR can only mark completion for apprentices in their own branch.' });
      }
    }

    await sheetsService.completeApprentice(code, completedBy, reason, otherReason, remarks);
    analyticsCache.invalidate(); // completion changes KPI metrics
    return res.json({ success: true, message: 'Apprenticeship marked as completed successfully.' });
  } catch (err) {
    console.error('Complete Apprenticeship Error:', err);
    const sanitizedError = err.message.replace(/([a-zA-Z]:\\[\w\\\.-]+)/g, '[Internal Path]');
    return res.status(500).json({ 
      success: false, 
      error: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred while marking the apprenticeship as completed.'
        : 'Failed to complete apprenticeship: ' + sanitizedError 
    });
  }
});

module.exports = router;
