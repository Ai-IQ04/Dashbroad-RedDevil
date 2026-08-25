/**
 * ==============================================================================
 * 🤖 Full-Power Discord Sync, Online Presence & 24/7 Alert Bot for Railway & Cloud
 * ==============================================================================
 * หน้าที่ของบอท:
 * 1. 🟢 ขึ้นสถานะออนไลน์ (จุดเขียว) 24 ชั่วโมง บน Discord Server
 * 2. 📥 สแกนประวัติการลงทะเบียนของสมาชิกและซิงค์ขึ้น Firebase
 * 3. 👥 ดักฟังสมาชิกเข้าใหม่ / อัปเดตชื่อใน Discord แบบ Real-Time
 * 4. ⚡ แจ้งเตือนคำขอแอดมิน (Admin Requests) ทันทีในระดับมิลลิวินาที
 * 5. 💓 ส่งสถานะ Heartbeat ขึ้น Firebase RTDB สม่ำเสมอ
 * ==============================================================================
 */

const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActivityType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const http = require('http');

// 🛡️ ป้องกันโปรเซสหยุดทำงานจาก Unhandled Rejection และ Exception
process.on('unhandledRejection', (reason) => {
  console.warn('⚠️ [Unhandled Rejection]:', reason && reason.message ? reason.message : reason);
});

process.on('uncaughtException', (err) => {
  console.warn('⚠️ [Uncaught Exception]:', err && err.message ? err.message : err);
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

// ⚙️ โหลดการตั้งค่าจาก bot_config.json และ Environment Variables
let CONFIG = {
  DISCORD_BOT_TOKEN: '',
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
console.log('🚀 [RedDevil Bot] Starting Full-Power Discord Engine...');
console.log(`🔑 [Token Status]: ${CONFIG.DISCORD_BOT_TOKEN ? 'LOADED ✅' : 'MISSING ❌'}`);
console.log(`🔥 [Firebase DB]: ${CONFIG.FIREBASE_DB_URL}`);
console.log(`📢 [Admin Request Target]: ${CONFIG.ADMIN_REQUEST_CHANNEL_ID}`);
console.log('====================================================');

// 🌐 Lightweight HTTP Health Check Server (จำเป็นสำหรับ Cloud Hosting)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('🤖 RedDevil Discord Full-Power Bot is Running 24/7 Online!');
}).listen(PORT, () => {
  console.log(`🌐 Health check server listening on port ${PORT}`);
});

// 🤖 สร้าง Client บอท Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ],
  partials: [Partials.Message, Partials.Channel]
});

// 📡 ตรวจจับสถานะการเชื่อมต่อ Discord Gateway
client.on('error', err => console.error('🔴 [Discord Client Error]:', err.message || err));
client.on('warn', w => console.warn('🟡 [Discord Client Warn]:', w));
client.on('shardReady', id => console.log(`🟢 [Discord Gateway] Shard ${id} เชื่อมต่อสำเร็จ! (สถานะออนไลน์ 🟢)`));
client.on('shardError', (err, id) => console.error(`🔴 [Discord Gateway] Shard ${id} Error:`, err.message || err));
client.on('shardDisconnect', (event, id) => console.warn(`🔴 [Discord Gateway] Shard ${id} หลุดการเชื่อมต่อ:`, event.reason || event));
client.on('shardReconnecting', id => console.log(`🔄 [Discord Gateway] Shard ${id} กำลังพยายามต่อใหม่...`));

/**
 * ⚡ ฟังก์ชันส่งข้อความตรงเข้า Discord Channel หรือ Thread ผ่าน Direct REST API
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

/**
 * 📦 ฟังก์ชันส่งข้อมูลการลงทะเบียนขึ้น Firebase
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
      body: JSON.stringify(verifiedData),
      signal: AbortSignal.timeout(6000)
    });

    if (response.ok) {
      console.log(`✅ [Sync สำเร็จ] ตัวละคร: ${verifiedData.characterName || '-'} | อีเมล: ${verifiedData.email || '-'}`);
    }
  } catch (err) {
    console.warn('⚠️ Error syncing to Firebase:', err.message);
  }
}

/**
 * 🔍 ฟังก์ชันแกะข้อมูลจากข้อความลงทะเบียน
 */
function parseRegistrationMessage(message) {
  let content = '';
  if (message.embeds && message.embeds.length > 0) {
    const embed = message.embeds[0];
    const embedTexts = [];
    if (embed.title) embedTexts.push(embed.title);
    if (embed.description) embedTexts.push(embed.description);
    if (embed.fields) embed.fields.forEach(f => embedTexts.push(`${f.name}\n${f.value}`));
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
        if (cleaned && !keywords.some(k => cleaned.toLowerCase() === k.toLowerCase())) return cleaned;
      }
      const sameLineReg = new RegExp('(?:' + kw + ')[*\\s:/]+([^\\n\\r]+)', 'i');
      const m2 = content.match(sameLineReg);
      if (m2 && m2[1]) {
        const cleaned2 = cleanLine(m2[1]);
        if (cleaned2 && !keywords.some(k => cleaned2.toLowerCase() === k.toLowerCase())) return cleaned2;
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

  if (!email && !characterName) return null;

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
 * 📥 สแกนประวัติการลงทะเบียนย้อนหลัง
 */
async function scanRegistrationHistory() {
  if (!CONFIG.REGISTRATION_CHANNEL_ID) return;
  try {
    const channel = await client.channels.fetch(CONFIG.REGISTRATION_CHANNEL_ID).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const messages = await channel.messages.fetch({ limit: 100 });
    let count = 0;
    for (const msg of messages.values()) {
      const parsed = parseRegistrationMessage(msg);
      if (parsed) {
        await syncToFirebase(parsed);
        count++;
      }
    }
    console.log(`🎉 [Registration History] สแกนสำเร็จ ${count} รายการ`);
  } catch (err) {
    console.warn('⚠️ ไม่สามารถสแกนประวัติการลงทะเบียนได้:', err.message);
  }
}

/**
 * 👥 ดึงรายชื่อสมาชิกในเซิร์ฟเวอร์ Discord ซิงค์ขึ้น Firebase
 */
async function syncDiscordServerMembers() {
  try {
    const guild = client.guilds.cache.first();
    if (!guild) return 0;

    const members = await guild.members.fetch();
    const serverMembersData = {};

    members.forEach(m => {
      if (m.user.bot) return;
      serverMembersData[m.user.id] = {
        discordId: m.user.id,
        username: m.user.username,
        displayName: m.displayName || m.user.username,
        nickname: m.nickname || '',
        roles: m.roles.cache.map(r => r.name).filter(r => r !== '@everyone'),
        joinedTimestamp: m.joinedTimestamp,
        joinedAt: m.joinedAt ? m.joinedAt.toISOString() : null,
        active: true,
        lastSeen: new Date().toISOString()
      };
    });

    const endpoint = `${CONFIG.FIREBASE_DB_URL}/guild_app/discord_server_members.json`;
    await fetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(serverMembersData),
      signal: AbortSignal.timeout(8000)
    });

    const count = Object.keys(serverMembersData).length;
    console.log(`👥 [Discord Sync] ซิงค์รายชื่อสมาชิกสำเร็จ: ${count} คน`);
    await sendHeartbeat(count);
    return count;
  } catch (err) {
    console.warn('⚠️ Error syncing Discord server members:', err.message);
    return 0;
  }
}

// 💓 ส่งสถานะ Heartbeat ขึ้น Firebase
async function sendHeartbeat(memberCount = 50) {
  try {
    const endpoint = `${CONFIG.FIREBASE_DB_URL}/guild_app/bot_status.json`;
    await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        isOnline: true,
        tag: client.user ? client.user.tag : 'Dev#6946',
        memberCount: memberCount || 50,
        lastHeartbeat: new Date().toISOString()
      })
    });
  } catch (e) {
    console.warn('⚠️ [Heartbeat Error]:', e.message);
  }
}

// 📨 ระบบตรวจจับคำขอใหม่จาก Firebase และส่งเข้า Discord ทันที
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
        console.log(`📤 [Alert Sent] ส่งแจ้งเตือนคำขอเข้าห้อง ${targetChannelId} เรียบร้อยแล้ว (ID: ${resJson.id || 'OK'})`);

        // ลบคำขอออกจากคิว
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

// 🟢 เมื่อบอทเชื่อมต่อ Discord สำเร็จ
async function handleBotReady() {
  console.log('====================================================');
  console.log(`🤖 บอทเชื่อมต่อ Discord สำเร็จในชื่อ: ${client.user ? client.user.tag : 'Dev#6946'}`);
  console.log(`🟢 สถานะบอท: ONLINE 24/7 (จุดเขียวทำงาน)`);
  console.log('====================================================');

  try {
    client.user.setPresence({
      activities: [{ name: '🛡️ Dashboard RedDevil 24/7', type: ActivityType.Watching }],
      status: 'online'
    });
  } catch (e) {}

  await sendHeartbeat();
  scanRegistrationHistory().catch(() => {});
  syncDiscordServerMembers().catch(() => {});

  // ซิงค์สมาชิกทุกๆ 60 วินาที
  setInterval(async () => {
    await syncDiscordServerMembers().catch(() => {});
  }, 60000);
}

client.once('ready', handleBotReady);
client.once('clientReady', handleBotReady);

// 🚀 เริ่มต้น Poller ตรวจจับคำขอและ Heartbeat ทันที
setInterval(checkOutboundAlertsCommand, 3000);
setInterval(() => sendHeartbeat().catch(() => {}), 15000);
checkOutboundAlertsCommand().catch(() => {});

// 👥 ดักฟังสมาชิกเข้าใหม่ / อัปเดตชื่อ
client.on('guildMemberAdd', async (member) => {
  console.log(`👋 มีสมาชิกใหม่เข้า Discord: ${member.user.tag}`);
  await syncDiscordServerMembers().catch(() => {});
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  if (oldMember.nickname !== newMember.nickname || oldMember.displayName !== newMember.displayName) {
    console.log(`✏️ สมาชิกเปลี่ยนชื่อใน Discord: ${newMember.displayName}`);
    await syncDiscordServerMembers().catch(() => {});
  }
});

// 📩 ดักฟังข้อความลงทะเบียนแบบ Real-Time
client.on('messageCreate', async (message) => {
  if (message.author?.bot || message.webhookId) return;
  if (CONFIG.REGISTRATION_CHANNEL_ID && message.channelId !== CONFIG.REGISTRATION_CHANNEL_ID) return;

  const parsed = parseRegistrationMessage(message);
  if (parsed) {
    console.log(`📩 พบสมาชิกใหม่ลงทะเบียน: ${parsed.characterName || parsed.email}`);
    await syncToFirebase(parsed);
    await syncDiscordServerMembers().catch(() => {});
    try {
      await message.react('🟢');
    } catch (e) {}
  }
});

// 🚀 เริ่มต้นล็อกอินเข้าสู่ Discord Gateway
if (CONFIG.DISCORD_BOT_TOKEN) {
  console.log('🔄 กำลังเชื่อมต่อ Discord Gateway เพื่อขึ้นสถานะออนไลน์ (จุดเขียว 🟢)...');
  client.login(CONFIG.DISCORD_BOT_TOKEN)
    .then(() => {
      console.log('🔑 Discord Gateway Login Authenticated สำเร็จ!');
    })
    .catch(err => {
      console.warn('⚠️ Discord Login Notice:', err.message || err);
    });
}
