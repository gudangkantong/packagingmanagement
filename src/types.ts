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
  addedAt: string;
}

export interface LockedDate {
  locked: boolean;
  lockedBy?: string;
  lockedAt?: string;
}
