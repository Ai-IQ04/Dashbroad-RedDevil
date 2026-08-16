/**
 * ==============================================================================
 * 🤖 Discord Registration Sync Bot for BlueDevil & RedDevil Guild Dashboard
 * ==============================================================================
 * ฟังก์ชันหลัก:
 * 1. ตรวจจับและอ่านข้อความการลงทะเบียนใน Discord Channel แบบ Real-Time
 * 2. รองรับการสั่งซิงค์ย้อนหลัง 1-Click ผ่านปุ่มบนหน้าเว็บกิลด์
 * 3. มี Web Server ในตัว สำหรับ UptimeRobot / Glitch / Render ป้องกันบอทหลับ
 * ==============================================================================
 */

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const http = require('http');
const fs = require('fs');
const path = require('path');

// โหลดการตั้งค่าจาก bot_config.json หรือ Environment Variables
let localConfig = {};
try {
  const configPath = path.join(__dirname, 'bot_config.json');
  if (fs.existsSync(configPath)) {
    localConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
} catch (e) { }

// ⚙️ 1. ตั้งค่าบอท Discord และ Firebase ของคุณ
const CONFIG = {
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN || localConfig.DISCORD_BOT_TOKEN || 'PUT_BOT_TOKEN_IN_BOT_CONFIG_JSON',
  REGISTRATION_CHANNEL_ID: process.env.REGISTRATION_CHANNEL_ID || localConfig.REGISTRATION_CHANNEL_ID || 'PUT_CHANNEL_ID_HERE',
  FIREBASE_DB_URL: process.env.FIREBASE_DB_URL || localConfig.FIREBASE_DB_URL || 'https://reddevil-f229e-default-rtdb.asia-southeast1.firebasedatabase.app',
  PORT: process.env.PORT || localConfig.PORT || 3000
};

// 🤖 2. สร้าง Client บอท
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Message, Partials.Channel]
});

let isScanning = false;
let lastProcessedCommandTime = 0;

/**
 * 📦 ฟังก์ชันส่งข้อมูลขึ้น Firebase Realtime Database
 */
async function syncToFirebase(verifiedData) {
  try {
    const safeKey = (verifiedData.email || verifiedData.characterName || verifiedData.discordId)
      .replace(/[.#$[\]]/g, '_')
      .toLowerCase();

    const endpoint = `${CONFIG.FIREBASE_DB_URL}/guild_app/discord_verified/${safeKey}.json`;

    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(verifiedData)
    });

    if (response.ok) {
      console.log(`✅ [Sync สำเร็จ] ตัวละคร: ${verifiedData.characterName} | อีเมล: ${verifiedData.email}`);
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

  // Pattern การดึงข้อมูล
  const emailMatch = content.match(/(?:อีเมล์|อีเมล|Email|E-mail)[:\s\u200B\n└L\-\|]*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i)
    || content.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);

  const charNameMatch = content.match(/(?:ชื่อตัวละคร|CharacterName|Character Name|Name)[:\s\u200B\n└L\-\|]+([^\n\r]+)/i);
  const guildMatch = content.match(/(?:กิลด์|Guild)[:\s\u200B\n└L\-\|]+([^\n\r]+)/i);
  const uidMatch = content.match(/(?:UID สมาชิก|UID|InGameMemberNo|MemberNo)[:\s\u200B\n└L\-\|]+([0-9]+)/i);
  const walletMatch = content.match(/(?:WalletUSDT|Wallet|กระเป๋า)[:\s\u200B\n└L\-\|]+(0x[a-fA-F0-9]{40})/i);

  const discordUser = message.author;

  const email = emailMatch ? emailMatch[1].trim() : '';
  const characterName = charNameMatch ? charNameMatch[1].trim().replace(/^[`*_\s]+|[`*_\s]+$/g, '') : '';
  const guild = guildMatch ? guildMatch[1].trim().replace(/^[`*_\s]+|[`*_\s]+$/g, '') : '';
  const uid = uidMatch ? uidMatch[1].trim() : '';
  const wallet = walletMatch ? walletMatch[1].trim() : '';

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
 * 📥 ฟังก์ชันสแกนประวัติข้อความในห้องลงทะเบียน
 */
async function scanRegistrationChannel(requestedBy = 'System Startup') {
  if (isScanning) {
    console.log('⏳ กำลังสแกนอยู่แล้ว โปรดรอสักครู่...');
    return { success: false, message: 'Already scanning' };
  }

  isScanning = true;
  console.log(`\n====================================================`);
  console.log(`📥 เริ่มการสแกนห้องลงทะเบียน (สั่งโดย: ${requestedBy})...`);

  let syncedCount = 0;
  try {
    const channel = await client.channels.fetch(CONFIG.REGISTRATION_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) {
      throw new Error('ไม่พบ Text Channel หรือบอทไม่มีสิทธิ์เข้าถึง');
    }

    const messages = await channel.messages.fetch({ limit: 100 });
    for (const msg of messages.values()) {
      const parsed = parseRegistrationMessage(msg);
      if (parsed) {
        await syncToFirebase(parsed);
        syncedCount++;
      }
    }

    console.log(`🎉 สแกนสำเร็จ! บันทึกข้อมูลขึ้น Firebase ทั้งหมด ${syncedCount} รายการ`);

    // บันทึกผลลัพธ์การซิงค์กลับไปที่ Firebase เพื่อแจ้งหน้าเว็บ
    await fetch(`${CONFIG.FIREBASE_DB_URL}/guild_app/bot_status/sync_result.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'success',
        syncedCount: syncedCount,
        timestamp: Date.now(),
        requestedBy: requestedBy
      })
    });

    isScanning = false;
    return { success: true, count: syncedCount };
  } catch (err) {
    console.error('❌ ไม่สามารถสแกนห้องลงทะเบียนได้:', err.message);
    isScanning = false;
    return { success: false, error: err.message };
  }
}

/**
 * 👂 ดักฟังคำสั่งซิงค์ที่ส่งมาจากหน้าเว็บกิลด์ (Firebase Trigger)
 */
async function pollWebSyncCommands() {
  try {
    const res = await fetch(`${CONFIG.FIREBASE_DB_URL}/guild_app/bot_commands/sync.json`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.requestedAt && data.requestedAt > lastProcessedCommandTime) {
        lastProcessedCommandTime = data.requestedAt;
        console.log(`⚡ ตรวจพบคำสั่งซิงค์จากหน้าเว็บ โดย: ${data.requestedBy || 'Admin'}`);
        await scanRegistrationChannel(data.requestedBy || 'Web Admin');
      }
    }
  } catch (e) { }
}

// 🟢 3. เมื่อบอทออนไลน์
client.once('ready', async () => {
  console.log('====================================================');
  console.log(`🤖 บอท Discord ออนไลน์แล้วในชื่อ: ${client.user.tag}`);
  console.log(`🔥 เชื่อมต่อ Firebase: ${CONFIG.FIREBASE_DB_URL}`);
  console.log(`🌐 Webhook Server กำลังรันที่พอร์ต: ${CONFIG.PORT}`);
  console.log('====================================================');

  // สแกนข้อความรอบแรกเมื่อเริ่มทำงาน
  await scanRegistrationChannel('Bot Started');

  // ตรวจจับคำสั่งจากหน้าเว็บทุกๆ 3 วินาที
  setInterval(pollWebSyncCommands, 3000);
});

// 📩 4. ดักฟังข้อความใหม่แบบ Real-Time
client.on('messageCreate', async (message) => {
  if (CONFIG.REGISTRATION_CHANNEL_ID && message.channelId !== CONFIG.REGISTRATION_CHANNEL_ID) return;

  const parsed = parseRegistrationMessage(message);
  if (parsed) {
    console.log(`📩 พบการลงทะเบียนใหม่จาก ${parsed.characterName || parsed.email}`);
    await syncToFirebase(parsed);
    try {
      await message.react('🟢');
    } catch (e) { }
  }
});

// 🌐 5. Web Server สำหรับ UptimeRobot / Glitch / Render
const server = http.createServer(async (req, res) => {
  if (req.url === '/sync') {
    const result = await scanRegistrationChannel('HTTP Trigger');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(result));
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'online',
    bot: client.user ? client.user.tag : 'Connecting...',
    uptime: process.uptime(),
    timestamp: Date.now()
  }));
});

server.listen(CONFIG.PORT, () => {
  console.log(`🚀 Web Server พร้อมรับ Ping ที่พอร์ต ${CONFIG.PORT}`);
});

// 🚀 เริ่มต้นล็อกอิน
if (CONFIG.DISCORD_BOT_TOKEN && !CONFIG.DISCORD_BOT_TOKEN.startsWith('PUT_')) {
  client.login(CONFIG.DISCORD_BOT_TOKEN);
} else {
  console.warn('⚠️ คำเตือน: กรุณานำ Bot Token มาใส่ในไฟล์ bot_config.json');
}
