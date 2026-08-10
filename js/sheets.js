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

  // แยก Sheet ID และ GID จาก URL
  extractSheetParams(url) {
    let sheetId = "1l_ZJpnBOQcjxIIRI9HqKlFsUJ1ddq-ZAqSeHQB7RnXE";
    let gid = "1247142924";

    if (url) {
      const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (idMatch) sheetId = idMatch[1];

      const gidMatch = url.match(/[#&?]gid=([0-9]+)/);
      if (gidMatch) gid = gidMatch[1];
    }

    return { sheetId, gid };
  },

  // แปลง URL Google Sheets ให้อยู่ในรูป Export CSV URL
  formatGoogleSheetCsvUrl(url) {
    const { sheetId, gid } = this.extractSheetParams(url);
    return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  },

  // ดึงข้อมูลจาก Google Sheets (รองรับทั้ง GViz JSON API, Direct CSV และ Fallback Proxies)
  async fetchFromGoogleSheets(url) {
    const targetUrl = url || this.DEFAULT_SHEET_URL;
    const { sheetId, gid } = this.extractSheetParams(targetUrl);

    const gvizJsonUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&gid=${gid}`;
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
    const gvizCsvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;

    // รายการ Endpoints ที่จะทดลองเรียก
    const fetchEndpoints = [
      { url: gvizJsonUrl, type: "gviz" },
      { url: csvUrl, type: "csv" },
      { url: gvizCsvUrl, type: "csv" },
      { url: `https://api.allorigins.win/raw?url=${encodeURIComponent(gvizJsonUrl)}`, type: "gviz" },
      { url: `https://corsproxy.io/?${encodeURIComponent(gvizJsonUrl)}`, type: "gviz" },
      { url: `https://api.allorigins.win/raw?url=${encodeURIComponent(csvUrl)}`, type: "csv" }
    ];

    let lastError = null;

    for (const ep of fetchEndpoints) {
      try {
        const response = await fetch(ep.url, { cache: "no-store" });
        if (response.ok) {
          const text = await response.text();
          if (text && !text.includes("accounts.google.com") && !text.includes("<title>Sign in</title>")) {
            let parsedItems = [];
            if (ep.type === "gviz") {
              parsedItems = this.parseGvizJsonToMaterials(text);
            } else {
              parsedItems = this.parseCsvToMaterials(text);
            }

            if (parsedItems && parsedItems.length > 0) {
              this.saveMaterials(parsedItems);
              return { success: true, count: parsedItems.length, data: parsedItems, source: "Google Sheets" };
            }
          }
        }
      } catch (err) {
        lastError = err;
        console.warn("Fetch endpoint failed:", ep.url, err);
      }
    }

    throw new Error(
      "ไม่สามารถเชื่อมต่อ Google Sheets ได้ กรุณาตรวจสอบว่าได้ตั้งค่าสิทธิ์ใน Google Sheets เป็น 'ทุกคนที่มีลิงก์' (มีสิทธิ์อ่าน) แล้วหรือยัง"
    );
  },

  // แปลง GViz JSON เป็น Object Array ของพัสดุ พร้อมยอดคงเหลือ 3 แหล่ง
  parseGvizJsonToMaterials(text) {
    try {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start === -1 || end === -1) return [];
      const jsonStr = text.substring(start, end + 1);
      const data = JSON.parse(jsonStr);

      if (!data.table || !data.table.rows || data.table.rows.length === 0) return [];

      const currentDefault = (typeof DEFAULT_PEA_MATERIALS !== 'undefined') ? DEFAULT_PEA_MATERIALS : [];
      const result = [];

      data.table.rows.forEach((r, idx) => {
        if (!r.c) return;
        const cells = r.c.map(c => (c && c.v !== null && c.v !== undefined) ? String(c.v).trim() : "");

        const rawCode = cells[1] || "";
        let formattedCode = rawCode;
        if (/^\d{10}$/.test(rawCode)) {
          formattedCode = `${rawCode[0]}-${rawCode.slice(1, 3)}-${rawCode.slice(3, 6)}-${rawCode.slice(6, 10)}`;
        }

        // จับคู่กับฐานข้อมูลมาตรฐานเพื่อป้องกันปัญหาภาษาไทยเพี้ยนจากไฟล์นำเข้า
        const match = currentDefault.find(m => 
          (m.code && (m.code === formattedCode || m.code.replace(/-/g, '') === rawCode.replace(/-/g, ''))) ||
          (m.no && m.no === String(idx + 1))
        );

        const name = (match && match.name) ? match.name : (cells[2] || rawCode);
        const unit = (match && match.unit) ? match.unit : (cells[3] || "ชิ้น");
        const category = (match && match.category) ? match.category : "อุปกรณ์ระบบไฟฟ้าและบำรุงรักษา";

        const standardQuota = cells[4] || (match ? match.standardQuota : "") || "";
        const stockMB52 = cells[6] || (match ? match.stockMB52 : "0") || "0";
        const stockWMS = cells[7] || (match ? match.stockWMS : "0") || "0";
        const stockSloc0023 = cells[8] || (match ? match.stockSloc0023 : "0") || "0";

        if (rawCode || name) {
          result.push({
            no: String(idx + 1),
            code: formattedCode || rawCode || "-",
            name: name,
            unit: unit,
            standardQuota: standardQuota,
            stockMB52: stockMB52,
            stockWMS: stockWMS,
            stockSloc0023: stockSloc0023,
            category: category
          });
        }
      });

      return result;
    } catch (e) {
      console.warn("GViz JSON parse failed", e);
      return [];
    }
  },

  // แปลงข้อความ CSV เป็น Object Array ของพัสดุ
  parseCsvToMaterials(csvText) {
    const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length === 0) return [];

    const currentDefault = (typeof DEFAULT_PEA_MATERIALS !== 'undefined') ? DEFAULT_PEA_MATERIALS : [];
    const result = [];

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

    let startRow = 0;
    // ตรวจสอบว่าแถวแรกเป็น Header หรือไม่
    const firstLine = parseCsvLine(lines[0]);
    if (firstLine.some(c => c.includes("ลำดับ") || c.includes("รหัส") || c.includes("รายการ") || c.includes("code"))) {
      startRow = 1;
    }

    for (let i = startRow; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      if (cols.length < 2) continue;

      const rawCode = cols[1] ? cols[1].replace(/^["']|["']$/g, '').trim() : "";
      let formattedCode = rawCode;
      if (/^\d{10}$/.test(rawCode)) {
        formattedCode = `${rawCode[0]}-${rawCode.slice(1, 3)}-${rawCode.slice(3, 6)}-${rawCode.slice(6, 10)}`;
      }

      const match = currentDefault.find(m => 
        (m.code && (m.code === formattedCode || m.code.replace(/-/g, '') === rawCode.replace(/-/g, ''))) ||
        (m.no && m.no === String(i - startRow + 1))
      );

      const name = (match && match.name) ? match.name : (cols[2] ? cols[2].replace(/^["']|["']$/g, '').trim() : rawCode);
      const unit = (match && match.unit) ? match.unit : (cols[3] ? cols[3].replace(/^["']|["']$/g, '').trim() : "ชิ้น");
      const category = (match && match.category) ? match.category : "อุปกรณ์ระบบไฟฟ้าและบำรุงรักษา";

      const standardQuota = (cols[4] ? cols[4].replace(/^["']|["']$/g, '').trim() : "") || (match ? match.standardQuota : "") || "";
      const stockMB52 = (cols[6] ? cols[6].replace(/^["']|["']$/g, '').trim() : "") || (match ? match.stockMB52 : "0") || "0";
      const stockWMS = (cols[7] ? cols[7].replace(/^["']|["']$/g, '').trim() : "") || (match ? match.stockWMS : "0") || "0";
      const stockSloc0023 = (cols[8] ? cols[8].replace(/^["']|["']$/g, '').trim() : "") || (match ? match.stockSloc0023 : "0") || "0";

      if (rawCode || name) {
        result.push({
          no: String(result.length + 1),
          code: formattedCode || rawCode || "-",
          name: name,
          unit: unit,
          standardQuota: standardQuota,
          stockMB52: stockMB52,
          stockWMS: stockWMS,
          stockSloc0023: stockSloc0023,
          category: category
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
