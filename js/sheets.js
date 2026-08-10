/**
 * โมดูลจัดการการเชื่อมต่อ Google Sheets และฐานข้อมูลพัสดุ
 * รองรับการดึงข้อมูลจาก Google Sheets (CSV/gviz/Apps Script), ไฟล์ Excel/CSV และ LocalStorage
 */

const SheetsManager = {
  // URL เริ่มต้นของ Google Sheets (แท็บ gid=1247142924 ตามที่ระบุ)
  DEFAULT_SHEET_URL: "https://docs.google.com/spreadsheets/d/1l_ZJpnBOQcjxIIRI9HqKlFsUJ1ddq-ZAqSeHQB7RnXE/edit?gid=1247142924#gid=1247142924",
  STORAGE_KEY_MATERIALS: "pea_materials_db_v2_114",
  STORAGE_KEY_SETTINGS: "pea_requisition_settings_v1",
  STORAGE_KEY_HISTORY: "pea_requisition_history_v1",

  // ดึงรายการพัสดุปัจจุบัน (จาก LocalStorage หรือถ้าไม่มีให้ใช้ค่าเริ่มต้น 114 รายการ)
  getMaterials() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY_MATERIALS);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn("Could not read materials from LocalStorage", e);
    }
    // ใช้ค่าเริ่มต้น 114 รายการจากต้นฉบับ
    this.saveMaterials(DEFAULT_PEA_MATERIALS);
    return DEFAULT_PEA_MATERIALS;
  },

  // บันทึกรายการพัสดุลง LocalStorage
  saveMaterials(materials) {
    try {
      localStorage.setItem(this.STORAGE_KEY_MATERIALS, JSON.stringify(materials));
    } catch (e) {
      console.error("Failed to save materials to LocalStorage", e);
    }
  },

  // แปลง URL Google Sheets ให้อยู่ในรูป Export CSV URL
  formatGoogleSheetCsvUrl(url) {
    if (!url) return "";
    let sheetId = "";
    let gid = "1247142924";

    const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (idMatch) {
      sheetId = idMatch[1];
    }

    const gidMatch = url.match(/[#&?]gid=([0-9]+)/);
    if (gidMatch) {
      gid = gidMatch[1];
    }

    if (sheetId) {
      return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
    }
    return url;
  },

  // ดึงข้อมูลจาก Google Sheets
  async fetchFromGoogleSheets(url) {
    const targetUrl = url || this.DEFAULT_SHEET_URL;
    const csvUrl = this.formatGoogleSheetCsvUrl(targetUrl);

    // ลองดึงตรงๆ หรือผ่าน gviz
    const fetchUrls = [
      csvUrl,
      csvUrl.replace('/export?format=csv&', '/gviz/tq?tqx=out:csv&'),
      // Fallback ผ่าน CORS proxy สำหรับ Google Sheet สาธารณะ
      `https://api.allorigins.win/raw?url=${encodeURIComponent(csvUrl)}`
    ];

    for (const u of fetchUrls) {
      try {
        const response = await fetch(u, { cache: "no-store" });
        if (response.ok) {
          const text = await response.text();
          // ตรวจสอบว่าได้เป็นข้อความ CSV จริง ไม่ใช่หน้า Login ของ Google
          if (text && !text.includes("<!DOCTYPE html") && !text.includes("accounts.google.com")) {
            const parsedItems = this.parseCsvToMaterials(text);
            if (parsedItems.length > 0) {
              this.saveMaterials(parsedItems);
              return { success: true, count: parsedItems.length, data: parsedItems, source: "Google Sheets" };
            }
          }
        }
      } catch (err) {
        console.warn("Fetch attempt failed:", u, err);
      }
    }

    throw new Error("ไม่สามารถเชื่อมต่อ Google Sheet ได้ กรุณาตรวจสอบว่าได้ตั้งค่าสิทธิ์แชร์เป็น 'ทุกคนที่มีลิงก์มีสิทธิ์ดู' หรือนำเข้าไฟล์ Excel/CSV แทน");
  },

  // แปลงข้อความ CSV เป็น Object Array ของพัสดุ
  parseCsvToMaterials(csvText) {
    const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length === 0) return [];

    const result = [];
    let headerIndex = { no: -1, code: -1, name: -1, unit: -1, quota: -1, category: -1 };

    // ฟังก์ชันแยก Column ใน CSV แบบรองรับ Quoted Text
    const parseCsvLine = (line) => {
      const row = [];
      let inQuotes = false;
      let cur = "";
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"' || char === "'") {
          if (inQuotes && line[i + 1] === char) {
            cur += char;
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          row.push(cur.trim());
          cur = "";
        } else {
          cur += char;
        }
      }
      row.push(cur.trim());
      return row;
    };

    // หา Header แถวแรกที่มีหัวคอลัมน์
    let startRow = 0;
    for (let r = 0; r < Math.min(5, lines.length); r++) {
      const cols = parseCsvLine(lines[r]).map(c => c.toLowerCase());
      for (let c = 0; c < cols.length; c++) {
        const col = cols[c];
        if (col.includes("ลำดับ") || col.includes("no")) headerIndex.no = c;
        if (col.includes("รหัส") || col.includes("code") || col.includes("material")) headerIndex.code = c;
        if (col.includes("รายการ") || col.includes("ชื่อ") || col.includes("description") || col.includes("name")) headerIndex.name = c;
        if (col.includes("หน่วย") || col.includes("unit")) headerIndex.unit = c;
        if (col.includes("เกณฑ์") || col.includes("quota") || col.includes("มาตรฐาน")) headerIndex.quota = c;
        if (col.includes("หมวด") || col.includes("category") || col.includes("ประเภท")) headerIndex.category = c;
      }
      if (headerIndex.name !== -1 || headerIndex.code !== -1) {
        startRow = r + 1;
        break;
      }
    }

    // ถ้าไม่เจอ Header ให้เดาตามตำแหน่งมาตรฐาน
    if (headerIndex.name === -1 && headerIndex.code === -1) {
      headerIndex = { no: 0, code: 1, name: 2, unit: 3, quota: 4, category: 5 };
      startRow = 0;
    }

    for (let i = startRow; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      if (cols.length < 2) continue;

      const no = (headerIndex.no !== -1 && cols[headerIndex.no]) ? cols[headerIndex.no].replace(/^["']|["']$/g, '').trim() : String(i);
      const code = (headerIndex.code !== -1 && cols[headerIndex.code]) ? cols[headerIndex.code].replace(/^["']|["']$/g, '').trim() : "";
      const name = (headerIndex.name !== -1 && cols[headerIndex.name]) ? cols[headerIndex.name].replace(/^["']|["']$/g, '').trim() : "";
      const unit = (headerIndex.unit !== -1 && cols[headerIndex.unit]) ? cols[headerIndex.unit].replace(/^["']|["']$/g, '').trim() : "ชิ้น";
      const quota = (headerIndex.quota !== -1 && cols[headerIndex.quota]) ? cols[headerIndex.quota].replace(/^["']|["']$/g, '').trim() : "";
      const category = (headerIndex.category !== -1 && cols[headerIndex.category]) ? cols[headerIndex.category].replace(/^["']|["']$/g, '').trim() : "อุปกรณ์ระบบไฟฟ้าและบำรุงรักษา";

      if (name || code) {
        result.push({
          no: no || String(result.length + 1),
          code: code || "-",
          name: name || code,
          unit: unit || "ชิ้น",
          standardQuota: quota,
          category: category || "อุปกรณ์ระบบไฟฟ้าและบำรุงรักษา"
        });
      }
    }

    return result;
  },

  // นำเข้าข้อมูลจากไฟล์ CSV/Excel (ผ่าน File Reader)
  parseUploadedFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target.result;
          const items = this.parseCsvToMaterials(content);
          if (items.length > 0) {
            this.saveMaterials(items);
            resolve({ success: true, count: items.length, data: items });
          } else {
            reject(new Error("ไม่พบข้อมูลพัสดุในไฟล์ กรุณาตรวจสอบรูปแบบไฟล์ CSV"));
          }
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error("เกิดข้อผิดพลาดในการอ่านไฟล์"));
      reader.readAsText(file, "UTF-8");
    });
  },

  // คืนค่ารายการพัสดุเป็นค่าเริ่มต้น PEA (114 รายการ)
  resetToDefault() {
    this.saveMaterials(DEFAULT_PEA_MATERIALS);
    return DEFAULT_PEA_MATERIALS;
  },

  // ดึงค่าการตั้งค่าแบบฟอร์ม (หัวเอกสารและผู้ลงนาม)
  getSettings() {
    const defaultSettings = {
      issueNo: "1",
      destinationWarehouse: "คลังพัสดุจ่าย",
      region: "กฟฉ.1",
      department: "ปฏิบัติการระบบไฟฟ้าและบำรุงรักษา (2601) (คลังสำรองแก้ไฟ) (2601)",
      electricityOffice: "กฟส.ขอนแก่น 2",
      docNoPrefix: "",
      docNo: "",
      deliveryNo: "",
      sendToWarehouse: "",
      purpose: "บริการแก้กระแสไฟฟ้าขัดข้องในเขตพื้นที่ กฟส.ขอนแก่น 2 (มะลิวัลย์)",
      remarks: "",
      sheetUrl: this.DEFAULT_SHEET_URL,
      // ผู้ลงนาม
      requesterName: "นายวุฒิชัย เจริญ",
      requesterPosition: "ผู้เบิก",
      checkerName: "นายประยงค์ เกษร",
      checkerPosition: "ผู้ตรวจ",
      warehouseHeadName: "....................................",
      warehouseHeadPosition: "หัวหน้าคลังพัสดุ",
      approverName: "นายสุริยา นพคุณ",
      approverPosition: "ผู้อนุมัติ"
    };

    try {
      const stored = localStorage.getItem(this.STORAGE_KEY_SETTINGS);
      if (stored) {
        return { ...defaultSettings, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.warn("Could not load settings", e);
    }
    return defaultSettings;
  },

  // บันทึกการตั้งค่า
  saveSettings(settings) {
    try {
      localStorage.setItem(this.STORAGE_KEY_SETTINGS, JSON.stringify(settings));
    } catch (e) {
      console.error("Failed to save settings", e);
    }
  },

  // ดึงประวัติการเบิก
  getHistory() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY_HISTORY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.warn("Could not load history", e);
    }
    return [];
  },

  // บันทึกใบเบิกลงประวัติ
  saveToHistory(requisitionData) {
    try {
      const history = this.getHistory();
      const newEntry = {
        id: "REQ-" + Date.now(),
        savedAt: new Date().toISOString(),
        ...requisitionData
      };
      history.unshift(newEntry);
      if (history.length > 50) history.pop();
      localStorage.setItem(this.STORAGE_KEY_HISTORY, JSON.stringify(history));
      return newEntry;
    } catch (e) {
      console.error("Failed to save history", e);
    }
  },

  // ลบประวัติ
  deleteHistoryItem(id) {
    const history = this.getHistory().filter(item => item.id !== id);
    localStorage.setItem(this.STORAGE_KEY_HISTORY, JSON.stringify(history));
    return history;
  }
};
