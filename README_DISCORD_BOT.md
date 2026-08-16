# 🤖 คู่มือการใช้งาน Discord Registration Sync Bot

บอทตัวนี้มีหน้าที่ตรวจจับข้อความการลงทะเบียนของสมาชิกใน Discord แล้วนำ **Email**, **ชื่อตัวละคร**, **UID** ส่งไปบันทึกที่ **Firebase Realtime Database** เพื่อให้หน้าเว็บกิลด์แสดงสัญญาณไฟเขียว **`🟢 Active`** หลังชื่อตัวละครแบบ Real-Time อัตโนมัติ

---

## 🚀 ขั้นตอนการติดตั้งและรันบอท (Step-by-Step)

### ขั้นตอนที่ 1: ติดตั้ง Node.js Packages
เปิด Terminal ในโฟลเดอร์นี้ แล้วรันคำสั่ง:
```bash
npm init -y
npm install discord.js
```

---

### ขั้นตอนที่ 2: ตั้งค่า Discord Bot Token & Channel ID
1. ไปที่ [Discord Developer Portal](https://discord.com/developers/applications)
2. สร้าง Application ใหม่ -> ไปที่เมนู **Bot** -> กด **Reset Token** เพื่อ Copy Bot Token
3. **เปิดสิทธิ์ Privileged Gateway Intents:**
   - ✅ **PRESENCE INTENT**
   - ✅ **SERVER MEMBERS INTENT**
   - ✅ **MESSAGE CONTENT INTENT** *(สำคัญมาก ต้องเปิด)*
4. เชิญบอทเข้า Discord Server ของคุณ (ให้สิทธิ์ Read Messages / View Channels / Send Messages)
5. เปิดไฟล์ `discord_sync_bot.js` แล้วนำ Token และ ID ห้องลงทะเบียนมาใส่:
   ```javascript
   const CONFIG = {
     DISCORD_BOT_TOKEN: 'วาง_BOT_TOKEN_ที่ได้จาก_Discord_Developer_ที่นี่',
     REGISTRATION_CHANNEL_ID: 'วาง_CHANNEL_ID_ห้องลงทะเบียน_ที่นี่',
     FIREBASE_DB_URL: 'https://reddevil-f229e-default-rtdb.asia-southeast1.firebasedatabase.app'
   };
   ```

---

### ขั้นตอนที่ 3: สั่งรันบอท
```bash
node discord_sync_bot.js
```

---

## 🌟 การทำงานที่เกิดขึ้น:
1. เมื่อบอทเริ่มทำงาน จะทำการ **สแกนประวัติการลงทะเบียนย้อนหลัง 100 ข้อความล่าสุด** ในห้องนั้นให้อัตโนมัติ
2. เมื่อมีสมาชิกใหม่ส่ง Embed การลงทะเบียนเข้ามา บอทจะตรวจจับและส่งขึ้น Firebase ทันที พร้อมใส่ Reaction `🟢` ในดิสคอร์ด
3. หน้าเว็บ [index.html](index.html) จะตรวจพบข้อมูล และแสดงป้าย **`🟢 Active`** หลังชื่อตัวละครนั้นบนตารางแบบ Real-Time สดๆ ทันทีครับ!
