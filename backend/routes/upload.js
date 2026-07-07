const express = require('express');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const sheetsService = require('../services/sheetsService');
const authMiddleware = require('../middleware/auth');
const analyticsCache = require('../services/analyticsCache');

const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 20 * 1024 * 1024 } // Reject uploads > 20 MB (Multer limit)
});

// Helper to check standard fields for robust header validation
const KNOWN_STD_NORMALIZED = [
  'fullname', 'employeename', 'name', 'candidatefullname', 'candidatename',
  'location', 'branch', 'worklocation', 'factorylocation',
  'department', 'dept', 'vertical',
  'joiningdate', 'joined', 'doj', 'hiredate', 'businessdoj', 'groupdoj',
  'sex', 'gender', 'age',
  'phone', 'mobile', 'phonenumber', 'personalmobile',
  'email', 'personalemailid', 'officialmailid'
];

// 1. GET upload history logs
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const logs = await sheetsService.getUploadAuditLogs();
    return res.json({ success: true, logs });
  } catch (err) {
    console.error('Fetch Upload Logs Error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch upload history logs.' });
  }
});

router.post('/', authMiddleware, (req, res, next) => {
  const isJson = req.headers['content-type'] && req.headers['content-type'].includes('application/json');
  if (isJson) {
    return next();
  }
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, error: 'File size limit exceeded. The maximum allowed size is 20MB.' });
      }
      return res.status(400).json({ success: false, error: `File upload error: ${err.message}` });
    } else if (err) {
      return res.status(500).json({ success: false, error: `Server error during upload: ${err.message}` });
    }
    next();
  });
}, async (req, res) => {
  const file = req.file;
  const user = req.user;
  const dryRun = req.query.dryRun === 'true' || req.query.dryRun === true;

  // Only Super HR accounts can trigger imports
  if (user.role !== 'Super HR') {
    return res.status(403).json({ success: false, error: 'Permission denied. Only Super HR can upload apprentice lists.' });
  }

  try {
    let parsedRecords = [];
    let originalName = 'JSON Payload';

    if (file) {
      originalName = file.originalname;

      // 1. Strict File extension check
      const ext = originalName.split('.').pop().toLowerCase();
      if (!['xlsx', 'xls', 'csv'].includes(ext)) {
        return res.status(400).json({ success: false, error: 'Invalid file format. Only .xlsx, .xls, and .csv files are supported.' });
      }

      // 2. Read sheet workbook bytes & check for corruption
      let workbook;
      try {
        workbook = xlsx.read(file.buffer, { type: 'buffer', cellDates: true, cellNF: true, cellText: true });
      } catch (err) {
        return res.status(400).json({ success: false, error: 'The uploaded file is corrupt or could not be parsed as an Excel workbook.' });
      }

      if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
        return res.status(400).json({ success: false, error: 'The uploaded workbook contains no worksheets or is corrupt.' });
      }

      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      
      if (!sheet || !sheet['!ref']) {
        return res.status(400).json({ success: false, error: 'The first worksheet is empty or invalid.' });
      }

      const range = xlsx.utils.decode_range(sheet['!ref']);
      let headerRowIndex = -1;
      let rawHeaders = [];

      // 3. Automatically locate the header row (Scan first 20 rows)
      for (let r = range.s.r; r <= Math.min(range.e.r, 20); r++) {
        const rowValues = [];
        let hasEmployeeCode = false;
        let hasOtherStdHeader = false;

        for (let c = range.s.c; c <= range.e.c; c++) {
          const cellRef = xlsx.utils.encode_cell({ r, c });
          const cell = sheet[cellRef];
          const val = cell ? String(cell.v).trim() : "";
          rowValues.push(val);

          const norm = val.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/_?\d+$/, '');
          // Check Employee Code aliases
          if (['employeecode', 'code', 'employeeid', 'empid', 'empcode', 'employeeno', 'empno'].includes(norm)) {
            hasEmployeeCode = true;
          }
          // Check other known standard headers
          if (KNOWN_STD_NORMALIZED.includes(norm)) {
            hasOtherStdHeader = true;
          }
        }

        // Header condition: must have Employee Code AND at least one other standard header AND at least 3 filled columns
        const filledCount = rowValues.filter(v => v !== "").length;
        if (hasEmployeeCode && hasOtherStdHeader && filledCount >= 3) {
          headerRowIndex = r;
          rawHeaders = rowValues;
          break;
        }
      }

      if (headerRowIndex === -1) {
        return res.status(400).json({ 
          success: false, 
          error: 'Failed to auto-detect a valid header row. The sheet must contain a column named "Employee Code" (or similar) and other apprentice fields.' 
        });
      }

      // 4. Make column headers unique and handle blank column names
      const headers = [];
      const seenHeaders = {};

      rawHeaders.forEach((h, index) => {
        let cleanH = String(h || "").trim();
        if (cleanH === "") {
          cleanH = `Column_${index + 1}`;
        }

        if (seenHeaders[cleanH] !== undefined) {
          seenHeaders[cleanH]++;
          headers.push(`${cleanH}_${seenHeaders[cleanH]}`);
        } else {
          seenHeaders[cleanH] = 1;
          headers.push(cleanH);
        }
      });

      // 5. Parse row data into objects (skipping empty rows)
      for (let r = headerRowIndex + 1; r <= range.e.r; r++) {
        const record = {};
        let isRowEmpty = true;

        headers.forEach((header, c) => {
          const cellRef = xlsx.utils.encode_cell({ r, c });
          const cell = sheet[cellRef];
          let val = "";
          
          if (cell !== undefined && cell !== null) {
            val = cell.v;
          }

          if (val !== undefined && val !== null && String(val).trim() !== "") {
            isRowEmpty = false;
          }
          record[header] = val;
        });

        if (!isRowEmpty) {
          record.__rowNum = r + 1; // 1-indexed row number in the Excel sheet
          parsedRecords.push(record);
        }
      }

    } else if (req.body && req.body.records && Array.isArray(req.body.records)) {
      // Support JSON payload
      originalName = req.body.fileName || 'JSON Payload';
      parsedRecords = req.body.records.map((rec, idx) => ({
        ...rec,
        __rowNum: rec.__rowNum || (idx + 1)
      }));
    } else {
      return res.status(400).json({ success: false, error: 'No file or records uploaded.' });
    }

    if (parsedRecords.length === 0) {
      return res.status(400).json({ success: false, error: 'The uploaded file contains no data rows.' });
    }

    // 6. Submit to database manager for reconciliation
    const updatedBy = `Super HR Admin (${user.name})`;
    console.log(`[DEBUG UPLOAD] Submitting ${parsedRecords.length} parsed records to sheetsService for file: ${originalName} (dryRun: ${dryRun})`);
    const report = await sheetsService.upsertActiveApprentices(parsedRecords, updatedBy, originalName, dryRun);
    console.log(`[DEBUG UPLOAD] Import outcome: Inserted=${report.inserted}, Updated=${report.updated}, DuplicatesRemoved=${report.duplicatesRemoved}, Rejected=${report.rejected.length}`);
    
    if (!dryRun) {
      analyticsCache.invalidate();
    }

    const responsePayload = {
      success: true,
      inserted: report.inserted,
      updated: report.updated,
      duplicatesRemoved: report.duplicatesRemoved,
      rejected: report.rejected,
      newColumnsCreated: report.newColumnsCreated,
      totalProcessed: report.totalProcessed,
      executionTime: report.executionTime,
      uploadSuccess: report.uploadSuccess,
      // Post-write integrity verification counts (Bug 2 fix)
      verifiedActiveCount: report.verifiedActiveCount,
      verifiedCompletedCount: report.verifiedCompletedCount,
      expectedActiveCount: report.expectedActiveCount,
      expectedCompletedCount: report.expectedCompletedCount
    };

    if (dryRun) {
      responsePayload.records = parsedRecords;
    }

    return res.json(responsePayload);

  } catch (err) {
    console.error('Upload route error:', err);
    // Sanitize error message to prevent leaking paths
    const sanitizedError = err.message.replace(/([a-zA-Z]:\\[\w\\\.-]+)/g, '[Internal Path]');
    return res.status(500).json({ success: false, error: 'Internal server error processing import: ' + sanitizedError });
  }
});

module.exports = router;
