import ExcelJS from 'exceljs';
import { LaporanKantong, PenerimaanData, PengirimanData } from './types';
import { formatDateDisplay } from './utils';
import { JENIS_KANTONG, JENIS_KANTONG_SHORT } from './csvUtils';

const SHIFT_INFO = [
  { id: 1, label: 'Shift 1', time: '00:00 – 08:00' },
  { id: 2, label: 'Shift 2', time: '08:00 – 16:00' },
  { id: 3, label: 'Shift 3', time: '16:00 – 24:00' },
];

const PABRIK_LIST = [
  "Pabrik Baturaja 1 (PBR 1)",
  "Pabrik Baturaja 2 (PBR 2)",
  "Pabrik Palembang (PPG)",
  "Pabrik Panjang (PPJ)",
];
const PABRIK_SHORT: Record<string, string> = {
  "Gudang OPT": "OPT",
  "Pabrik Baturaja 1 (PBR 1)": "PBR 1",
  "Pabrik Baturaja 2 (PBR 2)": "PBR 2",
  "Pabrik Palembang (PPG)": "PPG",
  "Pabrik Panjang (PPJ)": "PPJ",
};

interface ExcelOptions {
  filteredReports: LaporanKantong[];
  selectedDate: string;
  currentUserEmail: string | null | undefined;
  lockedStatus: boolean;
  penerimaanList: PenerimaanData[];
  pengirimanList: PengirimanData[];
  stockData: Record<string, any>;
  reports: LaporanKantong[];
}

// === STYLES ===
const fontHeader = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } } as Partial<ExcelJS.Font>;
const fontSubHeader = { name: 'Calibri', size: 11, color: { argb: 'FFFFFFFF' } } as Partial<ExcelJS.Font>;
const fontSection = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FF2E7D32' } } as Partial<ExcelJS.Font>;
const fontPabrik = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF2E7D32' } } as Partial<ExcelJS.Font>;
const fontTableHeader = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } } as Partial<ExcelJS.Font>;
const fontData = { name: 'Calibri', size: 11 } as Partial<ExcelJS.Font>;
const fontVendor = { name: 'Calibri', size: 9, color: { argb: 'FF666666' } } as Partial<ExcelJS.Font>;
const fontShiftTitle = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFF57F17' } } as Partial<ExcelJS.Font>;

const fillHeader = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } } as Partial<ExcelJS.Fill>;
const fillPabrik = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } } as Partial<ExcelJS.Fill>;
const fillData = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } } as Partial<ExcelJS.Fill>;
const fillVendor = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } } as Partial<ExcelJS.Fill>;
const fillShift = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8E1' } } as Partial<ExcelJS.Fill>;

const fillEmeraldHeader = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' } } as Partial<ExcelJS.Fill>;
const fillEmeraldLight = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } } as Partial<ExcelJS.Fill>;

const fillBlueHeader = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } } as Partial<ExcelJS.Fill>;
const fillBlueLight = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } } as Partial<ExcelJS.Fill>;

const fillAmberHeader = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD97706' } } as Partial<ExcelJS.Fill>;
const fillAmberLight = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } } as Partial<ExcelJS.Fill>;

// Helper: apply cell style
const setCell = (ws: ExcelJS.Worksheet, r: number, c: number, value: any, font?: Partial<ExcelJS.Font>, fill?: Partial<ExcelJS.Fill>, align?: string) => {
  const cell = ws.getCell(r, c);
  cell.value = value;
  if (font) cell.font = font as ExcelJS.Font;
  if (fill) cell.fill = fill as ExcelJS.Fill;
  if (align === 'right') cell.alignment = { horizontal: 'right' };
  if (align === 'center') cell.alignment = { horizontal: 'center' };
  cell.border = { bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } } };
};

// === SHEET 1: PEMAKAIAN KANTONG ===
const writePemakaianSheet = (ws: ExcelJS.Worksheet, opts: ExcelOptions) => {
  const { filteredReports, selectedDate, lockedStatus } = opts;

  ws.columns = [
    { width: 32 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 },
  ];

  let row = 1;

  // Header
  ws.mergeCells('A1:E1');
  setCell(ws, 1, 1, 'LAPORAN PEMAKAIAN KANTONG', fontHeader, fillHeader, 'center');
  ws.mergeCells('A2:E2');
  setCell(ws, 2, 1, `Tanggal: ${formatDateDisplay(selectedDate)}`, fontSubHeader, fillHeader, 'center');
  ws.mergeCells('A3:E3');
  setCell(ws, 3, 1, `Status: ${lockedStatus ? 'Verified' : 'Unverified'}`, fontSubHeader, fillHeader, 'center');

  row = 5;

  const writePabrik = (pabrikLabel: string, pabrikName: string) => {
    const factoryReports = filteredReports.filter(r => r.pabrik.includes(pabrikLabel));
    const agg: Record<string, { utuh: number; pecah: number; sortir: number; total: number; vendors: Record<string, { utuh: number; pecah: number; sortir: number; total: number }> }> = {};
    JENIS_KANTONG.forEach(name => { agg[name] = { utuh: 0, pecah: 0, sortir: 0, total: 0, vendors: {} }; });
    factoryReports.forEach(r => {
      if (agg[r.nama]) {
        agg[r.nama].utuh += r.utuh; agg[r.nama].pecah += r.pecah; agg[r.nama].sortir += r.sortir; agg[r.nama].total += r.total;
        if (!agg[r.nama].vendors[r.vendor]) agg[r.nama].vendors[r.vendor] = { utuh: 0, pecah: 0, sortir: 0, total: 0 };
        agg[r.nama].vendors[r.vendor].utuh += r.utuh; agg[r.nama].vendors[r.vendor].pecah += r.pecah;
        agg[r.nama].vendors[r.vendor].sortir += r.sortir; agg[r.nama].vendors[r.vendor].total += r.total;
      }
    });

    ws.mergeCells(`A${row}:E${row}`);
    setCell(ws, row, 1, `🏭 ${pabrikName}`, fontPabrik, fillPabrik);
    row++;
    ['JENIS KANTONG', 'UTUH', 'PECAH', 'SORTIR', 'TOTAL'].forEach((h, i) => {
      setCell(ws, row, i + 1, h, fontTableHeader, fillHeader, i > 0 ? 'right' : 'left');
    });
    row++;
    JENIS_KANTONG.forEach(name => {
      const stat = agg[name];
      const hasData = stat.total > 0;
      setCell(ws, row, 1, hasData ? `${name} ▼` : name, fontData, hasData ? fillData : undefined);
      setCell(ws, row, 2, stat.utuh, fontData, hasData ? fillData : undefined, 'right');
      setCell(ws, row, 3, stat.pecah, fontData, hasData ? fillData : undefined, 'right');
      setCell(ws, row, 4, stat.sortir, fontData, hasData ? fillData : undefined, 'right');
      setCell(ws, row, 5, stat.total, fontData, hasData ? fillData : undefined, 'right');
      row++;
      if (hasData) {
        Object.entries(stat.vendors).forEach(([vName, vStat]) => {
          setCell(ws, row, 1, `    ↳ ${vName}`, fontVendor, fillVendor);
          setCell(ws, row, 2, vStat.utuh, fontVendor, fillVendor, 'right');
          setCell(ws, row, 3, vStat.pecah, fontVendor, fillVendor, 'right');
          setCell(ws, row, 4, vStat.sortir, fontVendor, fillVendor, 'right');
          setCell(ws, row, 5, vStat.total, fontVendor, fillVendor, 'right');
          row++;
        });
      }
    });
    row++;
  };

  writePabrik('PBR 1', 'Pabrik Baturaja 1 (PBR 1)');
  writePabrik('PBR 2', 'Pabrik Baturaja 2 (PBR 2)');
  writePabrik('PPG', 'Pabrik Palembang (PPG)');
  writePabrik('PPJ', 'Pabrik Panjang (PPJ)');

  // Laporan Per Shift
  row++;
  ws.mergeCells(`A${row}:E${row}`);
  setCell(ws, row, 1, 'LAPORAN PER SHIFT', fontSection);
  row += 2;

  const writeShiftReport = (pabrikLabel: string, pabrikName: string) => {
    const factoryReports = filteredReports.filter(r => r.pabrik.includes(pabrikLabel));
    ws.mergeCells(`A${row}:E${row}`);
    setCell(ws, row, 1, `📋 ${pabrikName}`, fontPabrik, fillPabrik);
    row++;
    SHIFT_INFO.forEach(shift => {
      const shiftReports = factoryReports.filter(r => r.shift === shift.id);
      if (shiftReports.length === 0) return;
      ws.mergeCells(`A${row}:E${row}`);
      setCell(ws, row, 1, `⏰ ${shift.label} (${shift.time})`, fontShiftTitle, fillShift);
      row++;
      ['VENDOR / JENIS KANTONG', 'UTUH', 'PECAH', 'SORTIR', 'TOTAL'].forEach((h, i) => {
        setCell(ws, row, i + 1, h, fontTableHeader, fillHeader, i > 0 ? 'right' : 'left');
      });
      row++;
      const shiftAgg: Record<string, { utuh: number; pecah: number; sortir: number; total: number; vendors: Record<string, { utuh: number; pecah: number; sortir: number; total: number }> }> = {};
      JENIS_KANTONG.forEach(name => { shiftAgg[name] = { utuh: 0, pecah: 0, sortir: 0, total: 0, vendors: {} }; });
      shiftReports.forEach(r => {
        if (shiftAgg[r.nama]) {
          shiftAgg[r.nama].utuh += r.utuh; shiftAgg[r.nama].pecah += r.pecah; shiftAgg[r.nama].sortir += r.sortir; shiftAgg[r.nama].total += r.total;
          if (!shiftAgg[r.nama].vendors[r.vendor]) shiftAgg[r.nama].vendors[r.vendor] = { utuh: 0, pecah: 0, sortir: 0, total: 0 };
          shiftAgg[r.nama].vendors[r.vendor].utuh += r.utuh; shiftAgg[r.nama].vendors[r.vendor].pecah += r.pecah;
          shiftAgg[r.nama].vendors[r.vendor].sortir += r.sortir; shiftAgg[r.nama].vendors[r.vendor].total += r.total;
        }
      });
      JENIS_KANTONG.forEach(name => {
        const stat = shiftAgg[name];
        if (stat.total === 0) return;
        setCell(ws, row, 1, name, fontData, fillData);
        setCell(ws, row, 2, stat.utuh, fontData, fillData, 'right');
        setCell(ws, row, 3, stat.pecah, fontData, fillData, 'right');
        setCell(ws, row, 4, stat.sortir, fontData, fillData, 'right');
        setCell(ws, row, 5, stat.total, fontData, fillData, 'right');
        row++;
        Object.entries(stat.vendors).forEach(([vName, vStat]) => {
          setCell(ws, row, 1, `    ↳ ${vName}`, fontVendor, fillVendor);
          setCell(ws, row, 2, vStat.utuh, fontVendor, fillVendor, 'right');
          setCell(ws, row, 3, vStat.pecah, fontVendor, fillVendor, 'right');
          setCell(ws, row, 4, vStat.sortir, fontVendor, fillVendor, 'right');
          setCell(ws, row, 5, vStat.total, fontVendor, fillVendor, 'right');
          row++;
        });
      });
      row++;
    });
  };

  writeShiftReport('PBR 1', 'Pabrik Baturaja 1 (PBR 1)');
  writeShiftReport('PBR 2', 'Pabrik Baturaja 2 (PBR 2)');
  writeShiftReport('PPG', 'Pabrik Palembang (PPG)');
  writeShiftReport('PPJ', 'Pabrik Panjang (PPJ)');
};

// === SHEET 2: DATA PENERIMAAN ===
const writePenerimaanSheet = (ws: ExcelJS.Worksheet, opts: ExcelOptions) => {
  const { penerimaanList, selectedDate } = opts;
  const datePenerimaan = penerimaanList.filter(r => r.tanggal === selectedDate);

  ws.columns = [
    { width: 6 }, { width: 22 }, { width: 18 }, { width: 18 }, { width: 14 }, { width: 24 }, { width: 18 },
  ];

  let row = 1;
  ws.mergeCells('A1:G1');
  setCell(ws, 1, 1, '📦 DATA PENERIMAAN', fontHeader, fillEmeraldHeader, 'center');
  ws.mergeCells('A2:G2');
  setCell(ws, 2, 1, `Tanggal: ${formatDateDisplay(selectedDate)}`, fontSubHeader, fillEmeraldHeader, 'center');

  row = 4;
  ['NO', 'JENIS KANTONG', 'TUJUAN', 'SUMBER', 'JUMLAH', 'KETERANGAN', 'OLEH'].forEach((h, i) => {
    setCell(ws, row, i + 1, h, fontTableHeader, fillEmeraldHeader, i === 0 || i === 4 ? 'center' : 'left');
  });
  row++;

  if (datePenerimaan.length === 0) {
    ws.mergeCells(`A${row}:G${row}`);
    setCell(ws, row, 1, 'Tidak ada data penerimaan untuk tanggal ini', fontVendor, undefined, 'center');
  } else {
    datePenerimaan.forEach((item, idx) => {
      const bg = idx % 2 === 0 ? fillEmeraldLight : undefined;
      setCell(ws, row, 1, idx + 1, fontData, bg, 'center');
      setCell(ws, row, 2, item.nama, fontData, bg);
      setCell(ws, row, 3, PABRIK_SHORT[item.pabrik] || item.pabrik, fontData, bg);
      setCell(ws, row, 4, item.sumber || '-', fontData, bg);
      setCell(ws, row, 5, item.jumlah, { ...fontData, bold: true, color: { argb: 'FF059669' } }, bg, 'center');
      setCell(ws, row, 6, item.keterangan || '-', fontData, bg);
      setCell(ws, row, 7, item.createdBy?.split('@')[0] || 'Sistem', fontVendor, bg);
      row++;
    });

    // Total
    row++;
    setCell(ws, row, 1, '', fontData);
    ws.mergeCells(`A${row}:D${row}`);
    setCell(ws, row, 1, 'TOTAL PENERIMAAN', { ...fontData, bold: true }, fillEmeraldLight);
    setCell(ws, row, 5, datePenerimaan.reduce((s, r) => s + r.jumlah, 0), { ...fontData, bold: true, color: { argb: 'FF059669' } }, fillEmeraldLight, 'center');
  }
};

// === SHEET 3: DATA PENGIRIMAN ===
const writePengirimanSheet = (ws: ExcelJS.Worksheet, opts: ExcelOptions) => {
  const { pengirimanList, selectedDate } = opts;
  const datePengiriman = pengirimanList.filter(r => r.tanggal === selectedDate);

  ws.columns = [
    { width: 6 }, { width: 22 }, { width: 18 }, { width: 18 }, { width: 14 }, { width: 24 }, { width: 18 },
  ];

  let row = 1;
  ws.mergeCells('A1:G1');
  setCell(ws, 1, 1, '🚚 DATA PENGIRIMAN', fontHeader, fillBlueHeader, 'center');
  ws.mergeCells('A2:G2');
  setCell(ws, 2, 1, `Tanggal: ${formatDateDisplay(selectedDate)}`, fontSubHeader, fillBlueHeader, 'center');

  row = 4;
  ['NO', 'JENIS KANTONG', 'SUMBER', 'TUJUAN', 'JUMLAH', 'KETERANGAN', 'OLEH'].forEach((h, i) => {
    setCell(ws, row, i + 1, h, fontTableHeader, fillBlueHeader, i === 0 || i === 4 ? 'center' : 'left');
  });
  row++;

  if (datePengiriman.length === 0) {
    ws.mergeCells(`A${row}:G${row}`);
    setCell(ws, row, 1, 'Tidak ada data pengiriman untuk tanggal ini', fontVendor, undefined, 'center');
  } else {
    datePengiriman.forEach((item, idx) => {
      const bg = idx % 2 === 0 ? fillBlueLight : undefined;
      setCell(ws, row, 1, idx + 1, fontData, bg, 'center');
      setCell(ws, row, 2, item.nama, fontData, bg);
      setCell(ws, row, 3, PABRIK_SHORT[item.pabrik] || item.pabrik, fontData, bg);
      setCell(ws, row, 4, item.tujuan || '-', fontData, bg);
      setCell(ws, row, 5, item.jumlah, { ...fontData, bold: true, color: { argb: 'FF2563EB' } }, bg, 'center');
      setCell(ws, row, 6, item.keterangan || '-', fontData, bg);
      setCell(ws, row, 7, item.createdBy?.split('@')[0] || 'Sistem', fontVendor, bg);
      row++;
    });

    // Total
    row++;
    ws.mergeCells(`A${row}:D${row}`);
    setCell(ws, row, 1, 'TOTAL PENGIRIMAN', { ...fontData, bold: true }, fillBlueLight);
    setCell(ws, row, 5, datePengiriman.reduce((s, r) => s + r.jumlah, 0), { ...fontData, bold: true, color: { argb: 'FF2563EB' } }, fillBlueLight, 'center');
  }
};

// === SHEET 4: STOCK HARIAN ===
const writeStockSheet = (ws: ExcelJS.Worksheet, opts: ExcelOptions) => {
  const { selectedDate, reports, penerimaanList, pengirimanList, stockData } = opts;

  ws.columns = [
    { width: 22 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 },
  ];

  let row = 1;
  ws.mergeCells('A1:G1');
  setCell(ws, 1, 1, '📊 STOCK HARIAN', fontHeader, fillAmberHeader, 'center');
  ws.mergeCells('A2:G2');
  setCell(ws, 2, 1, `Tanggal: ${formatDateDisplay(selectedDate)}`, fontSubHeader, fillAmberHeader, 'center');

  row = 4;

  const allLocations = ["Gudang OPT", ...PABRIK_LIST];

  const computePenerimaan = (pabrik: string, nama: string): number => {
    const direct = penerimaanList.filter(r => r.tanggal === selectedDate && r.nama === nama && r.pabrik === pabrik).reduce((s, r) => s + r.jumlah, 0);
    const incoming = pengirimanList.filter(r => r.tanggal === selectedDate && r.nama === nama && r.tujuan === pabrik).reduce((s, r) => s + r.jumlah, 0);
    return direct + incoming;
  };
  const computePengiriman = (pabrik: string, nama: string): number =>
    pengirimanList.filter(r => r.tanggal === selectedDate && r.nama === nama && r.pabrik === pabrik).reduce((s, r) => s + r.jumlah, 0);
  const computePemakaian = (pabrikLabel: string, nama: string): number =>
    reports.filter(r => r.tanggal === selectedDate && r.nama === nama && r.pabrik.includes(pabrikLabel)).reduce((s, r) => s + r.total, 0);

  allLocations.forEach(pabrik => {
    const shortName = PABRIK_SHORT[pabrik] || pabrik;
    const isOPT = pabrik === "Gudang OPT";

    // Pabrik header
    ws.mergeCells(`A${row}:G${row}`);
    setCell(ws, row, 1, `🏭 ${pabrik}`, fontPabrik, fillPabrik);
    row++;

    // Table header
    ['JENIS KANTONG', 'STOCK AWAL', 'PENERIMAAN', 'PENGIRIMAN', 'PEMAKAIAN', 'STOCK AKHIR', 'STATUS'].forEach((h, i) => {
      setCell(ws, row, i + 1, h, fontTableHeader, fillAmberHeader, i > 0 ? 'right' : 'left');
    });
    row++;

    JENIS_KANTONG.forEach(nama => {
      // Find saved stock data
      const docId = `${shortName}_${nama.replace(/\s+/g, "_")}_${selectedDate}`;
      const saved = stockData[docId];
      const sa = saved ? Number(saved.stockAwal) || 0 : 0;
      const pn = computePenerimaan(pabrik, nama);
      const pg = computePengiriman(pabrik, nama);
      const pk = isOPT ? 0 : computePemakaian(shortName, nama);
      const sk = isOPT ? sa + pn - pg : sa + pn - pg - pk;

      const bg = sk < 0 ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } } as Partial<ExcelJS.Fill> : (sa !== 0 || pn !== 0 || pg !== 0 || pk !== 0 ? fillAmberLight : undefined);
      const statusText = sk < 0 ? '⚠️ NEGATIF' : (sk === 0 ? 'KOSONG' : 'OK');
      const statusColor = sk < 0 ? 'FFDC2626' : (sk === 0 ? 'FF9CA3AF' : 'FF16A34A');

      setCell(ws, row, 1, nama, fontData, bg);
      setCell(ws, row, 2, sa, fontData, bg, 'right');
      setCell(ws, row, 3, pn > 0 ? pn : '-', pn > 0 ? { ...fontData, color: { argb: 'FF059669' } } : fontVendor, bg, 'right');
      setCell(ws, row, 4, pg > 0 ? pg : '-', pg > 0 ? { ...fontData, color: { argb: 'FF2563EB' } } : fontVendor, bg, 'right');
      setCell(ws, row, 5, pk > 0 ? pk : '-', pk > 0 ? { ...fontData, color: { argb: 'FFDC2626' } } : fontVendor, bg, 'right');
      setCell(ws, row, 6, sk, { ...fontData, bold: true, color: { argb: sk < 0 ? 'FFDC2626' : 'FF16A34A' } }, bg, 'right');
      setCell(ws, row, 7, statusText, { ...fontData, bold: true, color: { argb: statusColor } }, bg, 'center');
      row++;
    });
    row++;
  });
};

// === MAIN: GENERATE EXCEL ===
export const generateExcelReport = async (opts: ExcelOptions): Promise<ExcelJS.Workbook> => {
  const wb = new ExcelJS.Workbook();

  // Sheet 1: Pemakaian
  const ws1 = wb.addWorksheet('Pemakaian');
  writePemakaianSheet(ws1, opts);

  // Sheet 2: Penerimaan
  const ws2 = wb.addWorksheet('Penerimaan');
  writePenerimaanSheet(ws2, opts);

  // Sheet 3: Pengiriman
  const ws3 = wb.addWorksheet('Pengiriman');
  writePengirimanSheet(ws3, opts);

  // Sheet 4: Stock Harian
  const ws4 = wb.addWorksheet('Stock Harian');
  writeStockSheet(ws4, opts);

  return wb;
};

// Download Excel file (for Export button)
export const downloadExcelReport = async (opts: ExcelOptions): Promise<void> => {
  const wb = await generateExcelReport(opts);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Laporan_Packaging_${opts.selectedDate}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
};

// Get Excel as base64 (for Drive upload)
export const getExcelBase64 = async (opts: ExcelOptions): Promise<string> => {
  const wb = await generateExcelReport(opts);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer]);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};
