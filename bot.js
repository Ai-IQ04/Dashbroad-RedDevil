/**
 * ==============================================================================
 * 🤖 Dedicated Discord Alert & 24/7 Notifier Engine (Render Cloud Edition)
 * ==============================================================================
 * ระบบแจ้งเตือนคำขอและกิจกรรมกิลด์ 24 ชั่วโมง สำหรับ BlueDevil & RedDevil
 * - ⚡ Direct Discord REST API Engine (ไม่ติด Cloudflare WebSocket Block บน Render)
 * - ⏱️ Instant Real-Time Outbound Poller (ตรวจสอบคำขอทุก 3 วินาที)
 * - 💓 Continuous Heartbeat 24/7 Monitor
 * - 🌐 Lightweight HTTP Health Check Server (Port Binding 200 OK)
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// 🛡️ ป้องกันโปรเซสหยุดทำงานจาก Unhandled Rejection และ Exception
process.on('unhandledRejection', (reason) => {
  console.warn('⚠️ [Process Rejection Handled]:', reason && reason.message ? reason.message : reason);
});

process.on('uncaughtException', (err) => {
  console.warn('⚠️ [Process Exception Handled]:', err && err.message ? err.message : err);
});

function loadDotEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;

  try {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const eqIndex = trimmed.indexOf('=');
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch (e) {
    console.warn('⚠️ ไม่สามารถอ่านไฟล์ .env ได้:', e.message);
  }
}

loadDotEnvFile();

const FALLBACK_TOKEN = Buffer.from('TVRVd09EYzVORGd4TkRNME5UVXhNRGs1TWcuR19Pd3NFLnFnUHRHNDYwdDlVVUZHSUptTWZkR1JYZDFmTElHa0tuSGUwZ1RZ', 'base64').toString('utf8');

// ⚙️ โหลดการตั้งค่าจาก bot_config.json และ Environment Variables
let CONFIG = {
  DISCORD_BOT_TOKEN: FALLBACK_TOKEN,
  REGISTRATION_CHANNEL_ID: '1508499750859575476',
  BOSS_ALERT_CHANNEL_ID: '1538638951089180742',
  ANNOUNCEMENT_CHANNEL_ID: '1539252263132860516',
  ADMIN_REQUEST_CHANNEL_ID: '1541279270096212068',
  ADMIN_ROLE_ID: '1508502265097621544',
  MENTION_TAG: '<@&1508495658162851970>',
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

CONFIG = {
  ...CONFIG,
  DISCORD_BOT_TOKEN: (process.env.DISCORD_BOT_TOKEN || CONFIG.DISCORD_BOT_TOKEN || '').trim(),
  REGISTRATION_CHANNEL_ID: (process.env.REGISTRATION_CHANNEL_ID || CONFIG.REGISTRATION_CHANNEL_ID || '').trim(),
  BOSS_ALERT_CHANNEL_ID: (process.env.BOSS_ALERT_CHANNEL_ID || CONFIG.BOSS_ALERT_CHANNEL_ID || '').trim(),
  ANNOUNCEMENT_CHANNEL_ID: (process.env.ANNOUNCEMENT_CHANNEL_ID || CONFIG.ANNOUNCEMENT_CHANNEL_ID || '').trim(),
  ADMIN_REQUEST_CHANNEL_ID: (process.env.ADMIN_REQUEST_CHANNEL_ID || CONFIG.ADMIN_REQUEST_CHANNEL_ID || '').trim(),
  MENTION_TAG: (process.env.MENTION_TAG || CONFIG.MENTION_TAG || '').trim(),
  FIREBASE_DB_URL: (process.env.FIREBASE_DB_URL || CONFIG.FIREBASE_DB_URL || '').trim()
};

console.log('====================================================');
console.log('🤖 [RedDevil Dedicated Alert Engine] เริ่มต้นทำงาน...');
console.log(`🔑 [Token Status]: ${CONFIG.DISCORD_BOT_TOKEN ? 'LOADED ✅' : 'MISSING ❌'}`);
console.log(`🔥 [Firebase DB]: ${CONFIG.FIREBASE_DB_URL}`);
console.log(`📢 [Admin Request Target]: ${CONFIG.ADMIN_REQUEST_CHANNEL_ID}`);
console.log('====================================================');

// 🌐 Lightweight HTTP Health Check Server (จำเป็นสำหรับ Render.com Web Service & Uptime Monitor)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('🤖 RedDevil Dedicated Alert Bot is Running 24/7 Online!');
}).listen(PORT, () => {
  console.log(`🌐 Health check server listening on port ${PORT}`);
});

/**
 * ⚡ ฟังก์ชันส่งข้อความตรงเข้า Discord Channel หรือ Thread ผ่าน Discord REST API (Direct HTTP POST)
 * ข้อดี: ส่งทันที ไม่ต้องรอ WebSocket Gateway และไม่ติดขัดปัญหา Cloudflare 5xx
 */
async function sendDiscordMessageDirect({ channelId, content, embeds }) {
  const token = CONFIG.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('ไม่มี Discord Bot Token');

  const url = `https://discord.com/api/v10/channels/${channelId}/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'DiscordBot (https://github.com/Ai-IQ04/Dashbroad-RedDevil, 1.0.0)'
    },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      content: content || undefined,
      embeds: embeds || []
    })
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Discord REST HTTP ${response.status}: ${errBody}`);
  }

  return await response.json();
}

// 💓 ส่งสถานะ Heartbeat ขึ้น Firebase RTDB
async function sendHeartbeat() {
  try {
    const endpoint = `${CONFIG.FIREBASE_DB_URL}/guild_app/bot_status.json`;
    await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        isOnline: true,
        tag: 'Dev#6946 (Render Engine)',
        lastHeartbeat: new Date().toISOString()
      })
    });
  } catch (e) {
    console.warn('⚠️ [Heartbeat Error]:', e.message);
  }
}

// 📨 ระบบตรวจจับคำขอใหม่จาก Firebase และส่งเข้า Discord
let outboundAlertsInProgress = false;
async function checkOutboundAlertsCommand() {
  if (outboundAlertsInProgress) return;
  try {
    const endpoint = `${CONFIG.FIREBASE_DB_URL}/guild_app/bot_commands/outbound_alerts.json`;
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return;

    const data = await response.json();
    if (!data || typeof data !== 'object') return;

    outboundAlertsInProgress = true;
    for (const [key, item] of Object.entries(data)) {
      if (!item) continue;
      const targetChannelId = item.channelId || CONFIG.ADMIN_REQUEST_CHANNEL_ID || '1541279270096212068';

      const fallbackRole = CONFIG.ADMIN_ROLE_ID ? `<@&${CONFIG.ADMIN_ROLE_ID}>` : '<@&1508502265097621544>';
      let content = (item.content !== undefined && item.content !== null && item.content !== '') ? item.content : (item.mentionTag || fallbackRole);
      // แก้ไขกรณี Tag มี typo เช่น <a& เป็น <@&
      if (typeof content === 'string' && content.startsWith('<a&')) {
        content = content.replace(/^<a&/, '<@&');
      }

      const embedObj = {
        title: item.title || '🔔 มีคำขอใหม่จากสมาชิก',
        color: Number(item.color) || 0x3B82F6,
        description: item.description || undefined,
        timestamp: item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString(),
        footer: { text: '🛡️ LORD NINE SYSTEM • Dashboard RedDevil' },
        fields: Array.isArray(item.fields) ? item.fields.map(f => ({
          name: String(f.name || ''),
          value: String(f.value || ''),
          inline: Boolean(f.inline)
        })) : []
      };

      try {
        const resJson = await sendDiscordMessageDirect({
          channelId: targetChannelId,
          content: content || undefined,
          embeds: [embedObj]
        });
        console.log(`📤 [Alert Sent] ส่งแจ้งเตือนคำขอเข้าห้อง ${targetChannelId} เรียบร้อยแล้ว (Message ID: ${resJson.id || 'OK'})`);

        // ลบคำขอออกจากคิวใน Firebase เมื่อส่งสำเร็จ
        await fetch(`${CONFIG.FIREBASE_DB_URL}/guild_app/bot_commands/outbound_alerts/${key}.json`, {
          method: 'DELETE',
          signal: AbortSignal.timeout(5000)
        }).catch(() => {});
      } catch (err) {
        console.error(`❌ [Alert Failed] ส่งเข้าห้อง ${targetChannelId} ไม่สำเร็จ:`, err.message);
      }
    }
  } catch (err) {
    console.warn('⚠️ [Outbound Alert Poller Error]:', err.message);
  } finally {
    outboundAlertsInProgress = false;
  }
}

// 🚀 เริ่มต้นลูปการทำงาน 24/7 ทันที
console.log('⚡ [24/7 Engine] เริ่มต้น Poller ตรวจจับคำขอ (ทุก 3 วินาที) และ Heartbeat (ทุก 15 วินาที)...');

setInterval(checkOutboundAlertsCommand, 3000);
setInterval(sendHeartbeat, 15000);

// รันรอบแรกทันที
sendHeartbeat();
checkOutboundAlertsCommand();
