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

// === NEW: Stock Harian Kantong ===
export interface StockHarian {
  id: string;            // format: {pabrik}_{nama}_{tanggal}
  pabrik: string;        // full pabrik name e.g. "Pabrik Baturaja 1 (PBR 1)"
  nama: string;          // jenis kantong e.g. "1 PLY PCC SMBR"
  tanggal: string;       // YYYY-MM-DD
  stockAwal: number;     // editable by super_admin (defaults to prev day's stockAkhir)
  penerimaan: number;    // can be filled by admin
  pengiriman: number;    // can be filled by admin
  pemakaian: number;     // auto-calculated from laporan_kantong
  stockAkhir: number;    // auto-calculated: stockAwal + penerimaan - pengiriman - pemakaian
  createdBy: string;
  updatedAt: string;
}

// === Penerimaan & Pengiriman Data (from Pelaporan page) ===
export interface PenerimaanData {
  id: string;
  nama: string;          // jenis kantong
  pabrik: string;        // full pabrik name (tujuan penerimaan)
  tanggal: string;       // YYYY-MM-DD
  jumlah: number;
  sumber: string;        // asal penerimaan (vendor atau nama pabrik lain)
  keterangan: string;
  createdBy: string;
  createdAt: string;
}

export interface PengirimanData {
  id: string;
  nama: string;          // jenis kantong
  pabrik: string;        // full pabrik name (sumber pengiriman)
  tanggal: string;       // YYYY-MM-DD
  jumlah: number;
  tujuan: string;        // tujuan pengiriman (nama pabrik lain)
  keterangan: string;
  createdBy: string;
  createdAt: string;
}

// Role display mapping (kode DB → label Indonesia)
export const ROLE_MAP: Record<string, string> = {
  super_admin: 'Admin Utama',
  admin: 'Admin',
  guest: 'Tamu',
};

export const PABRIK_ROLE_MAP: Record<string, { label: string; color: string; bgColor: string; borderColor: string }> = {
  pbr1: { label: 'PBR 1', color: 'text-indigo-700', bgColor: 'bg-indigo-50', borderColor: 'border-indigo-200' },
  pbr2: { label: 'PBR 2', color: 'text-teal-700', bgColor: 'bg-teal-50', borderColor: 'border-teal-200' },
  ppg: { label: 'PPG', color: 'text-amber-700', bgColor: 'bg-amber-50', borderColor: 'border-amber-200' },
  ppj: { label: 'PPJ', color: 'text-rose-700', bgColor: 'bg-rose-50', borderColor: 'border-rose-200' },
  all: { label: 'All Pabrik', color: 'text-violet-700', bgColor: 'bg-violet-50', borderColor: 'border-violet-200' },
};
