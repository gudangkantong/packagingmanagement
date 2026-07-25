/**
 * Firestore → Supabase Compatibility Layer
 * Drop-in replacement untuk Firestore operations di App.tsx
 * 
 * Cara pakai:
 * 1. Ganti import: import { db } from "./firebase" → import { db } from "./db-compat"
 * 2. Semua setDoc/deleteDoc/onSnapshot tetap sama, tapi di-redirect ke Supabase
 */
import { supabase } from "./supabase";
import * as data from "./dataLayer";

// Stub: db object (tidak dipake lagi, tapi biar import tidak error)
export const db = {};

// ============================================
// COMPATIBLE FUNCTIONS — same API as Firestore
// ============================================

/**
 * Compatible setDoc — auto-detect table dari path
 */
export async function setDocCompat(
  collectionName: string,
  docId: string,
  dataObj: any,
  options?: { merge?: boolean }
): Promise<void> {
  switch (collectionName) {
    case "laporan_kantong":
      await data.upsertLaporan(dataObj);
      break;
    case "penerimaan_data":
      await data.upsertPenerimaan(dataObj);
      break;
    case "pengiriman_data":
      await data.upsertPengiriman(dataObj);
      break;
    case "allowed_users":
      await data.upsertAllowedUser(dataObj);
      break;
    case "locked_dates":
      await data.upsertLockedDate(docId, dataObj.locked, dataObj.lockedBy);
      break;
    case "app_meta":
      await data.bumpLastUpdate(dataObj.updatedBy || "");
      break;
    case "stock_awal_overrides":
      await data.upsertStockOverrides(docId, dataObj.overrides || {});
      break;
    case "vendors":
    case "jenis_kantong":
    case "pabrik_list":
      await data.upsertReferenceData(collectionName, docId, dataObj.name || "");
      break;
    default:
      console.warn(`[setDocCompat] Unknown collection: ${collectionName}`);
  }
}

/**
 * Compatible deleteDoc — auto-detect table
 */
export async function deleteDocCompat(
  collectionName: string,
  docId: string
): Promise<void> {
  switch (collectionName) {
    case "laporan_kantong": await data.deleteLaporan(docId); break;
    case "penerimaan_data": await data.deletePenerimaan(docId); break;
    case "pengiriman_data": await data.deletePengiriman(docId); break;
    case "allowed_users": await data.deleteAllowedUser(docId); break;
    case "vendors": case "jenis_kantong": case "pabrik_list":
      await data.deleteReferenceData(collectionName, docId); break;
    default:
      console.warn(`[deleteDocCompat] Unknown collection: ${collectionName}`);
  }
}

/**
 * Compatible subscribeTable — replaces onSnapshot
 */
export function subscribeTableCompat(
  collectionName: string,
  callback: (items: any[]) => void
): () => void {
  // Initial fetch
  const fetchAndNotify = async () => {
    let items: any[] = [];
    switch (collectionName) {
      case "laporan_kantong": items = await data.fetchLaporan({}); break;
      case "penerimaan_data": items = await data.fetchPenerimaan(); break;
      case "pengiriman_data": items = await data.fetchPengiriman(); break;
      case "allowed_users": items = await data.fetchAllowedUsers(); break;
      case "stock_awal_overrides":
        const overrides = await data.fetchStockOverrides();
        items = Object.entries(overrides).map(([k, v]) => ({ pabrik: k, overrides: { [k]: v } }));
        break;
    }
    callback(items);
  };

  fetchAndNotify();

  // Realtime subscription
  return data.subscribeTable(collectionName, () => {
    fetchAndNotify(); // re-fetch on any change
  });
}

/**
 * Fetch locked dates (returns Record format)
 */
export async function fetchLockedDatesCompat(): Promise<Record<string, any>> {
  return data.fetchLockedDates();
}

/**
 * Fetch last update timestamp
 */
export async function fetchLastUpdateCompat(): Promise<string | null> {
  return data.fetchLastUpdate();
}

/**
 * Fetch reference data
 */
export async function fetchReferenceDataCompat(table: string): Promise<any[]> {
  return data.fetchReferenceData(table);
}
