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
  role: 'super_admin' | 'admin' | 'guest';
  pabrikRole?: 'pbr1' | 'pbr2' | 'ppg' | 'ppj' | 'all' | null;
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

export const PABRIK_ROLE_MAP: Record<string, { label: string; color: string; bgColor: string; borderColor: string }> = {
  pbr1: { label: 'Admin PBR 1', color: 'text-indigo-700', bgColor: 'bg-indigo-50', borderColor: 'border-indigo-200' },
  pbr2: { label: 'Admin PBR 2', color: 'text-teal-700', bgColor: 'bg-teal-50', borderColor: 'border-teal-200' },
  ppg: { label: 'Admin PPG', color: 'text-amber-700', bgColor: 'bg-amber-50', borderColor: 'border-amber-200' },
  ppj: { label: 'Admin PPJ', color: 'text-rose-700', bgColor: 'bg-rose-50', borderColor: 'border-rose-200' },
  all: { label: 'Admin Semua Pabrik', color: 'text-violet-700', bgColor: 'bg-violet-50', borderColor: 'border-violet-200' },
};
