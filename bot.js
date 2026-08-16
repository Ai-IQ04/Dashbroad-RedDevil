/**
 * ==============================================================================
 * 🤖 Discord Sync & 24/7 Boss Alert Bot for BlueDevil & RedDevil Guild
 * ==============================================================================
 * หน้าที่ของบอท:
 * 1. สแกนประวัติการลงทะเบียนของสมาชิกทั้งหมดในห้อง Discord ที่กำหนด
 * 2. ดักฟังการลงทะเบียนใหม่แบบ Real-Time และซิงค์ขึ้น Firebase
 * 3. แจ้งเตือนบอสเกิดอัตโนมัติ (Alert 24/7):
 *    - แจ้งเตือนก่อนบอสเกิด 5 นาที (🟡 Amber Warning)
 *    - แจ้งเตือนเมื่อบอสเกิดแล้ว (🔴 Red Spawn Alert)
 *    - แสดงเวลาจริงที่จะเกิด (Real Spawn Time) + Discord Dynamic Countdown (<t:timestamp:R>)
 * ==============================================================================
 */

const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// ⚙️ โหลดการตั้งค่าจาก bot_config.json
let CONFIG = {
  DISCORD_BOT_TOKEN: '',
  REGISTRATION_CHANNEL_ID: '',
  BOSS_ALERT_CHANNEL_ID: '1538638951089180742',
  FIREBASE_DB_URL: 'https://reddevil-f229e-default-rtdb.asia-southeast1.firebasedatabase.app'
};

try {
  const configPath = path.join(__dirname, 'bot_config.json');
  if (fs.existsSync(configPath)) {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    CONFIG = { ...CONFIG, ...raw };
  }
} catch (e) {
  console.error('❌ ไม่สามารถอ่านไฟล์ bot_config.json ได้:', e.message);
}

// 🤖 สร้าง Client บอท
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Message, Partials.Channel]
});

// 🐉 รายชื่อและกฎการเกิดของบอสทั้งหมด 45+ ตัว (ตรงกับระบบเว็บ)
const BOSS_DATABASE = [
  { id: 'world_boss', name: 'World Boss', level: '60-105', map: 'World Boss', respawnType: 'fixed', fixedTimes: [{days: [0,1,2,3,4,5,6], time: '10:00'}, {days: [0,1,2,3,4,5,6], time: '19:00'}], note: 'World Boss' },
  { id: 'vioren', name: 'Vioren', level: '65', map: 'ทะเลสาบจันทร์เสี้ยว', respawnType: 'interval', intervalHours: 10 },
  { id: 'venatus', name: 'Venatus', level: '60', map: 'แอ่งน้ำปนเปื้อน', respawnType: 'interval', intervalHours: 10 },
  { id: 'lady_dalia', name: 'Lady Dalia', level: '85', map: 'เนินเขาอัสดง', respawnType: 'interval', intervalHours: 18 },
  { id: 'ego', name: 'Ego', level: '70', map: 'หุบเขาอูลาน', respawnType: 'interval', intervalHours: 21 },
  { id: 'livera', name: 'Livera', level: '75', map: 'โบราณสถานผู้พิทักษ์', respawnType: 'interval', intervalHours: 24 },
  { id: 'undomiel', name: 'Undomiel', level: '80', map: 'ห้องทดลองลับ', respawnType: 'interval', intervalHours: 24 },
  { id: 'araneo', name: 'Araneo', level: '75', map: 'สุสานใต้ดิน ชั้น 1', respawnType: 'interval', intervalHours: 24 },
  { id: 'general_aquleus', name: 'General Aquleus', level: '85', map: 'สุสานใต้ดิน ชั้น 2', respawnType: 'interval', intervalHours: 29 },
  { id: 'amentis', name: 'Amentis', level: '88', map: 'เนินเขาอัสดง', respawnType: 'interval', intervalHours: 29 },
  { id: 'gareth', name: 'Gareth', level: '98', map: 'ดินแดนมรณะ ชั้น 1', respawnType: 'interval', intervalHours: 32 },
  { id: 'baron_braudmore', name: 'Baron Braudmore', level: '88', map: 'สมรภูมิศักดิ์สิทธิ์', respawnType: 'interval', intervalHours: 32 },
  { id: 'catena', name: 'Catena', level: '100', map: 'ดินแดนมรณะ ชั้น 3', respawnType: 'interval', intervalHours: 35 },
  { id: 'shuliar', name: 'Shuliar', level: '95', map: 'ซากของสงคราม', respawnType: 'interval', intervalHours: 35 },
  { id: 'larba', name: 'Larba', level: '98', map: 'ซากของสงคราม', respawnType: 'interval', intervalHours: 35 },
  { id: 'titore', name: 'Titore', level: '98', map: 'ดินแดนมรณะ ชั้น 2', respawnType: 'interval', intervalHours: 37 },
  { id: 'wannitas', name: 'Wannitas', level: '93', map: 'ดอนแห่งการปฏิวัติ', respawnType: 'interval', intervalHours: 48 },
  { id: 'metus', name: 'Metus', level: '93', map: 'ดอนแห่งการปฏิวัติ', respawnType: 'interval', intervalHours: 48 },
  { id: 'duplican', name: 'Duplican', level: '93', map: 'ดอนแห่งการปฏิวัติ', respawnType: 'interval', intervalHours: 48 },
  { id: 'asta', name: 'Asta', level: '100', map: 'ทุ่งหญ้าแดง', respawnType: 'interval', intervalHours: 62 },
  { id: 'ordo', name: 'Ordo', level: '100', map: 'ทุ่งหญ้าแดง', respawnType: 'interval', intervalHours: 62 },
  { id: 'secreta', name: 'Secreta', level: '100', map: 'ทุ่งหญ้าแดง', respawnType: 'interval', intervalHours: 62 },
  { id: 'supore', name: 'Supore', level: '100', map: 'ทุ่งหญ้าแดง', respawnType: 'interval', intervalHours: 62 },
  { id: 'clemantis', name: 'Clemantis', level: '70', map: 'แอ่งน้ำปนเปื้อน', respawnType: 'fixed', fixedTimes: [{days: [1], time: '10:30'}, {days: [4], time: '18:00'}] },
  { id: 'saphirus', name: 'Saphirus', level: '80', map: 'ทะเลสาบจันทร์เสี้ยว', respawnType: 'fixed', fixedTimes: [{days: [0], time: '16:00'}, {days: [2], time: '10:30'}] },
  { id: 'neutro', name: 'Neutro', level: '80', map: 'ทะเลทรายกรีดร้อง', respawnType: 'fixed', fixedTimes: [{days: [2], time: '18:00'}, {days: [4], time: '10:30'}] },
  { id: 'thymele', name: 'Thymele', level: '85', map: 'เนินเขาอัสดง', respawnType: 'fixed', fixedTimes: [{days: [1], time: '18:00'}, {days: [3], time: '10:30'}] },
  { id: 'roderick', name: 'Roderick', level: '95', map: 'ทางระบายน้ำ ชั้น 1', respawnType: 'fixed', fixedTimes: [{days: [5], time: '18:00'}] },
  { id: 'auraq', name: 'Auraq', level: '100', map: 'ทางระบายน้ำ ชั้น 2', respawnType: 'fixed', fixedTimes: [{days: [5], time: '21:00'}, {days: [3], time: '20:00'}] },
  { id: 'milavy', name: 'Milavy', level: '90', map: 'สุสานใต้ดิน ชั้น 3', respawnType: 'fixed', fixedTimes: [{days: [6], time: '14:00'}] },
  { id: 'ringor', name: 'Ringor', level: '95', map: 'สมรภูมิศักดิ์สิทธิ์', respawnType: 'fixed', fixedTimes: [{days: [6], time: '16:00'}] },
  { id: 'chaiflock', name: 'Chaiflock', level: '120', map: 'ทุ่งหญ้าแดง', respawnType: 'fixed', fixedTimes: [{days: [0], time: '14:00'}] },
  { id: 'benji', name: 'Benji', level: '120', map: 'ทุ่งหญ้าแดง', respawnType: 'fixed', fixedTimes: [{days: [0], time: '20:00'}] },
  { id: 'tumier', name: 'Tumier', level: '140', map: 'ทางระบายน้ำ ชั้น 3', respawnType: 'fixed', fixedTimes: [{days: [2], time: '20:55'}] },
  { id: 'nevaeh', name: 'Nevaeh', level: '140', map: 'KRANSIA', respawnType: 'fixed', fixedTimes: [{days: [0], time: '21:00'}] },
  { id: 'icaruthia', name: 'Icaruthia', level: '135', map: 'KRANSIA', respawnType: 'fixed', fixedTimes: [{days: [2], time: '20:00'}, {days: [5], time: '20:00'}] },
  { id: 'motti', name: 'Motti', level: '135', map: 'KRANSIA', respawnType: 'fixed', fixedTimes: [{days: [3], time: '18:00'}, {days: [6], time: '18:00'}] },
  { id: 'libitina', name: 'Libitina', level: '130', map: 'โบสถ์แห่งบ่วงบัญชาชั่วนิรันดร์', respawnType: 'fixed', fixedTimes: [{days: [2], time: '20:50'}, {days: [6], time: '20:30'}] },
  { id: 'rakajeth', name: 'Rakajeth', level: '130', map: 'อาญาแห่งเซเครต้า', respawnType: 'fixed', fixedTimes: [{days: [2], time: '21:00'}, {days: [0], time: '20:05'}] },
  { id: 'bahel', name: 'Bahel', level: '140', map: 'รอยแยกแห่งการกัดกร่อน', respawnType: 'fixed', fixedTimes: [{days: [5], time: '02:00'}] },
  { id: 'lucus', name: 'Lucus', level: '145', map: 'เตาหลอมแห่งความเงียบงัน', respawnType: 'fixed', fixedTimes: [{days: [6], time: '21:00'}] },
  { id: 'camalia', name: 'Camalia', level: '135', map: 'ห้องทดลอง', respawnType: 'fixed', fixedTimes: [{days: [5], time: '19:05'}] },
  { id: 'guild_arena', name: 'Guild Arena', level: '00', map: 'Guild Base', respawnType: 'fixed', fixedTimes: [{days: [5,6,0], time: '19:25'}] },
  { id: 'reddevil_guild_boss', name: 'RedDevil Guild Boss', level: '00', map: 'Guild Base', respawnType: 'fixed', fixedTimes: [{days: [0], time: '19:05'}] }
];

const GUILD_SCORING_BOSS_IDS = new Set([
  'lucus', 'bahel', 'libitina', 'rakajeth', 'tumier', 'nevaeh', 'icaruthia', 'motti', 'guild_arena', 'camalia', 'world_boss', 'reddevil_guild_boss'
]);

// คำนวณเวลาเกิดรอบถัดไป
function calculateNextSpawnDate(boss, defeatedDateStr) {
  const now = new Date();
  if (boss.respawnType === 'interval') {
    if (!defeatedDateStr) return null;
    const defDate = new Date(defeatedDateStr);
    if (isNaN(defDate.getTime())) return null;
    return new Date(defDate.getTime() + (boss.intervalHours * 3600 * 1000));
  }

  if (boss.respawnType === 'fixed' && Array.isArray(boss.fixedTimes)) {
    let nearest = null;
    for (let offset = 0; offset <= 7; offset++) {
      const checkDate = new Date(now.getTime() + offset * 24 * 3600 * 1000);
      const dayOfWeek = checkDate.getDay();
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

// ชุดเก็บประวัติการส่งแจ้งเตือนเพื่อป้องกันการส่งซ้ำ
const sentAlerts = new Set();

/**
 * 🔔 ฟังก์ชันตรวจสอบเวลาบอสและส่งแจ้งเตือนเข้า Discord
 */
async function checkAndSendBossAlerts() {
  if (!CONFIG.BOSS_ALERT_CHANNEL_ID) return;

  try {
    const channel = await client.channels.fetch(CONFIG.BOSS_ALERT_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) return;

    // ดึงข้อมูล Timers ล่าสุดจาก Firebase
    const res = await fetch(`${CONFIG.FIREBASE_DB_URL}/guild_app/boss_timers.json`);
    const timerData = res.ok ? (await res.json() || {}) : {};

    const now = new Date();

    for (const boss of BOSS_DATABASE) {
      const timer = timerData[boss.id] || {};
      let nextSpawn = null;

      if (timer.customNextSpawn) {
        nextSpawn = new Date(timer.customNextSpawn);
      } else {
        nextSpawn = calculateNextSpawnDate(boss, timer.defeatedTime);
      }

      if (!nextSpawn || isNaN(nextSpawn.getTime())) continue;

      const diffMs = nextSpawn.getTime() - now.getTime();
      const spawnTimestamp = Math.floor(nextSpawn.getTime() / 1000);
      const isGuildEvent = GUILD_SCORING_BOSS_IDS.has(boss.id);
      const eventLabel = isGuildEvent ? '⭐ กิจกรรมกิลด์ (Scoring Event)' : '🛡️ บอสทั่วไป (Field Boss)';

      // 🟡 1. แจ้งเตือนก่อนเกิด 5 นาที (เมื่อเหลือ 0 ถึง 5 นาที)
      if (diffMs > 0 && diffMs <= 5 * 60 * 1000) {
        const alertKey = `${boss.id}_5m_${spawnTimestamp}`;
        if (!sentAlerts.has(alertKey)) {
          sentAlerts.add(alertKey);

          const embed5m = new EmbedBuilder()
            .setColor('#F59E0B') // สีเหลืองทอง Amber
            .setTitle(`🟡 [BOSS INCOMING] ${boss.name} ใกล้จะเกิดแล้วใน 5 นาที!`)
            .setDescription(`เตรียมตัวรวมพล! บอสกำลังจะเกิดในอีก **5 นาที** กรุณาเดินทางไปยังจุดนัดพบ`)
            .addFields(
              { name: '👑 ชื่อบอส', value: `**${boss.name}** (Lv. ${boss.level || '??'})`, inline: true },
              { name: '📍 สถานที่ / แมพ', value: `${boss.map || 'ไม่ระบุแมพ'}`, inline: true },
              { name: '⚔️ ประเภท', value: `${eventLabel}`, inline: true },
              { name: '⏰ เวลาที่จะเกิด', value: `<t:${spawnTimestamp}:F>\n⏳ **นับถอยหลัง:** <t:${spawnTimestamp}:R>`, inline: false }
            )
            .setFooter({ text: 'BlueDevil & RedDevil • ระบบติดตามบอส Real-time', iconURL: client.user.displayAvatarURL() })
            .setTimestamp(nextSpawn);

          await channel.send({ embeds: [embed5m] });
          console.log(`📢 [ส่งแจ้งเตือน 5 นาที] ${boss.name} ในห้อง ${channel.name || CONFIG.BOSS_ALERT_CHANNEL_ID}`);
        }
      }

      // 🔴 2. แจ้งเตือนเมื่อบอสเกิดแล้ว (เมื่อเลยเวลาเกิดมาไม่เกิน 15 นาที)
      if (diffMs <= 0 && diffMs >= -15 * 60 * 1000) {
        const alertKey = `${boss.id}_spawned_${spawnTimestamp}`;
        if (!sentAlerts.has(alertKey)) {
          sentAlerts.add(alertKey);

          const embedSpawned = new EmbedBuilder()
            .setColor('#EF4444') // สีแดงสด Ruby Red
            .setTitle(`🔴 [BOSS SPAWNED] ${boss.name} เกิดแล้ว! ออกล่าได้ทันที`)
            .setDescription(`🚨 **บอสปรากฏตัวแล้ว!** สมาชิกกิลด์สามารถวาร์ปไปจุดเกิดและเริ่มโจมตีได้เลย`)
            .addFields(
              { name: '👑 ชื่อบอส', value: `**${boss.name}** (Lv. ${boss.level || '??'})`, inline: true },
              { name: '📍 สถานที่ / แมพ', value: `${boss.map || 'ไม่ระบุแมพ'}`, inline: true },
              { name: '⚔️ ประเภท', value: `${eventLabel}`, inline: true },
              { name: '⏰ เวลาที่เกิด', value: `<t:${spawnTimestamp}:F> (<t:${spawnTimestamp}:R>)`, inline: false },
              { name: '🗡️ สถานะ', value: `🔥 **ALIVE (เกิดแล้ว)**`, inline: true }
            )
            .setFooter({ text: 'BlueDevil & RedDevil • ระบบติดตามบอส Real-time', iconURL: client.user.displayAvatarURL() })
            .setTimestamp(now);

          await channel.send({ embeds: [embedSpawned] });
          console.log(`🚨 [ส่งแจ้งเตือนบอสเกิดแล้ว!] ${boss.name} ในห้อง ${channel.name || CONFIG.BOSS_ALERT_CHANNEL_ID}`);
        }
      }
    }
  } catch (err) {
    console.error('❌ Error checking boss alerts:', err.message);
  }
}

/**
 * 📦 ฟังก์ชันส่งข้อมูลขึ้น Firebase Realtime Database
 */
async function syncToFirebase(verifiedData) {
  try {
    const safeKey = (verifiedData.email || verifiedData.characterName || verifiedData.discordId)
      .replace(/[.#$[\]]/g, '_')
      .toLowerCase();

    const endpoint = `${CONFIG.FIREBASE_DB_URL}/guild_app/registered_members/${safeKey}.json`;

    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(verifiedData)
    });

    if (response.ok) {
      console.log(`✅ [Sync สำเร็จ] ตัวละคร: ${verifiedData.characterName || '-'} | อีเมล: ${verifiedData.email || '-'}`);
    }
  } catch (err) {
    console.error('❌ Error syncing to Firebase:', err.message);
  }
}

/**
 * 🔍 ฟังก์ชันแกะข้อมูลจากข้อความ Embed หรือ Text การลงทะเบียน
 */
function parseRegistrationMessage(message) {
  let content = '';

  if (message.embeds && message.embeds.length > 0) {
    const embed = message.embeds[0];
    const embedTexts = [];
    if (embed.title) embedTexts.push(embed.title);
    if (embed.description) embedTexts.push(embed.description);
    if (embed.fields) {
      embed.fields.forEach(f => embedTexts.push(`${f.name}\n${f.value}`));
    }
    if (embed.footer && embed.footer.text) embedTexts.push(embed.footer.text);
    content = embedTexts.join('\n');
  } else {
    content = message.content || '';
  }

  if (!content) return null;

  const cleanLine = (str) => {
    if (!str) return '';
    return str
      .replace(/^[\s\u2500-\u257F\u200B└L\-\|/:`*]+/, '')
      .replace(/^CharacterName[*:\s/]+/i, '')
      .replace(/^ชื่อตัวละคร[*:\s/]+/i, '')
      .replace(/[`*]/g, '')
      .trim();
  };

  const extractVal = (keywords) => {
    for (const kw of keywords) {
      const reg = new RegExp('(?:' + kw + ')[^\\n\\r]*[\\n\\r]+([^\\n\\r]+)', 'i');
      const m = content.match(reg);
      if (m && m[1]) {
        const cleaned = cleanLine(m[1]);
        if (cleaned && !keywords.some(k => cleaned.toLowerCase() === k.toLowerCase())) {
          return cleaned;
        }
      }
      const sameLineReg = new RegExp('(?:' + kw + ')[*\\s:/]+([^\\n\\r]+)', 'i');
      const m2 = content.match(sameLineReg);
      if (m2 && m2[1]) {
        const cleaned2 = cleanLine(m2[1]);
        if (cleaned2 && !keywords.some(k => cleaned2.toLowerCase() === k.toLowerCase())) {
          return cleaned2;
        }
      }
    }
    return '';
  };

  const emailMatch = content.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
  const email = emailMatch ? emailMatch[1].replace(/[`*_\s]/g, '').trim() : '';

  const characterName = extractVal(['ชื่อตัวละคร', 'CharacterName', 'Character Name']);
  const guild = extractVal(['กิลด์', 'Guild']);
  const uid = extractVal(['UID สมาชิก', 'InGameMemberNo', 'UID', 'MemberNo']);
  const wallet = extractVal(['WalletUSDT', 'Wallet', 'กระเป๋า']);

  const discordUser = message.author;

  if (!email && !characterName) {
    return null;
  }

  return {
    email: email,
    characterName: characterName,
    guild: guild,
    uid: uid,
    wallet: wallet,
    discordId: discordUser ? discordUser.id : '',
    discordTag: discordUser ? `${discordUser.username}#${discordUser.discriminator || '0'}` : '',
    discordName: discordUser ? (discordUser.globalName || discordUser.username) : '',
    messageId: message.id,
    registeredAt: new Date(message.createdTimestamp).toISOString(),
    verified: true,
    active: true,
    lastSyncedAt: new Date().toISOString()
  };
}

/**
 * 📥 ฟังก์ชันสแกนประวัติการลงทะเบียนย้อนหลังทั้งหมด
 */
async function scanRegistrationHistory() {
  if (!CONFIG.REGISTRATION_CHANNEL_ID) return;

  console.log('====================================================');
  console.log(`📥 เริ่มการสแกนประวัติการลงทะเบียนในห้อง: ${CONFIG.REGISTRATION_CHANNEL_ID}...`);

  let count = 0;
  try {
    const channel = await client.channels.fetch(CONFIG.REGISTRATION_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) {
      throw new Error('ไม่พบห้องแชท หรือบอทไม่มีสิทธิ์เข้าถึงห้องนี้');
    }

    const messages = await channel.messages.fetch({ limit: 100 });
    for (const msg of messages.values()) {
      const parsed = parseRegistrationMessage(msg);
      if (parsed) {
        await syncToFirebase(parsed);
        count++;
      }
    }

    console.log(`🎉 สแกนและซิงค์ข้อมูลสำเร็จทั้งหมด ${count} รายการ!`);
    console.log('🟢 ขณะนี้บอทกำลังออนไลน์และคอยดักฟังการลงทะเบียนใหม่แบบ Real-Time...');
    console.log('====================================================');
  } catch (err) {
    console.error('❌ ไม่สามารถสแกนประวัติการลงทะเบียนได้:', err.message);
  }
}

// 🟢 เมื่อบอทออนไลน์สำเร็จ
client.once('clientReady', async () => {
  console.log('====================================================');
  console.log(`🤖 บอทเชื่อมต่อ Discord สำเร็จในชื่อ: ${client.user.tag}`);
  console.log(`🔥 ฐานข้อมูล Firebase: ${CONFIG.FIREBASE_DB_URL}`);
  console.log(`🔔 ห้องแจ้งเตือนบอส: ${CONFIG.BOSS_ALERT_CHANNEL_ID}`);
  console.log('====================================================');

  await scanRegistrationHistory();

  // ตรวจสอบและส่งแจ้งเตือนบอสทันทีเมื่อเปิดบอท และตรวจสอบซ้ำทุกๆ 15 วินาที
  await checkAndSendBossAlerts();
  setInterval(checkAndSendBossAlerts, 15000);
});

// 📩 ดักฟังข้อความใหม่แบบ Real-Time
client.on('messageCreate', async (message) => {
  if (CONFIG.REGISTRATION_CHANNEL_ID && message.channelId !== CONFIG.REGISTRATION_CHANNEL_ID) return;

  const parsed = parseRegistrationMessage(message);
  if (parsed) {
    console.log(`📩 พบสมาชิกใหม่ลงทะเบียน: ${parsed.characterName || parsed.email}`);
    await syncToFirebase(parsed);
    try {
      await message.react('🟢');
    } catch (e) { }
  }
});

// 🚀 เริ่มต้นล็อกอิน
if (CONFIG.DISCORD_BOT_TOKEN && !CONFIG.DISCORD_BOT_TOKEN.startsWith('วาง_')) {
  client.login(CONFIG.DISCORD_BOT_TOKEN);
} else {
  console.error('⚠️ กรุณาตรวจสอบรหัส Bot Token ในไฟล์ bot_config.json ให้ถูกต้อง');
}
