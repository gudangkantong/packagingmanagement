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
const fontTotal = { name: 'Calibri', size: 10, bold: true } as Partial<ExcelJS.Font>;
const fontNol = { name: 'Calibri', size: 10, color: { argb: 'FF9CA3AF' } } as Partial<ExcelJS.Font>;

const fillGreen = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } } as Partial<ExcelJS.Fill>;
const fillGreenLight = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } } as Partial<ExcelJS.Fill>;
const fillHeaderPCH = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF44336' } } as Partial<ExcelJS.Fill>;
const fillHeaderSRT = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF9800' } } as Partial<ExcelJS.Fill>;
const fillGrey = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } } as Partial<ExcelJS.Fill>;

const setCell = (ws: ExcelJS.Worksheet, r: number, c: number, value: any, font?: Partial<ExcelJS.Font>, fill?: Partial<ExcelJS.Fill>, align?: string) => {
  const cell = ws.getCell(r, c);
  cell.value = value;
  if (font) cell.font = font as ExcelJS.Font;
  if (fill) cell.fill = fill as ExcelJS.Fill;
  if (align === 'right') cell.alignment = { horizontal: 'right' };
  else if (align === 'center') cell.alignment = { horizontal: 'center' };
  else if (align === 'right-v') cell.alignment = { horizontal: 'right', vertical: 'middle' };
  cell.border = { bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } } };
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

/** Set cell value as Excel formula */
const setFormula = (ws: ExcelJS.Worksheet, r: number, c: number, formula: string, font?: Partial<ExcelJS.Font>, fill?: Partial<ExcelJS.Fill>, align?: string) => {
  const cell = ws.getCell(r, c);
  cell.value = { formula } as any;
  if (font) cell.font = font as ExcelJS.Font;
  if (fill) cell.fill = fill as ExcelJS.Fill;
  if (align === 'right') cell.alignment = { horizontal: 'right' };
  else if (align === 'center') cell.alignment = { horizontal: 'center' };
  cell.border = { bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } } };
};

/** Column number (1-based) → Excel letter(s) */
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

/** Get total days in month */
const daysInMonth = (year: number, month: number): number => new Date(year, month, 0).getDate();

/** Format number (display via fontData, but for formulas we just use the raw formula) */
const fmtNum = (n: number): string => n === 0 ? '-' : n.toLocaleString('en-US');

export interface MonthlyExcelOptions {
  reports: LaporanKantong[];
  selectedMonth: string;
  currentUserEmail: string | null | undefined;
}

// Per-product sheet metadata
interface ProdSheetInfo {
  sheetName: string;
  vendors: string[];
}

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

  // Filter reports for this month
  const monthReports = reports.filter(r => r.tanggal.startsWith(selectedMonth));

  // Group by pabrik
  const siteKeys = ['PBR 1', 'PBR 2', 'PPG', 'PPJ'];
  const wb = new ExcelJS.Workbook();

  for (const siteKey of siteKeys) {
    const fullLabel = Object.entries(PABRIK_SHORT).find(([, v]) => v === siteKey)?.[0] || siteKey;
    const siteReports = monthReports.filter(r => r.pabrik === fullLabel);
    if (siteReports.length === 0) continue;

    const siteName = fullLabel.replace(/^Pabrik\s+/, '');
    const products = [...new Set(siteReports.map(r => r.nama))];

    // ── 1. Create product detail sheets FIRST (so DATA PROD can reference them) ──
    const prodSheets: Record<string, ProdSheetInfo> = {};
    for (const product of products) {
      const prodReports = siteReports.filter(r => r.nama === product);
      const vendors = [...new Set(prodReports.map(r => r.vendor))].sort();
      if (vendors.length === 0) continue;

      const rawName = `${product} ${siteKey}`;
      const cleanName = rawName.replace(/[\\\/\?\*\[\]]/g, '_');
      const wsProd = wb.addWorksheet(cleanName);
      writeProductSheet(wsProd, prodReports, product, siteName, vendors, dim, siteKey);
      prodSheets[product] = { sheetName: cleanName, vendors };
    }

    // ── 2. Create DATA PROD sheet with FORMULAS linking to product sheets ──
    const ws = wb.addWorksheet(`DATA PROD ${siteKey}`);
    writeDataProdSheet(ws, siteReports, siteName, monthName, year, month, dim, products, prodSheets, siteKey);
  }

  return wb;
};

// ============================================================
// SHEET per product: vendor breakdown (SOURCE of truth)
// ============================================================
const writeProductSheet = (
  ws: ExcelJS.Worksheet, reports: LaporanKantong[],
  productName: string, siteName: string,
  vendors: string[], dim: number, siteKey: string
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

  const prodCols = 6;
  const colStart = 2;
  let row = 1;

  // Row 1: Title
  setMergedCell(ws, row, 1, row, 1 + vendors.length * prodCols, `PEMAKAIAN KANTONG ${productName.toUpperCase()} ${siteName}`, fontTitle, fillGreen);
  row++;
  setMergedCell(ws, row, 1, row, 1 + vendors.length * prodCols, `BULAN : ${siteKey}`, fontSub, fillGreen);
  row++;

  // Row 3: Vendor headers
  let c = colStart;
  for (const v of vendors) {
    setMergedCell(ws, row, c, row, c + prodCols - 1, v, fontSection, fillGreenLight);
    c += prodCols;
  }
  setCell(ws, row, 1, 'TGL', fontHeader, fillGreen, 'center');

  row++;
  // Row 4: Sub-headers
  c = colStart;
  const subHeaders = ['UTUH', 'PCH', '%PCH', 'SRT', '%SRT', 'TOTAL'];
  const subFills = [undefined, fillHeaderPCH, fillHeaderPCH, fillHeaderSRT, fillHeaderSRT, undefined];
  for (let vi = 0; vi < vendors.length; vi++) {
    for (let si = 0; si < prodCols; si++) {
      setCell(ws, row, c, subHeaders[si], fontHeader, subFills[si], 'center');
      c++;
    }
  }

  // ── Data rows (ALL days 1–dim) ──
  row = 5;
  const dataStartRow = row;
  for (let d = 1; d <= dim; d++) {
    const dd = daily.get(d)!;
    setCell(ws, row, 1, d, fontData, undefined, 'center');
    c = colStart;
    for (const v of vendors) {
      const data = dd.get(v)!;
      const bg = data.total > 0 ? fillGreenLight : undefined;
      setCell(ws, row, c, fmtNum(data.utuh), data.total > 0 ? fontData : fontNol, bg, 'right'); c++;
      setCell(ws, row, c, fmtNum(data.pecah), data.total > 0 ? fontData : fontNol, bg, 'right'); c++;
      setCell(ws, row, c, data.pecah > 0 && data.utuh > 0 ? ((data.pecah / data.utuh) * 100).toFixed(4) : '-', data.pecah > 0 ? fontData : fontNol, bg, 'right'); c++;
      setCell(ws, row, c, fmtNum(data.sortir), data.total > 0 ? fontData : fontNol, bg, 'right'); c++;
      setCell(ws, row, c, data.sortir > 0 && data.utuh > 0 ? ((data.sortir / data.utuh) * 100).toFixed(4) : '-', data.sortir > 0 ? fontData : fontNol, bg, 'right'); c++;
      setCell(ws, row, c, fmtNum(data.total), data.total > 0 ? fontData : fontNol, bg, 'right'); c++;
    }
    row++;
  }
  const dataEndRow = row - 1;

  // ── TOTAL row (SUM formulas) ──
  row++;
  setCell(ws, row, 1, 'TOTAL', fontTotal, fillGreenLight, 'center');
  c = colStart;
  for (let vi = 0; vi < vendors.length; vi++) {
    const baseCol = colStart + vi * prodCols;
    // UTUH
    setFormula(ws, row, c, `SUM(${colLetter(c)}${dataStartRow}:${colLetter(c)}${dataEndRow})`, fontTotal, fillGreenLight, 'right'); c++;
    // PCH
    setFormula(ws, row, c, `SUM(${colLetter(c)}${dataStartRow}:${colLetter(c)}${dataEndRow})`, fontTotal, fillGreenLight, 'right'); c++;
    // %PCH
    const utuhCell = `${colLetter(baseCol)}${row}`;
    const pchCell = `${colLetter(baseCol + 1)}${row}`;
    setFormula(ws, row, c, `IF(${utuhCell}=0,"-",${pchCell}/${utuhCell}*100)`, fontTotal, fillGreenLight, 'right'); c++;
    // SRT
    setFormula(ws, row, c, `SUM(${colLetter(c)}${dataStartRow}:${colLetter(c)}${dataEndRow})`, fontTotal, fillGreenLight, 'right'); c++;
    // %SRT
    const srtCell = `${colLetter(baseCol + 3)}${row}`;
    setFormula(ws, row, c, `IF(${utuhCell}=0,"-",${srtCell}/${utuhCell}*100)`, fontTotal, fillGreenLight, 'right'); c++;
    // TOTAL
    setFormula(ws, row, c, `SUM(${colLetter(c)}${dataStartRow}:${colLetter(c)}${dataEndRow})`, fontTotal, fillGreenLight, 'right'); c++;
  }

  // Column widths
  ws.getColumn(1).width = 5;
  for (let vi = 0; vi < vendors.length; vi++) {
    for (let si = 0; si < prodCols; si++) {
      const colIdx = colStart + vi * prodCols + si;
      ws.getColumn(colIdx).width = si === 2 || si === 4 ? 10 : 14;
    }
  }
};

// ============================================================
// SHEET: DATA PROD [site] — FORMULAS referencing product sheets
// ============================================================
const writeDataProdSheet = (
  ws: ExcelJS.Worksheet, reports: LaporanKantong[],
  siteName: string, monthName: string, year: number, month: number,
  dim: number, products: string[],
  prodSheets: Record<string, ProdSheetInfo>,
  siteKey: string
) => {
  const prodCols = 6;
  const colStart = 2;
  let row = 1;

  // Row 1: Site title
  setMergedCell(ws, row, 1, row, 1 + products.length * prodCols, `KANTONG BPP PRODUKSI ${siteName}`, fontTitle, fillGreen);
  row++;
  // Row 2: Month
  setMergedCell(ws, row, 1, row, 1 + products.length * prodCols, `BULAN : ${monthName} ${year}`, fontSub, fillGreen);
  row++;

  // Row 3: Product headers
  let c = colStart;
  for (const p of products) {
    setMergedCell(ws, row, c, row, c + prodCols - 1, p.toUpperCase(), fontSection, fillGreenLight);
    c += prodCols;
  }
  setCell(ws, row, 1, 'TGL', fontHeader, fillGreen, 'center');
  // merge TGL cell
  ws.mergeCells(3, 1, 4, 1);
  setCell(ws, 4, 1, '', fontHeader, fillGreen, 'center');

  row = 4;
  // Row 4: Sub-headers
  c = colStart;
  const subHeaders = ['UTUH', 'PCH', '%PCH', 'SRT', '%SRT', 'TOTAL'];
  const subFills = [undefined, fillHeaderPCH, fillHeaderPCH, fillHeaderSRT, fillHeaderSRT, undefined];
  for (let pi = 0; pi < products.length; pi++) {
    for (let si = 0; si < prodCols; si++) {
      setCell(ws, row, c, subHeaders[si], fontHeader, subFills[si], 'center');
      c++;
    }
  }

  // ── Data rows with FORMULAS (ALL days 1–dim) ──
  row = 5;
  const dataStartRow = row;
  for (let d = 1; d <= dim; d++) {
    const dataRow = dataStartRow + (d - 1); // row in DATA PROD
    setCell(ws, dataRow, 1, d, fontData, undefined, 'center');

    c = colStart;
    for (const product of products) {
      const info = prodSheets[product];
      const blockStart = c;

      if (info && info.vendors.length > 0) {
        // Ref row in detail sheet: row 4 = header, data starts row 5
        const detailRow = 4 + d;
        const sn = info.sheetName;
        const fun = (vendorSubCol: number) => {
          // SUM of this sub-column across all vendors — SUM ignores text ("-")
          const parts = info.vendors.map((_, vi) => {
            const refCol = colLetter(colStart + vi * prodCols + vendorSubCol);
            return `'${sn}'!${refCol}${detailRow}`;
          });
          return `SUM(${parts.join(',')})`;
        };

        // UTUH (vendorSubCol=0)
        setFormula(ws, dataRow, c, fun(0), fontData, undefined, 'right'); c++;
        // PCH (vendorSubCol=1)
        setFormula(ws, dataRow, c, fun(1), fontData, undefined, 'right'); c++;
        // %PCH
        const utuhRef = `${colLetter(blockStart)}${dataRow}`;
        const pchRef = `${colLetter(blockStart + 1)}${dataRow}`;
        setFormula(ws, dataRow, c, `IF(${utuhRef}=0,"-",${pchRef}/${utuhRef}*100)`, fontData, undefined, 'right'); c++;
        // SRT (vendorSubCol=3)
        setFormula(ws, dataRow, c, fun(3), fontData, undefined, 'right'); c++;
        // %SRT
        const srtRef = `${colLetter(blockStart + 3)}${dataRow}`;
        setFormula(ws, dataRow, c, `IF(${utuhRef}=0,"-",${srtRef}/${utuhRef}*100)`, fontData, undefined, 'right'); c++;
        // TOTAL (vendorSubCol=5)
        setFormula(ws, dataRow, c, fun(5), fontData, undefined, 'right'); c++;
      } else {
        // No detail sheet for this product → show zeros
        for (let si = 0; si < prodCols; si++) {
          setCell(ws, dataRow, c, 0, fontNol, undefined, 'right');
          c++;
        }
      }
    }
  }
  const dataEndRow = row + dim - 1;

  // ── TOTAL row with SUM formulas ──
  row = dataEndRow + 2;
  setCell(ws, row, 1, 'TOTAL', fontTotal, fillGreenLight, 'center');
  c = colStart;
  for (let pi = 0; pi < products.length; pi++) {
    const blockStart = c;
    // UTUH
    setFormula(ws, row, c, `SUM(${colLetter(c)}${dataStartRow}:${colLetter(c)}${dataEndRow})`, fontTotal, fillGreenLight, 'right'); c++;
    // PCH
    setFormula(ws, row, c, `SUM(${colLetter(c)}${dataStartRow}:${colLetter(c)}${dataEndRow})`, fontTotal, fillGreenLight, 'right'); c++;
    // %PCH
    const utuhRef = `${colLetter(blockStart)}${row}`;
    const pchRef = `${colLetter(blockStart + 1)}${row}`;
    setFormula(ws, row, c, `IF(${utuhRef}=0,"-",${pchRef}/${utuhRef}*100)`, fontTotal, fillGreenLight, 'right'); c++;
    // SRT
    setFormula(ws, row, c, `SUM(${colLetter(c)}${dataStartRow}:${colLetter(c)}${dataEndRow})`, fontTotal, fillGreenLight, 'right'); c++;
    // %SRT
    const srtRef = `${colLetter(blockStart + 3)}${row}`;
    setFormula(ws, row, c, `IF(${utuhRef}=0,"-",${srtRef}/${utuhRef}*100)`, fontTotal, fillGreenLight, 'right'); c++;
    // TOTAL
    setFormula(ws, row, c, `SUM(${colLetter(c)}${dataStartRow}:${colLetter(c)}${dataEndRow})`, fontTotal, fillGreenLight, 'right'); c++;
  }

  // Column widths
  ws.getColumn(1).width = 5;
  for (let pi = 0; pi < products.length; pi++) {
    for (let si = 0; si < prodCols; si++) {
      const colIdx = colStart + pi * prodCols + si;
      ws.getColumn(colIdx).width = si === 2 || si === 4 ? 10 : 12;
    }
  }
};

// ============================================================
// Download monthly report
// ============================================================
export const downloadMonthlyReport = async (opts: MonthlyExcelOptions): Promise<void> => {
  const wb = await generateMonthlyReport(opts);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Laporan_Bulanan_${opts.selectedMonth}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
};
