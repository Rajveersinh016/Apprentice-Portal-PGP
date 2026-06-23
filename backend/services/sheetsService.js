const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config();

const spreadsheetId = process.env.SPREADSHEET_ID;
const keyPath = path.resolve(__dirname, '..', process.env.GOOGLE_APPLICATION_CREDENTIALS || './config/service-account.json');

let sheets;

// ============================================================
// CONCURRENCY CONTROL: MUTEX LOCK FOR SERIALIZING SHEET WRITES
// ============================================================
class Mutex {
  constructor() {
    this.queue = [];
    this.locked = false;
  }
  async acquire() {
    return new Promise((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve(() => this.release());
      } else {
        this.queue.push(resolve);
      }
    });
  }
  release() {
    if (this.queue.length > 0) {
      const nextResolve = this.queue.shift();
      nextResolve(() => this.release());
    } else {
      this.locked = false;
    }
  }
}
const dbMutex = new Mutex();

// ============================================================
// IN-MEMORY SERVER CACHE — shared across ALL concurrent users
// Eliminates redundant Google Sheets API calls.
// TTL: active/completed = 30s, users = 5min, audit = 60s
// Invalidated automatically on any write operation.
// ============================================================
const dataCache = {
  active:    { data: null, headers: null, ts: 0, isRefreshing: false },
  completed: { data: null, headers: null, ts: 0, isRefreshing: false },
  users:     { data: null, ts: 0, isRefreshing: false },
  audit:     { data: null, ts: 0, isRefreshing: false },
  TTL: {
    active:    300 * 1000,       // 5 minutes
    completed: 300 * 1000,       // 5 minutes
    users:     300 * 1000,       // 5 minutes
    audit:     60 * 1000         // 60 seconds
  }
};

function isCacheValid(key) {
  return dataCache[key].data !== null &&
         (Date.now() - dataCache[key].ts) < dataCache.TTL[key];
}

function invalidateDataCache() {
  dataCache.active.data    = null;
  dataCache.completed.data = null;
  dataCache.audit.data     = null;
  // Note: users cache NOT invalidated here (separate lifecycle)
  // console.log('sheetsService: Cache invalidated — next read will fetch fresh data from Google Sheets.');
}

async function triggerBackgroundRefresh(key) {
  if (dataCache[key].isRefreshing) return;
  dataCache[key].isRefreshing = true;

  try {
    const client = getSheetsClient();
    if (key === 'active') {
      const response = await executeWithRetry(() => client.spreadsheets.values.get({
        spreadsheetId,
        range: 'Active_Apprentices!A1:ZZ10000',
      }));
      const rawValues = response.data.values || [];
      if (rawValues.length > 0) {
        dataCache.active.headers = rawValues[0].map(h => String(h).trim());
      }
      dataCache.active.data = valuesToObjects(rawValues);
      dataCache.active.ts   = Date.now();
    } else if (key === 'completed') {
      const response = await executeWithRetry(() => client.spreadsheets.values.get({
        spreadsheetId,
        range: 'Completed_Apprentices!A1:ZZ10000',
      }));
      const rawValues = response.data.values || [];
      if (rawValues.length > 0) {
        dataCache.completed.headers = rawValues[0].map(h => String(h).trim());
      }
      dataCache.completed.data = valuesToObjects(rawValues);
      dataCache.completed.ts   = Date.now();
    } else if (key === 'users') {
      const result = await getSheetData('Users');
      dataCache.users.data = result;
      dataCache.users.ts   = Date.now();
    }
  } catch (err) {
    console.error(`sheetsService: Background refresh failed for ${key}:`, err.message);
  } finally {
    dataCache[key].isRefreshing = false;
  }
}

// ============================================================
// COLUMN NORMALIZATION & STANDARD ALIAS MAPPINGS
// ============================================================
const ALIASES = {
  'employeecode': 'Employee Code',
  'code': 'Employee Code',
  'empcode': 'Employee Code',
  'employeeid': 'Employee Code',
  'empid': 'Employee Code',
  'employeeno': 'Employee Code',
  'empno': 'Employee Code',
  
  'fullname': 'Full Name',
  'employeename': 'Full Name',
  'name': 'Full Name',
  'candidatefullname': 'Full Name',
  'candidatename': 'Full Name',
  
  'location': 'Location',
  'branch': 'Location',
  'worklocation': 'Location',
  'factorylocation': 'Location',
  
  'department': 'Department',
  'dept': 'Department',
  'vertical': 'Department',
  
  'joiningdate': 'Joining Date',
  'joined': 'Joining Date',
  'datejoined': 'Joining Date',
  'doj': 'Joining Date',
  'hiredate': 'Joining Date',
  'businessdoj': 'Joining Date',
  'groupdoj': 'Joining Date',
  
  'sex': 'Sex',
  'gender': 'Sex',
  
  'age': 'Age',
  
  'phone': 'Phone',
  'mobile': 'Phone',
  'phonenumber': 'Phone',
  'mobilenumber': 'Phone',
  'contactnumber': 'Phone',
  'personalmobile': 'Phone',
  'workphone': 'Phone',
  
  'email': 'Email',
  'emailaddress': 'Email',
  'contactemail': 'Email',
  'personalemailid': 'Email',
  'officialmailid': 'Email',
  
  'address': 'Address',
  'residentialaddress': 'Address',
  'locationaddress': 'Address',
  'plantaddress': 'Address',
  
  'remarks': 'Remarks',
  'comments': 'Remarks',
  'notes': 'Remarks',
  
  'employeecontractid': 'Employee Contract ID',
  'contractid': 'Employee Contract ID',
  'napscontractid': 'Employee Contract ID',
  'natscontractid': 'Employee Contract ID',
  
  'portalenrollmentnumber': 'Portal Enrollment Number',
  'enrollmentnumber': 'Portal Enrollment Number',
  'portalid': 'Portal Enrollment Number',
  'enrollmentid': 'Portal Enrollment Number',
  
  'portalname': 'Portal Name',
  'portalregisteredname': 'Portal Name',
  
  'status': 'Record Status',
  'employeestatus': 'Record Status',
  'recordstatus': 'Record Status',

  'completiondate': 'Completion Date',
  'completeddate': 'Completion Date',
  'completedby': 'Completed By',
  'completionreason': 'Completion Reason',
  'reasonforcompletion': 'Completion Reason',
  'othercompletionreason': 'Other Completion Reason',
  'completionremarks': 'Completion Remarks'
};

function getStandardHeaderName(header, existingHeaders = []) {
  if (!header) return "";
  const norm = String(header).toLowerCase().replace(/[^a-z0-9]/g, '').replace(/_?\d+$/, '');
  
  // 1. Check if it matches a predefined alias
  if (ALIASES[norm]) {
    return ALIASES[norm];
  }
  
  // 2. Check if it matches the normalized form of an existing sheet header
  for (const h of existingHeaders) {
    const hNorm = String(h).toLowerCase().replace(/[^a-z0-9]/g, '').replace(/_?\d+$/, '');
    if (norm === hNorm) {
      return h;
    }
  }
  
  // 3. Otherwise, return trimmed key as a new dynamic column
  return String(header).trim();
}

// ============================================================
// PRIORITY 4 — GOOGLE SHEETS API FAILOVER RETRY WITH EXPONENTIAL BACKOFF
// ============================================================
async function executeWithRetry(apiCallFn, maxRetries = 3) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await apiCallFn();
    } catch (err) {
      attempt++;
      console.error(`sheetsService: Google Sheets API call failed (Attempt ${attempt}/${maxRetries}):`, err.message);
      if (attempt >= maxRetries) {
        throw new Error(`Google Sheets database is temporarily unavailable. Details: ${err.message}`);
      }
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

function getSheetsClient() {
  if (sheets) return sheets;

  let credentials;
  if (process.env.GOOGLE_CREDS_JSON) {
    try {
      credentials = JSON.parse(process.env.GOOGLE_CREDS_JSON);
    } catch (err) {
      throw new Error("Invalid JSON in GOOGLE_CREDS_JSON environment variable.");
    }
  } else {
    if (!fs.existsSync(keyPath)) {
      throw new Error(`Google Sheets API credentials file not found at: ${keyPath}. Please configure your service-account.json file.`);
    }
    try {
      credentials = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    } catch (err) {
      throw new Error(`Invalid JSON format in credentials file: ${keyPath}`);
    }
  }

  if (credentials.project_id === 'YOUR_PROJECT_ID') {
    throw new Error(`Google Sheets credentials file is still using placeholders. Please paste your real service account credentials.`);
  }

  if (credentials && credentials.private_key) {
    credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  sheets = google.sheets({ version: 'v4', auth });
  return sheets;
}

function sanitizeCellValue(val) {
  if (val === undefined || val === null) return "";
  let str = String(val);
  // Formula Injection prevention: prepend single quote to escape formula triggers
  if (str.startsWith('=') || str.startsWith('+') || str.startsWith('-') || str.startsWith('@')) {
    str = "'" + str;
  }
  return str;
}

// Convert 2D sheet array to array of JSON objects based on headers
function valuesToObjects(values) {
  if (!values || values.length === 0) return [];
  const headers = values[0].map(h => String(h).trim());
  const objects = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = row[index] !== undefined ? row[index] : "";
    });
    obj.__rowNum = i + 1; // 1-indexed row number in the spreadsheet
    objects.push(obj);
  }
  return objects;
}

function objectsToValues(objects, headers) {
  const values = [headers];
  objects.forEach(obj => {
    const row = headers.map(header => {
      const val = obj[header];
      return sanitizeCellValue(val);
    });
    values.push(row);
  });
  return values;
}

// Convert column index (1-based) to letter (e.g. 1 -> A, 27 -> AA)
function getColumnLetter(colIndex) {
  let temp;
  let letter = '';
  while (colIndex > 0) {
    temp = (colIndex - 1) % 26;
    letter = String.fromCharCode(65 + temp) + letter;
    colIndex = (colIndex - temp - 1) / 26;
  }
  return letter || 'A';
}

// Ensure all database tabs exist (Internal Helper, NO Mutex)
async function ensureSheetsExistInternal() {
  const client = getSheetsClient();
  const metadata = await executeWithRetry(() => client.spreadsheets.get({ spreadsheetId }));
  const sheetNames = metadata.data.sheets.map(s => s.properties.title);
  
  const requiredSheets = [
    { name: 'Users', headers: ["UserID", "Name", "Email", "PasswordHash", "Role", "Location", "Status", "CreatedDate"] },
    { name: 'Active_Apprentices', headers: [
        "Employee Code", "Full Name", "Location", "Department", "Joining Date", 
        "Sex", "Age", "Phone", "Email", "Address", "Remarks", 
        "Employee Contract ID", "Portal Enrollment Number", "Portal Name", 
        "Record Status", "Updated By", "Updated Date"
      ] 
    },
    { name: 'Completed_Apprentices', headers: [
        "Employee Code", "Full Name", "Location", "Department", "Joining Date", 
        "Sex", "Age", "Phone", "Email", "Address", "Remarks", 
        "Employee Contract ID", "Portal Enrollment Number", "Portal Name", 
        "Completion Date", "Completed By", "Completion Reason", "Other Completion Reason", "Completion Remarks"
      ] 
    },
    { name: 'AuditLogs', headers: [
        "Upload Time", "Uploaded By", "File Name", "Inserted", "Updated", 
        "Rejected", "Duplicates Removed", "New Columns Created", "Execution Duration"
      ]
    },
    { name: 'Profile_Audit_Logs', headers: [
        "Timestamp", "Employee Code", "Employee Name", "Updated By", "Action", "Changes"
      ]
    }
  ];

  for (const req of requiredSheets) {
    if (!sheetNames.includes(req.name)) {
      await executeWithRetry(() => client.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: { title: req.name }
            }
          }]
        }
      }));
      await executeWithRetry(() => client.spreadsheets.values.update({
        spreadsheetId,
        range: `${req.name}!A1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [req.headers]
        }
      }));
    } else {
      // Sheet exists, verify and repair missing columns
      try {
        const response = await executeWithRetry(() => client.spreadsheets.values.get({
          spreadsheetId,
          range: `${req.name}!1:1`,
        }));
        const existingHeaders = response.data.values && response.data.values[0]
          ? response.data.values[0].map(h => String(h).trim())
          : [];
        
        const missingHeaders = req.headers.filter(h => !existingHeaders.includes(h));
        if (missingHeaders.length > 0) {
          const updatedHeaders = [...existingHeaders, ...missingHeaders];
          await executeWithRetry(() => client.spreadsheets.values.update({
            spreadsheetId,
            range: `${req.name}!A1:${getColumnLetter(updatedHeaders.length)}1`,
            valueInputOption: 'RAW',
            requestBody: {
              values: [updatedHeaders]
            }
          }));
        }
      } catch (err) {
        console.error(`sheetsService: Error verifying headers for ${req.name}:`, err.message);
      }
    }
  }
}

// Read all rows from a tab (Internal Helper, NO Mutex)
async function getSheetData(sheetName) {
  const client = getSheetsClient();
  try {
    const response = await executeWithRetry(() => client.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A1:ZZ10000`,
    }));
    return valuesToObjects(response.data.values);
  } catch (err) {
    console.error(`sheetsService: Error reading ${sheetName}:`, err.message);
    throw err;
  }
}

// ============================================================
// PUBLIC API METHODS (ALL SAFE WITH MUTEX LOCKS)
// ============================================================

async function ensureSheetsExist() {
  const release = await dbMutex.acquire();
  try {
    await ensureSheetsExistInternal();
  } finally {
    release();
  }
}

async function getAllUsers() {
  if (dataCache.users.data !== null) {
    const age = Date.now() - dataCache.users.ts;
    if (age >= 240 * 1000) {
      triggerBackgroundRefresh('users').catch(err => console.error("Background users refresh error:", err.message));
    }
    return dataCache.users.data;
  }
  const release = await dbMutex.acquire();
  try {
    const result = await getSheetData('Users');
    dataCache.users.data = result;
    dataCache.users.ts   = Date.now();
    return result;
  } finally {
    release();
  }
}

async function saveUsers(users) {
  const release = await dbMutex.acquire();
  try {
    const client = getSheetsClient();
    
    const headers = ["UserID", "Name", "Email", "PasswordHash", "Role", "Location", "Status", "CreatedDate"];
    const rows = [headers];
    
    users.forEach(u => {
      rows.push([
        sanitizeCellValue(u.UserID || u.id),
        sanitizeCellValue(u.Name || ""),
        sanitizeCellValue(u.Email || ""),
        sanitizeCellValue(u.PasswordHash || ""),
        sanitizeCellValue(u.Role || ""),
        sanitizeCellValue(u.Location || ""),
        sanitizeCellValue(u.Status || "Active"),
        sanitizeCellValue(u.CreatedDate || new Date().toISOString().split('T')[0])
      ]);
    });

    await executeWithRetry(() => client.spreadsheets.values.update({
      spreadsheetId,
      range: 'Users!A1:H1000',
      valueInputOption: 'RAW',
      requestBody: {
        values: rows
      }
    }));

    // Invalidate users cache after write
    dataCache.users.data = null;
  } finally {
    release();
  }
}

// Read-only: NO mutex needed — cache-aware, safe for concurrent access
// Read-only: NO mutex needed — cache-aware, safe for concurrent access
async function getActiveApprentices() {
  if (dataCache.active.data !== null) {
    const age = Date.now() - dataCache.active.ts;
    if (age >= 240 * 1000) {
      triggerBackgroundRefresh('active').catch(err => console.error("Background active refresh error:", err.message));
    }
    return dataCache.active.data;
  }

  const client = getSheetsClient();
  try {
    const response = await executeWithRetry(() => client.spreadsheets.values.get({
      spreadsheetId,
      range: 'Active_Apprentices!A1:ZZ10000',
    }));
    const rawValues = response.data.values || [];
    if (rawValues.length > 0) {
      dataCache.active.headers = rawValues[0].map(h => String(h).trim());
    }
    dataCache.active.data = valuesToObjects(rawValues);
    dataCache.active.ts   = Date.now();
    return dataCache.active.data;
  } catch (err) {
    console.error('sheetsService: Error reading Active_Apprentices:', err.message);
    throw err;
  }
}

// Read-only: NO mutex needed — cache-aware, safe for concurrent access
async function getCompletedApprentices() {
  if (dataCache.completed.data !== null) {
    const age = Date.now() - dataCache.completed.ts;
    if (age >= 240 * 1000) {
      triggerBackgroundRefresh('completed').catch(err => console.error("Background completed refresh error:", err.message));
    }
    return dataCache.completed.data;
  }

  const client = getSheetsClient();
  try {
    const response = await executeWithRetry(() => client.spreadsheets.values.get({
      spreadsheetId,
      range: 'Completed_Apprentices!A1:ZZ10000',
    }));
    const rawValues = response.data.values || [];
    if (rawValues.length > 0) {
      dataCache.completed.headers = rawValues[0].map(h => String(h).trim());
    }
    dataCache.completed.data = valuesToObjects(rawValues);
    dataCache.completed.ts   = Date.now();
    return dataCache.completed.data;
  } catch (err) {
    console.error('sheetsService: Error reading Completed_Apprentices:', err.message);
    throw err;
  }
}

async function getActiveHeaders() {
  if (dataCache.active.headers !== null) {
    return dataCache.active.headers;
  }
  await getActiveApprentices();
  return dataCache.active.headers || [];
}

async function getCompletedHeaders() {
  if (dataCache.completed.headers !== null) {
    return dataCache.completed.headers;
  }
  await getCompletedApprentices();
  return dataCache.completed.headers || [];
}

async function updateApprentice(code, fields, updatedBy) {
  const release = await dbMutex.acquire();
  try {
    const client = getSheetsClient();

    // Use cached data — fast if warm, fetches fresh if stale
    const activeRecords = await getActiveApprentices();
    const existing = activeRecords.find(r => String(r["Employee Code"]).trim() === String(code).trim());
    
    if (!existing) {
      throw new Error(`Active apprentice with Employee Code ${code} not found.`);
    }

    const rowNum = existing.__rowNum;
    // Use cached headers — eliminates a separate header API call
    const headers = dataCache.active.headers || [];
    if (headers.length === 0) throw new Error('Could not determine Active_Apprentices column headers.');

    const nowStr = new Date().toISOString().split('T')[0];
    const oldRecord = { ...existing };
    const changedFields = [];

    for (const key in fields) {
      if (headers.includes(key)) {
        const oldVal = oldRecord[key] !== undefined ? String(oldRecord[key]).trim() : "";
        const newVal = fields[key] !== undefined ? String(fields[key]).trim() : "";
        if (oldVal !== newVal) {
          changedFields.push(`${key}: "${oldVal}" -> "${newVal}"`);
          existing[key] = fields[key];
        }
      }
    }

    // Write to active apprentices sheet if fields actually changed
    existing["Updated Date"] = nowStr;
    existing["Updated By"] = updatedBy;

    const rowValues = headers.map(h => existing[h] !== undefined ? existing[h] : "");

    await executeWithRetry(() => client.spreadsheets.values.update({
      spreadsheetId,
      range: `Active_Apprentices!A${rowNum}:${getColumnLetter(headers.length)}${rowNum}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [rowValues]
      }
    }));

    if (changedFields.length > 0) {
      const changesText = changedFields.join('; ');
      await logProfileEditInternal(client, code, existing["Full Name"] || existing["Employee Code"] || "", updatedBy, "Profile Update", changesText);
    }

    // Invalidate cache — next read will fetch fresh data
    invalidateDataCache();
  } finally {
    release();
  }
}

async function completeApprentice(code, completedBy, reason, otherReason, remarks) {
  const release = await dbMutex.acquire();
  try {
    const client = getSheetsClient();

    // Use cached data — warm both caches to get headers for both sheets
    const activeRecords = await getActiveApprentices();
    await getCompletedApprentices(); // ensures completed headers are cached

    const recordToMove = activeRecords.find(r => String(r["Employee Code"]).trim() === String(code).trim());
    if (!recordToMove) {
      throw new Error(`Active apprentice with Employee Code ${code} not found.`);
    }

    const rowNum = recordToMove.__rowNum;

    // Use cached headers — eliminates 2 separate header API calls
    const activeHeaders = dataCache.active.headers || [];
    if (activeHeaders.length === 0) throw new Error('Could not determine Active_Apprentices column headers.');
    let completedHeaders = dataCache.completed.headers || [];

    if (completedHeaders.length === 0) {
      completedHeaders = activeHeaders.filter(h => h !== "Record Status" && h !== "Updated By" && h !== "Updated Date");
      completedHeaders.push("Completion Date", "Completed By", "Completion Reason", "Other Completion Reason", "Completion Remarks");
      await executeWithRetry(() => client.spreadsheets.values.update({
        spreadsheetId,
        range: 'Completed_Apprentices!A1',
        valueInputOption: 'RAW',
        requestBody: {
          values: [completedHeaders]
        }
      }));
    } else {
      // Check for missing completion reason, other completion reason and remarks headers, and add them if missing
      const missingCompHeaders = [];
      if (!completedHeaders.includes("Completion Reason")) missingCompHeaders.push("Completion Reason");
      if (!completedHeaders.includes("Other Completion Reason")) missingCompHeaders.push("Other Completion Reason");
      if (!completedHeaders.includes("Completion Remarks")) missingCompHeaders.push("Completion Remarks");
      
      if (missingCompHeaders.length > 0) {
        completedHeaders = [...completedHeaders, ...missingCompHeaders];
        await executeWithRetry(() => client.spreadsheets.values.update({
          spreadsheetId,
          range: `Completed_Apprentices!A1:${getColumnLetter(completedHeaders.length)}1`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [completedHeaders]
          }
        }));
      }
    }

    const nowStr = new Date().toISOString().split('T')[0];
    const completedValues = completedHeaders.map(header => {
      if (header === "Completion Date") return nowStr;
      if (header === "Completed By") return completedBy;
      if (header === "Completion Reason") return reason || "";
      if (header === "Other Completion Reason") return otherReason || "";
      if (header === "Completion Remarks") return remarks || "";
      return recordToMove[header] !== undefined ? recordToMove[header] : "";
    });

    // 1. Append to Completed_Apprentices
    await executeWithRetry(() => client.spreadsheets.values.append({
      spreadsheetId,
      range: 'Completed_Apprentices!A1',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [completedValues]
      }
    }));

    // 1b. Write audit log entry
    const auditChanges = [
      `Reason: ${reason}`,
      reason === 'Other' ? `Other Reason: ${otherReason}` : null,
      `Remarks: ${remarks}`
    ].filter(Boolean).join('; ');
    await logProfileEditInternal(client, code, recordToMove["Full Name"] || recordToMove["Employee Code"] || "", completedBy, "Apprenticeship Completed", auditChanges);

    // 2. Delete row from Active_Apprentices
    const metadata = await executeWithRetry(() => client.spreadsheets.get({ spreadsheetId }));
    const sheetObj = metadata.data.sheets.find(s => s.properties.title === 'Active_Apprentices');
    if (!sheetObj) throw new Error(`Sheet Active_Apprentices not found.`);
    const sheetId = sheetObj.properties.sheetId;

    await executeWithRetry(() => client.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: sheetId,
                dimension: 'ROWS',
                startIndex: rowNum - 1, // 0-based, inclusive
                endIndex: rowNum // 0-based, exclusive
              }
            }
          }
        ]
      }
    }));

    // Invalidate cache — completion moves record between sheets
    invalidateDataCache();
  } finally {
    release();
  }
}

// ============================================================
// PERFORMANCE OPTIMIZATION: BATCH OVERWRITE MERGE SYSTEM
// ============================================================
async function upsertActiveApprentices(incomingRecords, updatedBy, fileName, dryRun = false) {
  const release = await dbMutex.acquire();
  const startTime = Date.now();
  try {
    const client = getSheetsClient();

    // 1. Load active and completed sheets — use cache if warm (eliminates 2-4 redundant API calls)
    const activeRaw = await getActiveApprentices();
    const completedRaw = await getCompletedApprentices();

    // Use cached headers — eliminates 2 additional header-only API calls
    let activeHeaders = dataCache.active.headers || [];
    if (activeHeaders.length === 0) throw new Error('Could not determine Active_Apprentices headers.');
    let completedHeaders = dataCache.completed.headers || [];

    if (completedHeaders.length === 0) {
      completedHeaders = activeHeaders.filter(h => h !== "Record Status" && h !== "Updated By" && h !== "Updated Date");
      completedHeaders.push("Completion Date", "Completed By", "Completion Reason", "Other Completion Reason", "Completion Remarks");
    }

    // 2. Identify new columns and perform schema expansion
    const newKeys = [];
    incomingRecords.forEach(record => {
      Object.keys(record).forEach(key => {
        if (key.startsWith('__')) return;
        const stdHeader = getStandardHeaderName(key, activeHeaders);
        if (stdHeader && !activeHeaders.includes(stdHeader) && !newKeys.includes(stdHeader)) {
          newKeys.push(stdHeader);
        }
      });
    });

    if (newKeys.length > 0) {
      // console.log(`sheetsService: Dynamically expanding schema with: ${newKeys.join(', ')}`);
      activeHeaders = [...activeHeaders, ...newKeys];
      if (!dryRun) {
        await executeWithRetry(() => client.spreadsheets.values.update({
          spreadsheetId,
          range: `Active_Apprentices!A1:${getColumnLetter(activeHeaders.length)}1`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [activeHeaders]
          }
        }));
      }

      // Expand Completed_Apprentices headers
      let insertIdx = completedHeaders.indexOf("Completion Date");
      if (insertIdx === -1) insertIdx = completedHeaders.indexOf("Completed By");
      if (insertIdx === -1) insertIdx = completedHeaders.length;

      completedHeaders = [
        ...completedHeaders.slice(0, insertIdx),
        ...newKeys,
        ...completedHeaders.slice(insertIdx)
      ];

      if (!dryRun) {
        await executeWithRetry(() => client.spreadsheets.values.update({
          spreadsheetId,
          range: `Completed_Apprentices!A1:${getColumnLetter(completedHeaders.length)}1`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [completedHeaders]
          }
        }));
      }
    }

    // 3. Setup index maps for reconciliation (normalized lowercase keys for robust matching)
    const normalizeCodeVal = (val) => {
      if (val === undefined || val === null) return "";
      return String(val).trim().toLowerCase();
    };

    const activeMap = new Map();
    const activeContractMap = new Map();
    const activeEnrollmentMap = new Map();

    activeRaw.forEach(r => {
      const code = normalizeCodeVal(r["Employee Code"]);
      if (code) activeMap.set(code, r);

      const contract = normalizeCodeVal(r["Employee Contract ID"]);
      if (contract && contract !== "pending" && contract !== "null") {
        activeContractMap.set(contract, r);
      }

      const enrollment = normalizeCodeVal(r["Portal Enrollment Number"]);
      if (enrollment && enrollment !== "pending" && enrollment !== "null") {
        activeEnrollmentMap.set(enrollment, r);
      }
    });

    const completedMap = new Map();
    const completedContractMap = new Map();
    const completedEnrollmentMap = new Map();

    completedRaw.forEach(r => {
      const code = normalizeCodeVal(r["Employee Code"]);
      if (code) completedMap.set(code, r);

      const contract = normalizeCodeVal(r["Employee Contract ID"]);
      if (contract && contract !== "pending" && contract !== "null") {
        completedContractMap.set(contract, r);
      }

      const enrollment = normalizeCodeVal(r["Portal Enrollment Number"]);
      if (enrollment && enrollment !== "pending" && enrollment !== "null") {
        completedEnrollmentMap.set(enrollment, r);
      }
    });

    let insertedCount = 0;
    let updatedCount = 0;
    let duplicatesRemovedCount = 0;
    const rejectedList = [];
    const seenCodesInBatch = new Set();
    const nowStr = new Date().toISOString().split('T')[0];

    console.log(`[DEBUG UPLOAD] Starting reconciliation for filename: ${fileName}. Active db records: ${activeRaw.length}, Completed db records: ${completedRaw.length}`);

    // 4. Reconcile records in memory
    incomingRecords.forEach((incoming, idx) => {
      // Resolve all incoming fields into standard headers
      const resolved = {};
      Object.keys(incoming).forEach(k => {
        if (k.startsWith('__')) return; // skip system properties
        const std = getStandardHeaderName(k, activeHeaders);
        if (!std) return;
        const val = incoming[k];
        const cleanVal = val !== undefined && val !== null ? String(val).trim() : "";

        // If we don't have a value for this standard header, or the new value is non-empty, use it!
        if (resolved[std] === undefined || resolved[std] === "") {
          resolved[std] = val;
        } else if (cleanVal !== "") {
          resolved[std] = val; // prioritize non-empty values
        }
      });

      const rawCode = resolved["Employee Code"] ? String(resolved["Employee Code"]).trim() : "";
      const normCode = rawCode.toLowerCase();
      const rawName = resolved["Full Name"] ? String(resolved["Full Name"]).trim() : "";
      const excelRow = incoming.__rowNum || (idx + 3);

      const rawContract = resolved["Employee Contract ID"] ? String(resolved["Employee Contract ID"]).trim() : "";
      const normContract = rawContract.toLowerCase();

      const rawEnrollment = resolved["Portal Enrollment Number"] ? String(resolved["Portal Enrollment Number"]).trim() : "";
      const normEnrollment = rawEnrollment.toLowerCase();

      // Validation
      if (!rawCode || !rawName) {
        rejectedList.push({
          row: excelRow,
          code: rawCode || "N/A",
          name: rawName || "N/A",
          reason: !rawCode ? "Missing Employee Code" : "Missing Full Name / Employee Name"
        });
        console.warn(`[DEBUG UPLOAD] Row ${excelRow} rejected: Missing Code or Name`);
        return;
      }

      // De-duplication in uploaded file batch using normalized code
      if (seenCodesInBatch.has(normCode)) {
        duplicatesRemovedCount++;
        // Merge newest values on top of previously processed record in this batch
        const existing = activeMap.get(normCode) || completedMap.get(normCode);
        if (existing) {
          Object.keys(resolved).forEach(std => {
            if (std && std !== "Employee Contract ID" && std !== "Portal Enrollment Number" && std !== "Portal Name" && std !== "Remarks") {
              existing[std] = resolved[std] !== undefined && resolved[std] !== null ? String(resolved[std]) : existing[std];
            }
          });
        }
        return;
      }
      seenCodesInBatch.add(normCode);

      // Reconcile against database sheets using case-insensitive primary/secondary matching
      let existingActive = activeMap.get(normCode);
      if (!existingActive && normContract && normContract !== "pending" && normContract !== "null") {
        existingActive = activeContractMap.get(normContract);
      }
      if (!existingActive && normEnrollment && normEnrollment !== "pending" && normEnrollment !== "null") {
        existingActive = activeEnrollmentMap.get(normEnrollment);
      }

      let existingCompleted = completedMap.get(normCode);
      if (!existingCompleted && normContract && normContract !== "pending" && normContract !== "null") {
        existingCompleted = completedContractMap.get(normContract);
      }
      if (!existingCompleted && normEnrollment && normEnrollment !== "pending" && normEnrollment !== "null") {
        existingCompleted = completedEnrollmentMap.get(normEnrollment);
      }

      const originallyActive = !!existingActive;
      const originallyCompleted = !!existingCompleted;

      // Determine target status: check if Excel sheet explicitly requests Completed/Active
      const incomingStatusVal = resolved["Record Status"] ? String(resolved["Record Status"]).trim().toLowerCase() : "";
      let shouldBeCompleted = originallyCompleted;
      if (!originallyCompleted) {
        if (incomingStatusVal === "completed" || incomingStatusVal === "complete" || incomingStatusVal === "inactive") {
          shouldBeCompleted = true;
        } else if (incomingStatusVal === "active") {
          shouldBeCompleted = false;
        }
      }

      const targetMap = shouldBeCompleted ? completedMap : activeMap;
      const existing = existingActive || existingCompleted;

      // If record is transitioning to Completed, delete it from the Active map
      if (originallyActive && shouldBeCompleted) {
        const activeKey = normalizeCodeVal(existingActive["Employee Code"]);
        if (activeKey) {
          activeMap.delete(activeKey);
        }
      }
      // If record is transitioning to Active, delete it from the Completed map
      if (originallyCompleted && !shouldBeCompleted) {
        const completedKey = normalizeCodeVal(existingCompleted["Employee Code"]);
        if (completedKey) {
          completedMap.delete(completedKey);
        }
      }

      const merged = existing ? { ...existing } : {};

      // Merge resolved fields
      Object.keys(resolved).forEach(std => {
        if (std === "Employee Contract ID" || std === "Portal Enrollment Number" || std === "Portal Name" || std === "Remarks") {
          // Manual HR Field preservation policy
          const extVal = existing ? existing[std] : "";
          const incVal = resolved[std];
          
          const cleanExt = String(extVal || "").trim();
          const cleanInc = String(incVal || "").trim();

          if (cleanExt !== "" && cleanExt.toLowerCase() !== "pending" && cleanExt.toLowerCase() !== "null") {
            merged[std] = extVal; // Preserve existing
          } else {
            merged[std] = cleanInc !== "" ? incVal : (std === "Remarks" ? "" : "Pending"); // Populate new
          }
        } else if (std === "Record Status") {
          merged[std] = shouldBeCompleted ? "Completed" : "Active";
        } else if (std === "Updated By") {
          merged[std] = updatedBy;
        } else if (std === "Updated Date") {
          merged[std] = nowStr;
        } else if (std === "Employee Code" && existing) {
          // Preserve original case/format of Employee Code in sheet
          merged[std] = existing[std];
        } else {
          // Excel-sourced field
          merged[std] = resolved[std] !== undefined && resolved[std] !== null ? String(resolved[std]) : (existing ? existing[std] : "");
        }
      });

      // Populate and default completion details if completing program
      if (shouldBeCompleted) {
        if (!merged["Completion Date"]) {
          merged["Completion Date"] = resolved["Completion Date"] || (existing ? existing["Completion Date"] : "") || nowStr;
        }
        if (!merged["Completed By"]) {
          merged["Completed By"] = resolved["Completed By"] || (existing ? existing["Completed By"] : "") || updatedBy;
        }
        if (!merged["Completion Reason"]) {
          merged["Completion Reason"] = resolved["Completion Reason"] || (existing ? existing["Completion Reason"] : "") || "Bulk Excel Import";
        }
        if (!merged["Other Completion Reason"]) {
          merged["Other Completion Reason"] = resolved["Other Completion Reason"] || (existing ? existing["Other Completion Reason"] : "") || "";
        }
        if (!merged["Completion Remarks"]) {
          merged["Completion Remarks"] = resolved["Completion Remarks"] || (existing ? existing["Completion Remarks"] : "") || "Completed via bulk excel import";
        }
      }

      // Default values for missing schema keys
      const targetHeaders = shouldBeCompleted ? completedHeaders : activeHeaders;
      targetHeaders.forEach(std => {
        if (merged[std] === undefined) {
          if (std === "Employee Contract ID" || std === "Portal Enrollment Number" || std === "Portal Name") {
            merged[std] = "Pending";
          } else if (std === "Record Status") {
            merged[std] = shouldBeCompleted ? "Completed" : "Active";
          } else {
            merged[std] = "";
          }
        }
      });

      if (existing) {
        targetMap.set(normCode, merged);
        
        let hasChanges = false;
        const targetHeaders = shouldBeCompleted ? completedHeaders : activeHeaders;
        const ignoreKeys = ["Updated By", "Updated Date", "Completion Date", "Completed By", "Completion Reason", "Other Completion Reason", "Completion Remarks"];
        
        for (const header of targetHeaders) {
          if (ignoreKeys.includes(header)) continue;
          const oldVal = existing[header] !== undefined ? String(existing[header]).trim() : "";
          const newVal = merged[header] !== undefined ? String(merged[header]).trim() : "";
          if (oldVal !== newVal) {
            hasChanges = true;
            break;
          }
        }

        if (hasChanges) {
          updatedCount++;
        }
      } else {
        targetMap.set(normCode, merged);
        insertedCount++;
      }
    });

    // 5. Batch update spreadsheet tabs (Writing in-place and clearing stale rows only)
    const finalActiveList = Array.from(activeMap.values());
    const activeValues = objectsToValues(finalActiveList, activeHeaders);

    if (!dryRun) {
      await executeWithRetry(() => client.spreadsheets.values.update({
        spreadsheetId,
        range: `Active_Apprentices!A1:${getColumnLetter(activeHeaders.length)}${finalActiveList.length + 1}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: activeValues
        }
      }));

      if (activeRaw.length > finalActiveList.length) {
        await executeWithRetry(() => client.spreadsheets.values.clear({
          spreadsheetId,
          range: `Active_Apprentices!A${finalActiveList.length + 2}:ZZ${activeRaw.length + 1}`
        }));
      }
    }

    const finalCompletedList = Array.from(completedMap.values());
    const completedValues = objectsToValues(finalCompletedList, completedHeaders);

    if (!dryRun) {
      await executeWithRetry(() => client.spreadsheets.values.update({
        spreadsheetId,
        range: `Completed_Apprentices!A1:${getColumnLetter(completedHeaders.length)}${finalCompletedList.length + 1}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: completedValues
        }
      }));

      if (completedRaw.length > finalCompletedList.length) {
        await executeWithRetry(() => client.spreadsheets.values.clear({
          spreadsheetId,
          range: `Completed_Apprentices!A${finalCompletedList.length + 2}:ZZ${completedRaw.length + 1}`
        }));
      }
    }

    // 6. Write detailed record to AuditLogs sheet
    const duration = Date.now() - startTime;
    const timeStr = new Date().toISOString().replace('T', ' ').substring(0, 16);
    
    const logRow = [
      timeStr,
      updatedBy,
      fileName || "Unknown File",
      insertedCount,
      updatedCount,
      rejectedList.length,
      duplicatesRemovedCount,
      newKeys.join(', ') || "None",
      duration + "ms"
    ];

    if (!dryRun) {
      await executeWithRetry(() => client.spreadsheets.values.append({
        spreadsheetId,
        range: 'AuditLogs!A1',
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [logRow]
        }
      }));

      // Invalidate cache — bulk upload changes both sheets
      invalidateDataCache();
    }

    return {
      inserted: insertedCount,
      updated: updatedCount,
      duplicatesRemoved: duplicatesRemovedCount,
      rejected: rejectedList,
      newColumnsCreated: newKeys,
      totalProcessed: incomingRecords.length,
      executionTime: duration + "ms",
      uploadSuccess: true
    };

  } catch (err) {
    console.error("sheetsService: Error during upsertActiveApprentices:", err);
    throw err;
  } finally {
    release();
  }
}

async function logProfileEditInternal(client, code, name, updatedBy, action, changes) {
  const timestamp = new Date().toISOString();
  const values = [timestamp, code, name, updatedBy, action, changes];
  await executeWithRetry(() => client.spreadsheets.values.append({
    spreadsheetId,
    range: 'Profile_Audit_Logs!A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [values]
    }
  }));
}

async function getProfileAuditLogs(code) {
  // Use audit log cache (60s TTL) — avoids re-fetching when viewing multiple profiles
  let rows;
  if (isCacheValid('audit')) {
    rows = dataCache.audit.data;
  } else {
    const release = await dbMutex.acquire();
    try {
      const client = getSheetsClient();
      try {
        const response = await executeWithRetry(() => client.spreadsheets.values.get({
          spreadsheetId,
          range: 'Profile_Audit_Logs!A1:F2000', // Reduced from 10000 — practical limit
        }));
        rows = response.data.values || [];
        dataCache.audit.data = rows;
        dataCache.audit.ts   = Date.now();
      } catch (err) {
        return [];
      }
    } finally {
      release();
    }
  }

  if (!rows || rows.length <= 1) return [];

  const headers = rows[0].map(h => String(h).trim());
  const logs = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const log = {};
    headers.forEach((header, idx) => {
      log[header] = row[idx] !== undefined ? row[idx] : "";
    });
    if (String(log["Employee Code"]).trim().toLowerCase() === String(code).trim().toLowerCase()) {
      logs.push({
        timestamp: log["Timestamp"],
        code: log["Employee Code"],
        name: log["Employee Name"],
        updatedBy: log["Updated By"],
        action: log["Action"],
        changes: log["Changes"]
      });
    }
  }

  logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return logs;
}

async function getUploadAuditLogs() {
  const release = await dbMutex.acquire();
  try {
    const client = getSheetsClient();
    const response = await executeWithRetry(() => client.spreadsheets.values.get({
      spreadsheetId,
      range: 'AuditLogs!A1:I5000',
    }));
    const rawValues = response.data.values || [];
    if (rawValues.length <= 1) return [];

    const headers = rawValues[0].map(h => String(h).trim());
    const logs = [];

    for (let i = 1; i < rawValues.length; i++) {
      const row = rawValues[i];
      const log = {};
      headers.forEach((header, idx) => {
        log[header] = row[idx] !== undefined ? row[idx] : "";
      });
      logs.push(log);
    }
    const normalizedLogs = logs.map(log => {
      const norm = {};
      const isNewFormatSheet = log["Upload Time"] !== undefined;
      
      if (isNewFormatSheet) {
        norm["Upload Time"] = log["Upload Time"];
        norm["Uploaded By"] = log["Uploaded By"];
        norm["File Name"] = log["File Name"];
        norm["Inserted"] = log["Inserted"];
        norm["Updated"] = log["Updated"];
        norm["Rejected"] = log["Rejected"];
        norm["Duplicates Removed"] = log["Duplicates Removed"];
        norm["New Columns Created"] = log["New Columns Created"];
        norm["Execution Duration"] = log["Execution Duration"];
      } else {
        const isNewCodeWrite = String(log["Rows Failed"] || "").includes("ms") || 
                               String(log["Role"] || "").toLowerCase().endsWith(".xlsx") ||
                               String(log["Role"] || "").toLowerCase().endsWith(".xls") ||
                               String(log["Role"] || "").toLowerCase().endsWith(".csv") ||
                               log["Role"] === "JSON Payload";
                               
        if (isNewCodeWrite) {
          norm["Upload Time"] = log["Timestamp"];
          norm["Uploaded By"] = log["User"];
          norm["File Name"] = log["Role"];
          norm["Inserted"] = log["Filename"];
          norm["Updated"] = log["Rows Parsed"];
          norm["Rejected"] = log["Rows Inserted"];
          norm["Duplicates Removed"] = log["Rows Updated"];
          norm["New Columns Created"] = log["Rows Skipped"];
          norm["Execution Duration"] = log["Rows Failed"];
        } else {
          norm["Upload Time"] = log["Timestamp"];
          norm["Uploaded By"] = log["User"] + (log["Role"] ? ` (${log["Role"]})` : "");
          norm["File Name"] = log["Filename"];
          norm["Inserted"] = log["Rows Inserted"];
          norm["Updated"] = log["Rows Updated"];
          norm["Rejected"] = log["Rows Failed"];
          norm["Duplicates Removed"] = log["Rows Skipped"] || 0;
          norm["New Columns Created"] = "None";
          norm["Execution Duration"] = "N/A";
        }
      }
      return norm;
    });

    // Sort reverse chronological by Upload Time
    normalizedLogs.sort((a, b) => {
      const dateA = new Date(String(a["Upload Time"]).replace(' ', 'T'));
      const dateB = new Date(String(b["Upload Time"]).replace(' ', 'T'));
      return dateB - dateA;
    });
    
    return normalizedLogs;
  } catch (err) {
    console.error("sheetsService: Error reading upload audit logs:", err.message);
    return [];
  } finally {
    release();
  }
}

module.exports = {
  getSheetsClient,
  getAllUsers,
  saveUsers,
  getActiveApprentices,
  getCompletedApprentices,
  getActiveHeaders,
  getCompletedHeaders,
  updateApprentice,
  completeApprentice,
  upsertActiveApprentices,
  ensureSheetsExist,
  getProfileAuditLogs,
  getUploadAuditLogs,
  invalidateDataCache, // Exported for route-level cache invalidation
  executeWithRetry
};
