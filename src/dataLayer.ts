/**
 * Supabase Data Layer — semua operasi database di satu tempat
 * Menggantikan Firestore operations di App.tsx
 */
import { supabase } from "./supabase";
import { LaporanKantong, AllowedUser, LockedDate, PenerimaanData, PengirimanData } from "./types";

// ============================================
// LAPORAN KANTONG
// ============================================
export async function fetchLaporan(opts: {
  tanggal?: string;
  startDate?: string;
  endDate?: string;
}): Promise<LaporanKantong[]> {
  let query = supabase.from("laporan_kantong").select("*");
  if (opts.tanggal) query = query.eq("tanggal", opts.tanggal);
  if (opts.startDate) query = query.gte("tanggal", opts.startDate);
  if (opts.endDate) query = query.lte("tanggal", opts.endDate);
  query = query.order("tanggal", { ascending: false });
  const { data, error } = await query;
  if (error) { console.error("[Supabase] fetchLaporan:", error); return []; }
  return (data || []).map(mapLaporanFromDb);
}

export async function upsertLaporan(item: LaporanKantong): Promise<void> {
  const { error } = await supabase.from("laporan_kantong").upsert(mapLaporanToDb(item));
  if (error) throw error;
}

export async function deleteLaporan(id: string): Promise<void> {
  const { error } = await supabase.from("laporan_kantong").delete().eq("id", id);
  if (error) throw error;
}

function mapLaporanFromDb(row: any): LaporanKantong {
  return {
    id: row.id, vendor: row.vendor, nama: row.nama, pabrik: row.pabrik,
    shift: row.shift, tanggal: row.tanggal, utuh: row.utuh, pecah: row.pecah,
    sortir: row.sortir, total: row.total, createdBy: row.created_by, updatedAt: row.updated_at,
  };
}

function mapLaporanToDb(item: LaporanKantong): Record<string, any> {
  return {
    id: item.id, vendor: item.vendor, nama: item.nama, pabrik: item.pabrik,
    shift: item.shift, tanggal: item.tanggal, utuh: item.utuh, pecah: item.pecah,
    sortir: item.sortir, total: item.total, created_by: item.createdBy, updated_at: item.updatedAt,
  };
}

// ============================================
// PENERIMAAN DATA
// ============================================
export async function fetchPenerimaan(): Promise<PenerimaanData[]> {
  const { data, error } = await supabase.from("penerimaan_data").select("*").order("tanggal", { ascending: false });
  if (error) { console.error("[Supabase] fetchPenerimaan:", error); return []; }
  return (data || []).map(mapPenerimaanFromDb);
}

export async function upsertPenerimaan(item: PenerimaanData): Promise<void> {
  const { error } = await supabase.from("penerimaan_data").upsert(mapPenerimaanToDb(item));
  if (error) throw error;
}

export async function deletePenerimaan(id: string): Promise<void> {
  const { error } = await supabase.from("penerimaan_data").delete().eq("id", id);
  if (error) throw error;
}

function mapPenerimaanFromDb(row: any): PenerimaanData {
  return {
    id: row.id, nama: row.nama, pabrik: row.pabrik, tanggal: row.tanggal,
    jumlah: row.jumlah, sumber: row.sumber, keterangan: row.keterangan,
    createdBy: row.created_by, createdAt: row.created_at,
  };
}

function mapPenerimaanToDb(item: PenerimaanData): Record<string, any> {
  return {
    id: item.id, nama: item.nama, pabrik: item.pabrik, tanggal: item.tanggal,
    jumlah: item.jumlah, sumber: item.sumber, keterangan: item.keterangan,
    created_by: item.createdBy, created_at: item.createdAt,
  };
}

// ============================================
// PENGIRIMAN DATA
// ============================================
export async function fetchPengiriman(): Promise<PengirimanData[]> {
  const { data, error } = await supabase.from("pengiriman_data").select("*").order("tanggal", { ascending: false });
  if (error) { console.error("[Supabase] fetchPengiriman:", error); return []; }
  return (data || []).map(mapPengirimanFromDb);
}

export async function upsertPengiriman(item: PengirimanData): Promise<void> {
  const { error } = await supabase.from("pengiriman_data").upsert(mapPengirimanToDb(item));
  if (error) throw error;
}

export async function deletePengiriman(id: string): Promise<void> {
  const { error } = await supabase.from("pengiriman_data").delete().eq("id", id);
  if (error) throw error;
}

function mapPengirimanFromDb(row: any): PengirimanData {
  return {
    id: row.id, nama: row.nama, pabrik: row.pabrik, tanggal: row.tanggal,
    jumlah: row.jumlah, tujuan: row.tujuan, keterangan: row.keterangan,
    createdBy: row.created_by, createdAt: row.created_at,
  };
}

function mapPengirimanToDb(item: PengirimanData): Record<string, any> {
  return {
    id: item.id, nama: item.nama, pabrik: item.pabrik, tanggal: item.tanggal,
    jumlah: item.jumlah, tujuan: item.tujuan, keterangan: item.keterangan,
    created_by: item.createdBy, created_at: item.createdAt,
  };
}

// ============================================
// ALLOWED USERS
// ============================================
export async function fetchAllowedUsers(): Promise<AllowedUser[]> {
  const { data, error } = await supabase.from("allowed_users").select("*");
  if (error) { console.error("[Supabase] fetchAllowedUsers:", error); return []; }
  return (data || []).map(mapUserFromDb);
}

export async function upsertAllowedUser(user: AllowedUser): Promise<void> {
  const { error } = await supabase.from("allowed_users").upsert(mapUserToDb(user));
  if (error) throw error;
}

export async function deleteAllowedUser(email: string): Promise<void> {
  const { error } = await supabase.from("allowed_users").delete().eq("email", email);
  if (error) throw error;
}

function mapUserFromDb(row: any): AllowedUser {
  return {
    email: row.email, allowed: row.allowed, role: row.role,
    pabrikRole: row.pabrik_role || null, addedAt: row.added_at,
  };
}

function mapUserToDb(user: AllowedUser): Record<string, any> {
  return {
    email: user.email, allowed: user.allowed, role: user.role,
    pabrik_role: user.pabrikRole || null, added_at: user.addedAt,
  };
}

// ============================================
// LOCKED DATES
// ============================================
export async function fetchLockedDates(): Promise<Record<string, LockedDate>> {
  const { data, error } = await supabase.from("locked_dates").select("*");
  if (error) { console.error("[Supabase] fetchLockedDates:", error); return {}; }
  const result: Record<string, LockedDate> = {};
  (data || []).forEach((row: any) => {
    result[row.date] = { locked: row.locked, lockedBy: row.locked_by, lockedAt: row.locked_at };
  });
  return result;
}

export async function upsertLockedDate(date: string, locked: boolean, lockedBy?: string): Promise<void> {
  const { error } = await supabase.from("locked_dates").upsert({
    date, locked, locked_by: lockedBy || null, locked_at: new Date().toISOString(),
  });
  if (error) throw error;
}

// ============================================
// APP META
// ============================================
export async function fetchLastUpdate(): Promise<string | null> {
  const { data, error } = await supabase.from("app_meta").select("value").eq("key", "last_update").single();
  if (error || !data) return null;
  return data.value?.timestamp || null;
}

export async function bumpLastUpdate(email: string): Promise<void> {
  const { error } = await supabase.from("app_meta").upsert({
    key: "last_update",
    value: { timestamp: new Date().toISOString(), updatedBy: email },
  });
  if (error) throw error;
}

// ============================================
// STOCK AWAL OVERRIDES
// ============================================
export async function fetchStockOverrides(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from("stock_awal_overrides").select("*");
  if (error) { console.error("[Supabase] fetchStockOverrides:", error); return {}; }
  const result: Record<string, number> = {};
  (data || []).forEach((row: any) => {
    if (row.overrides) Object.assign(result, row.overrides);
  });
  return result;
}

export async function upsertStockOverrides(pabrik: string, overrides: Record<string, number>): Promise<void> {
  const { error } = await supabase.from("stock_awal_overrides").upsert({
    pabrik, overrides, updated_at: new Date().toISOString(),
  }, { onConflict: "pabrik" });
  if (error) throw error;
}

// ============================================
// REFERENCE DATA (vendors, jenis_kantong, pabrik_list)
// ============================================
export async function fetchReferenceData(table: string): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase.from(table).select("*");
  if (error) { console.error(`[Supabase] fetch ${table}:`, error); return []; }
  return data || [];
}

export async function upsertReferenceData(table: string, id: string, name: string): Promise<void> {
  const { error } = await supabase.from(table).upsert({ id, name });
  if (error) throw error;
}

export async function deleteReferenceData(table: string, id: string): Promise<void> {
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw error;
}

// ============================================
// REALTIME SUBSCRIPTIONS
// ============================================
export function subscribeTable(
  table: string,
  callback: (payload: any) => void
) {
  const channel = supabase
    .channel(`${table}_changes`)
    .on("postgres_changes", { event: "*", schema: "public", table }, callback)
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}
