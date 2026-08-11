/**
 * แอพพลิเคชันหลัก: ระบบสร้างใบเบิกของแก้ไฟ การไฟฟ้าส่วนภูมิภาค (PEA Requisition App)
 * จัดการ State, ตะกร้าเบิกพัสดุ, การเชื่อมต่อ Google Sheets, และการเรนเดอร์ใบเบิก A4
 */

const App = {
  materials: [],
  cart: [],
  settings: {},
  activeCategory: "all",
  stockFilter: "all", // all, has_mb52, has_wms, has_sloc, has_any
  searchQuery: "",
  activeDocView: "both", // both, memo, requisition

  // เริ่มต้นการทำงานของแอพ
  init() {
    this.materials = SheetsManager.getMaterials();
    this.settings = SheetsManager.getSettings();

    // ดึงลายเซ็นดิจิทัลที่บันทึกไว้ใน LocalStorage (ถ้ามี)
    if (!this.settings.requesterSignature) {
      this.settings.requesterSignature = localStorage.getItem("pea_requester_signature") || "";
    }

    // รายการเบิกตัวอย่างเริ่มต้น (ดึงสต็อกจริงจากฐานข้อมูลพัสดุ)
    if (this.cart.length === 0) {
      const sampleCodes = ["1-04-003-0007", "1-02-030-0101", "1-02-018-0001", "1-02-036-0000"];
      this.cart = sampleCodes.map((code, idx) => {
        const mat = this.materials.find(m => m.code === code);
        return {
          code: code,
          name: mat ? mat.name : "พัสดุตัวอย่าง",
          unit: mat ? mat.unit : "ชิ้น",
          qty: [3, 4, 2, 6][idx] || 1,
          remark: idx === 0 ? "งานแก้ไฟฉุกเฉิน" : "",
          standardQuota: mat ? mat.standardQuota : "",
          stockMB52: mat ? mat.stockMB52 : "0",
          stockWMS: mat ? mat.stockWMS : "0",
          stockSloc0023: mat ? mat.stockSloc0023 : "0"
        };
      });
    } else {
      // Sync stock data for any existing cart items
      this.enrichCartStockData();
    }

    this.renderCategories();
    this.renderCatalog();
    this.renderCart();
    this.renderLivePreview();
    this.bindEvents();
    this.initSettingsForm();
    this.initSignaturePad();

    // ดึงข้อมูลเวอร์ชันล่าสุดจาก Google Sheets เบื้องหลังทันทีก่อนหน้าเว็บจะทำงานเสร็จ (ซิงค์อัตโนมัติ 100%)
    this.autoSyncGoogleSheets();

    // ตั้งเวลาซิงค์ข้อมูลสต็อกพัสดุอัตโนมัติทุกๆ 2 นาที (120,000 มิลลิวินาที)
    setInterval(() => {
      this.autoSyncGoogleSheets();
    }, 120000);
  },

  // ซิงค์ Google Sheets แบบอัตโนมัติในเบื้องหลัง
  async autoSyncGoogleSheets() {
    try {
      const url = this.settings.sheetUrl || SheetsManager.DEFAULT_SHEET_URL;
      const res = await SheetsManager.fetchFromGoogleSheets(url);
      this.materials = res.data;
      this.enrichCartStockData();
      this.renderCategories();
      this.renderCatalog();
      this.renderCart();
      this.renderLivePreview();
      console.log("Auto-sync Google Sheets successfully.");
    } catch (e) {
      console.warn("Auto-sync failed, using cached data.", e);
    }
  },

  // อัปเดตข้อมูลสต็อก 3 แหล่งให้รายการในตะกร้าตรงกับฐานข้อมูลเสมอ
  enrichCartStockData() {
    this.cart.forEach(item => {
      const mat = this.materials.find(m => (m.code && m.code === item.code) || (m.name && m.name === item.name));
      if (mat) {
        item.stockMB52 = mat.stockMB52 || "0";
        item.stockWMS = mat.stockWMS || "0";
        item.stockSloc0023 = mat.stockSloc0023 || "0";
        item.standardQuota = mat.standardQuota || "";
      }
    });
  },

  // ดึงหมวดหมู่ทั้งหมดจากพัสดุ
  getCategories() {
    const cats = new Set(["all"]);
    this.materials.forEach(m => {
      if (m.category) cats.add(m.category);
    });
    return Array.from(cats);
  },

  // แสดงผลปุ่มหมวดหมู่
  renderCategories() {
    const container = document.getElementById("categoryTags");
    if (!container) return;

    const categories = this.getCategories();
    container.innerHTML = categories.map(cat => {
      const label = cat === "all" ? "ทั้งหมด (" + this.materials.length + ")" : cat;
      const isActive = this.activeCategory === cat ? "active" : "";
      return `<button type="button" class="tag-chip ${isActive}" data-category="${cat}">${label}</button>`;
    }).join("");
  },

  // แปลงค่าสต็อกเป็นตัวเลข
  parseStockNum(val) {
    if (!val) return 0;
    const clean = String(val).replace(/,/g, "").trim();
    const n = parseFloat(clean);
    return isNaN(n) ? 0 : n;
  },

  // แสดงรายการพัสดุในคลัง (Catalog) พร้อมข้อมูลสต็อก MB52, WMS, Sloc 0023
  renderCatalog() {
    const container = document.getElementById("catalogList");
    if (!container) return;

    const q = this.searchQuery.toLowerCase().trim();
    const qClean = q.replace(/[^a-zA-Z0-9ก-๙]/g, "");

    const filtered = this.materials.filter(m => {
      // ตัวกรองหมวดหมู่
      const matchCat = this.activeCategory === "all" || m.category === this.activeCategory;
      if (!matchCat) return false;

      // ตัวกรองสต็อก
      const mb52 = this.parseStockNum(m.stockMB52);
      const wms = this.parseStockNum(m.stockWMS);
      const sloc = this.parseStockNum(m.stockSloc0023);

      if (this.stockFilter === "has_mb52" && mb52 <= 0) return false;
      if (this.stockFilter === "has_wms" && wms <= 0) return false;
      if (this.stockFilter === "has_sloc" && sloc <= 0) return false;
      if (this.stockFilter === "has_any" && (mb52 <= 0 && wms <= 0 && sloc <= 0)) return false;

      // ตัวกรองค้นหา
      if (!q) return true;

      const codeRaw = (m.code || "").toLowerCase();
      const codeClean = codeRaw.replace(/[^a-zA-Z0-9ก-๙]/g, "");
      const nameRaw = (m.name || "").toLowerCase();
      const noRaw = (m.no || "").toLowerCase();

      return codeRaw.includes(q) || 
             codeClean.includes(qClean) || 
             nameRaw.includes(q) || 
             noRaw === q;
    });

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 25px 15px; color: var(--text-dim); font-size: 0.85rem;">
          ไม่พบพัสดุที่ตรงกับเงื่อนไขการค้นหา
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(item => {
      const mb52Num = this.parseStockNum(item.stockMB52);
      const wmsNum = this.parseStockNum(item.stockWMS);
      const slocNum = this.parseStockNum(item.stockSloc0023);

      const mb52Class = mb52Num > 0 ? "has-stock-mb52" : "zero-stock";
      const wmsClass = wmsNum > 0 ? "has-stock-wms" : "zero-stock";
      const slocClass = slocNum > 0 ? "has-stock-sloc" : "zero-stock";

      return `
        <div class="material-item">
          <div class="material-info">
            <div class="material-name" title="${this.escapeHtml(item.name)}">
              <span style="color: var(--pea-gold); font-size: 0.76rem; font-weight: 700; margin-right: 4px;">#${item.no || ""}</span>
              ${this.escapeHtml(item.name)}
            </div>
            
            <div class="material-meta">
              <span class="code-pill">${item.code || "-"}</span>
              <span>หน่วย: <strong>${item.unit || "ชิ้น"}</strong></span>
              ${item.standardQuota ? `<span class="quota-pill">เกณฑ์: ${item.standardQuota}</span>` : ""}
              <span style="color: var(--text-dim);">${item.category || ""}</span>
            </div>

            <!-- แถบแสดงค่าคงเหลือใน MB52, WMS และคลัง กฟจ.ขอนแก่น (sloc 0023) -->
            <div class="stock-badge-group">
              <span class="stock-badge ${mb52Class}" title="คงเหลือในระบบ MB52">
                MB52: ${item.stockMB52 || "0"}
              </span>
              <span class="stock-badge ${wmsClass}" title="คงเหลือในระบบ WMS">
                WMS: ${item.stockWMS || "0"}
              </span>
              <span class="stock-badge ${slocClass}" title="คลัง กฟจ.ขอนแก่น (sloc 0023)">
                คลัง กฟจ.(0023): ${item.stockSloc0023 || "0"}
              </span>
            </div>
          </div>

          <button class="btn btn-primary btn-sm btn-add-item" 
                  data-code="${item.code}" 
                  data-name="${this.escapeHtml(item.name)}" 
                  data-unit="${item.unit || 'ชิ้น'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
            เพิ่ม
          </button>
        </div>
      `;
    }).join("");
  },

  // แสดงผลตะกร้ารายการเบิกปัจจุบัน (พร้อมแสดงค่าคงเหลือครบทั้ง 3 แหล่ง)
  renderCart() {
    const tableBody = document.getElementById("cartTableBody");
    const emptyState = document.getElementById("emptyCartState");
    const cartCount = document.getElementById("cartItemCount");

    if (cartCount) cartCount.textContent = this.cart.length;

    if (this.cart.length === 0) {
      if (tableBody) tableBody.innerHTML = "";
      if (emptyState) emptyState.style.display = "block";
      return;
    }

    if (emptyState) emptyState.style.display = "none";
    if (tableBody) {
      tableBody.innerHTML = this.cart.map((item, index) => {
        // หาข้อมูลสต็อกจากฐานข้อมูลหลักเสมอ เพื่อให้ได้ค่าเดียวกันเป๊ะ
        const mat = this.materials.find(m => (m.code && m.code === item.code) || (m.name && m.name === item.name));
        const mb52 = mat ? mat.stockMB52 : (item.stockMB52 || "0");
        const wms = mat ? mat.stockWMS : (item.stockWMS || "0");
        const sloc = mat ? mat.stockSloc0023 : (item.stockSloc0023 || "0");
        const quota = mat ? mat.standardQuota : (item.standardQuota || "");

        const mb52Num = this.parseStockNum(mb52);
        const wmsNum = this.parseStockNum(wms);
        const slocNum = this.parseStockNum(sloc);

        const mb52Class = mb52Num > 0 ? "has-stock-mb52" : "zero-stock";
        const wmsClass = wmsNum > 0 ? "has-stock-wms" : "zero-stock";
        const slocClass = slocNum > 0 ? "has-stock-sloc" : "zero-stock";

        return `
          <tr>
            <td>
              <div class="cart-item-detail">
                <div class="cart-item-name" title="${this.escapeHtml(item.name)}">
                  ${this.escapeHtml(item.name)}
                </div>
                
                <div class="cart-item-code-line">
                  <span class="code-pill">${item.code || "-"}</span>
                  ${quota ? `<span class="quota-pill">เกณฑ์: ${quota}</span>` : ""}
                </div>

                <!-- แสดงค่าคงเหลือครบ 3 แหล่งในรายการเบิกปัจจุบัน -->
                <div class="stock-badge-group cart-stock-group">
                  <span class="stock-badge ${mb52Class}" title="คงเหลือใน MB52">
                    MB52: ${mb52}
                  </span>
                  <span class="stock-badge ${wmsClass}" title="คงเหลือใน WMS">
                    WMS: ${wms}
                  </span>
                  <span class="stock-badge ${slocClass}" title="คงเหลือคลัง กฟจ.ขอนแก่น (0023)">
                    คลัง 0023: ${sloc}
                  </span>
                </div>
              </div>
            </td>
            <td>
              <input type="number" min="1" max="9999" class="qty-input cart-qty-input" data-index="${index}" value="${item.qty || 1}">
            </td>
            <td style="color: var(--text-muted); font-size: 0.8rem; vertical-align: middle;">
              ${item.unit || "ชิ้น"}
            </td>
            <td style="vertical-align: middle;">
              <input type="text" class="cart-remark-input" data-index="${index}" value="${this.escapeHtml(item.remark || "")}" placeholder="หมายเหตุ...">
            </td>
            <td style="vertical-align: middle;">
              <button class="btn btn-danger btn-sm btn-icon-only btn-remove-item" data-index="${index}" title="ลบรายการ">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
              </button>
            </td>
          </tr>
        `;
      }).join("");
    }
  },

  // แสดงพรีวิวใบเบิก A4
  renderLivePreview() {
    const container = document.getElementById("livePreviewContainer");
    if (!container) return;

    const html = PrintEngine.renderRequisitionPages(this.settings, this.cart, this.activeDocView || "both");
    container.innerHTML = html;

    // ผูก Event ให้กล่องผู้เบิกบนพรีวิวสามารถคลิกเพื่อเปิดหน้าต่างเซ็นชื่อได้ทันที
    container.querySelectorAll("#clickableRequesterSigBox").forEach(box => {
      box.style.cursor = "pointer";
      box.addEventListener("click", () => {
        this.openSignatureModal();
      });
    });
  },

  // ผูก Event ต่างๆ
  bindEvents() {
    // ช่องค้นหา
    const searchInput = document.getElementById("searchInput");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        this.searchQuery = e.target.value;
        this.renderCatalog();
      });
    }

    // ตัวกรองสต็อกคงเหลือ
    const stockFilterContainer = document.getElementById("stockFilterRow");
    if (stockFilterContainer) {
      stockFilterContainer.addEventListener("click", (e) => {
        const btn = e.target.closest(".stock-filter-btn");
        if (btn) {
          stockFilterContainer.querySelectorAll(".stock-filter-btn").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          this.stockFilter = btn.dataset.stockFilter || "all";
          this.renderCatalog();
        }
      });
    }

    // หมวดหมู่
    const categoryContainer = document.getElementById("categoryTags");
    if (categoryContainer) {
      categoryContainer.addEventListener("click", (e) => {
        const chip = e.target.closest(".tag-chip");
        if (chip) {
          this.activeCategory = chip.dataset.category;
          this.renderCategories();
          this.renderCatalog();
        }
      });
    }

    // ปุ่มเพิ่มจาก Catalog
    const catalogList = document.getElementById("catalogList");
    if (catalogList) {
      catalogList.addEventListener("click", (e) => {
        const btn = e.target.closest(".btn-add-item");
        if (btn) {
          this.addItemToCart({
            code: btn.dataset.code,
            name: btn.dataset.name,
            unit: btn.dataset.unit,
            qty: 1,
            remark: ""
          });
        }
      });
    }

    // ปุ่มปรับจำนวน หมายเหตุ และลบใน Cart
    const cartTable = document.getElementById("cartTableBody");
    if (cartTable) {
      cartTable.addEventListener("input", (e) => {
        const index = parseInt(e.target.dataset.index, 10);
        if (isNaN(index) || !this.cart[index]) return;

        if (e.target.classList.contains("cart-qty-input")) {
          const newQty = parseInt(e.target.value, 10) || 1;
          this.cart[index].qty = Math.max(1, newQty);
          this.renderLivePreview();
        } else if (e.target.classList.contains("cart-remark-input")) {
          this.cart[index].remark = e.target.value;
          this.renderLivePreview();
        }
      });

      cartTable.addEventListener("click", (e) => {
        const btn = e.target.closest(".btn-remove-item");
        if (btn) {
          const index = parseInt(btn.dataset.index, 10);
          this.removeItemFromCart(index);
        }
      });
    }

    // ปุ่มล้างรายการทั้งหมด
    const btnClearCart = document.getElementById("btnClearCart");
    if (btnClearCart) {
      btnClearCart.addEventListener("click", () => {
        if (this.cart.length === 0) return;
        if (confirm("ต้องการล้างรายการพัสดุในใบเบิกทั้งหมดหรือไม่?")) {
          this.cart = [];
          this.renderCart();
          this.renderLivePreview();
          this.showToast("ล้างรายการเบิกเรียบร้อย", "info");
        }
      });
    }

    // ปุ่มสั่งพิมพ์ A4
    const btnPrint = document.getElementById("btnPrint");
    if (btnPrint) {
      btnPrint.addEventListener("click", () => {
        if (this.cart.length === 0) {
          if (!confirm("ยังไม่มีรายการพัสดุในใบเบิก ต้องการพิมพ์แบบฟอร์มเปล่าหรือไม่?")) {
            return;
          }
        }
        SheetsManager.saveToHistory({
          docNo: this.settings.docNo,
          docDate: this.settings.docDate || new Date().toISOString(),
          items: [...this.cart],
          itemCount: this.cart.length
        });
        PrintEngine.printDocument();
      });
    }

    // สลับหน้าเอกสารสำหรับพรีวิว/พิมพ์
    document.querySelectorAll(".btn-doc-tab").forEach(tab => {
      tab.addEventListener("click", (e) => {
        // ลบคลาส active ของทุกปุ่ม
        document.querySelectorAll(".btn-doc-tab").forEach(t => {
          t.classList.remove("active");
          t.style.background = "transparent";
          t.style.color = "var(--text-dim)";
          t.style.fontWeight = "normal";
        });
        
        // เพิ่มคลาส active ให้ปุ่มที่คลิก
        tab.classList.add("active");
        tab.style.background = "var(--pea-gold)";
        tab.style.color = "#000000";
        tab.style.fontWeight = "bold";

        // อัปเดต View และ Render พรีวิวใหม่
        this.activeDocView = tab.dataset.view;
        this.renderLivePreview();
      });
    });

    // ปุ่มเปิด Modal ต่างๆ
    const btnOpenSettings = document.getElementById("btnOpenSettings");
    if (btnOpenSettings) {
      btnOpenSettings.addEventListener("click", () => this.openModal("settingsModal"));
    }

    const btnOpenSheets = document.getElementById("btnOpenSheets");
    if (btnOpenSheets) {
      btnOpenSheets.addEventListener("click", () => {
        const password = prompt("กรุณากรอกรหัสผ่านเพื่อเข้าสู่เมนูเชื่อมต่อ Google Sheet:");
        if (password !== "Aunkung") {
          this.showToast("รหัสผ่านไม่ถูกต้อง ไม่สามารถเข้าใช้งานส่วนนี้ได้", "error");
          return;
        }
        const input = document.getElementById("sheetUrlInput");
        if (input) input.value = this.settings.sheetUrl || SheetsManager.DEFAULT_SHEET_URL;
        this.openModal("sheetsModal");
      });
    }

    const btnOpenCustomItem = document.getElementById("btnOpenCustomItem");
    if (btnOpenCustomItem) {
      btnOpenCustomItem.addEventListener("click", () => this.openModal("customItemModal"));
    }

    const btnOpenHistory = document.getElementById("btnOpenHistory");
    if (btnOpenHistory) {
      btnOpenHistory.addEventListener("click", () => {
        this.renderHistoryList();
        this.openModal("historyModal");
      });
    }

    // ปุ่มส่งออกไฟล์ประวัติการเบิก (Export Backup JSON)
    const btnExportHistory = document.getElementById("btnExportHistory");
    if (btnExportHistory) {
      btnExportHistory.addEventListener("click", () => {
        const history = SheetsManager.getHistory();
        if (history.length === 0) {
          this.showToast("ยังไม่มีประวัติการเบิกเพื่อส่งออก", "info");
          return;
        }
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(history, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `pea_requisition_history_backup_${new Date().toISOString().split('T')[0]}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        this.showToast("ส่งออกไฟล์ประวัติเรียบร้อยแล้ว", "success");
      });
    }

    // ปุ่มนำเข้าไฟล์ประวัติการเบิก (Import Backup JSON)
    const importHistoryInput = document.getElementById("importHistoryInput");
    if (importHistoryInput) {
      importHistoryInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const importedData = JSON.parse(event.target.result);
            if (Array.isArray(importedData)) {
              const currentHistory = SheetsManager.getHistory();
              const mergedHistory = [...importedData];
              currentHistory.forEach(item => {
                if (!mergedHistory.some(m => m.id === item.id)) {
                  mergedHistory.push(item);
                }
              });
              
              mergedHistory.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
              
              localStorage.setItem(SheetsManager.STORAGE_KEY_HISTORY, JSON.stringify(mergedHistory));
              this.renderHistoryList();
              this.showToast(`นำเข้าประวัติสำเร็จ (${importedData.length} รายการ)`, "success");
            } else {
              this.showToast("รูปแบบไฟล์สำรองประวัติไม่ถูกต้อง", "error");
            }
          } catch (err) {
            this.showToast("ไม่สามารถอ่านไฟล์สำรองประวัติได้", "error");
          }
          importHistoryInput.value = "";
        };
        reader.readAsText(file);
      });
    }

    // ปุ่มดาวน์โหลดประวัติเป็นไฟล์ CSV (รองรับภาษาไทยใน Microsoft Excel สมบูรณ์ 100%)
    const btnExportHistoryCsv = document.getElementById("btnExportHistoryCsv");
    if (btnExportHistoryCsv) {
      btnExportHistoryCsv.addEventListener("click", () => {
        const history = SheetsManager.getHistory();
        if (history.length === 0) {
          this.showToast("ยังไม่มีประวัติการเบิกเพื่อดาวน์โหลด", "info");
          return;
        }

        // ใช้ UTF-8 BOM (\uFEFF) เพื่อบังคับให้ Microsoft Excel เปิดอ่านภาษาไทยได้ถูกต้องทันที
        let csvContent = "\uFEFF"; 
        csvContent += "ลำดับประวัติ,รหัสประวัติ,วันที่บันทึก,เลขที่ใบเบิก,วันที่ใบเบิก,รหัสพัสดุ,รายการพัสดุ,จำนวนเบิก,หน่วยนับ,หมายเหตุ\n";

        history.forEach((entry, hIdx) => {
          const savedAt = new Date(entry.savedAt).toLocaleString('th-TH');
          const docNo = entry.docNo || "-";
          const docDate = PrintEngine.formatThaiDate(entry.docDate);
          
          if (entry.items && entry.items.length > 0) {
            entry.items.forEach((item) => {
              const code = item.code || "-";
              const name = (item.name || "").replace(/"/g, '""');
              const qty = item.qty || 0;
              const unit = item.unit || "ชิ้น";
              const remark = (item.remark || "").replace(/"/g, '""');
              
              csvContent += `"${hIdx + 1}","${entry.id}","${savedAt}","${docNo}","${docDate}","${code}","${name}","${qty}","${unit}","${remark}"\n`;
            });
          } else {
            csvContent += `"${hIdx + 1}","${entry.id}","${savedAt}","${docNo}","${docDate}","-","-","0","-","-"\n`;
          }
        });

        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `รายงานประวัติการเบิกพัสดุ_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        this.showToast("ดาวน์โหลดรายงานประวัติ (CSV) สำเร็จ", "success");
      });
    }

    // ปุ่มสั่งพิมพ์รายงานประวัติการเบิกเป็น PDF (จัดหน้าและสไตล์รายงานสวยงาม)
    const btnExportHistoryPdf = document.getElementById("btnExportHistoryPdf");
    if (btnExportHistoryPdf) {
      btnExportHistoryPdf.addEventListener("click", () => {
        const history = SheetsManager.getHistory();
        if (history.length === 0) {
          this.showToast("ยังไม่มีประวัติการเบิกสำหรับพิมพ์รายงาน", "info");
          return;
        }

        const printWindow = window.open("", "_blank");
        if (!printWindow) {
          this.showToast("กรุณาอนุญาตให้แสดง Pop-up หน้าต่างพิมพ์บนเบราว์เซอร์ของคุณ", "error");
          return;
        }

        let tableRows = "";
        let rowIdx = 1;
        
        history.forEach((entry) => {
          const docNo = entry.docNo || "-";
          const docDate = PrintEngine.formatThaiDate(entry.docDate);
          
          if (entry.items && entry.items.length > 0) {
            entry.items.forEach((item) => {
              tableRows += `
                <tr>
                  <td style="text-align: center;">${rowIdx++}</td>
                  <td style="text-align: center;">${docDate}</td>
                  <td style="text-align: center;">${docNo}</td>
                  <td>${this.escapeHtml(item.name || "-")} <br><small style="color: #666;">รหัส: ${this.escapeHtml(item.code || "-")}</small></td>
                  <td style="text-align: center; font-weight: bold;">${item.qty || 0}</td>
                  <td style="text-align: center;">${this.escapeHtml(item.unit || "ชิ้น")}</td>
                  <td>${this.escapeHtml(item.remark || "-")}</td>
                </tr>
              `;
            });
          }
        });

        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>รายงานสรุปประวัติการเบิกพัสดุ กฟภ.</title>
            <meta charset="utf-8">
            <style>
              body {
                font-family: 'Sarabun', 'TH Sarabun New', sans-serif;
                background: #ffffff;
                color: #000000;
                padding: 20px;
                margin: 0;
              }
              .header {
                text-align: center;
                margin-bottom: 25px;
              }
              .header h1 {
                font-size: 20px;
                margin: 0 0 5px 0;
              }
              .header h2 {
                font-size: 14px;
                font-weight: normal;
                margin: 0 0 15px 0;
                color: #333;
              }
              .meta-info {
                font-size: 13px;
                margin-bottom: 15px;
                text-align: right;
              }
              table {
                width: 100%;
                border-collapse: collapse;
                font-size: 13px;
              }
              th, td {
                border: 1px solid #000000;
                padding: 6px 8px;
                vertical-align: middle;
              }
              th {
                background-color: #f3f4f6;
                font-weight: bold;
              }
              @media print {
                body { padding: 0; }
                @page {
                  size: A4 portrait;
                  margin: 15mm 10mm;
                }
              }
            </style>
          </head>
          <body>
            <div class="header">
              <h1>รายงานสรุปประวัติการเบิกพัสดุแก้กระแสไฟฟ้าขัดข้อง</h1>
              <h2>การไฟฟ้าส่วนภูมิภาคสาขาเมืองขอนแก่น 2 (คลังสำรองแก้ไฟ)</h2>
            </div>
            <div class="meta-info">
              วันที่พิมพ์รายงาน: ${new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
            <table>
              <thead>
                <tr>
                  <th style="width: 5%;">ลำดับ</th>
                  <th style="width: 15%;">วันที่เบิก</th>
                  <th style="width: 15%;">เลขที่ใบเบิก</th>
                  <th style="width: 35%;">รายการพัสดุ / รหัสพัสดุ</th>
                  <th style="width: 8%;">จำนวน</th>
                  <th style="width: 10%;">หน่วยนับ</th>
                  <th style="width: 12%;">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                ${tableRows}
              </tbody>
            </table>
            <script>
              window.onload = function() {
                setTimeout(function() {
                  window.print();
                }, 500);
              };
            </script>
          </body>
          </html>
        `);
        printWindow.document.close();
      });
    }

    // ปุ่มเปิดหน้าต่างเซ็นชื่อผู้เบิกออนไลน์
    const openSignatureBtn = document.getElementById("openSignatureBtn");
    if (openSignatureBtn) {
      openSignatureBtn.addEventListener("click", () => {
        this.openSignatureModal();
      });
    }

    const btnSettingsOpenSignature = document.getElementById("btnSettingsOpenSignature");
    if (btnSettingsOpenSignature) {
      btnSettingsOpenSignature.addEventListener("click", () => {
        this.openSignatureModal();
      });
    }

    // ปิด Modal ทั้งหมด
    document.querySelectorAll(".modal-close-btn, .modal-overlay").forEach(el => {
      el.addEventListener("click", (e) => {
        if (e.target === el || e.target.closest(".modal-close-btn")) {
          this.closeAllModals();
        }
      });
    });

    document.querySelectorAll(".modal-container").forEach(c => {
      c.addEventListener("click", e => e.stopPropagation());
    });

    // ฟอร์มบันทึกการตั้งค่า
    const settingsForm = document.getElementById("settingsForm");
    if (settingsForm) {
      settingsForm.addEventListener("submit", (e) => {
        e.preventDefault();
        this.saveSettingsFromForm();
      });
    }

    // ฟอร์มเพิ่มรายการพัสดุนอกตาราง
    const customItemForm = document.getElementById("customItemForm");
    if (customItemForm) {
      customItemForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const name = document.getElementById("customItemName").value.trim();
        const code = document.getElementById("customItemCode").value.trim();
        const unit = document.getElementById("customItemUnit").value.trim() || "ชิ้น";
        const qty = parseInt(document.getElementById("customItemQty").value, 10) || 1;
        const remark = document.getElementById("customItemRemark").value.trim();

        if (!name) {
          alert("กรุณากรอกชื่อรายการพัสดุ");
          return;
        }

        this.addItemToCart({ 
          code, 
          name, 
          unit, 
          qty, 
          remark, 
          stockMB52: "-", 
          stockWMS: "-", 
          stockSloc0023: "-" 
        });
        customItemForm.reset();
        this.closeAllModals();
        this.showToast("เพิ่มรายการพิเศษเรียบร้อย", "success");
      });
    }

    // ซิงค์ Google Sheets
    const btnSyncSheets = document.getElementById("btnSyncSheets");
    if (btnSyncSheets) {
      btnSyncSheets.addEventListener("click", async () => {
        const urlInput = document.getElementById("sheetUrlInput");
        const passInput = document.getElementById("sheetPasswordInput");
        const url = urlInput ? urlInput.value.trim() : "";
        const password = passInput ? passInput.value.trim() : "";

        if (password !== "Aunkung") {
          this.showToast("รหัสผ่านไม่ถูกต้อง ไม่ได้รับอนุญาตให้ซิงค์ข้อมูล", "error");
          if (passInput) {
            passInput.value = "";
            passInput.focus();
          }
          return;
        }

        btnSyncSheets.disabled = true;
        btnSyncSheets.textContent = "กำลังเชื่อมต่อ...";

        try {
          const res = await SheetsManager.fetchFromGoogleSheets(url);
          this.settings.sheetUrl = url;
          localStorage.setItem("pea_sheet_password", password);
          SheetsManager.saveSettings(this.settings);
          this.materials = res.data;
          this.enrichCartStockData();
          this.renderCategories();
          this.renderCatalog();
          this.renderCart();
          this.renderLivePreview();
          this.showToast(`ซิงค์ข้อมูลสำเร็จ (${res.count} รายการ)`, "success");
          
          if (passInput) passInput.value = "";
          this.closeAllModals();
        } catch (err) {
          this.showToast(err.message || "เชื่อมต่อไม่สำเร็จ", "error");
        } finally {
          btnSyncSheets.disabled = false;
          btnSyncSheets.textContent = "ซิงค์ข้อมูล Google Sheet";
        }
      });
    }

    // อัปโหลดไฟล์ CSV / Excel
    const fileUploadInput = document.getElementById("fileUploadInput");
    if (fileUploadInput) {
      fileUploadInput.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
          const res = await SheetsManager.parseUploadedFile(file);
          this.materials = res.data;
          this.enrichCartStockData();
          this.renderCategories();
          this.renderCatalog();
          this.renderCart();
          this.renderLivePreview();
          this.showToast(`นำเข้าสำเร็จ (${res.count} รายการ)`, "success");
          this.closeAllModals();
        } catch (err) {
          this.showToast(err.message || "ไม่สามารถอ่านไฟล์ได้", "error");
        }
      });
    }

    // คืนค่าพัสดุเริ่มต้น PEA 114 รายการ
    const btnResetDefaultMaterials = document.getElementById("btnResetDefaultMaterials");
    if (btnResetDefaultMaterials) {
      btnResetDefaultMaterials.addEventListener("click", () => {
        if (confirm("ต้องการคืนค่าฐานข้อมูลพัสดุเป็นค่ามาตรฐาน กฟภ. (114 รายการ) หรือไม่?")) {
          this.materials = SheetsManager.resetToDefault();
          this.enrichCartStockData();
          this.renderCategories();
          this.renderCatalog();
          this.renderCart();
          this.showToast("คืนค่าฐานข้อมูลพัสดุ 114 รายการเรียบร้อย", "info");
        }
      });
    }
  },

  // เพิ่มพัสดุลงในตะกร้า (ผูกข้อมูลคงเหลือ 3 แหล่งอัตโนมัติ)
  addItemToCart(item) {
    const mat = this.materials.find(m => (m.code && m.code === item.code) || (m.name && m.name === item.name));
    const fullItem = {
      ...item,
      unit: item.unit || (mat ? mat.unit : "ชิ้น"),
      standardQuota: mat ? mat.standardQuota : (item.standardQuota || ""),
      stockMB52: mat ? mat.stockMB52 : (item.stockMB52 || "0"),
      stockWMS: mat ? mat.stockWMS : (item.stockWMS || "0"),
      stockSloc0023: mat ? mat.stockSloc0023 : (item.stockSloc0023 || "0")
    };

    const existingIndex = this.cart.findIndex(i => i.code && i.code === fullItem.code);
    if (existingIndex > -1) {
      this.cart[existingIndex].qty += (fullItem.qty || 1);
    } else {
      this.cart.push(fullItem);
    }
    this.renderCart();
    this.renderLivePreview();
    this.showToast(`เพิ่ม "${fullItem.name}" ลงในใบเบิกแล้ว`, "success");
  },

  // ลบพัสดุออกจากตะกร้า
  removeItemFromCart(index) {
    if (this.cart[index]) {
      const name = this.cart[index].name;
      this.cart.splice(index, 1);
      this.renderCart();
      this.renderLivePreview();
      this.showToast(`ลบ "${name}" ออกแล้ว`, "info");
    }
  },

  // ตั้งค่าข้อมูลเริ่มต้นในฟอร์มการตั้งค่า
  initSettingsForm() {
    const s = this.settings;
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el && val !== undefined) el.value = val;
    };

    setVal("settingIssueNo", s.issueNo || "1");
    setVal("settingRegion", s.region || "กฟฉ.1");
    setVal("settingDepartment", s.department || "ปฏิบัติการระบบไฟฟ้าและบำรุงรักษา (2601) (คลังสำรองแก้ไฟ) (2601)");
    setVal("settingOffice", s.electricityOffice || "กฟส.ขอนแก่น 2");
    setVal("settingDocNo", s.docNo || "");
    setVal("settingDeliveryNo", s.deliveryNo || "");
    setVal("settingSendToWarehouse", s.sendToWarehouse || "");
    setVal("settingPurpose", s.purpose || "บริการแก้กระแสไฟฟ้าขัดข้องในเขตพื้นที่ กฟส.ขอนแก่น 2 (มะลิวัลย์)");
    setVal("settingRemarks", s.remarks || "");
    
    // วันที่เอกสาร
    const today = new Date().toISOString().split("T")[0];
    setVal("settingDocDate", s.docDate || today);

    // ผู้ลงนาม
    setVal("settingRequesterName", s.requesterName || "");
    setVal("settingCheckerName", s.checkerName || "");
    setVal("settingWarehouseHeadName", s.warehouseHeadName || "");
    setVal("settingApproverName", s.approverName || "");

    // ข้อมูลบันทึกข้อความ (Memo)
    setVal("settingMemoFrom", s.memoFrom || "ผปบ.กฟส.ขก.2");
    setVal("settingMemoTo", s.memoTo || "กฟส.ขก.2");
    setVal("settingMemoNo", s.memoNo || "ฉ.1 ขก.2(ปบ.)");
    setVal("settingMemoSubject", s.memoSubject || "ขออนุมัติเบิกพัสดุอุปกรณ์สำรองคลังฉุกเฉินแก้กระแสไฟฟ้าขัดข้อง");
    setVal("settingMemoRef", s.memoRef || "ฉ.1กบษ.(บร) 1142/2567 ลว. 25 ก.ค. 2567");
    setVal("settingMemoDear", s.memoDear || "ผจก. กฟส.ขก.2 ผ่าน รจก.(ท) กฟส.ขก.2");
    setVal("settingMemoProposerName", s.memoProposerName || "นายมารุต พึ่งตน");
    setVal("settingMemoProposerPosition", s.memoProposerPosition || "หผ.ปบ.กฟส.ขก.2");
    setVal("settingMemoBody", s.memoBody || "");
  },

  // บันทึกการตั้งค่าจากฟอร์ม
  saveSettingsFromForm() {
    const getVal = (id) => {
      const el = document.getElementById(id);
      return el ? el.value.trim() : "";
    };

    this.settings = {
      ...this.settings,
      issueNo: getVal("settingIssueNo") || "1",
      region: getVal("settingRegion") || "กฟฉ.1",
      department: getVal("settingDepartment"),
      electricityOffice: getVal("settingOffice"),
      docNo: getVal("settingDocNo"),
      deliveryNo: getVal("settingDeliveryNo"),
      docDate: getVal("settingDocDate"),
      sendToWarehouse: getVal("settingSendToWarehouse"),
      purpose: getVal("settingPurpose"),
      remarks: getVal("settingRemarks"),
      requesterName: getVal("settingRequesterName"),
      checkerName: getVal("settingCheckerName"),
      warehouseHeadName: getVal("settingWarehouseHeadName"),
      approverName: getVal("settingApproverName"),
      
      // บันทึกข้อความ (Memo)
      memoFrom: getVal("settingMemoFrom") || "ผปบ.กฟส.ขก.2",
      memoTo: getVal("settingMemoTo") || "กฟส.ขก.2",
      memoNo: getVal("settingMemoNo") || "ฉ.1 ขก.2(ปบ.)",
      memoSubject: getVal("settingMemoSubject") || "ขออนุมัติเบิกพัสดุอุปกรณ์สำรองคลังฉุกเฉินแก้กระแสไฟฟ้าขัดข้อง",
      memoRef: getVal("settingMemoRef") || "ฉ.1กบษ.(บร) 1142/2567 ลว. 25 ก.ค. 2567",
      memoDear: getVal("settingMemoDear") || "ผจก. กฟส.ขก.2 ผ่าน รจก.(ท) กฟส.ขก.2",
      memoProposerName: getVal("settingMemoProposerName") || "นายมารุต พึ่งตน",
      memoProposerPosition: getVal("settingMemoProposerPosition") || "หผ.ปบ.กฟส.ขก.2",
      memoBody: getVal("settingMemoBody") || ""
    };

    SheetsManager.saveSettings(this.settings);
    this.renderLivePreview();
    this.closeAllModals();
    this.showToast("บันทึกการตั้งค่าหัวเอกสารและผู้ลงนามแล้ว", "success");
  },

  // แสดงประวัติการเบิก
  renderHistoryList() {
    const container = document.getElementById("historyList");
    if (!container) return;

    const history = SheetsManager.getHistory();
    if (history.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 30px; color: var(--text-dim);">
          ยังไม่มีประวัติการเบิกที่บันทึกไว้
        </div>
      `;
      return;
    }

    container.innerHTML = history.map(item => `
      <div class="material-item" style="margin-bottom: 8px;">
        <div class="material-info">
          <div class="material-name">เลขที่ใบเบิก: ${item.docNo || "ไม่ระบุเลขที่"}</div>
          <div class="material-meta">
            <span>วันที่: ${PrintEngine.formatThaiDate(item.docDate)}</span>
            <span>จำนวน: ${item.itemCount || (item.items ? item.items.length : 0)} รายการ</span>
          </div>
        </div>
        <div style="display: flex; gap: 6px;">
          <button class="btn btn-secondary btn-sm btn-load-history" data-id="${item.id}">
            โหลดข้อมูล
          </button>
          <button class="btn btn-danger btn-sm btn-icon-only btn-del-history" data-id="${item.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
          </button>
        </div>
      </div>
    `).join("");

    container.querySelectorAll(".btn-load-history").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const entry = history.find(h => h.id === id);
        if (entry && entry.items) {
          this.cart = [...entry.items];
          this.enrichCartStockData();
          this.renderCart();
          this.renderLivePreview();
          this.closeAllModals();
          this.showToast("โหลดรายการจากประวัติเรียบร้อย", "success");
        }
      });
    });

    container.querySelectorAll(".btn-del-history").forEach(btn => {
      btn.addEventListener("click", () => {
        const password = prompt("กรุณากรอกรหัสผ่านเพื่อลบประวัตินี้:");
        if (password !== "Aun") {
          this.showToast("รหัสผ่านไม่ถูกต้อง ไม่สามารถลบประวัติได้", "error");
          return;
        }
        const id = btn.dataset.id;
        SheetsManager.deleteHistoryItem(id);
        this.renderHistoryList();
        this.showToast("ลบประวัติตามต้องการเรียบร้อยแล้ว", "info");
      });
    });
  },

  // State และเมธอดของกระดานเซ็นลายเซ็นดิจิทัล (Digital Signature Pad)
  signaturePad: {
    canvas: null,
    ctx: null,
    isDrawing: false,
    hasSignature: false,
    lastX: 0,
    lastY: 0,
    points: []
  },

  // กำหนดค่า Canvas สำหรับเซ็นชื่อ (รองรับ Mouse, Touch, Stylus)
  initSignaturePad() {
    const canvas = document.getElementById("signatureCanvas");
    if (!canvas) return;

    this.signaturePad.canvas = canvas;
    const ctx = canvas.getContext("2d");
    this.signaturePad.ctx = ctx;

    const setupCanvasScale = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = 180 * dpr;
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.8;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#1e3a8a"; // หมึกสีน้ำเงินเข้มมาตรฐานงานเอกสารราชการ
    };

    setupCanvasScale();

    const getPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: clientX - rect.left,
        y: clientY - rect.top
      };
    };

    const startDraw = (e) => {
      e.preventDefault();
      const pos = getPos(e);
      this.signaturePad.isDrawing = true;
      this.signaturePad.hasSignature = true;
      this.signaturePad.lastX = pos.x;
      this.signaturePad.lastY = pos.y;
      this.signaturePad.points = [pos];

      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();

      const placeholder = document.getElementById("signaturePlaceholder");
      if (placeholder) placeholder.style.display = "none";
    };

    const draw = (e) => {
      if (!this.signaturePad.isDrawing) return;
      e.preventDefault();
      const pos = getPos(e);
      this.signaturePad.points.push(pos);

      // วาดเส้นแบบ Quadratic Curve เพื่อความโค้งมนสวยงามเป็นธรรมชาติเหมือนใช้ปากกาจริง
      if (this.signaturePad.points.length > 2) {
        const p1 = this.signaturePad.points[this.signaturePad.points.length - 2];
        const p2 = this.signaturePad.points[this.signaturePad.points.length - 1];
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;

        ctx.beginPath();
        ctx.moveTo(this.signaturePad.lastX, this.signaturePad.lastY);
        ctx.quadraticCurveTo(p1.x, p1.y, midX, midY);
        ctx.stroke();

        this.signaturePad.lastX = midX;
        this.signaturePad.lastY = midY;
      } else {
        ctx.beginPath();
        ctx.moveTo(this.signaturePad.lastX, this.signaturePad.lastY);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        this.signaturePad.lastX = pos.x;
        this.signaturePad.lastY = pos.y;
      }
    };

    const stopDraw = () => {
      if (this.signaturePad.isDrawing) {
        this.signaturePad.isDrawing = false;
      }
    };

    // Mouse Events
    canvas.addEventListener("mousedown", startDraw);
    canvas.addEventListener("mousemove", draw);
    window.addEventListener("mouseup", stopDraw);
    canvas.addEventListener("mouseleave", stopDraw);

    // Touch Events (รองรับจอสัมผัส / มือถือ / แท็บเล็ต / ปากกา Stylus)
    canvas.addEventListener("touchstart", startDraw, { passive: false });
    canvas.addEventListener("touchmove", draw, { passive: false });
    canvas.addEventListener("touchend", stopDraw);
    canvas.addEventListener("touchcancel", stopDraw);

    // ปุ่มล้างลายเซ็น
    const clearBtn = document.getElementById("clearSignatureBtn");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => this.clearSignaturePad());
    }

    // ปุ่มบันทึกและใช้ลายเซ็น
    const saveBtn = document.getElementById("saveSignatureBtn");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => this.saveSignature());
    }

    // ปุ่มลบลายเซ็นที่มีอยู่ออก
    const removeBtn = document.getElementById("removeSignatureBtn");
    if (removeBtn) {
      removeBtn.addEventListener("click", () => this.removeSignature());
    }

    // อัปโหลดไฟล์ภาพลายเซ็น
    const uploadInput = document.getElementById("uploadSignatureInput");
    if (uploadInput) {
      uploadInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
          this.loadSignatureImage(event.target.result);
        };
        reader.readAsDataURL(file);
      });
    }
  },

  // เปิดหน้าต่างเซ็นชื่อผู้เบิก
  openSignatureModal() {
    this.openModal("signatureModal");
    const canvas = this.signaturePad.canvas;
    if (!canvas) {
      this.initSignaturePad();
    } else {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = 180 * dpr;
      const ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.8;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#1e3a8a";
    }

    const removeBtn = document.getElementById("removeSignatureBtn");
    if (this.settings.requesterSignature) {
      this.loadSignatureImage(this.settings.requesterSignature);
      if (removeBtn) removeBtn.style.display = "inline-flex";
    } else {
      this.clearSignaturePad();
      if (removeBtn) removeBtn.style.display = "none";
    }
  },

  // ล้างกระดานวาด
  clearSignaturePad() {
    const canvas = this.signaturePad.canvas;
    if (!canvas) return;
    const ctx = this.signaturePad.ctx;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.signaturePad.hasSignature = false;
    this.signaturePad.points = [];

    const placeholder = document.getElementById("signaturePlaceholder");
    if (placeholder) placeholder.style.display = "block";
  },

  // วาดภาพลายเซ็นลงบน Canvas
  loadSignatureImage(dataUrl) {
    const canvas = this.signaturePad.canvas;
    const ctx = this.signaturePad.ctx;
    if (!canvas || !ctx) return;

    const img = new Image();
    img.onload = () => {
      this.clearSignaturePad();
      const placeholder = document.getElementById("signaturePlaceholder");
      if (placeholder) placeholder.style.display = "none";

      const rect = canvas.getBoundingClientRect();
      const scale = Math.min((rect.width - 40) / img.width, (180 - 40) / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = (rect.width - w) / 2;
      const y = (180 - h) / 2;

      ctx.drawImage(img, x, y, w, h);
      this.signaturePad.hasSignature = true;
    };
    img.src = dataUrl;
  },

  // ตัดขอบว่างและบันทึกลายเซ็น
  saveSignature() {
    if (!this.signaturePad.hasSignature) {
      alert("กรุณาวาดหรือแนบลายเซ็นก่อนบันทึก");
      return;
    }

    const canvas = this.signaturePad.canvas;
    const trimmedDataUrl = this.getTrimmedSignatureDataUrl(canvas);

    this.settings.requesterSignature = trimmedDataUrl;
    localStorage.setItem("pea_requester_signature", trimmedDataUrl);
    SheetsManager.saveSettings(this.settings);

    this.renderLivePreview();
    this.closeAllModals();
    this.showToast("บันทึกและใส่ลายเซ็นผู้เบิกเรียบร้อย ✍️", "success");
  },

  // ลบลายเซ็นออก
  removeSignature() {
    this.settings.requesterSignature = "";
    localStorage.removeItem("pea_requester_signature");
    SheetsManager.saveSettings(this.settings);

    this.clearSignaturePad();
    this.renderLivePreview();
    this.closeAllModals();
    this.showToast("ลบลายเซ็นผู้เบิกเรียบร้อย", "info");
  },

  // ตัดขอบว่างรอบลายเซ็นให้กระชับพอดี
  getTrimmedSignatureDataUrl(canvas) {
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width;
    const height = canvas.height;
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    let minX = width, minY = height, maxX = 0, maxY = 0;
    let found = false;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const alpha = data[idx + 3];
        if (alpha > 20) {
          found = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (!found) return canvas.toDataURL("image/png");

    const padding = 10 * dpr;
    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(width, maxX + padding);
    maxY = Math.min(height, maxY + padding);

    const trimW = maxX - minX;
    const trimH = maxY - minY;

    const trimCanvas = document.createElement("canvas");
    trimCanvas.width = trimW;
    trimCanvas.height = trimH;
    const trimCtx = trimCanvas.getContext("2d");

    trimCtx.drawImage(canvas, minX, minY, trimW, trimH, 0, 0, trimW, trimH);
    return trimCanvas.toDataURL("image/png");
  },

  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add("active");
  },

  closeAllModals() {
    document.querySelectorAll(".modal-overlay").forEach(m => m.classList.remove("active"));
  },

  escapeHtml(text) {
    if (!text && text !== 0) return "";
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  },

  showToast(message, type = "info") {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${message}</span>`;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(20px)";
      toast.style.transition = "all 0.3s ease";
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }
};

document.addEventListener("DOMContentLoaded", () => {
  App.init();
});
