import React, { useState, useEffect, useMemo } from "react";
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Save,
  Loader2,
  AlertCircle,
  Package,
  RefreshCw,
} from "lucide-react";
import { db } from "./firebase";
import { StockHarian, LaporanKantong, AllowedUser } from "./types";
import { getDateString, formatDateDisplay } from "./utils";
import { JENIS_KANTONG } from "./csvUtils";

// Match the PABRIK_LIST from App.tsx
const PABRIK_LIST = [
  "Pabrik Baturaja 1 (PBR 1)",
  "Pabrik Baturaja 2 (PBR 2)",
  "Pabrik Palembang (PPG)",
  "Pabrik Panjang (PPJ)",
];

const PABRIK_SHORT: Record<string, string> = {
  "Pabrik Baturaja 1 (PBR 1)": "PBR 1",
  "Pabrik Baturaja 2 (PBR 2)": "PBR 2",
  "Pabrik Palembang (PPG)": "PPG",
  "Pabrik Panjang (PPJ)": "PPJ",
};

interface StockHarianPageProps {
  currentUser: any;
  isAllowed: boolean;
  reports: LaporanKantong[];
  allowedUsers: AllowedUser[];
  triggerToast: (text: string, type?: "ok" | "er" | "inf") => void;
}

export default function StockHarianPage({
  currentUser,
  isAllowed,
  reports,
  allowedUsers,
  triggerToast,
}: StockHarianPageProps) {
  // Role checks
  const currentUserData = allowedUsers.find(
    (u) => u.email === currentUser?.email?.toLowerCase()
  );
  const userRole = currentUserData?.role || (currentUser?.isAnonymous ? "guest" : null);
  const isMasterAdmin = userRole === "super_admin";
  const isAdmin = userRole === "super_admin" || userRole === "admin";

  // Date state
  const [selectedDate, setSelectedDate] = useState<string>(
    getDateString(new Date())
  );

  // Stock data state (keyed by docId: pabrik_nama_tanggal)
  const [stockData, setStockData] = useState<Record<string, StockHarian>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null); // docId being saved
  const [editBuffer, setEditBuffer] = useState<
    Record<string, { penerimaan: string; pengiriman: string; stockAwal: string }>
  >({});

  useEffect(() => {
    setSelectedDate(getDateString(new Date()));
  }, []);

  // Helper: generate docId
  const makeDocId = (pabrik: string, nama: string, tanggal: string) => {
    const pKey = PABRIK_SHORT[pabrik] || pabrik;
    const nKey = nama.replace(/\s+/g, "_");
    return `${pKey}_${nKey}_${tanggal}`;
  };

  // Previous date string
  const getPrevDate = (dateStr: string): string => {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() - 1);
    return getDateString(d);
  };

  // Compute pemakaian for a specific pabrik + jenis kantong on a date
  const computePemakaian = (
    pabrikLabel: string,
    nama: string,
    tanggal: string
  ): number => {
    return reports
      .filter(
        (r) =>
          r.tanggal === tanggal &&
          r.nama === nama &&
          r.pabrik.includes(pabrikLabel)
      )
      .reduce((sum, r) => sum + r.total, 0);
  };

  // Listen to stock_harian collection for selected date
  useEffect(() => {
    if (!currentUser || isAllowed !== true) {
      setStockData({});
      setLoading(false);
      return;
    }

    setLoading(true);

    // Listen to today's stock data
    const q = query(
      collection(db, "stock_harian"),
      where("tanggal", "==", selectedDate)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const data: Record<string, StockHarian> = {};
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          data[docSnap.id] = {
            id: docSnap.id,
            pabrik: d.pabrik || "",
            nama: d.nama || "",
            tanggal: d.tanggal || "",
            stockAwal: Number(d.stockAwal) || 0,
            penerimaan: Number(d.penerimaan) || 0,
            pengiriman: Number(d.pengiriman) || 0,
            pemakaian: Number(d.pemakaian) || 0,
            stockAkhir: Number(d.stockAkhir) || 0,
            createdBy: d.createdBy || "",
            updatedAt: d.updatedAt || "",
          };
        });
        setStockData(data);
        setLoading(false);
      },
      (err) => {
        console.error("Failed to sync stock_harian:", err);
        triggerToast("Gagal menyinkronkan data stock harian", "er");
        setLoading(false);
      }
    );

    return () => unsub();
  }, [currentUser, isAllowed, selectedDate]);

  // Initialize edit buffer when stock data or date changes
  useEffect(() => {
    const buffer: Record<
      string,
      { penerimaan: string; pengiriman: string; stockAwal: string }
    > = {};

    PABRIK_LIST.forEach((pabrik) => {
      const pabrikLabel = PABRIK_SHORT[pabrik];
      JENIS_KANTONG.forEach((nama) => {
        const docId = makeDocId(pabrik, nama, selectedDate);
        const existing = stockData[docId];
        if (existing) {
          buffer[docId] = {
            penerimaan: String(existing.penerimaan),
            pengiriman: String(existing.pengiriman),
            stockAwal: String(existing.stockAwal),
          };
        } else {
          buffer[docId] = {
            penerimaan: "",
            pengiriman: "",
            stockAwal: "",
          };
        }
      });
    });

    setEditBuffer(buffer);
  }, [stockData, selectedDate]);

  // Handle input change
  const handleInputChange = (
    docId: string,
    field: "penerimaan" | "pengiriman" | "stockAwal",
    value: string
  ) => {
    // Only allow numbers
    if (value === "" || /^\d*$/.test(value)) {
      setEditBuffer((prev) => ({
        ...prev,
        [docId]: { ...prev[docId], [field]: value },
      }));
    }
  };

  // Save a single row
  const handleSaveRow = async (
    pabrik: string,
    nama: string,
    docId: string
  ) => {
    if (!currentUser || !isAdmin) return;

    setSaving(docId);
    try {
      const pabrikLabel = PABRIK_SHORT[pabrik];
      const buf = editBuffer[docId] || {
        penerimaan: "0",
        pengiriman: "0",
        stockAwal: "0",
      };

      const stockAwal = parseInt(buf.stockAwal) || 0;
      const penerimaan = parseInt(buf.penerimaan) || 0;
      const pengiriman = parseInt(buf.pengiriman) || 0;
      const pemakaian = computePemakaian(pabrikLabel, nama, selectedDate);
      const stockAkhir = stockAwal + penerimaan - pengiriman - pemakaian;

      const docData = {
        pabrik,
        nama,
        tanggal: selectedDate,
        stockAwal,
        penerimaan,
        pengiriman,
        pemakaian,
        stockAkhir,
        createdBy: currentUser.email || "unknown",
        updatedAt: new Date().toISOString(),
      };

      await setDoc(doc(db, "stock_harian", docId), docData, { merge: true });
      triggerToast(`Stock ${nama} (${pabrikLabel}) berhasil disimpan`, "ok");
    } catch (e) {
      console.error("Save stock failed:", e);
      triggerToast("Gagal menyimpan data stock", "er");
    } finally {
      setSaving(null);
    }
  };

  // Save all rows for a pabrik
  const handleSaveAllPabrik = async (pabrik: string) => {
    if (!currentUser || !isAdmin) return;

    setSaving(pabrik);
    try {
      const pabrikLabel = PABRIK_SHORT[pabrik];
      const promises = JENIS_KANTONG.map(async (nama) => {
        const docId = makeDocId(pabrik, nama, selectedDate);
        const buf = editBuffer[docId] || {
          penerimaan: "0",
          pengiriman: "0",
          stockAwal: "0",
        };

        const stockAwal = parseInt(buf.stockAwal) || 0;
        const penerimaan = parseInt(buf.penerimaan) || 0;
        const pengiriman = parseInt(buf.pengiriman) || 0;
        const pemakaian = computePemakaian(pabrikLabel, nama, selectedDate);
        const stockAkhir = stockAwal + penerimaan - pengiriman - pemakaian;

        const docData = {
          pabrik,
          nama,
          tanggal: selectedDate,
          stockAwal,
          penerimaan,
          pengiriman,
          pemakaian,
          stockAkhir,
          createdBy: currentUser.email || "unknown",
          updatedAt: new Date().toISOString(),
        };

        return setDoc(doc(db, "stock_harian", docId), docData, { merge: true });
      });

      await Promise.all(promises);
      triggerToast(
        `Semua stock ${pabrikLabel} berhasil disimpan`,
        "ok"
      );
    } catch (e) {
      console.error("Save all stock failed:", e);
      triggerToast("Gagal menyimpan data stock", "er");
    } finally {
      setSaving(null);
    }
  };

  // Auto-fill stock awal from previous day's stock akhir
  const handleAutoFillStockAwal = async (pabrik: string) => {
    if (!currentUser || !isAdmin) return;

    const pabrikLabel = PABRIK_SHORT[pabrik];
    const prevDate = getPrevDate(selectedDate);

    try {
      const updates: Record<string, string> = {};
      let foundCount = 0;

      for (const nama of JENIS_KANTONG) {
        const prevDocId = makeDocId(pabrik, nama, prevDate);
        const prevDoc = await getDoc(doc(db, "stock_harian", prevDocId));

        if (prevDoc.exists()) {
          const prevData = prevDoc.data();
          const prevStockAkhir = Number(prevData.stockAkhir) || 0;
          const curDocId = makeDocId(pabrik, nama, selectedDate);
          updates[curDocId] = String(prevStockAkhir);
          foundCount++;
        }
      }

      if (foundCount > 0) {
        setEditBuffer((prev) => {
          const next = { ...prev };
          for (const [docId, val] of Object.entries(updates)) {
            next[docId] = { ...next[docId], stockAwal: val };
          }
          return next;
        });
        triggerToast(
          `Stock awal ${pabrikLabel} diisi dari stock akhir ${formatDateDisplay(prevDate)} (${foundCount} item)`,
          "ok"
        );
      } else {
        triggerToast(
          `Tidak ada data stock akhir pada ${formatDateDisplay(prevDate)} untuk ${pabrikLabel}`,
          "inf"
        );
      }
    } catch (e) {
      console.error("Auto-fill stock awal failed:", e);
      triggerToast("Gagal mengisi stock awal otomatis", "er");
    }
  };

  // Date navigation
  const goToPrevDay = () => {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() - 1);
    setSelectedDate(getDateString(d));
  };

  const goToNextDay = () => {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + 1);
    setSelectedDate(getDateString(d));
  };

  const goToToday = () => {
    setSelectedDate(getDateString(new Date()));
  };

  // Compute display values for a row
  const getRowDisplay = (pabrik: string, nama: string, docId: string) => {
    const pabrikLabel = PABRIK_SHORT[pabrik];
    const buf = editBuffer[docId] || {
      penerimaan: "0",
      pengiriman: "0",
      stockAwal: "0",
    };

    const stockAwal = parseInt(buf.stockAwal) || 0;
    const penerimaan = parseInt(buf.penerimaan) || 0;
    const pengiriman = parseInt(buf.pengiriman) || 0;
    const pemakaian = computePemakaian(pabrikLabel, nama, selectedDate);
    const stockAkhir = stockAwal + penerimaan - pengiriman - pemakaian;

    return { stockAwal, penerimaan, pengiriman, pemakaian, stockAkhir };
  };

  // Render table for one pabrik
  const renderPabrikTable = (pabrik: string) => {
    const pabrikLabel = PABRIK_SHORT[pabrik];
    const pabrikColors: Record<string, { header: string; bg: string; accent: string }> = {
      "Pabrik Baturaja 1 (PBR 1)": {
        header: "bg-indigo-600",
        bg: "bg-indigo-50",
        accent: "border-indigo-200",
      },
      "Pabrik Baturaja 2 (PBR 2)": {
        header: "bg-teal-600",
        bg: "bg-teal-50",
        accent: "border-teal-200",
      },
      "Pabrik Palembang (PPG)": {
        header: "bg-amber-600",
        bg: "bg-amber-50",
        accent: "border-amber-200",
      },
      "Pabrik Panjang (PPJ)": {
        header: "bg-rose-600",
        bg: "bg-rose-50",
        accent: "border-rose-200",
      },
    };

    const colors = pabrikColors[pabrik] || {
      header: "bg-gray-600",
      bg: "bg-gray-50",
      accent: "border-gray-200",
    };

    return (
      <div
        key={pabrik}
        className={`rounded-xl border ${colors.accent} overflow-hidden mb-6 shadow-sm`}
      >
        {/* Pabrik Header */}
        <div
          className={`${colors.header} text-white px-4 py-3 flex items-center justify-between flex-wrap gap-2`}
        >
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            <h3 className="font-bold text-lg">🏭 {pabrik}</h3>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <>
                <button
                  onClick={() => handleAutoFillStockAwal(pabrik)}
                  className="flex items-center gap-1 bg-white/20 hover:bg-white/30 text-white text-xs px-3 py-1.5 rounded-lg transition-colors"
                  title="Isi stock awal dari stock akhir hari sebelumnya"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Auto Stock Awal
                </button>
                <button
                  onClick={() => handleSaveAllPabrik(pabrik)}
                  disabled={saving === pabrik}
                  className="flex items-center gap-1 bg-white/20 hover:bg-white/30 text-white text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  {saving === pabrik ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  Simpan Semua
                </button>
              </>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={`${colors.bg} text-gray-700`}>
                <th className="px-4 py-2.5 text-left font-semibold border-b border-gray-200 min-w-[180px]">
                  Jenis Kantong
                </th>
                <th className="px-3 py-2.5 text-right font-semibold border-b border-gray-200 min-w-[100px]">
                  Stock Awal
                </th>
                <th className="px-3 py-2.5 text-right font-semibold border-b border-gray-200 min-w-[100px]">
                  Penerimaan
                </th>
                <th className="px-3 py-2.5 text-right font-semibold border-b border-gray-200 min-w-[100px]">
                  Pengiriman
                </th>
                <th className="px-3 py-2.5 text-right font-semibold border-b border-gray-200 min-w-[100px]">
                  Pemakaian
                </th>
                <th className="px-3 py-2.5 text-right font-semibold border-b border-gray-200 min-w-[100px]">
                  Stock Akhir
                </th>
                {isAdmin && (
                  <th className="px-3 py-2.5 text-center font-semibold border-b border-gray-200 w-[80px]">
                    Aksi
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {JENIS_KANTONG.map((nama, idx) => {
                const docId = makeDocId(pabrik, nama, selectedDate);
                const display = getRowDisplay(pabrik, nama, docId);
                const buf = editBuffer[docId] || {
                  penerimaan: "",
                  pengiriman: "",
                  stockAwal: "",
                };

                return (
                  <tr
                    key={nama}
                    className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                      idx % 2 === 0 ? "bg-white" : "bg-gray-50/50"
                    }`}
                  >
                    <td className="px-4 py-2 font-medium text-gray-800">
                      {nama}
                    </td>

                    {/* Stock Awal */}
                    <td className="px-3 py-2 text-right">
                      {isAdmin ? (
                        <input
                          type="text"
                          inputMode="numeric"
                          value={buf.stockAwal}
                          onChange={(e) =>
                            handleInputChange(docId, "stockAwal", e.target.value)
                          }
                          className="w-20 text-right bg-yellow-50 border border-yellow-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-300"
                          placeholder="0"
                        />
                      ) : (
                        <span className="text-gray-700">{display.stockAwal}</span>
                      )}
                    </td>

                    {/* Penerimaan */}
                    <td className="px-3 py-2 text-right">
                      {isAdmin ? (
                        <input
                          type="text"
                          inputMode="numeric"
                          value={buf.penerimaan}
                          onChange={(e) =>
                            handleInputChange(docId, "penerimaan", e.target.value)
                          }
                          className="w-20 text-right bg-green-50 border border-green-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                          placeholder="0"
                        />
                      ) : (
                        <span className="text-gray-700">{display.penerimaan}</span>
                      )}
                    </td>

                    {/* Pengiriman */}
                    <td className="px-3 py-2 text-right">
                      {isAdmin ? (
                        <input
                          type="text"
                          inputMode="numeric"
                          value={buf.pengiriman}
                          onChange={(e) =>
                            handleInputChange(docId, "pengiriman", e.target.value)
                          }
                          className="w-20 text-right bg-blue-50 border border-blue-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                          placeholder="0"
                        />
                      ) : (
                        <span className="text-gray-700">{display.pengiriman}</span>
                      )}
                    </td>

                    {/* Pemakaian (auto from laporan) */}
                    <td className="px-3 py-2 text-right">
                      <span
                        className={`font-medium ${
                          display.pemakaian > 0
                            ? "text-red-600"
                            : "text-gray-400"
                        }`}
                      >
                        {display.pemakaian}
                      </span>
                    </td>

                    {/* Stock Akhir (auto-calculated) */}
                    <td className="px-3 py-2 text-right">
                      <span
                        className={`font-bold ${
                          display.stockAkhir < 0
                            ? "text-red-600"
                            : display.stockAkhir === 0
                            ? "text-gray-400"
                            : "text-emerald-700"
                        }`}
                      >
                        {display.stockAkhir}
                      </span>
                    </td>

                    {/* Save button per row */}
                    {isAdmin && (
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => handleSaveRow(pabrik, nama, docId)}
                          disabled={saving === docId}
                          className="text-indigo-600 hover:text-indigo-800 disabled:text-gray-300 transition-colors"
                          title="Simpan baris ini"
                        >
                          {saving === docId ? (
                            <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                          ) : (
                            <Save className="w-4 h-4 mx-auto" />
                          )}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}

              {/* Total row */}
              {(() => {
                const totals = JENIS_KANTONG.reduce(
                  (acc, nama) => {
                    const docId = makeDocId(pabrik, nama, selectedDate);
                    const d = getRowDisplay(pabrik, nama, docId);
                    acc.stockAwal += d.stockAwal;
                    acc.penerimaan += d.penerimaan;
                    acc.pengiriman += d.pengiriman;
                    acc.pemakaian += d.pemakaian;
                    acc.stockAkhir += d.stockAkhir;
                    return acc;
                  },
                  {
                    stockAwal: 0,
                    penerimaan: 0,
                    pengiriman: 0,
                    pemakaian: 0,
                    stockAkhir: 0,
                  }
                );

                return (
                  <tr className={`${colors.bg} font-bold text-gray-800`}>
                    <td className="px-4 py-2.5 border-t-2 border-gray-300">
                      TOTAL
                    </td>
                    <td className="px-3 py-2.5 text-right border-t-2 border-gray-300">
                      {totals.stockAwal}
                    </td>
                    <td className="px-3 py-2.5 text-right border-t-2 border-gray-300">
                      {totals.penerimaan}
                    </td>
                    <td className="px-3 py-2.5 text-right border-t-2 border-gray-300">
                      {totals.pengiriman}
                    </td>
                    <td className="px-3 py-2.5 text-right border-t-2 border-gray-300 text-red-600">
                      {totals.pemakaian}
                    </td>
                    <td className="px-3 py-2.5 text-right border-t-2 border-gray-300 text-emerald-700">
                      {totals.stockAkhir}
                    </td>
                    {isAdmin && (
                      <td className="border-t-2 border-gray-300"></td>
                    )}
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // Summary across all pabrik
  const grandSummary = useMemo(() => {
    const summary: Record<
      string,
      {
        stockAwal: number;
        penerimaan: number;
        pengiriman: number;
        pemakaian: number;
        stockAkhir: number;
      }
    > = {};

    JENIS_KANTONG.forEach((nama) => {
      summary[nama] = {
        stockAwal: 0,
        penerimaan: 0,
        pengiriman: 0,
        pemakaian: 0,
        stockAkhir: 0,
      };

      PABRIK_LIST.forEach((pabrik) => {
        const docId = makeDocId(pabrik, nama, selectedDate);
        const d = getRowDisplay(pabrik, nama, docId);
        summary[nama].stockAwal += d.stockAwal;
        summary[nama].penerimaan += d.penerimaan;
        summary[nama].pengiriman += d.pengiriman;
        summary[nama].pemakaian += d.pemakaian;
        summary[nama].stockAkhir += d.stockAkhir;
      });
    });

    return summary;
  }, [editBuffer, selectedDate, reports]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        <span className="ml-3 text-gray-600">Memuat data stock harian...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Date Selector */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <CalendarIcon className="w-5 h-5 text-gray-500" />
            <span className="text-sm text-gray-500 font-medium">Tanggal:</span>
            <div className="flex items-center gap-1">
              <button
                onClick={goToPrevDay}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
              <button
                onClick={goToNextDay}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
            <span className="text-sm text-gray-600 font-semibold">
              {formatDateDisplay(selectedDate)}
            </span>
            <button
              onClick={goToToday}
              className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded-lg hover:bg-indigo-200 transition-colors"
            >
              Hari Ini
            </button>
          </div>

          {!isAdmin && (
            <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              Mode baca saja
            </div>
          )}
        </div>
      </div>

      {/* Formula info */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-800">
        <p className="font-semibold mb-1">📋 Rumus Perhitungan:</p>
        <p>
          <strong>Stock Akhir</strong> = Stock Awal + Penerimaan − Pengiriman − Pemakaian
        </p>
        <p className="text-xs text-emerald-600 mt-1">
          * Pemakaian dihitung otomatis dari data laporan pemakaian kantong (sesuai pabrik & jenis kantong)
        </p>
        <p className="text-xs text-emerald-600">
          * Stock Awal bisa diisi otomatis dari stock akhir hari sebelumnya (klik "Auto Stock Awal")
        </p>
      </div>

      {/* OPT Summary Table */}
      <div className="rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="bg-gray-800 text-white px-4 py-3 flex items-center gap-2">
          <Package className="w-5 h-5" />
          <h3 className="font-bold text-lg">📊 OPT (Konsolidasi Semua Pabrik)</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-700 text-white">
                <th className="px-4 py-2.5 text-left font-semibold min-w-[180px]">
                  Jenis Kantong
                </th>
                <th className="px-3 py-2.5 text-right font-semibold min-w-[100px]">
                  Stock Awal
                </th>
                <th className="px-3 py-2.5 text-right font-semibold min-w-[100px]">
                  Penerimaan
                </th>
                <th className="px-3 py-2.5 text-right font-semibold min-w-[100px]">
                  Pengiriman
                </th>
                <th className="px-3 py-2.5 text-right font-semibold min-w-[100px]">
                  Pemakaian
                </th>
                <th className="px-3 py-2.5 text-right font-semibold min-w-[100px]">
                  Stock Akhir
                </th>
              </tr>
            </thead>
            <tbody>
              {JENIS_KANTONG.map((nama, idx) => {
                const s = grandSummary[nama];
                return (
                  <tr
                    key={nama}
                    className={`border-b border-gray-100 ${
                      idx % 2 === 0 ? "bg-white" : "bg-gray-50/50"
                    }`}
                  >
                    <td className="px-4 py-2 font-medium text-gray-800">{nama}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{s.stockAwal}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{s.penerimaan}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{s.pengiriman}</td>
                    <td className="px-3 py-2 text-right text-red-600 font-medium">
                      {s.pemakaian}
                    </td>
                    <td className="px-3 py-2 text-right text-emerald-700 font-bold">
                      {s.stockAkhir}
                    </td>
                  </tr>
                );
              })}
              {/* Total row */}
              {(() => {
                const t = JENIS_KANTONG.reduce(
                  (acc, nama) => {
                    const s = grandSummary[nama];
                    acc.stockAwal += s.stockAwal;
                    acc.penerimaan += s.penerimaan;
                    acc.pengiriman += s.pengiriman;
                    acc.pemakaian += s.pemakaian;
                    acc.stockAkhir += s.stockAkhir;
                    return acc;
                  },
                  { stockAwal: 0, penerimaan: 0, pengiriman: 0, pemakaian: 0, stockAkhir: 0 }
                );
                return (
                  <tr className="bg-gray-700 text-white font-bold">
                    <td className="px-4 py-2.5">TOTAL</td>
                    <td className="px-3 py-2.5 text-right">{t.stockAwal}</td>
                    <td className="px-3 py-2.5 text-right">{t.penerimaan}</td>
                    <td className="px-3 py-2.5 text-right">{t.pengiriman}</td>
                    <td className="px-3 py-2.5 text-right">{t.pemakaian}</td>
                    <td className="px-3 py-2.5 text-right">{t.stockAkhir}</td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per Pabrik Tables */}
      {PABRIK_LIST.map((pabrik) => renderPabrikTable(pabrik))}
    </div>
  );
}
