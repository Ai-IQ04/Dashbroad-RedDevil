/**
 * Boss Timer & AI OCR Module for Guild Dashboard
 * Completely decoupled from guild scoring logic.
 */

// Global state for Boss Timer
let bossList = [];
let bossTimerData = {}; // { [bossId]: { defeatedTime: ISOString, defeatedBy: string, nextSpawnTime: ISOString } }
let bossDropLogs = [];  // [ { id, bossId, bossName, killTime, items: [], recordedBy, timestamp } ]
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
  const bossContainer = document.getElementById('boss-timer-module-container');
  const tabScoring = document.getElementById('nav-tab-scoring');
  const tabBoss = document.getElementById('nav-tab-boss-timer');

  if (moduleName === 'boss_timer') {
    if (scoringContainer) scoringContainer.classList.add('hidden');
    if (bossContainer) bossContainer.classList.remove('hidden');

    if (tabScoring) {
      tabScoring.className = "apple-btn px-3 py-1.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-800/80 transition flex items-center gap-1.5";
    }
    if (tabBoss) {
      tabBoss.className = "apple-btn px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 shadow-md";
    }
    renderBossTimerCards();
  } else {
    if (scoringContainer) scoringContainer.classList.remove('hidden');
    if (bossContainer) bossContainer.classList.add('hidden');

    if (tabScoring) {
      tabScoring.className = "apple-btn px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 shadow-md";
    }
    if (tabBoss) {
      tabBoss.className = "apple-btn px-3 py-1.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-800/80 transition flex items-center gap-1.5";
    }
  }
}

// Calculate Next Spawn Date
function calculateNextSpawnDate(boss, defeatedDateStr) {
  const now = new Date();

  // 1. Interval bosses require recorded defeat time
  if (boss.respawnType === 'interval') {
    if (!defeatedDateStr) return null; // Unrecorded -> Do NOT show countdown
    const defDate = new Date(defeatedDateStr);
    if (isNaN(defDate.getTime())) return null;
    const nextSpawn = new Date(defDate.getTime() + (boss.intervalHours * 3600 * 1000));
    return nextSpawn;
  }

  // 2. Fixed schedule bosses calculate next upcoming spawn automatically
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
  bossList = DEFAULT_BOSS_DATABASE;

  const savedTimers = localStorage.getItem('guild_boss_timers');
  bossTimerData = savedTimers ? JSON.parse(savedTimers) : {};

  const savedLogs = localStorage.getItem('guild_boss_drop_logs');
  bossDropLogs = savedLogs ? JSON.parse(savedLogs) : [];

  // Listen to Firebase Realtime Database
  if (typeof fbDb !== 'undefined' && fbDb) {
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
  }

  // Live Timer Interval (every 1 second)
  if (bossTimerInterval) clearInterval(bossTimerInterval);
  bossTimerInterval = setInterval(() => {
    updateCountdowns();
    updateUpcomingBossWidget();
  }, 1000);

  // Setup Paste Handler for instant OCR anywhere in Boss Tab
  window.addEventListener('paste', handleGlobalPasteForOCR);

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

    return {
      ...boss,
      timer,
      nextSpawn,
      status,
      diffMs,
      respawnLabel: boss.respawnType === 'interval' ? (boss.intervalHours + ' ชม.') : (boss.scheduleText || 'Fixed')
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
    container.innerHTML = `
      <div class="col-span-full py-12 text-center text-slate-500">
        <i class="fa-solid fa-dragon text-4xl mb-2 text-slate-700"></i>
        <p class="text-xs">ไม่พบบอสที่ตรงกับเงื่อนไขการค้นหา</p>
      </div>
    `;
    return;
  }

  let html = '';
  // Set of Guild Activity / Scoring Bosses
  const GUILD_SCORING_BOSS_IDS = new Set([
    'lucus', 'bahel', 'libitina', 'rakajeth', 'tumier', 'nevaeh', 'icaruthia', 'motti', 'guild_arena', 'camalia', 'world_boss'
  ]);

  filtered.forEach(b => {
    const isGuildActivity = GUILD_SCORING_BOSS_IDS.has(b.id) || (b.name && /lucus|bahel|libitina|rakajeth|tumier|neva|icarut|morti|motti|arena|camalia|world/i.test(b.name));
    
    // Boss Name Color & Size
    const nameColorClass = isGuildActivity ? 'text-amber-400' : 'text-rose-500';
    const typeBadge = isGuildActivity 
      ? `<span class="px-2 py-0.5 rounded-full text-[9px] font-black bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm flex items-center gap-1"><i class="fa-solid fa-star text-[7.5px] text-amber-400"></i> กิจกรรมกิลด์</span>`
      : `<span class="px-2 py-0.5 rounded-full text-[9px] font-medium bg-slate-800/80 text-slate-400 border border-slate-700/60">บอสทั่วไป</span>`;

    let statusBadge = '';
    let cardBorder = isGuildActivity ? 'border-amber-500/40' : 'border-slate-800/80';
    let cardBg = isGuildActivity ? 'from-amber-950/20 via-slate-900/95 to-slate-950/95' : 'from-slate-900/90 to-slate-950/90';

    if (b.status === 'alive') {
      statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-500/25 text-rose-300 border border-rose-500/50 animate-pulse flex items-center gap-1 shadow-md shadow-rose-950/40"><i class="fa-solid fa-circle text-[6px] text-rose-400"></i> เกิดแล้ว (ALIVE!)</span>`;
      cardBorder = 'border-rose-500/60 shadow-rose-950/50';
      cardBg = 'from-rose-950/40 via-slate-900/90 to-slate-950/90';
    } else if (b.status === 'soon') {
      statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500/25 text-amber-300 border border-amber-500/50 animate-pulse flex items-center gap-1 shadow-md shadow-amber-950/40"><i class="fa-solid fa-clock text-[8px] text-amber-400"></i> ใกล้เกิด (&lt;30m)</span>`;
      cardBorder = 'border-amber-500/60 shadow-amber-950/50';
      cardBg = 'from-amber-950/30 via-slate-900/90 to-slate-950/90';
    } else if (b.status === 'cooldown') {
      statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/20 text-sky-300 border border-sky-500/30 flex items-center gap-1"><i class="fa-solid fa-hourglass-half text-[8px] text-sky-400"></i> รอเกิด</span>`;
    } else {
      statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-800/90 text-slate-400 border border-slate-700">⚪ ยังไม่ลงเวลา</span>`;
    }

    const countdownText = formatCountdown(b.diffMs, b.status);
    const lastDefeatedStr = b.timer.defeatedTime ? formatDateTimeShort(new Date(b.timer.defeatedTime)) : '-';
    const nextSpawnStr = b.nextSpawn ? formatDateTimeShort(b.nextSpawn) : (b.respawnType === 'interval' ? 'รอลงเวลาตาย' : '-');

    html += `
      <div class="boss-card relative flex flex-col justify-between bg-gradient-to-b ${cardBg} border ${cardBorder} rounded-2xl p-4 shadow-xl backdrop-blur transition hover:scale-[1.01] hover:border-amber-400/60 duration-200">
        <div>
          <!-- Header Row: Level & Type Badge -->
          <div class="flex items-center justify-between gap-2 mb-1.5">
            <span class="text-[10.5px] font-mono font-bold px-2 py-0.5 rounded-lg bg-slate-900 text-amber-400 border border-slate-700/80 shadow-inner">Lv.${b.level || '??'}</span>
            <div class="flex items-center gap-1.5">
              ${typeBadge}
              <div id="boss-status-badge-${b.id}">${statusBadge}</div>
            </div>
          </div>

          <!-- Boss Name (Large, Bold & Color Coded) -->
          <div class="mb-2">
            <h4 class="text-base sm:text-lg font-black tracking-tight leading-snug ${nameColorClass}">
              ${escapeHtml(b.name)}
            </h4>
            <p class="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
              <i class="fa-solid fa-location-dot text-slate-500 text-[10px]"></i>
              <span class="truncate">${escapeHtml(b.map || 'ไม่ระบุแมพ')}</span>
            </p>
          </div>

          <!-- Countdown Big Box -->
          <div class="my-2.5 p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/90 text-center shadow-inner">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">นับถอยหลัง</span>
            <div id="boss-cd-${b.id}" class="text-lg sm:text-xl font-black font-mono tracking-wider ${b.status === 'alive' ? 'text-rose-400 animate-pulse' : b.status === 'soon' ? 'text-amber-300 animate-pulse' : b.status === 'cooldown' ? 'text-sky-300' : 'text-slate-500'}">
              ${countdownText}
            </div>
          </div>

          <!-- Metadata Grid -->
          <div class="grid grid-cols-2 gap-2 text-[11px] text-slate-300 pt-2 border-t border-slate-800/80">
            <div>
              <span class="text-slate-500 block text-[9.5px] font-medium">ระยะเกิด:</span>
              <span class="font-semibold text-amber-300/90">${escapeHtml(b.respawnLabel)}</span>
            </div>
            <div>
              <span class="text-slate-500 block text-[9.5px] font-medium">เกิดรอบถัดไป:</span>
              <span id="boss-next-${b.id}" class="font-mono font-bold ${b.nextSpawn ? 'text-emerald-300' : 'text-slate-500'}">${nextSpawnStr}</span>
            </div>
            <div class="col-span-2 text-slate-400 flex items-center justify-between text-[10.5px] pt-1">
              <span>ตายล่าสุด: <strong class="font-mono text-slate-300">${lastDefeatedStr}</strong></span>
              ${b.note ? `<span class="text-amber-400/80 truncate max-w-[130px]" title="${escapeHtml(b.note)}">ℹ️ ${escapeHtml(b.note)}</span>` : ''}
            </div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="mt-3.5 pt-2.5 border-t border-slate-800/80 flex items-center gap-1.5">
          <button onclick="recordBossKillNow('${b.id}')"
            class="flex-1 apple-btn apple-btn-ruby inline-flex items-center justify-center gap-1.5 py-2 px-2.5 text-xs font-bold shadow-md shadow-rose-950/30"
            title="กดเมื่อบอสตายตอนนี้ทันที">
            <i class="fa-solid fa-skull text-[11px]"></i>
            <span>ตายตอนนี้</span>
          </button>
          <button onclick="openCustomKillModal('${b.id}')"
            class="apple-btn apple-btn-slate inline-flex items-center justify-center p-2 text-xs font-semibold"
            title="ระบุเวลาตายย้อนหลัง">
            <i class="fa-solid fa-clock-rotate-left"></i>
          </button>
          <button onclick="openBossDropLogModal('${b.id}')"
            class="apple-btn apple-btn-amber inline-flex items-center justify-center p-2 text-xs font-semibold"
            title="ดู / บันทึกประวัติของดรอป">
            <i class="fa-solid fa-gift"></i>
          </button>
        </div>
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

  if (d > 0) {
    return `${d}ว ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// Format DateTime Short
function formatDateTimeShort(d) {
  if (!d || isNaN(d.getTime())) return '-';
  const pad = n => String(n).padStart(2, '0');
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const hours = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${day}/${month} ${hours}:${min}`;
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

// Update Upcoming Boss in Main Header
function updateUpcomingBossWidget() {
  const widget = document.getElementById('upcoming-boss-text');
  if (!widget) return;

  const now = new Date();
  const recordedBosses = [];

  bossList.forEach(b => {
    const timer = bossTimerData[b.id] || {};
    const nextSpawn = timer.customNextSpawn ? new Date(timer.customNextSpawn) : calculateNextSpawnDate(b, timer.defeatedTime);
    if (nextSpawn && !isNaN(nextSpawn.getTime())) {
      const diffMs = nextSpawn.getTime() - now.getTime();
      recordedBosses.push({ boss: b, nextSpawn, diffMs });
    }
  });

  if (recordedBosses.length === 0) {
    widget.innerHTML = `<span class="text-slate-400">⏱️ บอสไทม์เมอร์ (พร้อมใช้งาน)</span>`;
    return;
  }

  // Find nearest
  recordedBosses.sort((a, b) => a.diffMs - b.diffMs);
  const nearest = recordedBosses[0];

  if (nearest.diffMs <= 0) {
    widget.innerHTML = `<span class="text-rose-400 font-bold animate-pulse">🔴 ${escapeHtml(nearest.boss.name)} เกิดแล้ว!</span>`;
  } else if (nearest.diffMs <= 30 * 60 * 1000) {
    widget.innerHTML = `<span class="text-amber-300 font-bold animate-pulse">🟡 ${escapeHtml(nearest.boss.name)} ใน ${formatCountdown(nearest.diffMs, 'soon')}</span>`;
  } else {
    widget.innerHTML = `<span class="text-slate-300">⏳ บอสถัดไป: <strong>${escapeHtml(nearest.boss.name)}</strong> (${formatCountdown(nearest.diffMs, 'cooldown')})</span>`;
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

// Save Boss Kill Time
function saveBossKillTime(bossId, killTimeISO, killerEmail) {
  const boss = bossList.find(b => b.id === bossId);
  if (!boss) return;

  const defDate = new Date(killTimeISO);
  let nextSpawn = null;
  if (boss.respawnType === 'interval') {
    nextSpawn = new Date(defDate.getTime() + (boss.intervalHours * 3600 * 1000));
  } else {
    nextSpawn = calculateNextSpawnDate(boss, killTimeISO);
  }

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

  if (typeof addAuditLog === 'function') {
    addAuditLog('boss_kill', `ลงเวลาตายบอส "${boss.name}"`, `เวลา: ${formatDateTimeShort(defDate)} โดย: ${killerEmail}`, 'BossTimer');
  }

  renderBossTimerCards();
  updateUpcomingBossWidget();
}

// Custom Kill Time Modal
let currentEditBossId = null;
function openCustomKillModal(bossId) {
  currentEditBossId = bossId;
  const boss = bossList.find(b => b.id === bossId);
  if (!boss) return;

  const modal = document.getElementById('boss-custom-kill-modal');
  const title = document.getElementById('boss-custom-kill-title');
  const dateInput = document.getElementById('boss-custom-kill-date');
  const timeInput = document.getElementById('boss-custom-kill-time');

  if (title) title.textContent = `ระบุเวลาตาย: ${boss.name} (${boss.map})`;

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  if (dateInput) dateInput.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (timeInput) timeInput.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  if (modal) modal.classList.remove('hidden');
}

function closeCustomKillModal() {
  const modal = document.getElementById('boss-custom-kill-modal');
  if (modal) modal.classList.add('hidden');
}

function handleSaveCustomKill(e) {
  if (e) e.preventDefault();
  if (!currentEditBossId) return;

  const dateVal = document.getElementById('boss-custom-kill-date').value;
  const timeVal = document.getElementById('boss-custom-kill-time').value;
  if (!dateVal || !timeVal) return;

  const dt = new Date(`${dateVal}T${timeVal}:00`);
  if (isNaN(dt.getTime())) {
    alert('รูปแบบวันที่หรือเวลาไม่ถูกต้อง');
    return;
  }

  saveBossKillTime(currentEditBossId, dt.toISOString(), (typeof currentAdminEmail !== 'undefined' ? currentAdminEmail : 'Admin'));
  closeCustomKillModal();
  showToast(`บันทึกเวลาตายย้อนหลังเรียบร้อยแล้ว`, 'success');
}

// ================= Server Maintenance Reset Modal =================
function openMaintenanceModal() {
  const modal = document.getElementById('boss-maintenance-modal');
  const dateInput = document.getElementById('maint-reset-date');
  const timeInput = document.getElementById('maint-reset-time');

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  if (dateInput) dateInput.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (timeInput) timeInput.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  if (modal) modal.classList.remove('hidden');
}

function closeMaintenanceModal() {
  const modal = document.getElementById('boss-maintenance-modal');
  if (modal) modal.classList.add('hidden');
}

function handleConfirmMaintenance(e) {
  if (e) e.preventDefault();
  const dateVal = document.getElementById('maint-reset-date').value;
  const timeVal = document.getElementById('maint-reset-time').value;
  if (!dateVal || !timeVal) return;

  const resetDt = new Date(`${dateVal}T${timeVal}:00`);
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

        // 1. Calculate Average Luminance
        let totalLum = 0;
        const totalPixels = canvas.width * canvas.height;
        for (let i = 0; i < d.length; i += 4) {
          totalLum += (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
        }
        const avgLum = totalLum / totalPixels;
        const isDarkBg = avgLum < 130;

        // 2. Grayscale, Invert if dark, and Enhance Contrast
        for (let i = 0; i < d.length; i += 4) {
          let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

          if (isDarkBg) {
            // Invert: Light yellow/white text becomes dark on pure white
            gray = 255 - gray;
          }

          // Contrast stretching & thresholding
          if (gray > 160) {
            gray = 255;
          } else if (gray < 85) {
            gray = 0;
          } else {
            gray = Math.round(((gray - 85) / 75) * 255);
          }

          d[i] = gray;
          d[i + 1] = gray;
          d[i + 2] = gray;
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

// Process Image with AI OCR
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
  if (statusEl) {
    statusEl.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles fa-spin text-amber-400"></i> กำลังปรับความคมชัดของภาพ (Canvas AI Pre-processing)...`;
    statusEl.classList.remove('hidden');
  }
  if (resultBox) resultBox.classList.add('hidden');
  if (modal) modal.classList.remove('hidden');

  try {
    // 1. Preprocess with Canvas Pipeline
    const processedBlob = await preprocessImageCanvas(file);

    // 2. Check if Tesseract is available
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
    // Clean up common Thai vowel / tone artifacts
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
    .replace(/ไข่ต[\s_]*น/g, 'ไข่ตุ๋น')
    .replace(/ไข่ตุน/g, 'ไข่ตุ๋น')
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

  // 2. Detect Date (DD/MM) & Time (HH:MM) - Prioritizing the front of the log lines
  let extractedDate = null;
  let extractedTime = null;

  const rawLines = normalized.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // A. Check for date + time in header (e.g. "17/08 03:21" or "17/08 03.21")
  for (const line of rawLines) {
    const dtMatch = line.match(/(\d{1,2})[\/.-](\d{1,2})\s+(\d{1,2})[:.](\d{2})/);
    if (dtMatch) {
      const d = dtMatch[1].padStart(2, '0');
      const m = dtMatch[2].padStart(2, '0');
      const currentYear = new Date().getFullYear();
      extractedDate = `${currentYear}-${m}-${d}`;
      extractedTime = `${dtMatch[3].padStart(2, '0')}:${dtMatch[4].padStart(2, '0')}`;
      break;
    }
  }

  // B. If time not found from header, check the very FRONT of any log line: e.g. "[03:21]" or "03:21" or "[03.21]"
  if (!extractedTime) {
    for (const line of rawLines) {
      const frontTimeMatch = line.match(/^\s*\[?\s*(\d{1,2})[:.](\d{2})\s*\]?/);
      if (frontTimeMatch) {
        extractedTime = `${frontTimeMatch[1].padStart(2, '0')}:${frontTimeMatch[2].padStart(2, '0')}`;
        break;
      }
    }
  }

  // C. Fallback: Any timestamp in text
  if (!extractedTime) {
    const timeStampMatch = normalized.match(/\[?(\d{1,2})[:.](\d{2})\]?/);
    if (timeStampMatch) {
      extractedTime = `${timeStampMatch[1].padStart(2, '0')}:${timeStampMatch[2].padStart(2, '0')}`;
    }
  }

  // D. Fallback: Date only (DD/MM)
  if (!extractedDate) {
    const dMatch = normalized.match(/(\d{1,2})[\/.-](\d{1,2})/);
    if (dMatch) {
      const d = dMatch[1].padStart(2, '0');
      const m = dMatch[2].padStart(2, '0');
      const currentYear = new Date().getFullYear();
      extractedDate = `${currentYear}-${m}-${d}`;
    }
  }

  // 3. Detect Boss (Check name or location keywords)
  let matchedBoss = null;
  const lower = normalized.toLowerCase();
  for (const b of bossList) {
    if (lower.includes(b.name.toLowerCase()) || (b.map && lower.includes(b.map.toLowerCase()))) {
      matchedBoss = b;
      break;
    }
  }

  // Additional fuzzy keyword matching for Thai Boss names
  if (!matchedBoss) {
    if (lower.includes('ego') || lower.includes('อีโก้') || lower.includes('อูลาน')) matchedBoss = bossList.find(b => b.id === 'ego');
    else if (lower.includes('dalia') || lower.includes('ดาเลีย')) matchedBoss = bossList.find(b => b.id === 'lady_dalia');
    else if (lower.includes('vioren') || lower.includes('ไวโอเรน')) matchedBoss = bossList.find(b => b.id === 'vioren');
    else if (lower.includes('venatus') || lower.includes('เวนาทัส')) matchedBoss = bossList.find(b => b.id === 'venatus');
    else if (lower.includes('livera') || lower.includes('ลิเวร่า')) matchedBoss = bossList.find(b => b.id === 'livera');
    else if (lower.includes('undomiel') || lower.includes('อันโดเมียล')) matchedBoss = bossList.find(b => b.id === 'undomiel');
    else if (lower.includes('araneo') || lower.includes('อารานีโอ')) matchedBoss = bossList.find(b => b.id === 'araneo');
    else if (lower.includes('aquleus') || lower.includes('อควิลิอุส') || lower.includes('เจเนอรัล')) matchedBoss = bossList.find(b => b.id === 'general_aquleus');
    else if (lower.includes('amentis') || lower.includes('อาเมนทิส')) matchedBoss = bossList.find(b => b.id === 'amentis');
    else if (lower.includes('gareth') || lower.includes('การิธ')) matchedBoss = bossList.find(b => b.id === 'gareth');
    else if (lower.includes('braudmore') || lower.includes('บรอดมอร์') || lower.includes('บารอน')) matchedBoss = bossList.find(b => b.id === 'baron_braudmore');
    else if (lower.includes('catena') || lower.includes('คาเทน่า')) matchedBoss = bossList.find(b => b.id === 'catena');
    else if (lower.includes('shuliar') || lower.includes('ชูเลียร์')) matchedBoss = bossList.find(b => b.id === 'shuliar');
    else if (lower.includes('larba') || lower.includes('ลาบา')) matchedBoss = bossList.find(b => b.id === 'larba');
    else if (lower.includes('titore') || lower.includes('ทิทอร์')) matchedBoss = bossList.find(b => b.id === 'titore');
    else if (lower.includes('wannitas') || lower.includes('วานิตัส')) matchedBoss = bossList.find(b => b.id === 'wannitas');
    else if (lower.includes('metus') || lower.includes('เมทัส')) matchedBoss = bossList.find(b => b.id === 'metus');
    else if (lower.includes('duplican') || lower.includes('ดุปพลิแคน')) matchedBoss = bossList.find(b => b.id === 'duplican');
    else if (lower.includes('asta') || lower.includes('แอสตา')) matchedBoss = bossList.find(b => b.id === 'asta');
    else if (lower.includes('ordo') || lower.includes('ออร์โด')) matchedBoss = bossList.find(b => b.id === 'ordo');
    else if (lower.includes('supore') || lower.includes('ซูพอร์')) matchedBoss = bossList.find(b => b.id === 'supore');
    else if (lower.includes('secreta') || lower.includes('ซีเครต้า')) matchedBoss = bossList.find(b => b.id === 'secreta');
  }

  // 4. Extract Clean Drop Items with Receiver
  const lines = normalized.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const items = [];

  // Regex to match: [03:21]ไข่ตุ๋นได้รับไอเทมผ้าโพกศีรษะแห่งความศรัทธาที่เสื่อมทราม จากหุบเขาอูลาน
  const itemLineRegex = /(?:\[\d{1,2}[:.]\d{2}\]\s*)?(.*?)\s*(?:ได[\s_]*รับ|ได้รับ)ไอเทม\s*(.*?)(?:\s*(?:จาก|in)\s*.*)?$/i;

  for (let line of lines) {
    const match = line.match(itemLineRegex);
    if (match) {
      let player = match[1].replace(/\[\d{1,2}[:.]\d{2}\]/g, '').trim();
      let itemName = match[2].trim();

      // Clean up common suffix or count (e.g. 4อัน -> x4)
      itemName = itemName.replace(/(\d+)\s*อัน/g, 'x$1').replace(/(\d+)\s*ea/gi, 'x$1');

      if (player) {
        items.push(`${itemName} (ผู้รับ: ${player})`);
      } else {
        items.push(itemName);
      }
    } else {
      // Fallback for clean item lines
      const isHeaderOrMeta = line.toLowerCase().includes('ego') || line.toLowerCase().includes('บันทึกโดย') || line.length < 4;
      if (!isHeaderOrMeta && !line.startsWith('[') && !line.includes('จาก')) {
        items.push(line);
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
  const bossSelect = document.getElementById('ocr-boss-select');
  const dateInput = document.getElementById('ocr-kill-date');
  const timeInput = document.getElementById('ocr-kill-time');
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
  if (timeInput) {
    timeInput.value = parsed.timeMatch || `${pad(now.getHours())}:${pad(now.getMinutes())}`;
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
  const timeVal = document.getElementById('ocr-kill-time').value;
  const itemsVal = document.getElementById('ocr-drop-items').value.trim();

  if (!bossId || !dateVal || !timeVal) return;

  const dt = new Date(`${dateVal}T${timeVal}:00`);
  if (isNaN(dt.getTime())) {
    alert('วันที่หรือเวลาไม่ถูกต้อง');
    return;
  }

  const boss = bossList.find(b => b.id === bossId);
  const adminEmail = typeof currentAdminEmail !== 'undefined' ? currentAdminEmail : 'Admin';

  // Save Boss Kill Time
  saveBossKillTime(bossId, dt.toISOString(), adminEmail);

  // Save Drop Log
  if (itemsVal) {
    const itemsList = itemsVal.split('\n').map(i => i.trim()).filter(i => i.length > 0);
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
window.openCustomKillModal = openCustomKillModal;
window.closeCustomKillModal = closeCustomKillModal;
window.handleSaveCustomKill = handleSaveCustomKill;
window.openBossDropLogModal = openBossDropLogModal;
window.closeBossDropLogModal = closeBossDropLogModal;
window.processImageForBossOCR = processImageForBossOCR;
window.toggleBossSound = toggleBossSound;
window.renderBossTimerCards = renderBossTimerCards;
window.closeBossAiOcrModal = closeBossAiOcrModal;
window.handleConfirmOcrSave = handleConfirmOcrSave;
window.clearAllBossTimers = clearAllBossTimers;
