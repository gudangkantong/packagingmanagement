import React, { useState, useEffect, useRef } from "react";
import {
  doc, setDoc, getDoc,
} from "firebase/firestore";
import { Save, Loader2, Package, Edit2, Trash2 } from "lucide-react";
import { db } from "./firebase";
import { StockHarian, LaporanKantong, AllowedUser, PenerimaanData, PengirimanData } from "./types";
import { getDateString, formatDateDisplay } from "./utils";
import { getCached, setCache } from "./utils/cache";
import { JENIS_KANTONG } from "./csvUtils";

const OPT_GUDANG = "Gudang OPT";
const PABRIK_LIST = [
  "Pabrik Baturaja 1 (PBR 1)",
  "Pabrik Baturaja 2 (PBR 2)",
  "Pabrik Palembang (PPG)",
  "Pabrik Panjang (PPJ)",
];
const PABRIK_SHORT: Record<string, string> = {
  [OPT_GUDANG]: "OPT",
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
  selectedDate: string;
  penerimaanList: PenerimaanData[];
  pengirimanList: PengirimanData[];
  refreshTrigger: number;
  bumpLastUpdate: () => Promise<void>;
  onEditPenerimaan: (item: PenerimaanData) => void;
  onDeletePenerimaan: (id: string) => void;
  onEditPengiriman: (item: PengirimanData) => void;
  onDeletePengiriman: (id: string) => void;
}

export default function StockHarianPage({
  currentUser, isAllowed, reports, allowedUsers, triggerToast, selectedDate, penerimaanList, pengirimanList, refreshTrigger, bumpLastUpdate,
  onEditPenerimaan, onDeletePenerimaan, onEditPengiriman, onDeletePengiriman,
}: StockHarianPageProps) {
  const currentUserData = allowedUsers.find(u => u.email === currentUser?.email?.toLowerCase());
  const userRole = currentUserData?.role || (currentUser?.isAnonymous ? "guest" : null);
  const isMasterAdmin = userRole === "super_admin";

  // === LOCAL-FIRST: Stock dihitung dari data sumber, bukan dari Firestore ===
  const [stockData, setStockData] = useState<Record<string, StockHarian>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState<Record<string, { stockAwal: string }>>({});
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [touchedInputs, setTouchedInputs] = useState<Record<string, boolean>>({});
  const originalValuesRef = useRef<Record<string, string>>({});
  // Manual stock awal overrides dari Firestore (super admin edits)
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  const ALL_LOCATIONS = [OPT_GUDANG, ...PABRIK_LIST];

  const makeDocId = (pabrik: string, nama: string, tanggal: string) => {
    const pKey = PABRIK_SHORT[pabrik] || pabrik;
    return `${pKey}_${nama.replace(/\s+/g, "_")}_${tanggal}`;
  };

  // Helper functions (unchanged)
  const computePemakaian = (pabrikLabel: string, nama: string, tanggal: string): number =>
    reports.filter(r => r.tanggal === tanggal && r.nama === nama && r.pabrik.includes(pabrikLabel)).reduce((s, r) => s + r.total, 0);

  const computePenerimaan = (pabrik: string, nama: string, tanggal: string): number => {
    const directPenerimaan = penerimaanList
      .filter(r => r.tanggal === tanggal && r.nama === nama && r.pabrik === pabrik)
      .reduce((s, r) => s + r.jumlah, 0);
    const incomingPengiriman = pengirimanList
      .filter(r => r.tanggal === tanggal && r.nama === nama && r.tujuan === pabrik)
      .reduce((s, r) => s + r.jumlah, 0);
    return directPenerimaan + incomingPengiriman;
  };

  const computePengiriman = (pabrik: string, nama: string, tanggal: string): number =>
    pengirimanList.filter(r => r.tanggal === tanggal && r.nama === nama && r.pabrik === pabrik).reduce((s, r) => s + r.jumlah, 0);

  const computeIncomingPengiriman = (pabrik: string, nama: string, tanggal: string): number =>
    pengirimanList.filter(r => r.tanggal === tanggal && r.nama === nama && r.tujuan === pabrik).reduce((s, r) => s + r.jumlah, 0);

  const getPenerimaanDetails = (pabrik: string, nama: string, tanggal: string) =>
    penerimaanList.filter(r => r.tanggal === tanggal && r.nama === nama && r.pabrik === pabrik);

  const getIncomingPengirimanDetails = (pabrik: string, nama: string, tanggal: string) =>
    pengirimanList.filter(r => r.tanggal === tanggal && r.nama === nama && r.tujuan === pabrik);

  const getPengirimanDetails = (pabrik: string, nama: string, tanggal: string) =>
    pengirimanList.filter(r => r.tanggal === tanggal && r.nama === nama && r.pabrik === pabrik);

  const getPemakaianDetails = (pabrikLabel: string, nama: string, tanggal: string) => {
    const items = reports.filter(r => r.tanggal === tanggal && r.nama === nama && r.pabrik.includes(pabrikLabel));
    const vendorMap: Record<string, number> = {};
    items.forEach(r => { vendorMap[r.vendor] = (vendorMap[r.vendor] || 0) + r.total; });
    return Object.entries(vendorMap).map(([vendor, total]) => ({ vendor, total }));
  };

  const addDays = (dateStr: string, days: number): string => {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  // === 1. LOAD STOCK AWAL OVERRIDES: CACHE-FIRST, getDoc (bukan onSnapshot) ===
  useEffect(() => {
    if (!currentUser || isAllowed !== true) { setOverrides({}); return; }

    const loadOverrides = async () => {
      const allOverrides: Record<string, number> = {};

      await Promise.all(ALL_LOCATIONS.map(async (pabrik) => {
        const pKey = PABRIK_SHORT[pabrik] || pabrik;
        const cacheKey = `stock_harian_awal_${pKey}`;

        // 1. Coba cache dulu (gratis, 0 reads)
        const cached = getCached<Record<string, number>>(cacheKey);
        if (cached && Object.keys(cached).length > 0) {
          Object.assign(allOverrides, cached);
          return; // skip Firestore read
        }

        // 2. Cache kosong → getDoc sekali (1 read per lokasi, bukan persistent)
        try {
          const docRef = doc(db, "stock_awal_overrides", pKey);
          const snap = await getDoc(docRef);
          const data = snap.data();
          if (data?.overrides && Object.keys(data.overrides).length > 0) {
            Object.assign(allOverrides, data.overrides as Record<string, number>);
            setCache(cacheKey, data.overrides as Record<string, number>, 30 * 24 * 60 * 60 * 1000);
          }
        } catch (e) {
          console.error(`[StockHarian] Gagal load overrides ${pKey}:`, e);
        }
      }));

      if (Object.keys(allOverrides).length > 0) {
        setOverrides(allOverrides);
      }
    };

    loadOverrides();
  }, [currentUser, isAllowed, refreshTrigger]); // refreshTrigger dari granular sync

  // === 2. COMPUTE STOCK DATA SECARA LOKAL (0 Firestore reads) ===
  useEffect(() => {
    if (!currentUser || isAllowed !== true) { setStockData({}); setLoading(false); return; }
    const todayStr = getDateString(new Date());
    if (selectedDate > todayStr) { setStockData({}); setLoading(false); return; }
    setLoading(true);

    console.log(`[DEBUG] Compute effect: overrides=`, JSON.stringify(overrides), `selectedDate=${selectedDate}`);

    const newStockData: Record<string, StockHarian> = {};

    ALL_LOCATIONS.forEach(pabrik => {
      const isOPT = pabrik === OPT_GUDANG;
      const pKey = PABRIK_SHORT[pabrik] || pabrik;

      JENIS_KANTONG.forEach(nama => {
        // Kumpulkan semua tanggal yang punya data untuk item ini
        const allDates = new Set<string>();
        reports.filter(r => r.nama === nama && r.pabrik.includes(pKey)).forEach(r => allDates.add(r.tanggal));
        penerimaanList.filter(r => r.nama === nama && r.pabrik === pabrik).forEach(r => allDates.add(r.tanggal));
        pengirimanList.filter(r => r.nama === nama && (r.pabrik === pabrik || r.tujuan === pabrik)).forEach(r => allDates.add(r.tanggal));
        // Tambahkan tanggal dari overrides
        Object.keys(overrides).forEach(key => {
          if (key.startsWith(`${PABRIK_SHORT[pabrik]}_${nama.replace(/\s+/g, "_")}_`)) {
            const date = key.split("_").pop();
            if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) allDates.add(date);
          }
        });
        // Selalu masukkan selectedDate supaya cascade jalan
        // (stock awal hari ini = stock akhir kemarin)
        allDates.add(selectedDate);

        if (allDates.size === 0) return;
        const sortedDates = Array.from(allDates).sort();
        const earliestDate = sortedDates[0];
        if (selectedDate < earliestDate) return;

        // Cascade dari earliest ke selectedDate (semua di memori, 0 reads)
        let prevSk = 0;
        let cursor = earliestDate;
        while (cursor <= selectedDate) {
          const docId = makeDocId(pabrik, nama, cursor);
          const override = overrides[docId];
          const pn = computePenerimaan(pabrik, nama, cursor);
          const pg = computePengiriman(pabrik, nama, cursor);
          const pk = isOPT ? 0 : computePemakaian(pKey, nama, cursor);
          const sa = override !== undefined ? override : prevSk;
          const sk = isOPT ? sa + pn - pg : sa + pn - pg - pk;

          if (cursor === selectedDate) {
            newStockData[docId] = {
              id: docId, pabrik, nama, tanggal: cursor,
              stockAwal: sa, penerimaan: pn, pengiriman: pg, pemakaian: pk, stockAkhir: sk,
              createdBy: "", updatedAt: "",
            };
          }
          prevSk = sk;
          cursor = addDays(cursor, 1);
        }
      });
    });

    setStockData(newStockData);
    setLoading(false);
  }, [currentUser, isAllowed, selectedDate, reports, penerimaanList, pengirimanList, overrides]);

  // === 3. EDIT BUFFER: sync dari stockData ===
  useEffect(() => {
    setEditBuffer(prev => {
      const buf: Record<string, { stockAwal: string }> = {};
      ALL_LOCATIONS.forEach(p => JENIS_KANTONG.forEach(n => {
        const id = makeDocId(p, n, selectedDate);
        if (touchedInputs[id]) { buf[id] = prev[id] || { stockAwal: "" }; return; }
        const computed = stockData[id];
        if (computed) { buf[id] = { stockAwal: String(computed.stockAwal) }; }
        else { buf[id] = prev[id] || { stockAwal: "" }; }
      }));
      return buf;
    });
  }, [stockData, selectedDate]);

  // === 4. AUTO-SYNC overrides ke Firestore (debounced) ===
  const overrideSyncRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!currentUser || !isMasterAdmin) return;
    if (overrideSyncRef.current) clearTimeout(overrideSyncRef.current);
    overrideSyncRef.current = setTimeout(async () => {
      try {
        // Group overrides by location
        const byLocation: Record<string, Record<string, number>> = {};
        ALL_LOCATIONS.forEach(pabrik => {
          const pKey = PABRIK_SHORT[pabrik] || pabrik;
          const locOverrides: Record<string, number> = {};
          JENIS_KANTONG.forEach(nama => {
            const docId = makeDocId(pabrik, nama, selectedDate);
            if (overrides[docId] !== undefined && overrides[docId] !== 0) {
              locOverrides[docId] = overrides[docId];
            }
          });
          if (Object.keys(locOverrides).length > 0) byLocation[pKey] = locOverrides;
        });
        // Read-merge-write each location's overrides (jangan overwrite tanggal lain)
        await Promise.all(Object.entries(byLocation).map(async ([pKey, locOverrides]) => {
          const docRef = doc(db, "stock_awal_overrides", pKey);
          const existing = await getDoc(docRef);
          const existingOverrides = (existing.data()?.overrides as Record<string, number>) || {};
          const merged = { ...existingOverrides, ...locOverrides };
          return setDoc(docRef, { overrides: merged, updatedAt: new Date().toISOString() }, { merge: true });
        }));
      } catch (e) { console.error("[StockHarian] Override sync failed:", e); }
    }, 2000);
    return () => { if (overrideSyncRef.current) clearTimeout(overrideSyncRef.current); };
  }, [overrides]);

  // === HANDLERS ===
  const handleInputChange = (docId: string, value: string) => {
    const digits = value.replace(/[^\d]/g, "");
    setEditBuffer(p => ({ ...p, [docId]: { ...p[docId], stockAwal: digits } }));
    setTouchedInputs(p => ({ ...p, [docId]: true }));
  };

  const handleInputFocus = (docId: string) => {
    if (!(docId in originalValuesRef.current)) {
      const buf = editBuffer[docId];
      originalValuesRef.current[docId] = buf?.stockAwal || "0";
    }
  };

  const handleInputBlur = (docId: string) => {
    const original = originalValuesRef.current[docId];
    if (original !== undefined) {
      setEditBuffer(p => ({ ...p, [docId]: { ...p[docId], stockAwal: original } }));
    }
    setTouchedInputs(p => { const n = { ...p }; delete n[docId]; return n; });
    delete originalValuesRef.current[docId];
  };

  const handleSaveRow = async (pabrik: string, nama: string, docId: string) => {
    if (!currentUser) { triggerToast("Belum login", "er"); return; }
    if (!isMasterAdmin) { triggerToast("Hanya Super Admin yang bisa edit stock awal", "er"); return; }
    setSaving(docId);
    try {
      const b = editBuffer[docId] || { stockAwal: "0" };
      const sa = parseInt(b.stockAwal) || 0;
      const pKey = PABRIK_SHORT[pabrik] || pabrik;
      const docRef = doc(db, "stock_awal_overrides", pKey);
      const existing = await getDoc(docRef);
      const existingOverrides = (existing.data()?.overrides as Record<string, number>) || {};
      let merged: Record<string, number>;
      if (sa === 0) {
        // Nilai 0 → hapus override (cascade akan hitung dari hari sebelumnya)
        merged = { ...existingOverrides };
        delete merged[docId];
        setOverrides(prev => { const n = { ...prev }; delete n[docId]; return n; });
      } else {
        merged = { ...existingOverrides, [docId]: sa };
        setOverrides(prev => ({ ...prev, [docId]: sa }));
      }
      await setDoc(docRef, { overrides: merged, updatedAt: new Date().toISOString() }, { merge: true });
      setCache(`stock_harian_awal_${pKey}`, merged, 30 * 24 * 60 * 60 * 1000);
      setTouchedInputs(p => { const n = { ...p }; delete n[docId]; return n; });
      await bumpLastUpdate("laporan");
      triggerToast(`Stock ${nama} (${PABRIK_SHORT[pabrik]}) disimpan`, "ok");
    } catch (e) { console.error(e); triggerToast("Gagal simpan: " + (e as Error)?.message, "er"); }
    finally { setSaving(null); }
  };

  const handleSaveAll = async (pabrik: string) => {
    if (!currentUser) { triggerToast("Belum login", "er"); return; }
    if (!isMasterAdmin) { triggerToast("Hanya Super Admin yang bisa edit stock awal", "er"); return; }
    setSaving(pabrik);
    try {
      const pKey = PABRIK_SHORT[pabrik] || pabrik;
      const locOverrides: Record<string, number> = {};
      JENIS_KANTONG.forEach(nama => {
        const docId = makeDocId(pabrik, nama, selectedDate);
        const b = editBuffer[docId] || { stockAwal: "0" };
        const val = parseInt(b.stockAwal) || 0;
        if (val !== 0) locOverrides[docId] = val; // Jangan simpan nilai 0
      });
      // Read-merge-write: baca existing dulu supaya data tanggal lain tidak hilang
      const docRef = doc(db, "stock_awal_overrides", pKey);
      const existing = await getDoc(docRef);
      const existingOverrides = (existing.data()?.overrides as Record<string, number>) || {};
      // Hapus item yang nilainya 0 dari existing (jika ada)
      JENIS_KANTONG.forEach(nama => {
        const docId = makeDocId(pabrik, nama, selectedDate);
        const b = editBuffer[docId] || { stockAwal: "0" };
        if ((parseInt(b.stockAwal) || 0) === 0) delete existingOverrides[docId];
      });
      const merged = { ...existingOverrides, ...locOverrides };
      setOverrides(prev => {
        const n = { ...prev };
        // Hapus item 0 dari local overrides
        JENIS_KANTONG.forEach(nama => {
          const docId = makeDocId(pabrik, nama, selectedDate);
          if (!locOverrides[docId]) delete n[docId];
        });
        return { ...n, ...locOverrides };
      });
      await setDoc(docRef, { overrides: merged, updatedAt: new Date().toISOString() }, { merge: true });
      setCache(`stock_harian_awal_${pKey}`, merged, 30 * 24 * 60 * 60 * 1000);
      JENIS_KANTONG.forEach(nama => {
        const docId = makeDocId(pabrik, nama, selectedDate);
        setTouchedInputs(p => { const n = { ...p }; delete n[docId]; return n; });
      });
      await bumpLastUpdate("laporan");
      triggerToast(`Semua stock ${PABRIK_SHORT[pabrik]} disimpan`, "ok");
    } catch (e) { console.error(e); triggerToast("Gagal simpan: " + (e as Error)?.message, "er"); }
    finally { setSaving(null); }
  };

  const handleAutoFillStockAwal = (pabrik: string) => {
    if (!currentUser || !isMasterAdmin) return;
    const prevDateStr = (() => { const d = new Date(selectedDate + "T00:00:00"); d.setDate(d.getDate()-1); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); })();
    const updates: Record<string, string> = {};
    let cnt = 0;
    JENIS_KANTONG.forEach(nama => {
      const prevId = makeDocId(pabrik, nama, prevDateStr);
      const prevData = stockData[prevId];
      if (prevData) { updates[makeDocId(pabrik, nama, selectedDate)] = String(Number(prevData.stockAkhir) || 0); cnt++; }
    });
    if (cnt > 0) {
      setEditBuffer(p => { const n = { ...p }; for (const [id, v] of Object.entries(updates)) n[id] = { stockAwal: v }; return n; });
      triggerToast(`Stock awal ${PABRIK_SHORT[pabrik]} dari ${formatDateDisplay(prevDateStr)} (${cnt} item)`, "ok");
    } else triggerToast(`Tidak ada data sebelumnya untuk ${PABRIK_SHORT[pabrik]}`, "inf");
  };

  const formatNumber = (num: number): string => {
    if (num === 0) return "0";
    return num.toLocaleString("en-US");
  };

  const getRowDisplay = (pabrik: string, nama: string, docId: string) => {
    const isOPT = pabrik === OPT_GUDANG;
    const computed = stockData[docId];
    let sa: number;
    if (computed) {
      sa = computed.stockAwal;
    } else {
      sa = 0;
    }
    const pn = computePenerimaan(pabrik, nama, selectedDate);
    const pg = computePengiriman(pabrik, nama, selectedDate);
    const inc = computeIncomingPengiriman(pabrik, nama, selectedDate);
    const pk = isOPT ? 0 : computePemakaian(PABRIK_SHORT[pabrik], nama, selectedDate);
    const sk = isOPT ? sa + pn - pg : sa + pn - pg - pk;
    return { stockAwal: sa, penerimaan: pn, pengiriman: pg, incomingPengiriman: inc, pemakaian: pk, stockAkhir: sk };
  };

  const isStockAwalChanged = (docId: string): boolean => !!touchedInputs[docId];

  // === RENDER FUNCTIONS (UNCHANGED) ===
  const renderOPTTable = () => (
    <div className="rounded-3xl border-2 border-[#e8e4de] overflow-hidden mb-6 shadow-xs">
      <div className="bg-brand-green text-white px-4 py-3 flex items-center justify-between flex-wrap gap-2 rounded-t-3xl">
        <div className="flex items-center gap-2"><Package className="w-5 h-5" /><h3 className="font-bold text-lg">📦 {OPT_GUDANG}</h3></div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-brand-green-light text-gray-700">
            <th className="px-4 py-2.5 text-left font-semibold border-b border-[#e8e4de] min-w-[180px]">Jenis Kantong</th>
            <th className="px-3 py-2.5 text-right font-semibold border-b border-[#e8e4de] min-w-[130px] whitespace-nowrap">Stock Awal</th>
            <th className="px-3 py-2.5 text-right font-semibold border-b border-[#e8e4de] min-w-[100px] whitespace-nowrap">Penerimaan</th>
            <th className="px-3 py-2.5 text-right font-semibold border-b border-[#e8e4de] min-w-[100px] whitespace-nowrap">Pengiriman</th>
            <th className="px-3 py-2.5 text-right font-semibold border-b border-[#e8e4de] min-w-[100px] whitespace-nowrap">Stock Akhir</th>
          </tr></thead>
          <tbody>{JENIS_KANTONG.map((nama, idx) => {
            const docId = makeDocId(OPT_GUDANG, nama, selectedDate);
            const d = getRowDisplay(OPT_GUDANG, nama, docId);
            const buf = editBuffer[docId] || { stockAwal: "" };
            const changed = isStockAwalChanged(docId);
            const rowKey = `${OPT_GUDANG}_${nama}`;
            const isExpanded = expandedRows[rowKey];
            const pnDetails = getPenerimaanDetails(OPT_GUDANG, nama, selectedDate);
            const incomingPgDetails = getIncomingPengirimanDetails(OPT_GUDANG, nama, selectedDate);
            const pgDetails = getPengirimanDetails(OPT_GUDANG, nama, selectedDate);
            const hasDetails = d.penerimaan > 0 || d.pengiriman > 0 || d.incomingPengiriman > 0;
            return (
              <React.Fragment key={nama}>
                <tr className={`border-b border-[#e8e4de] hover:bg-gray-50 transition-colors ${idx % 2 === 0 ? "bg-white" : "bg-gray-50/50"} ${hasDetails ? "cursor-pointer" : ""} ${isExpanded ? "bg-gray-50" : ""}`} onClick={() => { if (hasDetails) setExpandedRows(prev => ({ ...prev, [rowKey]: !prev[rowKey] })); }}>
                  <td className="px-4 py-2 font-medium text-gray-800">
                    {nama}
                    {hasDetails && <span className="ml-2 text-xs text-gray-400">{isExpanded ? "▼" : "▶"}</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {isMasterAdmin ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <input type="text" inputMode="numeric" value={touchedInputs[docId] ? (buf.stockAwal ? Number(buf.stockAwal).toLocaleString("en-US") : "") : (buf.stockAwal ? Number(buf.stockAwal).toLocaleString("en-US") : (d.stockAwal ? d.stockAwal.toLocaleString("en-US") : ""))} onChange={e => handleInputChange(docId, e.target.value)} onFocus={() => handleInputFocus(docId)} onBlur={() => handleInputBlur(docId)} className="w-28 text-right bg-yellow-50 border border-yellow-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-300" placeholder="0" />
                        {changed && (
                          <button onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); handleSaveRow(OPT_GUDANG, nama, docId); }} disabled={saving === docId} className="text-emerald-600 hover:text-emerald-800 disabled:text-gray-300 transition-colors" title="Simpan">
                            {saving === docId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                          </button>
                        )}
                      </div>
                    ) : <span className="text-gray-700">{formatNumber(d.stockAwal)}</span>}
                  </td>
                  <td className="px-3 py-2 text-right"><span className="text-gray-700">{formatNumber(d.penerimaan)}</span></td>
                  <td className="px-3 py-2 text-right"><span className="text-gray-700">{formatNumber(d.pengiriman)}</span></td>
                  <td className="px-3 py-2 text-right"><span className={`font-bold ${d.stockAkhir < 0 ? "text-red-600" : d.stockAkhir === 0 ? "text-gray-400" : "text-emerald-700"}`}>{formatNumber(d.stockAkhir)}</span></td>
                </tr>
                {isExpanded && (
                  <tr className="bg-gray-50/80">
                    <td colSpan={5} className="px-4 py-2">
                      <div className="pl-4 space-y-1 text-xs">
                        {pnDetails.length > 0 && pnDetails.map((item, i) => (
                          <div key={`pn-${i}`} className="flex items-center gap-2 text-emerald-600 group">
                            <span>📦</span> <span>Penerimaan dari {item.sumber || item.pabrik}: <strong>+{formatNumber(item.jumlah)}</strong></span>
                            {isMasterAdmin && <span className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={(e) => { e.stopPropagation(); onEditPenerimaan(item); }} className="p-0.5 rounded hover:bg-emerald-100 text-emerald-500" title="Edit"><Edit2 className="w-3 h-3" /></button>
                              <button onClick={(e) => { e.stopPropagation(); onDeletePenerimaan(item.id); }} className="p-0.5 rounded hover:bg-red-100 text-red-500" title="Hapus"><Trash2 className="w-3 h-3" /></button>
                            </span>}
                          </div>
                        ))}
                        {incomingPgDetails.length > 0 && incomingPgDetails.map((item, i) => (
                          <div key={`inc-${i}`} className="flex items-center gap-2 text-sky-600 group">
                            <span>🚚</span> <span>Transfer masuk dari {PABRIK_SHORT[item.pabrik] || item.pabrik}: <strong>+{formatNumber(item.jumlah)}</strong></span>
                            {isMasterAdmin && <span className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={(e) => { e.stopPropagation(); onEditPengiriman(item); }} className="p-0.5 rounded hover:bg-sky-100 text-sky-500" title="Edit"><Edit2 className="w-3 h-3" /></button>
                              <button onClick={(e) => { e.stopPropagation(); onDeletePengiriman(item.id); }} className="p-0.5 rounded hover:bg-red-100 text-red-500" title="Hapus"><Trash2 className="w-3 h-3" /></button>
                            </span>}
                          </div>
                        ))}
                        {pgDetails.length > 0 && pgDetails.map((item, i) => (
                          <div key={`pg-${i}`} className="flex items-center gap-2 text-blue-600 group">
                            <span>🚚</span> <span>Pengiriman ke {item.tujuan || "-"}: <strong>-{formatNumber(item.jumlah)}</strong></span>
                            {isMasterAdmin && <span className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={(e) => { e.stopPropagation(); onEditPengiriman(item); }} className="p-0.5 rounded hover:bg-blue-100 text-blue-500" title="Edit"><Edit2 className="w-3 h-3" /></button>
                              <button onClick={(e) => { e.stopPropagation(); onDeletePengiriman(item.id); }} className="p-0.5 rounded hover:bg-red-100 text-red-500" title="Hapus"><Trash2 className="w-3 h-3" /></button>
                            </span>}
                          </div>
                        ))}
                        {pnDetails.length === 0 && incomingPgDetails.length === 0 && pgDetails.length === 0 && (
                          <div className="text-gray-400 italic">Tidak ada rincian penerimaan/pengiriman</div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}</tbody>
        </table>
      </div>
    </div>
  );

  const renderPabrikTable = (pabrik: string) => {
    const pc: Record<string, { h: string; b: string; a: string }> = {
      "Pabrik Baturaja 1 (PBR 1)": { h: "bg-brand-green", b: "bg-brand-green-light", a: "border-[#e8e4de]" },
      "Pabrik Baturaja 2 (PBR 2)": { h: "bg-brand-green/90", b: "bg-brand-green-light", a: "border-[#e8e4de]" },
      "Pabrik Palembang (PPG)": { h: "bg-brand-green/80", b: "bg-brand-green-light", a: "border-[#e8e4de]" },
      "Pabrik Panjang (PPJ)": { h: "bg-brand-green/70", b: "bg-brand-green-light", a: "border-[#e8e4de]" },
    };
    const c = pc[pabrik] || { h: "bg-gray-600", b: "bg-gray-50", a: "border-[#e8e4de]" };
    return (
      <div key={pabrik} className={`rounded-3xl border-2 ${c.a} overflow-hidden mb-6 shadow-xs`}>
        <div className={`${c.h} text-white px-4 py-3 flex items-center justify-between flex-wrap gap-2 rounded-t-3xl`}>
          <div className="flex items-center gap-2"><Package className="w-5 h-5" /><h3 className="font-bold text-lg">🏭 {pabrik}</h3></div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-brand-green-light text-gray-700">
              <th className="px-4 py-2.5 text-left font-semibold border-b border-[#e8e4de] min-w-[180px]">Jenis Kantong</th>
              <th className="px-3 py-2.5 text-right font-semibold border-b border-[#e8e4de] min-w-[130px] whitespace-nowrap">Stock Awal</th>
              <th className="px-3 py-2.5 text-right font-semibold border-b border-[#e8e4de] min-w-[100px] whitespace-nowrap">Penerimaan</th>
              <th className="px-3 py-2.5 text-right font-semibold border-b border-[#e8e4de] min-w-[100px] whitespace-nowrap">Pengiriman</th>
              <th className="px-3 py-2.5 text-right font-semibold border-b border-[#e8e4de] min-w-[100px] whitespace-nowrap">Pemakaian</th>
              <th className="px-3 py-2.5 text-right font-semibold border-b border-[#e8e4de] min-w-[100px] whitespace-nowrap">Stock Akhir</th>
            </tr></thead>
            <tbody>{JENIS_KANTONG.map((nama, idx) => {
              const docId = makeDocId(pabrik, nama, selectedDate);
              const d = getRowDisplay(pabrik, nama, docId);
              const buf = editBuffer[docId] || { stockAwal: "" };
              const changed = isStockAwalChanged(docId);
              const rowKey = `${pabrik}_${nama}`;
              const isExpanded = expandedRows[rowKey];
              const pnDetails = getPenerimaanDetails(pabrik, nama, selectedDate);
              const incomingPgDetails = getIncomingPengirimanDetails(pabrik, nama, selectedDate);
              const pgDetails = getPengirimanDetails(pabrik, nama, selectedDate);
              const pkDetails = getPemakaianDetails(PABRIK_SHORT[pabrik], nama, selectedDate);
              const hasDetails = d.penerimaan > 0 || d.pengiriman > 0 || d.incomingPengiriman > 0 || d.pemakaian > 0;
              return (
                <React.Fragment key={nama}>
                  <tr className={`border-b border-[#e8e4de] hover:bg-gray-50 transition-colors ${idx % 2 === 0 ? "bg-white" : "bg-gray-50/50"} ${hasDetails ? "cursor-pointer" : ""} ${isExpanded ? "bg-gray-50" : ""}`} onClick={() => { if (hasDetails) setExpandedRows(prev => ({ ...prev, [rowKey]: !prev[rowKey] })); }}>
                    <td className="px-4 py-2 font-medium text-gray-800">
                      {nama}
                      {hasDetails && <span className="ml-2 text-xs text-gray-400">{isExpanded ? "▼" : "▶"}</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isMasterAdmin ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <input type="text" inputMode="numeric" value={buf.stockAwal ? Number(buf.stockAwal).toLocaleString("en-US") : ""} onChange={e => handleInputChange(docId, e.target.value)} onFocus={() => handleInputFocus(docId)} onBlur={() => handleInputBlur(docId)} className="w-28 text-right bg-yellow-50 border border-yellow-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-300" placeholder="0" />
                          {changed && (
                            <button onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); handleSaveRow(pabrik, nama, docId); }} disabled={saving === docId} className="text-emerald-600 hover:text-emerald-800 disabled:text-gray-300 transition-colors" title="Simpan">
                              {saving === docId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            </button>
                          )}
                        </div>
                      ) : <span className="text-gray-700">{formatNumber(d.stockAwal)}</span>}
                    </td>
                    <td className="px-3 py-2 text-right"><span className="text-gray-700">{formatNumber(d.penerimaan)}</span></td>
                    <td className="px-3 py-2 text-right"><span className="text-gray-700">{formatNumber(d.pengiriman)}</span></td>
                    <td className="px-3 py-2 text-right"><span className={`font-medium ${d.pemakaian > 0 ? "text-red-600" : "text-gray-400"}`}>{formatNumber(d.pemakaian)}</span></td>
                    <td className="px-3 py-2 text-right"><span className={`font-bold ${d.stockAkhir < 0 ? "text-red-600" : d.stockAkhir === 0 ? "text-gray-400" : "text-emerald-700"}`}>{formatNumber(d.stockAkhir)}</span></td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-gray-50/80">
                      <td colSpan={6} className="px-4 py-2">
                        <div className="pl-4 space-y-1 text-xs">
                          {pnDetails.length > 0 && pnDetails.map((item, i) => (
                            <div key={`pn-${i}`} className="flex items-center gap-2 text-emerald-600 group">
                              <span>📦</span> <span>Penerimaan dari {item.sumber || item.pabrik}: <strong>+{formatNumber(item.jumlah)}</strong></span>
                              {isMasterAdmin && <span className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={(e) => { e.stopPropagation(); onEditPenerimaan(item); }} className="p-0.5 rounded hover:bg-emerald-100 text-emerald-500" title="Edit"><Edit2 className="w-3 h-3" /></button>
                                <button onClick={(e) => { e.stopPropagation(); onDeletePenerimaan(item.id); }} className="p-0.5 rounded hover:bg-red-100 text-red-500" title="Hapus"><Trash2 className="w-3 h-3" /></button>
                              </span>}
                            </div>
                          ))}
                          {incomingPgDetails.length > 0 && incomingPgDetails.map((item, i) => (
                            <div key={`inc-${i}`} className="flex items-center gap-2 text-sky-600 group">
                              <span>🚚</span> <span>Transfer masuk dari {PABRIK_SHORT[item.pabrik] || item.pabrik}: <strong>+{formatNumber(item.jumlah)}</strong></span>
                              {isMasterAdmin && <span className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={(e) => { e.stopPropagation(); onEditPengiriman(item); }} className="p-0.5 rounded hover:bg-sky-100 text-sky-500" title="Edit"><Edit2 className="w-3 h-3" /></button>
                                <button onClick={(e) => { e.stopPropagation(); onDeletePengiriman(item.id); }} className="p-0.5 rounded hover:bg-red-100 text-red-500" title="Hapus"><Trash2 className="w-3 h-3" /></button>
                              </span>}
                            </div>
                          ))}
                          {pgDetails.length > 0 && pgDetails.map((item, i) => (
                            <div key={`pg-${i}`} className="flex items-center gap-2 text-blue-600 group">
                              <span>🚚</span> <span>Pengiriman ke {item.tujuan || "-"}: <strong>-{formatNumber(item.jumlah)}</strong></span>
                              {isMasterAdmin && <span className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={(e) => { e.stopPropagation(); onEditPengiriman(item); }} className="p-0.5 rounded hover:bg-blue-100 text-blue-500" title="Edit"><Edit2 className="w-3 h-3" /></button>
                                <button onClick={(e) => { e.stopPropagation(); onDeletePengiriman(item.id); }} className="p-0.5 rounded hover:bg-red-100 text-red-500" title="Hapus"><Trash2 className="w-3 h-3" /></button>
                              </span>}
                            </div>
                          ))}
                          {pkDetails.length > 0 && pkDetails.map((item, i) => (
                            <div key={`pk-${i}`} className="flex items-center gap-2 text-rose-600">
                              <span>📋</span> <span>Pemakaian {item.vendor}: <strong>-{formatNumber(item.total)}</strong></span>
                            </div>
                          ))}
                          {pnDetails.length === 0 && incomingPgDetails.length === 0 && pgDetails.length === 0 && pkDetails.length === 0 && (
                            <div className="text-gray-400 italic">Tidak ada rincian</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}</tbody>
          </table>
        </div>
      </div>
    );
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-brand-green" /><span className="ml-3 text-[#6b6560]">Memuat data stock harian...</span></div>;

  const _todayStr = getDateString(new Date());
  if (selectedDate > _todayStr) {
    return (
      <div className="bg-white border-2 border-[#e8e4de] rounded-3xl p-12 text-center shadow-xs">
        <div className="flex justify-center mb-4">
          <div className="p-4 bg-amber-50/80 text-amber-600 border-2 border-amber-200/60 rounded-2xl">
            <Package className="w-8 h-8" />
          </div>
        </div>
        <h4 className="text-sm font-extrabold text-[#1a1814]">Data Belum Tersedia</h4>
        <p className="text-xs text-[#5c554f] mt-1.5 max-w-sm mx-auto leading-relaxed">
          Data stock harian untuk tanggal <span className="font-extrabold text-[#1a1814] bg-amber-50 px-1.5 py-0.5 rounded-md inline-block">{formatDateDisplay(selectedDate)}</span> belum tersedia.
          <span className="block mt-1.5 text-[#9e9892] text-[11px] font-medium">
            Silakan kembali ke hari ini atau tanggal sebelumnya untuk melihat data.
          </span>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {renderOPTTable()}
      {PABRIK_LIST.map(p => renderPabrikTable(p))}
    </div>
  );
}
