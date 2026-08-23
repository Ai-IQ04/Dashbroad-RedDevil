/**
 * Boss Timer & AI OCR Module for Guild Dashboard
 * Completely decoupled from guild scoring logic.
 */

// Safe fallback for escapeHtml
if (typeof escapeHtml !== 'function') {
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// i18n helper for Boss Timer
function tBoss(key, fallback) {
  if (typeof window.t === 'function') {
    const val = window.t(key);
    if (val && val !== key) return val;
  }
  return fallback || key;
}

// Global state for Boss Timer
let bossList = [];
let bossCustomConfigs = {}; // { [bossId]: { name, level, map, avatar, intervalHours, scheduleText, note } }
let bossTimerData = {}; // { [bossId]: { defeatedTime: ISOString, defeatedBy: string, nextSpawnTime: ISOString, customNextSpawn: ISOString } }
let bossDropLogs = [];  // [ { id, bossId, bossName, killTime, items: [], recordedBy, timestamp } ]
let bossKillLogs = [];  // [ { id, bossId, bossName, level, map, killTime, killTimeFormatted, nextSpawnTime, nextSpawnFormatted, recordedBy, timestamp, timestampStr, dropItems, dropItemsText } ]
let bossSheetWebhookUrl = localStorage.getItem('guild_boss_sheet_webhook') || '';
let bossDiscordWebhookUrl = localStorage.getItem('guild_boss_discord_webhook') || '';
let bossGeminiApiKey = localStorage.getItem('guild_boss_gemini_api_key') || '';
// Discord Role ID สำหรับ @mention ในข้อความแจ้งเตือน (ค่าเริ่มต้นเป็น Role เดิมที่เคย hardcode ไว้)
let bossDiscordRoleId = localStorage.getItem('guild_boss_discord_role_id') || '1508495658162851970';
// สถานะเปิด/ปิดการแจ้งเตือน Discord เมื่อลงเวลาบอสตาย (ค่าเริ่มต้น: เปิด)
let bossKillDiscordEnabled = localStorage.getItem('guild_boss_kill_discord_enabled') !== 'false';
let sentDiscordAlerts = new Set();
let bossTimerInterval = null;
let currentBossFilter = 'all';
let currentBossSearch = '';
let isBossSoundEnabled = localStorage.getItem('guild_boss_sound_enabled') !== 'false';
let activeAppModule = 'scoring'; // 'scoring' | 'boss_timer'
let currentEditBossId = null;
// Use Firebase server time so alerts are not affected by the user's device clock.
let bossServerTimeOffsetMs = 0;
const BOSS_WARNING_WINDOW_MS = 5 * 60 * 1000;

function getBossNow() {
  return new Date(Date.now() + bossServerTimeOffsetMs);
}

function parseStoredJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (error) {
    console.warn(`[Storage] Invalid JSON for ${key}; using default value.`, error);
    return fallback;
  }
}

// 45+ Boss definitions from Google Sheet
const DEFAULT_BOSS_DATABASE = [
  { id: 'world_boss', name: 'World Boss', level: '60-105', map: 'World Boss', respawnType: 'fixed', scheduleText: 'Daily 10:00 / 19:00', fixedTimes: [{ days: [0, 1, 2, 3, 4, 5, 6], time: '10:00' }, { days: [0, 1, 2, 3, 4, 5, 6], time: '19:00' }], note: 'World Boss' },
  { id: 'vioren', name: 'Vioren', level: '65', map: 'ทะเลสาบจันทร์เสี้ยว', respawnType: 'interval', intervalHours: 10, note: 'ทะเลสาบจันทร์เสี้ยว' },
  { id: 'venatus', name: 'Venatus', level: '60', map: 'แอ่งน้ำปนเปื้อน', respawnType: 'interval', intervalHours: 10, note: 'แอ่งน้ำปนเปื้อน' },
  { id: 'lady_dalia', name: 'Lady Dalia', level: '85', map: 'เนินเขาอัสดง', respawnType: 'interval', intervalHours: 18, note: 'เนินเขาอัสดง' },
  { id: 'ego', name: 'Ego', level: '70', map: 'หุบเขาอูลาน', respawnType: 'interval', intervalHours: 21, note: 'หุบเขาอูลาน' },
  { id: 'livera', name: 'Livera', level: '75', map: 'โบราณสถานผู้พิทักษ์', respawnType: 'interval', intervalHours: 24, note: 'โบราณสถานผู้พิทักษ์' },
  { id: 'undomiel', name: 'Undomiel', level: '80', map: 'ห้องทดลองลับ', respawnType: 'interval', intervalHours: 24, note: 'ห้องทดลองลับ' },
  { id: 'araneo', name: 'Araneo', level: '75', map: 'สุสานใต้ดิน ชั้น 1', respawnType: 'interval', intervalHours: 24, note: 'สุสานใต้ดิน ชั้น 1' },
  { id: 'general_aquleus', name: 'General Aquleus', level: '85', map: 'สุสานใต้ดิน ชั้น 2', respawnType: 'interval', intervalHours: 29, note: 'สุสานใต้ดิน ชั้น 2' },
  { id: 'amentis', name: 'Amentis', level: '88', map: 'เนินเขาอัสดง', respawnType: 'interval', intervalHours: 29, note: 'เนินเขาอัสดง' },
  { id: 'gareth', name: 'Gareth', level: '98', map: 'ดินแดนมรณะ ชั้น 1', respawnType: 'interval', intervalHours: 32, note: 'ดินแดนมรณะ ชั้น 1' },
  { id: 'baron_braudmore', name: 'Baron Braudmore', level: '88', map: 'สมรภูมิศักดิ์สิทธิ์', respawnType: 'interval', intervalHours: 32, note: 'สมรภูมิศักดิ์สิทธิ์' },
  { id: 'catena', name: 'Catena', level: '100', map: 'ดินแดนมรณะ ชั้น 3', respawnType: 'interval', intervalHours: 35, note: 'ดินแดนมรณะ ชั้น 3' },
  { id: 'shuliar', name: 'Shuliar', level: '95', map: 'ซากของสงคราม', respawnType: 'interval', intervalHours: 35, note: 'ซากของสงคราม' },
  { id: 'larba', name: 'Larba', level: '98', map: 'ซากของสงคราม', respawnType: 'interval', intervalHours: 35, note: 'ซากของสงคราม' },
  { id: 'titore', name: 'Titore', level: '98', map: 'ดินแดนมรณะ ชั้น 2', respawnType: 'interval', intervalHours: 37, note: 'ดินแดนมรณะ ชั้น 2' },
  { id: 'wannitas', name: 'Wannitas', level: '93', map: 'ดอนแห่งการปฏิวัติ', respawnType: 'interval', intervalHours: 48, note: 'ดอนแห่งการปฏิวัติ' },
  { id: 'metus', name: 'Metus', level: '93', map: 'ดอนแห่งการปฏิวัติ', respawnType: 'interval', intervalHours: 48, note: 'ดอนแห่งการปฏิวัติ' },
  { id: 'duplican', name: 'Duplican', level: '93', map: 'ดอนแห่งการปฏิวัติ', respawnType: 'interval', intervalHours: 48, note: 'ดอนแห่งการปฏิวัติ' },
  { id: 'asta', name: 'Asta', level: '100', map: 'ทุ่งหญ้าแดง', respawnType: 'interval', intervalHours: 62, note: 'ทุ่งหญ้าแดง' },
  { id: 'ordo', name: 'Ordo', level: '100', map: 'ทุ่งหญ้าแดง', respawnType: 'interval', intervalHours: 62, note: 'ทุ่งหญ้าแดง' },
  { id: 'secreta', name: 'Secreta', level: '100', map: 'ทุ่งหญ้าแดง', respawnType: 'interval', intervalHours: 62, note: 'ทุ่งหญ้าแดง' },
  { id: 'supore', name: 'Supore', level: '100', map: 'ทุ่งหญ้าแดง', respawnType: 'interval', intervalHours: 62, note: 'ทุ่งหญ้าแดง' },
  { id: 'clemantis', name: 'Clemantis', level: '70', map: 'แอ่งน้ำปนเปื้อน', respawnType: 'fixed', scheduleText: 'Mon 10:30 / Thu 18:00', fixedTimes: [{ days: [1], time: '10:30' }, { days: [4], time: '18:00' }], note: 'แอ่งน้ำปนเปื้อน' },
  { id: 'saphirus', name: 'Saphirus', level: '80', map: 'ทะเลสาบจันทร์เสี้ยว', respawnType: 'fixed', scheduleText: 'Sun 16:00 / Tue 10:30', fixedTimes: [{ days: [0], time: '16:00' }, { days: [2], time: '10:30' }], note: 'ทะเลสาบจันทร์เสี้ยว' },
  { id: 'neutro', name: 'Neutro', level: '80', map: 'ทะเลทรายกรีดร้อง', respawnType: 'fixed', scheduleText: 'Tue 18:00 / Thu 10:30', fixedTimes: [{ days: [2], time: '18:00' }, { days: [4], time: '10:30' }], note: 'ทะเลทรายกรีดร้อง' },
  { id: 'thymele', name: 'Thymele', level: '85', map: 'เนินเขาอัสดง', respawnType: 'fixed', scheduleText: 'Mon 18:00 / Wed 10:30', fixedTimes: [{ days: [1], time: '18:00' }, { days: [3], time: '10:30' }], note: 'เนินเขาอัสดง' },
  { id: 'roderick', name: 'Roderick', level: '95', map: 'ทางระบายน้ำ ชั้น 1', respawnType: 'fixed', scheduleText: 'Fri 18:00', fixedTimes: [{ days: [5], time: '18:00' }], note: 'ทางระบายน้ำ ชั้น 1' },
  { id: 'auraq', name: 'Auraq', level: '100', map: 'ทางระบายน้ำ ชั้น 2', respawnType: 'fixed', scheduleText: 'Fri 21:00 / Wed 20:00', fixedTimes: [{ days: [5], time: '21:00' }, { days: [3], time: '20:00' }], note: 'ทางระบายน้ำ ชั้น 2' },
  { id: 'milavy', name: 'Milavy', level: '90', map: 'สุสานใต้ดิน ชั้น 3', respawnType: 'fixed', scheduleText: 'Sat 14:00', fixedTimes: [{ days: [6], time: '14:00' }], note: 'สุสานใต้ดิน ชั้น 3' },
  { id: 'ringor', name: 'Ringor', level: '95', map: 'สมรภูมิศักดิ์สิทธิ์', respawnType: 'fixed', scheduleText: 'Sat 16:00', fixedTimes: [{ days: [6], time: '16:00' }], note: 'สมรภูมิศักดิ์สิทธิ์' },
  { id: 'chaiflock', name: 'Chaiflock', level: '120', map: 'ทุ่งหญ้าแดง', respawnType: 'fixed', scheduleText: 'Sun 14:00', fixedTimes: [{ days: [0], time: '14:00' }], note: 'ทุ่งหญ้าแดง' },
  { id: 'benji', name: 'Benji', level: '120', map: 'ทุ่งหญ้าแดง', respawnType: 'fixed', scheduleText: 'Sun 20:00', fixedTimes: [{ days: [0], time: '20:00' }], note: 'ทุ่งหญ้าแดง' },
  { id: 'tumier', name: 'Tumier', level: '140', map: 'ทางระบายน้ำ ชั้น 3', respawnType: 'fixed', scheduleText: 'Tue 20:55', fixedTimes: [{ days: [2], time: '20:55' }], note: 'ทางระบายน้ำ ชั้น 3' },
  { id: 'nevaeh', name: 'Nevaeh', level: '140', map: 'KRANSIA', respawnType: 'fixed', scheduleText: 'Sun 21:00', fixedTimes: [{ days: [0], time: '21:00' }], note: 'KRANSIA' },
  { id: 'icaruthia', name: 'Icaruthia', level: '135', map: 'KRANSIA', respawnType: 'fixed', scheduleText: 'Tue 20:00 / Fri 20:00', fixedTimes: [{ days: [2], time: '20:00' }, { days: [5], time: '20:00' }], note: 'KRANSIA' },
  { id: 'motti', name: 'Motti', level: '135', map: 'KRANSIA', respawnType: 'fixed', scheduleText: 'Wed 18:00 / Sat 18:00', fixedTimes: [{ days: [3], time: '18:00' }, { days: [6], time: '18:00' }], note: 'KRANSIA' },
  { id: 'libitina', name: 'Libitina', level: '130', map: 'โบสถ์แห่งบ่วงบัญชาชั่วนิรันดร์', respawnType: 'fixed', scheduleText: 'Tue 20:50 / Sat 20:30', fixedTimes: [{ days: [2], time: '20:50' }, { days: [6], time: '20:30' }], note: 'โบสถ์แห่งบ่วงบัญชาชั่วนิรันดร์' },
  { id: 'rakajeth', name: 'Rakajeth', level: '130', map: 'อาญาแห่งเซเครต้า', respawnType: 'fixed', scheduleText: 'Tue 21:00 / Sun 20:05', fixedTimes: [{ days: [2], time: '21:00' }, { days: [0], time: '20:05' }], note: 'อาญาแห่งเซเครต้า' },
  { id: 'bahel', name: 'Bahel', level: '140', map: 'รอยแยกแห่งการกัดกร่อน', respawnType: 'fixed', scheduleText: 'Fri 02:00', fixedTimes: [{ days: [5], time: '02:00' }], note: 'รอยแยกแห่งการกัดกร่อน' },
  { id: 'lucus', name: 'Lucus', level: '145', map: 'เตาหลอมแห่งความเงียบงัน', respawnType: 'fixed', scheduleText: 'Sat 21:00', fixedTimes: [{ days: [6], time: '21:00' }], note: 'เตาหลอมแห่งความเงียบงัน' },
  { id: 'camalia', name: 'Camalia', level: '135', map: 'ห้องทดลอง', respawnType: 'fixed', scheduleText: 'Fri 19:05', fixedTimes: [{ days: [5], time: '19:05' }], note: 'ห้องทดลอง' },
  { id: 'guild_arena', name: 'Guild Arena', level: '00', map: 'Guild Base', respawnType: 'fixed', scheduleText: 'Fri/Sat/Sun 19:25', fixedTimes: [{ days: [5, 6, 0], time: '19:25' }], note: 'Guild Base' },
  { id: 'reddevil_guild_boss', name: 'RedDevil Guild Boss', level: '00', map: 'Guild Base', respawnType: 'fixed', scheduleText: 'Sun 19:05', fixedTimes: [{ days: [0], time: '19:05' }], note: 'Guild Base' }
];

// Helper to rebuild bossList merged with custom configs
function rebuildBossList() {
  bossList = DEFAULT_BOSS_DATABASE.map(b => {
    const custom = bossCustomConfigs[b.id] || {};
    return {
      ...b,
      name: custom.name || b.name,
      level: custom.level || b.level,
      map: custom.map || b.map,
      avatar: custom.avatar || null,
      intervalHours: (custom.intervalHours !== undefined && custom.intervalHours !== null) ? Number(custom.intervalHours) : b.intervalHours,
      scheduleText: custom.scheduleText || b.scheduleText,
      note: (custom.note !== undefined && custom.note !== null) ? custom.note : b.note
    };
  });
}

// Audio synthesizer for boss alert
function playBossAlertSound() {
  if (!isBossSoundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15); // A5
    osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.3); // D6
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.8);
  } catch (e) {
    console.warn('Audio play error:', e);
  }
}

// เล่นเสียง "สำเร็จ" (chime) เมื่อบันทึกข้อมูลสำเร็จ
// - ใช้ Web Audio API สร้างเสียงสั้นๆ (ไม่ต้องใช้ไฟล์เสียง)
// - ฟังก์ชันนี้ถูกเรียกจากหลายจุด เช่น บันทึกเวลาตาย, แก้ไขบอส, รีเซ็ตไทม์เมอร์
function playChime() {
  if (!isBossSoundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
    osc.frequency.setValueAtTime(1318.51, ctx.currentTime + 0.12); // E6
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch (e) {
    console.warn('Chime play error:', e);
  }
}

// Module Switcher
function switchAppModule(moduleName) {
  activeAppModule = moduleName;
  try {
    localStorage.setItem('guild_active_app_module', moduleName);
  } catch (e) { }

  const scoringContainer = document.getElementById('scoring-module-container');
  const scoringSubHeader = document.getElementById('scoring-sub-header');
  const bossContainer = document.getElementById('boss-timer-module-container');
  const tabScoring = document.getElementById('nav-tab-scoring');
  const tabBoss = document.getElementById('nav-tab-boss-timer');

  // Contextual Header Buttons for Scoring (Add Character, CSV, Reset)
  const btnAddMember = document.getElementById('btn-add-member-top');
  const btnExportCsv = document.getElementById('btn-export-csv-top');
  const btnResetTop = document.getElementById('btn-reset-top');

  if (moduleName === 'boss_timer') {
    if (scoringContainer) scoringContainer.classList.add('hidden');
    if (scoringSubHeader) scoringSubHeader.classList.add('hidden');
    if (bossContainer) bossContainer.classList.remove('hidden');

    // Hide Scoring action buttons in Boss Timer
    if (btnAddMember) btnAddMember.classList.add('hidden');
    if (btnExportCsv) btnExportCsv.classList.add('hidden');
    if (btnResetTop) btnResetTop.classList.add('hidden');

    if (tabScoring) {
      tabScoring.className = "apple-btn px-3.5 py-1.5 sm:px-5 sm:py-2 rounded-xl text-xs font-extrabold text-slate-300 hover:text-white hover:bg-slate-800 transition flex items-center gap-2 active:scale-95";
    }
    if (tabBoss) {
      tabBoss.className = "apple-btn px-3.5 py-1.5 sm:px-5 sm:py-2 rounded-xl text-xs font-extrabold transition flex items-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 shadow-lg shadow-orange-500/20 active:scale-95";
    }
    renderBossTimerCards();
  } else {
    if (scoringContainer) scoringContainer.classList.remove('hidden');
    if (scoringSubHeader) scoringSubHeader.classList.remove('hidden');
    if (bossContainer) bossContainer.classList.add('hidden');

    // Show Scoring action buttons if Admin is active
    const isAdmin = (typeof isAdminActive !== 'undefined') ? isAdminActive : true;
    if (btnAddMember) {
      if (isAdmin) btnAddMember.classList.remove('hidden');
      else btnAddMember.classList.add('hidden');
    }
    if (btnExportCsv) {
      if (isAdmin) btnExportCsv.classList.remove('hidden');
      else btnExportCsv.classList.add('hidden');
    }
    if (btnResetTop) {
      if (isAdmin) btnResetTop.classList.remove('hidden');
      else btnResetTop.classList.add('hidden');
    }

    if (tabScoring) {
      tabScoring.className = "apple-btn px-3.5 py-1.5 sm:px-5 sm:py-2 rounded-xl text-xs font-extrabold transition flex items-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 shadow-lg shadow-orange-500/20 active:scale-95";
    }
    if (tabBoss) {
      tabBoss.className = "apple-btn px-3.5 py-1.5 sm:px-5 sm:py-2 rounded-xl text-xs font-extrabold text-slate-300 hover:text-white hover:bg-slate-800 transition flex items-center gap-2 active:scale-95";
    }

    if (typeof renderTableHeader === 'function') renderTableHeader();
    if (typeof renderTable === 'function') renderTable();
  }

  // Update contextual Admin UI indicator and buttons
  if (typeof updateAdminUI === 'function') {
    updateAdminUI();
  }
}

function getBangkokDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).formatToParts(date);

  const values = {};
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second)
  };
}

function createDateFromBangkokParts({ year, month, day, hour, minute, second = 0 }) {
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second) - (7 * 60 * 60 * 1000);
  return new Date(utcMs);
}

function formatBangkokClock(date) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  return formatter.format(date);
}

// Calculate Next Spawn Date
function calculateNextSpawnDate(boss, defeatedDateStr) {
  const now = getBossNow();
  const defDate = defeatedDateStr ? new Date(defeatedDateStr) : null;
  const defTimestamp = (defDate && !isNaN(defDate.getTime())) ? defDate.getTime() : 0;

  // 1. Interval bosses: คงสถานะ 'เกิดแล้ว' ค้างไว้จนกว่า Admin จะมากดลงเวลาตายจริง
  if (boss.respawnType === 'interval') {
    if (!defeatedDateStr || isNaN(defTimestamp) || defTimestamp === 0) return null;
    const nextSpawn = new Date(defTimestamp + (boss.intervalHours * 3600 * 1000));
    return nextSpawn;
  }

  // 2. Fixed schedule bosses: คำนวณเวลารอบถัดไปตามตารางเวลาในโซนเวลาไทย (+7)
  if (boss.respawnType === 'fixed' && Array.isArray(boss.fixedTimes)) {
    // Always search from the later of the last defeat and current Thai time.
    // Otherwise an old defeat record can make the 7-day search window expire.
    const nowBangkok = getBangkokDateParts(now);

    let nearest = null;
    for (let offset = 0; offset <= 7; offset++) {
      const checkDate = new Date(Date.UTC(nowBangkok.year, nowBangkok.month - 1, nowBangkok.day + offset));
      const checkBangkok = getBangkokDateParts(checkDate);
      const dayOfWeek = new Date(Date.UTC(checkBangkok.year, checkBangkok.month - 1, checkBangkok.day)).getUTCDay();

      for (const ft of boss.fixedTimes) {
        if (ft.days.includes(dayOfWeek)) {
          const [h, m] = ft.time.split(':').map(Number);
          const candidate = createDateFromBangkokParts({
            year: checkBangkok.year,
            month: checkBangkok.month,
            day: checkBangkok.day,
            hour: h,
            minute: m,
            second: 0
          });

          // Fixed-schedule bosses follow the timetable regardless of the
          // recorded defeat time. Defeat time is history only; it must not
          // push a future 10:00 slot to 19:00.
          if (candidate > now) {
            if (!nearest || candidate < nearest) {
              nearest = candidate;
            }
          }
        }
      }
    }
    return nearest;
  }

  return null;
}

// Helper: คำนวณเวลาที่บอสจะเกิดรอบถัดไป (รวมตรรกะซ้ำซ้อนไว้ที่เดียว)
// - ถ้าเป็นบอสตามตาราง (Fixed Schedule) ให้คำนวณตามตารางเวลาไทยเสมอ
// - ถ้าเป็นบอสตามรอบเวลา (Interval) และมี customNextSpawn ให้ใช้ค่านั้น ถ้าไม่มีให้คำนวณจากเวลาตาย
function getBossNextSpawn(boss) {
  const timer = bossTimerData[boss.id] || {};
  // บอสตามตาราง (Fixed Schedule) ทั้งหมด จะต้องยึดตามตารางเวลาหลักของเกมในโซนเวลาไทยเสมอ
  // ไม่ให้ค่า customNextSpawn เก่าหรือผิดพลาดมาทับเวลาตารางจริง
  if (boss.respawnType === 'fixed') {
    return calculateNextSpawnDate(boss, timer.defeatedTime);
  }
  if (timer.customNextSpawn) {
    const custom = new Date(timer.customNextSpawn);
    if (!isNaN(custom.getTime())) return custom;
  }
  return calculateNextSpawnDate(boss, timer.defeatedTime);
}

function validateBossTimerData(timerData = bossTimerData) {
  const issues = [];
  Object.keys(timerData || {}).forEach(id => {
    const timer = timerData[id] || {};
    ['defeatedTime', 'nextSpawnTime', 'customNextSpawn'].forEach(key => {
      if (timer[key] && isNaN(new Date(timer[key]).getTime())) issues.push(`${id}: invalid ${key}`);
    });
    if (timer.defeatedTime && new Date(timer.defeatedTime).getTime() > Date.now() + 60 * 1000) {
      issues.push(`${id}: defeatedTime is in the future`);
    }
  });
  return { ok: issues.length === 0, issues, checkedAt: new Date().toISOString() };
}

function getBossDataHealth() {
  const timerHealth = validateBossTimerData();
  const fixedCount = bossList.filter(b => b.respawnType === 'fixed').length;
  const intervalCount = bossList.filter(b => b.respawnType === 'interval').length;
  return {
    ok: timerHealth.ok && Boolean(bossList.length),
    checkedAt: timerHealth.checkedAt,
    serverTimeOffsetMs: bossServerTimeOffsetMs,
    firebaseConnected: typeof fbDb !== 'undefined' && Boolean(fbDb),
    discordConfigured: Boolean(bossDiscordWebhookUrl),
    bossCount: bossList.length,
    fixedCount,
    intervalCount,
    issues: timerHealth.issues
  };
}

function getBossSchedulePreview(days = 7) {
  const result = [];
  const now = getBossNow();
  bossList.forEach(boss => {
    if (boss.respawnType !== 'fixed' || !Array.isArray(boss.fixedTimes)) return;
    const slots = [];
    for (let offset = 0; offset < Math.max(1, Number(days)); offset++) {
      const day = new Date(now.getTime() + offset * 86400000);
      const parts = getBangkokDateParts(day);
      const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
      boss.fixedTimes.forEach(slot => {
        if (!slot.days.includes(weekday)) return;
        const [hour, minute] = String(slot.time).split(':').map(Number);
        const spawn = createDateFromBangkokParts({ year: parts.year, month: parts.month, day: parts.day, hour, minute });
        if (spawn >= now) slots.push(spawn.toISOString());
      });
    }
    result.push({ id: boss.id, name: boss.name, schedule: slots.sort() });
  });
  return result;
}

async function testBossDiscordAlert() {
  if (!bossDiscordWebhookUrl) throw new Error('ยังไม่ได้ตั้งค่า Discord Webhook');
  await sendDiscordWebhookPayload({ embeds: [{ color: 0x22C55E, title: '✅ Boss Timer Test', description: `เวลาไทย: ${formatBangkokClock(getBossNow())}\nระบบแจ้งเตือนทำงานปกติ`, footer: { text: 'Dashboard RedDevil' } }] });
  return true;
}

function getBossTimerSourceLabel(boss, timer, isEn) {
  if (timer && timer.customNextSpawn) return isEn ? 'Admin custom time' : 'เวลา Admin ตั้งเอง';
  if (boss.respawnType === 'interval') return isEn ? `Interval ${boss.intervalHours}h` : `นับจากเวลาตาย ${boss.intervalHours} ชม.`;
  return isEn ? `Fixed • ${boss.scheduleText || 'Schedule'}` : `ตาราง固定 • ${boss.scheduleText || 'ตามตาราง'}`;
}

// Initialize Boss Data
function initBossTimerModule() {
  bossCustomConfigs = parseStoredJson('guild_boss_custom_configs', {});

  rebuildBossList();

  bossTimerData = parseStoredJson('guild_boss_timers', {});

  bossDropLogs = parseStoredJson('guild_boss_drop_logs', []);

  bossKillLogs = parseStoredJson('guild_boss_kill_logs', []);

  bossSheetWebhookUrl = localStorage.getItem('guild_boss_sheet_webhook') || '';

  // Listen to Firebase Realtime Database
  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref('.info/serverTimeOffset').on('value', snap => {
      const offset = Number(snap.val());
      bossServerTimeOffsetMs = Number.isFinite(offset) ? offset : 0;
      updateCountdowns();
      updateUpcomingBossWidget();
    });

    fbDb.ref('guild_app/boss_custom_configs').on('value', snap => {
      if (snap.exists()) {
        bossCustomConfigs = snap.val() || {};
        localStorage.setItem('guild_boss_custom_configs', JSON.stringify(bossCustomConfigs));
        rebuildBossList();
        renderBossTimerCards();
        updateUpcomingBossWidget();
      }
    });

    fbDb.ref('guild_app/boss_timers').on('value', snap => {
      if (snap.exists()) {
        bossTimerData = snap.val() || {};
        const health = validateBossTimerData(bossTimerData);
        if (!health.ok) console.warn('[Boss Timer] Data issues:', health.issues);
        localStorage.setItem('guild_boss_timers', JSON.stringify(bossTimerData));
        renderBossTimerCards();
        updateUpcomingBossWidget();
      }
    });

    fbDb.ref('guild_app/boss_drop_logs').on('value', snap => {
      if (snap.exists()) {
        bossDropLogs = snap.val() || [];
        localStorage.setItem('guild_boss_drop_logs', JSON.stringify(bossDropLogs));
      }
    });

    fbDb.ref('guild_app/boss_kill_logs').on('value', snap => {
      if (snap.exists()) {
        bossKillLogs = snap.val() || [];
        localStorage.setItem('guild_boss_kill_logs', JSON.stringify(bossKillLogs));
        renderBossKillHistoryList();
      }
    });

    fbDb.ref('guild_app/boss_sheet_webhook').on('value', snap => {
      if (snap.exists()) {
        bossSheetWebhookUrl = snap.val() || '';
        localStorage.setItem('guild_boss_sheet_webhook', bossSheetWebhookUrl);
        updateWebhookStatusUi();
      }
    });

    fbDb.ref('guild_app/boss_discord_webhook').on('value', snap => {
      if (snap.exists()) {
        bossDiscordWebhookUrl = snap.val() || '';
        localStorage.setItem('guild_boss_discord_webhook', bossDiscordWebhookUrl);
        updateWebhookStatusUi();
      }
    });

    // โหลด Discord Role ID จาก Firebase (สำหรับ @mention ในข้อความแจ้งเตือน)
    fbDb.ref('guild_app/boss_discord_role_id').on('value', snap => {
      if (snap.exists()) {
        bossDiscordRoleId = snap.val() || '1508495658162851970';
        localStorage.setItem('guild_boss_discord_role_id', bossDiscordRoleId);
      }
    });

    // โหลดสถานะเปิด/ปิดการแจ้งเตือน Discord เมื่อลงเวลาบอสตายจาก Firebase
    fbDb.ref('guild_app/boss_kill_discord_enabled').on('value', snap => {
      if (snap.exists()) {
        bossKillDiscordEnabled = snap.val() !== false;
        localStorage.setItem('guild_boss_kill_discord_enabled', String(bossKillDiscordEnabled));
      }
    });

    fbDb.ref('guild_app/boss_gemini_api_key').on('value', snap => {
      if (snap.exists()) {
        bossGeminiApiKey = snap.val() || '';
        localStorage.setItem('guild_boss_gemini_api_key', bossGeminiApiKey);
      }
    });

    fbDb.ref('guild_app/sent_discord_alerts').on('value', snap => {
      if (snap.exists()) {
        const val = snap.val() || {};
        Object.keys(val).forEach(k => sentDiscordAlerts.add(k));
      }
    });
  }

  // Live Timer Interval (every 1 second)
  if (bossTimerInterval) clearInterval(bossTimerInterval);
  bossTimerInterval = setInterval(() => {
    updateCountdowns();
    updateUpcomingBossWidget();
    // Spawn alerts are handled by Apps Script to prevent duplicate Discord alerts.
  }, 1000);

  // Setup Paste Handler for instant OCR anywhere in Boss Tab
  window.removeEventListener('paste', handleGlobalPasteForOCR);
  window.addEventListener('paste', handleGlobalPasteForOCR);

  populate24HourSelects();
  renderBossTimerCards();
  updateUpcomingBossWidget();

  // Restore Last Active Module (Scoring vs Boss Timer)
  try {
    const savedModule = localStorage.getItem('guild_active_app_module');
    if (savedModule === 'boss_timer') {
      switchAppModule('boss_timer');
    }
  } catch (e) { }
}

// Render Boss Cards
function renderBossTimerCards() {
  const container = document.getElementById('boss-cards-grid');
  if (!container) return;
  if (!Array.isArray(bossList) || bossList.length === 0) {
    rebuildBossList();
  }

  const now = getBossNow();
  const isEn = (typeof window.currentLang !== 'undefined' && window.currentLang === 'en');
  let aliveCount = 0;
  let soonCount = 0;

  const bossStatuses = bossList.map(boss => {
    // ใช้ helper getBossNextSpawn() เพื่อรวมตรรกะคำนวณเวลากำเนิดไว้ที่เดียว
    let nextSpawn = getBossNextSpawn(boss);

    let status = 'unrecorded'; // 'alive' | 'soon' | 'cooldown' | 'unrecorded'
    let diffMs = null;

    if (nextSpawn && !isNaN(nextSpawn.getTime())) {
      diffMs = nextSpawn.getTime() - now.getTime();
      if (diffMs <= 0) {
        status = 'alive';
        aliveCount++;
      } else if (diffMs <= 30 * 60 * 1000) {
        status = 'soon';
        soonCount++;
      } else {
        status = 'cooldown';
      }
    }

    const hrUnit = isEn ? ' hrs' : ' ชม.';
    return {
      ...boss,
      // ข้อมูลไทม์เมอร์ของบอสตัวนี้ (defeatedTime, nextSpawnTime, customNextSpawn)
      // - เดิมเขียนแค่ `timer,` ซึ่งตัวแปร timer ไม่ได้ถูกประกาศในฟังก์ชันนี้
      //   ทำให้เกิด ReferenceError: timer is not defined → ฟังก์ชันหยุดทำงาน → ไม่มีการ์ดบอสแสดง
      // - แก้เป็น bossTimerData[boss.id] เพื่อให้ได้ข้อมูลไทม์เมอร์ที่ถูกต้องของบอสแต่ละตัว
      timer: bossTimerData[boss.id] || {},
      nextSpawn,
      status,
      diffMs,
      respawnLabel: boss.respawnType === 'interval' ? (boss.intervalHours + hrUnit) : (boss.scheduleText || 'Fixed'),
      sourceLabel: getBossTimerSourceLabel(boss, bossTimerData[boss.id] || {}, isEn)
    };
  });

  // Update Badges
  const aliveBadge = document.getElementById('badge-boss-alive-count');
  const aliveBadgeHub = document.getElementById('badge-boss-alive-count-hub');
  [aliveBadge, aliveBadgeHub].forEach(badge => {
    if (badge) {
      if (aliveCount > 0) {
        badge.textContent = aliveCount;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
  });

  const statAlive = document.getElementById('stat-boss-alive-count');
  if (statAlive) statAlive.textContent = aliveCount;

  const statSoon = document.getElementById('stat-boss-soon-count');
  if (statSoon) statSoon.textContent = soonCount;

  const statTotal = document.getElementById('stat-boss-total-count');
  if (statTotal) statTotal.textContent = bossList.length;

  // Filter & Search
  let filtered = bossStatuses.filter(b => {
    if (currentBossFilter === 'alive' && b.status !== 'alive') return false;
    if (currentBossFilter === 'soon' && b.status !== 'soon') return false;
    if (currentBossFilter === 'cooldown' && b.status !== 'cooldown') return false;
    if (currentBossFilter === 'fixed' && b.respawnType !== 'fixed') return false;
    if (currentBossFilter === 'interval' && b.respawnType !== 'interval') return false;

    if (currentBossSearch) {
      const q = currentBossSearch.toLowerCase();
      const matchName = b.name.toLowerCase().includes(q);
      const matchMap = (b.map || '').toLowerCase().includes(q);
      const matchLv = (b.level || '').toLowerCase().includes(q);
      if (!matchName && !matchMap && !matchLv) return false;
    }
    return true;
  });

  // Sort: Alive first, then Soon, then Cooldown by nearest nextSpawn, then Unrecorded
  filtered.sort((a, b) => {
    const order = { alive: 1, soon: 2, cooldown: 3, unrecorded: 4 };
    if (order[a.status] !== order[b.status]) {
      return order[a.status] - order[b.status];
    }
    if (a.diffMs !== null && b.diffMs !== null) {
      return a.diffMs - b.diffMs;
    }
    return 0;
  });

  if (filtered.length === 0) {
    const emptyMsg = (typeof window.currentLang !== 'undefined' && window.currentLang === 'en')
      ? 'No bosses found matching your search criteria'
      : 'ไม่พบบอสที่ตรงกับเงื่อนไขการค้นหา';
    container.innerHTML = `
      <div class="col-span-full py-12 text-center text-slate-500">
        <i class="fa-solid fa-dragon text-4xl mb-2 text-slate-700"></i>
        <p class="text-xs">${emptyMsg}</p>
      </div>
    `;
    return;
  }

  let html = '';
  // Set of Guild Activity / Scoring Bosses
  const GUILD_SCORING_BOSS_IDS = new Set([
    'lucus', 'bahel', 'libitina', 'rakajeth', 'tumier', 'nevaeh', 'icaruthia', 'motti', 'guild_arena', 'camalia', 'world_boss', 'reddevil_guild_boss'
  ]);

  // ใช้ isBossTimerAdmin() เพื่อให้สอดคล้องกับเช็คสิทธิ์อื่นๆ ในโมดูล
  // (Admin ทุก role: superadmin, admin, boss_admin ควบคุมบอสไทม์เมอร์ได้)
  const isAdminActive = (typeof isBossTimerAdmin !== 'undefined' && isBossTimerAdmin());

  // Helper to identify High-Level Boss (Level >= 100 or special high-tier raids)
  function isHighLevelBoss(levelStr, bossId, bossName) {
    if (bossId === 'world_boss' || (bossName && /world boss|arene|guild boss/i.test(bossName))) return true;
    if (!levelStr) return false;
    const nums = String(levelStr).match(/\d+/g);
    if (nums && nums.some(n => Number(n) >= 100)) return true;
    return false;
  }

  // Sync toolbar admin controls
  const maintBtn = document.getElementById('btn-boss-maint-top');
  const pasteHint = document.getElementById('boss-paste-hint');
  const integrationsBtn = document.getElementById('btn-boss-integrations-top');
  const isSuperAdminActive = (typeof isSuperAdmin !== 'undefined' && isSuperAdmin);

  if (maintBtn) {
    if (isAdminActive) {
      maintBtn.classList.remove('hidden');
      maintBtn.classList.add('inline-flex');
    } else {
      maintBtn.classList.add('hidden');
      maintBtn.classList.remove('inline-flex');
    }
  }
  if (pasteHint) {
    if (isAdminActive) {
      pasteHint.classList.remove('hidden');
      pasteHint.classList.add('md:inline');
    } else {
      pasteHint.classList.add('hidden');
      pasteHint.classList.remove('md:inline');
    }
  }
  if (integrationsBtn) {
    if (isSuperAdminActive) {
      integrationsBtn.classList.remove('hidden');
      integrationsBtn.classList.add('inline-flex');
    } else {
      integrationsBtn.classList.add('hidden');
      integrationsBtn.classList.remove('inline-flex');
    }
  }

  filtered.forEach(b => {
    try {
    const isGuildActivity = GUILD_SCORING_BOSS_IDS.has(b.id) || (b.name && /lucus|bahel|libitina|rakajeth|tumier|neva|icarut|morti|motti|arena|camalia|world/i.test(b.name));
    const isHighTier = isHighLevelBoss(b.level, b.id, b.name);

    // 1. Color Palette based on Boss Tier:
    // - Guild Activity: Yellow / Gold Theme
    // - High Tier Field Boss (Lv. 100+): Red / Ruby Theme
    // - Normal Field Boss (Lv. < 100): Green / Emerald Theme
    let nameColorClass = '';
    let levelBadgeClass = '';
    let typeBadge = '';
    let avatarRingClass = '';
    let cardBaseBorder = '';
    let cardBaseBg = '';

    if (isGuildActivity) {
      nameColorClass = 'text-amber-400 font-black drop-shadow-[0_2px_8px_rgba(251,191,36,0.45)]';
      levelBadgeClass = 'bg-amber-950/90 text-amber-300 border-amber-500/60 shadow-amber-950/60';
      avatarRingClass = 'border-amber-500/60 ring-2 ring-amber-500/30 shadow-amber-950/60';
      cardBaseBorder = 'border-amber-500/40 hover:border-amber-400 shadow-amber-950/30';
      cardBaseBg = 'from-slate-900 via-slate-900/95 to-amber-950/25';
      typeBadge = `<span class="px-2.5 py-0.5 rounded-full text-[9.5px] font-black bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-sm flex items-center gap-1 shrink-0"><i class="fa-solid fa-star text-[8px] text-amber-400"></i> ${tBoss('boss_tag_guild', 'กิจกรรมกิลด์')}</span>`;
    } else if (isHighTier) {
      nameColorClass = 'text-rose-300 font-black drop-shadow-[0_2px_10px_rgba(244,63,94,0.6)]';
      levelBadgeClass = 'bg-rose-950/90 text-rose-300 border-rose-500/60 shadow-rose-950/60';
      avatarRingClass = 'border-rose-500/60 ring-2 ring-rose-500/30 shadow-rose-950/60';
      cardBaseBorder = 'border-rose-500/40 hover:border-rose-400 shadow-rose-950/30';
      cardBaseBg = 'from-slate-900 via-slate-900/95 to-rose-950/30';
      typeBadge = `<span class="px-2.5 py-0.5 rounded-full text-[9.5px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/50 shadow-sm flex items-center gap-1 shrink-0"><i class="fa-solid fa-skull-crossbones text-[8px] text-rose-400"></i> ${tBoss('boss_tag_high', 'บอสระดับสูง (Lv.100+)')}</span>`;
    } else {
      nameColorClass = 'text-emerald-300 font-black drop-shadow-[0_2px_10px_rgba(52,211,153,0.5)]';
      levelBadgeClass = 'bg-emerald-950/90 text-emerald-300 border-emerald-500/60 shadow-emerald-950/60';
      avatarRingClass = 'border-emerald-500/60 ring-2 ring-emerald-500/30 shadow-emerald-950/60';
      cardBaseBorder = 'border-emerald-500/40 hover:border-emerald-400 shadow-emerald-950/30';
      cardBaseBg = 'from-slate-900 via-slate-900/95 to-emerald-950/20';
      typeBadge = `<span class="px-2.5 py-0.5 rounded-full text-[9.5px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm flex items-center gap-1 shrink-0"><i class="fa-solid fa-shield-halved text-[8px] text-emerald-400"></i> ${tBoss('boss_tag_field', 'บอสทั่วไป')}</span>`;
    }

    // 2. Status Badge and Active Glow
    let statusBadge = '';
    let cardBorder = cardBaseBorder;
    let cardBg = cardBaseBg;
    let alertCardClass = '';

    if (b.status === 'alive') {
      alertCardClass = ' boss-card-alive-alert';
      statusBadge = `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-rose-600 text-white border border-rose-300 flex items-center gap-1.5 shadow-lg shadow-rose-600/50"><i class="fa-solid fa-circle text-[7px] text-rose-200 animate-ping"></i><span class="animate-pulse">${tBoss('boss_status_spawned', 'เกิดแล้ว (ALIVE!)')}</span></span>`;
      cardBorder = 'border-rose-500 ring-2 ring-rose-500/50 shadow-2xl shadow-rose-950/80';
    } else if (b.status === 'soon') {
      alertCardClass = ' boss-card-soon-alert';
      statusBadge = `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-yellow-500/25 text-yellow-300 border border-yellow-400 flex items-center gap-1.5 shadow-md shadow-yellow-950/60"><i class="fa-solid fa-clock text-[9px] text-yellow-400 animate-spin" style="animation-duration: 4s;"></i><span class="animate-pulse">${tBoss('boss_status_soon', 'ใกล้เกิด (<30m)')}</span></span>`;
      cardBorder = 'border-amber-400/80 ring-2 ring-amber-400/40 shadow-xl shadow-amber-950/60';
    } else if (b.status === 'cooldown') {
      statusBadge = `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40 flex items-center gap-1"><i class="fa-solid fa-hourglass-half text-[8px] text-sky-400"></i> ${tBoss('boss_status_cooldown', 'รอเกิด')}</span>`;
    } else {
      statusBadge = `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-slate-800/90 text-slate-400 border border-slate-700">⚪ ${tBoss('boss_status_unrecorded', 'ยังไม่ลงเวลา')}</span>`;
      cardBorder = 'border-slate-800 hover:border-slate-700';
    }

    const countdownText = formatCountdown(b.diffMs, b.status);
    const defeatedDate = b.timer.defeatedTime ? new Date(b.timer.defeatedTime) : null;
    const defeatedIsFuture = defeatedDate && !isNaN(defeatedDate.getTime()) && defeatedDate.getTime() > now.getTime() + 60 * 1000;
    const lastDefeatedHtml = defeatedIsFuture
      ? `<span class="text-rose-300" title="เวลาตายมากกว่าเวลาปัจจุบัน">⚠️ เวลาอนาคต</span>`
      : (defeatedDate ? formatBossLastDefeatedDisplay(defeatedDate) : '-');
    const nextSpawnHtml = b.nextSpawn ? formatBossNextSpawnDisplay(b.nextSpawn) : (b.respawnType === 'interval' ? `<span class="text-slate-500 text-[10.5px]">${tBoss('boss_wait_record', 'รอลงเวลาตาย')}</span>` : '-');

    // Boss Profile Avatar Thumbnail
    const avatarHtml = b.avatar
      ? `<img src="${escapeHtml(b.avatar)}" alt="${escapeHtml(b.name)}" class="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl object-cover border ${avatarRingClass} shadow-lg bg-slate-900 shrink-0" onerror="this.onerror=null; this.src=''; this.parentElement.innerHTML='<div class=\\'w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-slate-800 border ${avatarRingClass} flex items-center justify-center text-xl text-amber-400\\'><i class=\\'fa-solid fa-dragon\\'></i></div>';" />`
      : `<div class="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 border ${avatarRingClass} flex items-center justify-center text-xl sm:text-2xl text-amber-400/90 shadow-inner shrink-0"><i class="fa-solid fa-dragon"></i></div>`;

    // Action Buttons: Admin gets Kill Confirm + Edit + Drop Log; Member gets View Drop Log only
    let actionButtonsHtml = '';
    if (isAdminActive) {
      actionButtonsHtml = `
        <div class="mt-3.5 pt-2.5 border-t border-slate-800/80 flex items-center gap-2">
          <button onclick="copyBossInfo('${escapeHtml(b.id)}')"
            class="apple-btn apple-btn-sapphire inline-flex items-center justify-center p-2 text-xs font-semibold"
            title="${isEn ? 'Copy boss name, map and spawn time' : 'คัดลอกชื่อบอส แมพ และเวลาเกิด'}">
            <i class="fa-solid fa-copy"></i>
          </button>
          <button onclick="openBossKillConfirmModal('${b.id}')"
            class="flex-1 apple-btn apple-btn-ruby inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold shadow-md shadow-rose-950/40 active:scale-95 transition"
            title="${tBoss('btn_record_kill_now', 'กดเพื่อยืนยันลงเวลาตาย / วางรูปภาพ Log (Ctrl+V)')}">
            <i class="fa-solid fa-skull text-[11px]"></i>
            <span>${tBoss('btn_record_kill_now', 'ตายตอนนี้')}</span>
          </button>
          <button onclick="openEditBossModal('${b.id}')"
            class="apple-btn apple-btn-slate inline-flex items-center justify-center p-2 text-xs font-semibold text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
            title="${tBoss('btn_edit_boss', 'แก้ไขข้อมูล & เพิ่มรูปโปรไฟล์บอส')}">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button onclick="openBossDropLogModal('${b.id}')"
            class="apple-btn apple-btn-amber inline-flex items-center justify-center p-2 text-xs font-semibold"
            title="${tBoss('btn_drop_logs', 'ดู / บันทึกประวัติของดรอป')}">
            <i class="fa-solid fa-gift"></i>
          </button>
        </div>
      `;
    } else {
      actionButtonsHtml = `
        <div class="mt-3 pt-2.5 border-t border-slate-800/80">
          <button onclick="copyBossInfo('${escapeHtml(b.id)}')"
            class="apple-btn apple-btn-sapphire inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold"
            title="${isEn ? 'Copy boss name, map and spawn time' : 'คัดลอกชื่อบอส แมพ และเวลาเกิด'}">
            <i class="fa-solid fa-copy"></i><span>${isEn ? 'Copy' : 'คัดลอก'}</span>
          </button>
          <button onclick="openBossDropLogModal('${b.id}')"
            class="flex-1 apple-btn apple-btn-slate inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold text-slate-300 hover:text-white"
            title="${tBoss('btn_drop_logs', 'ดูประวัติไอเทมดรอปของบอสตัวนี้')}">
            <i class="fa-solid fa-gift text-amber-400 text-xs"></i>
            <span>${tBoss('btn_drop_logs', 'ดูประวัติไอเทมดรอป')}</span>
          </button>
        </div>
      `;
    }

    // คลาสพิเศษสำหรับการ์ดบอสกิจกรรม (กิจกรรมกิลด์) เพื่อใช้ปรับสไตล์ "การ์เดี้ยน" เฉพาะการ์ดนี้
    const guildCardClass = isGuildActivity ? ' boss-card-guild' : '';

    html += `
      <div id="boss-card-${b.id}" class="boss-card${guildCardClass}${alertCardClass} relative flex flex-col justify-between bg-gradient-to-b ${cardBg} border ${cardBorder} rounded-3xl p-4 shadow-xl backdrop-blur-md transition hover:scale-[1.015] duration-200">
        <div>
          <!-- Top Row: Type & Status Badges -->
          <div class="flex items-center justify-between gap-1.5 mb-2.5">
            ${typeBadge}
            <div id="boss-status-badge-${b.id}">${statusBadge}</div>
          </div>

          <!-- Header with Avatar & Boss Details -->
          <div class="flex items-start gap-3 mb-2">
            <div class="relative cursor-pointer group/avatar shrink-0" onclick="${isAdminActive ? `openEditBossModal('${b.id}')` : `openBossDropLogModal('${b.id}')`}" title="${isAdminActive ? 'คลิกเพื่อแก้ไขรูปโปรไฟล์บอส' : escapeHtml(b.name)}">
              ${avatarHtml}
              ${isAdminActive ? `<div class="absolute inset-0 bg-black/60 rounded-2xl opacity-0 group-hover/avatar:opacity-100 flex items-center justify-center text-white text-xs transition"><i class="fa-solid fa-camera"></i></div>` : ''}
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5 mb-1">
                <span class="text-[10.5px] font-mono font-black px-2 py-0.5 rounded-lg border shadow-inner ${levelBadgeClass}">Lv.${escapeHtml(b.level || '??')}</span>
                <span class="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-slate-800/80 text-slate-400 border border-slate-700 truncate max-w-[170px]" title="${escapeHtml(b.sourceLabel)}">${escapeHtml(b.sourceLabel)}</span>
              </div>
              <h4 class="text-lg sm:text-xl font-black tracking-tight leading-snug truncate ${nameColorClass}" title="${escapeHtml(b.name)}">
                ${escapeHtml(b.name)}
              </h4>
              <p class="text-[11.5px] text-slate-300 flex items-center gap-1 mt-1 font-semibold">
                <i class="fa-solid fa-location-dot text-amber-400 text-[10px]"></i>
                <span class="truncate">${escapeHtml(b.map || (isEn ? 'Unassigned map' : 'ไม่ระบุแมพ'))}</span>
              </p>
            </div>
          </div>

          <!-- Countdown Big Box (High Contrast & Clear Typography) -->
          <div class="my-3 p-3 rounded-2xl bg-slate-950/90 border border-slate-800 shadow-inner text-center">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">${tBoss('boss_countdown_label', 'นับถอยหลัง')}</span>
            <div id="boss-cd-${b.id}" class="text-lg sm:text-xl font-black font-mono tracking-wider ${b.status === 'alive' ? 'boss-countdown-alive animate-pulse' : b.status === 'soon' ? 'boss-countdown-soon animate-pulse' : b.status === 'cooldown' ? 'text-sky-300' : 'text-slate-500'}">
              ${countdownText}
            </div>
          </div>

          <!-- Metadata Grid (24-Hour Timestamps with Today / Tomorrow) -->
          <div class="grid grid-cols-2 gap-2 text-[11px] text-slate-300 pt-2.5 border-t border-slate-800/80">
            <div class="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/80 shadow-inner flex flex-col items-center justify-center text-center">
              <span class="text-slate-400 block text-[9.5px] font-bold mb-0.5">${tBoss('boss_respawn_cycle_label', 'ระยะเกิด:')}</span>
              <span class="font-black text-amber-300 font-mono text-xs sm:text-[13px] tracking-wide">${escapeHtml(b.respawnLabel)}</span>
            </div>
            <div class="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/80 shadow-inner flex flex-col items-center justify-center text-center">
              <span class="text-slate-400 block text-[9.5px] font-bold mb-0.5">${tBoss('boss_respawn_time_label', 'เกิดรอบถัดไป:')}</span>
              <div id="boss-next-${b.id}" class="font-mono flex items-center justify-center flex-wrap leading-tight text-center w-full">${nextSpawnHtml}</div>
            </div>
            <div class="col-span-2 text-slate-400 flex items-center justify-between text-[10.5px] pt-1 px-1">
              <span>${tBoss('boss_defeated_time_label', 'ตายล่าสุด:')} <span class="font-mono">${lastDefeatedHtml}</span></span>
              ${b.note ? `<span class="text-amber-400/90 truncate max-w-[140px] font-medium" title="${escapeHtml(b.note)}">ℹ️ ${escapeHtml(b.note)}</span>` : ''}
            </div>
          </div>
        </div>

        <!-- Action Buttons (Role-based) -->
        ${actionButtonsHtml}
      </div>
    `;
    } catch (error) {
      console.error('[Boss Timer] Failed to render boss card:', b && b.id, error);
      html += `<div class="boss-card relative bg-slate-900 border border-slate-700 rounded-2xl p-4"><h4 class="text-lg font-black text-white">${escapeHtml((b && b.name) || 'Unknown Boss')}</h4><p class="text-xs text-slate-400 mt-1">${escapeHtml((b && b.map) || '')}</p></div>`;
    }
  });

  container.innerHTML = html;
}

async function copyBossInfo(bossId) {
  const boss = bossList.find(item => item.id === bossId);
  if (!boss) return;
  const nextSpawn = getBossNextSpawn(boss);
  const isEn = (typeof window.currentLang !== 'undefined' && window.currentLang === 'en');
  const map = boss.map || (isEn ? 'Unassigned map' : 'ไม่ระบุแมพ');
  let timeText = isEn ? 'Spawn time not set' : 'ยังไม่ลงเวลาเกิด';
  if (nextSpawn && !isNaN(nextSpawn.getTime())) {
    const parts = getBangkokDateParts(nextSpawn);
    const pad = n => String(n).padStart(2, '0');
    timeText = pad(parts.day) + '/' + pad(parts.month) + ' ' + pad(parts.hour) + ':' + pad(parts.minute) + (isEn ? '' : ' น.');
  }
  const text = isEn
    ? boss.name + ' | ' + map + ' | Spawn ' + timeText
    : boss.name + ' | ' + map + ' | เกิด ' + timeText;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const area = document.createElement('textarea');
      area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.appendChild(area); area.focus(); area.select();
      document.execCommand('copy'); area.remove();
    }
    if (typeof showToast === 'function') showToast(isEn ? 'Boss information copied.' : 'คัดลอกข้อมูลบอสแล้ว', 'success');
  } catch (error) {
    if (typeof showToast === 'function') showToast(isEn ? 'Could not copy boss information.' : 'คัดลอกข้อมูลไม่สำเร็จ', 'warning');
  }
}

// Format Countdown
function formatCountdown(diffMs, status) {
  if (status === 'unrecorded' || diffMs === null) {
    return '--:--:--';
  }

  if (status === 'alive') {
    const elapsedSec = Math.abs(Math.floor(diffMs / 1000));
    const h = Math.floor(elapsedSec / 3600);
    const m = Math.floor((elapsedSec % 3600) / 60);
    const s = elapsedSec % 60;
    return `SPAWNED (+${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')})`;
  }

  if (diffMs <= 0 || isNaN(diffMs)) return '--:--:--';

  const totalSec = Math.floor(diffMs / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  const isEn = (typeof window.currentLang !== 'undefined' && window.currentLang === 'en');
  const dUnit = isEn ? 'd ' : ' วัน ';
  if (d > 0) {
    return `${d}${dUnit}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Format DateTime Short (24-Hour Format: DD/MM HH:MM น.)
function formatDateTimeShort(d) {
  if (!d || isNaN(d.getTime())) return '-';
  const isEn = (typeof window.currentLang !== 'undefined' && window.currentLang === 'en');
  const pad = n => String(n).padStart(2, '0');
  const bangkok = getBangkokDateParts(d);
  const day = pad(bangkok.day);
  const month = pad(bangkok.month);
  const hours = pad(bangkok.hour);
  const min = pad(bangkok.minute);
  return `${day}/${month} ${hours}:${min}${isEn ? '' : ' น.'}`;
}

// Format Next Spawn Display (Supports Today / Tomorrow / Date & TH / EN with High-Contrast Typography)
function formatBossNextSpawnDisplay(d) {
  if (!d || isNaN(d.getTime())) return '-';
  const isEn = (typeof window.currentLang !== 'undefined' && window.currentLang === 'en');
  const now = getBossNow();

  const pad = n => String(n).padStart(2, '0');
  const targetBangkok = getBangkokDateParts(d);
  const nowBangkok = getBangkokDateParts(now);
  const hours = pad(targetBangkok.hour);
  const min = pad(targetBangkok.minute);
  const timeStr = `${hours}:${min}${isEn ? '' : ' น.'}`;

  // Calculate day difference
  const today = Date.UTC(nowBangkok.year, nowBangkok.month - 1, nowBangkok.day);
  const targetDay = Date.UTC(targetBangkok.year, targetBangkok.month - 1, targetBangkok.day);
  const diffDays = Math.round((targetDay - today) / (24 * 60 * 60 * 1000));

  let dayPrefixHtml = '';
  if (diffDays === 0) {
    dayPrefixHtml = `<span class="text-amber-300 font-extrabold mr-1 text-[11px]">${isEn ? 'Today' : 'วันนี้'}</span>`;
  } else if (diffDays === 1) {
    dayPrefixHtml = `<span class="text-sky-300 font-extrabold mr-1 text-[11px]">${isEn ? 'Tomorrow' : 'พรุ่งนี้'}</span>`;
  } else if (diffDays === -1) {
    dayPrefixHtml = `<span class="text-rose-400 font-extrabold mr-1 text-[11px]">${isEn ? 'Yesterday' : 'เมื่อวาน'}</span>`;
  } else {
    const day = pad(targetBangkok.day);
    const month = pad(targetBangkok.month);
    dayPrefixHtml = `<span class="text-slate-300 font-bold mr-1 text-[11px]">${day}/${month}</span>`;
  }

  return `${dayPrefixHtml}<span class="text-emerald-400 font-black text-xs sm:text-[13px] tracking-wide drop-shadow-[0_0_6px_rgba(52,211,153,0.35)]">${timeStr}</span>`;
}

// Format Last Defeated Display (Today / Yesterday / Date)
function formatBossLastDefeatedDisplay(d) {
  if (!d || isNaN(d.getTime())) return '-';
  const isEn = (typeof window.currentLang !== 'undefined' && window.currentLang === 'en');
  const now = getBossNow();

  const pad = n => String(n).padStart(2, '0');
  const targetBangkok = getBangkokDateParts(d);
  const nowBangkok = getBangkokDateParts(now);
  const hours = pad(targetBangkok.hour);
  const min = pad(targetBangkok.minute);
  const timeStr = `${hours}:${min}${isEn ? '' : ' น.'}`;

  const today = Date.UTC(nowBangkok.year, nowBangkok.month - 1, nowBangkok.day);
  const targetDay = Date.UTC(targetBangkok.year, targetBangkok.month - 1, targetBangkok.day);
  const diffDays = Math.round((targetDay - today) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) {
    return `<span class="text-slate-300 font-semibold">${isEn ? 'Today' : 'วันนี้'}</span> <span class="font-bold text-slate-100">${timeStr}</span>`;
  } else if (diffDays === -1) {
    return `<span class="text-slate-400">${isEn ? 'Yesterday' : 'เมื่อวาน'}</span> <span class="font-bold text-slate-200">${timeStr}</span>`;
  } else {
    const day = pad(targetBangkok.day);
    const month = pad(targetBangkok.month);
    return `<span class="text-slate-400">${day}/${month}</span> <span class="font-bold text-slate-200">${timeStr}</span>`;
  }
}

// Update Active Countdowns Every Second
function updateCountdowns() {
  if (activeAppModule !== 'boss_timer') return;
  const now = getBossNow();
  bossList.forEach(boss => {
    const cdEl = document.getElementById(`boss-cd-${boss.id}`);
    if (!cdEl) return;

    // ใช้ helper getBossNextSpawn() เพื่อรวมตรรกะคำนวณเวลากำเนิดไว้ที่เดียว
    let nextSpawn = getBossNextSpawn(boss);
    if (!nextSpawn || isNaN(nextSpawn.getTime())) {
      cdEl.textContent = '--:--:--';
      cdEl.className = "text-base sm:text-lg font-black font-mono tracking-wider text-slate-500";
      return;
    }

    const diffMs = nextSpawn.getTime() - now.getTime();
    let status = 'cooldown';
    if (diffMs <= 0) {
      status = 'alive';
    } else if (diffMs <= 30 * 60 * 1000) {
      status = 'soon';
    }

    cdEl.textContent = formatCountdown(diffMs, status);

    const cardEl = document.getElementById(`boss-card-${boss.id}`);
    if (cardEl) {
      if (status === 'alive') {
        if (!cardEl.classList.contains('boss-card-alive-alert')) {
          cardEl.classList.add('boss-card-alive-alert');
          cardEl.classList.remove('boss-card-soon-alert');
        }
      } else if (status === 'soon') {
        if (!cardEl.classList.contains('boss-card-soon-alert')) {
          cardEl.classList.add('boss-card-soon-alert');
          cardEl.classList.remove('boss-card-alive-alert');
        }
      } else {
        cardEl.classList.remove('boss-card-alive-alert', 'boss-card-soon-alert');
      }
    }

    if (status === 'alive') {
      cdEl.className = "text-lg sm:text-xl font-black font-mono tracking-wider boss-countdown-alive animate-pulse";
    } else if (status === 'soon') {
      cdEl.className = "text-lg sm:text-xl font-black font-mono tracking-wider boss-countdown-soon animate-pulse";
    } else {
      cdEl.className = "text-lg sm:text-xl font-black font-mono tracking-wider text-sky-300";
    }
  });
}

// Update Upcoming Boss in Main Header / Toolbar Widget
function updateUpcomingBossWidget() {
  const nameEl = document.getElementById('widget-boss-name');
  const locEl = document.getElementById('widget-boss-loc');
  const timerTextEl = document.getElementById('widget-boss-timer-text');
  const timerBadgeEl = document.getElementById('widget-boss-timer');
  const genericTextWidget = document.getElementById('upcoming-boss-text');

  const now = getBossNow();
  const recordedBosses = [];

  bossList.forEach(b => {
    // ใช้ helper getBossNextSpawn() เพื่อรวมตรรกะคำนวณเวลากำเนิดไว้ที่เดียว
    let nextSpawn = getBossNextSpawn(b);
    if (nextSpawn && !isNaN(nextSpawn.getTime())) {
      const diffMs = nextSpawn.getTime() - now.getTime();
      recordedBosses.push({ boss: b, nextSpawn, diffMs });
    }
  });

  const isEn = (typeof window.currentLang !== 'undefined' && window.currentLang === 'en');

  if (recordedBosses.length === 0) {
    if (nameEl) nameEl.textContent = isEn ? 'No Boss Timers' : 'ยังไม่มีข้อมูลบอส';
    if (locEl) locEl.textContent = isEn ? 'Click to open timer' : 'คลิกเพื่อดูไทม์เมอร์';
    if (timerTextEl) timerTextEl.textContent = '--:--:--';
    if (genericTextWidget) genericTextWidget.innerHTML = `<span class="text-slate-400">⏱️ ${isEn ? 'Boss Timer (Ready)' : 'บอสไทม์เมอร์ (พร้อมใช้งาน)'}</span>`;
    return;
  }

  // Find nearest
  recordedBosses.sort((a, b) => a.diffMs - b.diffMs);
  const nearest = recordedBosses[0];

  if (nameEl) {
    nameEl.textContent = `${nearest.boss.name}${nearest.boss.level ? ` (Lv.${nearest.boss.level})` : ''}`;
  }
  if (locEl) {
    locEl.textContent = nearest.boss.map ? `• ${nearest.boss.map}` : '';
  }

  if (timerTextEl) {
    if (nearest.diffMs <= 0) {
      timerTextEl.textContent = isEn ? 'SPAWNED!' : 'เกิดแล้ว!';
      if (timerBadgeEl) {
        timerBadgeEl.className = "flex items-center gap-1.5 font-mono font-black text-white bg-rose-600 border border-rose-400 px-2.5 py-0.5 rounded-full text-xs shadow-inner animate-pulse";
      }
    } else if (nearest.diffMs <= 30 * 60 * 1000) {
      timerTextEl.textContent = formatCountdown(nearest.diffMs, 'soon');
      if (timerBadgeEl) {
        timerBadgeEl.className = "flex items-center gap-1.5 font-mono font-black text-amber-300 bg-slate-900/95 border border-amber-500/50 px-2.5 py-0.5 rounded-full text-xs shadow-inner shadow-amber-500/20 animate-pulse";
      }
    } else {
      timerTextEl.textContent = formatCountdown(nearest.diffMs, 'cooldown');
      if (timerBadgeEl) {
        timerBadgeEl.className = "flex items-center gap-1.5 font-mono font-black text-amber-300 bg-slate-900/95 border border-amber-500/50 px-2.5 py-0.5 rounded-full text-xs shadow-inner shadow-amber-500/20";
      }
    }
  }

  if (genericTextWidget) {
    if (nearest.diffMs <= 0) {
      genericTextWidget.innerHTML = `<span class="text-rose-400 font-bold animate-pulse">🔴 ${escapeHtml(nearest.boss.name)} ${isEn ? 'SPAWNED!' : 'เกิดแล้ว!'}</span>`;
    } else if (nearest.diffMs <= 30 * 60 * 1000) {
      genericTextWidget.innerHTML = `<span class="text-amber-300 font-bold animate-pulse">🟡 ${escapeHtml(nearest.boss.name)} ${isEn ? 'in' : 'ใน'} ${formatCountdown(nearest.diffMs, 'soon')}</span>`;
    } else {
      genericTextWidget.innerHTML = `<span class="text-slate-300">⏳ ${isEn ? 'Next Boss:' : 'บอสถัดไป:'} <strong>${escapeHtml(nearest.boss.name)}</strong> (${formatCountdown(nearest.diffMs, 'cooldown')})</span>`;
    }
  }
}

// Record Boss Kill (Now) -> Protected by Double-Check Modal
function recordBossKillNow(bossId) {
  const boss = bossList.find(b => b.id === bossId);
  if (!boss) return;

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const killerEmail = (typeof currentAdminEmail !== 'undefined' ? currentAdminEmail : 'Admin');

  pendingKillConfirmData = {
    bossId: bossId,
    bossName: boss.name,
    bossMap: boss.map || '-',
    bossIcon: boss.icon || '🐉',
    bossImage: boss.avatar || '',
    killDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    killHour: pad(now.getHours()),
    killMin: pad(now.getMinutes()),
    killDateTime: now,
    killerEmail: killerEmail,
    itemsList: []
  };

  openBossDoubleCheckModal(pendingKillConfirmData);
}

// Send Boss Kill Log row to Google Sheets via Webhook (Background Async)
// - ส่ง kill_log ทุกครั้งที่ลงเวลาบอสตาย (รวมถึงเมื่อไม่มีไอเทมดรอป)
// - ส่ง drop_log เพิ่มเติมเมื่อมีไอเทมดรอป (เพื่อบันทึกรายละเอียดไอเทม)
function sendKillLogToGoogleSheet(logData) {
  if (!bossSheetWebhookUrl) return;
  if (!logData) return;

  const dropItems = Array.isArray(logData.dropItems) ? logData.dropItems : [];
  const killTimeStr = logData.killTimeFormatted || (logData.killTime ? formatDateTimeShort(new Date(logData.killTime)) : '-');
  const timestampStr = logData.timestampStr || formatDateTimeShort(new Date());

  try {
    // 1. ส่ง kill_log ทุกครั้ง (บันทึกการลงเวลาตายของบอส)
    const killPayload = {
      action: 'kill_log',
      bossId: logData.bossId || '',
      bossName: logData.bossName || '',
      level: logData.level || '-',
      map: logData.map || '-',
      killTime: killTimeStr,
      nextSpawnTime: logData.nextSpawnFormatted || '-',
      recordedBy: logData.recordedBy || 'Admin',
      timestamp: timestampStr,
      dropItems: dropItems,
      dropItemsText: logData.dropItemsText || (dropItems.length > 0 ? dropItems.join(', ') : '-'),
      itemsCount: dropItems.length
    };

    fetch(bossSheetWebhookUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(killPayload)
    }).catch(err => console.warn('Google Sheet kill_log send error:', err));

    // 2. ส่ง drop_log เพิ่มเติมเฉพาะเมื่อมีไอเทมดรอป (เพื่อบันทึกรายละเอียดไอเทมแต่ละชิ้น)
    if (dropItems.length > 0) {
      const dropPayload = {
        action: 'drop_log',
        bossId: logData.bossId || '',
        bossName: logData.bossName || '',
        map: logData.map || '-',
        killTime: killTimeStr,
        recordedBy: logData.recordedBy || 'Admin',
        timestamp: timestampStr,
        dropItems: dropItems,
        dropItemsText: logData.dropItemsText || dropItems.join(', '),
        itemsCount: dropItems.length,
        // Array of detailed rows for Google Apps Script to loop appendRow
        rows: dropItems.map(item => ({
          timestamp: timestampStr,
          bossName: logData.bossName || '',
          map: logData.map || '-',
          killTime: killTimeStr,
          item: item,
          recordedBy: logData.recordedBy || 'Admin'
        }))
      };

      fetch(bossSheetWebhookUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dropPayload)
      }).catch(err => console.warn('Google Sheet drop_log send error:', err));
    }
  } catch (e) {
    console.warn('Google Sheet Webhook exception:', e);
  }
}

// Save Boss Kill Time & Create History Log (Firebase + Google Sheets)
function saveBossKillTime(bossId, killTimeISO, killerEmail, dropItemsList) {
  const boss = bossList.find(b => b.id === bossId);
  if (!boss) return;

  const defDate = new Date(killTimeISO);
  let nextSpawn = null;
  if (boss.respawnType === 'interval') {
    nextSpawn = new Date(defDate.getTime() + (boss.intervalHours * 3600 * 1000));
  } else {
    nextSpawn = calculateNextSpawnDate(boss, killTimeISO);
  }

  // 1. Update Boss Active Status
  bossTimerData[bossId] = {
    defeatedTime: killTimeISO,
    nextSpawnTime: nextSpawn ? nextSpawn.toISOString() : null,
    recordedBy: killerEmail || 'Admin',
    updatedAt: new Date().toISOString()
  };

  localStorage.setItem('guild_boss_timers', JSON.stringify(bossTimerData));
  if (typeof fbDb !== 'undefined' && fbDb) {
    // ใช้ .update() เฉพาะ key ของบอสตัวนี้ แทน .set() ทั้ง object
    // เพื่อลด race condition เมื่อ Admin หลายคนลงเวลาตายพร้อมกัน
    // (การ .set() ทั้ง object จะเขียนทับข้อมูลของบอสตัวอื่นที่เพิ่งถูกแก้ไข)
    fbDb.ref('guild_app/boss_timers/' + bossId).update(bossTimerData[bossId]);
  }

  // 2. Append to Boss Kill History Log (Capped at 200 items)
  const killLogEntry = {
    id: 'kill_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    bossId: boss.id,
    bossName: boss.name,
    level: boss.level || '-',
    map: boss.map || '-',
    killTime: killTimeISO,
    killTimeFormatted: formatDateTimeShort(defDate),
    nextSpawnTime: nextSpawn ? nextSpawn.toISOString() : null,
    nextSpawnFormatted: nextSpawn ? formatDateTimeShort(nextSpawn) : '-',
    recordedBy: killerEmail || 'Admin',
    timestamp: new Date().toISOString(),
    timestampStr: formatDateTimeShort(new Date()),
    dropItems: dropItemsList || [],
    dropItemsText: (dropItemsList && dropItemsList.length > 0) ? dropItemsList.join(', ') : '-'
  };

  bossKillLogs.unshift(killLogEntry);
  if (bossKillLogs.length > 200) bossKillLogs = bossKillLogs.slice(0, 200);
  localStorage.setItem('guild_boss_kill_logs', JSON.stringify(bossKillLogs));
  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref('guild_app/boss_kill_logs').set(bossKillLogs);
  }

  // 3. Send row to Google Sheets (Background Async)
  sendKillLogToGoogleSheet(killLogEntry);

  // 4. ส่งการ์ดแจ้งเตือน Discord เมื่อลงเวลาบอสตาย (Background Async)
  // - ฟังก์ชันนี้จะเช็คสถานะเปิด/ปิด (bossKillDiscordEnabled) และ Webhook URL เอง
  // - ถ้าปิดการแจ้งเตือนหรือยังไม่ได้ตั้ง Webhook URL ฟังก์ชันจะข้ามไปโดยอัตโนมัติ
  sendBossKillDiscordAlert(killLogEntry);

  if (typeof addAuditLog === 'function') {
    addAuditLog('boss_kill', `ลงเวลาตายบอส "${boss.name}"`, `เวลา: ${formatDateTimeShort(defDate)} โดย: ${killerEmail}`, 'BossTimer');
  }

  renderBossTimerCards();
  updateUpcomingBossWidget();
  renderBossKillHistoryList();
}

// Populate all 24-hour selects across modals
function populate24HourSelects() {
  const pad = n => String(n).padStart(2, '0');
  const hourOptions = Array.from({ length: 24 }, (_, i) => `<option value="${pad(i)}">${pad(i)}</option>`).join('');
  const minOptions = Array.from({ length: 60 }, (_, i) => `<option value="${pad(i)}">${pad(i)}</option>`).join('');

  document.querySelectorAll('.picker-hour-select').forEach(sel => {
    if (sel.children.length === 0) sel.innerHTML = hourOptions;
  });
  document.querySelectorAll('.picker-min-select').forEach(sel => {
    if (sel.children.length === 0) sel.innerHTML = minOptions;
  });
}

// ================= Boss Kill Confirmation Modal with Optional Drop Log (Ctrl+V) =================
let currentKillConfirmBossId = null;
let killConfirmImageBlob = null;
let isBossLockedFromCard = false;

function updateKillConfirmBossHeader(bossId) {
  currentKillConfirmBossId = bossId;
  const boss = bossList.find(b => b.id === bossId) || { name: bossId || 'ไม่ระบุ', level: '??', map: 'ไม่ระบุ', respawnLabel: 'ตามเงื่อนไข' };

  const nameText = document.getElementById('kill-confirm-boss-name-text');
  const levelBadge = document.getElementById('kill-confirm-boss-level-badge');
  const desc = document.getElementById('kill-confirm-desc');
  const avatarBox = document.getElementById('kill-confirm-avatar-box');
  const headerTag = document.getElementById('kill-confirm-header-tag');

  if (headerTag) {
    headerTag.textContent = isBossLockedFromCard ? '🐉 ยืนยันลงเวลาตาย' : '📸 สแกน Log / บันทึกบอส';
  }
  if (nameText) nameText.textContent = boss.name;
  if (levelBadge) levelBadge.textContent = `Lv.${boss.level || '??'}`;
  if (desc) desc.textContent = `แมพ: ${boss.map || 'ไม่ระบุ'} • รอบเกิด: ${boss.respawnLabel || 'ตามเงื่อนไข'}`;

  if (avatarBox) {
    if (boss.avatar) {
      avatarBox.innerHTML = `<img src="${escapeHtml(boss.avatar)}" class="w-full h-full rounded-2xl object-cover" />`;
    } else {
      avatarBox.innerHTML = `<i class="fa-solid fa-skull"></i>`;
    }
  }
}

function openBossKillConfirmModal(bossId) {
  // เช็คสิทธิ์: เฉพาะ Admin เท่านั้นที่เปิดบันทึกเวลาบอสได้
  if (typeof isBossTimerAdmin !== 'undefined' && !isBossTimerAdmin()) {
    showToast('เฉพาะ Admin เท่านั้นที่สามารถบันทึกเวลาบอสได้ค่ะ', 'warning');
    return;
  }
  if (!bossId) {
    showToast('กรุณาเลือกบอสที่ต้องการบันทึกเวลา', 'warning');
    return;
  }
  populate24HourSelects();

  currentKillConfirmBossId = bossId;
  updateKillConfirmBossHeader(bossId);

  // Reset image / drop items
  clearKillConfirmImage();
  applyQuickKillConfirmTime(0); // Default to current time

  const modal = document.getElementById('boss-kill-confirm-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeBossKillConfirmModal() {
  const modal = document.getElementById('boss-kill-confirm-modal');
  if (modal) modal.classList.add('hidden');
  clearKillConfirmImage();
  currentKillConfirmBossId = null;
  isBossLockedFromCard = false;
}

function applyQuickKillConfirmTime(minutesAgo) {
  populate24HourSelects();
  const dateInput = document.getElementById('kill-confirm-date');
  const hourSelect = document.getElementById('kill-confirm-hour');
  const minSelect = document.getElementById('kill-confirm-min');
  if (!dateInput || !hourSelect || !minSelect) return;

  const targetDate = new Date(Date.now() - (minutesAgo * 60 * 1000));
  const pad = n => String(n).padStart(2, '0');

  dateInput.value = `${targetDate.getFullYear()}-${pad(targetDate.getMonth() + 1)}-${pad(targetDate.getDate())}`;
  hourSelect.value = pad(targetDate.getHours());
  minSelect.value = pad(targetDate.getMinutes());
}

function handleKillConfirmFileSelect(input) {
  if (!input || !input.files || !input.files[0]) return;
  processKillConfirmImage(input.files[0]);
}

async function processKillConfirmImage(file) {
  if (!file) return;
  killConfirmImageBlob = file;

  const emptyBox = document.getElementById('kill-confirm-dropzone-empty');
  const filledBox = document.getElementById('kill-confirm-dropzone-filled');
  const previewImg = document.getElementById('kill-confirm-preview-img');
  const statusEl = document.getElementById('kill-confirm-ocr-status');
  const itemsBox = document.getElementById('kill-confirm-items-box');

  if (emptyBox) emptyBox.classList.add('hidden');
  if (filledBox) filledBox.classList.remove('hidden');
  if (previewImg) previewImg.src = URL.createObjectURL(file);
  if (statusEl) {
    statusEl.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles fa-spin text-amber-400"></i> กำลังอ่านเวลาและไอเทมดรอปจากภาพ...`;
  }

  // Priority 1: Gemini Vision if configured (Extracts ONLY killTime & dropItems)
  if (bossGeminiApiKey) {
    try {
      if (statusEl) {
        statusEl.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles fa-spin text-purple-400"></i> AI กำลังอ่านเวลาตายและของดรอป...`;
      }
      const { base64Str, mimeType } = await compressImageForGemini(file, 1600, 0.88);

      const prompt = `You are a specialized game log OCR and data extractor for the MMORPG 'LORD NINE' (LORDNINE / ลอร์ดไนน์).
Examine this screenshot of the game's drop / kill chat log.

### Extraction Rules:
1. 'killTime': Extract the 24-hour timestamp from the log line (e.g. '09:51', '19:46', '21:17').
2. 'dropItems': Extract EVERY item dropped in the screenshot. Format: "{ItemName} (ผู้รับ: {PlayerName})"

Output strictly valid JSON with no markdown wrapping:
{
  "killTime": "HH:MM",
  "killDate": "YYYY-MM-DD or null",
  "dropItems": ["Item name and receiver"]
}`;

      const data = await callGeminiVisionApiWithFallback(prompt, base64Str, mimeType, bossGeminiApiKey);
      applyExtractedBossData(data);
      return;
    } catch (geminiErr) {
      console.warn('Gemini Vision failed in Kill Confirm, fallback to local OCR:', geminiErr);
    }
  }

  // Priority 2: Canvas Pre-processing + Tesseract
  try {
    const processedBlob = await preprocessImageCanvas(file);
    if (typeof Tesseract === 'undefined') {
      await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
    }

    const { data: { text } } = await Tesseract.recognize(processedBlob, 'tha+eng', {
      logger: m => {
        if (statusEl && m.status === 'recognizing text') {
          statusEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-amber-400"></i> กำลังอ่านข้อความ (${Math.round(m.progress * 100)}%)...`;
        }
      }
    });

    const parsed = normalizeAndCleanThaiDropLog(text);
    applyExtractedBossData({
      killTime: parsed.timeMatch,
      killDate: parsed.dateMatch,
      dropItems: parsed.items.length > 0 ? parsed.items : text.split('\n').filter(l => l.trim().length > 3).slice(0, 5)
    });
  } catch (err) {
    console.warn('Kill Confirm OCR Error:', err);
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-amber-400 text-xs">อ่านภาพไม่สำเร็จ แต่ยังสามารถระบุเวลาและของดรอปได้ตามปกติ</span>`;
    }
    if (itemsBox) itemsBox.classList.remove('hidden');
  }
}

function applyExtractedBossData(data) {
  const statusEl = document.getElementById('kill-confirm-ocr-status');
  const itemsBox = document.getElementById('kill-confirm-items-box');
  const itemsText = document.getElementById('kill-confirm-items-text');
  const hourSelect = document.getElementById('kill-confirm-hour');
  const minSelect = document.getElementById('kill-confirm-min');
  const dateInput = document.getElementById('kill-confirm-date');

  // Boss is 100% FIXED to the clicked card
  if (currentKillConfirmBossId) {
    updateKillConfirmBossHeader(currentKillConfirmBossId);
  }

  // 1. Set Time & Date
  if (data.killTime && data.killTime.includes(':')) {
    const [hh, mm] = data.killTime.split(':');
    const pad = n => String(n).padStart(2, '0');
    if (hourSelect) hourSelect.value = pad(Number(hh));
    if (minSelect) minSelect.value = pad(Number(mm));
  }
  if (data.killDate && dateInput) {
    dateInput.value = data.killDate;
  }

  // 2. Set Drop Items
  if (itemsBox) itemsBox.classList.remove('hidden');
  if (itemsText) {
    if (Array.isArray(data.dropItems) && data.dropItems.length > 0) {
      itemsText.value = data.dropItems.join('\n');
      if (statusEl) statusEl.innerHTML = `<span class="text-emerald-400 font-bold"><i class="fa-solid fa-check-circle"></i> ตรวจพบไอเทม ${data.dropItems.length} รายการ (ตรวจสอบหรือแก้ไขได้ด้านล่าง)</span>`;
    } else {
      itemsText.value = '';
      if (statusEl) statusEl.innerHTML = `<span class="text-amber-300"><i class="fa-solid fa-circle-info"></i> อ่านข้อมูลเสร็จสิ้น สามารถพิมพ์/แก้ไขไอเทมดรอปได้</span>`;
    }
  }
}

function clearKillConfirmImage() {
  killConfirmImageBlob = null;
  const emptyBox = document.getElementById('kill-confirm-dropzone-empty');
  const filledBox = document.getElementById('kill-confirm-dropzone-filled');
  const previewImg = document.getElementById('kill-confirm-preview-img');
  const statusEl = document.getElementById('kill-confirm-ocr-status');
  const itemsBox = document.getElementById('kill-confirm-items-box');
  const itemsText = document.getElementById('kill-confirm-items-text');
  const fileInput = document.getElementById('kill-confirm-file-input');

  if (emptyBox) emptyBox.classList.remove('hidden');
  if (filledBox) filledBox.classList.add('hidden');
  if (previewImg) previewImg.src = '';
  if (statusEl) statusEl.innerHTML = '';
  if (itemsBox) itemsBox.classList.add('hidden');
  if (itemsText) itemsText.value = '';
  if (fileInput) fileInput.value = '';
}

let pendingKillConfirmData = null;

function handleSaveKillConfirm(e) {
  if (e) e.preventDefault();
  // เช็คสิทธิ์: เฉพาะ Admin เท่านั้นที่บันทึกเวลาบอสได้
  if (typeof isBossTimerAdmin !== 'undefined' && !isBossTimerAdmin()) {
    showToast('เฉพาะ Admin เท่านั้นที่สามารถบันทึกเวลาบอสได้ค่ะ', 'warning');
    return;
  }
  const bossSelect = document.getElementById('kill-confirm-boss-select');
  const bossId = bossSelect ? bossSelect.value : currentKillConfirmBossId;
  if (!bossId) {
    alert('กรุณาเลือกบอสที่ต้องการบันทึก');
    return;
  }

  const boss = bossList.find(b => b.id === bossId);
  const bossName = boss ? boss.name : bossId;

  const dateVal = document.getElementById('kill-confirm-date').value;
  const hourVal = document.getElementById('kill-confirm-hour').value;
  const minVal = document.getElementById('kill-confirm-min').value;

  if (!dateVal || hourVal === '' || minVal === '') {
    alert('กรุณาระบุวันที่และเวลาที่บอสตาย');
    return;
  }

  const dt = new Date(`${dateVal}T${hourVal}:${minVal}:00`);
  if (isNaN(dt.getTime())) {
    alert('รูปแบบวันที่หรือเวลาไม่ถูกต้อง');
    return;
  }

  const killerEmail = (typeof currentAdminEmail !== 'undefined' ? currentAdminEmail : 'Admin');

  // 1. Extract Drop Items (if provided)
  const itemsText = document.getElementById('kill-confirm-items-text');
  const rawItems = itemsText ? itemsText.value.trim() : '';
  const itemsList = rawItems ? rawItems.split('\n').map(i => i.trim()).filter(i => i.length > 0) : [];

  // Store in pending object for double check
  pendingKillConfirmData = {
    bossId: bossId,
    bossName: bossName,
    bossMap: boss?.map || '-',
    bossIcon: boss?.icon || '🐉',
    bossImage: boss?.image || '',
    killDate: dateVal,
    killHour: hourVal,
    killMin: minVal,
    killDateTime: dt,
    killerEmail: killerEmail,
    itemsList: itemsList
  };

  // Open Double-Check Modal to confirm boss name
  openBossDoubleCheckModal(pendingKillConfirmData);
}

function openBossDoubleCheckModal(data) {
  const modal = document.getElementById('boss-double-check-modal');
  if (!modal) {
    // Fallback if modal not present
    commitSaveBossKillConfirm();
    return;
  }

  const nameEl = document.getElementById('double-check-boss-name');
  const mapEl = document.getElementById('double-check-boss-map-text');
  const timeEl = document.getElementById('double-check-kill-time');
  const countEl = document.getElementById('double-check-items-count');
  const previewEl = document.getElementById('double-check-items-preview');
  const iconEl = document.getElementById('double-check-boss-icon');
  const imgEl = document.getElementById('double-check-boss-img');

  if (nameEl) nameEl.textContent = data.bossName;
  if (mapEl) mapEl.textContent = `แมพ: ${data.bossMap}`;
  if (timeEl) {
    const timeFormatted = data.killDateTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    timeEl.textContent = `${timeFormatted} น. (${data.killDate})`;
  }
  if (countEl) countEl.textContent = `${data.itemsList.length} รายการ`;

  if (data.bossImage && imgEl && iconEl) {
    imgEl.src = data.bossImage;
    imgEl.classList.remove('hidden');
    iconEl.classList.add('hidden');
  } else if (iconEl && imgEl) {
    iconEl.textContent = data.bossIcon || '🐉';
    iconEl.classList.remove('hidden');
    imgEl.classList.add('hidden');
  }

  if (previewEl) {
    if (data.itemsList.length > 0) {
      previewEl.innerHTML = data.itemsList.map(item => `
        <div class="flex items-center gap-1.5 truncate">
          <i class="fa-solid fa-gem text-amber-400 text-[9px]"></i>
          <span>${escapeHtml(item)}</span>
        </div>
      `).join('');
      previewEl.classList.remove('hidden');
    } else {
      previewEl.classList.add('hidden');
    }
  }

  modal.classList.remove('hidden');
}

function closeBossDoubleCheckModal() {
  const modal = document.getElementById('boss-double-check-modal');
  if (modal) modal.classList.add('hidden');
}

function commitSaveBossKillConfirm() {
  // เช็คสิทธิ์: เฉพาะ Admin เท่านั้นที่ยืนยันบันทึกเวลาบอสได้
  if (typeof isBossTimerAdmin !== 'undefined' && !isBossTimerAdmin()) {
    showToast('เฉพาะ Admin เท่านั้นที่สามารถยืนยันบันทึกเวลาบอสได้ค่ะ', 'warning');
    return;
  }
  if (!pendingKillConfirmData) return;

  const { bossId, bossName, killDateTime, killerEmail, itemsList } = pendingKillConfirmData;

  // 1. Save Boss Kill Time & Create History Log (Firebase + Google Sheets)
  saveBossKillTime(bossId, killDateTime.toISOString(), killerEmail, itemsList);

  // 2. Save Drop Log if items provided
  if (itemsList.length > 0) {
    const dropEntry = {
      id: 'drop_' + Date.now(),
      bossId: bossId,
      bossName: bossName,
      killTime: killDateTime.toISOString(),
      items: itemsList,
      recordedBy: killerEmail,
      timestamp: new Date().toISOString()
    };
    bossDropLogs.unshift(dropEntry);
    localStorage.setItem('guild_boss_drop_logs', JSON.stringify(bossDropLogs));
    if (typeof fbDb !== 'undefined' && fbDb) {
      fbDb.ref('guild_app/boss_drop_logs').set(bossDropLogs);
    }
  }

  closeBossDoubleCheckModal();
  closeBossKillConfirmModal();
  pendingKillConfirmData = null;

  showToast(`💀 บันทึกเวลาตายของ "${bossName}" (${formatDateTimeShort(killDateTime)}) เรียบร้อยแล้ว!`, 'success');
  playChime();
}

// Global Paste Handler: Supports Ctrl+V across the boss tab & inside modal
function handleGlobalPasteForOCR(e) {
  // เช็คสิทธิ์: เฉพาะ Admin เท่านั้นที่ใช้ OCR วางรูปอ่านข้อมูลบอสได้
  if (typeof isBossTimerAdmin !== 'undefined' && !isBossTimerAdmin()) {
    return;
  }
  // เช็คว่าอยู่ในโมดูลบอสไทม์เมอร์เท่านั้น (ไม่รบกวนการวางรูปในโมดูลอื่น เช่น Scoring)
  if (activeAppModule !== 'boss_timer') return;
  if (!e.clipboardData || !e.clipboardData.items) return;

  for (let i = 0; i < e.clipboardData.items.length; i++) {
    const item = e.clipboardData.items[i];
    if (item.type.indexOf('image') !== -1) {
      const file = item.getAsFile();
      if (!file) return;

      e.preventDefault();

      // Case 1: Kill Confirm Modal is currently open
      const killConfirmModal = document.getElementById('boss-kill-confirm-modal');
      if (killConfirmModal && !killConfirmModal.classList.contains('hidden')) {
        processKillConfirmImage(file);
        return;
      }

      // Case 2: User is viewing the boss timer tab (outside any modal)
      const bossContainer = document.getElementById('boss-timer-module-container');
      const isBossTabActive = bossContainer && !bossContainer.classList.contains('hidden');
      if (isBossTabActive) {
        processImageForBossOCR(file);
      }
      break;
    }
  }
}

// ================= Boss Edit Modal (Name, Level, Map, Avatar, Schedule, Notes) =================
let editingBossAvatarData = null; // Stored Base64 or URL during modal editing

function openEditBossModal(bossId) {
  // เช็คสิทธิ์: เฉพาะ Admin เท่านั้นที่แก้ไขข้อมูลบอสได้
  if (typeof isBossTimerAdmin !== 'undefined' && !isBossTimerAdmin()) {
    showToast('เฉพาะ Admin เท่านั้นที่สามารถแก้ไขข้อมูลบอสได้ค่ะ', 'warning');
    return;
  }
  populate24HourSelects();
  currentEditBossId = bossId;
  const boss = bossList.find(b => b.id === bossId);
  if (!boss) return;

  const modal = document.getElementById('boss-edit-modal');
  const title = document.getElementById('edit-boss-modal-title');
  const nameInput = document.getElementById('edit-boss-name');
  const levelInput = document.getElementById('edit-boss-level');
  const mapInput = document.getElementById('edit-boss-map');
  const intervalInput = document.getElementById('edit-boss-interval');
  const scheduleInput = document.getElementById('edit-boss-schedule');
  const noteInput = document.getElementById('edit-boss-note');
  const avatarPreview = document.getElementById('edit-boss-avatar-preview');
  const avatarPlaceholder = document.getElementById('edit-boss-avatar-placeholder');
  const avatarUrlInput = document.getElementById('edit-boss-avatar-url');

  if (title) title.textContent = `แก้ไขข้อมูลบอส: ${boss.name}`;
  if (nameInput) nameInput.value = boss.name || '';
  if (levelInput) levelInput.value = boss.level || '';
  if (mapInput) mapInput.value = boss.map || '';
  if (intervalInput) intervalInput.value = boss.intervalHours || '';
  if (scheduleInput) scheduleInput.value = boss.scheduleText || '';
  if (noteInput) noteInput.value = boss.note || '';

  editingBossAvatarData = boss.avatar || null;
  if (avatarUrlInput) avatarUrlInput.value = (boss.avatar && !boss.avatar.startsWith('data:')) ? boss.avatar : '';

  updateEditBossAvatarDisplay();

  // Populate timer section in edit modal
  const timer = bossTimerData[bossId] || {};
  const editDefDateInput = document.getElementById('edit-boss-def-date');
  const editDefHourSelect = document.getElementById('edit-boss-def-hour');
  const editDefMinSelect = document.getElementById('edit-boss-def-min');
  const pad = n => String(n).padStart(2, '0');

  if (timer.defeatedTime) {
    const d = new Date(timer.defeatedTime);
    const bangkok = getBangkokDateParts(d);
    if (editDefDateInput) editDefDateInput.value = `${bangkok.year}-${pad(bangkok.month)}-${pad(bangkok.day)}`;
    if (editDefHourSelect) editDefHourSelect.value = pad(bangkok.hour);
    if (editDefMinSelect) editDefMinSelect.value = pad(bangkok.minute);
  } else {
    if (editDefDateInput) editDefDateInput.value = '';
    if (editDefHourSelect) editDefHourSelect.value = '12';
    if (editDefMinSelect) editDefMinSelect.value = '00';
  }

  if (modal) modal.classList.remove('hidden');
}

function closeEditBossModal() {
  const modal = document.getElementById('boss-edit-modal');
  if (modal) modal.classList.add('hidden');
}

function updateEditBossAvatarDisplay() {
  const preview = document.getElementById('edit-boss-avatar-preview');
  const placeholder = document.getElementById('edit-boss-avatar-placeholder');
  if (!preview || !placeholder) return;

  if (editingBossAvatarData) {
    preview.src = editingBossAvatarData;
    preview.classList.remove('hidden');
    placeholder.classList.add('hidden');
  } else {
    preview.src = '';
    preview.classList.add('hidden');
    placeholder.classList.remove('hidden');
  }
}

function handleBossAvatarFileSelect(input) {
  if (!input || !input.files || !input.files[0]) return;
  const file = input.files[0];

  // Auto resize and compress to WebP Base64 to save bandwidth and Firebase quota
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX_SIZE = 160;
      let w = img.width;
      let h = img.height;
      if (w > h) {
        if (w > MAX_SIZE) {
          h = Math.round((h * MAX_SIZE) / w);
          w = MAX_SIZE;
        }
      } else {
        if (h > MAX_SIZE) {
          w = Math.round((w * MAX_SIZE) / h);
          h = MAX_SIZE;
        }
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      editingBossAvatarData = canvas.toDataURL('image/webp', 0.85);
      const urlInput = document.getElementById('edit-boss-avatar-url');
      if (urlInput) urlInput.value = '';
      updateEditBossAvatarDisplay();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function updateBossAvatarFromUrl(url) {
  const cleanUrl = (url || '').trim();
  if (cleanUrl) {
    editingBossAvatarData = cleanUrl;
  } else {
    editingBossAvatarData = null;
  }
  updateEditBossAvatarDisplay();
}

function clearBossAvatar() {
  editingBossAvatarData = null;
  const urlInput = document.getElementById('edit-boss-avatar-url');
  const fileInput = document.getElementById('edit-boss-avatar-file');
  if (urlInput) urlInput.value = '';
  if (fileInput) fileInput.value = '';
  updateEditBossAvatarDisplay();
}

function applyQuickEditDefTime(minutesAgo) {
  populate24HourSelects();
  const dateInput = document.getElementById('edit-boss-def-date');
  const hourSelect = document.getElementById('edit-boss-def-hour');
  const minSelect = document.getElementById('edit-boss-def-min');
  if (!dateInput || !hourSelect || !minSelect) return;

  const targetDate = new Date(Date.now() - (minutesAgo * 60 * 1000));
  const pad = n => String(n).padStart(2, '0');
  dateInput.value = `${targetDate.getFullYear()}-${pad(targetDate.getMonth() + 1)}-${pad(targetDate.getDate())}`;
  hourSelect.value = pad(targetDate.getHours());
  minSelect.value = pad(targetDate.getMinutes());
}

function handleSaveEditBoss(e) {
  if (e) e.preventDefault();
  // เช็คสิทธิ์: เฉพาะ Admin เท่านั้นที่บันทึกการแก้ไขบอสได้
  if (typeof isBossTimerAdmin !== 'undefined' && !isBossTimerAdmin()) {
    showToast('เฉพาะ Admin เท่านั้นที่สามารถแก้ไขข้อมูลบอสได้ค่ะ', 'warning');
    return;
  }
  if (!currentEditBossId) return;

  const nameVal = document.getElementById('edit-boss-name').value.trim();
  const levelVal = document.getElementById('edit-boss-level').value.trim();
  const mapVal = document.getElementById('edit-boss-map').value.trim();
  const intervalVal = document.getElementById('edit-boss-interval').value;
  const scheduleVal = document.getElementById('edit-boss-schedule').value.trim();
  const noteVal = document.getElementById('edit-boss-note').value.trim();

  if (!nameVal) {
    alert('กรุณาระบุชื่อบอส');
    return;
  }

  // 1. Update Custom Boss Config
  bossCustomConfigs[currentEditBossId] = {
    name: nameVal,
    level: levelVal,
    map: mapVal,
    avatar: editingBossAvatarData || null,
    intervalHours: intervalVal !== '' ? Number(intervalVal) : null,
    scheduleText: scheduleVal || null,
    note: noteVal || null,
    updatedAt: new Date().toISOString()
  };

  localStorage.setItem('guild_boss_custom_configs', JSON.stringify(bossCustomConfigs));
  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref('guild_app/boss_custom_configs').set(bossCustomConfigs);
  }

  // 2. Check if defeat time was modified in edit modal
  const editDefDateVal = document.getElementById('edit-boss-def-date').value;
  const editDefHourVal = document.getElementById('edit-boss-def-hour').value;
  const editDefMinVal = document.getElementById('edit-boss-def-min').value;

  if (editDefDateVal && editDefHourVal !== '' && editDefMinVal !== '') {
    const [editYear, editMonth, editDay] = editDefDateVal.split('-').map(Number);
    const dt = createDateFromBangkokParts({
      year: editYear,
      month: editMonth,
      day: editDay,
      hour: Number(editDefHourVal),
      minute: Number(editDefMinVal),
      second: 0
    });
    if (!isNaN(dt.getTime())) {
      saveBossKillTime(currentEditBossId, dt.toISOString(), (typeof currentAdminEmail !== 'undefined' ? currentAdminEmail : 'Admin'));
    }
  }

  rebuildBossList();
  renderBossTimerCards();
  updateUpcomingBossWidget();
  closeEditBossModal();

  const adminEmail = typeof currentAdminEmail !== 'undefined' ? currentAdminEmail : 'Admin';
  if (typeof addAuditLog === 'function') {
    addAuditLog('boss_edit_config', `แก้ไขข้อมูลบอส "${nameVal}"`, `โดย: ${adminEmail}`, 'BossTimer');
  }

  showToast(`✨ บันทึกการแก้ไขข้อมูลและรูปโปรไฟล์ "${nameVal}" เรียบร้อยแล้ว!`, 'success');
  playChime();
}

function resetSingleBossTimer(bossId) {
  // เช็คสิทธิ์: เฉพาะ Admin เท่านั้นที่รีเซ็ตไทม์เมอร์บอสได้
  if (typeof isBossTimerAdmin !== 'undefined' && !isBossTimerAdmin()) {
    showToast('เฉพาะ Admin เท่านั้นที่สามารถรีเซ็ตไทม์เมอร์บอสได้ค่ะ', 'warning');
    return;
  }
  const targetId = bossId || currentEditBossId;
  if (!targetId) return;
  const boss = bossList.find(b => b.id === targetId);
  const bossName = boss ? boss.name : targetId;

  if (!confirm(`คุณต้องการล้างเวลาของบอส "${bossName}" กลับเป็น "ยังไม่ลงเวลา" ใช่หรือไม่?`)) return;

  if (bossTimerData[targetId]) {
    delete bossTimerData[targetId];
    localStorage.setItem('guild_boss_timers', JSON.stringify(bossTimerData));
    if (typeof fbDb !== 'undefined' && fbDb) {
      fbDb.ref(`guild_app/boss_timers/${targetId}`).remove();
    }
  }

  const editDefDateInput = document.getElementById('edit-boss-def-date');
  if (editDefDateInput) editDefDateInput.value = '';

  renderBossTimerCards();
  updateUpcomingBossWidget();

  const adminEmail = (typeof currentAdminEmail !== 'undefined' && currentAdminEmail) ? currentAdminEmail : 'Admin';
  if (typeof addAuditLog === 'function') {
    addAuditLog('boss_single_reset', `ล้างเวลาบอส "${bossName}" กลับเป็นค่าเริ่มต้น`, `โดย: ${adminEmail}`, 'BossTimer');
  }

  showToast(`🗑️ ล้างเวลาของ "${bossName}" เรียบร้อยแล้ว`, 'info');
}

// ================= Server Maintenance Reset Modal =================
function openMaintenanceModal() {
  populate24HourSelects();
  const modal = document.getElementById('boss-maintenance-modal');
  const dateInput = document.getElementById('maint-reset-date');
  const hourSelect = document.getElementById('maint-reset-hour');
  const minSelect = document.getElementById('maint-reset-min');

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  if (dateInput) dateInput.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (hourSelect) hourSelect.value = pad(now.getHours());
  if (minSelect) minSelect.value = pad(now.getMinutes());

  if (modal) modal.classList.remove('hidden');
}

function closeMaintenanceModal() {
  const modal = document.getElementById('boss-maintenance-modal');
  if (modal) modal.classList.add('hidden');
}

function handleConfirmMaintenance(e) {
  if (e) e.preventDefault();
  // เช็คสิทธิ์: เฉพาะ Admin เท่านั้นที่รีเซ็ตเวลาบอสหลังเมนเทนได้
  if (typeof isBossTimerAdmin !== 'undefined' && !isBossTimerAdmin()) {
    showToast('เฉพาะ Admin เท่านั้นที่สามารถรีเซ็ตเวลาบอสหลังเมนเทนได้ค่ะ', 'warning');
    return;
  }
  const dateVal = document.getElementById('maint-reset-date').value;
  const hourVal = document.getElementById('maint-reset-hour').value;
  const minVal = document.getElementById('maint-reset-min').value;
  if (!dateVal || hourVal === '' || minVal === '') return;

  const resetDt = new Date(`${dateVal}T${hourVal}:${minVal}:00`);
  if (isNaN(resetDt.getTime())) {
    alert('วันที่หรือเวลาไม่ถูกต้อง');
    return;
  }

  const adminEmail = typeof currentAdminEmail !== 'undefined' ? currentAdminEmail : 'Admin';
  const resetISO = resetDt.toISOString();
  let count = 0;

  // Reset all interval bosses to calculate from this server open time
  bossList.forEach(boss => {
    if (boss.respawnType === 'interval') {
      const nextSpawn = new Date(resetDt.getTime() + (boss.intervalHours * 3600 * 1000));
      bossTimerData[boss.id] = {
        defeatedTime: resetISO,
        nextSpawnTime: nextSpawn.toISOString(),
        recordedBy: `${adminEmail} (Server Maintenance Reset)`,
        updatedAt: new Date().toISOString()
      };
      count++;
    }
  });

  localStorage.setItem('guild_boss_timers', JSON.stringify(bossTimerData));
  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref('guild_app/boss_timers').set(bossTimerData);
  }

  if (typeof addAuditLog === 'function') {
    addAuditLog('boss_maintenance', `รีเซ็ตเวลาบอส ${count} ตัวหลังเซิร์ฟเปิด`, `เวลาเปิดเซิร์ฟ: ${formatDateTimeShort(resetDt)} โดย: ${adminEmail}`, 'BossTimer');
  }

  closeMaintenanceModal();
  renderBossTimerCards();
  updateUpcomingBossWidget();
  showToast(`🛠️ รีเซ็ตเวลาบอสตามคอลัมน์ E ทั้งหมด ${count} ตัวเรียบร้อยแล้ว!`, 'success');
  playChime();
}

// Clear all recorded timers back to clean unrecorded state
function clearAllBossTimers() {
  // เช็คสิทธิ์: เฉพาะ Admin เท่านั้นที่ล้างเวลาบอสทั้งหมดได้
  if (typeof isBossTimerAdmin !== 'undefined' && !isBossTimerAdmin()) {
    showToast('เฉพาะ Admin เท่านั้นที่สามารถล้างเวลาบอสทั้งหมดได้ค่ะ', 'warning');
    return;
  }
  if (!confirm('คุณแน่ใจหรือไม่ว่าต้องการล้างเวลาบอสทั้งหมดกลับสู่สถานะ "ยังไม่ลงเวลา"?')) return;

  bossTimerData = {};
  localStorage.setItem('guild_boss_timers', JSON.stringify(bossTimerData));
  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref('guild_app/boss_timers').set(bossTimerData);
  }

  const adminEmail = typeof currentAdminEmail !== 'undefined' ? currentAdminEmail : 'Admin';
  if (typeof addAuditLog === 'function') {
    addAuditLog('boss_clear_all', 'ล้างเวลาบอสทั้งหมดเป็นค่าเริ่มต้น', `โดย Admin: ${adminEmail}`, 'BossTimer');
  }

  closeMaintenanceModal();
  renderBossTimerCards();
  updateUpcomingBossWidget();
  showToast('🗑️ ล้างเวลาบอสทั้งหมดเรียบร้อยแล้ว (สถานะ: ยังไม่ลงเวลา)', 'info');
}


// Preprocess image for OCR: upscale 2.5x, invert dark game background, increase contrast, binarize
async function preprocessImageCanvas(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Scale up 2.5x for sharp sub-pixel text rendering
        const scale = 2.5;
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Get Pixel Data
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imgData.data;

        // 1. Calculate Average Brightness
        let totalVal = 0;
        const totalPixels = canvas.width * canvas.height;
        for (let i = 0; i < d.length; i += 4) {
          const maxC = Math.max(d[i], d[i + 1], d[i + 2]);
          totalVal += maxC;
        }
        const avgVal = totalVal / totalPixels;
        const isDarkBg = avgVal < 140;

        // 2. Multi-color enhancement: preserve colored text (Blue, Purple, Green, Yellow, Orange, Red, Cyan)
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2];
          const maxC = Math.max(r, g, b);
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          let val = Math.max(maxC, lum); // Capture high saturation colored text and bright white text

          if (isDarkBg) {
            // Invert: Light/vibrant text becomes dark on pure white background
            val = 255 - val;
          }

          // Dynamic thresholding
          if (val > 180) {
            val = 255;
          } else if (val < 95) {
            val = 0;
          } else {
            val = Math.round(((val - 95) / 85) * 255);
          }

          d[i] = val;
          d[i + 1] = val;
          d[i + 2] = val;
        }

        ctx.putImageData(imgData, 0, 0);

        canvas.toBlob(blob => {
          if (blob) resolve(blob);
          else resolve(file);
        }, 'image/png');
      } catch (err) {
        console.warn('Canvas pre-processing fallback:', err);
        resolve(file);
      }
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}

// Convert Blob/File to Base64 String
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function compressImageForGemini(file, maxWidth = 1600, quality = 0.88) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth || height > maxWidth) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxWidth) / height);
            height = maxWidth;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const base64Str = dataUrl.split(',')[1];
        resolve({ base64Str, mimeType: 'image/jpeg' });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Process Image with Google Gemini 1.5 Flash Vision API (99.9% Accuracy for Thai & Game Logs)
async function processImageWithGeminiVision(file, apiKey) {
  const statusEl = document.getElementById('ocr-progress-status');

  if (statusEl) {
    statusEl.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles fa-spin text-purple-400"></i> กำลังส่งภาพให้ Google Gemini AI สแกนภาษาไทยและสีไอเทม (แม่นยำ 99.9%)...`;
    statusEl.classList.remove('hidden');
  }

  const { base64Str, mimeType } = await compressImageForGemini(file, 1600, 0.88);

  const bossCatalog = bossList.map(b => `- ID: ${b.id} | Name: ${b.name} | Map: ${b.map || ''}`).join('\n');

  const prompt = `You are a specialized game log OCR and data extractor for the MMORPG 'LORD NINE' (LORDNINE / ลอร์ดไนน์).
Examine this screenshot of the game's drop / kill chat log.

### Game Log Structure:
Each drop record in LORD NINE follows this structure (often wrapping across 1-2 lines):
[HH:MM] {PlayerName in Yellow} ได้รับไอเทม {ItemName in ANY color: Blue, Cyan, Purple, Green, Orange, Gold, Red, White} {optional count e.g. '5 อัน' or 'x5'} จาก {Location / Dungeon Map in White}

### Boss Database:
${bossCatalog}

### Extraction Rules:
1. 'killTime': Extract the 24-hour timestamp from the log line (e.g. '09:51', '03:21', '14:20').
2. 'bossId' & 'bossName': Determine which boss was defeated by matching the location after 'จาก' (e.g. 'สุสานใต้ดินไทริโอซา (ชั้น 2)' matches boss 'general_aquleus' (General Aquleus), 'สุสานใต้ดิน (ชั้น 1)' matches 'araneo', 'หุบเขาอูลาน' matches 'ego', etc.) or from the boss name directly.
3. 'dropItems': Extract EVERY item dropped in the screenshot.
   - Item names appear in various colors (Cyan, Blue, Purple, Green, Orange, Red, etc.) right after 'ได้รับไอเทม' up until 'จาก'.
   - Extract the full clean Thai item name.
   - Format each drop item as: "{ItemName}{count ? ' ' + count : ''} (ผู้รับ: {PlayerName})"
   - Examples from this game:
     * "กางเกงผ้าแห่งพายุโหดร้าย (ผู้รับ: ไข่ตุ๋น)"
     * "กล่องเพาะเลี้ยงโฮมุน I (ผู้รับ: ไข่ตุ๋น)"
     * "หินอัปเกรดเครื่องประดับ 5 อัน (ผู้รับ: ไข่ตุ๋น)"
     * "เข็มขัดแห่งพายุโหดร้าย (ผู้รับ: ไข่ตุ๋น)"
     * "ม้วนคัมภีร์เลื่อนขั้นผู้เชี่ยวชาญ (ผู้รับ: ไข่ตุ๋น)"
     * "กางเกงหนังสัตว์รุ่งอรุณสีเทา (ผู้รับ: ไข่ตุ๋น)"
     * "อะไหล่พาหนะ (ผู้รับ: ไข่ตุ๋น)"
     * "หินถลุงอุปกรณ์ (ผู้รับ: ไข่ตุ๋น)"

Output strictly valid JSON with no markdown wrapping:
{
  "bossId": "matching boss ID or null",
  "bossName": "matching boss name",
  "killTime": "HH:MM",
  "killDate": "YYYY-MM-DD or null",
  "dropItems": [
    "Item name and receiver"
  ]
}`;

  const data = await callGeminiVisionApiWithFallback(prompt, base64Str, mimeType, apiKey);
  populateModalFromGeminiData(data);
}

// Dynamic Discovery: Ask Google AI Studio which models are active for this API key
async function discoverActiveGeminiModel(apiKey) {
  if (window.cachedGeminiModelEndpoint) return window.cachedGeminiModelEndpoint;

  const apiVersions = ['v1beta', 'v1'];
  for (const apiVer of apiVersions) {
    try {
      const listRes = await fetch(`https://generativelanguage.googleapis.com/${apiVer}/models?key=${apiKey}`);
      if (listRes.ok) {
        const listData = await listRes.json();
        const available = (listData.models || [])
          .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
          .map(m => m.name.replace(/^models\//, ''));

        if (available.length > 0) {
          // Priority: 3.5-flash > 3.6-flash > 3.7-flash > 3-flash > 3.1-flash > flash-latest > any flash > first available
          const preferred =
            available.find(m => /gemini-3\.5-flash/i.test(m)) ||
            available.find(m => /gemini-3\.6-flash/i.test(m)) ||
            available.find(m => /gemini-3\.7-flash/i.test(m)) ||
            available.find(m => /gemini-3-flash/i.test(m)) ||
            available.find(m => /gemini-3\.1-flash/i.test(m)) ||
            available.find(m => /gemini-flash-latest/i.test(m)) ||
            available.find(m => /flash/i.test(m)) ||
            available[0];

          if (preferred) {
            console.log(`[Gemini Discovery] Found active model: ${preferred} via ${apiVer}`);
            window.cachedGeminiModelEndpoint = { apiVer, model: preferred };
            return window.cachedGeminiModelEndpoint;
          }
        }
      }
    } catch (err) {
      console.warn(`[Gemini Discovery] Failed to list models on ${apiVer}:`, err);
    }
  }

  // Fallback defaults
  return { apiVer: 'v1beta', model: 'gemini-3.5-flash' };
}

// Universal Gemini Vision Caller with Model Discovery & Auto-Fallback
async function callGeminiVisionApiWithFallback(prompt, base64Str, mimeType, apiKey) {
  // 1. First attempt: Use Dynamically Discovered Model
  const discovered = await discoverActiveGeminiModel(apiKey);

  const candidateList = [
    { apiVer: discovered.apiVer, model: discovered.model },
    { apiVer: 'v1beta', model: 'gemini-3.5-flash' },
    { apiVer: 'v1beta', model: 'gemini-3.6-flash' },
    { apiVer: 'v1beta', model: 'gemini-3.7-flash' },
    { apiVer: 'v1beta', model: 'gemini-3-flash-preview' },
    { apiVer: 'v1beta', model: 'gemini-3.1-flash-lite' },
    { apiVer: 'v1', model: 'gemini-3.5-flash' },
    { apiVer: 'v1beta', model: 'gemini-1.5-flash-latest' },
    { apiVer: 'v1beta', model: 'gemini-1.5-flash' },
    { apiVer: 'v1', model: 'gemini-1.5-flash' }
  ];

  let lastError = null;
  const tried = new Set();

  for (const item of candidateList) {
    const key = `${item.apiVer}:${item.model}`;
    if (tried.has(key)) continue;
    tried.add(key);

    try {
      const payload = {
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: mimeType,
                  data: base64Str
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1
        }
      };

      const res = await fetch(`https://generativelanguage.googleapis.com/${item.apiVer}/models/${item.model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errText = await res.text();
        console.warn(`Model ${item.model} (${item.apiVer}) returned ${res.status}:`, errText);
        lastError = new Error(`Model ${item.model} (${res.status}): ${errText}`);
        continue;
      }

      const jsonRes = await res.json();
      const textOutput = jsonRes?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!textOutput) {
        lastError = new Error(`Model ${item.model} returned empty content`);
        continue;
      }

      // Update cache with successful model!
      window.cachedGeminiModelEndpoint = { apiVer: item.apiVer, model: item.model };

      return extractJsonFromGeminiResponse(textOutput);
    } catch (err) {
      console.warn(`Failed with ${key}:`, err);
      lastError = err;
    }
  }

  throw lastError || new Error('All Gemini models failed. Please check your API key.');
}

// Bulletproof JSON extractor for Google Gemini output
function extractJsonFromGeminiResponse(text) {
  if (!text) throw new Error('Empty response content from AI');

  const trimmed = text.trim();

  // 1. Direct JSON parse
  try {
    return JSON.parse(trimmed);
  } catch (e) { }

  // 2. Extract code block ```json ... ``` or ``` ... ```
  const blockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (blockMatch && blockMatch[1]) {
    try {
      return JSON.parse(blockMatch[1].trim());
    } catch (e) { }
  }

  // 3. Extract JSON object { ... }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.substring(firstBrace, lastBrace + 1));
    } catch (e) { }
  }

  // 4. Extract JSON array [ ... ]
  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    try {
      return JSON.parse(trimmed.substring(firstBracket, lastBracket + 1));
    } catch (e) { }
  }

  throw new Error('Invalid JSON structure in AI response: ' + trimmed.substring(0, 80));
}

// Populate Modal Fields from Gemini AI Result (Unified)
function populateModalFromGeminiData(data) {
  if (!data) return;
  let targetBossId = data.bossId;
  if ((!targetBossId || !bossList.some(b => b.id === targetBossId)) && data.bossName && Array.isArray(bossList)) {
    const q = data.bossName.toLowerCase().trim();
    const found = bossList.find(b => b.name.toLowerCase() === q || b.id.toLowerCase() === q || b.name.toLowerCase().includes(q));
    if (found) targetBossId = found.id;
  }
  if (!targetBossId) return;
  openBossKillConfirmModal(targetBossId);
  applyExtractedBossData(data);
}

// Process Image with AI OCR
async function processImageForBossOCR(file) {
  if (!file) return;
  const modal = document.getElementById('boss-kill-confirm-modal');
  if (modal && !modal.classList.contains('hidden')) {
    // ถ้า modal เปิดอยู่แล้ว ให้ประมวลผลรูปภาพใน modal ปัจจุบัน
    await processKillConfirmImage(file);
  } else {
    // ถ้ายังไม่มี modal เปิด ให้เลือกบอสที่ใกล้เกิดที่สุด (alive/soon) แล้วเปิด modal อัตโนมัติ
    // เพื่อให้ผู้ใช้วางรูปภาพได้ทันทีโดยไม่ต้องคลิกปุ่ม "ตายตอนนี้" ก่อน
    const now = new Date();
    let targetBoss = null;
    let targetDiff = Infinity;

    bossList.forEach(boss => {
      const nextSpawn = getBossNextSpawn(boss);
      if (!nextSpawn || isNaN(nextSpawn.getTime())) return;
      const diff = nextSpawn.getTime() - now.getTime();
      // เลือกบอสที่ใกล้เกิดที่สุด (diff น้อยที่สุด) โดยเฉพาะบอสที่เกิดแล้วหรือใกล้เกิด
      if (diff < targetDiff) {
        targetDiff = diff;
        targetBoss = boss;
      }
    });

    if (targetBoss) {
      // เปิด modal ของบอสที่ใกล้เกิดที่สุด แล้วประมวลผลรูปภาพ
      openBossKillConfirmModal(targetBoss.id);
      await processKillConfirmImage(file);
    } else {
      showToast('💡 ยังไม่มีข้อมูลบอสที่ลงเวลาตาย กรุณาคลิกปุ่ม "ตายตอนนี้" ที่การ์ดบอสก่อนวางรูปภาพครับ', 'info');
    }
  }
}

// Smart Thai Text Normalizer and Drop Log Cleaner
function normalizeAndCleanThaiDropLog(rawText) {
  if (!rawText) return { normalizedText: '', bossMatch: null, timeMatch: null, dateMatch: null, items: [] };

  // 1. Text Normalization: Fix broken Thai vowels, floating spaces, tone marks
  let normalized = rawText
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/ได[\s_]*ร[\s_]*บ/g, 'ได้รับ')
    .replace(/ได[\s_]*รับ/g, 'ได้รับ')
    .replace(/ไดรับ/g, 'ได้รับ')
    .replace(/แห[\s_]*ง/g, 'แห่ง')
    .replace(/ท[\s_]*เส[\s_]*อมทราม/g, 'ที่เสื่อมทราม')
    .replace(/เส[\s_]*อมทราม/g, 'เสื่อมทราม')
    .replace(/ห[\s_]*นอ[\s_]*ปเกรด/g, 'หินอัปเกรด')
    .replace(/หนอัปเกรด/g, 'หินอัปเกรด')
    .replace(/อ[\s_]*ปเกรด/g, 'อัปเกรด')
    .replace(/เคร[\s_]*องประดับ/g, 'เครื่องประดับ')
    .replace(/เครองประดับ/g, 'เครื่องประดับ')
    .replace(/ต[\s_]*างห[\s_]*/g, 'ต่างหู')
    .replace(/ตางหู/g, 'ต่างหู')
    .replace(/ผ[\s_]*าโพก/g, 'ผ้าโพก')
    .replace(/ผาโพก/g, 'ผ้าโพก')
    .replace(/ศ[\s_]*รษะ/g, 'ศีรษะ')
    .replace(/ห[\s_]*บเขาอ[\s_]*ลาน/g, 'หุบเขาอูลาน')
    .replace(/หุบเขาอ[\s_]*ลาน/g, 'หุบเขาอูลาน')
    .replace(/ส[\s_]*สานใต[\s_]*ด[\s_]*น/g, 'สุสานใต้ดิน')
    .replace(/ไทริโอซา/g, 'ไทริโอซา')
    .replace(/ไข่ต[\s_]*น/g, 'ไข่ตุ๋น')
    .replace(/ไข่ตุน/g, 'ไข่ตุ๋น')
    .replace(/เกราะแห[\s_]*ง/g, 'เกราะแห่ง')
    .replace(/อาว[\s_]*ธ/g, 'อาวุธ')
    .replace(/แหวนแห[\s_]*ง/g, 'แหวนแห่ง')
    .replace(/สร[\s_]*อยคอ/g, 'สร้อยคอ')
    .replace(/เข[\s_]*มขัด/g, 'เข็มขัด')
    .replace(/ถ[\s_]*งมือ/g, 'ถุงมือ')
    .replace(/รองเท[\s_]*า/g, 'รองเท้า')
    .replace(/ช[\s_]*นส[\s_]*วน/g, 'ชิ้นส่วน')
    .replace(/กล[\s_]*อง/g, 'กล่อง');

  // Join multiline drops (lines without timestamps or player get merged with previous line)
  const rawLines = normalized.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const consolidatedLines = [];
  for (let l of rawLines) {
    if (l.match(/^\s*\[?\d{1,2}[:.]\d{2}\]?/) || l.includes('ได้รับไอเทม')) {
      consolidatedLines.push(l);
    } else if (consolidatedLines.length > 0) {
      consolidatedLines[consolidatedLines.length - 1] += ' ' + l;
    } else {
      consolidatedLines.push(l);
    }
  }

  // 2. Detect Date (DD/MM) & Time (HH:MM)
  let extractedDate = null;
  let extractedTime = null;

  for (const line of consolidatedLines) {
    const frontTimeMatch = line.match(/^\s*\[?\s*(\d{1,2})[:.](\d{2})\s*\]?/);
    if (frontTimeMatch) {
      extractedTime = `${frontTimeMatch[1].padStart(2, '0')}:${frontTimeMatch[2].padStart(2, '0')}`;
      break;
    }
  }

  if (!extractedTime) {
    const timeStampMatch = normalized.match(/\[?(\d{1,2})[:.](\d{2})\]?/);
    if (timeStampMatch) {
      extractedTime = `${timeStampMatch[1].padStart(2, '0')}:${timeStampMatch[2].padStart(2, '0')}`;
    }
  }

  // 3. Detect Boss from name or dungeon location
  let matchedBoss = null;
  const lower = normalized.toLowerCase();
  for (const b of bossList) {
    if (lower.includes(b.name.toLowerCase()) || (b.map && lower.includes(b.map.toLowerCase()))) {
      matchedBoss = b;
      break;
    }
  }

  if (!matchedBoss) {
    if (lower.includes('สุสานใต้ดิน') && lower.includes('2')) matchedBoss = bossList.find(b => b.id === 'general_aquleus');
    else if (lower.includes('สุสานใต้ดิน') && lower.includes('1')) matchedBoss = bossList.find(b => b.id === 'araneo');
    else if (lower.includes('สุสานใต้ดิน') && lower.includes('3')) matchedBoss = bossList.find(b => b.id === 'milavy');
    else if (lower.includes('ไทริโอซา')) matchedBoss = bossList.find(b => b.id === 'general_aquleus');
    else if (lower.includes('ego') || lower.includes('อีโก้') || lower.includes('อูลาน')) matchedBoss = bossList.find(b => b.id === 'ego');
    else if (lower.includes('dalia') || lower.includes('ดาเลีย')) matchedBoss = bossList.find(b => b.id === 'lady_dalia');
    else if (lower.includes('vioren') || lower.includes('ไวโอเรน')) matchedBoss = bossList.find(b => b.id === 'vioren');
    else if (lower.includes('undomiel') || lower.includes('อันโดเมียล')) matchedBoss = bossList.find(b => b.id === 'undomiel');
  }

  // 4. Extract Clean Drop Items with Receiver
  const items = [];
  const itemLineRegex = /(?:\[\d{1,2}[:.]\d{2}\]\s*)?(.*?)\s*(?:ได[\s_]*รับ|ได้รับ)ไอเทม\s*(.*?)(?:\s*(?:จาก|in)\s*(.*))?$/i;

  for (let line of consolidatedLines) {
    const match = line.match(itemLineRegex);
    if (match) {
      let player = match[1].replace(/\[\d{1,2}[:.]\d{2}\]/g, '').trim();
      let itemName = match[2].trim();

      // Clean up common suffix or count (e.g. 5 อัน -> x5)
      itemName = itemName.replace(/(\d+)\s*อัน/g, 'x$1').replace(/(\d+)\s*ea/gi, 'x$1');

      if (player) {
        items.push(`${itemName} (ผู้รับ: ${player})`);
      } else {
        items.push(itemName);
      }
    }
  }

  return {
    normalizedText: normalized,
    bossMatch: matchedBoss,
    dateMatch: extractedDate,
    timeMatch: extractedTime,
    items: items
  };
}

// Parse OCR Text (Unified Fallback)
function parseOCRTextAndPopulateModal(rawText) {
  const parsed = normalizeAndCleanThaiDropLog(rawText);
  applyExtractedBossData({
    bossId: parsed.bossMatch ? parsed.bossMatch.id : null,
    bossName: parsed.bossMatch ? parsed.bossMatch.name : null,
    killTime: parsed.timeMatch,
    killDate: parsed.dateMatch,
    dropItems: parsed.items.length > 0 ? parsed.items : rawText.split('\n').filter(l => l.trim().length > 3).slice(0, 5)
  });
}

function handleConfirmOcrSave(e) {
  handleSaveKillConfirm(e);
}


function closeBossAiOcrModal() {
  const modal = document.getElementById('boss-ai-ocr-modal');
  if (modal) modal.classList.add('hidden');
}

// ================= 📜 Boss Kill History & Google Sheets Webhook Functions =================


function openBossKillHistoryModal() {
  updateWebhookStatusUi();
  renderBossKillHistoryList();
  const modal = document.getElementById('boss-kill-history-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeBossKillHistoryModal() {
  const modal = document.getElementById('boss-kill-history-modal');
  if (modal) modal.classList.add('hidden');
}

function renderBossKillHistoryList() {
  const container = document.getElementById('boss-kill-history-list');
  const countBadge = document.getElementById('history-log-count-badge');
  if (!container) return;

  const searchInput = document.getElementById('history-search-input');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

  let filtered = bossKillLogs || [];
  if (query) {
    filtered = filtered.filter(log =>
      (log.bossName && log.bossName.toLowerCase().includes(query)) ||
      (log.map && log.map.toLowerCase().includes(query)) ||
      (log.recordedBy && log.recordedBy.toLowerCase().includes(query)) ||
      (log.dropItemsText && log.dropItemsText.toLowerCase().includes(query))
    );
  }

  if (countBadge) countBadge.textContent = `${filtered.length} รายการ`;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="py-12 text-center text-slate-500 space-y-2">
        <i class="fa-solid fa-scroll text-3xl text-slate-600"></i>
        <p class="text-xs font-medium">ยังไม่มีประวัติการลงเวลา หรือไม่พบข้อมูลที่ค้นหา</p>
      </div>
    `;
    return;
  }

  const html = filtered.map(log => {
    const isGuild = log.bossId === 'guild_arena' || log.bossId === 'reddevil_guild_boss';
    const isHigh = !isGuild && Number(log.level) >= 100;

    let badgeClass = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
    let nameClass = 'text-emerald-400 font-bold';
    if (isGuild) {
      badgeClass = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      nameClass = 'text-amber-300 font-black';
    } else if (isHigh) {
      badgeClass = 'bg-rose-500/20 text-rose-300 border-rose-500/40';
      nameClass = 'text-rose-400 font-black';
    }

    const dropItemsHtml = (log.dropItems && log.dropItems.length > 0)
      ? `<div class="mt-1 flex flex-wrap gap-1">
          ${log.dropItems.map(item => `<span class="px-2 py-0.5 rounded-md text-[10px] bg-amber-500/10 text-amber-300 border border-amber-500/30">🎁 ${escapeHtml(item)}</span>`).join('')}
        </div>`
      : '';

    return `
      <div class="p-3 bg-slate-950/70 hover:bg-slate-900/90 border border-slate-800/80 rounded-2xl transition flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div class="space-y-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="${nameClass} text-xs sm:text-sm">${escapeHtml(log.bossName)}</span>
            <span class="px-2 py-0.5 rounded-full text-[9px] font-mono border ${badgeClass}">Lv.${escapeHtml(log.level || '??')}</span>
            <span class="text-[11px] text-slate-400"><i class="fa-solid fa-location-dot text-[9px] text-slate-500"></i> ${escapeHtml(log.map || '-')}</span>
          </div>
          <div class="flex items-center gap-3 text-[11px] text-slate-400 font-mono flex-wrap">
            <span>💀 เวลาตาย: <b class="text-amber-300 font-sans">${escapeHtml(log.killTimeFormatted || '-')}</b></span>
            <span>⏳ เกิดรอบถัดไป: <b class="text-sky-300 font-sans">${escapeHtml(log.nextSpawnFormatted || '-')}</b></span>
          </div>
          ${dropItemsHtml}
        </div>
        <div class="text-left sm:text-right shrink-0 pt-1 sm:pt-0 border-t sm:border-t-0 border-slate-800/60">
          <div class="text-[10.5px] text-slate-400">👤 บันทึกโดย: <b class="text-slate-300">${escapeHtml(log.recordedBy || 'Admin')}</b></div>
          <div class="text-[10px] text-slate-500 font-mono">${escapeHtml(log.timestampStr || '')}</div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

function clearAllBossKillLogsPrompt() {
  // เช็คสิทธิ์: เฉพาะ Admin เท่านั้นที่ล้างประวัติการลงเวลาบอสได้
  if (typeof isBossTimerAdmin !== 'undefined' && !isBossTimerAdmin()) {
    showToast('เฉพาะ Admin เท่านั้นที่สามารถล้างประวัติการลงเวลาบอสได้ค่ะ', 'warning');
    return;
  }
  if (confirm('คุณแน่ใจหรือไม่ว่าต้องการล้างประวัติการลงเวลาบอสทั้งหมด? (การกระทำนี้ไม่สามารถย้อนกลับได้)')) {
    bossKillLogs = [];
    localStorage.setItem('guild_boss_kill_logs', JSON.stringify([]));
    if (typeof fbDb !== 'undefined' && fbDb) {
      fbDb.ref('guild_app/boss_kill_logs').set([]);
    }
    renderBossKillHistoryList();
    const adminEmail = (typeof currentAdminEmail !== 'undefined' && currentAdminEmail) ? currentAdminEmail : 'Admin';
    if (typeof addAuditLog === 'function') {
      addAuditLog('boss_kill_clear', 'ล้างประวัติการลงเวลาบอสทั้งหมด', `โดย: ${adminEmail}`, 'BossTimer');
    }
    showToast('ล้างประวัติการลงเวลาบอสเรียบร้อยแล้ว', 'info');
  }
}

function exportBossKillLogsToCsv() {
  if (!bossKillLogs || bossKillLogs.length === 0) {
    alert('ไม่มีข้อมูลประวัติการลงเวลาสำหรับส่งออก');
    return;
  }

  const headers = ['วันที่บันทึก (Timestamp)', 'ชื่อบอส', 'เลเวล', 'สถานที่ (Map)', 'เวลาที่บอสตาย (24 ชม.)', 'เวลาเกิดรอบถัดไป', 'ผู้บันทึก (Admin)', 'รายการของดรอป'];
  const rows = bossKillLogs.map(log => [
    `"${(log.timestampStr || '').replace(/"/g, '""')}"`,
    `"${(log.bossName || '').replace(/"/g, '""')}"`,
    `"${(log.level || '').replace(/"/g, '""')}"`,
    `"${(log.map || '').replace(/"/g, '""')}"`,
    `"${(log.killTimeFormatted || '').replace(/"/g, '""')}"`,
    `"${(log.nextSpawnFormatted || '').replace(/"/g, '""')}"`,
    `"${(log.recordedBy || '').replace(/"/g, '""')}"`,
    `"${(log.dropItemsText || '-').replace(/"/g, '""')}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Boss_Kill_History_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast('📥 ส่งออกไฟล์ประวัติการลงเวลา (CSV) เรียบร้อยแล้ว!', 'success');
}

// ================= Discord Webhook & Google Sheets Integrations =================
function updateWebhookStatusUi() {
  const label = document.getElementById('history-webhook-status-label');
  if (label) {
    const hasDiscord = Boolean(bossDiscordWebhookUrl);
    const hasSheet = Boolean(bossSheetWebhookUrl);
    if (hasDiscord && hasSheet) {
      label.textContent = 'Discord & Sheets: เชื่อมต่อแล้ว ✅';
    } else if (hasDiscord) {
      label.textContent = 'Discord: เชื่อมต่อแล้ว 🟣';
    } else if (hasSheet) {
      label.textContent = 'Sheets: เชื่อมต่อแล้ว 🟢';
    } else {
      label.textContent = 'ตั้งค่า Discord / Sheets ⚙️';
    }
  }
}

function openSheetWebhookSettingsModal() {
  if (typeof isSuperAdmin !== 'undefined' && !isSuperAdmin) {
    showToast('เฉพาะ Super Admin เท่านั้นที่สามารถตั้งค่า Webhook ได้', 'warning');
    return;
  }
  const modal = document.getElementById('boss-sheet-config-modal');
  const sheetInput = document.getElementById('sheet-webhook-url-input');
  const discordInput = document.getElementById('discord-webhook-url-input');
  const geminiInput = document.getElementById('gemini-api-key-input');
  if (sheetInput) sheetInput.value = bossSheetWebhookUrl || '';
  if (discordInput) discordInput.value = bossDiscordWebhookUrl || '';
  if (geminiInput) geminiInput.value = bossGeminiApiKey || '';
  // อัปเดตสถานะสวิตช์เปิด/ปิดการแจ้งเตือน Discord เมื่อลงเวลาบอสตาย
  updateBossKillDiscordToggleUi();
  const testStatusEl = document.getElementById('gemini-test-status');
  if (testStatusEl) {
    testStatusEl.classList.add('hidden');
    testStatusEl.innerHTML = '';
  }
  if (modal) modal.classList.remove('hidden');
}

async function testGeminiApiKeyConnection() {
  const input = document.getElementById('gemini-api-key-input');
  const statusEl = document.getElementById('gemini-test-status');
  const key = input ? input.value.trim() : '';

  if (!key) {
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-amber-300"><i class="fa-solid fa-triangle-exclamation mr-1"></i> กรุณาใส่ API Key ก่อนกดทดสอบ</span>`;
      statusEl.classList.remove('hidden');
    }
    return;
  }

  if (statusEl) {
    statusEl.innerHTML = `<span class="text-purple-300"><i class="fa-solid fa-spinner fa-spin mr-1"></i> กำลังทดสอบเชื่อมต่อกับ Google AI Studio...</span>`;
    statusEl.classList.remove('hidden');
  }

  try {
    // 1. Test ListModels on v1
    const listRes = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${key}`);
    if (!listRes.ok) {
      const errJson = await listRes.json().catch(() => ({}));
      const errMessage = errJson?.error?.message || `HTTP ${listRes.status}`;

      if (listRes.status === 404 || listRes.status === 400 || listRes.status === 403 || errMessage.includes('not found') || errMessage.includes('API_KEY_INVALID') || errMessage.includes('API key not valid')) {
        statusEl.innerHTML = `
          <div class="p-2.5 rounded-xl bg-rose-950/60 border border-rose-500/50 text-rose-200 text-[11px] space-y-1.5 text-left">
            <div class="font-bold flex items-center gap-1.5 text-rose-300">
              <i class="fa-solid fa-circle-xmark"></i> เชื่อมต่อไม่สำเร็จ (${escapeHtml(errMessage)})
            </div>
            <div>คีย์นี้ยังไม่ได้รับสิทธิ์เข้าถึง Generative AI หรือสร้างจาก Cloud ทั่วไป</div>
            <div class="pt-1">
              👉 <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" class="text-amber-300 underline font-bold hover:text-amber-200">คลิกที่นี่เพื่อไปกด Create API key ฟรีที่ Google AI Studio</a> แล้วคัดลอกมาใส่ใหม่อีกครั้งครับ
            </div>
          </div>
        `;
        return;
      }
      throw new Error(errMessage);
    }

    const listData = await listRes.json();
    const activeModels = (listData.models || [])
      .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map(m => m.name.replace(/^models\//, ''));

    // 2. Test live generateContent ping on gemini-3.5-flash
    const testGen = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: "Hello" }] }] })
    });

    if (!testGen.ok) {
      const genErrJson = await testGen.json().catch(() => ({}));
      const genErrMsg = genErrJson?.error?.message || `HTTP ${testGen.status}`;
      throw new Error(`generateContent ping failed: ${genErrMsg}`);
    }

    statusEl.innerHTML = `
      <div class="p-2.5 rounded-xl bg-emerald-950/60 border border-emerald-500/50 text-emerald-200 text-[11px] text-left space-y-1">
        <div class="font-bold flex items-center gap-1.5 text-emerald-300 text-xs">
          <i class="fa-solid fa-circle-check"></i> ✅ API Key ถูกต้อง 100%! เชื่อมต่อสำเร็จ
        </div>
        <div class="text-[10.5px] text-slate-300">
          พบโมเดลพร้อมใช้งาน <span class="font-mono text-emerald-400 font-bold">${activeModels.length}</span> ตัว (ทดสอบยิง <span class="font-mono text-purple-300">gemini-3.5-flash</span> สำเร็จแล้ว)
        </div>
      </div>
    `;
  } catch (err) {
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-rose-400"><i class="fa-solid fa-circle-xmark mr-1"></i> เกิดข้อผิดพลาด: ${escapeHtml(err.message || 'ไม่สามารถเชื่อมต่อได้')}</span>`;
    }
  }
}

function closeSheetWebhookSettingsModal() {
  const modal = document.getElementById('boss-sheet-config-modal');
  if (modal) modal.classList.add('hidden');
}

// อัปเดต UI ของสวิตช์เปิด/ปิดการแจ้งเตือน Discord เมื่อลงเวลาบอสตาย
function updateBossKillDiscordToggleUi() {
  const toggle = document.getElementById('boss-kill-discord-toggle');
  if (!toggle) return;
  const knob = toggle.querySelector('span');
  if (bossKillDiscordEnabled) {
    // เปิด: พื้นหลังสีเขียว + ลูกบิดเลื่อนไปขวา
    toggle.style.backgroundColor = '#10b981';
    toggle.setAttribute('aria-pressed', 'true');
    if (knob) knob.style.transform = 'translateX(20px)';
  } else {
    // ปิด: พื้นหลังสีเทา + ลูกบิดอยู่ซ้าย
    toggle.style.backgroundColor = '#334155';
    toggle.setAttribute('aria-pressed', 'false');
    if (knob) knob.style.transform = 'translateX(0)';
  }
}

// สลับเปิด/ปิดการแจ้งเตือน Discord เมื่อลงเวลาบอสตาย (บันทึกทันที)
function toggleBossKillDiscordAlert() {
  if (typeof isSuperAdmin !== 'undefined' && !isSuperAdmin) {
    showToast('เฉพาะ Super Admin เท่านั้นที่สามารถตั้งค่าได้', 'warning');
    return;
  }
  bossKillDiscordEnabled = !bossKillDiscordEnabled;
  localStorage.setItem('guild_boss_kill_discord_enabled', String(bossKillDiscordEnabled));
  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref('guild_app/boss_kill_discord_enabled').set(bossKillDiscordEnabled);
  }
  updateBossKillDiscordToggleUi();
  showToast(bossKillDiscordEnabled ? '🔔 เปิดการแจ้งเตือน Discord เมื่อลงเวลาบอสตายแล้ว' : '🔕 ปิดการแจ้งเตือน Discord เมื่อลงเวลาบอสตายแล้ว', 'info');
}

function saveSheetWebhookUrl() {
  const sheetInput = document.getElementById('sheet-webhook-url-input');
  const discordInput = document.getElementById('discord-webhook-url-input');
  const geminiInput = document.getElementById('gemini-api-key-input');

  const sheetUrl = sheetInput ? sheetInput.value.trim() : '';
  const discordUrl = discordInput ? discordInput.value.trim() : '';
  const geminiKey = geminiInput ? geminiInput.value.trim() : '';

  bossSheetWebhookUrl = sheetUrl;
  bossDiscordWebhookUrl = discordUrl;
  bossGeminiApiKey = geminiKey;

  localStorage.setItem('guild_boss_sheet_webhook', sheetUrl);
  localStorage.setItem('guild_boss_discord_webhook', discordUrl);
  localStorage.setItem('guild_boss_gemini_api_key', geminiKey);

  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref('guild_app/boss_sheet_webhook').set(sheetUrl);
    fbDb.ref('guild_app/boss_discord_webhook').set(discordUrl);
    fbDb.ref('guild_app/boss_gemini_api_key').set(geminiKey);
  }

  updateWebhookStatusUi();
  closeSheetWebhookSettingsModal();
  showToast('✅ บันทึกการตั้งค่า Discord, Sheets และ Gemini AI เรียบร้อยแล้ว!', 'success');
}

// Helper: Send Payload to Discord Webhook
async function sendDiscordWebhookPayload(payload) {
  if (!bossDiscordWebhookUrl) return;
  try {
    await fetch(bossDiscordWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.warn('Discord Webhook send error:', err);
  }
}

// ส่งการ์ดแจ้งเตือน Discord เมื่อลงเวลาบอสตาย (เรียกจาก saveBossKillTime)
// - เช็คสถานะเปิด/ปิด (bossKillDiscordEnabled) และ Webhook URL ก่อนส่ง
// - แสดงชื่อบอส, เวลาตาย, เวลากำเนิดรอบถัดไป, ผู้บันทึก และไอเทมดรอป (ถ้ามี)
function getDiscordDropStyle(item) {
  const text = String(item || '').toLowerCase();
  if (/legendary|ตำนาน|สีส้ม|ทอง|orange|gold/.test(text)) return { icon: '🟧', label: 'Legendary', color: 0xF59E0B };
  if (/epic|มหากาพย์|สีม่วง|ม่วง|purple|violet/.test(text)) return { icon: '🟪', label: 'Epic', color: 0xA855F7 };
  if (/rare|หายาก|สีน้ำเงิน|ฟ้า|blue/.test(text)) return { icon: '🟦', label: 'Rare', color: 0x3B82F6 };
  if (/uncommon|เขียว|สีเขียว|green/.test(text)) return { icon: '🟩', label: 'Uncommon', color: 0x22C55E };
  return { icon: '⬜', label: 'Item', color: 0xCBD5E1 };
}

function formatDiscordDropFields(dropItems) {
  let receiver = '';
  const items = dropItems.map(item => {
    const text = String(item || '').replace(/\s+/g, ' ').trim();
    const match = text.match(/\((?:ผู้รับ|recipient|receiver)\s*:\s*([^)]*)\)/i);
    if (!receiver && match && match[1]) receiver = match[1].trim();
    return text.replace(/\s*\((?:ผู้รับ|recipient|receiver)\s*:\s*[^)]*\)/gi, '').trim();
  }).filter(Boolean);
  const receiverLine = receiver ? `👤 **ผู้รับ:** ${receiver}\n\n` : '';
  return [{
    name: `🎁 DROP ITEMS • ${items.length} รายการ`,
    value: `${receiverLine}${items.map((item, index) => `${index + 1}. ${item}`).join('\n')}`.slice(0, 1024),
    inline: false
  }];
}

function sendBossKillDiscordAlert(killLogEntry) {
  // ถ้าปิดการแจ้งเตือน หรือยังไม่ได้ตั้งค่า Webhook URL ให้ข้ามไปเงียบๆ
  if (!bossKillDiscordEnabled) return;
  if (!bossDiscordWebhookUrl) return;
  if (!killLogEntry) return;

  try {
    const bossName = killLogEntry.bossName || 'บอส';
    const level = killLogEntry.level || '??';
    const map = killLogEntry.map || '-';
    const killTimeStr = killLogEntry.killTimeFormatted || '-';
    const nextSpawnStr = killLogEntry.nextSpawnFormatted || '-';
    const recordedBy = killLogEntry.recordedBy || 'Admin';
    const dropItems = Array.isArray(killLogEntry.dropItems) ? killLogEntry.dropItems : [];

    // สร้าง description ของไอเทมดรอป (ถ้ามี)
    let dropText = '';
    if (dropItems.length > 0) {
      dropText = `\n> ▎ 💎 **Drop Items**: ${dropItems.join(', ')}`;
    }

    // สร้าง Embed แจ้งเตือน (ใช้สีเขียว/ม่วง เพื่อแยกจากระบบแจ้งเตือนบอสเกิด)
    const embed = {
      color: 0x8B5CF6, // สีม่วง
      author: { name: 'LORDNINE S.6' },
      title: `💀 BOSS DOWN • Lv.${level}, ${bossName}`,
      description: `> ▎ 🗺️ **Map**: \`${map}\`\n> ▎ 💀 **Kill Time**: ${killTimeStr}\n> ▎ ⏳ **Next Spawn**: ${nextSpawnStr}\n> ▎ 👤 **Recorded By**: ${recordedBy}${dropText}`,
      footer: { text: '🛡️ LORD NINE SYSTEM • Dashboard RedDevil' },
      timestamp: new Date().toISOString()
    };

    // เพิ่มรูปบอส (ถ้ามี) โดยค้นหาจาก bossList
    // หมายเหตุ: Discord รับเฉพาะ URL ที่เป็น http/https เท่านั้น
    // ถ้า avatar เป็น base64 data URI (data:image/...) จะทำให้ Discord ตอบ 400
    // จึงต้องเช็คว่าเป็น URL จริงก่อนถึงจะใส่ thumbnail ได้
    embed.description = `🗺️ **Map**: \`${map}\`\n💀 **Kill Time**: ${killTimeStr}\n⏳ **Next Spawn**: ${nextSpawnStr}\n👤 **Recorded By**: ${recordedBy}`;
    const dropFields = formatDiscordDropFields(dropItems);
    embed.fields = dropItems.length > 0 ? dropFields : [{ name: '🎁 DROP ITEMS', value: 'ไม่มีข้อมูลไอเทมดรอป', inline: false }];

    const boss = bossList.find(b => b.id === killLogEntry.bossId);
    if (boss && boss.avatar && /^https?:\/\//i.test(boss.avatar)) {
      embed.thumbnail = { url: boss.avatar };
    }

    sendDiscordWebhookPayload({ embeds: [embed] });
  } catch (e) {
    console.warn('Boss Kill Discord Alert error:', e);
  }
}

// Check & Send Realtime Discord Spawn Alerts (5-Min Soon Warning & Spawned Alert)
async function checkAndSendDiscordSpawnAlerts() {
  if (!bossDiscordWebhookUrl) return;

  const now = getBossNow();
  const nowMs = now.getTime();

  // ล้าง sentDiscordAlerts ที่เก่าเกินไป (spawn ที่ผ่านไปแล้วเกิน 30 นาที)
  // เพื่อไม่ให้ Set โตขึ้นเรื่อยๆ โดยไม่มีขีดจำกัด
  const expiredKeys = [];
  sentDiscordAlerts.forEach(key => {
    // รูปแบบ key: `${bossId}_5m_${spawnUnix}` หรือ `${bossId}_spawned_${spawnUnix}`
    const parts = key.split('_');
    const spawnUnix = Number(parts[parts.length - 1]);
    if (!isNaN(spawnUnix) && (spawnUnix * 1000) < (nowMs - 30 * 60 * 1000)) {
      expiredKeys.push(key);
    }
  });
  expiredKeys.forEach(k => sentDiscordAlerts.delete(k));

  // สร้างข้อความ @mention จาก Role ID ที่ตั้งค่าไว้ (ไม่ hardcode)
  const roleMention = bossDiscordRoleId ? `<@&${bossDiscordRoleId}>` : '';

  for (const boss of bossList) {
    // ใช้ helper getBossNextSpawn() เพื่อรวมตรรกะคำนวณเวลากำเนิดไว้ที่เดียว
    let nextSpawn = getBossNextSpawn(boss);

    if (!nextSpawn || isNaN(nextSpawn.getTime())) continue;

    const diffMs = nextSpawn.getTime() - nowMs;
    const spawnUnix = Math.floor(nextSpawn.getTime() / 1000);
    const pad = n => String(n).padStart(2, '0');
    const timeHHmm = formatBangkokClock(nextSpawn);
    const bossDisplayName = `Lv.${boss.level || '??'}, ${boss.name}`;

    // 🟡 1. แจ้งเตือนก่อนเกิด 5 นาที (เหลือ 0 ถึง 5 นาที)
    if (diffMs > 0 && diffMs <= BOSS_WARNING_WINDOW_MS) {
      const alertKey = `${boss.id}_5m_${spawnUnix}`;
      if (!sentDiscordAlerts.has(alertKey)) {
        sentDiscordAlerts.add(alertKey);
        if (typeof fbDb !== 'undefined' && fbDb) {
          fbDb.ref(`guild_app/sent_discord_alerts/${alertKey}`).set(Date.now());
        }

        const embed5m = {
          color: 0xFFD700, // สีเหลืองทอง
          author: { name: 'LORDNINE S.6' },
          title: `⏳ SOON • ${bossDisplayName}`,
          description: `# 🕖 ${timeHHmm}\n\n> ▎ 🗺️ **Map**: \`${boss.map || '-'}\`\n> ▎ ⏳ **Get ready!** Boss spawns in 5 minutes (<t:${spawnUnix}:R>)`,
          footer: { text: '🛡️ LORD NINE SYSTEM • Dashboard RedDevil' },
          timestamp: nextSpawn.toISOString()
        };
        // ใส่ thumbnail เฉพาะเมื่อ avatar เป็น URL http/https จริง (Discord ไม่รับ base64 data URI)
        if (boss.avatar && /^https?:\/\//i.test(boss.avatar)) {
          embed5m.thumbnail = { url: boss.avatar };
        }

        sendDiscordWebhookPayload({ content: roleMention, embeds: [embed5m] });
      }
    }

    // 🔴 2. แจ้งเตือนเมื่อบอสเกิดแล้ว (เมื่อเลยเวลาเกิดมาไม่เกิน 15 นาที)
    if (diffMs <= 0 && diffMs >= -15 * 60 * 1000) {
      const alertKey = `${boss.id}_spawned_${spawnUnix}`;
      if (!sentDiscordAlerts.has(alertKey)) {
        sentDiscordAlerts.add(alertKey);
        if (typeof fbDb !== 'undefined' && fbDb) {
          fbDb.ref(`guild_app/sent_discord_alerts/${alertKey}`).set(Date.now());
        }

        const embedSpawned = {
          color: 0xFF2A2A, // สีแดงสด
          author: { name: 'LORDNINE S.6' },
          title: `🔴 SPAWN • ${bossDisplayName}`,
          description: `# 🕖 ${timeHHmm}\n\n> ▎ 🗺️ **Map**: \`${boss.map || '-'}\`\n> ▎ 🚨 **Boss has spawned!** Hunt it now`,
          footer: { text: '🛡️ LORD NINE SYSTEM • Dashboard RedDevil' },
          timestamp: now.toISOString()
        };
        // ใส่ thumbnail เฉพาะเมื่อ avatar เป็น URL http/https จริง (Discord ไม่รับ base64 data URI)
        if (boss.avatar && /^https?:\/\//i.test(boss.avatar)) {
          embedSpawned.thumbnail = { url: boss.avatar };
        }

        sendDiscordWebhookPayload({ content: roleMention, embeds: [embedSpawned] });
      }
    }
  }
}

// Test Discord Webhook
async function testDiscordWebhook() {
  const input = document.getElementById('discord-webhook-url-input');
  const url = input ? input.value.trim() : (bossDiscordWebhookUrl || '');
  if (!url) {
    showToast('กรุณาวาง Discord Webhook URL ก่อนกดทดสอบ', 'warning');
    return;
  }

  try {
    const payload = {
      embeds: [{
        title: '🧪 ทดสอบการเชื่อมต่อ Discord Webhook สำเร็จ! 🎉',
        description: 'ระบบ Boss Timer & Dashboard สามารถส่งการแจ้งเตือนเข้าห้องนี้ได้เรียบร้อยแล้วครับ ⚔️🔥',
        color: 0x10B981,
        fields: [
          { name: '⏰ เวลาที่ทดสอบ', value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true },
          { name: '🛡️ สถานะ', value: '🟢 พร้อมใช้งาน 100%', inline: true }
        ],
        footer: { text: '🛡️ LORD NINE SYSTEM • Dashboard RedDevil' },
        timestamp: new Date().toISOString()
      }]
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok || res.status === 204) {
      showToast('🎉 ส่งข้อความทดสอบเข้า Discord เรียบร้อยแล้ว!', 'success');
    } else {
      showToast(`⚠️ Discord ตอบกลับสถานะ: ${res.status}`, 'warning');
    }
  } catch (e) {
    console.error('Discord Webhook test error:', e);
    showToast('❌ ไม่สามารถส่งข้อความเข้า Discord ได้ (ตรวจสอบ URL อีกครั้ง)', 'danger');
  }
}

// Drop Log Viewer Modal
let currentViewDropBossId = null;

function openBossDropLogModal(bossId) {
  currentViewDropBossId = bossId;
  const modal = document.getElementById('boss-drop-log-modal');
  const title = document.getElementById('boss-drop-log-title');
  const list = document.getElementById('boss-drop-log-list');

  const boss = bossList.find(b => b.id === bossId);
  if (title) title.textContent = boss ? `ประวัติดรอป: ${boss.name}` : 'ประวัติไอเทมดรอปทั้งหมด';

  const logs = bossId ? bossDropLogs.filter(l => l.bossId === bossId) : bossDropLogs;

  if (list) {
    if (logs.length === 0) {
      list.innerHTML = `<div class="p-6 text-center text-slate-500 text-xs">ยังไม่มีบันทึกไอเทมดรอปสำหรับบอสตัวนี้</div>`;
    } else {
      // ใช้ isBossTimerAdmin() เพื่อให้สอดคล้องกับเช็คสิทธิ์อื่นๆ ในโมดูล
      const isUserAdmin = typeof isBossTimerAdmin !== 'undefined' ? isBossTimerAdmin() : false;

      list.innerHTML = logs.map(l => `
        <div class="p-3 bg-slate-900/90 border border-slate-800 rounded-2xl space-y-2 shadow-sm relative group">
          <div class="flex items-center justify-between text-xs pb-1.5 border-b border-slate-800/80">
            <div class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-amber-400"></span>
              <span class="font-bold text-amber-300 text-sm">${escapeHtml(l.bossName)}</span>
            </div>
            <div class="flex items-center gap-1.5">
              <span class="font-mono text-[11px] text-slate-400 px-2 py-0.5 rounded-full bg-slate-950 border border-slate-800">
                <i class="fa-regular fa-clock text-[9px] mr-1"></i>${formatDateTimeShort(new Date(l.killTime))}
              </span>
              ${isUserAdmin ? `
                <button type="button" onclick="deleteBossDropLog('${l.id}')"
                  class="w-6 h-6 rounded-lg bg-rose-950/60 hover:bg-rose-600 text-rose-300 hover:text-white flex items-center justify-center text-[10px] border border-rose-500/30 hover:border-rose-500 transition shadow-sm" title="ลบรายการนี้">
                  <i class="fa-solid fa-trash-can"></i>
                </button>
              ` : ''}
            </div>
          </div>
          <div class="space-y-1.5">
            ${l.items.map(item => `
              <div class="text-xs text-slate-200 bg-slate-950/80 border border-slate-800/90 rounded-xl px-2.5 py-1.5 flex items-center justify-between gap-2 shadow-inner">
                <span class="flex items-center gap-1.5 text-white font-medium">
                  <i class="fa-solid fa-gem text-amber-400 text-[10px]"></i>
                  <span>${escapeHtml(item)}</span>
                </span>
              </div>
            `).join('')}
          </div>
          <div class="text-[10px] text-slate-500 text-right pt-1">บันทึกโดย: <span class="font-mono text-slate-400">${escapeHtml(l.recordedBy || 'Admin')}</span></div>
        </div>
      `).join('');
    }
  }

  if (modal) modal.classList.remove('hidden');
}

function closeBossDropLogModal() {
  const modal = document.getElementById('boss-drop-log-modal');
  if (modal) modal.classList.add('hidden');
  currentViewDropBossId = null;
}

function deleteBossDropLog(logId) {
  if (typeof isBossTimerAdmin !== 'undefined' && !isBossTimerAdmin()) {
    showToast('เฉพาะ Admin เท่านั้นที่สามารถลบ Log ไอเทมได้ค่ะ', 'warning');
    return;
  }

  if (!confirm('คุณต้องการลบรายการบันทึกไอเทมดรอปนี้ใช่หรือไม่?')) return;

  const deletedLog = bossDropLogs.find(l => l.id === logId);
  const bossName = deletedLog ? (deletedLog.bossName || deletedLog.bossId) : 'บอส';
  const dropInfo = deletedLog && Array.isArray(deletedLog.items) ? deletedLog.items.map(i => `${i.name || i.itemName} x${i.qty || i.quantity || 1}`).join(', ') : '';

  bossDropLogs = bossDropLogs.filter(l => l.id !== logId);
  localStorage.setItem('guild_boss_drop_logs', JSON.stringify(bossDropLogs));
  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref('guild_app/boss_drop_logs').set(bossDropLogs);
  }

  const adminEmail = (typeof currentAdminEmail !== 'undefined' && currentAdminEmail) ? currentAdminEmail : 'Admin';
  if (typeof addAuditLog === 'function') {
    addAuditLog(
      'boss_drop_delete',
      `ลบรายการบันทึกไอเทมดรอปของบอส "${bossName}"`,
      `${dropInfo ? `ไอเทม: ${dropInfo} | ` : ''}โดย Admin: ${adminEmail}`,
      'BossTimer'
    );
  }

  showToast('🗑️ ลบรายการบันทึกไอเทมดรอปเรียบร้อยแล้วค่ะ', 'success');
  openBossDropLogModal(currentViewDropBossId);
}

// Sound Alert Toggle
function toggleBossSound() {
  isBossSoundEnabled = !isBossSoundEnabled;
  localStorage.setItem('guild_boss_sound_enabled', isBossSoundEnabled ? 'true' : 'false');
  const icon = document.getElementById('btn-boss-sound-icon');
  if (icon) {
    icon.className = isBossSoundEnabled ? 'fa-solid fa-volume-high text-emerald-400' : 'fa-solid fa-volume-xmark text-slate-500';
  }
  showToast(isBossSoundEnabled ? '🔔 เปิดเสียงแจ้งเตือนบอส' : '🔕 ปิดเสียงแจ้งเตือนบอส', 'info');
  if (isBossSoundEnabled) playBossAlertSound();
}

// Helper Script Loader
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// Expose all functions to global window for inline onclick handlers
window.initBossTimerModule = initBossTimerModule;
window.openMaintenanceModal = openMaintenanceModal;
window.closeMaintenanceModal = closeMaintenanceModal;
window.handleConfirmMaintenance = handleConfirmMaintenance;
window.switchAppModule = switchAppModule;
window.recordBossKillNow = recordBossKillNow;
window.openBossKillConfirmModal = openBossKillConfirmModal;
window.closeBossKillConfirmModal = closeBossKillConfirmModal;

window.applyQuickKillConfirmTime = applyQuickKillConfirmTime;
window.handleKillConfirmFileSelect = handleKillConfirmFileSelect;
window.clearKillConfirmImage = clearKillConfirmImage;
window.handleSaveKillConfirm = handleSaveKillConfirm;
window.openBossDoubleCheckModal = openBossDoubleCheckModal;
window.closeBossDoubleCheckModal = closeBossDoubleCheckModal;
window.commitSaveBossKillConfirm = commitSaveBossKillConfirm;
window.openEditBossModal = openEditBossModal;
window.closeEditBossModal = closeEditBossModal;
window.handleSaveEditBoss = handleSaveEditBoss;
window.handleBossAvatarFileSelect = handleBossAvatarFileSelect;
window.updateBossAvatarFromUrl = updateBossAvatarFromUrl;
window.clearBossAvatar = clearBossAvatar;
window.applyQuickEditDefTime = applyQuickEditDefTime;
window.resetSingleBossTimer = resetSingleBossTimer;
window.openBossDropLogModal = openBossDropLogModal;
window.closeBossDropLogModal = closeBossDropLogModal;
window.deleteBossDropLog = deleteBossDropLog;
window.processImageForBossOCR = processImageForBossOCR;
window.toggleBossSound = toggleBossSound;
window.renderBossTimerCards = renderBossTimerCards;
window.copyBossInfo = copyBossInfo;
window.closeBossAiOcrModal = closeBossAiOcrModal;
window.handleConfirmOcrSave = handleConfirmOcrSave;
window.clearAllBossTimers = clearAllBossTimers;
window.openBossKillHistoryModal = openBossKillHistoryModal;
window.closeBossKillHistoryModal = closeBossKillHistoryModal;
window.renderBossKillHistoryList = renderBossKillHistoryList;
window.clearAllBossKillLogsPrompt = clearAllBossKillLogsPrompt;
window.exportBossKillLogsToCsv = exportBossKillLogsToCsv;
window.openSheetWebhookSettingsModal = openSheetWebhookSettingsModal;
window.closeSheetWebhookSettingsModal = closeSheetWebhookSettingsModal;
window.saveSheetWebhookUrl = saveSheetWebhookUrl;
window.sendKillLogToGoogleSheet = sendKillLogToGoogleSheet;
window.checkAndSendDiscordSpawnAlerts = checkAndSendDiscordSpawnAlerts;
window.testDiscordWebhook = testDiscordWebhook;
window.updateWebhookStatusUi = updateWebhookStatusUi;

// ==============================================================================
// ==============================================================================
// 🗂️ ระบบวางแผนจัดกลุ่มบอส & ลำดับการตีหลังเปิดเซิร์ฟ (Boss Raid Route Planner)
// ==============================================================================

// รายการบอสฟิลด์ 22 ตัวที่นับรอบเกิดหลังเซิร์ฟเปิด (ไม่รวมบอสตามเวลา & กิจกรรมกิลด์)
function getIntervalFieldBosses() {
  return bossList.filter(b => b.respawnType === 'interval' && b.id !== 'guild_arena' && b.id !== 'reddevil_guild_boss')
    .sort((a, b) => (parseInt(b.level) || 0) - (parseInt(a.level) || 0));
}

let raidPlannerSets = parseStoredJson('guild_boss_raid_sets', [
  { id: 1, name: '🔥 ชุดที่ 1 : บอสระดับสูง (Lv.95 - 100)', bossIds: ['asta', 'ordo', 'secreta', 'supore', 'catena', 'gareth', 'larba', 'titore', 'shuliar'] },
  { id: 2, name: '⚡ ชุดที่ 2 : บอสระดับกลาง (Lv.85 - 93)', bossIds: ['wannitas', 'metus', 'duplican', 'baron_braudmore', 'amentis', 'general_aquleus', 'lady_dalia'] },
  { id: 3, name: '🎯 ชุดที่ 3 : บอสทั่วไป (Lv.60 - 80)', bossIds: ['undomiel', 'livera', 'araneo', 'ego', 'vioren', 'venatus'] }
]);

function saveRaidPlannerSets() {
  localStorage.setItem('guild_boss_raid_sets', JSON.stringify(raidPlannerSets));
  if (typeof fbDb !== 'undefined' && fbDb) {
    fbDb.ref('guild_app/boss_raid_sets').set(raidPlannerSets);
  }
}

function openBossRaidPlannerModal() {
  // เช็คสิทธิ์: เฉพาะ Admin เท่านั้นที่เปิด Raid Planner ได้
  if (typeof isBossTimerAdmin !== 'undefined' && !isBossTimerAdmin()) {
    showToast('เฉพาะ Admin เท่านั้นที่สามารถเปิด Raid Planner ได้ค่ะ', 'warning');
    return;
  }
  const modal = document.getElementById('boss-raid-planner-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  renderRaidPlannerSets();
  updateRaidDiscordPreview();
}

function closeBossRaidPlannerModal() {
  const modal = document.getElementById('boss-raid-planner-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function addNewRaidSet() {
  const newId = Date.now();
  const setNumber = raidPlannerSets.length + 1;
  raidPlannerSets.push({
    id: newId,
    name: `⚔️ ชุดที่ ${setNumber}`,
    bossIds: []
  });
  saveRaidPlannerSets();
  renderRaidPlannerSets();
  updateRaidDiscordPreview();
  showToast(`เพิ่ม "ชุดที่ ${setNumber}" เรียบร้อยแล้ว`, 'info');
}

function removeRaidSet(setId) {
  if (raidPlannerSets.length <= 1) {
    showToast('ต้องมีอย่างน้อย 1 ชุดการตีบอสครับ', 'warning');
    return;
  }
  raidPlannerSets = raidPlannerSets.filter(s => s.id !== setId);
  saveRaidPlannerSets();
  renderRaidPlannerSets();
  updateRaidDiscordPreview();
}

function updateRaidSetName(setId, newName) {
  const set = raidPlannerSets.find(s => s.id === setId);
  if (set) {
    set.name = newName.trim() || `ชุดการตีบอส`;
    saveRaidPlannerSets();
    updateRaidDiscordPreview();
  }
}

function toggleBossInRaidSet(setId, bossId) {
  const set = raidPlannerSets.find(s => s.id === setId);
  if (!set) return;

  if (set.bossIds.includes(bossId)) {
    // ลบออกจากชุดนี้
    set.bossIds = set.bossIds.filter(id => id !== bossId);
  } else {
    // ถอดออกจากชุดอื่นก่อน (ถ้ามี) เพื่อไม่ให้บอสซ้ำชุดกัน
    raidPlannerSets.forEach(otherSet => {
      otherSet.bossIds = (otherSet.bossIds || []).filter(id => id !== bossId);
    });
    set.bossIds.push(bossId);
  }

  saveRaidPlannerSets();
  renderRaidPlannerSets();
  updateRaidDiscordPreview();
}

function removeBossFromRaidSet(setId, bossId) {
  const set = raidPlannerSets.find(s => s.id === setId);
  if (!set) return;
  set.bossIds = set.bossIds.filter(id => id !== bossId);
  saveRaidPlannerSets();
  renderRaidPlannerSets();
  updateRaidDiscordPreview();
}

function clearAllBossesInSet(setId) {
  const set = raidPlannerSets.find(s => s.id === setId);
  if (!set) return;
  set.bossIds = [];
  saveRaidPlannerSets();
  renderRaidPlannerSets();
  updateRaidDiscordPreview();
}

function renderRaidPlannerSets() {
  const container = document.getElementById('raid-planner-sets-container');
  const totalBadge = document.getElementById('raid-total-bosses-badge');
  if (!container) return;

  const fieldBosses = getIntervalFieldBosses();

  let totalBossesCount = 0;
  raidPlannerSets.forEach(s => { totalBossesCount += (s.bossIds || []).length; });
  if (totalBadge) {
    totalBadge.textContent = `${totalBossesCount} / ${fieldBosses.length} ตัวในแผน (${raidPlannerSets.length} ชุด)`;
  }

  let html = '';
  raidPlannerSets.forEach((set, sIdx) => {
    const bossCount = (set.bossIds || []).length;

    html += `
      <div class="bg-slate-950/90 border border-amber-500/30 hover:border-amber-500/50 rounded-2xl p-3.5 space-y-3 shadow-md transition font-sarabun">
        
        <!-- Set Header Bar -->
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-2 flex-1 min-w-[200px]">
            <span class="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center justify-center text-xs font-black font-mono shrink-0">
              #${sIdx + 1}
            </span>
            <input type="text" value="${escapeHtml(set.name)}" 
              onchange="updateRaidSetName(${set.id}, this.value)"
              class="bg-slate-900 border border-slate-700/80 hover:border-amber-500/60 focus:border-amber-400 text-xs font-bold text-amber-200 rounded-xl px-2.5 py-1 flex-1 focus:outline-none transition"
              placeholder="ชื่อชุดการตีบอส..." />
            <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold shrink-0 border border-amber-500/30">
              ${bossCount} ตัว
            </span>
          </div>

          <div class="flex items-center gap-1 shrink-0">
            ${bossCount > 0 ? `
              <button type="button" onclick="clearAllBossesInSet(${set.id})"
                class="px-2 py-0.5 text-[10.5px] text-slate-400 hover:text-amber-300 hover:bg-slate-800 rounded-lg transition"
                title="ล้างบอสทั้งหมดในชุดนี้">
                ล้างชุดนี้
              </button>
            ` : ''}
            <button type="button" onclick="removeRaidSet(${set.id})" 
              class="p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition text-xs"
              title="ลบชุดนี้">
              <i class="fa-regular fa-trash-can"></i>
            </button>
          </div>
        </div>

        <!-- Bosses Selected Inside This Set (Compact Chips) -->
        <div>
          <div class="text-[10.5px] font-bold text-slate-400 mb-1.5 flex items-center justify-between">
            <span>บอสในชุดนี้ (คลิกเพื่อนำออก):</span>
            <span class="text-[10px] text-amber-400/80 font-mono">${bossCount} รายการ</span>
          </div>
          
          <div class="flex flex-wrap gap-1.5 p-2 bg-slate-900/80 rounded-xl border border-slate-800/80 min-h-[42px] items-center">
            ${bossCount === 0 ? `
              <div class="text-[11px] text-slate-500 w-full text-center py-1">
                คลิกเลือกการ์ดบอสจากรายการด้านล่าง เพื่อเพิ่มเข้าชุดนี้ ⬇️
              </div>
            ` : (set.bossIds || []).map((bossId, bIdx) => {
      const b = bossList.find(x => x.id === bossId) || { id: bossId, name: bossId, level: '??' };
      return `
                <button type="button" onclick="removeBossFromRaidSet(${set.id}, '${b.id}')"
                  class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-amber-500 text-slate-950 font-black text-xs shadow-md border border-amber-400 hover:bg-amber-400 active:scale-95 transition group"
                  title="คลิกเพื่อนำ ${b.name} ออกจากชุดนี้">
                  <span class="text-[10px] font-mono opacity-80">${bIdx + 1}.</span>
                  <span>${escapeHtml(b.name)}</span>
                  <span class="px-1.5 py-0.2 rounded text-[9.5px] bg-black/30 text-amber-200 font-mono">Lv.${b.level}</span>
                  <i class="fa-solid fa-xmark text-[10px] opacity-70 group-hover:opacity-100 group-hover:text-rose-950"></i>
                </button>
              `;
    }).join('')}
          </div>
        </div>

        <!-- Compact Boss Picker Grid (22 Interval Field Bosses - Name & Level Only) -->
        <div class="pt-1">
          <div class="text-[10.5px] font-bold text-amber-300/90 mb-1.5 flex items-center gap-1">
            <i class="fa-solid fa-hand-pointer text-amber-400"></i> เลือกบอสเข้าชุดนี้ (คลิกเพื่อเพิ่ม/สลับ):
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
            ${fieldBosses.map(b => {
      const isCurrentSet = (set.bossIds || []).includes(b.id);
      const otherSetOwner = raidPlannerSets.find(s => s.id !== set.id && (s.bossIds || []).includes(b.id));

      let btnClass = 'bg-slate-900/90 text-slate-300 border-slate-700/80 hover:border-amber-400 hover:text-amber-200 hover:bg-slate-800';
      let badgeHtml = `<span class="text-[9.5px] font-mono px-1 py-0.2 rounded bg-slate-800 text-slate-400">Lv.${b.level}</span>`;

      if (isCurrentSet) {
        btnClass = 'bg-amber-500 text-slate-950 font-black border-amber-300 shadow-md shadow-amber-500/20';
        badgeHtml = `<span class="text-[9.5px] font-mono px-1 py-0.2 rounded bg-slate-950/40 text-slate-950 font-black">✓ ในชุดนี้</span>`;
      } else if (otherSetOwner) {
        const sNum = raidPlannerSets.indexOf(otherSetOwner) + 1;
        btnClass = 'bg-slate-950 text-slate-400 border-slate-800/80 hover:border-amber-400/60 hover:text-slate-200 opacity-60 hover:opacity-100';
        badgeHtml = `<span class="text-[9px] font-mono px-1 py-0.2 rounded bg-slate-800 text-amber-400 border border-slate-700">#${sNum}</span>`;
      }

      return `
                <button type="button" onclick="toggleBossInRaidSet(${set.id}, '${b.id}')"
                  class="flex items-center justify-between px-2 py-1.5 rounded-xl border text-[11px] transition active:scale-95 ${btnClass}"
                  title="${escapeHtml(b.name)} (Lv.${b.level}) • ${escapeHtml(b.map || '')}">
                  <span class="truncate font-bold mr-1">${escapeHtml(b.name)}</span>
                  ${badgeHtml}
                </button>
              `;
    }).join('')}
          </div>
        </div>

      </div>
    `;
  });

  container.innerHTML = html;
}

function resetRaidPlannerSets() {
  if (!confirm('คุณต้องการรีเซ็ตชุดการตีบอสทั้งหมดกลับสู่ค่าเริ่มต้นใช่หรือไม่?')) return;
  raidPlannerSets = [
    { id: 1, name: '🔥 ชุดที่ 1 : บอสระดับสูง (Lv.95 - 100)', bossIds: ['asta', 'ordo', 'secreta', 'supore', 'catena', 'gareth', 'larba', 'titore', 'shuliar'] },
    { id: 2, name: '⚡ ชุดที่ 2 : บอสระดับกลาง (Lv.85 - 93)', bossIds: ['wannitas', 'metus', 'duplican', 'baron_braudmore', 'amentis', 'general_aquleus', 'lady_dalia'] },
    { id: 3, name: '🎯 ชุดที่ 3 : บอสทั่วไป (Lv.60 - 80)', bossIds: ['undomiel', 'livera', 'araneo', 'ego', 'vioren', 'venatus'] }
  ];
  saveRaidPlannerSets();
  renderRaidPlannerSets();
  updateRaidDiscordPreview();
  showToast('รีเซ็ตชุดการตีบอสเรียบร้อยแล้ว', 'info');
}

function autoOrganizeRaidSets(strategy) {
  const fieldBosses = getIntervalFieldBosses();

  if (strategy === 'level') {
    // Group 1: Lv. 95 - 100 (9 ตัว)
    // Group 2: Lv. 85 - 93 (7 ตัว)
    // Group 3: Lv. 60 - 80 (6 ตัว)
    const set1 = [];
    const set2 = [];
    const set3 = [];

    fieldBosses.forEach(b => {
      const lvl = parseInt(b.level) || 0;
      if (lvl >= 95) {
        set1.push(b.id);
      } else if (lvl >= 85) {
        set2.push(b.id);
      } else {
        set3.push(b.id);
      }
    });

    raidPlannerSets = [
      { id: 1, name: '👑 ชุดที่ 1 : บอสระดับสูง (Lv.95 - 100)', bossIds: set1 },
      { id: 2, name: '⚡ ชุดที่ 2 : บอสระดับกลาง (Lv.85 - 93)', bossIds: set2 },
      { id: 3, name: '🎯 ชุดที่ 3 : บอสทั่วไป (Lv.60 - 80)', bossIds: set3 }
    ];
    showToast('จัดกลุ่ม 22 บอสฟิลด์ตามระดับ Level สำเร็จ!', 'success');
  } else if (strategy === 'spawn_time') {
    // เรียงตามชั่วโมงเกิดเร็วไปช้า (10h ➔ 62h)
    const sorted = [...fieldBosses].sort((a, b) => {
      const intA = a.intervalHours || 999;
      const intB = b.intervalHours || 999;
      return intA - intB;
    });

    const chunkSize = Math.ceil(sorted.length / 3);
    raidPlannerSets = [
      { id: 1, name: '⚡ ชุดที่ 1 : เกิดไวสุด (10h - 24h)', bossIds: sorted.slice(0, chunkSize).map(b => b.id) },
      { id: 2, name: '⏳ ชุดที่ 2 : เกิดปานกลาง (29h - 37h)', bossIds: sorted.slice(chunkSize, chunkSize * 2).map(b => b.id) },
      { id: 3, name: '🛡️ ชุดที่ 3 : เกิดช้าสุด (48h - 62h)', bossIds: sorted.slice(chunkSize * 2).map(b => b.id) }
    ];
    showToast('จัดกลุ่มบอสตามรอบเวลาเกิด (Interval) สำเร็จ!', 'success');
  } else if (strategy === 'map') {
    const zone1 = []; // ทุ่งหญ้าแดง & ดอนแห่งการปฏิวัติ
    const zone2 = []; // ดินแดนมรณะ & ซากของสงคราม & สมรภูมิ
    const zone3 = []; // เนินเขาอัสดง & สุสาน & ทะเลสาบ & แอ่งน้ำ & หุบเขา & ห้องทดลอง

    fieldBosses.forEach(b => {
      const m = b.map || '';
      if (m.includes('ทุ่งหญ้าแดง') || m.includes('ดอนแห่งการปฏิวัติ')) {
        zone1.push(b.id);
      } else if (m.includes('ดินแดนมรณะ') || m.includes('ซากของสงคราม') || m.includes('สมรภูมิ') || m.includes('โบราณสถาน')) {
        zone2.push(b.id);
      } else {
        zone3.push(b.id);
      }
    });

    raidPlannerSets = [
      { id: 1, name: '🗺️ ชุดที่ 1 : โซนทุ่งหญ้าแดง & ดอนแห่งการปฏิวัติ', bossIds: zone1 },
      { id: 2, name: '🗺️ ชุดที่ 2 : โซนดินแดนมรณะ & ซากสงคราม & สมรภูมิ', bossIds: zone2 },
      { id: 3, name: '🗺️ ชุดที่ 3 : โซนเนินเขาอัสดง & สุสาน & อื่นๆ', bossIds: zone3 }
    ];
    showToast('จัดกลุ่มบอสตามโซนแผนที่สำเร็จ!', 'success');
  }

  saveRaidPlannerSets();
  renderRaidPlannerSets();
  updateRaidDiscordPreview();
}

let currentRaidSeparator = 'arrow'; // 'arrow' | 'slash' | 'greater'

function setRaidFormatSeparator(sep) {
  currentRaidSeparator = sep;
  const btnArrow = document.getElementById('btn-sep-arrow');
  const btnSlash = document.getElementById('btn-sep-slash');
  const btnGreater = document.getElementById('btn-sep-greater');

  const activeClass = 'px-2 py-0.5 rounded-lg text-xs font-bold bg-amber-500 text-slate-950 border border-amber-400 shadow-sm transition';
  const inactiveClass = 'px-2 py-0.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700 hover:text-white transition';

  if (btnArrow) btnArrow.className = (sep === 'arrow') ? activeClass : inactiveClass;
  if (btnSlash) btnSlash.className = (sep === 'slash') ? activeClass : inactiveClass;
  if (btnGreater) btnGreater.className = (sep === 'greater') ? activeClass : inactiveClass;

  updateRaidDiscordPreview();
}

function generateDiscordRaidAnnouncementText() {
  const showHeader = document.getElementById('raid-show-header')?.checked || false;
  const showSetNames = document.getElementById('raid-show-set-names')?.checked ?? true;
  const title = (document.getElementById('raid-plan-title')?.value || '').trim();
  const meetingTime = (document.getElementById('raid-plan-meeting-time')?.value || '').trim();

  let sepChar = ' ➔ ';
  if (currentRaidSeparator === 'slash') sepChar = ' / ';
  else if (currentRaidSeparator === 'greater') sepChar = ' > ';

  let lines = [];

  if (showHeader) {
    if (title) lines.push(`📢 ${title}`);
    if (meetingTime) lines.push(`⏰ เวลารวมพล: ${meetingTime}`);
    lines.push('----------------------------------------');
  }

  raidPlannerSets.forEach((set, sIdx) => {
    const bossIds = set.bossIds || [];
    if (bossIds.length === 0) return;

    const bossNames = bossIds.map(bossId => {
      const b = bossList.find(x => x.id === bossId);
      return b ? b.name : bossId;
    });

    const chainText = bossNames.join(sepChar);

    if (showSetNames) {
      lines.push(`ชุดที่ ${sIdx + 1}: ${chainText}`);
    } else {
      lines.push(chainText);
    }
  });

  return lines.join('\n');
}

function updateRaidDiscordPreview() {
  const previewEl = document.getElementById('raid-discord-preview-text');
  if (previewEl) {
    previewEl.value = generateDiscordRaidAnnouncementText();
  }
}

function copyDiscordRaidAnnouncement() {
  const text = generateDiscordRaidAnnouncementText();
  if (!text) {
    showToast('ไม่มีข้อมูลประกาศสำหรับคัดลอก', 'warning');
    return;
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('📋 คัดลอกข้อความแผนการตีบอสเรียบร้อยแล้ว! นำไป Paste ในแชทเกมส์ หรือ Discord ได้เลย 🎉', 'success');
    }).catch(() => {
      fallbackCopyText(text);
    });
  } else {
    fallbackCopyText(text);
  }

  const adminEmail = (typeof currentAdminEmail !== 'undefined' && currentAdminEmail) ? currentAdminEmail : 'Admin';
  if (typeof addAuditLog === 'function') {
    addAuditLog('boss_raid_plan', 'คัดลอกข้อความแผนการตีบอสลง Discord/แชทเกมส์', `โดย: ${adminEmail}`, 'BossTimer');
  }
}

function fallbackCopyText(text) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand('copy');
    showToast('📋 คัดลอกข้อความสำเร็จแล้ว! 🎉', 'success');
  } catch (err) {
    showToast('ไม่สามารถคัดลอกอัตโนมัติได้ กรุณากดเลือกข้อความในกล่องแล้วกด Ctrl + C ครับ', 'warning');
  }
  document.body.removeChild(textArea);
}

async function sendRaidAnnouncementToDiscordWebhook() {
  const webhookUrl = bossDiscordWebhookUrl || localStorage.getItem('guild_boss_discord_webhook');
  if (!webhookUrl) {
    showToast('ยังไม่ได้ตั้งค่า Discord Webhook กรุณากดปุ่ม "ตั้งค่า Discord / Sheets" ด้านบนเพื่อใส่ Webhook URL ก่อนครับ', 'warning');
    openSheetWebhookSettingsModal();
    return;
  }

  const text = generateDiscordRaidAnnouncementText();
  if (!text) return;

  const btn = document.getElementById('btn-raid-send-webhook');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-xs"></i> <span>กำลังส่งข้อความเข้า Discord...</span>`;
  }

  try {
    const payload = {
      content: '```text\n' + text + '\n```',
      username: '😈 BlueDevil & RedDevil Boss Tracker',
      avatar_url: 'https://cdn-icons-png.flaticon.com/512/3408/3408590.png'
    };

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      showToast('🚀 ส่งประกาศแผนการตีบอสเข้าห้อง Discord สำเร็จเรียบร้อยแล้ว! 🎉', 'success');
      const adminEmail = (typeof currentAdminEmail !== 'undefined' && currentAdminEmail) ? currentAdminEmail : 'Admin';
      if (typeof addAuditLog === 'function') {
        addAuditLog('boss_raid_plan', 'ยิงประกาศแผนการตีบอสเข้า Discord Webhook', `โดย: ${adminEmail}`, 'BossTimer');
      }
    } else {
      showToast(`❌ ส่งเข้า Discord ไม่สำเร็จ (HTTP ${res.status}) ตรวจสอบ Webhook URL อีกครั้ง`, 'error');
    }
  } catch (err) {
    console.error('Discord Webhook Error:', err);
    showToast('❌ เกิดข้อผิดพลาดในการส่ง Webhook: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-paper-plane text-xs"></i> <span>🚀 ยิงข้อความเข้า Discord Webhook อัตโนมัติ</span>`;
    }
  }
}

// Raid Route Planner window exports
window.openBossRaidPlannerModal = openBossRaidPlannerModal;
window.closeBossRaidPlannerModal = closeBossRaidPlannerModal;
window.addNewRaidSet = addNewRaidSet;
window.removeRaidSet = removeRaidSet;
window.updateRaidSetName = updateRaidSetName;
window.toggleBossInRaidSet = toggleBossInRaidSet;
window.removeBossFromRaidSet = removeBossFromRaidSet;
window.clearAllBossesInSet = clearAllBossesInSet;
window.resetRaidPlannerSets = resetRaidPlannerSets;
window.autoOrganizeRaidSets = autoOrganizeRaidSets;
window.setRaidFormatSeparator = setRaidFormatSeparator;
window.updateRaidDiscordPreview = updateRaidDiscordPreview;
window.copyDiscordRaidAnnouncement = copyDiscordRaidAnnouncement;
window.sendRaidAnnouncementToDiscordWebhook = sendRaidAnnouncementToDiscordWebhook;
window.validateBossTimerData = validateBossTimerData;
window.getBossDataHealth = getBossDataHealth;
window.getBossSchedulePreview = getBossSchedulePreview;
window.testBossDiscordAlert = testBossDiscordAlert;



