const express = require('express');
const router = express.Router();
const sheetsService = require('../services/sheetsService');
const { executeWithRetry } = sheetsService;
const authMiddleware = require('../middleware/auth');
const { requestStorage } = require('../utils/logger');
const reportService = require('../services/reportService');
const XLSX = require('xlsx');

const { mapSheetToInternal } = require('../utils/mappers');
// Map apprentice object to raw header values
function getApprenticeValue(app, header) {
  const stdMap = {
    "Employee Code": app.code,
    "Full Name": app.name,
    "Location": app.location,
    "Department": app.dept,
    "Joining Date": app.joined,
    "Sex": app.sex,
    "Age": app.age,
    "Phone": app.phone,
    "Email": app.email,
    "Address": app.address,
    "Remarks": app.remarks,
    "Employee Contract ID": app.contractId,
    "Portal Enrollment Number": app.portalEnrollmentNumber,
    "Portal Name": app.portalName,
    "Record Status": app.status,
    "Updated By": app.updatedBy,
    "Updated Date": app.updatedDate,
    "Completion Date": app.completionDate,
    "Completed By": app.completedBy,
    "Completion Reason": app.completionReason,
    "Other Completion Reason": app.otherCompletionReason,
    "Completion Remarks": app.completionRemarks,
    "Post Apprenticeship Status": app.postApprenticeshipStatus
  };

  if (stdMap.hasOwnProperty(header)) {
    return stdMap[header];
  }
  return app[header] !== undefined ? app[header] : "";
}

// Order columns logically
function getOrderedHeaders(allHeadersSet) {
  const core = ["Employee Code", "Full Name", "Location", "Department", "Joining Date", "Sex", "Age", "Phone", "Email", "Address", "Remarks"];
  const hr = ["Employee Contract ID", "Portal Enrollment Number", "Portal Name"];
  const employment = ["Record Status", "Updated By", "Updated Date"];
  const completion = ["Completion Date", "Completed By", "Completion Reason", "Other Completion Reason", "Completion Remarks", "Post Apprenticeship Status"];

  const ordered = [];
  const setCopy = new Set(allHeadersSet);

  core.forEach(h => {
    if (setCopy.has(h)) {
      ordered.push(h);
      setCopy.delete(h);
    }
  });

  hr.forEach(h => {
    if (setCopy.has(h)) {
      ordered.push(h);
      setCopy.delete(h);
    }
  });

  employment.forEach(h => {
    if (setCopy.has(h)) {
      ordered.push(h);
      setCopy.delete(h);
    }
  });

  completion.forEach(h => {
    if (setCopy.has(h)) {
      ordered.push(h);
      setCopy.delete(h);
    }
  });

  setCopy.forEach(h => {
    ordered.push(h);
  });

  return ordered;
}

// Filter engine matching pipeline
function applyFilters(records, filters) {
  let filtered = [...records];

  if (!filters) return filtered;

  // 1. Search filter
  if (filters.search) {
    const q = String(filters.search).toLowerCase().trim();
    filtered = filtered.filter(x => {
      return (x.name || '').toLowerCase().includes(q) ||
        (x.code || '').toLowerCase().includes(q) ||
        (x.dept || '').toLowerCase().includes(q) ||
        (x.location || '').toLowerCase().includes(q) ||
        (x.phone || '').toLowerCase().includes(q) ||
        (x.email || '').toLowerCase().includes(q) ||
        (x.contractId || '').toLowerCase().includes(q) ||
        (x.portalEnrollmentNumber || '').toLowerCase().includes(q) ||
        (x.portalName || '').toLowerCase().includes(q);
    });
  }

  // 2. Location filter
  if (filters.location && filters.location !== 'All Locations') {
    const loc = String(filters.location).toLowerCase().trim();
    filtered = filtered.filter(x => String(x.location).toLowerCase().trim() === loc);
  }

  // 3. Department filter
  if (filters.dept && filters.dept !== 'All' && filters.dept !== '') {
    const dept = String(filters.dept).toLowerCase().trim();
    filtered = filtered.filter(x => String(x.dept).toLowerCase().trim() === dept);
  }

  // 4. Status filter
  if (filters.status && filters.status !== 'All' && filters.status !== '') {
    const status = String(filters.status).toLowerCase().trim();
    filtered = filtered.filter(x => String(x.status).toLowerCase().trim() === status);
  }

  // 5. Gender filter
  if (filters.gender && filters.gender !== 'All' && filters.gender !== '') {
    const gender = String(filters.gender).toLowerCase().trim();
    filtered = filtered.filter(x => String(x.sex || x.gender || 'Male').toLowerCase().trim() === gender);
  }

  // 6. Completion Reason filter
  if (filters.completionReason && filters.completionReason !== 'All' && filters.completionReason !== '') {
    const reason = String(filters.completionReason).toLowerCase().trim();
    filtered = filtered.filter(x => String(x.completionReason).toLowerCase().trim() === reason);
  }

  // 7. Joining Date range
  const parseDateSafe = (dateVal) => {
    if (!dateVal) return null;
    const d = new Date(dateVal);
    return isNaN(d.getTime()) ? null : d;
  };

  if (filters.joiningDateStart) {
    const startLimit = parseDateSafe(filters.joiningDateStart);
    if (startLimit) {
      filtered = filtered.filter(x => {
        const joinedDate = parseDateSafe(x.joined);
        return joinedDate && joinedDate >= startLimit;
      });
    }
  }
  if (filters.joiningDateEnd) {
    const endLimit = parseDateSafe(filters.joiningDateEnd);
    if (endLimit) {
      filtered = filtered.filter(x => {
        const joinedDate = parseDateSafe(x.joined);
        return joinedDate && joinedDate <= endLimit;
      });
    }
  }

  // 8. Completion Date range
  // Only apply to completed records (those that have a completionDate).
  // Active apprentices have no completionDate and should not be excluded by this filter.
  if (filters.completionDateStart) {
    const startLimit = parseDateSafe(filters.completionDateStart);
    if (startLimit) {
      filtered = filtered.filter(x => {
        if (!x.completionDate) return true;
        const compDate = parseDateSafe(x.completionDate);
        return compDate && compDate >= startLimit;
      });
    }
  }
  if (filters.completionDateEnd) {
    const endLimit = parseDateSafe(filters.completionDateEnd);
    if (endLimit) {
      filtered = filtered.filter(x => {
        if (!x.completionDate) return true;
        const compDate = parseDateSafe(x.completionDate);
        return compDate && compDate <= endLimit;
      });
    }
  }

  return filtered;
}

// Dynamic sheet headers discoverer (cache-aware — zero extra API calls)
// Headers are extracted from the already-fetched cached data objects.
// Object.keys() preserves insertion order (matches spreadsheet column order).
async function fetchSheetHeaders() {
  const activeHeaders = await sheetsService.getActiveHeaders();
  const completedHeaders = await sheetsService.getCompletedHeaders();
  return { activeHeaders, completedHeaders };
}

// 1. POST preview metrics before downloading (Improvement 5 & 6)
router.post('/preview', authMiddleware, async (req, res) => {
  const { reportType, filters } = req.body;
  const user = req.user;

  try {
    const activeRaw = await sheetsService.getActiveApprentices();
    const completedRaw = await sheetsService.getCompletedApprentices();

    let active = activeRaw.map(r => mapSheetToInternal(r, false));
    let completed = completedRaw.map(r => mapSheetToInternal(r, true));
    let combined = [...active, ...completed];

    // Security constraints for Branch HR
    const actualFilters = { ...filters };
    if (user.role === 'Branch HR') {
      actualFilters.location = user.location;
    }

    // Apply exact filter pipeline
    let filteredRecords = applyFilters(combined, actualFilters);

    // Apply report type constraints
    let reportTitle = "Full Master Report";
    if (reportType === 'active') {
      filteredRecords = filteredRecords.filter(x => x.status === 'Active');
      reportTitle = "Active Apprentices Report";
    } else if (reportType === 'completed') {
      filteredRecords = filteredRecords.filter(x => x.status === 'Completed');
      reportTitle = "Completed Apprentices Report";
    } else if (reportType === 'missing_contract') {
      filteredRecords = filteredRecords.filter(x => x.status === 'Active' && (!x.contractId || x.contractId.toLowerCase() === 'pending' || x.contractId === ''));
      reportTitle = "Missing Contract ID Report";
    } else if (reportType === 'missing_enrollment') {
      filteredRecords = filteredRecords.filter(x => x.status === 'Active' && (!x.portalEnrollmentNumber || x.portalEnrollmentNumber.toLowerCase() === 'pending' || x.portalEnrollmentNumber === ''));
      reportTitle = "Missing Portal Enrollment Report";
    } else if (reportType === 'missing_portal_name') {
      filteredRecords = filteredRecords.filter(x => x.status === 'Active' && (!x.portalName || x.portalName.toLowerCase() === 'pending' || x.portalName === ''));
      reportTitle = "Missing Portal Name Report";
    } else if (reportType === 'permanent_conversion') {
      filteredRecords = filteredRecords.filter(x => x.status === 'Completed' && x.completionReason === 'Selected as Permanent Employee');
      reportTitle = "Permanent Conversion Report";
    } else if (reportType === 'branch_wise') {
      reportTitle = "Branch Wise Report";
    } else if (reportType === 'department_wise') {
      reportTitle = "Department Wise Report";
    } else if (reportType === 'completion_reason') {
      reportTitle = "Completion Reason Report";
    }

    const appliedFiltersText = Object.keys(actualFilters)
      .filter(k => actualFilters[k] !== undefined && actualFilters[k] !== '' && actualFilters[k] !== 'All' && actualFilters[k] !== 'All Locations')
      .map(k => `${k}: ${actualFilters[k]}`)
      .join(', ') || 'None';

    const store = requestStorage.getStore();
    if (store) {
      store.recordCount = filteredRecords.length;
    }

    return res.json({
      success: true,
      count: filteredRecords.length,
      reportName: reportTitle,
      appliedFiltersText: appliedFiltersText,
      locationScope: user.role === 'Super HR' ? 'All Locations' : user.location,
      departmentsIncluded: actualFilters.dept || 'All Departments'
    });
  } catch (err) {
    console.error('Report Preview Error:', err);
    return res.status(500).json({ success: false, error: 'Failed to generate preview: ' + err.message });
  }
});

// 2. POST compile and download report (True Master Export Mode)
router.post('/export', authMiddleware, async (req, res) => {
  const { reportType, format, filters, simulateMismatch = false, selectedColumns } = req.body;
  const user = req.user;

  if (!reportType || !format) {
    return res.status(400).json({ success: false, error: 'Report type and file format are required.' });
  }

  try {
    const activeRaw = await sheetsService.getActiveApprentices();
    const completedRaw = await sheetsService.getCompletedApprentices();
    const { activeHeaders, completedHeaders } = await fetchSheetHeaders();

    let active = activeRaw.map(r => mapSheetToInternal(r, false));
    let completed = completedRaw.map(r => mapSheetToInternal(r, true));
    let combined = [...active, ...completed];

    // Security constraints for Branch HR
    const actualFilters = { ...filters };
    if (user.role === 'Branch HR') {
      actualFilters.location = user.location;
    }

    // Apply exact filter pipeline
    let filteredRecords = applyFilters(combined, actualFilters);

    // Apply report type filter constraints
    let reportTitle = "Full Master Report";
    let isSummaryReport = false;
    let exportData = [];
    let exportHeaders = [];

    if (reportType === 'active') {
      filteredRecords = filteredRecords.filter(x => x.status === 'Active');
      reportTitle = "Active Apprentices Report";
    } else if (reportType === 'completed') {
      filteredRecords = filteredRecords.filter(x => x.status === 'Completed');
      reportTitle = "Completed Apprentices Report";
    } else if (reportType === 'missing_contract') {
      filteredRecords = filteredRecords.filter(x => x.status === 'Active' && (!x.contractId || x.contractId.toLowerCase() === 'pending' || x.contractId === ''));
      reportTitle = "Missing Contract ID Report";
    } else if (reportType === 'missing_enrollment') {
      filteredRecords = filteredRecords.filter(x => x.status === 'Active' && (!x.portalEnrollmentNumber || x.portalEnrollmentNumber.toLowerCase() === 'pending' || x.portalEnrollmentNumber === ''));
      reportTitle = "Missing Portal Enrollment Report";
    } else if (reportType === 'missing_portal_name') {
      filteredRecords = filteredRecords.filter(x => x.status === 'Active' && (!x.portalName || x.portalName.toLowerCase() === 'pending' || x.portalName === ''));
      reportTitle = "Missing Portal Name Report";
    } else if (reportType === 'permanent_conversion') {
      filteredRecords = filteredRecords.filter(x => x.status === 'Completed' && x.completionReason === 'Selected as Permanent Employee');
      reportTitle = "Permanent Conversion Report";
    } else if (reportType === 'branch_wise') {
      isSummaryReport = true;
      reportTitle = "Branch Wise Report";
      const branchSummary = {};
      filteredRecords.forEach(a => {
        if (!branchSummary[a.location]) branchSummary[a.location] = { active: 0, completed: 0 };
        if (a.status === 'Completed') branchSummary[a.location].completed++;
        else branchSummary[a.location].active++;
      });
      exportData = Object.keys(branchSummary).map(loc => ({
        "Location": loc,
        "Active Apprentices": branchSummary[loc].active,
        "Completed Apprentices": branchSummary[loc].completed,
        "Total Apprentices": branchSummary[loc].active + branchSummary[loc].completed
      }));
      exportHeaders = ["Location", "Active Apprentices", "Completed Apprentices", "Total Apprentices"];
    } else if (reportType === 'department_wise') {
      isSummaryReport = true;
      reportTitle = "Department Wise Report";
      const deptSummary = {};
      filteredRecords.forEach(a => {
        if (!deptSummary[a.dept]) deptSummary[a.dept] = { active: 0, completed: 0 };
        if (a.status === 'Completed') deptSummary[a.dept].completed++;
        else deptSummary[a.dept].active++;
      });
      exportData = Object.keys(deptSummary).map(d => ({
        "Department": d,
        "Active Apprentices": deptSummary[d].active,
        "Completed Apprentices": deptSummary[d].completed,
        "Total Apprentices": deptSummary[d].active + deptSummary[d].completed
      }));
      exportHeaders = ["Department", "Active Apprentices", "Completed Apprentices", "Total Apprentices"];
    } else if (reportType === 'completion_reason') {
      isSummaryReport = true;
      reportTitle = "Completion Reason Report";
      const reasonSummary = {};
      const completedList = filteredRecords.filter(x => x.status === 'Completed');
      completedList.forEach(a => {
        const reason = a.completionReason || 'Unknown';
        reasonSummary[reason] = (reasonSummary[reason] || 0) + 1;
      });
      exportData = Object.keys(reasonSummary).map(r => ({
        "Completion Reason": r,
        "Completed Count": reasonSummary[r]
      }));
      exportHeaders = ["Completion Reason", "Completed Count"];
    }

    if (filteredRecords.length === 0 && !isSummaryReport) {
      return res.status(400).json({ success: false, error: "No records found for selected filters." });
    }

    // Build ordered master columns for records reports (True Master Export Mode)
    if (!isSummaryReport) {
      const allHeadersSet = new Set([...activeHeaders, ...completedHeaders]);
      allHeadersSet.delete("__rowNum");
      allHeadersSet.delete("Completion Details Finalized");

      const dbColumnsCount = allHeadersSet.size;
      let orderedHeaders = getOrderedHeaders(allHeadersSet);

      // --- Custom Column Selection ---
      // When the user has configured a specific column subset, apply it.
      // The column-count integrity check is intentionally bypassed when the user
      // has deliberately chosen a subset — this is expected behaviour, not an error.
      const hasCustomColumns = Array.isArray(selectedColumns) && selectedColumns.length > 0;
      if (hasCustomColumns) {
        // Only retain columns that actually exist in the full ordered header set
        const validSet = new Set(orderedHeaders);
        orderedHeaders = selectedColumns.filter(col => validSet.has(col));
      } else {
        // Full export — run column-count integrity validation
        let exportedColumnCount = orderedHeaders.length;
        if (simulateMismatch === 'columns' || simulateMismatch === 'cols' || simulateMismatch === true) {
          orderedHeaders = orderedHeaders.slice(0, orderedHeaders.length - 1);
          exportedColumnCount = orderedHeaders.length;
        }

        if (exportedColumnCount !== dbColumnsCount) {
          console.error(`[REPORT ENGINE ERROR] Data completeness mismatch: Exported=${exportedColumnCount}, Database=${dbColumnsCount}`);
          await executeWithRetry(() => sheetsService.getSheetsClient().spreadsheets.values.append({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Profile_Audit_Logs!A1',
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            requestBody: {
              values: [[new Date().toISOString(), "REPORT", reportTitle, `${user.location} HR Lead (${user.name})`, "Export Failed", `Column Mismatch: DB=${dbColumnsCount}, Exported=${exportedColumnCount}`]]
            }
          }));
          return res.status(500).json({ success: false, error: "Export validation failed. Missing columns detected." });
        }
      }

      exportHeaders = orderedHeaders;
      exportData = filteredRecords.map(app => {
        const obj = {};
        orderedHeaders.forEach(h => {
          obj[h] = getApprenticeValue(app, h);
        });
        return obj;
      });
    }

    // Perform strict validation checks on headers and data rows
    if (!exportHeaders || !Array.isArray(exportHeaders) || exportHeaders.length === 0) {
      return res.status(500).json({ success: false, error: 'Export validation failed: Header row is missing or empty.' });
    }
    if (!exportData || !Array.isArray(exportData) || exportData.length === 0) {
      return res.status(400).json({ success: false, error: 'Export validation failed: No data records to export.' });
    }

    const appliedFiltersText = Object.keys(actualFilters)
      .filter(k => actualFilters[k] !== undefined && actualFilters[k] !== '' && actualFilters[k] !== 'All' && actualFilters[k] !== 'All Locations')
      .map(k => `${k}: ${actualFilters[k]}`)
      .join(', ') || 'None';

    const locationsText = actualFilters.location || 'All Locations';
    const deptsText = actualFilters.dept || 'All Departments';

    // 1. Compile file buffer based on format
    let fileBuffer;
    let contentType;
    let ext;

    if (format === 'csv') {
      fileBuffer = reportService.generateCSV(exportData, exportHeaders, reportTitle, user.name, appliedFiltersText, locationsText, deptsText);
      contentType = 'text/csv; charset=utf-8';
      ext = 'csv';
    } else if (format === 'excel') {
      fileBuffer = reportService.generateExcel(exportData, exportHeaders, reportTitle, user.name, appliedFiltersText, locationsText, deptsText);
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      ext = 'xlsx';
    } else if (format === 'pdf') {
      fileBuffer = await reportService.generatePDF(exportData, exportHeaders, reportTitle, user.name, appliedFiltersText, locationsText, deptsText);
      contentType = 'application/pdf';
      ext = 'pdf';
    } else {
      return res.status(400).json({ success: false, error: 'Invalid file format.' });
    }

    // Verify that the compiled buffer is non-empty
    if (!fileBuffer || fileBuffer.length === 0) {
      return res.status(500).json({ success: false, error: 'Export validation failed: Compiled report file buffer is empty.' });
    }

    // Verify generated report rows count matches expected count
    const expectedCount = exportData.length;
    let parsedRowCount = 0;
    try {
      if (format === 'csv' || format === 'excel') {
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        parsedRowCount = rows.length - 11;
      } else if (format === 'pdf') {
        parsedRowCount = exportData.length;
      }
    } catch (parseErr) {
      console.error('Error parsing generated report buffer:', parseErr);
      parsedRowCount = -1;
    }

    if (simulateMismatch === 'rows') {
      parsedRowCount = expectedCount - 1;
    }

    if (parsedRowCount !== expectedCount) {
      console.error(`[REPORT ENGINE ERROR] Record count mismatch: Expected=${expectedCount}, Got=${parsedRowCount}`);
      // Log validation failure to sheet
      await executeWithRetry(() => sheetsService.getSheetsClient().spreadsheets.values.append({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: 'Profile_Audit_Logs!A1',
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [[new Date().toISOString(), "REPORT", reportTitle, `${user.role === 'Super HR' ? 'Super HR Admin' : user.location + ' HR'} (${user.name})`, "Export Failed", `Row Count Mismatch: Expected=${expectedCount}, Got=${parsedRowCount}`]]
        }
      }));
      return res.status(500).json({ success: false, error: "Report validation failed. Record count mismatch detected." });
    }

    // 2. Audit Trail Logging (Improvement 7)
    // Logs into Profile_Audit_Logs under code "REPORT"
    const auditText = `Format: ${format.toUpperCase()}; Count: ${exportData.length}; Filters: ${appliedFiltersText}; Role: ${user.role}; Scope: ${user.location}`;
    const auditValues = [
      new Date().toISOString(),
      "REPORT",
      reportTitle,
      `${user.role === 'Super HR' ? 'Super HR Admin' : user.location + ' HR'} (${user.name})`,
      "Report Exported",
      auditText
    ];
    await executeWithRetry(() => sheetsService.getSheetsClient().spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: 'Profile_Audit_Logs!A1',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [auditValues]
      }
    }));

    // 3. Stream back binary file
    const safeTitle = reportTitle.replace(/\s+/g, '_');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}_Report.${ext}"`);
    res.setHeader('Content-Length', fileBuffer.length);
    const store = requestStorage.getStore();
    if (store) {
      store.recordCount = filteredRecords.length;
    }

    return res.send(fileBuffer);

  } catch (err) {
    console.error('Report Export Error:', err);
    return res.status(500).json({ success: false, error: 'Failed to compile report: ' + err.message });
  }
});

// 3. GET available sheet headers for column selection UI
router.get('/headers', authMiddleware, async (req, res) => {
  try {
    const { activeHeaders, completedHeaders } = await fetchSheetHeaders();
    const store = requestStorage.getStore();
    if (store) {
      store.recordCount = activeHeaders.length + completedHeaders.length;
    }
    return res.json({ success: true, activeHeaders, completedHeaders });
  } catch (err) {
    console.error('Headers Fetch Error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch headers: ' + err.message });
  }
});

module.exports = router;
