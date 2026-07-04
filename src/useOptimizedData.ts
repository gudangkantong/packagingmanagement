/**
 * useOptimizedData.ts
 * 
 * Strategi Firebase Free Tier (40-50 users/hari):
 * 
 * ✅ REAL-TIME (onSnapshot) — data yang sering berubah & semua user HARUS lihat:
 *    - laporan_kantong  → filter 7 hari terakhir
 *    - penerimaan_data  → full (data tidak terlalu banyak)
 *    - pengiriman_data  → full (data tidak terlalu banyak)
 *    - locked_dates     → full (data kecil)
 *    - allowed_users/{email} → per-user status check
 * 
 * 📦 ONE-TIME READ + CACHE — data master yang jarang berubah:
 *    - vendors          → cache 24 jam
 *    - jenis_kantong    → cache 24 jam
 *    - pabrik_list      → cache 24 jam
 *    - allowed_users    → cache 1 jam, cuma admin yang perlu
 */

import { useEffect, useState, useCallback } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  setDoc,
} from "firebase/firestore";
import { db, auth } from "./firebase";
import { getCached, setCache, removeCache } from "./utils/cache";
import type {
  LaporanKantong,
  AllowedUser,
  LockedDate,
  PenerimaanData,
  PengirimanData,
} from "./types";
import { getDateString } from "./utils";

// ============================================================
// 1. MASTER DATA → getDocs + Cache (hemat reads)
//    vendors, jenis_kantong, pabrik_list
//    Jarang berubah, cukup sekali baca lalu cache 24 jam
// ============================================================

export function useMasterData(isAllowed: boolean) {
  const [vendors, setVendors] = useState<string[]>([]);
  const [jenisKantong, setJenisKantong] = useState<string[]>([]);
  const [pabrikList, setPabrikList] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAllowed) {
      setLoading(false);
      return;
    }

    const load = async () => {
      const cachedV = getCached<string[]>("vendors");
      const cachedJ = getCached<string[]>("jenis_kantong");
      const cachedP = getCached<string[]>("pabrik_list");

      if (cachedV && cachedJ && cachedP) {
        setVendors(cachedV);
        setJenisKantong(cachedJ);
        setPabrikList(cachedP);
        setLoading(false);
        return;
      }

      try {
        const [vSnap, jSnap, pSnap] = await Promise.all([
          getDocs(collection(db, "vendors")),
          getDocs(collection(db, "jenis_kantong")),
          getDocs(collection(db, "pabrik_list")),
        ]);

        const vData = vSnap.docs.map((d) => d.data().name || d.id);
        const jData = jSnap.docs.map((d) => d.data().name || d.id);
        const pData = pSnap.docs.map((d) => d.data().name || d.id);

        setVendors(vData);
        setJenisKantong(jData);
        setPabrikList(pData);

        setCache("vendors", vData, 24 * 60 * 60 * 1000);
        setCache("jenis_kantong", jData, 24 * 60 * 60 * 1000);
        setCache("pabrik_list", pData, 24 * 60 * 60 * 1000);
      } catch (err) {
        console.error("Failed to load master data:", err);
      }
      setLoading(false);
    };

    load();
  }, [isAllowed]);

  const refreshMasterData = useCallback(async () => {
    removeCache("vendors");
    removeCache("jenis_kantong");
    removeCache("pabrik_list");

    try {
      const [vSnap, jSnap, pSnap] = await Promise.all([
        getDocs(collection(db, "vendors")),
        getDocs(collection(db, "jenis_kantong")),
        getDocs(collection(db, "pabrik_list")),
      ]);

      const vData = vSnap.docs.map((d) => d.data().name || d.id);
      const jData = jSnap.docs.map((d) => d.data().name || d.id);
      const pData = pSnap.docs.map((d) => d.data().name || d.id);

      setVendors(vData);
      setJenisKantong(jData);
      setPabrikList(pData);

      setCache("vendors", vData, 24 * 60 * 60 * 1000);
      setCache("jenis_kantong", jData, 24 * 60 * 60 * 1000);
      setCache("pabrik_list", pData, 24 * 60 * 60 * 1000);
    } catch (err) {
      console.error("Failed to refresh master data:", err);
    }
  }, []);

  return { vendors, jenisKantong, pabrikList, loading, refreshMasterData };
}

// ============================================================
// 2. LAPORAN KANTONG → REAL-TIME dengan filter tanggal
//    Ini data utama, semua user (admin + tamu) harus lihat
//    update langsung saat admin input/edit/hapus
// ============================================================

export function useLaporanKantong(
  currentUser: any,
  isAllowed: boolean
) {
  const [reports, setReports] = useState<LaporanKantong[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser || isAllowed !== true) {
      setReports([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    // Filter 7 hari terakhir — hemat reads tapi tetap cover data hari ini + riwayat
    // NOTE: Pakai single orderBy untuk hindari composite index requirement
    const sevenDaysAgo = getDateString(new Date(Date.now() - 7 * 86400000));
    const today = getDateString(new Date());

    const reportsQuery = query(
      collection(db, "laporan_kantong"),
      where("tanggal", ">=", sevenDaysAgo),
      where("tanggal", "<=", today),
      orderBy("tanggal", "desc"),
      limit(500)
    );

    const unsub = onSnapshot(
      reportsQuery,
      (snap) => {
        const items: LaporanKantong[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            vendor: data.vendor || "",
            nama: data.nama || "",
            pabrik: data.pabrik || "",
            shift: Number(data.shift) || 1,
            tanggal: data.tanggal || "",
            utuh: Number(data.utuh) || 0,
            pecah: Number(data.pecah) || 0,
            sortir: Number(data.sortir) || 0,
            total: Number(data.total) || 0,
            createdBy: data.createdBy || "",
            updatedAt: data.updatedAt || "",
          };
        });
        setReports(items);
        setLoading(false);
      },
      (err) => {
        console.error("Failed to sync reports:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [currentUser, isAllowed]);

  return { reports, loading };
}

// ============================================================
// 3. PENERIMAAN DATA → REAL-TIME
//    Admin input data penerimaan, semua user langsung lihat
// ============================================================

export function usePenerimaanData(
  currentUser: any,
  isAllowed: boolean
) {
  const [penerimaanList, setPenerimaanList] = useState<PenerimaanData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser || isAllowed !== true) {
      setPenerimaanList([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const unsub = onSnapshot(
      collection(db, "penerimaan_data"),
      (snap) => {
        const items: PenerimaanData[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            nama: data.nama || "",
            pabrik: data.pabrik || "",
            tanggal: data.tanggal || "",
            jumlah: Number(data.jumlah) || 0,
            sumber: data.sumber || "",
            keterangan: data.keterangan || "",
            createdBy: data.createdBy || "",
            createdAt: data.createdAt || "",
          };
        });
        setPenerimaanList(items);
        setLoading(false);
      },
      (err) => {
        console.error("Failed to sync penerimaan:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [currentUser, isAllowed]);

  return { penerimaanList, loading };
}

// ============================================================
// 4. PENGIRIMAN DATA → REAL-TIME
//    Admin input data pengiriman, semua user langsung lihat
// ============================================================

export function usePengirimanData(
  currentUser: any,
  isAllowed: boolean
) {
  const [pengirimanList, setPengirimanList] = useState<PengirimanData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser || isAllowed !== true) {
      setPengirimanList([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const unsub = onSnapshot(
      collection(db, "pengiriman_data"),
      (snap) => {
        const items: PengirimanData[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            nama: data.nama || "",
            pabrik: data.pabrik || "",
            tanggal: data.tanggal || "",
            jumlah: Number(data.jumlah) || 0,
            tujuan: data.tujuan || "",
            keterangan: data.keterangan || "",
            createdBy: data.createdBy || "",
            createdAt: data.createdAt || "",
          };
        });
        setPengirimanList(items);
        setLoading(false);
      },
      (err) => {
        console.error("Failed to sync pengiriman:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [currentUser, isAllowed]);

  return { pengirimanList, loading };
}

// ============================================================
// 5. ALLOWED USERS → getDocs + Cache (cuma admin yang perlu)
//    Guest/tamu TIDAK perlu tahu daftar user
// ============================================================

export function useAllowedUsers(
  currentUser: any,
  isAllowed: boolean,
  isAdmin: boolean
) {
  const [allowedUsers, setAllowedUsers] = useState<AllowedUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser || isAllowed !== true) {
      setAllowedUsers([]);
      setLoading(false);
      return;
    }

    // Guest tidak perlu data allowed_users
    if (!isAdmin) {
      setAllowedUsers([]);
      setLoading(false);
      return;
    }

    // Cek cache dulu
    const cached = getCached<AllowedUser[]>("allowed_users");
    if (cached) {
      setAllowedUsers(cached);
      setLoading(false);
      return;
    }

    // Load dari Firestore
    const loadUsers = async () => {
      try {
        const snap = await getDocs(collection(db, "allowed_users"));
        const items: AllowedUser[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            email: data.email || d.id,
            allowed: data.allowed === true,
            role: data.role || "admin",
            pabrikRole: data.pabrikRole || null,
            addedAt: data.addedAt || "",
          };
        });
        setAllowedUsers(items);
        setCache("allowed_users", items, 60 * 60 * 1000); // cache 1 jam
      } catch (err) {
        console.error("Failed to load allowed users:", err);
      }
      setLoading(false);
    };

    loadUsers();
  }, [currentUser, isAllowed, isAdmin]);

  const refreshAllowedUsers = useCallback(async () => {
    removeCache("allowed_users");
    try {
      const snap = await getDocs(collection(db, "allowed_users"));
      const items: AllowedUser[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          email: data.email || d.id,
          allowed: data.allowed === true,
          role: data.role || "admin",
          pabrikRole: data.pabrikRole || null,
          addedAt: data.addedAt || "",
        };
      });
      setAllowedUsers(items);
      setCache("allowed_users", items, 60 * 60 * 1000);
    } catch (err) {
      console.error("Failed to refresh allowed users:", err);
    }
  }, []);

  return { allowedUsers, loading, refreshAllowedUsers };
}

// ============================================================
// 6. LOCKED DATES → REAL-TIME (data kecil, penting untuk validasi)
// ============================================================

export function useLockedDates(currentUser: any, isAllowed: boolean) {
  const [lockedDates, setLockedDates] = useState<Record<string, LockedDate>>(
    {}
  );

  useEffect(() => {
    if (!currentUser || isAllowed !== true) {
      setLockedDates({});
      return;
    }

    const unsub = onSnapshot(
      collection(db, "locked_dates"),
      (snap) => {
        const datesMap: Record<string, LockedDate> = {};
        snap.docs.forEach((d) => {
          const data = d.data();
          if (data.locked) {
            datesMap[d.id] = {
              locked: true,
              lockedBy: data.lockedBy || "",
              lockedAt: data.lockedAt || "",
            };
          }
        });
        setLockedDates(datesMap);
      },
      (err) => {
        console.error("Failed to sync locked dates:", err);
      }
    );

    return () => unsub();
  }, [currentUser, isAllowed]);

  return { lockedDates };
}

// ============================================================
// 7. ADMIN BOOTSTRAP → tetap seperti aslinya
// ============================================================

export async function bootstrapAdmin(): Promise<boolean> {
  const user = auth.currentUser;
  if (!user || !user.email) return false;

  const userEmail = user.email.toLowerCase();
  if (userEmail !== "managementpackaging@gmail.com") return true;

  try {
    const userDocRef = doc(db, "allowed_users", userEmail);
    const docSnap = await getDoc(userDocRef);

    if (
      !docSnap.exists() ||
      !docSnap.data()?.allowed ||
      docSnap.data()?.role !== "super_admin"
    ) {
      await setDoc(
        userDocRef,
        {
          email: userEmail,
          allowed: true,
          role: "super_admin",
          addedAt: docSnap.exists()
            ? docSnap.data()?.addedAt || new Date().toISOString()
            : new Date().toISOString(),
        },
        { merge: true }
      );
    }
    return true;
  } catch (err) {
    console.error("Admin bootstrap failed:", err);
    return false;
  }
}
