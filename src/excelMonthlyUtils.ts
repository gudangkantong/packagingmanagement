import ExcelJS from 'exceljs';
import { LaporanKantong } from './types';

const PABRIK_SHORT: Record<string, string> = {
  "Pabrik Baturaja 1 (PBR 1)": "PBR 1",
  "Pabrik Baturaja 2 (PBR 2)": "PBR 2",
  "Pabrik Palembang (PPG)": "PPG",
  "Pabrik Panjang (PPJ)": "PPJ",
};

const MONTH_NAMES = ["", "JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];

// === STYLES ===
const fontTitle = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } } as Partial<ExcelJS.Font>;
const fontSub = { name: 'Calibri', size: 11, color: { argb: 'FFFFFFFF' } } as Partial<ExcelJS.Font>;
const fontSection = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF2E7D32' } } as Partial<ExcelJS.Font>;
const fontHeader = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } } as Partial<ExcelJS.Font>;
const fontData = { name: 'Calibri', size: 10 } as Partial<ExcelJS.Font>;
const fontSubtotal = { name: 'Calibri', size: 10, bold: true } as Partial<ExcelJS.Font>;
const fontNol = { name: 'Calibri', size: 10, color: { argb: 'FF9CA3AF' } } as Partial<ExcelJS.Font>;

const fillGreen = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } } as Partial<ExcelJS.Fill>;
const fillGreenLight = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } } as Partial<ExcelJS.Fill>;

// Blue styles for summary sheets (preview layout)
const fillBlue = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } } as Partial<ExcelJS.Fill>;
const fillBlueLight = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F2FD' } } as Partial<ExcelJS.Fill>;
const fontWhite = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } } as Partial<ExcelJS.Font>;

const setCell = (ws: ExcelJS.Worksheet, r: number, c: number, value: any, font?: Partial<ExcelJS.Font>, fill?: Partial<ExcelJS.Fill>, align?: string) => {
  const cell = ws.getCell(r, c);
  cell.value = value;
  if (typeof value === 'number') cell.numFmt = '#,##0';
  if (font) cell.font = font as ExcelJS.Font;
  if (fill) cell.fill = fill as ExcelJS.Fill;
  if (align === 'right') cell.alignment = { horizontal: 'right' };
  else if (align === 'center') cell.alignment = { horizontal: 'center' };
  cell.border = { top: { style: 'thin', color: { argb: 'FFD0D0D0' } }, bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } }, left: { style: 'thin', color: { argb: 'FFD0D0D0' } }, right: { style: 'thin', color: { argb: 'FFD0D0D0' } } };
};

const setMergedCell = (ws: ExcelJS.Worksheet, r1: number, c1: number, r2: number, c2: number, value: any, font?: Partial<ExcelJS.Font>, fill?: Partial<ExcelJS.Fill>, align?: string) => {
  ws.mergeCells(r1, c1, r2, c2);
  const cell = ws.getCell(r1, c1);
  cell.value = value;
  if (font) cell.font = font as ExcelJS.Font;
  if (fill) cell.fill = fill as ExcelJS.Fill;
  if (align === 'center') cell.alignment = { horizontal: 'center', vertical: 'middle' };
  else cell.alignment = { horizontal: 'center', vertical: 'middle' };
};

const setFormula = (ws: ExcelJS.Worksheet, r: number, c: number, formula: string, font?: Partial<ExcelJS.Font>, fill?: Partial<ExcelJS.Fill>, align?: string) => {
  const cell = ws.getCell(r, c);
  cell.value = { formula } as any;
  // Percentage formulas contain *100 → format as percent; else thousands separator
  cell.numFmt = formula.includes('*100') ? '0.0"%"' : '#,##0';
  if (font) cell.font = font as ExcelJS.Font;
  if (fill) cell.fill = fill as ExcelJS.Fill;
  if (align === 'right') cell.alignment = { horizontal: 'right' };
  else if (align === 'center') cell.alignment = { horizontal: 'center' };
  cell.border = { top: { style: 'thin', color: { argb: 'FFD0D0D0' } }, bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } }, left: { style: 'thin', color: { argb: 'FFD0D0D0' } }, right: { style: 'thin', color: { argb: 'FFD0D0D0' } } };
};

const blockBorder = { style: 'medium', color: { argb: 'FFB0B0B0' } } as const;

const applyBlockBorder = (ws: ExcelJS.Worksheet, r1: number, c1: number, r2: number, c2: number) => {
  for (let r = r1; r <= r2; r++) {
    const left = ws.getCell(r, c1);
    const right = ws.getCell(r, c2);
    left.border = { ...left.border, left: blockBorder };
    right.border = { ...right.border, right: blockBorder };
  }
  for (let c = c1; c <= c2; c++) {
    const top = ws.getCell(r1, c);
    const bottom = ws.getCell(r2, c);
    top.border = { ...top.border, top: blockBorder };
    bottom.border = { ...bottom.border, bottom: blockBorder };
  }
};

const colLetter = (col: number): string => {
  let n = col;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

const daysInMonth = (year: number, month: number): number => new Date(year, month, 0).getDate();

export interface MonthlyExcelOptions {
  reports: LaporanKantong[];
  selectedMonth: string;
  currentUserEmail: string | null | undefined;
}

interface ProdSheetInfo {
  sheetName: string;
  vendors: string[];
  prodCols: number; // columns per vendor in detail sheet (always 8: UTUH,PCH,%PCH,SRT,%SRT,MAS,LAB,TOTAL)
}

// Columns per vendor in detail sheet (0-based offset within vendor block)
const V_UTUH = 0;
const V_PCH = 1;
const V_PCH_PCT = 2;
const V_SRT = 3;
const V_SRT_PCT = 4;
const V_MAS = 5;
const V_LAB = 6;
const V_TOTAL = 7;
const V_COLS = 8; // per vendor

// Columns per product in Data Produksi summary sheet
const DP_UTUH = 0;
const DP_PCH = 1;
const DP_SRT = 2;
const DP_JUMLAH = 3;
const DP_COLS = 4; // per product

// ============================================================
// PREVIEW SHEET: per-factory summary (matches React preview layout)
// ============================================================
const writePreviewSheet = (
  ws: ExcelJS.Worksheet,
  reports: LaporanKantong[],
  products: string[],
  siteName: string,
  monthName: string,
  year: number,
  dim: number
) => {
  // Build daily × product data (aggregate across vendors)
  const daily: Map<number, Map<string, { utuh: number; pecah: number; sortir: number; total: number }>> = new Map();
  for (let d = 1; d <= dim; d++) {
    daily.set(d, new Map());
    for (const p of products) {
      daily.get(d)!.set(p, { utuh: 0, pecah: 0, sortir: 0, total: 0 });
    }
  }
  for (const r of reports) {
    const day = parseInt(r.tanggal.split('-')[2]);
    if (!daily.has(day)) continue;
    const dd = daily.get(day)!;
    if (dd.has(r.nama)) {
      const cur = dd.get(r.nama)!;
      cur.utuh += r.utuh; cur.pecah += r.pecah; cur.sortir += r.sortir; cur.total += r.total;
    }
  }

  const totalCols = 1 + products.length * DP_COLS;
  let row = 1;

  // Row 1: Title
  setMergedCell(ws, row, 1, row, totalCols, `PEMAKAIAN KANTONG ${siteName.toUpperCase()} ${monthName} ${year}`, { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }, fillBlue, 'center');
  const previewBlockStart = row;
  row++;

  // R2: TGL + product headers
  setCell(ws, row, 1, 'TGL', fontWhite, fillBlue, 'center');
  let c = 2;
  for (const p of products) {
    setMergedCell(ws, row, c, row, c + DP_COLS - 1, p, fontWhite, fillBlue, 'center');
    c += DP_COLS;
  }
  row++;

  // R3: Sub-headers
  setCell(ws, row, 1, '', null, fillBlueLight, 'center');
  c = 2;
  for (const _p of products) {
    setCell(ws, row, c, 'UTUH', fontSubtotal, fillBlueLight, 'center'); c++;
    setCell(ws, row, c, 'PCH', fontSubtotal, fillBlueLight, 'center'); c++;
    setCell(ws, row, c, 'SRT', fontSubtotal, fillBlueLight, 'center'); c++;
    setCell(ws, row, c, 'TOT', fontSubtotal, fillBlueLight, 'center'); c++;
  }
  row++;

  // Data rows
  const days1 = Math.min(15, dim);
  const days2 = dim - days1;

  // Days 1-15
  for (let d = 1; d <= days1; d++) {
    setCell(ws, row, 1, d, fontData, undefined, 'center');
    c = 2;
    for (const p of products) {
      const v = daily.get(d)!.get(p)!;
      const h = v.total > 0;
      setCell(ws, row, c, h ? v.utuh : 0, fontData, undefined, 'right'); c++;
      setCell(ws, row, c, h ? v.pecah : 0, fontData, undefined, 'right'); c++;
      setCell(ws, row, c, h ? v.sortir : 0, fontData, undefined, 'right'); c++;
      setCell(ws, row, c, h ? v.total : 0, fontData, undefined, 'right'); c++;
    }
    row++;
  }

  // SUB A
  if (days1 > 0) {
    setCell(ws, row, 1, 'SUB A', fontSubtotal, fillBlueLight, 'center');
    c = 2;
    for (const p of products) {
      let su = 0, sp = 0, ss = 0, st = 0;
      for (let d = 1; d <= days1; d++) {
        const v = daily.get(d)!.get(p)!;
        su += v.utuh; sp += v.pecah; ss += v.sortir; st += v.total;
      }
      setCell(ws, row, c, su, fontSubtotal, fillBlueLight, 'right'); c++;
      setCell(ws, row, c, sp, fontSubtotal, fillBlueLight, 'right'); c++;
      setCell(ws, row, c, ss, fontSubtotal, fillBlueLight, 'right'); c++;
      setCell(ws, row, c, st, fontSubtotal, fillBlueLight, 'right'); c++;
    }
    row++;
  }

  // Days 16-31
  for (let d = days1 + 1; d <= dim; d++) {
    setCell(ws, row, 1, d, fontData, undefined, 'center');
    c = 2;
    for (const p of products) {
      const v = daily.get(d)!.get(p)!;
      const h = v.total > 0;
      setCell(ws, row, c, h ? v.utuh : 0, fontData, undefined, 'right'); c++;
      setCell(ws, row, c, h ? v.pecah : 0, fontData, undefined, 'right'); c++;
      setCell(ws, row, c, h ? v.sortir : 0, fontData, undefined, 'right'); c++;
      setCell(ws, row, c, h ? v.total : 0, fontData, undefined, 'right'); c++;
    }
    row++;
  }

  // SUB B
  if (days2 > 0) {
    setCell(ws, row, 1, 'SUB B', fontSubtotal, fillBlueLight, 'center');
    c = 2;
    for (const p of products) {
      let su = 0, sp = 0, ss = 0, st = 0;
      for (let d = days1 + 1; d <= dim; d++) {
        const v = daily.get(d)!.get(p)!;
        su += v.utuh; sp += v.pecah; ss += v.sortir; st += v.total;
      }
      setCell(ws, row, c, su, fontSubtotal, fillBlueLight, 'right'); c++;
      setCell(ws, row, c, sp, fontSubtotal, fillBlueLight, 'right'); c++;
      setCell(ws, row, c, ss, fontSubtotal, fillBlueLight, 'right'); c++;
      setCell(ws, row, c, st, fontSubtotal, fillBlueLight, 'right'); c++;
    }
    row++;
  }

  // TOTAL
  setCell(ws, row, 1, 'TOTAL', { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF1565C0' } }, fillBlueLight, 'center');
  c = 2;
  for (const p of products) {
    let su = 0, sp = 0, ss = 0, st = 0;
    for (let d = 1; d <= dim; d++) {
      const v = daily.get(d)!.get(p)!;
      su += v.utuh; sp += v.pecah; ss += v.sortir; st += v.total;
    }
    setCell(ws, row, c, su, fontSubtotal, fillBlueLight, 'right'); c++;
    setCell(ws, row, c, sp, fontSubtotal, fillBlueLight, 'right'); c++;
    setCell(ws, row, c, ss, fontSubtotal, fillBlueLight, 'right'); c++;
    setCell(ws, row, c, st, fontSubtotal, fillBlueLight, 'right'); c++;
  }

  // Column widths
  ws.getColumn(1).width = 5;
  for (let pi = 0; pi < products.length; pi++) {
    for (let si = 0; si < DP_COLS; si++) {
      ws.getColumn(2 + pi * DP_COLS + si).width = si === DP_JUMLAH ? 10 : 12;
    }
  }

  // Freeze header rows (R1:title, R2:TGL+product, R3:sub-headers)
  ws.views = [{ state: 'frozen', ySplit: 3 }];
  applyBlockBorder(ws, previewBlockStart, 1, row - 1, totalCols);
};

// ============================================================
// CORE: generate monthly workbook
// ============================================================
export const generateMonthlyReport = async (opts: MonthlyExcelOptions): Promise<ExcelJS.Workbook> => {
  const { reports, selectedMonth } = opts;
  const [yearStr, monthStr] = selectedMonth.split('-');
  const year = parseInt(yearStr);
  const month = parseInt(monthStr);
  const monthName = MONTH_NAMES[month];
  const dim = daysInMonth(year, month);

  const monthReports = reports.filter(r => r.tanggal.startsWith(selectedMonth));
  const siteKeys = ['PBR 1', 'PBR 2', 'PPG', 'PPJ'];
  const wb = new ExcelJS.Workbook();

  // PASS 1: Summary sheets (blue, matches preview) — sheets 1-4
  const allSites: { reports: LaporanKantong[]; siteKey: string; siteName: string; products: string[] }[] = [];
  for (const siteKey of siteKeys) {
    const fullLabel = Object.entries(PABRIK_SHORT).find(([, v]) => v === siteKey)?.[0] || siteKey;
    const siteReports = monthReports.filter(r => r.pabrik === fullLabel);
    if (siteReports.length === 0) continue;

    const siteName = fullLabel.replace(/^Pabrik\s+/, '');
    const products = [...new Set(siteReports.map(r => r.nama))].sort((a, b) => {
      const aBig = a.startsWith('BIGBAG');
      const bBig = b.startsWith('BIGBAG');
      if (aBig && !bBig) return 1;
      if (!aBig && bBig) return -1;
      return a.localeCompare(b);
    });

    // Summary sheet (blue, data langsung seperti preview)
    const ws = wb.addWorksheet(siteKey);
    writePreviewSheet(ws, siteReports, products, siteName, monthName, year, dim);

    allSites.push({ reports: siteReports, siteKey, siteName, products });
  }

  // PASS 2: Product detail sheets — sheets 5+
  for (const site of allSites) {
    for (const product of site.products) {
      const prodReports = site.reports.filter(r => r.nama === product);
      const vendors = [...new Set(prodReports.map(r => r.vendor))].sort();
      if (vendors.length === 0) continue;

      const rawName = `${product} ${site.siteKey}`;
      const cleanName = rawName.replace(/[\\\/\?\*\[\]]/g, '_');
      const wsProd = wb.addWorksheet(cleanName);
      writeProductSheet(wsProd, prodReports, product, site.siteName, vendors, dim);
    }
  }

  return wb;
};

// ============================================================
// DETAIL SHEET: per product × per vendor (8 cols/vendor)
// UTUH | PCH | %PCH | SRT | %SRT | MAS | LAB | TOTAL(=UTUH+PCH+SRT+MAS+LAB)
// ============================================================
const writeProductSheet = (
  ws: ExcelJS.Worksheet, reports: LaporanKantong[],
  productName: string, siteName: string,
  vendors: string[], dim: number
) => {
  // Build daily × vendor data
  const daily: Map<number, Map<string, { utuh: number; pecah: number; sortir: number; total: number }>> = new Map();
  for (let d = 1; d <= dim; d++) {
    daily.set(d, new Map());
    for (const v of vendors) {
      daily.get(d)!.set(v, { utuh: 0, pecah: 0, sortir: 0, total: 0 });
    }
  }
  for (const r of reports) {
    const day = parseInt(r.tanggal.split('-')[2]);
    if (!daily.has(day)) continue;
    const dd = daily.get(day)!;
    if (dd.has(r.vendor)) {
      const cur = dd.get(r.vendor)!;
      cur.utuh += r.utuh; cur.pecah += r.pecah; cur.sortir += r.sortir; cur.total += r.total;
    }
  }

  const totalCols = 1 + vendors.length * V_COLS; // TGL col + all vendor blocks
  const colGap = 1; // gap column between vendor blocks
  let row = 1;

  // Row 2: Vendor names (merged over each vendor block)
  row++; // skip row 2 as empty (matches sample)
  // Actually looking at the sample more carefully:
  // BIGBAG PCC PBR 2 sheet has:
  // R1: PEMAKAIAN KANTONG BIGBAG PCC PBR 2 (merged B1:AJ1)
  // R2: TGL | VENDOR 1 merged B2:I2 | VENDOR 2 merged K2:R2 | VENDOR 3 merged T2:AA2
  // R3: (sub columns)
  // R4: (KELUAR labels)
  // R5+: data

  // So let me follow this layout:
  // Row 1: Title (merged B:last)
  // Row 2: TGL | Vendor 1 block merged | Vendor 2 block merged | ...
  // Row 3: sub-column headers for each vendor
  // Row 4: (optional) TOTAL column labeled "KELUAR"

  // Actually, for simplicity, let me match exactly:
  // R1: Title (merged)
  // R2: TGL (A2) | Vendor1 (B2:I2) | Vendor2 (K2:R2) | ...
  // R3: sub columns (B3:UTUH, C3:PCH, D3:%PCH, etc.)
  // R4: "KELUAR" under TOTAL column (I4, R4, AA4)
  // R5+: data rows

  // Reset:
  row = 1;
  setMergedCell(ws, row, 1, 1, totalCols, `PEMAKAIAN KANTONG ${productName.toUpperCase()} ${siteName}`, fontTitle, fillGreen);
  row = 2;

  // Row 2: TGL + vendor blocks
  setCell(ws, row, 1, 'TGL', fontHeader, fillGreen, 'center');
  let c = 2;
  for (let vi = 0; vi < vendors.length; vi++) {
    const blockEnd = c + V_COLS - 1;
    setMergedCell(ws, row, c, row, blockEnd, vendors[vi], fontSection, fillGreenLight);
    c = blockEnd + 1 + colGap;
  }

  row = 3;
  // Row 3: sub-column headers
  const subHeaders = ['UTUH', 'PCH', '%PCH', 'SRT', '%SRT', 'MAS', 'LAB', 'TOTAL'];
  c = 2;
  for (let vi = 0; vi < vendors.length; vi++) {
    for (let si = 0; si < V_COLS; si++) {
      setCell(ws, row, c, subHeaders[si], fontHeader, fillGreen, 'center');
      c++;
    }
    c++; // gap column
  }
  setCell(ws, row, 1, '', fontHeader, fillGreen, 'center');

  row = 4;
  // Row 4: "KELUAR" under TOTAL columns
  c = 2 + V_TOTAL; // TOTAL is offset 7, column 2+7 = 9 = I
  for (let vi = 0; vi < vendors.length; vi++) {
    setCell(ws, row, c, 'KELUAR', fontHeader, fillGreen, 'center');
    c += V_COLS + colGap;
  }
  setCell(ws, row, 1, '', fontHeader, fillGreen, 'center');

  // ── Data rows ──
  const days1 = Math.min(15, dim);
  const days2 = dim - days1;

  const rowDataStart = 5;

  // Days 1-15
  let dataRow = 5;
  const rowSubA = dataRow;
  const detailBlockStart = 1;
  for (let d = 1; d <= days1; d++) {
    setCell(ws, dataRow, 1, d, fontData, undefined, 'center');
    const dd = daily.get(d)!;
    c = 2;
    for (const v of vendors) {
      const cur = dd.get(v)!;
      const hasData = cur.total > 0;
      const f = hasData ? fontData : fontNol;
      const bg = hasData ? fillGreenLight : undefined;

      setCell(ws, dataRow, c, cur.utuh, f, bg, 'right'); c++; // UTUH
      setCell(ws, dataRow, c, cur.pecah, f, bg, 'right'); c++; // PCH
      // %PCH formula
      const utuhCol = colLetter(c - 2);
      const pchCol = colLetter(c - 1);
      if (hasData && cur.utuh + cur.pecah > 0) {
        setFormula(ws, dataRow, c, `${pchCol}${dataRow}/(${pchCol}${dataRow}+${utuhCol}${dataRow})*100`, f, bg, 'right');
      } else {
        setCell(ws, dataRow, c, '-', fontNol, undefined, 'right');
      }
      c++;

      setCell(ws, dataRow, c, cur.sortir, f, bg, 'right'); c++; // SRT
      // %SRT formula
      const srtCol = colLetter(c - 1);
      if (hasData && cur.utuh + cur.sortir > 0) {
        setFormula(ws, dataRow, c, `${srtCol}${dataRow}/(${srtCol}${dataRow}+${utuhCol}${dataRow})*100`, f, bg, 'right');
      } else {
        setCell(ws, dataRow, c, '-', fontNol, undefined, 'right');
      }
      c++;

      setCell(ws, dataRow, c, 0, fontNol, undefined, 'right'); c++; // MAS = 0
      setCell(ws, dataRow, c, 0, fontNol, undefined, 'right'); c++; // LAB = 0
      // TOTAL formula = UTUH+PCH+SRT (MAS+LAB dummy 0)
      const totalUtuh = colLetter(c - 7);
      const totalPch = colLetter(c - 6);
      const totalSrt = colLetter(c - 4);
      setFormula(ws, dataRow, c, `${totalUtuh}${dataRow}+${totalPch}${dataRow}+${totalSrt}${dataRow}`, f, bg, 'right');
      c++;

      c++; // gap column
    }
    dataRow++;
  }

  // SUB A row
  const subARow = dataRow;
  setCell(ws, dataRow, 1, 'SUB A', fontSubtotal, fillGreenLight, 'center');
  c = 2;
  for (let vi = 0; vi < vendors.length; vi++) {
    for (let si = 0; si < V_COLS; si++) {
      const startRow = rowSubA;
      const endRow = subARow - 1;
      if (si === V_PCH_PCT || si === V_SRT_PCT) {
        // %PCH or %SRT: special formula
        if (si === V_PCH_PCT) {
          const utuhCol = colLetter(c - 2);
          const pchCol = colLetter(c - 1);
          setFormula(ws, dataRow, c, `${pchCol}${dataRow}/(${pchCol}${dataRow}+${utuhCol}${dataRow})*100`, fontSubtotal, fillGreenLight, 'right');
        } else {
          const utuhCol = colLetter(c - 3);
          const srtCol = colLetter(c - 1);
          setFormula(ws, dataRow, c, `${srtCol}${dataRow}/(${srtCol}${dataRow}+${utuhCol}${dataRow})*100`, fontSubtotal, fillGreenLight, 'right');
        }
      } else {
        setFormula(ws, dataRow, c, `SUM(${colLetter(c)}${startRow}:${colLetter(c)}${endRow})`, fontSubtotal, fillGreenLight, 'right');
      }
      c++;
    }
    c++; // gap
  }
  dataRow++;

  // Days 16-31
  const rowSubB = dataRow;
  for (let d = days1 + 1; d <= dim; d++) {
    setCell(ws, dataRow, 1, d, fontData, undefined, 'center');
    const dd = daily.get(d)!;
    c = 2;
    for (const v of vendors) {
      const cur = dd.get(v)!;
      const hasData = cur.total > 0;
      const f = hasData ? fontData : fontNol;
      const bg = hasData ? fillGreenLight : undefined;

      setCell(ws, dataRow, c, cur.utuh, f, bg, 'right'); c++;
      setCell(ws, dataRow, c, cur.pecah, f, bg, 'right'); c++;
      const utuhCol = colLetter(c - 2);
      const pchCol = colLetter(c - 1);
      if (hasData && cur.utuh + cur.pecah > 0) {
        setFormula(ws, dataRow, c, `${pchCol}${dataRow}/(${pchCol}${dataRow}+${utuhCol}${dataRow})*100`, f, bg, 'right');
      } else {
        setCell(ws, dataRow, c, '-', fontNol, undefined, 'right');
      }
      c++;

      setCell(ws, dataRow, c, cur.sortir, f, bg, 'right'); c++;
      const srtCol = colLetter(c - 1);
      if (hasData && cur.utuh + cur.sortir > 0) {
        setFormula(ws, dataRow, c, `${srtCol}${dataRow}/(${srtCol}${dataRow}+${utuhCol}${dataRow})*100`, f, bg, 'right');
      } else {
        setCell(ws, dataRow, c, '-', fontNol, undefined, 'right');
      }
      c++;

      setCell(ws, dataRow, c, 0, fontNol, undefined, 'right'); c++; // MAS = 0
      setCell(ws, dataRow, c, 0, fontNol, undefined, 'right'); c++; // LAB = 0
      const totalUtuh = colLetter(c - 7);
      const totalPch = colLetter(c - 6);
      const totalSrt = colLetter(c - 4);
      setFormula(ws, dataRow, c, `${totalUtuh}${dataRow}+${totalPch}${dataRow}+${totalSrt}${dataRow}`, f, bg, 'right');
      c++;

      c++; // gap
    }
    dataRow++;
  }

  // SUB B row
  const subBRow = dataRow;
  setCell(ws, dataRow, 1, 'SUB B', fontSubtotal, fillGreenLight, 'center');
  c = 2;
  for (let vi = 0; vi < vendors.length; vi++) {
    for (let si = 0; si < V_COLS; si++) {
      const startRow = rowSubB;
      const endRow = subBRow - 1;
      if (si === V_PCH_PCT || si === V_SRT_PCT) {
        if (si === V_PCH_PCT) {
          const utuhCol = colLetter(c - 2);
          const pchCol = colLetter(c - 1);
          setFormula(ws, dataRow, c, `${pchCol}${dataRow}/(${pchCol}${dataRow}+${utuhCol}${dataRow})*100`, fontSubtotal, fillGreenLight, 'right');
        } else {
          const utuhCol = colLetter(c - 3);
          const srtCol = colLetter(c - 1);
          setFormula(ws, dataRow, c, `${srtCol}${dataRow}/(${srtCol}${dataRow}+${utuhCol}${dataRow})*100`, fontSubtotal, fillGreenLight, 'right');
        }
      } else {
        setFormula(ws, dataRow, c, `SUM(${colLetter(c)}${startRow}:${colLetter(c)}${endRow})`, fontSubtotal, fillGreenLight, 'right');
      }
      c++;
    }
    c++; // gap
  }
  dataRow++;

  // TOTAL row
  setCell(ws, dataRow, 1, 'TOTAL', fontSubtotal, fillGreenLight, 'center');
  c = 2;
  for (let vi = 0; vi < vendors.length; vi++) {
    for (let si = 0; si < V_COLS; si++) {
      if (si === V_PCH_PCT) {
        const utuhCol = colLetter(c - 2);
        const pchCol = colLetter(c - 1);
        setFormula(ws, dataRow, c, `(${pchCol}${subARow}+${pchCol}${subBRow})/((${pchCol}${subARow}+${pchCol}${subBRow})+(${utuhCol}${subARow}+${utuhCol}${subBRow}))*100`, fontSubtotal, fillGreenLight, 'right');
      } else if (si === V_SRT_PCT) {
        const utuhCol = colLetter(c - 3);
        const srtCol = colLetter(c - 1);
        setFormula(ws, dataRow, c, `(${srtCol}${subARow}+${srtCol}${subBRow})/((${srtCol}${subARow}+${srtCol}${subBRow})+(${utuhCol}${subARow}+${utuhCol}${subBRow}))*100`, fontSubtotal, fillGreenLight, 'right');
      } else {
        setFormula(ws, dataRow, c, `${colLetter(c)}${subARow}+${colLetter(c)}${subBRow}`, fontSubtotal, fillGreenLight, 'right');
      }
      c++;
    }
    c++; // gap
  }

  // Column widths
  ws.getColumn(1).width = 5;
  for (let vi = 0; vi < vendors.length; vi++) {
    const widths = [12, 10, 9, 10, 9, 8, 8, 10]; // UTUH,PCH,%PCH,SRT,%SRT,MAS,LAB,TOTAL
    for (let si = 0; si < V_COLS; si++) {
      const colIdx = 2 + vi * (V_COLS + colGap) + si;
      ws.getColumn(colIdx).width = widths[si];
    }
    // gap column
    const gapIdx = 2 + vi * (V_COLS + colGap) + V_COLS;
    ws.getColumn(gapIdx).width = 2;
  }

  // Freeze header rows (R1:title, R2:vendor, R3:sub-columns, R4:KELUAR)
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  applyBlockBorder(ws, detailBlockStart, 1, row - 1, 2 + (vendors.length - 1) * (V_COLS + colGap) + V_TOTAL);
};

// ============================================================
// DATA PRODUKSI SHEET: summary per product (4 cols/product)
// UTUH | PCH | SRT | JUMLAH(=UTUH+PCH+SRT)
// Formulas linking to detail sheets
// ============================================================
const writeDataProduksi = (
  ws: ExcelJS.Worksheet,
  siteName: string, monthName: string, year: number,
  dim: number, products: string[],
  prodSheets: Record<string, ProdSheetInfo>
) => {
  const totalCols = 1 + products.length * DP_COLS;
  let row = 1;

  // Row 1: Title
  setMergedCell(ws, row, 1, row, totalCols, `KANTONG BPP PRODUKSI ${siteName}`, fontTitle, fillGreen);
  row = 2;
  // Row 2: Month
  setMergedCell(ws, row, 1, row, totalCols, `BULAN : ${monthName} ${year}`, fontSub, fillGreen);
  row = 3;

  // Row 3: Product headers + TGL (merged with row 4)
  ws.mergeCells(row, 1, row + 1, 1);
  setCell(ws, row, 1, 'TGL', fontHeader, fillGreen, 'center');
  let c = 2;
  for (const p of products) {
    setMergedCell(ws, row, c, row, c + DP_COLS - 1, p.toUpperCase(), fontSection, fillGreenLight);
    c += DP_COLS;
  }

  row = 4;
  // Row 4: Sub-headers
  const subHeaders = ['UTUH', 'PCH', 'SRT', 'JUMLAH'];
  c = 2;
  for (let pi = 0; pi < products.length; pi++) {
    for (let si = 0; si < DP_COLS; si++) {
      setCell(ws, row, c, subHeaders[si], fontHeader, fillGreen, 'center');
      c++;
    }
  }

  // ── Data rows ──
  const days1 = Math.min(15, dim);
  const days2 = dim - days1;

  const dataStartRow = 5;
  let dataRow = 5;

  // Days 1-15
  const rowSubA = dataRow;
  for (let d = 1; d <= days1; d++) {
    setCell(ws, dataRow, 1, d, fontData, undefined, 'center');
    c = 2;
    for (const product of products) {
      const info = prodSheets[product];
      if (info && info.vendors.length > 0) {
        const detailRow = 4 + d; // detail sheet: row 4 is header, data starts row 5
        const sn = info.sheetName;

        // Build cross-sheet SUM formulas per metric
        const sumFormula = (vendorSubCol: number): string => {
          const refs = info.vendors.map((_, vi) => {
            const refCol = colLetter(2 + vi * (V_COLS + 1) + vendorSubCol);
            return `'${sn}'!${refCol}${detailRow}`;
          });
          return `SUM(${refs.join(',')})`;
        };

        // UTUH
        setFormula(ws, dataRow, c, sumFormula(V_UTUH), fontData, undefined, 'right'); c++;
        // PCH
        setFormula(ws, dataRow, c, sumFormula(V_PCH), fontData, undefined, 'right'); c++;
        // SRT
        setFormula(ws, dataRow, c, sumFormula(V_SRT), fontData, undefined, 'right'); c++;
        // JUMLAH = UTUH + PCH + SRT
        const colUtuh = colLetter(c - 3);
        const colPch = colLetter(c - 2);
        const colSrt = colLetter(c - 1);
        setFormula(ws, dataRow, c, `${colUtuh}${dataRow}+${colPch}${dataRow}+${colSrt}${dataRow}`, fontData, undefined, 'right'); c++;
      } else {
        // No detail sheet
        for (let si = 0; si < DP_COLS; si++) {
          setCell(ws, dataRow, c, 0, fontNol, undefined, 'right');
          c++;
        }
      }
    }
    dataRow++;
  }

  // SUB A row (if dim > 15)
  if (days1 > 0) {
    const subARow = dataRow;
    setCell(ws, dataRow, 1, 'SUB A', fontSubtotal, fillGreenLight, 'center');
    c = 2;
    for (let pi = 0; pi < products.length; pi++) {
      for (let si = 0; si < DP_COLS; si++) {
        // For JUMLAH, use formula
        if (si === DP_JUMLAH) {
          const colUtuh = colLetter(c - 3);
          const colPch = colLetter(c - 2);
          const colSrt = colLetter(c - 1);
          setFormula(ws, dataRow, c, `${colUtuh}${dataRow}+${colPch}${dataRow}+${colSrt}${dataRow}`, fontSubtotal, fillGreenLight, 'right');
        } else {
          setFormula(ws, dataRow, c, `SUM(${colLetter(c)}${rowSubA}:${colLetter(c)}${subARow - 1})`, fontSubtotal, fillGreenLight, 'right');
        }
        c++;
      }
    }
    dataRow++;
  }

  // Days 16-31
  const rowSubB = dataRow;
  for (let d = days1 + 1; d <= dim; d++) {
    setCell(ws, dataRow, 1, d, fontData, undefined, 'center');
    c = 2;
    for (const product of products) {
      const info = prodSheets[product];
      if (info && info.vendors.length > 0) {
        const detailRow = 5 + d; // +1 for SUB A row shift in detail sheet
        const sn = info.sheetName;

        const sumFormula = (vendorSubCol: number): string => {
          const refs = info.vendors.map((_, vi) => {
            const refCol = colLetter(2 + vi * (V_COLS + 1) + vendorSubCol);
            return `'${sn}'!${refCol}${detailRow}`;
          });
          return `SUM(${refs.join(',')})`;
        };

        setFormula(ws, dataRow, c, sumFormula(V_UTUH), fontData, undefined, 'right'); c++;
        setFormula(ws, dataRow, c, sumFormula(V_PCH), fontData, undefined, 'right'); c++;
        setFormula(ws, dataRow, c, sumFormula(V_SRT), fontData, undefined, 'right'); c++;
        const colUtuh = colLetter(c - 3);
        const colPch = colLetter(c - 2);
        const colSrt = colLetter(c - 1);
        setFormula(ws, dataRow, c, `${colUtuh}${dataRow}+${colPch}${dataRow}+${colSrt}${dataRow}`, fontData, undefined, 'right'); c++;
      } else {
        for (let si = 0; si < DP_COLS; si++) {
          setCell(ws, dataRow, c, 0, fontNol, undefined, 'right');
          c++;
        }
      }
    }
    dataRow++;
  }

  // SUB B row
  if (days2 > 0) {
    const subBRow = dataRow;
    setCell(ws, dataRow, 1, 'SUB B', fontSubtotal, fillGreenLight, 'center');
    c = 2;
    for (let pi = 0; pi < products.length; pi++) {
      for (let si = 0; si < DP_COLS; si++) {
        if (si === DP_JUMLAH) {
          const colUtuh = colLetter(c - 3);
          const colPch = colLetter(c - 2);
          const colSrt = colLetter(c - 1);
          setFormula(ws, dataRow, c, `${colUtuh}${dataRow}+${colPch}${dataRow}+${colSrt}${dataRow}`, fontSubtotal, fillGreenLight, 'right');
        } else {
          setFormula(ws, dataRow, c, `SUM(${colLetter(c)}${rowSubB}:${colLetter(c)}${subBRow - 1})`, fontSubtotal, fillGreenLight, 'right');
        }
        c++;
      }
    }
    dataRow++;
  }

  // TOTAL row
  if (days1 > 0 || days2 > 0) {
    setCell(ws, dataRow, 1, 'TOTAL', fontSubtotal, fillGreenLight, 'center');
    c = 2;
    for (let pi = 0; pi < products.length; pi++) {
      for (let si = 0; si < DP_COLS; si++) {
        if (si === DP_JUMLAH) {
          const colUtuh = colLetter(c - 3);
          const colPch = colLetter(c - 2);
          const colSrt = colLetter(c - 1);
          setFormula(ws, dataRow, c, `${colUtuh}${dataRow}+${colPch}${dataRow}+${colSrt}${dataRow}`, fontSubtotal, fillGreenLight, 'right');
        } else {
          const sumA = rowSubA > 0 ? `${colLetter(c)}${rowSubA}` : '0';
          const sumB = rowSubB > 0 ? `${colLetter(c)}${rowSubB}` : '0';
          setFormula(ws, dataRow, c, `${sumA}+${sumB}`, fontSubtotal, fillGreenLight, 'right');
        }
        c++;
      }
    }
  }

  // Column widths
  ws.getColumn(1).width = 5;
  for (let pi = 0; pi < products.length; pi++) {
    for (let si = 0; si < DP_COLS; si++) {
      const colIdx = 2 + pi * DP_COLS + si;
      ws.getColumn(colIdx).width = si === DP_JUMLAH ? 10 : 12;
    }
  }
};

// ============================================================
// Download
// ============================================================
export const downloadMonthlyReport = async (opts: MonthlyExcelOptions): Promise<void> => {
  const wb = await generateMonthlyReport(opts);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Laporan_Bulanan_${opts.selectedMonth}.xlsx`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
};
