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

const { Client, GatewayIntentBits, Partials, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

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

// ⚙️ โหลดการตั้งค่าจาก bot_config.json และ environment variables
let CONFIG = {
  DISCORD_BOT_TOKEN: '',
  REGISTRATION_CHANNEL_ID: '',
  BOSS_ALERT_CHANNEL_ID: '1538638951089180742',
  MENTION_TAG: '@Member',
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
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN || CONFIG.DISCORD_BOT_TOKEN,
  REGISTRATION_CHANNEL_ID: process.env.REGISTRATION_CHANNEL_ID || CONFIG.REGISTRATION_CHANNEL_ID,
  BOSS_ALERT_CHANNEL_ID: process.env.BOSS_ALERT_CHANNEL_ID || CONFIG.BOSS_ALERT_CHANNEL_ID,
  ANNOUNCEMENT_CHANNEL_ID: process.env.ANNOUNCEMENT_CHANNEL_ID || CONFIG.ANNOUNCEMENT_CHANNEL_ID,
  MENTION_TAG: process.env.MENTION_TAG || CONFIG.MENTION_TAG,
  FIREBASE_DB_URL: process.env.FIREBASE_DB_URL || CONFIG.FIREBASE_DB_URL
};

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

/**
 * 👥 ฟังก์ชันดึงรายชื่อสมาชิกทุกคนใน Discord Server (Guild Members) ซิงค์ขึ้น Firebase
 */
async function syncDiscordServerMembers() {
  try {
    const guild = client.guilds.cache.first();
    if (!guild) return;

    const members = await guild.members.fetch();
    const serverMembersData = {};

    members.forEach(m => {
      if (m.user.bot) return; // ไม่รวมบอท
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
      body: JSON.stringify(serverMembersData)
    });

    const count = Object.keys(serverMembersData).length;
    console.log(`👥 [Discord Sync] ซิงค์รายชื่อสมาชิกในเซิร์ฟเวอร์ Discord สำเร็จ: ${count} คน`);
    await sendHeartbeat(count);
  } catch (err) {
    console.error('❌ Error syncing Discord server members:', err.message);
  }
}

// 💓 ส่งสถานะ Heartbeat ขึ้น Firebase
async function sendHeartbeat(memberCount = 0) {
  try {
    const endpoint = `${CONFIG.FIREBASE_DB_URL}/guild_app/bot_status.json`;
    await fetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isOnline: true,
        tag: client.user ? client.user.tag : 'RedDevil Bot',
        memberCount: memberCount,
        lastHeartbeat: new Date().toISOString()
      })
    });
  } catch (e) {
    console.warn('⚠️ [Heartbeat] ส่งสถานะขึ้น Firebase ไม่สำเร็จ:', e.message);
  }
}

// ⚡ ดักฟังคำสั่งจากหน้าเว็บ Dashboard (ซิงค์ด่วน & ส่งประกาศจากน้องเดวิล)
function listenForDashboardCommands() {
  let lastSeenSyncTrigger = Date.now();
  let lastSeenAnnouncementId = '';

  setInterval(async () => {
    try {
      // 1. ซิงค์ด่วน
      const syncEndpoint = `${CONFIG.FIREBASE_DB_URL}/guild_app/bot_commands/sync_trigger.json`;
      const syncRes = await fetch(syncEndpoint);
      if (syncRes.ok) {
        const trigger = await syncRes.json();
        if (trigger && Number(trigger) > lastSeenSyncTrigger) {
          lastSeenSyncTrigger = Number(trigger);
          console.log('⚡ [Dashboard Trigger] ได้รับคำสั่งกดซิงค์ข้อมูลจากหน้าเว็บ...');
          await syncDiscordServerMembers();
          await scanRegistrationHistory();
        }
      }

      // 2. ส่งประกาศจากน้องเดวิล (Nong Devil Announcement)
      const announceEndpoint = `${CONFIG.FIREBASE_DB_URL}/guild_app/bot_commands/send_announcement.json`;
      const announceRes = await fetch(announceEndpoint);
      if (announceRes.ok) {
        const item = await announceRes.json();
        if (item && item.id && item.id !== lastSeenAnnouncementId && (Date.now() - (item.timestamp || 0) < 60000)) {
          lastSeenAnnouncementId = item.id;
          const channelId = item.channelId || CONFIG.ANNOUNCEMENT_CHANNEL_ID || '1539252263132860516';
          const mentionTag = item.mentionTag || CONFIG.MENTION_TAG || '<@&1508495658162851970>';

          const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId).catch(err => {
            console.warn(`⚠️ [Announcement Error] ดึงห้อง Discord ID ${channelId} ไม่สำเร็จ:`, err.message);
            return null;
          });
          if (channel) {
            const embed = {
              title: item.title || '📢 [RedDevil] ประกาศจากกิลด์',
              description: item.content || '',
              color: 0xDC2626,
              footer: { text: '🛡️ RedDevil Guild Announcement System • น้องเดวิล AI' },
              timestamp: new Date().toISOString()
            };
            if (item.author) {
              embed.author = { name: `ประกาศโดย Admin: ${item.author}` };
            }

            await channel.send({
              content: mentionTag,
              embeds: [embed]
            });
            console.log(`📢 [Announcement Sent] ส่งประกาศเข้าห้อง ${channel.name || channelId} สำเร็จ (Mention: ${mentionTag})`);
          } else {
            console.warn(`⚠️ [Announcement Error] ไม่พบห้อง Discord ID: ${channelId}`);
          }
        }
      }
    } catch (e) {
      console.warn('⚠️ [Dashboard Commands] อ่านหรือประมวลผลคำสั่งจาก Firebase ไม่สำเร็จ:', e.message);
    }
  }, 3000);
}

// 🟢 เมื่อบอทออนไลน์สำเร็จ
client.once('ready', async () => {
  console.log('====================================================');
  console.log(`🤖 บอทเชื่อมต่อ Discord สำเร็จในชื่อ: ${client.user.tag}`);
  console.log(`🔥 ฐานข้อมูล Firebase: ${CONFIG.FIREBASE_DB_URL}`);
  console.log(`📋 สแกนห้องลงทะเบียน: ${CONFIG.REGISTRATION_CHANNEL_ID || 'ทั้งหมด'}`);
  console.log('====================================================');

  await scanRegistrationHistory();
  await syncDiscordServerMembers();
  listenForDashboardCommands();

  // ซิงค์รายชื่อสมาชิก Discord และส่ง Heartbeat ทุกๆ 30 วินาที
  setInterval(async () => {
    await syncDiscordServerMembers();
  }, 30000);
});

// 👥 ดักฟังสมาชิกเข้าใหม่ / อัปเดตชื่อใน Discord
client.on('guildMemberAdd', async (member) => {
  console.log(`👋 มีสมาชิกใหม่เข้า Discord: ${member.user.tag}`);
  await syncDiscordServerMembers();
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  if (oldMember.nickname !== newMember.nickname || oldMember.displayName !== newMember.displayName) {
    console.log(`✏️ สมาชิกเปลี่ยนชื่อใน Discord: ${newMember.displayName}`);
    await syncDiscordServerMembers();
  }
});

// 📩 ดักฟังข้อความใหม่แบบ Real-Time
client.on('messageCreate', async (message) => {
  if (CONFIG.REGISTRATION_CHANNEL_ID && message.channelId !== CONFIG.REGISTRATION_CHANNEL_ID) return;

  const parsed = parseRegistrationMessage(message);
  if (parsed) {
    console.log(`📩 พบสมาชิกใหม่ลงทะเบียน: ${parsed.characterName || parsed.email}`);
    await syncToFirebase(parsed);
    await syncDiscordServerMembers();
    try {
      await message.react('🟢');
    } catch (e) {
      console.warn(`⚠️ ไม่สามารถ react ข้อความลงทะเบียน ${message.id} ได้:`, e.message);
    }
  }
});

// 🚀 เริ่มต้นล็อกอิน
if (CONFIG.DISCORD_BOT_TOKEN && !CONFIG.DISCORD_BOT_TOKEN.startsWith('วาง_')) {
  client.login(CONFIG.DISCORD_BOT_TOKEN);
} else {
  console.error('⚠️ กรุณาตั้งค่า DISCORD_BOT_TOKEN ในไฟล์ .env, environment variable หรือ bot_config.json ให้ถูกต้อง');
}
