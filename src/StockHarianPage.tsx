import React, { useState, useEffect, useRef } from "react";
import {
  collection, doc, setDoc, onSnapshot, query, where, getDocs, orderBy, limit,
} from "firebase/firestore";
import { getDocsFromServer } from "firebase/firestore";
import { Save, Loader2, Package, RefreshCw, Edit2, Trash2 } from "lucide-react";
import { db } from "./firebase";
import { StockHarian, LaporanKantong, AllowedUser, PenerimaanData, PengirimanData } from "./types";
import { getDateString, formatDateDisplay } from "./utils";
import { getCached, setCache, removeCache } from "./utils/cache";
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
  const [touchedInputs, setTouchedInputs] = useState<Record<string, boolean>>({});
  const originalValuesRef = useRef<Record<string, string>>({});
  // Track doc IDs yang sudah di-sync oleh cascade/DirectSync
  // supaya effect editBuffer tidak menimpa nilai yang sudah benar
  const cascadeSyncedRef = useRef<Set<string>>(new Set());
  // Reset cascadeSyncedRef saat selectedDate berubah
  useEffect(() => { cascadeSyncedRef.current = new Set(); }, [selectedDate]);

  const ALL_LOCATIONS = [OPT_GUDANG, ...PABRIK_LIST];
  const prevDate = (() => { const d = new Date(selectedDate + "T00:00:00"); d.setDate(d.getDate()-1); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); })();

  // Hapus semua cache stock_harian saat mount supaya data selalu fresh
  useEffect(() => {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.includes("stock_harian_")) localStorage.removeItem(key);
    });
    console.log("[StockHarian] Cleared all stock_harian cache");
  }, []);

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

  // Stock data: SELALU real-time onSnapshot (tanpa cache)
  useEffect(() => {
    if (!currentUser || isAllowed !== true) { setStockData({}); setLoading(false); return; }

    const todayStr = getDateString(new Date());
    if (selectedDate > todayStr) {
      setStockData({});
      setLoading(false);
      return;
    }

    setLoading(true);
    const q = query(collection(db, "stock_harian"), where("tanggal", "==", selectedDate));

    const unsub = onSnapshot(q, snap => {
      const data: Record<string, StockHarian> = {};
      snap.forEach(d => {
        const v = d.data();
        data[d.id] = { id: d.id, pabrik: v.pabrik || "", nama: v.nama || "", tanggal: v.tanggal || "", stockAwal: Number(v.stockAwal) || 0, penerimaan: Number(v.penerimaan) || 0, pengiriman: Number(v.pengiriman) || 0, pemakaian: Number(v.pemakaian) || 0, stockAkhir: Number(v.stockAkhir) || 0, createdBy: v.createdBy || "", updatedAt: v.updatedAt || "" };
      });
      setStockData(data);
      setLoading(false);
      console.log(`[stockData] real-time update: ${Object.keys(data).length} docs for ${selectedDate}`);
    }, err => {
      console.error("[StockHarian] snapshot error:", err);
      triggerToast("Gagal sync stock: " + (err?.code || err?.message || "unknown"), "er");
      setLoading(false);
    });
    return () => unsub();
  }, [currentUser, isAllowed, selectedDate]);

  // Prev day data: SELALU real-time onSnapshot (tanpa cache)
  useEffect(() => {
    if (!currentUser || isAllowed !== true) { setPrevDayData({}); setPrevDayLoaded(false); return; }

    const todayStr = getDateString(new Date());
    if (selectedDate > todayStr) {
      setPrevDayData({});
      setPrevDayLoaded(true);
      return;
    }

    const q = query(collection(db, "stock_harian"), where("tanggal", "==", prevDate));

    const unsub = onSnapshot(q, snap => {
      const data: Record<string, StockHarian> = {};
      snap.forEach(d => { data[d.id] = d.data() as StockHarian; });
      setPrevDayData(data);
      setPrevDayLoaded(true);
      console.log(`[prevDayData] real-time update: ${Object.keys(data).length} docs for ${prevDate}`);
    }, err => {
      console.error("[prevDayData] snapshot error:", err);
      setPrevDayLoaded(true);
    });
    return () => unsub();
  }, [currentUser, isAllowed, prevDate]);

  useEffect(() => {
    if (!prevDayLoaded) return;
    setEditBuffer(prev => {
      const buf: Record<string, { stockAwal: string }> = {};
      ALL_LOCATIONS.forEach(p => JENIS_KANTONG.forEach(n => {
        const id = makeDocId(p, n, selectedDate);

        // JANGAN overwrite kalau admin sedang edit (touched)
        if (touchedInputs[id]) {
          buf[id] = prev[id] || { stockAwal: "" };
          return;
        }

        // JANGAN overwrite kalau cascade/DirectSync sudah set nilai ini
        if (cascadeSyncedRef.current.has(id)) {
          buf[id] = prev[id] || { stockAwal: "" };
          return;
        }

        const prevId = makeDocId(p, n, prevDate);
        const pv = prevDayData[prevId];
        const saved = stockData[id];

        if (pv) {
          const ps = Number(pv.stockAkhir) || 0;
          buf[id] = { stockAwal: ps !== 0 ? String(ps) : "" };
        } else if (saved) {
          buf[id] = { stockAwal: String(saved.stockAwal) };
        } else {
          buf[id] = { stockAwal: "" };
        }
      }));
      return buf;
    });
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
    if (daysDiff < 0 || daysDiff > 30) return;

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
              manuallyEdited: true,
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

  // === DIRECT SYNC: stockAwal[today] = stockAkhir[yesterday] ===
  // Effect ini JAUH lebih cepat dari cascade karena:
  // 1. Hanya proses selectedDate (bukan semua tanggal)
  // 2. Langsung baca dari prevDayData (sudah di-cache)
  // 3. Langsung tulis ke Firestore tanpa query tambahan
  // Ini memastikan stockAkhir kemarin SELALU ter-refleksi sebagai stockAwal hari ini
  const directSyncRef = useRef(false);
  const directSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!currentUser || isAllowed !== true || !prevDayLoaded || loading) return;
    if (directSyncRef.current) return;

    // Debounce 1 detik supaya tidak rapid-fire
    if (directSyncTimerRef.current) clearTimeout(directSyncTimerRef.current);
    directSyncTimerRef.current = setTimeout(() => {
      const doDirectSync = async () => {
        if (directSyncRef.current) return;
        directSyncRef.current = true;
        try {
          let writeCount = 0;
          const bufferUpdates = new Map<string, number>();

          for (const pabrik of ALL_LOCATIONS) {
            const pKey = PABRIK_SHORT[pabrik] || pabrik;
            const isOPT = pabrik === OPT_GUDANG;

            for (const nama of JENIS_KANTONG) {
              const prevId = makeDocId(pabrik, nama, prevDate);
              const pv = prevDayData[prevId];
              if (!pv) continue; // Tidak ada data kemarin

              const prevSk = Number(pv.stockAkhir) || 0;
              const docId = makeDocId(pabrik, nama, selectedDate);
              const existing = stockData[docId];
              const existingSa = existing ? Number(existing.stockAwal) || 0 : -1;

              // Hanya tulis jika stockAwal berbeda dari stockAkhir kemarin
              if (prevSk !== existingSa) {
                const pn = computePenerimaan(pabrik, nama, selectedDate);
                const pg = computePengiriman(pabrik, nama, selectedDate);
                const pk = isOPT ? 0 : computePemakaian(pKey, nama, selectedDate);
                const sk = isOPT ? prevSk + pn - pg : prevSk + pn - pg - pk;

                await setDoc(doc(db, "stock_harian", docId), {
                  pabrik, nama, tanggal: selectedDate,
                  stockAwal: prevSk, penerimaan: pn, pengiriman: pg, pemakaian: pk, stockAkhir: sk,
                  createdBy: currentUser?.email || "", updatedAt: new Date().toISOString()
                }, { merge: true });
                writeCount++;
                bufferUpdates.set(docId, prevSk);

                if (isOPT) {
                  console.log(`[DirectSync] OPT ${nama}: stockAkhir kemarin=${prevSk} → stockAwal hari ini=${prevSk}, pn=${pn}, pg=${pg}, sk=${sk}`);
                }
              }
            }
          }

          // Update editBuffer langsung supaya UI sinkron
          if (bufferUpdates.size > 0) {
            // Tandai doc yang sudah di-sync supaya effect tidak overwrite
            bufferUpdates.forEach((_, key) => cascadeSyncedRef.current.add(key));
            setEditBuffer(prev => {
              const next = { ...prev };
              bufferUpdates.forEach((val, key) => {
                if (!touchedInputs[key]) {
                  next[key] = { stockAwal: String(val) };
                }
              });
              return next;
            });
            await bumpLastUpdate();
            console.log(`[DirectSync] ${writeCount} docs synced: stockAwal = stockAkhir kemarin`);
          }
        } catch (e) {
          console.error("[DirectSync] Failed:", e);
        } finally {
          directSyncRef.current = false;
        }
      };
      doDirectSync();
    }, 1000); // debounce 1 detik

    return () => {
      if (directSyncTimerRef.current) {
        clearTimeout(directSyncTimerRef.current);
        directSyncTimerRef.current = null;
      }
    };
  }, [prevDayData, prevDayLoaded, selectedDate, penerimaanList, pengirimanList, reports, loading]);

  // === HELPER: add days to YYYY-MM-DD string ===
  const addDays = (dateStr: string, days: number): string => {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  // === FULL SYNC: Cascade dari anchor date ke hari ini ===
  // Anchor = dokumen stock_harian paling awal (biasanya 1 Juli)
  // stockAwal anchor TIDAK diubah (itu data real dari admin)
  // Cascade hanya MAJU: stockAwal[t+1] = stockAkhir[t]
  const syncRunningRef = useRef(false);
  const syncDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSyncRef = useRef(false);
  useEffect(() => {
    if (!currentUser || isAllowed !== true || loading) return;
    if (syncRunningRef.current) {
      // Cascade sedang berjalan, tandai bahwa ada perubahan pending
      pendingSyncRef.current = true;
      return;
    }

    // Debounce 3 detik supaya tidak rapid-fire saat banyak onSnapshot update
    if (syncDebounceRef.current) clearTimeout(syncDebounceRef.current);
    syncDebounceRef.current = setTimeout(() => {
      const doFullSync = async () => {
        if (syncRunningRef.current) return;
        syncRunningRef.current = true;
        pendingSyncRef.current = false;
        try {
          const today = getDateString(new Date());
          const isOPT = (pabrik: string) => pabrik === OPT_GUDANG;

          console.log(`[StockHarian] === CASCADE START === selectedDate=${selectedDate}, today=${today}`);
          console.log(`[StockHarian] penerimaanList.length=${penerimaanList.length}, pengirimanList.length=${pengirimanList.length}, reports.length=${reports.length}`);

          let totalSaved = 0;
          // Track stockAwal yang ditulis cascade untuk selectedDate
          // supaya bisa sync editBuffer setelah selesai
          const todayBufferUpdates = new Map<string, number>();

          for (let i = 0; i < ALL_LOCATIONS.length; i++) {
            const pabrik = ALL_LOCATIONS[i];
            const pKey = PABRIK_SHORT[pabrik] || pabrik;

            const locQuery = query(
              collection(db, "stock_harian"),
              where("pabrik", "==", pabrik),
              where("tanggal", "<=", today),
              orderBy("tanggal", "desc")
            );
            const locSnap = await getDocsFromServer(locQuery);

            if (pabrik === OPT_GUDANG) {
              console.log(`[StockHarian] OPT: fetched ${locSnap.size} stock_harian docs FROM SERVER`);
            }

            const docsByNama = new Map<string, { id: string; data: any }[]>();
            locSnap.forEach(d => {
              const v = d.data();
              const nama = v.nama || "";
              if (!docsByNama.has(nama)) docsByNama.set(nama, []);
              docsByNama.get(nama)!.push({ id: d.id, data: v });
            });

            for (const nama of JENIS_KANTONG) {
              const docs = docsByNama.get(nama) || [];

              if (docs.length === 0) {
                // Belum ada data stock_harian → inisialisasi dari laporan
                const hasAnyReport = reports.some(r =>
                  r.nama === nama && r.pabrik.includes(pKey)
                );
                if (!hasAnyReport) continue;

                const itemReports = reports.filter(r => r.nama === nama && r.pabrik.includes(pKey));
                const earliestReport = itemReports.reduce((earliest, r) =>
                  r.tanggal < earliest ? r.tanggal : earliest, itemReports[0].tanggal
                );

                let prevSk = 0;
                let cursor = earliestReport;
                while (cursor <= today) {
                  const cursorDocId = makeDocId(pabrik, nama, cursor);
                  const pn = computePenerimaan(pabrik, nama, cursor);
                  const pg = computePengiriman(pabrik, nama, cursor);
                  const pk = isOPT(pabrik) ? 0 : computePemakaian(pKey, nama, cursor);
                  const sa = prevSk;
                  const sk = isOPT(pabrik) ? sa + pn - pg : sa + pn - pg - pk;

                  await setDoc(doc(db, "stock_harian", cursorDocId), {
                    pabrik, nama, tanggal: cursor,
                    stockAwal: sa, penerimaan: pn, pengiriman: pg, pemakaian: pk, stockAkhir: sk,
                    createdBy: currentUser?.email || "", updatedAt: new Date().toISOString()
                  }, { merge: true });
                  totalSaved++;

                  // Track untuk sync editBuffer jika ini selectedDate
                  if (cursor === selectedDate) {
                    todayBufferUpdates.set(cursorDocId, sa);
                  }

                  prevSk = sk;
                  cursor = addDays(cursor, 1);
                }

                // === FIX: Update besok stockAwal = hari ini stockAkhir ===
                const tomorrowInit = addDays(today, 1);
                const tomorrowInitId = makeDocId(pabrik, nama, tomorrowInit);
                // Note: existingDocs not available in this branch (docs.length === 0),
                // so tomorrow doc definitely doesn't exist yet
                const tomorrowInitData = null;
                if (!tomorrowInitData || !tomorrowInitData.manuallyEdited) {
                  const tomorrowSa = prevSk;
                  const pnT = computePenerimaan(pabrik, nama, tomorrowInit);
                  const pgT = computePengiriman(pabrik, nama, tomorrowInit);
                  const pkT = isOPT(pabrik) ? 0 : computePemakaian(pKey, nama, tomorrowInit);
                  const skT = isOPT(pabrik) ? tomorrowSa + pnT - pgT : tomorrowSa + pnT - pgT - pkT;
                  await setDoc(doc(db, "stock_harian", tomorrowInitId), {
                    pabrik, nama, tanggal: tomorrowInit,
                    stockAwal: tomorrowSa, penerimaan: pnT, pengiriman: pgT, pemakaian: pkT, stockAkhir: skT,
                    createdBy: currentUser?.email || "", updatedAt: new Date().toISOString()
                  }, { merge: true });
                  totalSaved++;
                }
                continue;
              }

              // === NORMAL FLOW ===
              // Anchor = dokumen paling awal (stockAwal-nya TIDAK diubah)
              // Cascade dari anchor+1 sampai today
              const existingDocs = new Map<string, any>();
              docs.forEach(d => existingDocs.set(d.id, d.data));

              // docs sorted desc → yang paling awal = docs[docs.length - 1]
              const anchorDoc = docs[docs.length - 1];
              const anchorDate = anchorDoc.data.tanggal;
              const anchorSk = Number(anchorDoc.data.stockAkhir) || 0;

              // Cascade dari anchor+1 sampai today
              let prevSk = anchorSk;
              let cursor = addDays(anchorDate, 1);

              while (cursor <= today) {
                const cursorDocId = makeDocId(pabrik, nama, cursor);
                const existingData = existingDocs.get(cursorDocId) || null;

                // Hormati edit manual: kalau admin sudah edit stockAwal,
                // jangan overwrite, tapi pakai stockAkhir-nya sebagai anchor baru
                if (existingData && existingData.manuallyEdited) {
                  const manualSk = Number(existingData.stockAkhir) || 0;
                  // Recalculate stockAkhir kalau penerimaan/pengiriman/pemakaian berubah
                  const manualSa = Number(existingData.stockAwal) || 0;
                  const pn = computePenerimaan(pabrik, nama, cursor);
                  const pg = computePengiriman(pabrik, nama, cursor);
                  const pk = isOPT(pabrik) ? 0 : computePemakaian(pKey, nama, cursor);
                  const newSk = isOPT(pabrik) ? manualSa + pn - pg : manualSa + pn - pg - pk;
                  if (newSk !== manualSk || pn !== Number(existingData.penerimaan) || pg !== Number(existingData.pengiriman) || pk !== Number(existingData.pemakaian)) {
                    await setDoc(doc(db, "stock_harian", cursorDocId), {
                      pabrik, nama, tanggal: cursor,
                      stockAwal: manualSa, penerimaan: pn, pengiriman: pg, pemakaian: pk, stockAkhir: newSk,
                      manuallyEdited: true,
                      createdBy: currentUser?.email || "", updatedAt: new Date().toISOString()
                    }, { merge: true });
                    totalSaved++;
                  }
                  prevSk = newSk; // anchor baru dari edit manual
                  cursor = addDays(cursor, 1);
                  continue;
                }

                // Normal: hitung dari prevSk
                const pn = computePenerimaan(pabrik, nama, cursor);
                const pg = computePengiriman(pabrik, nama, cursor);
                const pk = isOPT(pabrik) ? 0 : computePemakaian(pKey, nama, cursor);
                const sa = prevSk;
                const sk = isOPT(pabrik) ? sa + pn - pg : sa + pn - pg - pk;

                // Debug logging untuk OPT pada selectedDate
                if (pabrik === OPT_GUDANG && cursor === selectedDate) {
                  console.log(`[StockHarian] OPT ${nama} ${cursor}: sa=${sa} pn=${pn} pg=${pg} sk=${sk} existingSa=${existingData ? Number(existingData.stockAwal) : 'none'} needsWrite=${!existingData || sa !== (existingData ? Number(existingData.stockAwal) : -1) || pn !== (existingData ? Number(existingData.penerimaan) : -1)}`);
                }

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

                  // Track untuk sync editBuffer jika ini selectedDate
                  if (cursor === selectedDate) {
                    todayBufferUpdates.set(cursorDocId, sa);
                  }
                } else if (cursor === selectedDate && existingData) {
                  // Walau tidak perlu write, track juga supaya editBuffer sinkron
                  todayBufferUpdates.set(cursorDocId, sa);
                }

                prevSk = sk;
                cursor = addDays(cursor, 1);
              }

              // === FIX: Update besok stockAwal = hari ini stockAkhir ===
              const tomorrow = addDays(today, 1);
              const tomorrowDocId = makeDocId(pabrik, nama, tomorrow);
              const tomorrowData = existingDocs.get(tomorrowDocId) || null;
              if (!tomorrowData || !tomorrowData.manuallyEdited) {
                const tomorrowSa = prevSk;
                if (!tomorrowData || Number(tomorrowData.stockAwal) !== tomorrowSa) {
                  const pnT = computePenerimaan(pabrik, nama, tomorrow);
                  const pgT = computePengiriman(pabrik, nama, tomorrow);
                  const pkT = isOPT(pabrik) ? 0 : computePemakaian(pKey, nama, tomorrow);
                  const skT = isOPT(pabrik) ? tomorrowSa + pnT - pgT : tomorrowSa + pnT - pgT - pkT;
                  await setDoc(doc(db, "stock_harian", tomorrowDocId), {
                    pabrik, nama, tanggal: tomorrow,
                    stockAwal: tomorrowSa, penerimaan: pnT, pengiriman: pgT, pemakaian: pkT, stockAkhir: skT,
                    createdBy: currentUser?.email || "", updatedAt: new Date().toISOString()
                  }, { merge: true });
                  totalSaved++;
                }
              }
            }

            if (i < ALL_LOCATIONS.length - 1) {
              await new Promise(r => setTimeout(r, 100));
            }
          }

          // === SYNC EDIT BUFFER ===
          // Setelah cascade menulis ke Firestore, update editBuffer untuk selectedDate
          // supaya UI langsung menampilkan stockAwal yang benar (= prev day stockAkhir)
          // tanpa menunggu onSnapshot yang bisa race condition
          console.log(`[StockHarian] Cascade buffer sync: todayBufferUpdates.size=${todayBufferUpdates.size}, selectedDate=${selectedDate}`);
          todayBufferUpdates.forEach((val, key) => {
            console.log(`[StockHarian] Buffer: ${key} = ${val}`);
          });
          if (todayBufferUpdates.size > 0) {
            // Tandai doc yang sudah di-sync cascade supaya effect tidak overwrite
            todayBufferUpdates.forEach((_, key) => cascadeSyncedRef.current.add(key));
            setEditBuffer(prev => {
              const next = { ...prev };
              todayBufferUpdates.forEach((val, key) => {
                // Jangan overwrite kalau admin sedang edit (touched)
                if (!touchedInputs[key]) {
                  next[key] = { stockAwal: String(val) };
                }
              });
              return next;
            });
          }

          if (totalSaved > 0) {
            console.log(`[StockHarian] Cascade: ${totalSaved} rows updated`);
            await bumpLastUpdate();
          }
        } catch (e) {
          console.error("[StockHarian] Cascade failed:", e);
        } finally {
          syncRunningRef.current = false;
          // Jika ada perubahan yang terlewat saat cascade berjalan, jalankan ulang
          if (pendingSyncRef.current) {
            pendingSyncRef.current = false;
            console.log("[StockHarian] Pending sync detected, re-triggering cascade...");
            setTimeout(() => setRefreshTrigger(prev => prev + 1), 100);
          }
        }
      };

      doFullSync();
    }, 3000); // debounce 3 detik

    return () => {
      if (syncDebounceRef.current) {
        clearTimeout(syncDebounceRef.current);
        syncDebounceRef.current = null;
      }
    };
  }, [currentUser, isAllowed, loading, selectedDate, penerimaanList, pengirimanList, reports, refreshTrigger]);



  const handleInputChange = (docId: string, value: string) => {
    const digits = value.replace(/[^\d]/g, "");
    setEditBuffer(p => ({ ...p, [docId]: { ...p[docId], stockAwal: digits } }));
    setTouchedInputs(p => ({ ...p, [docId]: true }));
  };

  const handleInputFocus = (docId: string) => {
    // Simpan nilai asli saat pertama kali fokus
    if (!(docId in originalValuesRef.current)) {
      const buf = editBuffer[docId];
      originalValuesRef.current[docId] = buf?.stockAwal || "0";
    }
  };

  const handleInputBlur = (docId: string) => {
    // Admin batal edit (klik lain tanpa save) → revert ke nilai asli
    const original = originalValuesRef.current[docId];
    if (original !== undefined) {
      // Kembalikan ke nilai asli
      setEditBuffer(p => ({ ...p, [docId]: { ...p[docId], stockAwal: original } }));
    }
    // Selalu hapus touched supaya save icon hilang
    setTouchedInputs(p => { const n = { ...p }; delete n[docId]; return n; });
    delete originalValuesRef.current[docId];
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
      await setDoc(doc(db, "stock_harian", docId), { pabrik, nama, tanggal: selectedDate, stockAwal: sa, penerimaan: pn, pengiriman: pg, pemakaian: pk, stockAkhir: sk, manuallyEdited: true, createdBy: currentUser.email || "", updatedAt: new Date().toISOString() }, { merge: true });
      // Update stockData supaya UI langsung sinkron & isStockAwalChanged jadi false
      setStockData(prev => ({ ...prev, [docId]: { id: docId, pabrik, nama, tanggal: selectedDate, stockAwal: sa, penerimaan: pn, pengiriman: pg, pemakaian: pk, stockAkhir: sk, manuallyEdited: true, createdBy: currentUser.email || "", updatedAt: new Date().toISOString() } }));
      // Invalidate cache supaya reload baca dari Firestore, bukan data lama
      removeCache(`stock_harian_${selectedDate}`);
      // Hapus touched state supaya save icon hilang
      setTouchedInputs(p => { const n = { ...p }; delete n[docId]; return n; });
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
        return setDoc(doc(db, "stock_harian", docId), { pabrik, nama, tanggal: selectedDate, stockAwal: sa, penerimaan: pn, pengiriman: pg, pemakaian: pk, stockAkhir: sk, manuallyEdited: true, createdBy: currentUser.email || "", updatedAt: new Date().toISOString() }, { merge: true });
      }));
      // Update stockData untuk semua item supaya UI langsung sinkron
      setStockData(prev => {
        const updated = { ...prev };
        JENIS_KANTONG.forEach(nama => {
          const docId = makeDocId(pabrik, nama, selectedDate);
          const b = editBuffer[docId] || { stockAwal: "0" };
          const sa = parseInt(b.stockAwal) || 0;
          const pn = computePenerimaan(pabrik, nama, selectedDate);
          const pg = computePengiriman(pabrik, nama, selectedDate);
          const pk = isOPT ? 0 : computePemakaian(PABRIK_SHORT[pabrik], nama, selectedDate);
          const sk = isOPT ? sa + pn - pg : sa + pn - pg - pk;
          updated[docId] = { id: docId, pabrik, nama, tanggal: selectedDate, stockAwal: sa, penerimaan: pn, pengiriman: pg, pemakaian: pk, stockAkhir: sk, manuallyEdited: true, createdBy: currentUser.email || "", updatedAt: new Date().toISOString() };
        });
        return updated;
      });
      // Invalidate cache supaya reload baca dari Firestore
      removeCache(`stock_harian_${selectedDate}`);
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
    const isOPT = pabrik === OPT_GUDANG;
    let sa: number;

    if (isOPT) {
      // === GUDANG OPT: hitung stockAwal langsung dari prevDayData ===
      const saved = stockData[docId];
      if (saved && saved.manuallyEdited) {
        sa = Number(saved.stockAwal) || 0;
      } else {
        const prevId = makeDocId(pabrik, nama, prevDate);
        const pv = prevDayData[prevId];
        const prevAkhir = pv ? Number(pv.stockAkhir) : NaN;
        sa = !isNaN(prevAkhir) ? prevAkhir : (saved ? Number(saved.stockAwal) || 0 : 0);
        // Debug: log SETIAP render untuk diagnosa
        console.log(`[OPT] ${nama}: prevId=${prevId} prevDayData.exists=${!!pv} prevAkhir=${prevAkhir} → sa=${sa}`);
      }
    } else {
      const b = editBuffer[docId] || { stockAwal: "0" };
      sa = parseInt(b.stockAwal) || 0;
    }

    const pn = computePenerimaan(pabrik, nama, selectedDate);
    const pg = computePengiriman(pabrik, nama, selectedDate);
    const inc = computeIncomingPengiriman(pabrik, nama, selectedDate);
    const pk = isOPT ? 0 : computePemakaian(PABRIK_SHORT[pabrik], nama, selectedDate);
    const sk = isOPT ? sa + pn - pg : sa + pn - pg - pk;
    return { stockAwal: sa, penerimaan: pn, pengiriman: pg, incomingPengiriman: inc, pemakaian: pk, stockAkhir: sk };
  };

  // Check if stock awal has been changed from saved value
  const isStockAwalChanged = (docId: string): boolean => {
    // Hanya tampilkan save icon kalau admin benar-benar mengubah nilai
    return !!touchedInputs[docId];
  };

  const renderOPTTable = () => (
    <div className="rounded-3xl border-2 border-[#e8e4de] overflow-hidden mb-6 shadow-xs">
      <div className="bg-brand-green text-white px-4 py-3 flex items-center justify-between flex-wrap gap-2 rounded-t-3xl">
        <div className="flex items-center gap-2"><Package className="w-5 h-5" /><h3 className="font-bold text-lg">📦 {OPT_GUDANG}</h3></div>
        {isMasterAdmin && <div className="flex items-center gap-2">
          <button
            onClick={() => setRefreshTrigger(prev => prev + 1)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium transition-colors"
            title="Sinkron ulang data stock"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Sync</span>
          </button>
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
                        <input type="text" inputMode="numeric" value={touchedInputs[docId] ? (buf.stockAwal ? Number(buf.stockAwal).toLocaleString("en-US") : "") : (d.stockAwal ? d.stockAwal.toLocaleString("en-US") : "")} onChange={e => handleInputChange(docId, e.target.value)} onFocus={() => handleInputFocus(docId)} onBlur={() => handleInputBlur(docId)} className="w-28 text-right bg-yellow-50 border border-yellow-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-300" placeholder="0" />
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
            <button
              onClick={() => setRefreshTrigger(prev => prev + 1)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium transition-colors"
              title="Sinkron ulang data stock"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Sync</span>
            </button>
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
                          <input type="text" inputMode="numeric" value={buf.stockAwal ? Number(buf.stockAwal).toLocaleString("en-US") : ""} onChange={e => handleInputChange(docId, e.target.value)} onFocus={() => handleInputFocus(docId)} onBlur={() => handleInputBlur(docId)} className="w-28 text-right bg-yellow-50 border border-yellow-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-300" placeholder="0" />
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
