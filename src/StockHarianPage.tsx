import React, { useState, useEffect } from "react";
import {
  collection, doc, setDoc, getDoc, onSnapshot, query, where,
} from "firebase/firestore";
import { Save, Loader2, AlertCircle, Package, RefreshCw } from "lucide-react";
import { db } from "./firebase";
import { StockHarian, LaporanKantong, AllowedUser } from "./types";
import { formatDateDisplay } from "./utils";
import { JENIS_KANTONG } from "./csvUtils";

const OPT_GUDANG = "OPT Gudang";
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
}

export default function StockHarianPage({
  currentUser, isAllowed, reports, allowedUsers, triggerToast, selectedDate,
}: StockHarianPageProps) {
  const currentUserData = allowedUsers.find(u => u.email === currentUser?.email?.toLowerCase());
  const userRole = currentUserData?.role || (currentUser?.isAnonymous ? "guest" : null);
  const isMasterAdmin = userRole === "super_admin";

  const [stockData, setStockData] = useState<Record<string, StockHarian>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState<Record<string, { penerimaan: string; pengiriman: string; stockAwal: string }>>({});

  const ALL_LOCATIONS = [OPT_GUDANG, ...PABRIK_LIST];

  const makeDocId = (pabrik: string, nama: string, tanggal: string) => {
    const pKey = PABRIK_SHORT[pabrik] || pabrik;
    return `${pKey}_${nama.replace(/\s+/g, "_")}_${tanggal}`;
  };

  const getPrevDate = (dateStr: string): string => {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const computePemakaian = (pabrikLabel: string, nama: string, tanggal: string): number =>
    reports.filter(r => r.tanggal === tanggal && r.nama === nama && r.pabrik.includes(pabrikLabel)).reduce((s, r) => s + r.total, 0);

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
    const buf: Record<string, { penerimaan: string; pengiriman: string; stockAwal: string }> = {};
    ALL_LOCATIONS.forEach(p => JENIS_KANTONG.forEach(n => {
      const id = makeDocId(p, n, selectedDate);
      const ex = stockData[id];
      buf[id] = ex ? { penerimaan: String(ex.penerimaan), pengiriman: String(ex.pengiriman), stockAwal: String(ex.stockAwal) } : { penerimaan: "", pengiriman: "", stockAwal: "" };
    }));
    setEditBuffer(buf);
  }, [stockData, selectedDate]);

  const handleInputChange = (docId: string, field: "penerimaan" | "pengiriman" | "stockAwal", value: string) => {
    if (value === "" || /^\d*$/.test(value)) setEditBuffer(p => ({ ...p, [docId]: { ...p[docId], [field]: value } }));
  };

  const handleSaveRow = async (pabrik: string, nama: string, docId: string) => {
    if (!currentUser || !isMasterAdmin) return;
    setSaving(docId);
    try {
      const b = editBuffer[docId] || { penerimaan: "0", pengiriman: "0", stockAwal: "0" };
      const sa = parseInt(b.stockAwal) || 0, pn = parseInt(b.penerimaan) || 0, pg = parseInt(b.pengiriman) || 0;
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
        const b = editBuffer[docId] || { penerimaan: "0", pengiriman: "0", stockAwal: "0" };
        const sa = parseInt(b.stockAwal) || 0, pn = parseInt(b.penerimaan) || 0, pg = parseInt(b.pengiriman) || 0;
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
        const prev = await getDoc(doc(db, "stock_harian", makeDocId(pabrik, nama, prevDate)));
        if (prev.exists()) { updates[makeDocId(pabrik, nama, selectedDate)] = String(Number(prev.data()?.stockAkhir) || 0); cnt++; }
      }
      if (cnt > 0) {
        setEditBuffer(p => { const n = { ...p }; for (const [id, v] of Object.entries(updates)) n[id] = { ...n[id], stockAwal: v }; return n; });
        triggerToast(`Stock awal ${PABRIK_SHORT[pabrik]} dari ${formatDateDisplay(prevDate)} (${cnt} item)`, "ok");
      } else triggerToast(`Tidak ada data sebelumnya untuk ${PABRIK_SHORT[pabrik]}`, "inf");
    } catch (e) { console.error(e); triggerToast("Gagal auto-fill", "er"); }
  };

  const getRowDisplay = (pabrik: string, nama: string, docId: string) => {
    const b = editBuffer[docId] || { penerimaan: "0", pengiriman: "0", stockAwal: "0" };
    const sa = parseInt(b.stockAwal) || 0, pn = parseInt(b.penerimaan) || 0, pg = parseInt(b.pengiriman) || 0;
    const isOPT = pabrik === OPT_GUDANG;
    const pk = isOPT ? 0 : computePemakaian(PABRIK_SHORT[pabrik], nama, selectedDate);
    const sk = isOPT ? sa + pn - pg : sa + pn - pg - pk;
    return { stockAwal: sa, penerimaan: pn, pengiriman: pg, pemakaian: pk, stockAkhir: sk };
  };

  const renderOPTTable = () => (
    <div className="rounded-xl border border-gray-300 overflow-hidden mb-6 shadow-sm">
      <div className="bg-gray-800 text-white px-4 py-3 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2"><Package className="w-5 h-5" /><h3 className="font-bold text-lg">📦 {OPT_GUDANG}</h3></div>
        {isMasterAdmin && <div className="flex items-center gap-2">
          <button onClick={() => handleAutoFillStockAwal(OPT_GUDANG)} className="flex items-center gap-1 bg-white/20 hover:bg-white/30 text-white text-xs px-3 py-1.5 rounded-lg transition-colors"><RefreshCw className="w-3.5 h-3.5" /> Auto Stock Awal</button>
          <button onClick={() => handleSaveAll(OPT_GUDANG)} disabled={saving === OPT_GUDANG} className="flex items-center gap-1 bg-white/20 hover:bg-white/30 text-white text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">{saving === OPT_GUDANG ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Simpan Semua</button>
        </div>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-100 text-gray-700">
            <th className="px-4 py-2.5 text-left font-semibold border-b border-gray-200 min-w-[180px]">Jenis Kantong</th>
            <th className="px-3 py-2.5 text-right font-semibold border-b border-gray-200 min-w-[100px]">Stock Awal</th>
            <th className="px-3 py-2.5 text-right font-semibold border-b border-gray-200 min-w-[100px]">Penerimaan</th>
            <th className="px-3 py-2.5 text-right font-semibold border-b border-gray-200 min-w-[100px]">Pengiriman</th>
            <th className="px-3 py-2.5 text-right font-semibold border-b border-gray-200 min-w-[100px]">Stock Akhir</th>
            {isMasterAdmin && <th className="px-3 py-2.5 text-center font-semibold border-b border-gray-200 w-[80px]">Aksi</th>}
          </tr></thead>
          <tbody>{JENIS_KANTONG.map((nama, idx) => {
            const docId = makeDocId(OPT_GUDANG, nama, selectedDate);
            const d = getRowDisplay(OPT_GUDANG, nama, docId);
            const buf = editBuffer[docId] || { penerimaan: "", pengiriman: "", stockAwal: "" };
            return (
              <tr key={nama} className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${idx % 2 === 0 ? "bg-white" : "bg-gray-50/50"}`}>
                <td className="px-4 py-2 font-medium text-gray-800">{nama}</td>
                <td className="px-3 py-2 text-right">{isMasterAdmin ? <input type="text" inputMode="numeric" value={buf.stockAwal} onChange={e => handleInputChange(docId, "stockAwal", e.target.value)} className="w-20 text-right bg-yellow-50 border border-yellow-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-300" placeholder="0" /> : <span className="text-gray-700">{d.stockAwal}</span>}</td>
                <td className="px-3 py-2 text-right">{isMasterAdmin ? <input type="text" inputMode="numeric" value={buf.penerimaan} onChange={e => handleInputChange(docId, "penerimaan", e.target.value)} className="w-20 text-right bg-green-50 border border-green-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-300" placeholder="0" /> : <span className="text-gray-700">{d.penerimaan}</span>}</td>
                <td className="px-3 py-2 text-right">{isMasterAdmin ? <input type="text" inputMode="numeric" value={buf.pengiriman} onChange={e => handleInputChange(docId, "pengiriman", e.target.value)} className="w-20 text-right bg-blue-50 border border-blue-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" placeholder="0" /> : <span className="text-gray-700">{d.pengiriman}</span>}</td>
                <td className="px-3 py-2 text-right"><span className={`font-bold ${d.stockAkhir < 0 ? "text-red-600" : d.stockAkhir === 0 ? "text-gray-400" : "text-emerald-700"}`}>{d.stockAkhir}</span></td>
                {isMasterAdmin && <td className="px-3 py-2 text-center"><button onClick={() => handleSaveRow(OPT_GUDANG, nama, docId)} disabled={saving === docId} className="text-indigo-600 hover:text-indigo-800 disabled:text-gray-300 transition-colors">{saving === docId ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : <Save className="w-4 h-4 mx-auto" />}</button></td>}
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </div>
  );

  const renderPabrikTable = (pabrik: string) => {
    const pc: Record<string, { h: string; b: string; a: string }> = {
      "Pabrik Baturaja 1 (PBR 1)": { h: "bg-indigo-600", b: "bg-indigo-50", a: "border-indigo-200" },
      "Pabrik Baturaja 2 (PBR 2)": { h: "bg-teal-600", b: "bg-teal-50", a: "border-teal-200" },
      "Pabrik Palembang (PPG)": { h: "bg-amber-600", b: "bg-amber-50", a: "border-amber-200" },
      "Pabrik Panjang (PPJ)": { h: "bg-rose-600", b: "bg-rose-50", a: "border-rose-200" },
    };
    const c = pc[pabrik] || { h: "bg-gray-600", b: "bg-gray-50", a: "border-gray-200" };
    return (
      <div key={pabrik} className={`rounded-xl border ${c.a} overflow-hidden mb-6 shadow-sm`}>
        <div className={`${c.h} text-white px-4 py-3 flex items-center justify-between flex-wrap gap-2`}>
          <div className="flex items-center gap-2"><Package className="w-5 h-5" /><h3 className="font-bold text-lg">🏭 {pabrik}</h3></div>
          {isMasterAdmin && <div className="flex items-center gap-2">
            <button onClick={() => handleAutoFillStockAwal(pabrik)} className="flex items-center gap-1 bg-white/20 hover:bg-white/30 text-white text-xs px-3 py-1.5 rounded-lg transition-colors"><RefreshCw className="w-3.5 h-3.5" /> Auto Stock Awal</button>
            <button onClick={() => handleSaveAll(pabrik)} disabled={saving === pabrik} className="flex items-center gap-1 bg-white/20 hover:bg-white/30 text-white text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">{saving === pabrik ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Simpan Semua</button>
          </div>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className={`${c.b} text-gray-700`}>
              <th className="px-4 py-2.5 text-left font-semibold border-b border-gray-200 min-w-[180px]">Jenis Kantong</th>
              <th className="px-3 py-2.5 text-right font-semibold border-b border-gray-200 min-w-[100px]">Stock Awal</th>
              <th className="px-3 py-2.5 text-right font-semibold border-b border-gray-200 min-w-[100px]">Penerimaan</th>
              <th className="px-3 py-2.5 text-right font-semibold border-b border-gray-200 min-w-[100px]">Pengiriman</th>
              <th className="px-3 py-2.5 text-right font-semibold border-b border-gray-200 min-w-[100px]">Pemakaian</th>
              <th className="px-3 py-2.5 text-right font-semibold border-b border-gray-200 min-w-[100px]">Stock Akhir</th>
              {isMasterAdmin && <th className="px-3 py-2.5 text-center font-semibold border-b border-gray-200 w-[80px]">Aksi</th>}
            </tr></thead>
            <tbody>{JENIS_KANTONG.map((nama, idx) => {
              const docId = makeDocId(pabrik, nama, selectedDate);
              const d = getRowDisplay(pabrik, nama, docId);
              const buf = editBuffer[docId] || { penerimaan: "", pengiriman: "", stockAwal: "" };
              return (
                <tr key={nama} className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${idx % 2 === 0 ? "bg-white" : "bg-gray-50/50"}`}>
                  <td className="px-4 py-2 font-medium text-gray-800">{nama}</td>
                  <td className="px-3 py-2 text-right">{isMasterAdmin ? <input type="text" inputMode="numeric" value={buf.stockAwal} onChange={e => handleInputChange(docId, "stockAwal", e.target.value)} className="w-20 text-right bg-yellow-50 border border-yellow-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-300" placeholder="0" /> : <span className="text-gray-700">{d.stockAwal}</span>}</td>
                  <td className="px-3 py-2 text-right">{isMasterAdmin ? <input type="text" inputMode="numeric" value={buf.penerimaan} onChange={e => handleInputChange(docId, "penerimaan", e.target.value)} className="w-20 text-right bg-green-50 border border-green-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-300" placeholder="0" /> : <span className="text-gray-700">{d.penerimaan}</span>}</td>
                  <td className="px-3 py-2 text-right">{isMasterAdmin ? <input type="text" inputMode="numeric" value={buf.pengiriman} onChange={e => handleInputChange(docId, "pengiriman", e.target.value)} className="w-20 text-right bg-blue-50 border border-blue-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" placeholder="0" /> : <span className="text-gray-700">{d.pengiriman}</span>}</td>
                  <td className="px-3 py-2 text-right"><span className={`font-medium ${d.pemakaian > 0 ? "text-red-600" : "text-gray-400"}`}>{d.pemakaian}</span></td>
                  <td className="px-3 py-2 text-right"><span className={`font-bold ${d.stockAkhir < 0 ? "text-red-600" : d.stockAkhir === 0 ? "text-gray-400" : "text-emerald-700"}`}>{d.stockAkhir}</span></td>
                  {isMasterAdmin && <td className="px-3 py-2 text-center"><button onClick={() => handleSaveRow(pabrik, nama, docId)} disabled={saving === docId} className="text-indigo-600 hover:text-indigo-800 disabled:text-gray-300 transition-colors">{saving === docId ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : <Save className="w-4 h-4 mx-auto" />}</button></td>}
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </div>
    );
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /><span className="ml-3 text-gray-600">Memuat data stock harian...</span></div>;

  return (
    <div className="space-y-6">
      {!isMasterAdmin && <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5"><AlertCircle className="w-3.5 h-3.5" /> Mode baca saja — Hanya Admin Utama yang bisa mengedit</div>}
      {renderOPTTable()}
      {PABRIK_LIST.map(p => renderPabrikTable(p))}
    </div>
  );
}
