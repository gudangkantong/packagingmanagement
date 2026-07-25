/**
 * Full Firestore Compatibility Layer — Supabase backend
 * Meniru API Firestore (onSnapshot, getDoc, getDocs, setDoc, deleteDoc)
 * tapi di-redirect ke Supabase PostgreSQL + Realtime
 */
import { supabase } from "./supabase";

// ============================================
// Types (mimic Firestore types)
// ============================================
interface FakeSnapshot {
  exists: boolean;
  data: () => any;
  id: string;
  forEach: (cb: (doc: FakeDocSnapshot) => void) => void;
  size: number;
  empty: boolean;
  docs: FakeDocSnapshot[];
}

interface FakeDocSnapshot {
  id: string;
  data: () => any;
  exists: boolean;
}

// Map collection name → Supabase table name
function toTable(collection: string): string {
  return collection; // same name
}

// Convert Firestore camelCase data → Supabase snake_case
function toSnake(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === "id") { result.id = value; continue; }
    const snake = key.replace(/([A-Z])/g, "_$1").toLowerCase();
    result[snake] = value;
  }
  return result;
}

// Convert Supabase snake_case → Firestore camelCase
function toCamel(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === "id") { result.id = value; continue; }
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    result[camel] = value;
  }
  return result;
}

// ============================================
// Wrapper objects (mimic Firestore API)
// ============================================

/** Mimic doc(db, collection, id) */
export function doc(_db: any, collection: string, id: string) {
  return { _table: toTable(collection), _id: id };
}

/** Mimic collection(db, name) */
export function collection(_db: any, name: string) {
  return { _table: toTable(name), _filters: [] as any[], _orderBy: null as any, _limit: null as number | null };
}

/** Mimic query(collectionRef, ...constraints) */
export function query(colRef: any, ...constraints: any[]) {
  const q = { ...colRef };
  for (const c of constraints) {
    if (c._type === "where") q._filters.push(c);
    if (c._type === "orderBy") q._orderBy = c;
    if (c._type === "limit") q._limit = c._value;
  }
  return q;
}

/** Mimic where(field, op, value) */
export function where(field: string, op: string, value: any) {
  return { _type: "where", field, op, value };
}

/** Mimic orderBy(field, direction?) */
export function orderBy(field: string, direction: "asc" | "desc" = "asc") {
  return { _type: "orderBy", field, direction };
}

/** Mimic limit(n) */
export function limit(n: number) {
  return { _type: "limit", _value: n };
}

// ============================================
// Read operations
// ============================================

/** Mimic getDoc(ref) → single document */
export async function getDoc(ref: any): Promise<FakeDocSnapshot> {
  const { data, error } = await supabase
    .from(ref._table)
    .select("*")
    .eq("id", ref._id)
    .single();

  if (error || !data) {
    return { id: ref._id, data: () => undefined, exists: false };
  }
  const camel = toCamel(data);
  return {
    id: data.id || ref._id,
    data: () => camel,
    exists: true,
  };
}

/** Mimic getDocs(queryRef) → collection snapshot */
export async function getDocs(qRef: any): Promise<FakeSnapshot> {
  let q = supabase.from(qRef._table).select("*");

  // Apply filters
  for (const f of qRef._filters || []) {
    switch (f.op) {
      case "==": q = q.eq(f.field, f.value); break;
      case "!=": q = q.neq(f.field, f.value); break;
      case ">": q = q.gt(f.field, f.value); break;
      case ">=": q = q.gte(f.field, f.value); break;
      case "<": q = q.lt(f.field, f.value); break;
      case "<=": q = q.lte(f.field, f.value); break;
      case "in": q = q.in(f.field, f.value); break;
    }
  }

  // Apply orderBy
  if (qRef._orderBy) {
    q = q.order(qRef._orderBy.field, { ascending: qRef._orderBy.direction === "asc" });
  }

  // Apply limit
  if (qRef._limit) {
    q = q.limit(qRef._limit);
  }

  const { data, error } = await q;
  if (error) {
    console.error("[Supabase getDocs]", error);
    return { exists: false, data: () => undefined, id: "", forEach: () => {}, size: 0, empty: true, docs: [] };
  }

  const rows = (data || []).map(toCamel);
  const docs: FakeDocSnapshot[] = rows.map((row: any) => ({
    id: row.id,
    data: () => row,
    exists: true,
  }));

  return {
    exists: docs.length > 0,
    data: () => docs[0]?.data(),
    id: docs[0]?.id || "",
    forEach: (cb: any) => docs.forEach(cb),
    size: docs.length,
    empty: docs.length === 0,
    docs,
  };
}

// ============================================
// Write operations
// ============================================

/** Mimic setDoc(ref, data, options?) */
export async function setDoc(ref: any, data: any, options?: { merge?: boolean }): Promise<void> {
  const row = toSnake({ ...data, id: ref._id });
  const { error } = await supabase.from(ref._table).upsert(row, { onConflict: "id" });
  if (error) console.error("[Supabase setDoc]", error);
}

/** Mimic deleteDoc(ref) */
export async function deleteDoc(ref: any): Promise<void> {
  const { error } = await supabase.from(ref._table).delete().eq("id", ref._id);
  if (error) console.error("[Supabase deleteDoc]", error);
}

// ============================================
// onSnapshot — real-time subscription
// ============================================

/**
 * Mimic onSnapshot(ref, onNext, onError)
 * ref can be: doc(db, ...) or query(collection(db, ...), ...)
 */
export function onSnapshot(
  ref: any,
  onNext: (snapshot: FakeSnapshot) => void,
  onError?: (error: Error) => void
): () => void {
  const table = ref._table;
  let active = true;

  // Initial fetch
  const fetchAndNotify = async () => {
    if (!active) return;
    try {
      let snapshot: FakeSnapshot;
      if (ref._id !== undefined) {
        // Single doc
        const docSnap = await getDoc(ref);
        snapshot = {
          exists: docSnap.exists,
          data: docSnap.data,
          id: docSnap.id,
          forEach: (cb) => { if (docSnap.exists) cb(docSnap); },
          size: docSnap.exists ? 1 : 0,
          empty: !docSnap.exists,
          docs: docSnap.exists ? [docSnap] : [],
        };
      } else {
        // Collection/query
        snapshot = await getDocs(ref);
      }
      if (active) onNext(snapshot);
    } catch (err: any) {
      if (active && onError) onError(err);
    }
  };

  fetchAndNotify();

  // Realtime subscription
  const channel = supabase
    .channel(`${table}_rt_${Math.random().toString(36).slice(2, 8)}`)
    .on("postgres_changes", { event: "*", schema: "public", table }, () => {
      fetchAndNotify(); // re-fetch on any change
    })
    .subscribe();

  return () => {
    active = false;
    supabase.removeChannel(channel);
  };
}

// ============================================
// Stub: db object (not actually used)
// ============================================
export const db = {};
