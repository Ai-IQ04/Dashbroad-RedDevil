/**
 * ==============================================================================
 * 🤖 Discord Registration Sync Bot for BlueDevil & RedDevil Guild Dashboard
 * ==============================================================================
 * หน้าที่ของบอท:
 * 1. สแกนประวัติการลงทะเบียนของสมาชิกทั้งหมดในห้อง Discord ที่กำหนด
 * 2. ดักฟังการลงทะเบียนใหม่แบบ Real-Time
 * 3. ส่งข้อมูล (Email, CharacterName, Guild, UID, Wallet) ขึ้น Firebase Database
 * 4. หน้าเว็บกิลด์จะแสดงไฟสัญญาณ "🟢 Active" หลังชื่อตัวละครทันที!
 * ==============================================================================
 */

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');

// ⚙️ โหลดการตั้งค่าจาก bot_config.json
let CONFIG = {
  DISCORD_BOT_TOKEN: '',
  REGISTRATION_CHANNEL_ID: '',
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

  // ฟังก์ชันล้างอักขระกิ่งไม้ด้านหน้าและ markdown
  const cleanLine = (str) => {
    if (!str) return '';
    return str
      .replace(/^[\s\u2500-\u257F\u200B└L\-\|:`*]+/, '')
      .replace(/[`*]/g, '')
      .trim();
  };

  const extractVal = (keywords) => {
    for (const kw of keywords) {
      const reg = new RegExp('(?:' + kw + ')[^\\n\\r]*[\\n\\r]+([^\\n\\r]+)', 'i');
      const m = content.match(reg);
      if (m && m[1]) {
        const cleaned = cleanLine(m[1]);
        if (cleaned && !keywords.some(k => cleaned.toLowerCase().includes(k.toLowerCase()))) {
          return cleaned;
        }
      }
      const sameLineReg = new RegExp('(?:' + kw + ')[:\\s*]+([^\\n\\r]+)', 'i');
      const m2 = content.match(sameLineReg);
      if (m2 && m2[1]) {
        const cleaned2 = cleanLine(m2[1]);
        if (cleaned2 && !keywords.some(k => cleaned2.toLowerCase().includes(k.toLowerCase()))) {
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
  console.log('====================================================');

  await scanRegistrationHistory();
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
