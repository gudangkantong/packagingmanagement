import React, { useState, useEffect, useRef } from "react";
import {
  collection, doc, setDoc, onSnapshot, query, where, getDocs, orderBy, limit,
} from "firebase/firestore";
import { Save, Loader2, Package, RefreshCw, Edit2, Trash2 } from "lucide-react";
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
  bumpLastUpdate: () => Promise<void>;
  refreshTrigger: number;
  onEditPenerimaan: (item: PenerimaanData) => void;
  onDeletePenerimaan: (id: string) => void;
  onEditPengiriman: (item: PengirimanData) => void;
  onDeletePengiriman: (id: string) => void;
}

export default function StockHarianPage({
  currentUser, isAllowed, reports, allowedUsers, triggerToast, selectedDate, penerimaanList, pengirimanList, bumpLastUpdate, refreshTrigger,
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

  // Stock data: real-time listener for recent dates, one-time getDocs for old dates
  useEffect(() => {
    if (!currentUser || isAllowed !== true) { setStockData({}); setLoading(false); return; }

    // === FUTURE DATE GUARD: hemat Firebase reads ===
    const todayStr = getDateString(new Date());
    if (selectedDate > todayStr) {
      setStockData({});
      setLoading(false);
      return; // tidak perlu query Firestore untuk tanggal yang belum ada
    }

    setLoading(true);

    const cacheKey = `stock_harian_${selectedDate}`;
    const cached = getCached<Record<string, StockHarian>>(cacheKey);
    if (cached && Object.keys(cached).length > 0) {
      setStockData(cached);
      setLoading(false);
    }

    const todayMs = new Date(getDateString(new Date()) + "T00:00:00").getTime();
    const selectedMs = new Date(selectedDate + "T00:00:00").getTime();
    const isOldDate = Math.floor((todayMs - selectedMs) / 86400000) > 7;

    const q = query(collection(db, "stock_harian"), where("tanggal", "==", selectedDate));

    if (isOldDate) {
      // Old date: SKIP Firestore if cache exists (data doesn't change)
      if (cached && Object.keys(cached).length > 0) {
        setStockData(cached);
        setLoading(false);
        return; // no Firestore read needed
      }
      // Cache miss: one-time read
      getDocs(q).then(snap => {
        const data: Record<string, StockHarian> = {};
        snap.forEach(d => {
          const v = d.data();
          data[d.id] = { id: d.id, pabrik: v.pabrik || "", nama: v.nama || "", tanggal: v.tanggal || "", stockAwal: Number(v.stockAwal) || 0, penerimaan: Number(v.penerimaan) || 0, pengiriman: Number(v.pengiriman) || 0, pemakaian: Number(v.pemakaian) || 0, stockAkhir: Number(v.stockAkhir) || 0, createdBy: v.createdBy || "", updatedAt: v.updatedAt || "" };
        });
        setStockData(data);
        setLoading(false);
        setCache(cacheKey, data, 30 * 24 * 60 * 60 * 1000); // 30 days for old data
      }).catch(err => {
        console.error("[StockHarian] getDocs error:", err);
        triggerToast("Gagal load stock: " + (err?.code || err?.message || "unknown"), "er");
        setLoading(false);
      });
      return; // no cleanup needed
    }

    // Recent date: real-time listener
    const unsub = onSnapshot(q, snap => {
      const data: Record<string, StockHarian> = {};
      snap.forEach(d => {
        const v = d.data();
        data[d.id] = { id: d.id, pabrik: v.pabrik || "", nama: v.nama || "", tanggal: v.tanggal || "", stockAwal: Number(v.stockAwal) || 0, penerimaan: Number(v.penerimaan) || 0, pengiriman: Number(v.pengiriman) || 0, pemakaian: Number(v.pemakaian) || 0, stockAkhir: Number(v.stockAkhir) || 0, createdBy: v.createdBy || "", updatedAt: v.updatedAt || "" };
      });
      setStockData(data);
      setLoading(false);
      setCache(cacheKey, data, 30 * 24 * 60 * 60 * 1000);
    }, err => {
      console.error("[StockHarian] snapshot error:", err);
      const _hasCache = cached && Object.keys(cached).length > 0;
      if (!_hasCache) {
        triggerToast("Gagal sync stock: " + (err?.code || err?.message || "unknown"), "er");
      }
      setLoading(false);
    });
    return () => unsub();
  }, [currentUser, isAllowed, selectedDate]);

  // Prev day data: real-time for recent, one-time getDocs for old
  useEffect(() => {
    if (!currentUser || isAllowed !== true) { setPrevDayData({}); setPrevDayLoaded(false); return; }

    // === FUTURE DATE GUARD: hemat Firebase reads ===
    const todayStr = getDateString(new Date());
    if (selectedDate > todayStr) {
      setPrevDayData({});
      setPrevDayLoaded(true);
      return; // tidak perlu query Firestore untuk tanggal yang belum ada
    }

    const cacheKey = `stock_harian_${prevDate}`;
    const cached = getCached<Record<string, StockHarian>>(cacheKey);
    if (cached && Object.keys(cached).length > 0) {
      setPrevDayData(cached);
      setPrevDayLoaded(true);
    }

    const todayMs = new Date(getDateString(new Date()) + "T00:00:00").getTime();
    const prevMs = new Date(prevDate + "T00:00:00").getTime();
    const isOldDate = Math.floor((todayMs - prevMs) / 86400000) > 7;

    const q = query(collection(db, "stock_harian"), where("tanggal", "==", prevDate));

    if (isOldDate) {
      // Old date: SKIP Firestore if cache exists
      if (cached && Object.keys(cached).length > 0) {
        setPrevDayData(cached);
        setPrevDayLoaded(true);
        return;
      }
      getDocs(q).then(snap => {
        const data: Record<string, StockHarian> = {};
        snap.forEach(d => { data[d.id] = d.data() as StockHarian; });
        setPrevDayData(data);
        setPrevDayLoaded(true);
        setCache(cacheKey, data, 30 * 24 * 60 * 60 * 1000);
      }).catch(err => { console.error(err); setPrevDayLoaded(true); });
      return;
    }

    const unsub = onSnapshot(q, snap => {
      const data: Record<string, StockHarian> = {};
      snap.forEach(d => { data[d.id] = d.data() as StockHarian; });
      setPrevDayData(data);
      setPrevDayLoaded(true);
      setCache(cacheKey, data, 30 * 24 * 60 * 60 * 1000);
    }, err => { console.error(err); setPrevDayLoaded(true); });
    return () => unsub();
  }, [currentUser, isAllowed, prevDate]);

  useEffect(() => {
    if (!prevDayLoaded) return; // tunggu data kemarin resolve dulu biar gak keisi 0 salah
    const buf: Record<string, { stockAwal: string }> = {};
    ALL_LOCATIONS.forEach(p => JENIS_KANTONG.forEach(n => {
      const id = makeDocId(p, n, selectedDate);
      const prevId = makeDocId(p, n, prevDate);
      const pv = prevDayData[prevId];
      const saved = stockData[id];

      if (pv) {
        // Always derive stockAwal from previous day's stockAkhir
        // This ensures changes to past data propagate correctly
        const ps = Number(pv.stockAkhir) || 0;
        buf[id] = { stockAwal: ps !== 0 ? String(ps) : "" };
      } else if (saved) {
        // Fallback: use saved value if no prev day data
        buf[id] = { stockAwal: String(saved.stockAwal) };
      } else {
        buf[id] = { stockAwal: "" };
      }
    }));
    setEditBuffer(buf);
  }, [stockData, prevDayData, prevDayLoaded, selectedDate]);

  // === AUTO-SAVE: persist stockAwal changes to Firestore when prev day data changes ===
  const autoSaveRunningRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!currentUser || !isMasterAdmin || !prevDayLoaded || loading) return;
    if (autoSaveRunningRef.current) return;
    if (Object.keys(editBuffer).length === 0) return;
    if (Object.keys(stockData).length === 0) return; // skip kalau stockData blm loaded

    // Skip auto-save for future dates and dates older than 7 days (view-only, no writes)
    const todayMs = new Date(getDateString(new Date()) + "T00:00:00").getTime();
    const selectedMs = new Date(selectedDate + "T00:00:00").getTime();
    const daysDiff = Math.floor((todayMs - selectedMs) / 86400000);
    if (daysDiff < 0 || daysDiff > 7) return;

    // Find rows where editBuffer stockAwal differs from saved stockData
    const toSave: { docId: string; pabrik: string; nama: string; stockAwal: number }[] = [];
    ALL_LOCATIONS.forEach(p => JENIS_KANTONG.forEach(n => {
      const id = makeDocId(p, n, selectedDate);
      const buf = editBuffer[id];
      if (!buf) return;
      const bufVal = parseInt(buf.stockAwal) || 0;
      const saved = stockData[id];
      const savedVal = saved ? Number(saved.stockAwal) || 0 : 0;
      // Auto-save if value differs (including when document doesn't exist yet)
      // Also require: has prev day data OR buffer is non-empty
      if (bufVal !== savedVal && buf.stockAwal !== "") {
        toSave.push({ docId: id, pabrik: p, nama: n, stockAwal: bufVal });
      }
    }));

    if (toSave.length === 0) return;

    // Debounce: tunggu 500ms supaya gak rapid-fire saat multiple state update
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      const doAutoSave = async () => {
        if (autoSaveRunningRef.current) return;
        autoSaveRunningRef.current = true;
        try {
          await Promise.all(toSave.map(({ docId, pabrik, nama, stockAwal }) => {
            const isOPT = pabrik === OPT_GUDANG;
            const pKey = PABRIK_SHORT[pabrik] || pabrik;
            const pn = computePenerimaan(pabrik, nama, selectedDate);
            const pg = computePengiriman(pabrik, nama, selectedDate);
            const pk = isOPT ? 0 : computePemakaian(pKey, nama, selectedDate);
            const sk = isOPT ? stockAwal + pn - pg : stockAwal + pn - pg - pk;
            return setDoc(doc(db, "stock_harian", docId), {
              pabrik, nama, tanggal: selectedDate,
              stockAwal, penerimaan: pn, pengiriman: pg, pemakaian: pk, stockAkhir: sk,
              createdBy: currentUser?.email || "", updatedAt: new Date().toISOString()
            }, { merge: true });
          }));
          await bumpLastUpdate();
          console.log(`[StockHarian] Auto-saved ${toSave.length} stock awal rows`);
        } catch (e) {
          console.error("[StockHarian] Auto-save failed:", e);
        } finally {
          autoSaveRunningRef.current = false;
        }
      };
      doAutoSave();
    }, 500);

    // Cleanup timer on unmount or dependency change
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [editBuffer, prevDayData, prevDayLoaded, stockData, loading]);

  // === HELPER: add days to YYYY-MM-DD string ===
  const addDays = (dateStr: string, days: number): string => {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  // === FULL SYNC: Fill all gaps from last known stock to today ===
  const syncRunningRef = useRef(false);
  useEffect(() => {
    if (!currentUser || !isMasterAdmin || loading) return;
    if (syncRunningRef.current) return;

    const doFullSync = async () => {
      syncRunningRef.current = true;
      try {
        const today = getDateString(new Date()); // sync sampai hari ini, bukan selectedDate
        const todayMs = new Date(today + "T00:00:00").getTime();
        const nowMs = new Date(getDateString(new Date()) + "T00:00:00").getTime();
        const daysDiff = Math.floor((nowMs - todayMs) / 86400000);

        // Skip full sync for future dates and dates older than 7 days
        if (daysDiff < 0 || daysDiff > 7) {
          syncRunningRef.current = false;
          return;
        }

        let totalSaved = 0;
        const isOPT = (pabrik: string) => pabrik === OPT_GUDANG;

        // OPTIMIZED: 1 query per location instead of 2 queries per item
        // Old: 5 locations × 9 items × 2 queries = 90 queries
        // New: 5 locations × 1 query = 5 queries
        for (let i = 0; i < ALL_LOCATIONS.length; i++) {
          const pabrik = ALL_LOCATIONS[i];
          const pKey = PABRIK_SHORT[pabrik] || pabrik;

          // Single query: fetch ALL stock_harian docs for this location up to today
          const locQuery = query(
            collection(db, "stock_harian"),
            where("pabrik", "==", pabrik),
            where("tanggal", "<=", today),
            orderBy("tanggal", "desc")
          );
          const locSnap = await getDocs(locQuery);

          // Group docs by item name (nama)
          const docsByNama = new Map<string, { id: string; data: any }[]>();
          locSnap.forEach(d => {
            const v = d.data();
            const nama = v.nama || "";
            if (!docsByNama.has(nama)) docsByNama.set(nama, []);
            docsByNama.get(nama)!.push({ id: d.id, data: v });
          });

          // Process each item type for this location
          for (const nama of JENIS_KANTONG) {
            const docs = docsByNama.get(nama) || [];
            if (docs.length === 0) continue; // no data at all for this item

            // docs are already sorted desc by tanggal from the query
            const lastDoc = docs[0];
            const lastData = lastDoc.data;
            const lastDate = lastData.tanggal;
            const lastStockAkhir = Number(lastData.stockAkhir) || 0;

            // Build lookup map for existing docs
            const existingDocs = new Map<string, any>();
            docs.forEach(d => existingDocs.set(d.id, d.data));

            // Recalculate lastDate's document first
            const lastDocId = makeDocId(pabrik, nama, lastDate);
            const lastExistingData = existingDocs.get(lastDocId) || null;
            const lastPn = computePenerimaan(pabrik, nama, lastDate);
            const lastPg = computePengiriman(pabrik, nama, lastDate);
            const lastPk = isOPT(pabrik) ? 0 : computePemakaian(pKey, nama, lastDate);
            const lastSa = lastExistingData ? Number(lastExistingData.stockAwal) || 0 : 0;
            const lastSk = isOPT(pabrik) ? lastSa + lastPn - lastPg : lastSa + lastPn - lastPg - lastPk;

            const lastExistingPn = lastExistingData ? Number(lastExistingData.penerimaan) || 0 : -1;
            const lastExistingPg = lastExistingData ? Number(lastExistingData.pengiriman) || 0 : -1;
            const lastExistingPk = lastExistingData ? Number(lastExistingData.pemakaian) || 0 : -1;
            const lastExistingSk = lastExistingData ? Number(lastExistingData.stockAkhir) || 0 : -1;
            const lastNeedsWrite = !lastExistingData
              || lastPn !== lastExistingPn || lastPg !== lastExistingPg
              || lastPk !== lastExistingPk || lastSk !== lastExistingSk;

            if (lastNeedsWrite) {
              await setDoc(doc(db, "stock_harian", lastDocId), {
                pabrik, nama, tanggal: lastDate,
                stockAwal: lastSa, penerimaan: lastPn, pengiriman: lastPg, pemakaian: lastPk, stockAkhir: lastSk,
                createdBy: currentUser?.email || "", updatedAt: new Date().toISOString()
              }, { merge: true });
              totalSaved++;
            }

            // Cascade forward: recalculate each day AFTER lastDate up to today
            let prevStockAkhir = lastSk;
            let cursor = addDays(lastDate, 1);

            while (cursor <= today) {
              const cursorDocId = makeDocId(pabrik, nama, cursor);
              const existingData = existingDocs.get(cursorDocId) || null;

              const pn = computePenerimaan(pabrik, nama, cursor);
              const pg = computePengiriman(pabrik, nama, cursor);
              const pk = isOPT(pabrik) ? 0 : computePemakaian(pKey, nama, cursor);
              const sa = prevStockAkhir;
              const sk = isOPT(pabrik) ? sa + pn - pg : sa + pn - pg - pk;

              const existingSa = existingData ? Number(existingData.stockAwal) || 0 : -1;
              const existingPn = existingData ? Number(existingData.penerimaan) || 0 : -1;
              const existingPg = existingData ? Number(existingData.pengiriman) || 0 : -1;
              const existingPk = existingData ? Number(existingData.pemakaian) || 0 : -1;
              const existingSk = existingData ? Number(existingData.stockAkhir) || 0 : -1;
              const needsWrite = !existingData
                || sa !== existingSa || pn !== existingPn || pg !== existingPg
                || pk !== existingPk || sk !== existingSk;

              if (needsWrite) {
                await setDoc(doc(db, "stock_harian", cursorDocId), {
                  pabrik, nama, tanggal: cursor,
                  stockAwal: sa, penerimaan: pn, pengiriman: pg, pemakaian: pk, stockAkhir: sk,
                  createdBy: currentUser?.email || "", updatedAt: new Date().toISOString()
                }, { merge: true });
                totalSaved++;
              }

              prevStockAkhir = sk;
              cursor = addDays(cursor, 1);
            }
          }

          // Small delay between locations to avoid quota exhaustion
          if (i < ALL_LOCATIONS.length - 1) {
            await new Promise(r => setTimeout(r, 100));
          }
        }

        if (totalSaved > 0) {
          console.log(`[StockHarian] Full sync: filled ${totalSaved} rows`);
        }
      } catch (e) {
        console.error("[StockHarian] Full sync failed:", e);
      } finally {
        syncRunningRef.current = false;
      }
    };

    doFullSync();
  }, [currentUser, isMasterAdmin, loading, selectedDate, penerimaanList, pengirimanList, reports]);



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
      await bumpLastUpdate(); // notify other devices
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
      await bumpLastUpdate(); // notify other devices
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

  // === FUTURE DATE GUARD: tampilkan pesan jika tanggal setelah hari ini ===
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
