import ExcelJS from 'exceljs';
import { LaporanKantong } from './types';
import { formatDateDisplay } from './utils';
import { JENIS_KANTONG, JENIS_KANTONG_SHORT } from './csvUtils';

const SHIFT_INFO = [
  { id: 1, label: 'Shift 1', time: '00:00 – 08:00' },
  { id: 2, label: 'Shift 2', time: '08:00 – 16:00' },
  { id: 3, label: 'Shift 3', time: '16:00 – 24:00' },
];

export const generateExcelReport = async (
  filteredReports: LaporanKantong[],
  selectedDate: string,
  currentUserEmail: string | null | undefined,
  lockedStatus: boolean
): Promise<void> => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Laporan');

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

  // Column widths
  ws.columns = [
    { width: 32 }, // A
    { width: 10 }, // B
    { width: 10 }, // C
    { width: 10 }, // D
    { width: 10 }, // E
  ];

  let row = 1;

  // === HELPER: apply cell style ===
  const setCell = (r: number, c: number, value: any, font?: Partial<ExcelJS.Font>, fill?: Partial<ExcelJS.Fill>, align?: string) => {
    const cell = ws.getCell(r, c);
    cell.value = value;
    if (font) cell.font = font as ExcelJS.Font;
    if (fill) cell.fill = fill as ExcelJS.Fill;
    if (align === 'right') cell.alignment = { horizontal: 'right' };
    if (align === 'center') cell.alignment = { horizontal: 'center' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } } };
  };

  // === HEADER ===
  ws.mergeCells('A1:E1');
  setCell(1, 1, 'LAPORAN PEMAKAIAN KANTONG', fontHeader, fillHeader, 'center');
  ws.getCell(1, 1).fill = fillHeader as ExcelJS.Fill;

  ws.mergeCells('A2:E2');
  setCell(2, 1, `Tanggal: ${formatDateDisplay(selectedDate)}`, fontSubHeader, fillHeader, 'center');
  ws.getCell(2, 1).fill = fillHeader as ExcelJS.Fill;

  ws.mergeCells('A3:E3');
  setCell(3, 1, `Status: ${lockedStatus ? 'Verified' : 'Unverified'}`, fontSubHeader, fillHeader, 'center');
  ws.getCell(3, 1).fill = fillHeader as ExcelJS.Fill;

  row = 5;

  // === DATA PER PABRIK ===
  const writePabrik = (pabrikLabel: string, pabrikName: string) => {
    const factoryReports = filteredReports.filter(r => r.pabrik.includes(pabrikLabel));

    // Aggregate by jenis kantong
    const agg: Record<string, { utuh: number; pecah: number; sortir: number; total: number; vendors: Record<string, { utuh: number; pecah: number; sortir: number; total: number }> }> = {};
    JENIS_KANTONG.forEach(name => {
      agg[name] = { utuh: 0, pecah: 0, sortir: 0, total: 0, vendors: {} };
    });

    factoryReports.forEach(r => {
      if (agg[r.nama]) {
        agg[r.nama].utuh += r.utuh;
        agg[r.nama].pecah += r.pecah;
        agg[r.nama].sortir += r.sortir;
        agg[r.nama].total += r.total;
        if (!agg[r.nama].vendors[r.vendor]) {
          agg[r.nama].vendors[r.vendor] = { utuh: 0, pecah: 0, sortir: 0, total: 0 };
        }
        agg[r.nama].vendors[r.vendor].utuh += r.utuh;
        agg[r.nama].vendors[r.vendor].pecah += r.pecah;
        agg[r.nama].vendors[r.vendor].sortir += r.sortir;
        agg[r.nama].vendors[r.vendor].total += r.total;
      }
    });

    // Pabrik header
    ws.mergeCells(`A${row}:E${row}`);
    setCell(row, 1, `🏭 ${pabrikName}`, fontPabrik, fillPabrik);
    row++;

    // Table header
    ['JENIS KANTONG', 'UTUH', 'PECAH', 'SORTIR', 'TOTAL'].forEach((h, i) => {
      setCell(row, i + 1, h, fontTableHeader, fillHeader, i > 0 ? 'right' : 'left');
    });
    row++;

    // Data rows
    JENIS_KANTONG.forEach((name, idx) => {
      const stat = agg[name];
      const hasData = stat.total > 0;

      // Main row
      setCell(row, 1, hasData ? `${JENIS_KANTONG_SHORT[idx]} ▼` : JENIS_KANTONG_SHORT[idx], fontData, hasData ? fillData : undefined);
      setCell(row, 2, stat.utuh, fontData, hasData ? fillData : undefined, 'right');
      setCell(row, 3, stat.pecah, fontData, hasData ? fillData : undefined, 'right');
      setCell(row, 4, stat.sortir, fontData, hasData ? fillData : undefined, 'right');
      setCell(row, 5, stat.total, fontData, hasData ? fillData : undefined, 'right');
      row++;

      // Vendor detail rows (FONT KECIL)
      if (hasData) {
        Object.entries(stat.vendors).forEach(([vName, vStat]) => {
          setCell(row, 1, `    ↳ ${vName}`, fontVendor, fillVendor);
          setCell(row, 2, vStat.utuh, fontVendor, fillVendor, 'right');
          setCell(row, 3, vStat.pecah, fontVendor, fillVendor, 'right');
          setCell(row, 4, vStat.sortir, fontVendor, fillVendor, 'right');
          setCell(row, 5, vStat.total, fontVendor, fillVendor, 'right');
          row++;
        });
      }
    });

    row++; // empty row
  };

  writePabrik('PBR 1', 'Pabrik Baturaja 1 (PBR 1)');
  writePabrik('PBR 2', 'Pabrik Baturaja 2 (PBR 2)');

  // === LAPORAN PER SHIFT ===
  ws.mergeCells(`A${row}:E${row}`);
  setCell(row, 1, 'LAPORAN PER SHIFT', fontSection);
  row += 2;

  const writeShiftReport = (pabrikLabel: string, pabrikName: string) => {
    const factoryReports = filteredReports.filter(r => r.pabrik.includes(pabrikLabel));

    ws.mergeCells(`A${row}:E${row}`);
    setCell(row, 1, `📋 ${pabrikName}`, fontPabrik, fillPabrik);
    row++;

    SHIFT_INFO.forEach(shift => {
      const shiftReports = factoryReports.filter(r => r.shift === shift.id);
      if (shiftReports.length === 0) return;

      // Shift header
      ws.mergeCells(`A${row}:E${row}`);
      setCell(row, 1, `⏰ ${shift.label} (${shift.time})`, fontShiftTitle, fillShift);
      row++;

      // Table header
      ['VENDOR / JENIS KANTONG', 'UTUH', 'PECAH', 'SORTIR', 'TOTAL'].forEach((h, i) => {
        setCell(row, i + 1, h, fontTableHeader, fillHeader, i > 0 ? 'right' : 'left');
      });
      row++;

      // Group by jenis kantong
      const shiftAgg: Record<string, { utuh: number; pecah: number; sortir: number; total: number; vendors: Record<string, { utuh: number; pecah: number; sortir: number; total: number }> }> = {};
      JENIS_KANTONG.forEach(name => {
        shiftAgg[name] = { utuh: 0, pecah: 0, sortir: 0, total: 0, vendors: {} };
      });

      shiftReports.forEach(r => {
        if (shiftAgg[r.nama]) {
          shiftAgg[r.nama].utuh += r.utuh;
          shiftAgg[r.nama].pecah += r.pecah;
          shiftAgg[r.nama].sortir += r.sortir;
          shiftAgg[r.nama].total += r.total;
          if (!shiftAgg[r.nama].vendors[r.vendor]) {
            shiftAgg[r.nama].vendors[r.vendor] = { utuh: 0, pecah: 0, sortir: 0, total: 0 };
          }
          shiftAgg[r.nama].vendors[r.vendor].utuh += r.utuh;
          shiftAgg[r.nama].vendors[r.vendor].pecah += r.pecah;
          shiftAgg[r.nama].vendors[r.vendor].sortir += r.sortir;
          shiftAgg[r.nama].vendors[r.vendor].total += r.total;
        }
      });

      JENIS_KANTONG.forEach((name, idx) => {
        const stat = shiftAgg[name];
        if (stat.total === 0) return;

        // Main row
        setCell(row, 1, JENIS_KANTONG_SHORT[idx], fontData, fillData);
        setCell(row, 2, stat.utuh, fontData, fillData, 'right');
        setCell(row, 3, stat.pecah, fontData, fillData, 'right');
        setCell(row, 4, stat.sortir, fontData, fillData, 'right');
        setCell(row, 5, stat.total, fontData, fillData, 'right');
        row++;

        // Vendor detail (FONT KECIL)
        Object.entries(stat.vendors).forEach(([vName, vStat]) => {
          setCell(row, 1, `    ↳ ${vName}`, fontVendor, fillVendor);
          setCell(row, 2, vStat.utuh, fontVendor, fillVendor, 'right');
          setCell(row, 3, vStat.pecah, fontVendor, fillVendor, 'right');
          setCell(row, 4, vStat.sortir, fontVendor, fillVendor, 'right');
          setCell(row, 5, vStat.total, fontVendor, fillVendor, 'right');
          row++;
        });
      });

      row++; // empty row after shift
    });
  };

  writeShiftReport('PBR 1', 'Pabrik Baturaja 1 (PBR 1)');
  writeShiftReport('PBR 2', 'Pabrik Baturaja 2 (PBR 2)');

  return wb;
};

// Download Excel file (for Export button)
export const downloadExcelReport = async (
  filteredReports: LaporanKantong[],
  selectedDate: string,
  currentUserEmail: string | null | undefined,
  lockedStatus: boolean
): Promise<void> => {
  const wb = await generateExcelReport(filteredReports, selectedDate, currentUserEmail, lockedStatus);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Laporan_Kantong_${selectedDate}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
};

// Get Excel as base64 (for Drive upload)
export const getExcelBase64 = async (
  filteredReports: LaporanKantong[],
  selectedDate: string,
  currentUserEmail: string | null | undefined,
  lockedStatus: boolean
): Promise<string> => {
  const wb = await generateExcelReport(filteredReports, selectedDate, currentUserEmail, lockedStatus);
  const buffer = await wb.xlsx.writeBuffer();
  // Convert ArrayBuffer to base64 using FileReader (reliable for binary data)
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      // Remove data:...base64, prefix
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};
