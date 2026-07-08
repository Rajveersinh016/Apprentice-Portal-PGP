const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

const keyPath = path.resolve(__dirname, '../config/service-account.json');
const spreadsheetId = '17pWsYB9T-uz-Ir3IWgeLtdfBCcOOl-cDI7zkodzD4j4';

const credentials = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

async function run() {
  console.log('Testing spreadsheets.get...');
  const res = await sheets.spreadsheets.get({ spreadsheetId });
  console.log('Success! Title:', res.data.properties.title);
}

run().catch(console.error);
