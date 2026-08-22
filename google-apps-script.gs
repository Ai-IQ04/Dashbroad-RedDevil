/**
 * Google Sheets two-way sync for the Guild attendance page.
 *
 * Deploy as: Web app / Execute as: Me / Who has access: Anyone.
 * The web app URL must be placed in index.html as GOOGLE_SHEETS_SYNC_URL.
 *
 * It creates four tabs named "Week 1" ... "Week 4". Each tab uses:
 * A: Member ID, B: Number, C: Character Name, D: Guild, E: CP,
 * F onward: one checkbox column per activity.
 */
const SPREADSHEET_ID = 'YOUR_GOOGLE_SPREADSHEET_ID';
const WEEK_COUNT = 4;
const MEMBERS_SHEET_NAME = 'Members';
const AUDIT_SHEET_NAME = 'Audit Log';
const BACKUP_SHEET_NAME = 'System Backups';
const REQUEST_TTL_SECONDS = 600;
const BACKUP_RETENTION_DAYS = 30;
// Keep this value private and rotate it if the web app URL or source is shared.
const SYNC_TOKEN = 'GENERATE_AND_STORE_A_PRIVATE_SYNC_TOKEN';

function doGet(e) {
  try {
    assertToken_(e && e.parameter && e.parameter.token);
    return jsonOutput_({
      ok: true,
      members: readAttendance_(),
      rosterComplete: hasMembersRoster_(),
      lockedWeeks: readLockedWeeks_(),
      health: readSyncHealth_()
    });
  } catch (error) {
    return jsonOutput_({ ok: false, error: String(error) });
  }
}

// Run this function from Apps Script or attach a daily time-driven trigger.
// It stores a compact, recoverable snapshot without creating many new tabs.
function createDailyBackup() {
  const book = SpreadsheetApp.openById(SPREADSHEET_ID);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = book.getSheetByName(BACKUP_SHEET_NAME) || book.insertSheet(BACKUP_SHEET_NAME);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Backup ID', 'Created At', 'Source Sheet', 'Payload JSON']);
      sheet.setFrozenRows(1);
    }
    const backupId = Utilities.getUuid();
    const createdAt = new Date();
    const rows = [];
    [MEMBERS_SHEET_NAME, 'Week 1', 'Week 2', 'Week 3', 'Week 4', 'Control'].forEach(function(name) {
      const source = book.getSheetByName(name);
      if (!source) return;
      const values = source.getDataRange().getValues();
      rows.push([backupId, createdAt, name, JSON.stringify(values)]);
    });
    if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
    protectBackupSheet_(sheet);
    const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const values = sheet.getDataRange().getValues();
    for (let row = values.length - 1; row >= 1; row--) {
      if (values[row][1] instanceof Date && values[row][1].getTime() < cutoff) sheet.deleteRow(row + 1);
    }
    appendAuditLog_({ adminEmail: 'system', requestId: backupId }, 'backup', { sheets: rows.length });
    return { ok: true, backupId: backupId, sheets: rows.length };
  } finally {
    lock.releaseLock();
  }
}

// Run once manually to enable the daily backup trigger.
function setupDailyBackupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'createDailyBackup') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('createDailyBackup').timeBased().everyDays(1).atHour(3).create();
}

function protectBackupSheet_(sheet) {
  const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  const protection = protections.length ? protections[0] : sheet.protect();
  protection.setDescription('System backups: protected snapshots');
  protection.setWarningOnly(false);
  try {
    const editors = protection.getEditors();
    if (editors.length) protection.removeEditors(editors);
  } catch (error) {
    console.warn('Backup sheet protection warning: ' + error);
  }
}

function readSyncHealth_() {
  const book = SpreadsheetApp.openById(SPREADSHEET_ID);
  const result = { checkedAt: new Date().toISOString(), sheets: {}, auditRows: 0, backupRows: 0 };
  [MEMBERS_SHEET_NAME, 'Week 1', 'Week 2', 'Week 3', 'Week 4', 'Control'].forEach(function(name) {
    const sheet = book.getSheetByName(name);
    result.sheets[name] = sheet ? sheet.getLastRow() : 0;
  });
  const audit = book.getSheetByName(AUDIT_SHEET_NAME);
  const backups = book.getSheetByName(BACKUP_SHEET_NAME);
  result.auditRows = audit ? Math.max(0, audit.getLastRow() - 1) : 0;
  result.backupRows = backups ? Math.max(0, backups.getLastRow() - 1) : 0;
  return result;
}

function doPost(e) {
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    assertToken_(body.token);
    if (body.spreadsheetId && body.spreadsheetId !== SPREADSHEET_ID) {
      throw new Error('Spreadsheet ID does not match the configured sheet.');
    }
    validatePayload_(body);
    assertRequestNotReplayed_(body);
    if (body.action === 'write') {
      writeAttendance_(body);
      appendAuditLog_(body, 'write', {
        memberCount: Array.isArray(body.members) ? body.members.length : 0,
        activityCount: Array.isArray(body.activities) ? body.activities.length : 0,
        lockedWeeks: readLockedWeeks_()
      });
    } else if (body.action === 'setLocks') {
      writeLockedWeeks_(body.lockedWeeks || {});
      appendAuditLog_(body, 'setLocks', { lockedWeeks: readLockedWeeks_() });
    } else if (body.action === 'resetWeek') {
      resetWeek_(body.week, body.adminEmail || 'Admin');
      appendAuditLog_(body, 'resetWeek', { week: Number(body.week) });
    } else if (body.action === 'closeCycle') {
      closeCycle_(body.cycleNumber || 1, body.adminEmail || 'Admin');
      appendAuditLog_(body, 'closeCycle', { cycleNumber: Number(body.cycleNumber) || 1 });
    } else {
      throw new Error('Unsupported action.');
    }
    rememberRequest_(body);
    return jsonOutput_({ ok: true, updatedAt: new Date().toISOString() });
  } catch (error) {
    return jsonOutput_({ ok: false, error: String(error) });
  }
}

function validatePayload_(body) {
  const action = String(body.action || '');
  if (['write', 'setLocks', 'resetWeek', 'closeCycle'].indexOf(action) < 0) {
    throw new Error('Unsupported action.');
  }
  if (action === 'write') {
    if (!Array.isArray(body.members) || body.members.length === 0 || body.members.length > 1000) {
      throw new Error('Invalid member payload.');
    }
    if (!Array.isArray(body.activities) || body.activities.length === 0 || body.activities.length > 100) {
      throw new Error('Invalid activity payload.');
    }
    const ids = {};
    body.members.forEach(function(member) {
      const id = String(member && member.id || '').trim();
      const name = String(member && (member.characterName || member.name) || '').trim();
      if (!id || !name || ids[id]) throw new Error('Member IDs must be present and unique.');
      ids[id] = true;
    });
  }
  if (action === 'setLocks') {
    if (!body.lockedWeeks || typeof body.lockedWeeks !== 'object') {
      throw new Error('Invalid lock payload.');
    }
    for (let week = 1; week <= WEEK_COUNT; week++) {
      if (body.lockedWeeks[week] !== undefined && typeof body.lockedWeeks[week] !== 'boolean') {
        throw new Error('Week locks must be boolean values.');
      }
    }
  }
  if (action === 'resetWeek') {
    const week = Number(body.week);
    if (!Number.isInteger(week) || week < 1 || week > WEEK_COUNT) throw new Error('Invalid week.');
  }
  if (action === 'closeCycle' && body.cycleNumber !== undefined && Number(body.cycleNumber) < 1) {
    throw new Error('Invalid cycle number.');
  }
}

function assertRequestNotReplayed_(payload) {
  const requestId = String(payload.requestId || '').trim();
  if (!requestId) return;
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('processed_request_ids');
  const requests = raw ? JSON.parse(raw) : {};
  const now = Date.now();
  Object.keys(requests).forEach(function(id) {
    if (now - Number(requests[id]) > REQUEST_TTL_SECONDS * 1000) delete requests[id];
  });
  if (requests[requestId]) throw new Error('Duplicate request rejected.');
}

function rememberRequest_(payload) {
  const requestId = String(payload.requestId || '').trim();
  if (!requestId) return;
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('processed_request_ids');
  const requests = raw ? JSON.parse(raw) : {};
  const now = Date.now();
  Object.keys(requests).forEach(function(id) {
    if (now - Number(requests[id]) > REQUEST_TTL_SECONDS * 1000) delete requests[id];
  });
  requests[requestId] = now;
  const ids = Object.keys(requests);
  while (ids.length > 200) delete requests[ids.shift()];
  props.setProperty('processed_request_ids', JSON.stringify(requests));
}

function readAttendance_() {
  const book = SpreadsheetApp.openById(SPREADSHEET_ID);
  const merged = {};

  // The roster is the source of truth for membership. Attendance tabs only
  // contain weekly checks, so locked weeks cannot block roster changes.
  const roster = book.getSheetByName(MEMBERS_SHEET_NAME);
  if (roster && roster.getLastRow() >= 2) {
    const values = roster.getDataRange().getValues();
    for (let row = 1; row < values.length; row++) {
      const item = values[row];
      const id = String(item[0] || '').trim();
      const name = String(item[2] || '').trim();
      const active = item[5] === undefined || item[5] === '' || checkboxValue_(item[5]);
      if ((!id && !name) || !active) continue;
      merged[id || name.toLowerCase()] = {
        id: id || name,
        num: item[1] || '',
        characterName: name,
        guild: String(item[3] || ''),
        cp: Number(item[4]) || 0,
        weeklyChecks: { 1: [], 2: [], 3: [], 4: [] }
      };
    }
  }

  for (let week = 1; week <= WEEK_COUNT; week++) {
    const sheet = book.getSheetByName('Week ' + week);
    if (!sheet || sheet.getLastRow() < 2) continue;
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(String);
    const idIndex = headerIndex_(headers, ['Member ID', 'id', 'ID']);
    const nameIndex = headerIndex_(headers, ['Character Name', 'Name', 'characterName']);
    const guildIndex = headerIndex_(headers, ['Guild', 'guild']);
    const cpIndex = headerIndex_(headers, ['CP', 'cp']);
    const activityIndexes = headers.reduce((list, header, index) => {
      if (index >= 5 && header) list.push(index);
      return list;
    }, []);

    for (let row = 1; row < values.length; row++) {
      const item = values[row];
      const id = String(item[idIndex >= 0 ? idIndex : 0] || '').trim();
      const name = String(item[nameIndex >= 0 ? nameIndex : 2] || '').trim();
      if (!id && !name) continue;
      const key = id || name.toLowerCase();
      if (!merged[key]) {
        merged[key] = {
          id: id || name,
          num: item[1] || '',
          characterName: name,
          guild: guildIndex >= 0 ? String(item[guildIndex] || '') : '',
          cp: cpIndex >= 0 ? Number(item[cpIndex]) || 0 : 0,
          weeklyChecks: { 1: [], 2: [], 3: [], 4: [] }
        };
      }
      if (activityIndexes.length > 0) {
        merged[key].weeklyChecks[week] = activityIndexes.map(index => checkboxValue_(item[index]));
      }
    }
  }
  return Object.keys(merged).map(key => merged[key]);
}

function hasMembersRoster_() {
  const book = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = book.getSheetByName(MEMBERS_SHEET_NAME);
  return Boolean(sheet && sheet.getLastRow() >= 2);
}

function writeAttendance_(payload) {
  const book = SpreadsheetApp.openById(SPREADSHEET_ID);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
  const lockedWeeks = readLockedWeeks_();
  const activities = Array.isArray(payload.activities) ? payload.activities : [];
  const members = Array.isArray(payload.members) ? payload.members : [];
  // Never destroy an existing sheet because a browser sent an incomplete
  // payload while it was still loading or syncing from another source.
  if (activities.length === 0 || members.length === 0) {
    throw new Error('Refusing to overwrite attendance sheets with an empty payload.');
  }

  writeMembersRoster_(book, members);
  for (let week = 1; week <= WEEK_COUNT; week++) {
    if (lockedWeeks[week]) continue;
    const sheet = getOrCreateSheet_(book, 'Week ' + week);
    const headers = ['Member ID', 'Number', 'Character Name', 'Guild', 'CP']
      .concat(activities.map((activity, index) => activity.name || activity.key || ('Activity ' + (index + 1))));
    const rows = [headers];
    members.forEach(member => {
      const checks = member.weeklyChecks && member.weeklyChecks[week] || [];
      rows.push([
        String(member.id || ''), member.num || '', String(member.characterName || ''),
        String(member.guild || ''), Number(member.cp) || 0
      ].concat(activities.map((_, index) => Boolean(checks[index]))));
    });
    sheet.clearContents();
    if (rows.length && rows[0].length) {
      if (activities.length && rows.length > 1) {
        applyCheckboxesSafely_(sheet.getRange(2, 6, rows.length - 1, activities.length));
      }
      sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
      sheet.setFrozenRows(1);
      sheet.autoResizeColumns(1, rows[0].length);
    }
  }
  } finally {
    lock.releaseLock();
  }
}

function writeMembersRoster_(book, members) {
  const sheet = book.getSheetByName(MEMBERS_SHEET_NAME) || book.insertSheet(MEMBERS_SHEET_NAME);
  const rows = [['Member ID', 'Number', 'Character Name', 'Guild', 'CP', 'Active']];
  members.forEach(member => rows.push([
    String(member.id || ''), member.num || '', String(member.characterName || member.name || ''),
    String(member.guild || ''), Number(member.cp) || 0, true
  ]));
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  if (rows.length > 1) applyCheckboxesSafely_(sheet.getRange(2, 6, rows.length - 1, 1));
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, rows[0].length);
}

// Server-side audit trail. This is append-only from the web app and stores
// only metadata, never screenshots or the full member payload.
function appendAuditLog_(payload, action, details) {
  const book = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = book.getSheetByName(AUDIT_SHEET_NAME) || book.insertSheet(AUDIT_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Timestamp', 'Action', 'Actor', 'Request ID', 'Details']);
    sheet.setFrozenRows(1);
  }
  protectAuditSheet_(sheet);
  const actor = String(payload.adminEmail || payload.actor || 'web-app').slice(0, 160);
  const requestId = String(payload.requestId || Utilities.getUuid()).slice(0, 120);
  const safeDetails = JSON.stringify(details || {}).slice(0, 4000);
  sheet.appendRow([new Date(), String(action).slice(0, 80), actor, requestId, safeDetails]);
  if (sheet.getLastRow() > 5001) {
    sheet.deleteRows(2, sheet.getLastRow() - 5001);
  }
}

function protectAuditSheet_(sheet) {
  const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  const protection = protections.length ? protections[0] : sheet.protect();
  protection.setDescription('System audit log: append-only');
  protection.setWarningOnly(false);
  try {
    const editors = protection.getEditors();
    if (editors.length) protection.removeEditors(editors);
  } catch (error) {
    console.warn('Audit sheet protection warning: ' + error);
  }
}

// Run manually from the Apps Script editor only when a full reset is intended.
// This keeps the tabs but removes all member, attendance, and lock data.
function clearAllAttendanceData() {
  const book = SpreadsheetApp.openById(SPREADSHEET_ID);
  const names = [MEMBERS_SHEET_NAME, 'Week 1', 'Week 2', 'Week 3', 'Week 4', 'Control'];
  names.forEach(name => {
    const sheet = book.getSheetByName(name);
    if (sheet) sheet.clearContents();
  });
}

function resetWeek_(weekArg, adminEmail) {
  const week = Number(weekArg);
  if (week < 1 || week > WEEK_COUNT) throw new Error('Invalid week.');
  const book = SpreadsheetApp.openById(SPREADSHEET_ID);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const lockedWeeks = readLockedWeeks_(book);
    if (lockedWeeks[week]) throw new Error('Week ' + week + ' is locked. Unlock it before reset.');
    const sheet = book.getSheetByName('Week ' + week);
    if (!sheet || sheet.getLastRow() < 2) return;
    appendWeekArchive_(book, sheet, week, 0, adminEmail);
    clearWeekChecks_(sheet);
  } finally {
    lock.releaseLock();
  }
}

function closeCycle_(cycleNumber, adminEmail) {
  const book = SpreadsheetApp.openById(SPREADSHEET_ID);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const lockedWeeks = readLockedWeeks_(book);
    for (let week = 1; week <= WEEK_COUNT; week++) {
      if (!lockedWeeks[week]) throw new Error('All four weeks must be locked before closing the cycle.');
    }
    const archive = book.getSheetByName('Cycle Archive') || book.insertSheet('Cycle Archive');
    const timestamp = new Date().toISOString();
    const rows = [['Cycle', 'Archived At', 'Archived By', 'Week', 'Member ID', 'Number', 'Character Name', 'Guild', 'CP', 'Activity', 'Checked']];
    for (let week = 1; week <= WEEK_COUNT; week++) {
      const sheet = book.getSheetByName('Week ' + week);
      if (!sheet || sheet.getLastRow() < 2) continue;
      const values = sheet.getDataRange().getValues();
      const headers = values[0].map(String);
      for (let row = 1; row < values.length; row++) {
        const item = values[row];
        for (let col = 5; col < headers.length; col++) {
          rows.push([cycleNumber, timestamp, adminEmail, week, item[0] || '', item[1] || '', item[2] || '', item[3] || '', item[4] || '', headers[col], checkboxValue_(item[col])]);
        }
      }
    }
    if (rows.length > 1) archive.getRange(archive.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    for (let week = 1; week <= WEEK_COUNT; week++) {
      const sheet = book.getSheetByName('Week ' + week);
      if (sheet) clearWeekChecks_(sheet);
    }
    writeLockedWeeks_({ 1: false, 2: false, 3: false, 4: false });
  } finally {
    lock.releaseLock();
  }
}

function clearWeekChecks_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow >= 2 && lastColumn >= 6) {
    sheet.getRange(2, 6, lastRow - 1, lastColumn - 5).setValues(
      Array.from({ length: lastRow - 1 }, () => Array(lastColumn - 5).fill(false))
    );
  }
}

function appendWeekArchive_(book, sheet, week, cycleNumber, adminEmail) {
  const archive = book.getSheetByName('Attendance Archive') || book.insertSheet('Attendance Archive');
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const timestamp = new Date().toISOString();
  const rows = [['Cycle', 'Archived At', 'Archived By', 'Week', 'Member ID', 'Number', 'Character Name', 'Guild', 'CP', 'Activity', 'Checked']];
  for (let row = 1; row < values.length; row++) {
    for (let col = 5; col < headers.length; col++) {
      rows.push([cycleNumber, timestamp, adminEmail, week, values[row][0] || '', values[row][1] || '', values[row][2] || '', values[row][3] || '', values[row][4] || '', headers[col], checkboxValue_(values[row][col])]);
    }
  }
  if (rows.length > 1) archive.getRange(archive.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function assertToken_(token) {
  if (String(token || '') !== SYNC_TOKEN) throw new Error('Unauthorized request.');
}

function applyCheckboxesSafely_(range) {
  try {
    range.insertCheckboxes();
  } catch (error) {
    // Some Google Sheets columns may be classified and reject validation
    // changes. Keep the boolean values and let the sync continue.
    console.warn('Checkbox validation skipped: ' + error);
  }
}

function readLockedWeeks_(bookArg) {
  const book = bookArg || SpreadsheetApp.openById(SPREADSHEET_ID);
  const control = book.getSheetByName('Control');
  const result = { 1: false, 2: false, 3: false, 4: false };
  if (!control || control.getLastRow() < 2) return result;
  const values = control.getRange(1, 1, control.getLastRow(), 2).getValues();
  for (let row = 1; row < values.length; row++) {
    const week = Number(values[row][0]);
    if (week >= 1 && week <= WEEK_COUNT) result[week] = checkboxValue_(values[row][1]);
  }
  return result;
}

function writeLockedWeeks_(lockedWeeks) {
  const book = SpreadsheetApp.openById(SPREADSHEET_ID);
  const control = book.getSheetByName('Control') || book.insertSheet('Control');
  const rows = [['Week', 'Locked']];
  for (let week = 1; week <= WEEK_COUNT; week++) {
    rows.push([week, Boolean(lockedWeeks[week])]);
  }
  control.getRange(1, 1, rows.length, 2).setValues(rows);
  applyCheckboxesSafely_(control.getRange(2, 2, WEEK_COUNT, 1));
  control.getRange(1, 1, rows.length, 2).setValues(rows);
  control.setFrozenRows(1);
  protectControlSheet_(control);
  syncWeekProtections_(book, lockedWeeks);
}

function protectControlSheet_(sheet) {
  const existing = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  const protection = existing.length ? existing[0] : sheet.protect();
  protection.setDescription('System control: week locks');
  protection.setWarningOnly(false);
  try {
    const editors = protection.getEditors();
    if (editors.length) protection.removeEditors(editors);
  } catch (error) {
    console.warn('Control sheet protection warning: ' + error);
  }
}

function syncWeekProtections_(book, lockedWeeks) {
  for (let week = 1; week <= WEEK_COUNT; week++) {
    const sheet = book.getSheetByName('Week ' + week);
    if (!sheet) continue;
    const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    if (lockedWeeks[week]) {
      const protection = protections.length ? protections[0] : sheet.protect();
      protection.setDescription('Locked attendance: Week ' + week);
      protection.setWarningOnly(false);
      try {
        const editors = protection.getEditors();
        if (editors.length) protection.removeEditors(editors);
      } catch (error) {
        console.warn('Week protection warning: ' + error);
      }
    } else {
      protections.forEach(protection => protection.remove());
    }
  }
}

function onEdit(e) {
  // Revert direct checkbox edits on a locked Week tab.
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  const match = /^Week\s+(\d+)$/i.exec(sheet.getName());
  if (!match || e.range.getRow() < 2 || e.range.getColumn() < 6) return;
  const week = Number(match[1]);
  if (!readLockedWeeks_(e.source)[week]) return;
  e.range.setValue(e.oldValue === undefined ? false : e.oldValue);
}

function getOrCreateSheet_(book, name) {
  return book.getSheetByName(name) || book.insertSheet(name);
}

function headerIndex_(headers, names) {
  for (let i = 0; i < names.length; i++) {
    const index = headers.indexOf(names[i]);
    if (index >= 0) return index;
  }
  return -1;
}

function checkboxValue_(value) {
  if (value === true || value === 1) return true;
  return ['true', 'yes', 'y', '1', 'x', 'checked', 'ติ๊ก', 'เช็ค'].indexOf(String(value).trim().toLowerCase()) >= 0;
}

function jsonOutput_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
