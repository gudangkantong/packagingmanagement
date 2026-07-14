import React, { useState, useEffect, useRef } from "react";
import {
  collection, doc, setDoc, onSnapshot, query, where, writeBatch, getDocs, orderBy, limit,
} from "firebase/firestore";
import { Save, Loader2, Package, RefreshCw, Edit2, Trash2 } from "lucide-react";
import { db } from "./firebase";
import { StockHarian, LaporanKantong, AllowedUser, PenerimaanData, PengirimanData } from "./types";
import { getDateString, formatDateDisplay } from "./utils";
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
  onEditPenerimaan: (item: PenerimaanData) => void;
  onDeletePenerimaan: (id: string) => void;
  onEditPengiriman: (item: PengirimanData) => void;
  onDeletePengiriman: (id: string) => void;
}

export default function StockHarianPage({
  currentUser, isAllowed, reports, allowedUsers, triggerToast, selectedDate, penerimaanList, pengirimanList,
  onEditPenerimaan, onDeletePenerimaan, onEditPengiriman, onDeletePengiriman,
}: StockHarianPageProps) {
  const currentUserData = allowedUsers.find(u => u.email === currentUser?.email?.toLowerCase());
  const userRole = currentUserData?.role || (currentUser?.isAnonymous ? "guest" : null);
  const isMasterAdmin = userRole === "super_admin";

  const [prevDayData, setPrevDayData] = useState<Record<string, StockHarian>>({});
  const [prevDayLoaded, setPrevDayLoaded] = useState(false);
  const [stockData, setStockData] = useState<Record<string, StockHarian>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState<Record<string, { stockAwal: string }>>({});
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const ALL_LOCATIONS = [OPT_GUDANG, ...PABRIK_LIST];
  const prevDate = (() => { const d = new Date(selectedDate + "T00:00:00"); d.setDate(d.getDate()-1); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); })();

  const makeDocId = (pabrik: string, nama: string, tanggal: string) => {
    const pKey = PABRIK_SHORT[pabrik] || pabrik;
    return `${pKey}_${nama.replace(/\s+/g, "_")}_${tanggal}`;
  };

  const getPrevDate = (dateStr: string): string => {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  // === SEMUA NILAI DIHITUNG SECARA DINAMIS DARI LIST ===
  // Tidak ada yang dibaca dari stockData (Firestore) selain stockAwal

  const computePemakaian = (pabrikLabel: string, nama: string, tanggal: string): number =>
    reports.filter(r => r.tanggal === tanggal && r.nama === nama && r.pabrik.includes(pabrikLabel)).reduce((s, r) => s + r.total, 0);

  // Penerimaan = dari vendor + transfer masuk dari pabrik lain
  const computePenerimaan = (pabrik: string, nama: string, tanggal: string): number => {
    const directPenerimaan = penerimaanList
      .filter(r => r.tanggal === tanggal && r.nama === nama && r.pabrik === pabrik)
      .reduce((s, r) => s + r.jumlah, 0);
    const incomingPengiriman = pengirimanList
      .filter(r => r.tanggal === tanggal && r.nama === nama && r.tujuan === pabrik)
      .reduce((s, r) => s + r.jumlah, 0);
    return directPenerimaan + incomingPengiriman;
  };

  // Pengiriman keluar = data pengiriman dari pabrik ini ke pabrik lain
  const computePengiriman = (pabrik: string, nama: string, tanggal: string): number =>
    pengirimanList.filter(r => r.tanggal === tanggal && r.nama === nama && r.pabrik === pabrik).reduce((s, r) => s + r.jumlah, 0);

  // Transfer masuk = pengiriman dari pabrik lain yang tujuannya ke pabrik ini (untuk detail view)
  const computeIncomingPengiriman = (pabrik: string, nama: string, tanggal: string): number =>
    pengirimanList.filter(r => r.tanggal === tanggal && r.nama === nama && r.tujuan === pabrik).reduce((s, r) => s + r.jumlah, 0);

  // Get detail data for expanded rows
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

  useEffect(() => {
    if (!currentUser || isAllowed !== true) { setStockData({}); setLoading(false); return; }
    setLoading(true);
    const q = query(collection(db, "stock_harian"), where("tanggal", "==", selectedDate));
    const unsub = onSnapshot(q, snap => {
      const data: Record<string, StockHarian> = {};
      snap.forEach(d => {
        const v = d.data();
        data[d.id] = { id: d.id, pabrik: v.pabrik || "", nama: v.nama || "", tanggal: v.tanggal || "", stockAwal: Number(v.stockAwal) || 0, penerimaan: Number(v.penerimaan) || 0, pengiriman: Number(v.pengiriman) || 0, pemakaian: Number(v.pemakaian) || 0, stockAkhir: Number(v.stockAkhir) || 0, createdBy: v.createdBy || "", updatedAt: v.updatedAt || "" };
      });
      setStockData(data); setLoading(false);
    }, err => { console.error(err); triggerToast("Gagal sync stock harian", "er"); setLoading(false); });
    return () => unsub();
  }, [currentUser, isAllowed, selectedDate]);

  useEffect(() => {
    if (!currentUser || isAllowed !== true) { setPrevDayData({}); setPrevDayLoaded(false); return; }
    const q = query(collection(db, "stock_harian"), where("tanggal", "==", prevDate));
    const unsub = onSnapshot(q, snap => { const data: Record<string, StockHarian> = {}; snap.forEach(d => { data[d.id] = d.data() as StockHarian; }); setPrevDayData(data); setPrevDayLoaded(true); }, err => { console.error(err); setPrevDayLoaded(true); });
    return () => unsub();
  }, [currentUser, isAllowed, prevDate]);

  useEffect(() => {
    if (!prevDayLoaded) return; // tunggu data kemarin resolve dulu biar gak keisi 0 salah
    const buf: Record<string, { stockAwal: string }> = {};
    ALL_LOCATIONS.forEach(p => JENIS_KANTONG.forEach(n => {
      const id = makeDocId(p, n, selectedDate);
      const saved = stockData[id];
      if (saved) { buf[id] = { stockAwal: String(saved.stockAwal) }; }
      else {
        // Try prev day first
        const prevId = makeDocId(p, n, prevDate);
        const pv = prevDayData[prevId];
        if (pv) {
          const ps = Number(pv.stockAkhir) || 0;
          buf[id] = { stockAwal: ps !== 0 ? String(ps) : "" };
        } else {
          // No prev day data — leave empty, auto-save effect will handle backward search
          buf[id] = { stockAwal: "" };
        }
      }
    }));
    setEditBuffer(buf);
  }, [stockData, prevDayData, prevDayLoaded, selectedDate]);


  // Auto-populate stockAwal from prev day's stockAkhir + AUTO-SAVE for new dates
  // Falls back to search backwards if prevDate has no data (multi-day gap)
  useEffect(() => {
    if (!currentUser || !isMasterAdmin || loading || !prevDayLoaded) return;

    const toSave: Array<{ pabrik: string; nama: string; docId: string; stockAwal: number }> = [];
    const needsFallback: Array<{ pabrik: string; nama: string; docId: string }> = [];

    ALL_LOCATIONS.forEach(p => JENIS_KANTONG.forEach(n => {
      const id = makeDocId(p, n, selectedDate);
      if (stockData[id]) return; // already saved, skip
      const prevId = makeDocId(p, n, prevDate);
      const pv = prevDayData[prevId];
      if (pv) {
        const sa = Number(pv.stockAkhir) || 0;
        if (sa !== 0) toSave.push({ pabrik: p, nama: n, docId: id, stockAwal: sa });
      } else {
        // No data for yesterday — need to search backwards
        needsFallback.push({ pabrik: p, nama: n, docId: id });
      }
    }));

    // If some items need fallback, search backwards in Firestore
    const doAutoSave = async () => {
      try {
        // Handle fallback items: search backwards for most recent stock akhir
        if (needsFallback.length > 0) {
          const fallbackResults = new Map<string, number>();

          // Search for each item individually (could be optimized but keeps it clear)
          for (const item of needsFallback) {
            const saved = stockData[item.docId];
            if (saved) continue; // already saved during this effect

            const nama = item.nama;
            const pKey = PABRIK_SHORT[item.pabrik] || item.pabrik;
            const searchId = `${pKey}_${nama.replace(/\s+/g, "_")}`;

            // Query: get most recent stock_harian for this item before selectedDate
            // Doc ID format: {pKey}_{nama}_{tanggal} — lexicographic order = date order for YYYY-MM-DD
            const q = query(
              collection(db, "stock_harian"),
              where("__name__", ">=", searchId + "_"),
              where("__name__", "<", searchId + "_" + selectedDate),
              orderBy("__name__", "desc"),
              limit(1)
            );
            const snap = await getDocs(q);
            if (!snap.empty) {
              const latestDoc = snap.docs[0];
              const data = latestDoc.data();
              const sa = Number(data.stockAkhir) || 0;
              if (sa !== 0) {
                fallbackResults.set(item.docId, sa);
                toSave.push({ pabrik: item.pabrik, nama: nama, docId: item.docId, stockAwal: sa });
              }
            }
          }

          if (fallbackResults.size > 0) {
            console.log(`[StockHarian] Found ${fallbackResults.size} items from backward search`);
          }
        }

        if (toSave.length === 0) return;

        for (const item of toSave) {
          // Double-check: don't overwrite if another effect already saved it
          if (stockData[item.docId]) continue;
          const pn = computePenerimaan(item.pabrik, item.nama, selectedDate);
          const pg = computePengiriman(item.pabrik, item.nama, selectedDate);
          const isOPT = item.pabrik === OPT_GUDANG;
          const pk = isOPT ? 0 : computePemakaian(PABRIK_SHORT[item.pabrik], item.nama, selectedDate);
          const sk = isOPT ? item.stockAwal + pn - pg : item.stockAwal + pn - pg - pk;
          await setDoc(doc(db, "stock_harian", item.docId), {
            pabrik: item.pabrik, nama: item.nama, tanggal: selectedDate,
            stockAwal: item.stockAwal, penerimaan: pn, pengiriman: pg, pemakaian: pk, stockAkhir: sk,
            createdBy: currentUser?.email || "", updatedAt: new Date().toISOString()
          }, { merge: true });
        }
        console.log(`[StockHarian] Auto-saved ${toSave.length} rows (${needsFallback.length} via backward search)`);
      } catch (e) {
        console.error("[StockHarian] Auto-save failed:", e);
      }
    };
    doAutoSave();
  }, [prevDayData, stockData, selectedDate]);

  // === AUTO-SYNC: Update stock_harian Firestore saat penerimaan/pengiriman berubah ===
  // Hanya update baris yang sudah pernah disimpan (ada di stockData)
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!currentUser || !isMasterAdmin || loading) return;
    const savedIds = Object.keys(stockData);
    if (savedIds.length === 0) return;

    // Debounce: tunggu 500ms setelah perubahan terakhir sebelum sync
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(async () => {
      try {
        const batch = writeBatch(db);
        let updateCount = 0;
        for (const docId of savedIds) {
          const saved = stockData[docId];
          if (!saved) continue;
          const pn = computePenerimaan(saved.pabrik, saved.nama, selectedDate);
          const pg = computePengiriman(saved.pabrik, saved.nama, selectedDate);
          const isOPT = saved.pabrik === OPT_GUDANG;
          const pk = isOPT ? 0 : computePemakaian(PABRIK_SHORT[saved.pabrik], saved.nama, selectedDate);
          const sk = isOPT ? saved.stockAwal + pn - pg : saved.stockAwal + pn - pg - pk;
          // Hanya update jika nilai berubah
          if (pn !== saved.penerimaan || pg !== saved.pengiriman || pk !== saved.pemakaian || sk !== saved.stockAkhir) {
            batch.update(doc(db, "stock_harian", docId), {
              penerimaan: pn, pengiriman: pg, pemakaian: pk, stockAkhir: sk,
              updatedAt: new Date().toISOString()
            });
            updateCount++;
          }
        }
        if (updateCount > 0) {
          await batch.commit();
          console.log(`[StockHarian] Auto-synced ${updateCount} rows`);
        }
      } catch (e) {
        console.error("[StockHarian] Auto-sync failed:", e);
      }
    }, 500);

    return () => { if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current); };
  }, [penerimaanList, pengirimanList, reports, selectedDate, stockData, currentUser, isMasterAdmin, loading]);

  const handleInputChange = (docId: string, value: string) => {
    const digits = value.replace(/[^\d]/g, "");
    setEditBuffer(p => ({ ...p, [docId]: { ...p[docId], stockAwal: digits } }));
  };

  const handleSaveRow = async (pabrik: string, nama: string, docId: string) => {
    if (!currentUser || !isMasterAdmin) return;
    setSaving(docId);
    try {
      const b = editBuffer[docId] || { stockAwal: "0" };
      const sa = parseInt(b.stockAwal) || 0;
      const pn = computePenerimaan(pabrik, nama, selectedDate);
      const pg = computePengiriman(pabrik, nama, selectedDate);
      const isOPT = pabrik === OPT_GUDANG;
      const pk = isOPT ? 0 : computePemakaian(PABRIK_SHORT[pabrik], nama, selectedDate);
      const sk = isOPT ? sa + pn - pg : sa + pn - pg - pk;
      await setDoc(doc(db, "stock_harian", docId), { pabrik, nama, tanggal: selectedDate, stockAwal: sa, penerimaan: pn, pengiriman: pg, pemakaian: pk, stockAkhir: sk, createdBy: currentUser.email || "", updatedAt: new Date().toISOString() }, { merge: true });
      triggerToast(`Stock ${nama} (${PABRIK_SHORT[pabrik]}) disimpan`, "ok");
    } catch (e) { console.error(e); triggerToast("Gagal simpan", "er"); }
    finally { setSaving(null); }
  };

  const handleSaveAll = async (pabrik: string) => {
    if (!currentUser || !isMasterAdmin) return;
    setSaving(pabrik);
    try {
      const isOPT = pabrik === OPT_GUDANG;
      await Promise.all(JENIS_KANTONG.map(nama => {
        const docId = makeDocId(pabrik, nama, selectedDate);
        const b = editBuffer[docId] || { stockAwal: "0" };
        const sa = parseInt(b.stockAwal) || 0;
        const pn = computePenerimaan(pabrik, nama, selectedDate);
        const pg = computePengiriman(pabrik, nama, selectedDate);
        const pk = isOPT ? 0 : computePemakaian(PABRIK_SHORT[pabrik], nama, selectedDate);
        const sk = isOPT ? sa + pn - pg : sa + pn - pg - pk;
        return setDoc(doc(db, "stock_harian", docId), { pabrik, nama, tanggal: selectedDate, stockAwal: sa, penerimaan: pn, pengiriman: pg, pemakaian: pk, stockAkhir: sk, createdBy: currentUser.email || "", updatedAt: new Date().toISOString() }, { merge: true });
      }));
      triggerToast(`Semua stock ${PABRIK_SHORT[pabrik]} disimpan`, "ok");
    } catch (e) { console.error(e); triggerToast("Gagal simpan", "er"); }
    finally { setSaving(null); }
  };

  const handleAutoFillStockAwal = async (pabrik: string) => {
    if (!currentUser || !isMasterAdmin) return;
    const prevDate = getPrevDate(selectedDate);
    try {
      const updates: Record<string, string> = {};
      let cnt = 0;
      for (const nama of JENIS_KANTONG) {
        const pv = prevDayData[makeDocId(pabrik, nama, prevDate)];
        if (pv) { updates[makeDocId(pabrik, nama, selectedDate)] = String(Number(pv.stockAkhir) || 0); cnt++; }
      }
      if (cnt > 0) {
        setEditBuffer(p => { const n = { ...p }; for (const [id, v] of Object.entries(updates)) n[id] = { stockAwal: v }; return n; });
        triggerToast(`Stock awal ${PABRIK_SHORT[pabrik]} dari ${formatDateDisplay(prevDate)} (${cnt} item)`, "ok");
      } else triggerToast(`Tidak ada data sebelumnya untuk ${PABRIK_SHORT[pabrik]}`, "inf");
    } catch (e) { console.error(e); triggerToast("Gagal auto-fill", "er"); }
  };

  const formatNumber = (num: number): string => {
    if (num === 0) return "0";
    return num.toLocaleString("en-US");
  };

  // getRowDisplay: SELALU hitung dari list terkini
  // stockAkhir = stockAwal + penerimaan(vendor+transfer masuk) - pengiriman(keluar) - pemakaian
  const getRowDisplay = (pabrik: string, nama: string, docId: string) => {
    const b = editBuffer[docId] || { stockAwal: "0" };
    const sa = parseInt(b.stockAwal) || 0;
    const isOPT = pabrik === OPT_GUDANG;
    const pn = computePenerimaan(pabrik, nama, selectedDate);
    const pg = computePengiriman(pabrik, nama, selectedDate);
    const inc = computeIncomingPengiriman(pabrik, nama, selectedDate);
    const pk = isOPT ? 0 : computePemakaian(PABRIK_SHORT[pabrik], nama, selectedDate);
    const sk = isOPT ? sa + pn - pg : sa + pn - pg - pk;
    return { stockAwal: sa, penerimaan: pn, pengiriman: pg, incomingPengiriman: inc, pemakaian: pk, stockAkhir: sk };
  };

  // Check if stock awal has been changed from saved value
  const isStockAwalChanged = (docId: string): boolean => {
    const buf = editBuffer[docId];
    if (!buf) return false;
    const saved = stockData[docId];
    const savedVal = saved ? String(saved.stockAwal) : "";
    return buf.stockAwal !== savedVal && buf.stockAwal !== "";
  };

  const renderOPTTable = () => (
    <div className="rounded-3xl border-2 border-[#e8e4de] overflow-hidden mb-6 shadow-xs">
      <div className="bg-brand-green text-white px-4 py-3 flex items-center justify-between flex-wrap gap-2 rounded-t-3xl">
        <div className="flex items-center gap-2"><Package className="w-5 h-5" /><h3 className="font-bold text-lg">📦 {OPT_GUDANG}</h3></div>
        {isMasterAdmin && <div className="flex items-center gap-2">
        </div>}
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
                        <input type="text" inputMode="numeric" value={buf.stockAwal ? Number(buf.stockAwal).toLocaleString("en-US") : ""} onChange={e => handleInputChange(docId, e.target.value)} className="w-28 text-right bg-yellow-50 border border-yellow-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-300" placeholder="0" />
                        {changed && (
                          <button onClick={(e) => { e.stopPropagation(); handleSaveRow(OPT_GUDANG, nama, docId); }} disabled={saving === docId} className="text-emerald-600 hover:text-emerald-800 disabled:text-gray-300 transition-colors" title="Simpan">
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
          {isMasterAdmin && <div className="flex items-center gap-2">
          </div>}
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
                          <input type="text" inputMode="numeric" value={buf.stockAwal ? Number(buf.stockAwal).toLocaleString("en-US") : ""} onChange={e => handleInputChange(docId, e.target.value)} className="w-28 text-right bg-yellow-50 border border-yellow-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-300" placeholder="0" />
                          {changed && (
                            <button onClick={(e) => { e.stopPropagation(); handleSaveRow(pabrik, nama, docId); }} disabled={saving === docId} className="text-emerald-600 hover:text-emerald-800 disabled:text-gray-300 transition-colors" title="Simpan">
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

  return (
    <div className="space-y-6">
      {renderOPTTable()}
      {PABRIK_LIST.map(p => renderPabrikTable(p))}
    </div>
  );
}
