const { AsyncLocalStorage } = require('async_hooks');
const fs = require('fs');
const path = require('path');

const requestStorage = new AsyncLocalStorage();
const logFilePath = path.resolve(__dirname, '../request_traces.log');

function logTrace(message) {
  const logLine = `${message}\n`;
  console.log(message);
  try {
    fs.appendFileSync(logFilePath, logLine, 'utf8');
  } catch (err) {
    console.error('Failed to write to request_traces.log:', err.message);
  }
}

module.exports = {
  requestStorage,
  logTrace
};
