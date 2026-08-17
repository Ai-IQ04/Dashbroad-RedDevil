/**
 * Boss Timer & AI OCR Module for Guild Dashboard
 * Completely decoupled from guild scoring logic.
 */

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
let sentDiscordAlerts = new Set();
let bossTimerInterval = null;
let currentBossFilter = 'all';
let currentBossSearch = '';
let isBossSoundEnabled = localStorage.getItem('guild_boss_sound_enabled') !== 'false';
let activeAppModule = 'scoring'; // 'scoring' | 'boss_timer'

// 45+ Boss definitions from Google Sheet
const DEFAULT_BOSS_DATABASE = [
  { id: 'world_boss', name: 'World Boss', level: '60-105', map: 'World Boss', respawnType: 'fixed', scheduleText: 'Daily 10:00/19:00', fixedTimes: [{days: [0,1,2,3,4,5,6], time: '10:00'}, {days: [0,1,2,3,4,5,6], time: '19:00'}], note: 'World Boss' },
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
  { id: 'clemantis', name: 'Clemantis', level: '70', map: 'แอ่งน้ำปนเปื้อน', respawnType: 'fixed', scheduleText: 'Mon 10:30 / Thu 18:00', fixedTimes: [{days: [1], time: '10:30'}, {days: [4], time: '18:00'}], note: 'แอ่งน้ำปนเปื้อน' },
  { id: 'saphirus', name: 'Saphirus', level: '80', map: 'ทะเลสาบจันทร์เสี้ยว', respawnType: 'fixed', scheduleText: 'Sun 16:00 / Tue 10:30', fixedTimes: [{days: [0], time: '16:00'}, {days: [2], time: '10:30'}], note: 'ทะเลสาบจันทร์เสี้ยว' },
  { id: 'neutro', name: 'Neutro', level: '80', map: 'ทะเลทรายกรีดร้อง', respawnType: 'fixed', scheduleText: 'Tue 18:00 / Thu 10:30', fixedTimes: [{days: [2], time: '18:00'}, {days: [4], time: '10:30'}], note: 'ทะเลทรายกรีดร้อง' },
  { id: 'thymele', name: 'Thymele', level: '85', map: 'เนินเขาอัสดง', respawnType: 'fixed', scheduleText: 'Mon 18:00 / Wed 10:30', fixedTimes: [{days: [1], time: '18:00'}, {days: [3], time: '10:30'}], note: 'เนินเขาอัสดง' },
  { id: 'roderick', name: 'Roderick', level: '95', map: 'ทางระบายน้ำ ชั้น 1', respawnType: 'fixed', scheduleText: 'Fri 18:00', fixedTimes: [{days: [5], time: '18:00'}], note: 'ทางระบายน้ำ ชั้น 1' },
  { id: 'auraq', name: 'Auraq', level: '100', map: 'ทางระบายน้ำ ชั้น 2', respawnType: 'fixed', scheduleText: 'Fri 21:00 / Wed 20:00', fixedTimes: [{days: [5], time: '21:00'}, {days: [3], time: '20:00'}], note: 'ทางระบายน้ำ ชั้น 2' },
  { id: 'milavy', name: 'Milavy', level: '90', map: 'สุสานใต้ดิน ชั้น 3', respawnType: 'fixed', scheduleText: 'Sat 14:00', fixedTimes: [{days: [6], time: '14:00'}], note: 'สุสานใต้ดิน ชั้น 3' },
  { id: 'ringor', name: 'Ringor', level: '95', map: 'สมรภูมิศักดิ์สิทธิ์', respawnType: 'fixed', scheduleText: 'Sat 16:00', fixedTimes: [{days: [6], time: '16:00'}], note: 'สมรภูมิศักดิ์สิทธิ์' },
  { id: 'chaiflock', name: 'Chaiflock', level: '120', map: 'ทุ่งหญ้าแดง', respawnType: 'fixed', scheduleText: 'Sun 14:00', fixedTimes: [{days: [0], time: '14:00'}], note: 'ทุ่งหญ้าแดง' },
  { id: 'benji', name: 'Benji', level: '120', map: 'ทุ่งหญ้าแดง', respawnType: 'fixed', scheduleText: 'Sun 20:00', fixedTimes: [{days: [0], time: '20:00'}], note: 'ทุ่งหญ้าแดง' },
  { id: 'tumier', name: 'Tumier', level: '140', map: 'ทางระบายน้ำ ชั้น 3', respawnType: 'fixed', scheduleText: 'Tue 20:55', fixedTimes: [{days: [2], time: '20:55'}], note: 'ทางระบายน้ำ ชั้น 3' },
  { id: 'nevaeh', name: 'Nevaeh', level: '140', map: 'KRANSIA', respawnType: 'fixed', scheduleText: 'Sun 21:00', fixedTimes: [{days: [0], time: '21:00'}], note: 'KRANSIA' },
  { id: 'icaruthia', name: 'Icaruthia', level: '135', map: 'KRANSIA', respawnType: 'fixed', scheduleText: 'Tue 20:00 / Fri 20:00', fixedTimes: [{days: [2], time: '20:00'}, {days: [5], time: '20:00'}], note: 'KRANSIA' },
  { id: 'motti', name: 'Motti', level: '135', map: 'KRANSIA', respawnType: 'fixed', scheduleText: 'Wed 18:00 / Sat 18:00', fixedTimes: [{days: [3], time: '18:00'}, {days: [6], time: '18:00'}], note: 'KRANSIA' },
  { id: 'libitina', name: 'Libitina', level: '130', map: 'โบสถ์แห่งบ่วงบัญชาชั่วนิรันดร์', respawnType: 'fixed', scheduleText: 'Tue 20:50 / Sat 20:30', fixedTimes: [{days: [2], time: '20:50'}, {days: [6], time: '20:30'}], note: 'โบสถ์แห่งบ่วงบัญชาชั่วนิรันดร์' },
  { id: 'rakajeth', name: 'Rakajeth', level: '130', map: 'อาญาแห่งเซเครต้า', respawnType: 'fixed', scheduleText: 'Tue 21:00 / Sun 20:05', fixedTimes: [{days: [2], time: '21:00'}, {days: [0], time: '20:05'}], note: 'อาญาแห่งเซเครต้า' },
  { id: 'bahel', name: 'Bahel', level: '140', map: 'รอยแยกแห่งการกัดกร่อน', respawnType: 'fixed', scheduleText: 'Fri 02:00', fixedTimes: [{days: [5], time: '02:00'}], note: 'รอยแยกแห่งการกัดกร่อน' },
  { id: 'lucus', name: 'Lucus', level: '145', map: 'เตาหลอมแห่งความเงียบงัน', respawnType: 'fixed', scheduleText: 'Sat 21:00', fixedTimes: [{days: [6], time: '21:00'}], note: 'เตาหลอมแห่งความเงียบงัน' },
  { id: 'camalia', name: 'Camalia', level: '135', map: 'ห้องทดลอง', respawnType: 'fixed', scheduleText: 'Fri 19:05', fixedTimes: [{days: [5], time: '19:05'}], note: 'ห้องทดลอง' },
  { id: 'guild_arena', name: 'Guild Arena', level: '00', map: 'Guild Base', respawnType: 'fixed', scheduleText: 'Fri/Sat/Sun 19:25', fixedTimes: [{days: [5,6,0], time: '19:25'}], note: 'Guild Base' },
  { id: 'reddevil_guild_boss', name: 'RedDevil Guild Boss', level: '00', map: 'Guild Base', respawnType: 'fixed', scheduleText: 'Sun 19:05', fixedTimes: [{days: [0], time: '19:05'}], note: 'Guild Base' }
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

// Module Switcher
function switchAppModule(moduleName) {
  activeAppModule = moduleName;
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

// Calculate Next Spawn Date
function calculateNextSpawnDate(boss, defeatedDateStr) {
  const now = new Date();
  const defDate = defeatedDateStr ? new Date(defeatedDateStr) : null;
  const defTimestamp = (defDate && !isNaN(defDate.getTime())) ? defDate.getTime() : 0;

  // 1. Interval bosses: คงสถานะ 'เกิดแล้ว' ค้างไว้จนกว่า Admin จะมากดลงเวลาตายจริง
  if (boss.respawnType === 'interval') {
    if (!defeatedDateStr || isNaN(defTimestamp) || defTimestamp === 0) return null; // Unrecorded -> Do NOT show countdown
    const nextSpawn = new Date(defTimestamp + (boss.intervalHours * 3600 * 1000));
    return nextSpawn;
  }

  // 2. Fixed schedule bosses: คำนวณเวลารอบถัดไปตามตารางเวลาเสมอ (ไม่ค้างสถานะ)
  if (boss.respawnType === 'fixed' && Array.isArray(boss.fixedTimes)) {
    let nearest = null;
    for (let offset = 0; offset <= 7; offset++) {
      const checkDate = new Date(now.getTime() + offset * 24 * 3600 * 1000);
      const dayOfWeek = checkDate.getDay(); // 0 = Sun, 1 = Mon ...

      for (const ft of boss.fixedTimes) {
        if (ft.days.includes(dayOfWeek)) {
          const [h, m] = ft.time.split(':').map(Number);
          const candidate = new Date(checkDate.getFullYear(), checkDate.getMonth(), checkDate.getDate(), h, m, 0, 0);
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

// Initialize Boss Data
function initBossTimerModule() {
  const savedConfigs = localStorage.getItem('guild_boss_custom_configs');
  bossCustomConfigs = savedConfigs ? JSON.parse(savedConfigs) : {};

  rebuildBossList();

  const savedTimers = localStorage.getItem('guild_boss_timers');
  bossTimerData = savedTimers ? JSON.parse(savedTimers) : {};

  const savedLogs = localStorage.getItem('guild_boss_drop_logs');
  bossDropLogs = savedLogs ? JSON.parse(savedLogs) : [];

  const savedKillLogs = localStorage.getItem('guild_boss_kill_logs');
  bossKillLogs = savedKillLogs ? JSON.parse(savedKillLogs) : [];

  bossSheetWebhookUrl = localStorage.getItem('guild_boss_sheet_webhook') || '';

  // Listen to Firebase Realtime Database
  if (typeof fbDb !== 'undefined' && fbDb) {
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
    checkAndSendDiscordSpawnAlerts();
  }, 1000);

  // Setup Paste Handler for instant OCR anywhere in Boss Tab
  window.addEventListener('paste', handleGlobalPasteForOCR);

  populate24HourSelects();
  renderBossTimerCards();
  updateUpcomingBossWidget();
}

// Render Boss Cards
function renderBossTimerCards() {
  const container = document.getElementById('boss-cards-grid');
  if (!container) return;

  const now = new Date();
  let aliveCount = 0;
  let soonCount = 0;

  const bossStatuses = bossList.map(boss => {
    const timer = bossTimerData[boss.id] || {};
    let nextSpawn = null;

    if (timer.customNextSpawn) {
      nextSpawn = new Date(timer.customNextSpawn);
    } else {
      nextSpawn = calculateNextSpawnDate(boss, timer.defeatedTime);
    }

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

    const isEn = (typeof window.currentLang !== 'undefined' && window.currentLang === 'en');
    const hrUnit = isEn ? ' hrs' : ' ชม.';
    return {
      ...boss,
      timer,
      nextSpawn,
      status,
      diffMs,
      respawnLabel: boss.respawnType === 'interval' ? (boss.intervalHours + hrUnit) : (boss.scheduleText || 'Fixed')
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

  const isAdminActive = (typeof isAdmin !== 'undefined' && isAdmin);

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
      nameColorClass = 'text-rose-400 font-black drop-shadow-[0_2px_8px_rgba(244,63,94,0.45)]';
      levelBadgeClass = 'bg-rose-950/90 text-rose-300 border-rose-500/60 shadow-rose-950/60';
      avatarRingClass = 'border-rose-500/60 ring-2 ring-rose-500/30 shadow-rose-950/60';
      cardBaseBorder = 'border-rose-500/40 hover:border-rose-400 shadow-rose-950/30';
      cardBaseBg = 'from-slate-900 via-slate-900/95 to-rose-950/30';
      typeBadge = `<span class="px-2.5 py-0.5 rounded-full text-[9.5px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/50 shadow-sm flex items-center gap-1 shrink-0"><i class="fa-solid fa-skull-crossbones text-[8px] text-rose-400"></i> ${tBoss('boss_tag_high', 'บอสระดับสูง (Lv.100+)')}</span>`;
    } else {
      nameColorClass = 'text-emerald-400 font-black drop-shadow-[0_2px_8px_rgba(52,211,153,0.35)]';
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

    if (b.status === 'alive') {
      statusBadge = `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-rose-600 text-white border border-rose-300 animate-pulse flex items-center gap-1 shadow-lg shadow-rose-600/50"><i class="fa-solid fa-circle text-[6px] text-rose-200"></i> ${tBoss('boss_status_spawned', 'เกิดแล้ว (ALIVE!)')}</span>`;
      cardBorder = 'border-rose-500 ring-2 ring-rose-500/50 shadow-2xl shadow-rose-950/80';
      cardBg = 'from-rose-950/60 via-slate-900 to-slate-950';
    } else if (b.status === 'soon') {
      statusBadge = `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-500/30 text-amber-300 border border-amber-400 animate-pulse flex items-center gap-1 shadow-md shadow-amber-950/60"><i class="fa-solid fa-clock text-[8px] text-amber-400"></i> ${tBoss('boss_status_soon', 'ใกล้เกิด (<30m)')}</span>`;
      cardBorder = 'border-amber-400/80 ring-2 ring-amber-400/40 shadow-xl shadow-amber-950/60';
      cardBg = 'from-amber-950/40 via-slate-900 to-slate-950';
    } else if (b.status === 'cooldown') {
      statusBadge = `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40 flex items-center gap-1"><i class="fa-solid fa-hourglass-half text-[8px] text-sky-400"></i> ${tBoss('boss_status_cooldown', 'รอเกิด')}</span>`;
    } else {
      statusBadge = `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-slate-800/90 text-slate-400 border border-slate-700">⚪ ${tBoss('boss_status_unrecorded', 'ยังไม่ลงเวลา')}</span>`;
      cardBorder = 'border-slate-800 hover:border-slate-700';
      cardBg = 'from-slate-900/90 to-slate-950/90';
    }

    const countdownText = formatCountdown(b.diffMs, b.status);
    const lastDefeatedStr = b.timer.defeatedTime ? formatDateTimeShort(new Date(b.timer.defeatedTime)) : '-';
    const nextSpawnStr = b.nextSpawn ? formatDateTimeShort(b.nextSpawn) : (b.respawnType === 'interval' ? tBoss('boss_wait_record', 'รอลงเวลาตาย') : '-');

    // Boss Profile Avatar Thumbnail
    const avatarHtml = b.avatar
      ? `<img src="${escapeHtml(b.avatar)}" alt="${escapeHtml(b.name)}" class="w-13 h-13 sm:w-14 sm:h-14 rounded-2xl object-cover border ${avatarRingClass} shadow-lg bg-slate-900 shrink-0" onerror="this.onerror=null; this.src=''; this.parentElement.innerHTML='<div class=\\'w-13 h-13 sm:w-14 sm:h-14 rounded-2xl bg-slate-800 border ${avatarRingClass} flex items-center justify-center text-xl text-amber-400\\'><i class=\\'fa-solid fa-dragon\\'></i></div>';" />`
      : `<div class="w-13 h-13 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 border ${avatarRingClass} flex items-center justify-center text-xl sm:text-2xl text-amber-400/90 shadow-inner shrink-0"><i class="fa-solid fa-dragon"></i></div>`;

    // Action Buttons: Admin gets Kill Confirm + Edit + Drop Log; Member gets View Drop Log only
    let actionButtonsHtml = '';
    if (isAdminActive) {
      actionButtonsHtml = `
        <div class="mt-3.5 pt-2.5 border-t border-slate-800/80 flex items-center gap-2">
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
          <button onclick="openBossDropLogModal('${b.id}')"
            class="w-full apple-btn apple-btn-slate inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold text-slate-300 hover:text-white"
            title="${tBoss('btn_drop_logs', 'ดูประวัติไอเทมดรอปของบอสตัวนี้')}">
            <i class="fa-solid fa-gift text-amber-400 text-xs"></i>
            <span>${tBoss('btn_drop_logs', 'ดูประวัติไอเทมดรอป')}</span>
          </button>
        </div>
      `;
    }

    html += `
      <div class="boss-card relative flex flex-col justify-between bg-gradient-to-b ${cardBg} border ${cardBorder} rounded-3xl p-4 shadow-xl backdrop-blur-md transition hover:scale-[1.015] duration-200">
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
                <span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg border shadow-inner ${levelBadgeClass}">Lv.${escapeHtml(b.level || '??')}</span>
              </div>
              <h4 class="text-base sm:text-lg tracking-tight leading-tight truncate ${nameColorClass}" title="${escapeHtml(b.name)}">
                ${escapeHtml(b.name)}
              </h4>
              <p class="text-[11px] text-slate-400 flex items-center gap-1 mt-1 font-medium">
                <i class="fa-solid fa-location-dot text-slate-500 text-[10px]"></i>
                <span class="truncate">${escapeHtml(b.map || (isEn ? 'Unassigned map' : 'ไม่ระบุแมพ'))}</span>
              </p>
            </div>
          </div>

          <!-- Countdown Big Box (High Contrast & Clear Typography) -->
          <div class="my-3 p-3 rounded-2xl bg-slate-950/90 border border-slate-800 shadow-inner text-center">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">${tBoss('boss_countdown_label', 'นับถอยหลัง')}</span>
            <div id="boss-cd-${b.id}" class="text-lg sm:text-xl font-black font-mono tracking-wider ${b.status === 'alive' ? 'text-rose-400 animate-pulse drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]' : b.status === 'soon' ? 'text-amber-300 animate-pulse drop-shadow-[0_0_8px_rgba(252,211,77,0.6)]' : b.status === 'cooldown' ? 'text-sky-300' : 'text-slate-500'}">
              ${countdownText}
            </div>
          </div>

          <!-- Metadata Grid (24-Hour Timestamps) -->
          <div class="grid grid-cols-2 gap-2 text-[11px] text-slate-300 pt-2.5 border-t border-slate-800/80">
            <div class="bg-slate-950/50 p-2 rounded-xl border border-slate-800/60">
              <span class="text-slate-500 block text-[9.5px] font-medium mb-0.5">${tBoss('boss_respawn_cycle_label', 'ระยะเกิด:')}</span>
              <span class="font-bold text-amber-300/95 font-mono">${escapeHtml(b.respawnLabel)}</span>
            </div>
            <div class="bg-slate-950/50 p-2 rounded-xl border border-slate-800/60">
              <span class="text-slate-500 block text-[9.5px] font-medium mb-0.5">${tBoss('boss_respawn_time_label', 'เกิดรอบถัดไป:')}</span>
              <span id="boss-next-${b.id}" class="font-mono font-bold ${b.nextSpawn ? 'text-emerald-300' : 'text-slate-500'}">${nextSpawnStr}</span>
            </div>
            <div class="col-span-2 text-slate-400 flex items-center justify-between text-[10.5px] pt-1 px-1">
              <span>${tBoss('boss_defeated_time_label', 'ตายล่าสุด:')} <strong class="font-mono text-slate-200">${lastDefeatedStr}</strong></span>
              ${b.note ? `<span class="text-amber-400/90 truncate max-w-[140px] font-medium" title="${escapeHtml(b.note)}">ℹ️ ${escapeHtml(b.note)}</span>` : ''}
            </div>
          </div>
        </div>

        <!-- Action Buttons (Role-based) -->
        ${actionButtonsHtml}
      </div>
    `;
  });

  container.innerHTML = html;
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
    return `SPAWNED (+${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')})`;
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
    return `${d}${dUnit}${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// Format DateTime Short (24-Hour Format: DD/MM HH:MM น.)
function formatDateTimeShort(d) {
  if (!d || isNaN(d.getTime())) return '-';
  const isEn = (typeof window.currentLang !== 'undefined' && window.currentLang === 'en');
  const pad = n => String(n).padStart(2, '0');
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const hours = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${day}/${month} ${hours}:${min}${isEn ? '' : ' น.'}`;
}

// Update Active Countdowns Every Second
function updateCountdowns() {
  if (activeAppModule !== 'boss_timer') return;
  const now = new Date();
  bossList.forEach(boss => {
    const cdEl = document.getElementById(`boss-cd-${boss.id}`);
    if (!cdEl) return;

    const timer = bossTimerData[boss.id] || {};
    let nextSpawn = timer.customNextSpawn ? new Date(timer.customNextSpawn) : calculateNextSpawnDate(boss, timer.defeatedTime);
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

    if (status === 'alive') {
      cdEl.className = "text-base sm:text-lg font-black font-mono tracking-wider text-rose-400 animate-pulse";
    } else if (status === 'soon') {
      cdEl.className = "text-base sm:text-lg font-black font-mono tracking-wider text-amber-300 animate-pulse";
    } else {
      cdEl.className = "text-base sm:text-lg font-black font-mono tracking-wider text-sky-300";
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

  const now = new Date();
  const recordedBosses = [];

  bossList.forEach(b => {
    const timer = bossTimerData[b.id] || {};
    let nextSpawn = null;
    if (timer.customNextSpawn) {
      nextSpawn = new Date(timer.customNextSpawn);
    } else {
      nextSpawn = calculateNextSpawnDate(b, timer.defeatedTime);
    }
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

// Record Boss Kill (Now)
function recordBossKillNow(bossId) {
  const boss = bossList.find(b => b.id === bossId);
  if (!boss) return;

  const now = new Date();
  saveBossKillTime(bossId, now.toISOString(), (typeof currentAdminEmail !== 'undefined' ? currentAdminEmail : 'Admin'));
  showToast(`บันทึกเวลาตายของ "${boss.name}" เรียบร้อยแล้ว!`, 'success');
  playChime();
}

// Send Boss Kill Log row to Google Sheets via Webhook (Background Async)
function sendKillLogToGoogleSheet(logData) {
  if (!bossSheetWebhookUrl) return;
  try {
    fetch(bossSheetWebhookUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(logData)
    }).catch(err => console.warn('Google Sheet Webhook send error:', err));
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
    fbDb.ref('guild_app/boss_timers').set(bossTimerData);
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

function openBossKillConfirmModal(bossId) {
  populate24HourSelects();
  currentKillConfirmBossId = bossId;
  const boss = bossList.find(b => b.id === bossId);
  if (!boss) return;

  const modal = document.getElementById('boss-kill-confirm-modal');
  const title = document.getElementById('kill-confirm-title');
  const desc = document.getElementById('kill-confirm-desc');
  const avatarBox = document.getElementById('kill-confirm-avatar-box');

  if (title) title.textContent = `ยืนยันลงเวลาตาย: ${boss.name}`;
  if (desc) desc.textContent = `เลเวล ${boss.level || '??'} • แมพ: ${boss.map || 'ไม่ระบุ'} • รอบเกิด: ${boss.respawnLabel || 'ตามเงื่อนไข'}`;

  if (avatarBox) {
    if (boss.avatar) {
      avatarBox.innerHTML = `<img src="${escapeHtml(boss.avatar)}" class="w-full h-full rounded-2xl object-cover" />`;
    } else {
      avatarBox.innerHTML = `<i class="fa-solid fa-skull"></i>`;
    }
  }

  // Reset image / drop items
  clearKillConfirmImage();
  applyQuickKillConfirmTime(0); // Default to current time

  if (modal) modal.classList.remove('hidden');
}

function closeBossKillConfirmModal() {
  const modal = document.getElementById('boss-kill-confirm-modal');
  if (modal) modal.classList.add('hidden');
  clearKillConfirmImage();
  currentKillConfirmBossId = null;
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
  const itemsText = document.getElementById('kill-confirm-items-text');

  if (emptyBox) emptyBox.classList.add('hidden');
  if (filledBox) filledBox.classList.remove('hidden');
  if (previewImg) previewImg.src = URL.createObjectURL(file);
  if (statusEl) {
    statusEl.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles fa-spin text-amber-400"></i> กำลังสแกนอ่านไอเทมดรอปจากภาพ...`;
  }

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

    // If time was detected from screenshot, auto adjust time if valid
    if (parsed.timeMatch) {
      const [hh, mm] = parsed.timeMatch.split(':');
      const hourSelect = document.getElementById('kill-confirm-hour');
      const minSelect = document.getElementById('kill-confirm-min');
      if (hourSelect) hourSelect.value = hh;
      if (minSelect) minSelect.value = mm;
    }
    if (parsed.dateMatch) {
      const dateInput = document.getElementById('kill-confirm-date');
      if (dateInput) dateInput.value = parsed.dateMatch;
    }

    if (itemsBox) itemsBox.classList.remove('hidden');
    if (itemsText) {
      if (parsed.items.length > 0) {
        itemsText.value = parsed.items.join('\n');
        if (statusEl) statusEl.innerHTML = `<span class="text-emerald-400 font-bold"><i class="fa-solid fa-check-circle"></i> ตรวจพบไอเทม ${parsed.items.length} รายการ (ตรวจสอบหรือแก้ไขได้ด้านล่าง)</span>`;
      } else {
        itemsText.value = text.split('\n').filter(l => l.trim().length > 3).slice(0, 4).join('\n');
        if (statusEl) statusEl.innerHTML = `<span class="text-amber-300"><i class="fa-solid fa-circle-info"></i> อ่านข้อความเสร็จสิ้น สามารถพิมพ์/แก้ไขไอเทมดรอปได้</span>`;
      }
    }
  } catch (err) {
    console.warn('Kill Confirm OCR Error:', err);
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-amber-400 text-xs">อ่านภาพไม่สำเร็จ แต่ยังสามารถบันทึกเวลาได้ตามปกติ</span>`;
    }
    if (itemsBox) itemsBox.classList.remove('hidden');
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

function handleSaveKillConfirm(e) {
  if (e) e.preventDefault();
  if (!currentKillConfirmBossId) return;

  const boss = bossList.find(b => b.id === currentKillConfirmBossId);
  const bossName = boss ? boss.name : currentKillConfirmBossId;

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

  // 2. Save Boss Kill Time & Create History Log (Firebase + Google Sheets)
  saveBossKillTime(currentKillConfirmBossId, dt.toISOString(), killerEmail, itemsList);

  // 3. Save Drop Log if items provided
  if (itemsList.length > 0) {
    const dropEntry = {
      id: 'drop_' + Date.now(),
      bossId: currentKillConfirmBossId,
      bossName: bossName,
      killTime: dt.toISOString(),
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

  closeBossKillConfirmModal();
  showToast(`💀 บันทึกเวลาตายของ "${bossName}" (${formatDateTimeShort(dt)}) เรียบร้อยแล้ว!`, 'success');
  playChime();
}

// Global Paste Handler: Supports Ctrl+V across the boss tab & inside modal
function handleGlobalPasteForOCR(e) {
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

      // Case 2: AI OCR Modal is open or user is viewing the boss timer tab
      const bossModule = document.getElementById('module-boss-timer');
      const isBossTabActive = bossModule && !bossModule.classList.contains('hidden');
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
    if (editDefDateInput) editDefDateInput.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (editDefHourSelect) editDefHourSelect.value = pad(d.getHours());
    if (editDefMinSelect) editDefMinSelect.value = pad(d.getMinutes());
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
    const dt = new Date(`${editDefDateVal}T${editDefHourVal}:${editDefMinVal}:00`);
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

// AI OCR Image Handler
function handleGlobalPasteForOCR(event) {
  if (activeAppModule !== 'boss_timer') return;
  const items = (event.clipboardData || event.originalEvent.clipboardData).items;
  for (const item of items) {
    if (item.type.indexOf('image') !== -1) {
      const file = item.getAsFile();
      processImageForBossOCR(file);
      break;
    }
  }
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

// Process Image with Google Gemini 1.5 Flash Vision API (99.9% Accuracy for Thai & Game Logs)
async function processImageWithGeminiVision(file, apiKey) {
  const statusEl = document.getElementById('ocr-progress-status');

  if (statusEl) {
    statusEl.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles fa-spin text-purple-400"></i> กำลังส่งภาพให้ Google Gemini AI สแกนภาษาไทยและสีไอเทม (แม่นยำ 99.9%)...`;
    statusEl.classList.remove('hidden');
  }

  const base64DataUrl = await fileToBase64(file);
  const base64Str = base64DataUrl.split(',')[1];
  const mimeType = file.type || 'image/png';

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
          // Priority: flash 1.5/2.0 > any flash > pro 1.5/2.0 > any pro > first available
          const preferred = 
            available.find(m => /gemini-1\.5-flash/i.test(m)) ||
            available.find(m => /gemini-2\.0-flash/i.test(m)) ||
            available.find(m => /flash/i.test(m)) ||
            available.find(m => /gemini-1\.5-pro/i.test(m)) ||
            available.find(m => /pro/i.test(m)) ||
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

  // Fallback defaults if ListModels is restricted
  return { apiVer: 'v1beta', model: 'gemini-1.5-flash-latest' };
}

// Universal Gemini Vision Caller with Model Discovery & Auto-Fallback
async function callGeminiVisionApiWithFallback(prompt, base64Str, mimeType, apiKey) {
  // 1. First attempt: Use Dynamically Discovered Model
  const discovered = await discoverActiveGeminiModel(apiKey);
  
  const candidateList = [
    { apiVer: discovered.apiVer, model: discovered.model },
    { apiVer: 'v1beta', model: 'gemini-1.5-flash-latest' },
    { apiVer: 'v1beta', model: 'gemini-1.5-flash' },
    { apiVer: 'v1beta', model: 'gemini-1.5-flash-001' },
    { apiVer: 'v1beta', model: 'gemini-1.5-flash-002' },
    { apiVer: 'v1beta', model: 'gemini-2.0-flash' },
    { apiVer: 'v1beta', model: 'gemini-2.0-flash-exp' },
    { apiVer: 'v1beta', model: 'gemini-1.5-pro-latest' },
    { apiVer: 'v1beta', model: 'gemini-1.5-pro' },
    { apiVer: 'v1', model: 'gemini-1.5-flash' },
    { apiVer: 'v1', model: 'gemini-1.5-pro' },
    { apiVer: 'v1beta', model: 'gemini-pro-vision' }
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

      const cleanJsonStr = textOutput.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
      return JSON.parse(cleanJsonStr);
    } catch (err) {
      console.warn(`Failed with ${key}:`, err);
      lastError = err;
    }
  }

  throw lastError || new Error('All Gemini models failed. Please check your API key.');
}

// Populate Modal Fields from Gemini AI Result
function populateModalFromGeminiData(data) {
  const statusEl = document.getElementById('ocr-progress-status');
  const resultBox = document.getElementById('ocr-result-form');
  populate24HourSelects();

  const bossSelect = document.getElementById('ocr-boss-select');
  const dateInput = document.getElementById('ocr-kill-date');
  const hourSelect = document.getElementById('ocr-kill-hour');
  const minSelect = document.getElementById('ocr-kill-min');
  const itemsText = document.getElementById('ocr-drop-items');

  if (statusEl) statusEl.classList.add('hidden');
  if (resultBox) resultBox.classList.remove('hidden');

  if (bossSelect) {
    bossSelect.innerHTML = bossList.map(b => `<option value="${b.id}">${escapeHtml(b.name)} (Lv.${b.level} - ${escapeHtml(b.map)})</option>`).join('');
    let matched = null;
    if (data.bossId) matched = bossList.find(b => b.id === data.bossId);
    if (!matched && data.bossName) {
      const bn = data.bossName.toLowerCase();
      matched = bossList.find(b => b.name.toLowerCase().includes(bn) || bn.includes(b.name.toLowerCase()) || (b.map && b.map.toLowerCase().includes(bn)));
    }
    if (matched) bossSelect.value = matched.id;
  }

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  if (dateInput) {
    dateInput.value = data.killDate || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  if (data.killTime && data.killTime.includes(':')) {
    const [hh, mm] = data.killTime.split(':');
    if (hourSelect) hourSelect.value = pad(Number(hh));
    if (minSelect) minSelect.value = pad(Number(mm));
  } else {
    if (hourSelect) hourSelect.value = pad(now.getHours());
    if (minSelect) minSelect.value = pad(now.getMinutes());
  }

  if (itemsText) {
    if (Array.isArray(data.dropItems) && data.dropItems.length > 0) {
      itemsText.value = data.dropItems.join('\n');
    } else {
      itemsText.value = '';
    }
  }
}

// Process Image with AI OCR (Gemini Vision 1st Priority, Tesseract.js Fallback)
async function processImageForBossOCR(file) {
  if (!file) return;

  const modal = document.getElementById('boss-ai-ocr-modal');
  const statusEl = document.getElementById('ocr-progress-status');
  const previewImg = document.getElementById('ocr-image-preview');
  const resultBox = document.getElementById('ocr-result-form');

  if (previewImg) {
    previewImg.src = URL.createObjectURL(file);
    previewImg.classList.remove('hidden');
  }
  if (resultBox) resultBox.classList.add('hidden');
  if (modal) modal.classList.remove('hidden');

  // Option A: Use Google Gemini 1.5 Flash Vision (99.9% Accuracy) if API Key configured
  if (bossGeminiApiKey) {
    try {
      await processImageWithGeminiVision(file, bossGeminiApiKey);
      return;
    } catch (geminiErr) {
      console.warn('Gemini Vision OCR failed, falling back to local OCR:', geminiErr);
    }
  }

  // Option B: Fallback to Canvas Pre-processing + Tesseract.js
  try {
    if (statusEl) {
      statusEl.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles fa-spin text-amber-400"></i> กำลังปรับความคมชัดของภาพ (Canvas Multi-color Pre-processing)...`;
      statusEl.classList.remove('hidden');
    }

    const processedBlob = await preprocessImageCanvas(file);

    if (typeof Tesseract === 'undefined') {
      if (statusEl) statusEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> กำลังโหลดโมเดลภาษาไทย...`;
      await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
    }

    if (statusEl) statusEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-amber-400"></i> กำลังสแกนอ่านข้อความภาษาไทย...`;

    const { data: { text } } = await Tesseract.recognize(processedBlob, 'tha+eng', {
      logger: m => {
        if (statusEl && m.status === 'recognizing text') {
          statusEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-amber-400"></i> กำลังอ่านข้อความ (${Math.round(m.progress * 100)}%)...`;
        }
      }
    });

    console.log('OCR Raw Text:\n', text);
    parseOCRTextAndPopulateModal(text);
  } catch (err) {
    console.error('OCR Error:', err);
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-rose-400"><i class="fa-solid fa-triangle-exclamation"></i> ไม่สามารถอ่านรูปภาพได้ กรุณาระบุข้อมูลเอง</span>`;
    }
    if (resultBox) resultBox.classList.remove('hidden');
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

// Parse OCR Text
function parseOCRTextAndPopulateModal(rawText) {
  const statusEl = document.getElementById('ocr-progress-status');
  const resultBox = document.getElementById('ocr-result-form');
  populate24HourSelects();
  const bossSelect = document.getElementById('ocr-boss-select');
  const dateInput = document.getElementById('ocr-kill-date');
  const hourSelect = document.getElementById('ocr-kill-hour');
  const minSelect = document.getElementById('ocr-kill-min');
  const itemsText = document.getElementById('ocr-drop-items');

  if (statusEl) statusEl.classList.add('hidden');
  if (resultBox) resultBox.classList.remove('hidden');

  // Populate Boss Select
  if (bossSelect) {
    bossSelect.innerHTML = bossList.map(b => `<option value="${b.id}">${escapeHtml(b.name)} (Lv.${b.level} - ${escapeHtml(b.map)})</option>`).join('');
  }

  const parsed = normalizeAndCleanThaiDropLog(rawText);

  // 1. Set Boss
  if (parsed.bossMatch && bossSelect) {
    bossSelect.value = parsed.bossMatch.id;
  }

  // 2. Set Date & Time
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  if (dateInput) {
    dateInput.value = parsed.dateMatch || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
  if (parsed.timeMatch) {
    const [hh, mm] = parsed.timeMatch.split(':');
    if (hourSelect) hourSelect.value = hh;
    if (minSelect) minSelect.value = mm;
  } else {
    if (hourSelect) hourSelect.value = pad(now.getHours());
    if (minSelect) minSelect.value = pad(now.getMinutes());
  }

  // 3. Set Clean Items
  if (itemsText) {
    if (parsed.items.length > 0) {
      itemsText.value = parsed.items.join('\n');
    } else {
      // Fallback
      itemsText.value = rawText.split('\n').filter(l => l.trim().length > 3).slice(0, 5).join('\n');
    }
  }
}

function handleConfirmOcrSave(e) {
  if (e) e.preventDefault();
  const bossId = document.getElementById('ocr-boss-select').value;
  const dateVal = document.getElementById('ocr-kill-date').value;
  const hourVal = document.getElementById('ocr-kill-hour').value;
  const minVal = document.getElementById('ocr-kill-min').value;
  const itemsVal = document.getElementById('ocr-drop-items').value.trim();

  if (!bossId || !dateVal || hourVal === '' || minVal === '') return;

  const dt = new Date(`${dateVal}T${hourVal}:${minVal}:00`);
  if (isNaN(dt.getTime())) {
    alert('วันที่หรือเวลาไม่ถูกต้อง');
    return;
  }

  const boss = bossList.find(b => b.id === bossId);
  const adminEmail = typeof currentAdminEmail !== 'undefined' ? currentAdminEmail : 'Admin';
  const itemsList = itemsVal ? itemsVal.split('\n').map(i => i.trim()).filter(i => i.length > 0) : [];

  // 1. Save Boss Kill Time & Create History Log (Firebase + Google Sheets)
  saveBossKillTime(bossId, dt.toISOString(), adminEmail, itemsList);

  // 2. Save Drop Log
  if (itemsList.length > 0) {
    const dropEntry = {
      id: 'drop_' + Date.now(),
      bossId,
      bossName: boss ? boss.name : bossId,
      killTime: dt.toISOString(),
      items: itemsList,
      recordedBy: adminEmail,
      timestamp: new Date().toISOString()
    };

    bossDropLogs.unshift(dropEntry);
    localStorage.setItem('guild_boss_drop_logs', JSON.stringify(bossDropLogs));
    if (typeof fbDb !== 'undefined' && fbDb) {
      fbDb.ref('guild_app/boss_drop_logs').set(bossDropLogs);
    }
  }

  closeBossAiOcrModal();
  showToast(`📸 บันทึกเวลาและไอเทมดรอปของ "${boss ? boss.name : bossId}" สำเร็จ!`, 'success');
}

function closeBossAiOcrModal() {
  const modal = document.getElementById('boss-ai-ocr-modal');
  if (modal) modal.classList.add('hidden');
}

// ================= 📜 Boss Kill History & Google Sheets Webhook Functions =================

function updateWebhookStatusUi() {
  const statusLabel = document.getElementById('history-webhook-status-label');
  if (statusLabel) {
    if (bossSheetWebhookUrl) {
      statusLabel.innerHTML = `<span class="text-emerald-400 font-bold"><i class="fa-solid fa-circle-check"></i> Google Sheets: เชื่อมต่อแล้ว</span>`;
    } else {
      statusLabel.innerHTML = `<span class="text-amber-400 font-bold"><i class="fa-solid fa-circle-exclamation"></i> Google Sheets: ยังไม่ตั้งค่า</span>`;
    }
  }
}

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
  if (confirm('คุณแน่ใจหรือไม่ว่าต้องการล้างประวัติการลงเวลาบอสทั้งหมด? (การกระทำนี้ไม่สามารถย้อนกลับได้)')) {
    bossKillLogs = [];
    localStorage.setItem('guild_boss_kill_logs', JSON.stringify([]));
    if (typeof fbDb !== 'undefined' && fbDb) {
      fbDb.ref('guild_app/boss_kill_logs').set([]);
    }
    renderBossKillHistoryList();
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
  if (modal) modal.classList.remove('hidden');
}

function closeSheetWebhookSettingsModal() {
  const modal = document.getElementById('boss-sheet-config-modal');
  if (modal) modal.classList.add('hidden');
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

// Check & Send Realtime Discord Spawn Alerts (5-Min Soon Warning & Spawned Alert)
async function checkAndSendDiscordSpawnAlerts() {
  if (!bossDiscordWebhookUrl) return;

  const now = new Date();

  for (const boss of bossList) {
    const timer = bossTimerData[boss.id] || {};
    let nextSpawn = timer.customNextSpawn ? new Date(timer.customNextSpawn) : calculateNextSpawnDate(boss, timer.defeatedTime);

    if (!nextSpawn || isNaN(nextSpawn.getTime())) continue;

    const diffMs = nextSpawn.getTime() - now.getTime();
    const spawnUnix = Math.floor(nextSpawn.getTime() / 1000);
    const pad = n => String(n).padStart(2, '0');
    const timeHHmm = `${pad(nextSpawn.getHours())}:${pad(nextSpawn.getMinutes())} น.`;
    const bossDisplayName = `Lv.${boss.level || '??'}, ${boss.name}`;

    // 🟡 1. แจ้งเตือนก่อนเกิด 5 นาที (เหลือ 0 ถึง 5 นาที)
    if (diffMs > 0 && diffMs <= 5 * 60 * 1000) {
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
          description: `# 🕖 ${timeHHmm}\n\n> ▎ 🗺️ **แผนที่**: \`${boss.map || '-'}\`\n> ▎ ⏳ **เตรียมตัว!** อีก 5 นาทีบอสจะเกิด (<t:${spawnUnix}:R>)`,
          footer: { text: '🛡️ LORD NINE SYSTEM • Dashboard RedDevil' },
          timestamp: nextSpawn.toISOString()
        };
        if (boss.avatar) {
          embed5m.thumbnail = { url: boss.avatar };
        }

        sendDiscordWebhookPayload({ content: '<@&1508495658162851970>', embeds: [embed5m] });
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
          description: `# 🕖 ${timeHHmm}\n\n> ▎ 🗺️ **แผนที่**: \`${boss.map || '-'}\`\n> ▎ 🚨 **บอสเกิดแล้ว!** ออกล่าได้ทันที`,
          footer: { text: '🛡️ LORD NINE SYSTEM • Dashboard RedDevil' },
          timestamp: now.toISOString()
        };
        if (boss.avatar) {
          embedSpawned.thumbnail = { url: boss.avatar };
        }

        sendDiscordWebhookPayload({ content: '<@&1508495658162851970>', embeds: [embedSpawned] });
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
function openBossDropLogModal(bossId) {
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
      list.innerHTML = logs.map(l => `
        <div class="p-3 bg-slate-900/90 border border-slate-800 rounded-2xl space-y-2 shadow-sm">
          <div class="flex items-center justify-between text-xs pb-1.5 border-b border-slate-800/80">
            <div class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-amber-400"></span>
              <span class="font-bold text-amber-300 text-sm">${escapeHtml(l.bossName)}</span>
            </div>
            <span class="font-mono text-[11px] text-slate-400 px-2 py-0.5 rounded-full bg-slate-950 border border-slate-800">
              <i class="fa-regular fa-clock text-[9px] mr-1"></i>${formatDateTimeShort(new Date(l.killTime))}
            </span>
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
window.processImageForBossOCR = processImageForBossOCR;
window.toggleBossSound = toggleBossSound;
window.renderBossTimerCards = renderBossTimerCards;
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

