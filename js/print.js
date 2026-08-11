/**
 * โมดูลสร้างและเรนเดอร์แบบฟอร์มใบเบิกพัสดุ การไฟฟ้าส่วนภูมิภาค (PEA) ขนาด A4
 * ใช้โครงสร้าง Master Table แบบ border-collapse ทำให้เส้นขอบและเส้นตารางทุกเส้นจดกันสนิท 100%
 */

const PrintEngine = {
  PAGE_1_MAX: 28, // แผ่นที่ 1 (กรณี 2 แผ่น): ขยายเต็มพื้นที่ได้ถึง 28 แถวแรก
  PAGE_2_MAX: 22, // แผ่นที่ 2 (แผ่นสุดท้าย / แผ่นเดียว): รายการพัสดุสูงสุด 22 แถว พร้อมช่องลงนามครบถ้วน
  MAX_PAGES: 2,   // ล็อคการพิมพ์สูงสุดไม่เกิน 2 แผ่นต่อใบเบิก

  // แปลงตัวเลขเป็นเลขไทย (Optional)
  toThaiDigits(str) {
    if (!str && str !== 0) return "";
    const thaiNums = ["๐", "๑", "๒", "๓", "๔", "๕", "๖", "๗", "๘", "๙"];
    return String(str).replace(/[0-9]/g, (d) => thaiNums[d]);
  },

  // จัดรูปแบบวันที่ภาษาไทย เช่น 10 สิงหาคม 2569
  formatThaiDate(dateInput, useThaiDigits = false) {
    if (!dateInput) return "";
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return dateInput;

    const thaiMonths = [
      "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
      "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
    ];

    const day = date.getDate();
    const month = thaiMonths[date.getMonth()];
    const year = date.getFullYear() + 543;

    const res = `${day} ${month} ${year}`;
    return useThaiDigits ? this.toThaiDigits(res) : res;
  },

  // สร้าง HTML ของเอกสารใบเบิก A4 ทุกหน้า (แผ่น 1: 28 แถว, แผ่น 2: 22 แถว + ช่องลงนาม)
  renderRequisitionPages(formData, items = []) {
    let totalPages = 1;
    let page1Items = [];
    let page2Items = [];

    if (items.length <= this.PAGE_2_MAX) {
      // รายการไม่เกิน 22 รายการ -> พิมพ์ 1 แผ่นพอดี มีช่องลงนามครบถ้วน (หน้า 1/1)
      totalPages = 1;
      page1Items = items;
    } else {
      // รายการเกิน 22 รายการ -> พิมพ์ 2 แผ่น (หน้า 1/2 และ หน้า 2/2)
      // แผ่นที่ 1: 28 แถวแรก
      // แผ่นที่ 2: รายการที่เหลือ (สูงสุด 22 แถว)
      totalPages = 2;
      page1Items = items.slice(0, this.PAGE_1_MAX);
      page2Items = items.slice(this.PAGE_1_MAX, this.PAGE_1_MAX + this.PAGE_2_MAX);
    }

    let html = "";
    if (totalPages === 1) {
      html += this.renderSinglePage(formData, page1Items, 1, 1);
    } else {
      html += this.renderSinglePage(formData, page1Items, 1, 2);
      html += this.renderSinglePage(formData, page2Items, 2, 2);
    }

    return html;
  },

  // สร้าง HTML 1 หน้า A4 ด้วยโครงสร้าง Master Table ที่สมบูรณ์แบบ
  renderSinglePage(formData, pageItems, pageNum, totalPages) {
    const formattedDate = this.formatThaiDate(formData.docDate || new Date(), false);
    const issueNo = formData.issueNo || "1";
    const isLastPage = (pageNum === totalPages);
    const maxRowsForThisPage = isLastPage ? this.PAGE_2_MAX : this.PAGE_1_MAX;

    // สร้างตารางตามจำนวนรายการจริง (แผ่น 1: สูงสุด 24 แถว, แผ่นสุดท้าย: สูงสุด 22 แถว)
    const rowCount = Math.max(1, Math.min(maxRowsForThisPage, pageItems.length));
    let rowsHtml = "";
    for (let i = 0; i < rowCount; i++) {
      const item = pageItems[i];
      if (item) {
        rowsHtml += `
          <tr class="item-row">
            <td class="col-code">${this.escapeHtml(item.code || "")}</td>
            <td class="col-qty">${this.escapeHtml(String(item.qty || ""))}</td>
            <td class="col-unit">${this.escapeHtml(item.unit || "")}</td>
            <td class="col-desc">${this.escapeHtml(item.name || "")}</td>
            <td class="col-remark">${this.escapeHtml(item.remark || "")}</td>
          </tr>
        `;
      } else {
        // แถวว่างกรณีไม่มีรายการ (อย่างน้อย 1 แถว)
        rowsHtml += `
          <tr class="item-row empty-row">
            <td class="col-code">&nbsp;</td>
            <td class="col-qty">&nbsp;</td>
            <td class="col-unit">&nbsp;</td>
            <td class="col-desc">&nbsp;</td>
            <td class="col-remark">&nbsp;</td>
          </tr>
        `;
      }
    }

    return `
      <div class="pea-a4-page">
        <!-- ตารางหลักของแบบฟอร์มเอกสารใบเบิก (Master Table) เชื่อมต่อเส้นขอบ 100% -->
        <table class="pea-master-table">
          <colgroup>
            <col style="width: 20%;">
            <col style="width: 9%;">
            <col style="width: 9%;">
            <col style="width: 46%;">
            <col style="width: 16%;">
          </colgroup>
          
          <tbody>
            <!-- แถวที่ 1: ส่วนหัว (โลโก้ กฟภ. ด้านซ้าย + สังกัดหน่วยงานด้านขวา พร้อมระบุเลขหน้ามุมบนขวา) -->
            <tr>
              <td colspan="2" class="cell-logo">
                <div class="logo-container-flex">
                  <img src="assets/pea-logo.png" alt="การไฟฟ้าส่วนภูมิภาค" class="pea-logo-img" />
                  <div class="logo-subtext">การไฟฟ้าส่วนภูมิภาคสาขาเมืองขอนแก่น 2</div>
                </div>
              </td>
              <td colspan="3" class="cell-header-info">
                <table class="nested-info-table">
                  <tr>
                    <td class="lbl-issue">ฉบับที่ ${issueNo}</td>
                    <td class="val-issue">
                      <div class="val-issue-flex">
                        <span>${this.escapeHtml(formData.destinationWarehouse || "ส่งให้คลังพัสดุจ่าย")}</span>
                        <span class="page-counter-top-right">หน้า ${pageNum}/${totalPages}</span>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td class="lbl-dept">กฟฟ. / เขต</td>
                    <td class="val-dept">${this.escapeHtml(formData.region || "กฟฉ.1")}</td>
                  </tr>
                  <tr>
                    <td class="lbl-dept">แผนก</td>
                    <td class="val-dept">${this.escapeHtml(formData.department || "ปฏิบัติการระบบไฟฟ้าและบำรุงรักษา (2601) (คลังสำรองแก้ไฟ) (2601)")}</td>
                  </tr>
                  <tr>
                    <td class="lbl-dept" style="border-bottom: none;">การไฟฟ้า</td>
                    <td class="val-dept" style="border-bottom: none;">${this.escapeHtml(formData.electricityOffice || "กฟส.ขอนแก่น 2")}</td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- แถวที่ 2: ข้อมูลเอกสาร (ชื่อใบเบิก, เลขที่, ใบส่งของเลขที่, ลงวันที่) -->
            <tr>
              <td colspan="2" class="cell-meta-title">
                <div class="title-bold">ใบเบิกของ</div>
                <div class="doc-number-line">เลขที่ <span class="fill-text">${this.escapeHtml(formData.docNo || "........................")}</span></div>
              </td>
              <td colspan="3" class="cell-meta-right-group">
                <div class="meta-flex-container">
                  <div class="cell-meta-delivery-part">
                    <div>ใบส่งของเลขที่</div>
                    <div class="delivery-number-line">${this.escapeHtml(formData.deliveryNo || "")}</div>
                  </div>
                  <div class="cell-meta-date-part">
                    <div>ลงวันที่</div>
                    <div class="date-text">${formattedDate}</div>
                  </div>
                </div>
              </td>
            </tr>

            <!-- แถวที่ 3: จุดหมายและวัตถุประสงค์การใช้งาน (รวมช่องสำหรับใช้งานเป็นช่องเดียว) -->
            <tr>
              <td colspan="2" class="cell-dest-warehouse">
                <div class="dest-label">โดยให้ส่งไปที่กอง / คลังพัสดุ</div>
                <div class="dest-value">${this.escapeHtml(formData.sendToWarehouse || "")}</div>
              </td>
              <td colspan="3" class="cell-dest-purpose">
                <div class="dest-label">สำหรับใช้งาน</div>
                <div class="dest-value">${this.escapeHtml(formData.purpose || "บริการแก้กระแสไฟฟ้าขัดข้องในเขตพื้นที่ กฟส.ขอนแก่น 2 (มะลิวัลย์)")}</div>
              </td>
            </tr>

            <!-- แถวที่ 4: หัวตารางรายการพัสดุ -->
            <tr class="th-row">
              <th class="th-code">รหัสพัสดุ</th>
              <th class="th-qty">จำนวน</th>
              <th class="th-unit">หน่วยนับ</th>
              <th class="th-desc">รายการ</th>
              <th class="th-remark">หมายเหตุ</th>
            </tr>

            <!-- แถวที่ 5: รายการพัสดุ -->
            ${rowsHtml}

            <!-- ส่วนลงนามท้ายใบเบิก (แสดงเฉพาะแผ่นสุดท้ายของเอกสาร) -->
            ${pageNum === totalPages ? `
              <tr>
                <td colspan="5" class="cell-signatures">
                  <!-- ผู้เบิก (แถวบน ตรงกลาง - รองรับการเซ็นออนไลน์) -->
                  <div class="sig-row-requester">
                    <div class="requester-box" id="clickableRequesterSigBox" title="คลิกเพื่อเซ็นชื่อออนไลน์">
                      <div class="sig-image-slot">
                        ${formData.requesterSignature ? `
                          <img src="${formData.requesterSignature}" class="requester-digital-sig-img" alt="ลายเซ็นผู้เบิก" />
                        ` : ""}
                      </div>
                      <div class="sig-line">ลงชื่อ .................................................... ผู้เบิก</div>
                      <div class="sig-name">(${this.escapeHtml(formData.requesterName || "....................................................")})</div>
                    </div>
                  </div>

                  <!-- 3 คอลัมน์ (ผู้ตรวจ / หัวหน้าคลังพัสดุ / ผู้อนุมัติ) -->
                  <div class="sig-row-approvers">
                    <!-- ผู้ตรวจ -->
                    <div class="sig-box">
                      <div class="sig-line">ลงชื่อ ....................................................</div>
                      <div class="sig-name">(${this.escapeHtml(formData.checkerName || "....................................................")})</div>
                      <div class="sig-role">ผู้ตรวจ</div>
                    </div>

                    <!-- หัวหน้าคลังพัสดุ -->
                    <div class="sig-box">
                      <div class="sig-line">ลงชื่อ ....................................................</div>
                      <div class="sig-name">(${this.escapeHtml(formData.warehouseHeadName || "....................................................")})</div>
                      <div class="sig-role">หัวหน้าคลังพัสดุ</div>
                    </div>

                    <!-- ผู้อนุมัติ -->
                    <div class="sig-box">
                      <div class="sig-line">ลงชื่อ ....................................................</div>
                      <div class="sig-name">(${this.escapeHtml(formData.approverName || "....................................................")})</div>
                      <div class="sig-role">ผู้อนุมัติ</div>
                    </div>
                  </div>
                </td>
              </tr>
            ` : ""}

          </tbody>
        </table>
      </div>
    `;
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

  // สั่งพิมพ์ (รองรับเบราว์เซอร์บนคอมพิวเตอร์ และระบบพิมพ์/เซฟ PDF บนมือถือ & iPad)
  printDocument() {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    if (isMobile) {
      // เปิดหน้าต่างใหม่สำหรับการพิมพ์ (Mobile Print Workaround เพื่อให้เรียก Dialog พิมพ์ของระบบปฏิบัติการมือถือขึ้นมาสำเร็จ)
      const printWindow = window.open("", "_blank");
      if (printWindow) {
        let stylesHtml = "";
        // คัดลอก CSS ทั้งหมดในหน้าปัจจุบัน
        document.querySelectorAll('link[rel="stylesheet"], style').forEach(el => {
          stylesHtml += el.outerHTML;
        });

        const previewContent = document.getElementById("livePreviewContainer").innerHTML;

        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>พิมพ์ใบเบิกพัสดุ กฟภ.</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            ${stylesHtml}
            <style>
              body {
                background: #ffffff !important;
                padding: 0 !important;
                margin: 0 !important;
              }
              .pea-a4-page {
                box-shadow: none !important;
                border: none !important;
                margin: 0 auto !important;
              }
              @media print {
                .pea-a4-page {
                  page-break-inside: avoid !important;
                  break-inside: avoid !important;
                }
                .pea-a4-page:not(:last-child) {
                  page-break-after: always !important;
                  break-after: page !important;
                }
              }
            </style>
          </head>
          <body>
            <div id="printDocumentArea">
              ${previewContent}
            </div>
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
      } else {
        // กรณีเบราว์เซอร์มือถือบล็อกหน้าต่างใหม่ ให้ถอยกลับมาใช้การพิมพ์หน้าตรงปกติ
        window.print();
      }
    } else {
      // บน Desktop สามารถเรียกใช้ print() ของหน้าหลักได้ทันทีอย่างสมบูรณ์
      window.print();
    }
  }
};
