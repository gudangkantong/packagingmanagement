import { LaporanKantong } from "./types";
import { formatDateDisplay } from "./utils";

export const JENIS_KANTONG = [
  "Semen Baturaja (SMBR)",
  "Semen DYNAMIX (DYX)",
  "Semen MERDEKA (MDK)",
  "Semen PADANG (PDG)",
  "BIGBAG OPC",
  "BIGBAG PCC",
  "MACAN"
];

export const JENIS_KANTONG_SHORT = ["SMBR", "DYX", "MDK", "PDG", "BIGBAG OPC", "BIGBAG PCC", "MACAN"];

export const generateCSVContent = (
  filteredReports: LaporanKantong[],
  selectedDate: string,
  currentUserEmail: string | null | undefined
): string => {
  const selectedDateStats = filteredReports.reduce(
    (acc, r) => {
      acc.utuh += r.utuh;
      acc.pecah += r.pecah;
      acc.sortir += r.sortir;
      acc.total += r.total;
      return acc;
    },
    { utuh: 0, pecah: 0, sortir: 0, total: 0 }
  );

  // 1. Metadata
  const metadata = [
    "sep=,",
    "LAPORAN PEMAKAIAN KANTONG (SUMMARY DASHBOARD)",
    "PACKAGING MANAGEMENT SYSTEM",
    `Tanggal Laporan,${formatDateDisplay(selectedDate)}`,
    `Diunduh Oleh,${currentUserEmail || "Sistem"}`,
    `Waktu Unduh,${new Date().toLocaleString("id-ID")}`,
    ""
  ];

  // --- I. KONSOLIDASI KESELURUHAN (TOTAL SEMUA PABRIK) ---
  const grandAgg = JENIS_KANTONG.reduce((acc, name) => {
    acc[name] = { utuh: 0, pecah: 0, sortir: 0, total: 0 };
    return acc;
  }, {} as Record<string, { utuh: number; pecah: number; sortir: number; total: number }>);

  filteredReports.forEach((r) => {
    if (grandAgg[r.nama]) {
      grandAgg[r.nama].utuh += r.utuh;
      grandAgg[r.nama].pecah += r.pecah;
      grandAgg[r.nama].sortir += r.sortir;
      grandAgg[r.nama].total += r.total;
    }
  });

  const sec1Rows = [
    "I. REKAPITULASI KONSOLIDASI (TOTAL PABRIK 1 & 2)",
    "No,Jenis Kantong (Kode),Jenis Kantong (Lengkap),Utuh,Pecah,Sortir,Total"
  ];
  JENIS_KANTONG.forEach((name, idx) => {
    const stat = grandAgg[name];
    sec1Rows.push(`${idx + 1},"${JENIS_KANTONG_SHORT[idx]}","${name}",${stat.utuh},${stat.pecah},${stat.sortir},${stat.total}`);
  });
  sec1Rows.push("");

  // --- II & III. REKAP PER PABRIK (WITH VENDOR BREAKDOWN) ---
  const generateFactorySection = (pabrikLabel: string, sectionTitle: string) => {
    const factoryReports = filteredReports.filter(r => r.pabrik.includes(pabrikLabel));
    const factoryAgg = JENIS_KANTONG.reduce((acc, name) => {
      acc[name] = { utuh: 0, pecah: 0, sortir: 0, total: 0, vendors: {} };
      return acc;
    }, {} as Record<string, { utuh: number; pecah: number; sortir: number; total: number, vendors: Record<string, { utuh: number; pecah: number; sortir: number; total: number }> }>);

    factoryReports.forEach((r) => {
      if (factoryAgg[r.nama]) {
        const agg = factoryAgg[r.nama];
        agg.utuh += r.utuh;
        agg.pecah += r.pecah;
        agg.sortir += r.sortir;
        agg.total += r.total;
        if (!agg.vendors[r.vendor]) agg.vendors[r.vendor] = { utuh: 0, pecah: 0, sortir: 0, total: 0 };
        agg.vendors[r.vendor].utuh += r.utuh;
        agg.vendors[r.vendor].pecah += r.pecah;
        agg.vendors[r.vendor].sortir += r.sortir;
        agg.vendors[r.vendor].total += r.total;
      }
    });

    const rows = [
      sectionTitle,
      "Jenis Kantong,Vendor,Utuh,Pecah,Sortir,Total"
    ];

    let hasData = false;
    JENIS_KANTONG.forEach((name, idx) => {
      const stat = factoryAgg[name];
      if (stat.total > 0) {
        hasData = true;
        rows.push(`"${JENIS_KANTONG_SHORT[idx]}",,${stat.utuh},${stat.pecah},${stat.sortir},${stat.total}`);
        Object.entries(stat.vendors).forEach(([vName, vStat]) => {
          rows.push(`, - ${vName},${vStat.utuh},${vStat.pecah},${vStat.sortir},${vStat.total}`);
        });
      }
    });
    
    if (!hasData) {
      rows.push("Tidak ada data untuk pabrik ini,,,,,");
    }
    rows.push("");
    return rows;
  };

  const sec2Rows = generateFactorySection("PBR 1", "II. REKAPITULASI PABRIK BATURAJA 1 (PBR 1)");
  const sec3Rows = generateFactorySection("PBR 2", "III. REKAPITULASI PABRIK BATURAJA 2 (PBR 2)");

  return "\uFEFF" + [
    ...metadata,
    ...sec1Rows,
    ...sec2Rows,
    ...sec3Rows
  ].join("\n");
};
