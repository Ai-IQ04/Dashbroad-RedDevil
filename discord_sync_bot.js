/**
 * ==============================================================================
 * 🤖 Discord Registration Sync Bot for BlueDevil & RedDevil Guild Dashboard
 * ==============================================================================
 * หน้าที่ของบอท:
 * 1. ตรวจจับและอ่านข้อความการลงทะเบียนของสมาชิกใน Discord Channel
 * 2. สกัดข้อมูล (Email, CharacterName, Guild, UID, Wallet, Discord ID)
 * 3. ส่งข้อมูลไปบันทึกที่ Firebase Realtime Database ของเว็บกิลด์แบบ Real-Time
 * 4. หน้าเว็บจะแสดงสัญญาณไฟเขียว "🟢 Active" หลังชื่อตัวละครทันที!
 * ==============================================================================
 */

const { Client, GatewayIntentBits, Partials } = require('discord.js');

// ⚙️ 1. ตั้งค่าบอท Discord และ Firebase ของคุณ
const CONFIG = {
  // นำ Bot Token จาก https://discord.com/developers/applications มาใส่ที่นี่
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN || 'ใส่_BOT_TOKEN_ที่นี่',

  // ID ของห้อง Discord Channel ที่สมาชิกลงทะเบียน (คลิกขวาที่ห้องแล้วกด Copy Channel ID)
  REGISTRATION_CHANNEL_ID: process.env.REGISTRATION_CHANNEL_ID || 'ใส่_CHANNEL_ID_ห้องลงทะเบียน_ที่นี่',

  // URL ฐานข้อมูล Firebase Realtime Database ของระบบกิลด์
  FIREBASE_DB_URL: 'https://reddevil-f229e-default-rtdb.asia-southeast1.firebasedatabase.app'
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

/**
 * 📦 ฟังก์ชันส่งข้อมูลขึ้น Firebase Realtime Database
 */
async function syncToFirebase(verifiedData) {
  try {
    // ใช้ sanitized key (ตัดเครื่องหมายพิเศษออกเพื่อใช้เป็น Key ใน Firebase)
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
      console.log(`✅ [Firebase Sync สำเร็จ] ตัวละคร: ${verifiedData.characterName} | อีเมล: ${verifiedData.email}`);
    } else {
      console.error(`❌ [Firebase Sync ผิดพลาด] Status: ${response.status}`);
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

  // ดึงข้อความจาก Embed (ถ้ามี)
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
  // อีเมล์ / Email: tammat00@gmail.com
  const emailMatch = content.match(/(?:อีเมล์|อีเมล|Email|E-mail)[:\s\u200B\n└L\-\|]*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i)
    || content.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);

  // ชื่อตัวละคร / CharacterName: ไข่วาฬ
  const charNameMatch = content.match(/(?:ชื่อตัวละคร|CharacterName|Character Name|Name)[:\s\u200B\n└L\-\|]+([^\n\r]+)/i);

  // กิลด์ / Guild: RedDevil
  const guildMatch = content.match(/(?:กิลด์|Guild)[:\s\u200B\n└L\-\|]+([^\n\r]+)/i);

  // UID สมาชิก / InGameMemberNo: 20024644351
  const uidMatch = content.match(/(?:UID สมาชิก|UID|InGameMemberNo|MemberNo)[:\s\u200B\n└L\-\|]+([0-9]+)/i);

  // WalletUSDT: 0xe2Cb...
  const walletMatch = content.match(/(?:WalletUSDT|Wallet|กระเป๋า)[:\s\u200B\n└L\-\|]+(0x[a-fA-F0-9]{40})/i);

  // ดึงข้อมูล Discord User
  const discordUser = message.author;

  const email = emailMatch ? emailMatch[1].trim() : '';
  const characterName = charNameMatch ? charNameMatch[1].trim().replace(/^[`*_\s]+|[`*_\s]+$/g, '') : '';
  const guild = guildMatch ? guildMatch[1].trim().replace(/^[`*_\s]+|[`*_\s]+$/g, '') : '';
  const uid = uidMatch ? uidMatch[1].trim() : '';
  const wallet = walletMatch ? walletMatch[1].trim() : '';

  if (!email && !characterName) {
    return null; // ไม่ใช่ข้อความลงทะเบียน
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

// 🟢 3. เมื่อบอทออนไลน์
client.once('ready', async () => {
  console.log('====================================================');
  console.log(`🤖 บอทเชื่อมต่อ Discord สำเร็จในชื่อ: ${client.user.tag}`);
  console.log(`🔥 ซิงค์ฐานข้อมูลไปยัง: ${CONFIG.FIREBASE_DB_URL}`);
  console.log('====================================================');

  // สแกนข้อความย้อนหลังในห้องลงทะเบียน (ถ้ามี ID ห้อง)
  if (CONFIG.REGISTRATION_CHANNEL_ID && CONFIG.REGISTRATION_CHANNEL_ID !== 'ใส่_CHANNEL_ID_ห้องลงทะเบียน_ที่นี่') {
    try {
      const channel = await client.channels.fetch(CONFIG.REGISTRATION_CHANNEL_ID);
      if (channel && channel.isTextBased()) {
        console.log(`📥 กำลังสแกนประวัติการลงทะเบียนในห้อง: #${channel.name}...`);
        const messages = await channel.messages.fetch({ limit: 100 });
        let count = 0;
        for (const msg of messages.values()) {
          const parsed = parseRegistrationMessage(msg);
          if (parsed) {
            await syncToFirebase(parsed);
            count++;
          }
        }
        console.log(`🎉 สแกนและซิงค์ข้อมูลย้อนหลังสำเร็จทั้งหมด ${count} รายการ!`);
      }
    } catch (err) {
      console.warn('⚠️ ไม่สามารถสแกนข้อความย้อนหลังได้:', err.message);
    }
  }
});

// 📩 4. เมื่อมีข้อความใหม่เข้ามาในห้อง
client.on('messageCreate', async (message) => {
  // ตรวจสอบเฉพาะห้องลงทะเบียน (หากมีการระบุไว้)
  if (CONFIG.REGISTRATION_CHANNEL_ID && CONFIG.REGISTRATION_CHANNEL_ID !== 'ใส่_CHANNEL_ID_ห้องลงทะเบียน_ที่นี่') {
    if (message.channelId !== CONFIG.REGISTRATION_CHANNEL_ID) return;
  }

  const parsed = parseRegistrationMessage(message);
  if (parsed) {
    console.log(`📩 พบการลงทะเบียนใหม่จาก ${parsed.characterName || parsed.email}`);
    await syncToFirebase(parsed);
    try {
      await message.react('🟢'); // ใส่ Reaction ไฟเขียวในดิสคอร์ดว่าระบบตรวจพบแล้ว
    } catch (e) {}
  }
});

// 🚀 เริ่มต้นการทำงาน
if (!CONFIG.DISCORD_BOT_TOKEN || CONFIG.DISCORD_BOT_TOKEN === 'ใส่_BOT_TOKEN_ที่นี่') {
  console.warn('⚠️ คำเตือน: กรุณานำ Bot Token จาก Discord Developer Portal มาใส่ในตัวแปร DISCORD_BOT_TOKEN');
} else {
  client.login(CONFIG.DISCORD_BOT_TOKEN);
}
