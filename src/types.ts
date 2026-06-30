export interface LaporanKantong {
  id: string;
  vendor: string;
  nama: string;
  pabrik: string;
  shift: number;
  tanggal: string; // YYYY-MM-DD
  utuh: number;
  pecah: number;
  sortir: number;
  total: number;
  createdBy: string;
  updatedAt: string;
}

export interface AllowedUser {
  email: string;
  allowed: boolean;
  role: 'super_admin' | 'admin' | 'guest';  // ← tambah field role
  addedAt: string;
}

export interface LockedDate {
  locked: boolean;
  lockedBy?: string;
  lockedAt?: string;
}

// Role display mapping (kode DB → label Indonesia)
export const ROLE_MAP: Record<string, string> = {
  super_admin: 'Admin Utama',
  admin: 'Admin',
  guest: 'Tamu',
};
