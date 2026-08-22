# ตั้งค่าซิงก์เช็คชื่อกับ Google Sheets

1. สร้างหรือเปิด Google Sheet แล้วนำ Spreadsheet ID ไปใส่ใน `google-apps-script.gs`
2. เปิด Extensions → Apps Script แล้ววางโค้ดจากไฟล์ `google-apps-script.gs`
3. กด Deploy → New deployment → Web app
   - Execute as: Me
   - Who has access: Anyone
4. คัดลอก URL ที่ลงท้ายด้วย `/exec`
5. คัดลอก `google-sheets-config.example.js` เป็น `google-sheets-config.js` แล้วใส่ URL และ token ที่สร้างใหม่:

```js
window.GOOGLE_SHEETS_SYNC_URL = 'วาง-URL-ที่ลงท้ายด้วย-/exec-ตรงนี้';
window.GOOGLE_SHEETS_SYNC_TOKEN = 'วาง-token-ส่วนตัวตรงนี้';
```

ห้ามนำ `google-sheets-config.js` หรือ token จริงขึ้น GitHub และควร rotate token เดิมที่เคยฝังอยู่ใน source code แล้ว

เมื่อเปิดเว็บครั้งแรก ระบบจะสร้างแท็บ `Week 1` ถึง `Week 4` อัตโนมัติ โดยคอลัมน์กิจกรรมจะเป็น checkbox ทุกการแก้ไขจากหน้าเว็บหรือในชีตจะถูกตรวจสอบและซิงก์ภายในประมาณ 3 วินาที

หากชีตมีข้อมูลอยู่ก่อน แนะนำให้สำรองข้อมูลก่อนกดใช้งานครั้งแรก เพราะการส่งข้อมูลจากเว็บครั้งแรกจะจัดรูปแบบแท็บทั้ง 4 ให้ตรงกับข้อมูลสมาชิกในเว็บ
