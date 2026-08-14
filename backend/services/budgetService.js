/**
 * budgetService.js -- Section-Level Budget Management Module Service
 *
 * Fully supports Location -> Plant -> Department -> Section unique budget model.
 * Seed section records automatically provisioned on startup if empty.
 * Live actual counts calculated from Active Apprentices database.
 * Dynamic formulas: Available = Budget - Actual, Utilization % = (Actual/Budget)*100.
 * Category Over-Budget warnings ("⚠ Staff over budget by X").
 */

'use strict';

const sheetsService = require('./sheetsService');

const APPRENTICE_TYPE_FIELD = 'Apprentice Type';

const SEED_SECTION_BUDGETS = [
  { section: 'Chemical Lab', plant: '145 TPD', dept: 'Quality Control', staffBudget: 1, workmenBudget: 0, staffActual: 1, workmenActual: 1 },
  { section: 'Civil', plant: '145 TPD', dept: 'Civil & Infra', staffBudget: 2, workmenBudget: 0, staffActual: 1, workmenActual: 0 },
  { section: 'Cold End', plant: '145 TPD', dept: 'Cold End Production', staffBudget: 2, workmenBudget: 5, staffActual: 2, workmenActual: 5 },
  { section: 'CPP', plant: '145 TPD', dept: 'Power & Energy', staffBudget: 1, workmenBudget: 0, staffActual: 0, workmenActual: 0 },
  { section: 'Digital', plant: '145 TPD', dept: 'IT & Digital', staffBudget: 2, workmenBudget: 0, staffActual: 2, workmenActual: 0 },
  { section: 'Electrical', plant: '145 TPD', dept: 'Electrical & Automation', staffBudget: 5, workmenBudget: 4, staffActual: 3, workmenActual: 1 },
  { section: 'Glass C&P', plant: '145 TPD', dept: 'Glass Production', staffBudget: 0, workmenBudget: 0, staffActual: 0, workmenActual: 1 },
  { section: 'Glass F&P', plant: '145 TPD', dept: 'Glass Production', staffBudget: 0, workmenBudget: 0, staffActual: 0, workmenActual: 0 },
  { section: 'HR, Admin & SHE', plant: '145 TPD', dept: 'Human Resources', staffBudget: 2, workmenBudget: 0, staffActual: 1, workmenActual: 0 },
  { section: 'Instrument', plant: '145 TPD', dept: 'Instrumentation', staffBudget: 3, workmenBudget: 4, staffActual: 0, workmenActual: 3 },
  { section: 'ISM C&P', plant: '145 TPD', dept: 'IS Machine Maintenance', staffBudget: 2, workmenBudget: 5, staffActual: 0, workmenActual: 4 },
  { section: 'ISM F&P', plant: '145 TPD', dept: 'IS Machine Maintenance', staffBudget: 2, workmenBudget: 3, staffActual: 0, workmenActual: 0 },
  { section: 'Logistics', plant: '145 TPD', dept: 'Supply Chain & Logistics', staffBudget: 1, workmenBudget: 0, staffActual: 1, workmenActual: 0 },
  { section: 'MMFG', plant: '145 TPD', dept: 'Furnace & Batch', staffBudget: 3, workmenBudget: 3, staffActual: 0, workmenActual: 2 },
  { section: 'MRS C&P', plant: '145 TPD', dept: 'Mold Repair Shop', staffBudget: 3, workmenBudget: 4, staffActual: 1, workmenActual: 4 },
  { section: 'MRS F&P', plant: '145 TPD', dept: 'Mold Repair Shop', staffBudget: 1, workmenBudget: 3, staffActual: 0, workmenActual: 3 },
  { section: 'Plant Maint. C&P', plant: '145 TPD', dept: 'Plant Maintenance', staffBudget: 1, workmenBudget: 5, staffActual: 1, workmenActual: 1 },
  { section: 'Plant Maint. F&P', plant: '145 TPD', dept: 'Plant Maintenance', staffBudget: 1, workmenBudget: 2, staffActual: 1, workmenActual: 0 },
  { section: 'Production F&P', plant: '145 TPD', dept: 'Production', staffBudget: 3, workmenBudget: 6, staffActual: 1, workmenActual: 0 },
  { section: 'Production C&P', plant: '145 TPD', dept: 'Production', staffBudget: 10, workmenBudget: 15, staffActual: 1, workmenActual: 1 },
  { section: 'QA C&P', plant: '145 TPD', dept: 'Quality Assurance', staffBudget: 1, workmenBudget: 2, staffActual: 0, workmenActual: 0 },
  { section: 'QA F&P', plant: '145 TPD', dept: 'Quality Assurance', staffBudget: 1, workmenBudget: 5, staffActual: 0, workmenActual: 0 },
  { section: 'QC C&P', plant: '145 TPD', dept: 'Quality Control', staffBudget: 6, workmenBudget: 20, staffActual: 7, workmenActual: 8 },
  { section: 'QC F&P', plant: '145 TPD', dept: 'Quality Control', staffBudget: 2, workmenBudget: 5, staffActual: 3, workmenActual: 1 },
  { section: 'Stores', plant: '145 TPD', dept: 'Materials & Stores', staffBudget: 1, workmenBudget: 1, staffActual: 0, workmenActual: 0 },
  { section: 'TTC', plant: '145 TPD', dept: 'Technical Training Center', staffBudget: 2, workmenBudget: 0, staffActual: 2, workmenActual: 0 },
  { section: 'Utility', plant: '145 TPD', dept: 'Plant Utility & Services', staffBudget: 3, workmenBudget: 4, staffActual: 2, workmenActual: 3 }
];

function getUserDisplay(user) {
  if (!user) return 'System';
  const loc = user.location || '';
  return (user.role === 'Super HR' ? 'Super HR Admin' : (loc ? loc + ' HR' : 'HR')) + ' (' + (user.name || 'User') + ')';
}

function generateBudgetId() {
  const num = Math.floor(100000 + Math.random() * 900000);
  return 'BDG-' + num;
}

/**
 * Ensure seed budget rows exist in Google Sheets database if sheet is empty.
 */
async function ensureSeedBudgetsExist() {
  const rows = await sheetsService.getBudgetSheet();
  if (rows && rows.length > 0) return rows;

  const nowStr = new Date().toISOString().split('T')[0];
  const seededRows = SEED_SECTION_BUDGETS.map(function(s, idx) {
    return {
      'Budget ID':      'BDG-' + (100001 + idx),
      'Location':       'Kosamba',
      'Plant':          s.plant,
      'Department':     s.dept,
      'Section':        s.section,
      'Staff Budget':   String(s.staffBudget),
      'Workmen Budget': String(s.workmenBudget),
      'Date From':      '2026-01-01',
      'Date To':        '2026-12-31',
      'Status':         'ACTIVE',
      'Created By':     'System Seed',
      'Created Date':   nowStr,
      'Updated By':     'System Seed',
      'Updated Date':   nowStr
    };
  });

  await sheetsService.saveBudgetSheet(seededRows);
  return seededRows;
}

/**
 * Calculate per-section live actuals from active apprentices database.
 * V3: Removed seed fallback — actuals are always from live Active_Apprentices data only.
 * If no real records match a budget section, actuals correctly show 0.
 */
function calculateSectionActuals(activeApprentices) {
  const actualsMap = {};

  (activeApprentices || []).forEach(function(row) {
    const loc     = String(row['Location']   || '').trim();
    const plant   = String(row['Plant']      || '145 TPD').trim();
    const dept    = String(row['Department'] || '').trim();
    const section = String(row['Section']    || dept).trim();

    if (!dept) return;

    const key = loc.toLowerCase() + '|||' + plant.toLowerCase() + '|||' + dept.toLowerCase() + '|||' + section.toLowerCase();
    if (!actualsMap[key]) {
      actualsMap[key] = { staffActual: 0, workmenActual: 0, totalActual: 0, count: 0 };
    }

    const typeRaw = String(row[APPRENTICE_TYPE_FIELD] || row['Type'] || '').trim().toLowerCase();
    if (typeRaw === 'staff') {
      actualsMap[key].staffActual++;
    } else {
      actualsMap[key].workmenActual++;
    }
    actualsMap[key].count++;
    actualsMap[key].totalActual = actualsMap[key].staffActual + actualsMap[key].workmenActual;
  });

  return actualsMap;
}

/**
 * Calculate per-location completed apprentice counts from Completed_Apprentices database.
 * Returns a map keyed by location.toLowerCase() with total completed count.
 */
function calculateCompletedByLocation(completedApprentices) {
  const completedMap = {};
  (completedApprentices || []).forEach(function(row) {
    const loc = String(row['Location'] || '').trim().toLowerCase();
    if (!loc) return;
    completedMap[loc] = (completedMap[loc] || 0) + 1;
  });
  return completedMap;
}

/**
 * Calculate per-section completed apprentice counts.
 * Returns a map keyed by loc|||plant|||dept|||section.
 */
function calculateCompletedBySection(completedApprentices) {
  const completedMap = {};
  (completedApprentices || []).forEach(function(row) {
    const loc     = String(row['Location']   || '').trim();
    const plant   = String(row['Plant']      || '145 TPD').trim();
    const dept    = String(row['Department'] || '').trim();
    const section = String(row['Section']    || dept).trim();
    if (!dept) return;
    const key = loc.toLowerCase() + '|||' + plant.toLowerCase() + '|||' + dept.toLowerCase() + '|||' + section.toLowerCase();
    completedMap[key] = (completedMap[key] || 0) + 1;
  });
  return completedMap;
}

/**
 * Section status calculation helper
 */
function calculateSectionStatus(totalBudget, totalActual, staffAvailable, workmenAvailable) {
  const totalAvailable = totalBudget - totalActual;
  let statusText = 'OPEN';
  let statusClass = 'status-green';
  let subText = totalAvailable + ' position' + (totalAvailable !== 1 ? 's' : '') + ' available';

  if (totalAvailable < 0) {
    statusText = 'OVER BUDGET';
    statusClass = 'status-red';
    const overNum = Math.abs(totalAvailable);
    subText = overNum + ' position' + (overNum > 1 ? 's' : '') + ' over budget';
  } else if (totalAvailable === 0) {
    statusText = 'FULL';
    statusClass = 'status-yellow';
    subText = 'Full capacity';
  }

  let categoryWarning = '';
  if (staffAvailable < 0) {
    categoryWarning = '⚠ Staff over budget by ' + Math.abs(staffAvailable);
  } else if (workmenAvailable < 0) {
    categoryWarning = '⚠ Workmen over budget by ' + Math.abs(workmenAvailable);
  }

  return {
    status: statusText,
    statusClass: statusClass,
    subText: subText,
    categoryWarning: categoryWarning
  };
}

/**
 * getBudgetDashboard(filters)
 * Full section-level dashboard analytics & table rows.
 * V3: Added completed counts, removed seed fallback, added locationSummary.
 */
async function getBudgetDashboard(filters) {
  filters = filters || {};
  const locFilter   = (filters.location   || '').trim().toLowerCase();
  const plantFilter = (filters.plant      || '').trim().toLowerCase();
  const deptFilter  = (filters.department || '').trim().toLowerCase();
  const secFilter   = (filters.section    || '').trim().toLowerCase();
  const searchFilter= (filters.search     || '').trim().toLowerCase();

  // V3: Fetch active + completed in single parallel call
  const results = await Promise.all([
    ensureSeedBudgetsExist(),
    sheetsService.getActiveApprentices(),
    sheetsService.getCompletedApprentices()
  ]);

  const budgetRows           = results[0] || [];
  const activeApprentices    = results[1] || [];
  const completedApprentices = results[2] || [];

  const actualsMap       = calculateSectionActuals(activeApprentices);
  const completedByLoc   = calculateCompletedByLocation(completedApprentices);
  const completedBySec   = calculateCompletedBySection(completedApprentices);

  // Active budget rows only
  const activeBudgets = budgetRows.filter(function(r) {
    return String(r['Status'] || 'ACTIVE').trim().toUpperCase() === 'ACTIVE';
  });

  const sections = [];
  let totalStaffBudget   = 0;
  let totalWorkmenBudget = 0;
  let totalStaffActual   = 0;
  let totalWorkmenActual = 0;

  // V3: Track per-location summary for the locationSummary[] response field
  const locSummaryMap = {};

  activeBudgets.forEach(function(config) {
    const loc     = String(config['Location']   || 'Kosamba').trim();
    const plant   = String(config['Plant']      || '145 TPD').trim();
    const dept    = String(config['Department'] || '').trim();
    const section = String(config['Section']    || config['Department'] || '').trim();

    if (!section) return;

    // Build per-location summary (unfiltered — always covers all locations)
    const locKey = loc.toLowerCase();
    if (!locSummaryMap[locKey]) {
      locSummaryMap[locKey] = {
        location:    loc,
        totalBudget: 0,
        currentActual: 0,
        available:   0,
        completed:   completedByLoc[locKey] || 0,
        overBudgetSections: 0
      };
    }
    const secKey = loc.toLowerCase() + '|||' + plant.toLowerCase() + '|||' + dept.toLowerCase() + '|||' + section.toLowerCase();
    const secActual = actualsMap[secKey] || { staffActual: 0, workmenActual: 0, totalActual: 0 };
    const secStaffBudget   = parseInt(config['Staff Budget'])   || 0;
    const secWorkmenBudget = parseInt(config['Workmen Budget']) || 0;
    const secTotalBudget   = secStaffBudget + secWorkmenBudget;
    const secTotalActual   = (secActual.staffActual || 0) + (secActual.workmenActual || 0);
    locSummaryMap[locKey].totalBudget   += secTotalBudget;
    locSummaryMap[locKey].currentActual += secTotalActual;
    if (secTotalActual > secTotalBudget) locSummaryMap[locKey].overBudgetSections++;

    // Now apply dashboard filters for the main sections array
    if (locFilter   && loc.toLowerCase()    !== locFilter)   return;
    if (plantFilter && plant.toLowerCase()  !== plantFilter) return;
    if (deptFilter  && dept.toLowerCase()   !== deptFilter)  return;
    if (secFilter   && section.toLowerCase()!== secFilter)   return;

    if (searchFilter) {
      const match = loc.toLowerCase().includes(searchFilter) ||
                    plant.toLowerCase().includes(searchFilter) ||
                    dept.toLowerCase().includes(searchFilter) ||
                    section.toLowerCase().includes(searchFilter);
      if (!match) return;
    }

    const actual = actualsMap[secKey] || { staffActual: 0, workmenActual: 0, totalActual: 0 };

    const staffBudget   = parseInt(config['Staff Budget'])   || 0;
    const workmenBudget = parseInt(config['Workmen Budget']) || 0;
    const totalBudget   = staffBudget + workmenBudget;

    const staffActual   = actual.staffActual   || 0;
    const workmenActual = actual.workmenActual || 0;
    const totalActual   = staffActual + workmenActual;

    const staffAvailable   = staffBudget - staffActual;
    const workmenAvailable = workmenBudget - workmenActual;
    const totalAvailable   = totalBudget - totalActual;
    const utilizationPct   = totalBudget > 0 ? Math.round((totalActual / totalBudget) * 1000) / 10 : 0;

    // V3: completed count for this section
    const completedCount = completedBySec[secKey] || 0;

    const stObj = calculateSectionStatus(totalBudget, totalActual, staffAvailable, workmenAvailable);

    sections.push({
      budgetId:         config['Budget ID'] || ('BDG-' + section),
      location:         loc,
      plant:            plant,
      department:       dept,
      section:          section,
      staffBudget:      staffBudget,
      staffActual:      staffActual,
      staffAvailable:   staffAvailable,
      workmenBudget:    workmenBudget,
      workmenActual:    workmenActual,
      workmenAvailable: workmenAvailable,
      totalBudget:      totalBudget,
      totalActual:      totalActual,
      totalAvailable:   totalAvailable,
      utilizationPct:   utilizationPct,
      completedCount:   completedCount,   // V3: new field
      status:           stObj.status,
      statusClass:      stObj.statusClass,
      subText:          stObj.subText,
      categoryWarning:  stObj.categoryWarning,
      dateFrom:         config['Date From'] || '',
      dateTo:           config['Date To']   || ''
    });

    totalStaffBudget   += staffBudget;
    totalWorkmenBudget += workmenBudget;
    totalStaffActual   += staffActual;
    totalWorkmenActual += workmenActual;
  });

  sections.sort(function(a, b) {
    return a.section.localeCompare(b.section, undefined, { sensitivity: 'base' });
  });

  const totalBudgetAll     = totalStaffBudget + totalWorkmenBudget;
  const totalActualAll     = totalStaffActual + totalWorkmenActual;
  const totalStaffAvail    = totalStaffBudget - totalStaffActual;
  const totalWorkmenAvail  = totalWorkmenBudget - totalWorkmenActual;
  const totalAvailAll      = totalBudgetAll - totalActualAll;
  const overallUtilPct     = totalBudgetAll > 0 ? Math.round((totalActualAll / totalBudgetAll) * 1000) / 10 : 0;

  // V3: Total completed for the filtered scope
  let totalCompleted = 0;
  if (locFilter) {
    totalCompleted = completedByLoc[locFilter] || 0;
  } else {
    // Sum across all locations
    Object.values(completedByLoc).forEach(function(c) { totalCompleted += c; });
  }

  // V3: Build locationSummary array (derived available + utilization)
  const locationSummary = Object.values(locSummaryMap).map(function(ls) {
    const avail = ls.totalBudget - ls.currentActual;
    const util  = ls.totalBudget > 0 ? Math.round((ls.currentActual / ls.totalBudget) * 1000) / 10 : 0;
    return {
      location:      ls.location,
      totalBudget:   ls.totalBudget,
      currentActual: ls.currentActual,
      available:     avail,
      completed:     ls.completed,
      utilizationPct: util,
      overBudgetSections: ls.overBudgetSections,
      status: avail < 0 ? 'OVER BUDGET' : avail === 0 ? 'FULL' : 'AVAILABLE'
    };
  }).sort(function(a, b) {
    return a.location.localeCompare(b.location, undefined, { sensitivity: 'base' });
  });

  return {
    summary: {
      totalBudget:       totalBudgetAll,
      currentActual:     totalActualAll,
      available:         totalAvailAll,
      utilizationPct:    overallUtilPct,
      staffBudget:       totalStaffBudget,
      staffActual:       totalStaffActual,
      staffAvailable:    totalStaffAvail,
      workmenBudget:     totalWorkmenBudget,
      workmenActual:     totalWorkmenActual,
      workmenAvailable:  totalWorkmenAvail,
      totalCompleted:    totalCompleted        // V3: new field
    },
    sections:        sections,
    locationSummary: locationSummary,          // V3: new field
    departments:     sections                  // Backward compatibility
  };
}

/**
 * getBudgetConfiguration(options)
 */
async function getBudgetConfiguration(options) {
  options = options || {};
  const showInactive = options.showInactive === true || options.showInactive === 'true';
  const locFilter    = (options.location   || '').trim().toLowerCase();
  const plantFilter  = (options.plant      || '').trim().toLowerCase();
  const deptFilter   = (options.department || '').trim().toLowerCase();
  const secFilter    = (options.section    || '').trim().toLowerCase();
  const search       = (options.search     || '').trim().toLowerCase();

  const budgetRows = await ensureSeedBudgetsExist();

  const result = [];
  (budgetRows || []).forEach(function(row) {
    const budgetId = String(row['Budget ID']  || '').trim();
    const loc      = String(row['Location']   || '').trim();
    const plant    = String(row['Plant']      || '').trim();
    const dept     = String(row['Department'] || '').trim();
    const section  = String(row['Section']    || dept).trim();
    const status   = String(row['Status']     || 'ACTIVE').trim().toUpperCase();

    if (!section) return;
    if (!showInactive && status === 'INACTIVE') return;

    if (locFilter   && loc.toLowerCase()   !== locFilter)   return;
    if (plantFilter && plant.toLowerCase() !== plantFilter) return;
    if (deptFilter  && dept.toLowerCase()  !== deptFilter)  return;
    if (secFilter   && section.toLowerCase()!== secFilter)  return;

    if (search) {
      const match = loc.toLowerCase().includes(search) ||
                    plant.toLowerCase().includes(search) ||
                    dept.toLowerCase().includes(search) ||
                    section.toLowerCase().includes(search) ||
                    budgetId.toLowerCase().includes(search);
      if (!match) return;
    }

    const staffBudget   = parseInt(row['Staff Budget'])   || 0;
    const workmenBudget = parseInt(row['Workmen Budget']) || 0;

    result.push({
      budgetId:      budgetId,
      location:      loc,
      plant:         plant,
      department:    dept,
      section:       section,
      staffBudget:   staffBudget,
      workmenBudget: workmenBudget,
      totalBudget:   staffBudget + workmenBudget,
      dateFrom:      row['Date From'] || '',
      dateTo:        row['Date To']   || '',
      status:        status,
      createdBy:     row['Created By']   || '',
      createdDate:   row['Created Date'] || '',
      updatedBy:     row['Updated By']   || '',
      updatedDate:   row['Updated Date'] || ''
    });
  });

  result.sort(function(a, b) {
    return a.section.localeCompare(b.section, undefined, { sensitivity: 'base' });
  });

  return result;
}

/**
 * createBudget(data, user)
 */
async function createBudget(data, user) {
  const loc     = String(data.location   || '').trim();
  const plant   = String(data.plant      || '145 TPD').trim();
  const dept    = String(data.department || '').trim();
  const section = String(data.section    || dept).trim();
  const staff   = parseInt(data.staffBudget)   || 0;
  const wrk     = parseInt(data.workmenBudget) || 0;
  const dateFrom= String(data.dateFrom || '2026-01-01').trim();
  const dateTo  = String(data.dateTo   || '2026-12-31').trim();
  const status  = (data.status || 'ACTIVE').trim().toUpperCase();

  if (!loc)     throw new Error('Location is required.');
  if (!plant)   throw new Error('Plant is required.');
  if (!dept)    throw new Error('Department is required.');
  if (!section) throw new Error('Section is required.');
  if (staff < 0 || wrk < 0) throw new Error('Budget values cannot be negative.');
  if (dateTo && dateFrom && new Date(dateTo) < new Date(dateFrom)) {
    throw new Error('Date To cannot be before Date From.');
  }

  const rows = await ensureSeedBudgetsExist();
  const existingIndex = rows.findIndex(function(r) {
    return String(r['Location']   || '').trim().toLowerCase() === loc.toLowerCase() &&
           String(r['Plant']      || '').trim().toLowerCase() === plant.toLowerCase() &&
           String(r['Department'] || '').trim().toLowerCase() === dept.toLowerCase() &&
           String(r['Section']    || '').trim().toLowerCase() === section.toLowerCase();
  });

  if (existingIndex !== -1) {
    const existingStatus = String(rows[existingIndex]['Status'] || 'ACTIVE').trim().toUpperCase();
    if (existingStatus === 'ACTIVE') {
      throw new Error(`A budget configuration for "${loc}" - "${plant}" - "${section}" already exists.`);
    }
  }

  const nowStr   = new Date().toISOString().split('T')[0];
  const nowIso   = new Date().toISOString();
  const userDisp = getUserDisplay(user);
  const budgetId = generateBudgetId();

  const newRow = {
    'Budget ID':      budgetId,
    'Location':       loc,
    'Plant':          plant,
    'Department':     dept,
    'Section':        section,
    'Staff Budget':   String(staff),
    'Workmen Budget': String(wrk),
    'Date From':      dateFrom,
    'Date To':        dateTo,
    'Status':         status,
    'Created By':     userDisp,
    'Created Date':   nowStr,
    'Updated By':     userDisp,
    'Updated Date':   nowStr
  };

  if (existingIndex !== -1) {
    rows[existingIndex] = newRow;
  } else {
    rows.push(newRow);
  }

  await sheetsService.saveBudgetSheet(rows);

  await sheetsService.appendBudgetAuditLog({
    timestamp:        nowIso,
    user:             userDisp,
    action:           'Section Budget Created',
    location:         loc,
    department:       dept + ' / ' + section,
    oldStaffBudget:   0,
    newStaffBudget:   staff,
    oldWorkmenBudget: 0,
    newWorkmenBudget: wrk,
    oldStatus:        'NONE',
    newStatus:        status
  });

  return newRow;
}

/**
 * updateBudget(budgetId, updates, user)
 */
async function updateBudget(budgetId, updates, user) {
  if (!budgetId) throw new Error('Budget ID is required.');

  const rows = await ensureSeedBudgetsExist();
  const index = rows.findIndex(function(r) {
    return String(r['Budget ID'] || '').trim() === String(budgetId).trim();
  });

  if (index === -1) {
    throw new Error(`Budget entry "${budgetId}" not found.`);
  }

  const existing = rows[index];
  const loc      = String(updates.location   !== undefined ? updates.location   : existing['Location']).trim();
  const plant    = String(updates.plant      !== undefined ? updates.plant      : existing['Plant']).trim();
  const dept     = String(updates.department !== undefined ? updates.department : existing['Department']).trim();
  const section  = String(updates.section    !== undefined ? updates.section    : existing['Section']).trim();

  const newStaff = updates.staffBudget   !== undefined ? (parseInt(updates.staffBudget)   || 0) : (parseInt(existing['Staff Budget'])   || 0);
  const newWrk   = updates.workmenBudget !== undefined ? (parseInt(updates.workmenBudget) || 0) : (parseInt(existing['Workmen Budget']) || 0);
  const dateFrom = updates.dateFrom      !== undefined ? String(updates.dateFrom).trim() : String(existing['Date From'] || '').trim();
  const dateTo   = updates.dateTo        !== undefined ? String(updates.dateTo).trim()   : String(existing['Date To']   || '').trim();
  const newStatus= updates.status        !== undefined ? String(updates.status).trim().toUpperCase() : String(existing['Status'] || 'ACTIVE').trim().toUpperCase();

  if (newStaff < 0 || newWrk < 0) throw new Error('Budget values cannot be negative.');
  if (dateTo && dateFrom && new Date(dateTo) < new Date(dateFrom)) {
    throw new Error('Date To cannot be before Date From.');
  }

  const oldStaff = parseInt(existing['Staff Budget'])   || 0;
  const oldWrk   = parseInt(existing['Workmen Budget']) || 0;
  const oldStatus= String(existing['Status'] || 'ACTIVE').trim().toUpperCase();

  const nowStr   = new Date().toISOString().split('T')[0];
  const nowIso   = new Date().toISOString();
  const userDisp = getUserDisplay(user);

  rows[index] = {
    'Budget ID':      existing['Budget ID'] || budgetId,
    'Location':       loc,
    'Plant':          plant,
    'Department':     dept,
    'Section':        section,
    'Staff Budget':   String(newStaff),
    'Workmen Budget': String(newWrk),
    'Date From':      dateFrom,
    'Date To':        dateTo,
    'Status':         newStatus,
    'Created By':     existing['Created By']   || userDisp,
    'Created Date':   existing['Created Date'] || nowStr,
    'Updated By':     userDisp,
    'Updated Date':   nowStr
  };

  await sheetsService.saveBudgetSheet(rows);

  await sheetsService.appendBudgetAuditLog({
    timestamp:        nowIso,
    user:             userDisp,
    action:           'Section Budget Updated',
    location:         loc,
    department:       dept + ' / ' + section,
    oldStaffBudget:   oldStaff,
    newStaffBudget:   newStaff,
    oldWorkmenBudget: oldWrk,
    newWorkmenBudget: newWrk,
    oldStatus:        oldStatus,
    newStatus:        newStatus
  });

  return rows[index];
}

async function toggleBudgetStatus(budgetId, targetStatus, user) {
  return await updateBudget(budgetId, { status: targetStatus }, user);
}

async function duplicateBudget(sourceBudgetId, targetLocation, user) {
  const targetLoc = String(targetLocation || '').trim();
  if (!targetLoc) throw new Error('Target Location is required.');

  const rows = await ensureSeedBudgetsExist();
  const source = rows.find(function(r) {
    return String(r['Budget ID'] || '').trim() === String(sourceBudgetId).trim();
  });

  if (!source) throw new Error(`Source Budget "${sourceBudgetId}" not found.`);

  return await createBudget({
    location:      targetLoc,
    plant:         source['Plant'],
    department:    source['Department'],
    section:       source['Section'],
    staffBudget:   source['Staff Budget'],
    workmenBudget: source['Workmen Budget'],
    dateFrom:      source['Date From'],
    dateTo:        source['Date To'],
    status:        'ACTIVE'
  }, user);
}

async function createDepartment(departmentName, user) {
  const dept = String(departmentName || '').trim();
  if (!dept) throw new Error('Department name is required.');

  const rows = await sheetsService.getDepartmentMasterSheet();
  const exists = rows.some(function(r) {
    return String(r['Department'] || '').trim().toLowerCase() === dept.toLowerCase();
  });

  if (exists) {
    throw new Error(`Department "${dept}" already exists in Master list.`);
  }

  const nowStr   = new Date().toISOString().split('T')[0];
  const userDisp = getUserDisplay(user);

  rows.push({
    'Department':   dept,
    'Status':       'ACTIVE',
    'Created By':   userDisp,
    'Created Date': nowStr,
    'Updated By':   userDisp,
    'Updated Date': nowStr
  });

  await sheetsService.saveDepartmentMasterSheet(rows);
  sheetsService.invalidateDataCache();

  return { department: dept, status: 'ACTIVE' };
}

async function getDepartmentMaster() {
  const rows = await sheetsService.getDepartmentMasterSheet();
  return (rows || []).map(function(r) {
    return {
      department:  r['Department'],
      status:      r['Status'] || 'ACTIVE',
      createdBy:   r['Created By'],
      createdDate: r['Created Date'],
      updatedBy:   r['Updated By'],
      updatedDate: r['Updated Date']
    };
  });
}

async function importBudgets(importRows, user) {
  if (!Array.isArray(importRows) || importRows.length === 0) {
    throw new Error('No rows provided for import.');
  }

  let createdCount = 0;
  let updatedCount = 0;

  for (let i = 0; i < importRows.length; i++) {
    const item = importRows[i];
    const loc  = String(item.Location   || item.location   || 'Kosamba').trim();
    const plant= String(item.Plant      || item.plant      || '145 TPD').trim();
    const dept = String(item.Department || item.department || '').trim();
    const sec  = String(item.Section    || item.section    || dept).trim();
    const staff = parseInt(item['Staff Budget']   || item.staffBudget)   || 0;
    const wrk   = parseInt(item['Workmen Budget'] || item.workmenBudget) || 0;

    if (!sec) continue;

    const existingRows = await ensureSeedBudgetsExist();
    const existing = existingRows.find(function(r) {
      return String(r['Location'] || '').trim().toLowerCase() === loc.toLowerCase() &&
             String(r['Section']  || r['Department'] || '').trim().toLowerCase() === sec.toLowerCase();
    });

    if (existing) {
      await updateBudget(existing['Budget ID'], {
        staffBudget:   staff,
        workmenBudget: wrk
      }, user);
      updatedCount++;
    } else {
      await createBudget({
        location:      loc,
        plant:         plant,
        department:    dept || sec,
        section:       sec,
        staffBudget:   staff,
        workmenBudget: wrk,
        status:        'ACTIVE'
      }, user);
      createdCount++;
    }
  }

  return { created: createdCount, updated: updatedCount, total: createdCount + updatedCount };
}

async function getBudgetHistory() {
  const rows = await sheetsService.getBudgetAuditLogs();
  return (rows || []).slice().reverse();
}

module.exports = {
  getBudgetDashboard,
  getBudgetConfiguration,
  createBudget,
  updateBudget,
  toggleBudgetStatus,
  duplicateBudget,
  createDepartment,
  getDepartmentMaster,
  importBudgets,
  getBudgetHistory,
  calculateSectionActuals,
  calculateSectionStatus,
  calculateCompletedByLocation,
  calculateCompletedBySection,
  ensureSeedBudgetsExist
};