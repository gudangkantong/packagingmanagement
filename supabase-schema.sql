-- ================================================
-- Supabase Schema untuk Packaging Management
-- Jalankan di: Supabase Dashboard - SQL Editor
-- ================================================

-- 1. Laporan Kantong (data utama pemakaian)
CREATE TABLE IF NOT EXISTS laporan_kantong (
  id TEXT PRIMARY KEY,
  vendor TEXT NOT NULL DEFAULT '',
  nama TEXT NOT NULL DEFAULT '',
  pabrik TEXT NOT NULL DEFAULT '',
  shift INTEGER NOT NULL DEFAULT 1,
  tanggal TEXT NOT NULL DEFAULT '',
  utuh INTEGER NOT NULL DEFAULT 0,
  pecah INTEGER NOT NULL DEFAULT 0,
  sortir INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_laporan_tanggal ON laporan_kantong(tanggal);
CREATE INDEX IF NOT EXISTS idx_laporan_pabrik ON laporan_kantong(pabrik);
CREATE INDEX IF NOT EXISTS idx_laporan_nama ON laporan_kantong(nama);

-- 2. Penerimaan Data
CREATE TABLE IF NOT EXISTS penerimaan_data (
  id TEXT PRIMARY KEY,
  nama TEXT NOT NULL DEFAULT '',
  pabrik TEXT NOT NULL DEFAULT '',
  tanggal TEXT NOT NULL DEFAULT '',
  jumlah INTEGER NOT NULL DEFAULT 0,
  sumber TEXT NOT NULL DEFAULT '',
  keterangan TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_penerimaan_tanggal ON penerimaan_data(tanggal);
CREATE INDEX IF NOT EXISTS idx_penerimaan_pabrik ON penerimaan_data(pabrik);

-- 3. Pengiriman Data
CREATE TABLE IF NOT EXISTS pengiriman_data (
  id TEXT PRIMARY KEY,
  nama TEXT NOT NULL DEFAULT '',
  pabrik TEXT NOT NULL DEFAULT '',
  tanggal TEXT NOT NULL DEFAULT '',
  jumlah INTEGER NOT NULL DEFAULT 0,
  tujuan TEXT NOT NULL DEFAULT '',
  keterangan TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_pengiriman_tanggal ON pengiriman_data(tanggal);
CREATE INDEX IF NOT EXISTS idx_pengiriman_pabrik ON pengiriman_data(pabrik);

-- 4. Allowed Users
CREATE TABLE IF NOT EXISTS allowed_users (
  email TEXT PRIMARY KEY,
  allowed BOOLEAN NOT NULL DEFAULT true,
  role TEXT NOT NULL DEFAULT 'guest',
  pabrik_role TEXT,
  added_at TEXT NOT NULL DEFAULT ''
);

-- 5. Locked Dates
CREATE TABLE IF NOT EXISTS locked_dates (
  date TEXT PRIMARY KEY,
  locked BOOLEAN NOT NULL DEFAULT false,
  locked_by TEXT,
  locked_at TEXT
);

-- 6. App Meta (last update sync)
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'
);

-- 7. Stock Awal Overrides
CREATE TABLE IF NOT EXISTS stock_awal_overrides (
  pabrik TEXT PRIMARY KEY,
  overrides JSONB NOT NULL DEFAULT '{}',
  updated_at TEXT,
  migrated_at TEXT
);

-- 8. Reference Data: Vendors
CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT ''
);

-- 9. Reference Data: Jenis Kantong
CREATE TABLE IF NOT EXISTS jenis_kantong (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT ''
);

-- 10. Reference Data: Pabrik List
CREATE TABLE IF NOT EXISTS pabrik_list (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT ''
);

-- ================================================
-- Enable Realtime untuk tabel yang butuh sync
-- ================================================
ALTER PUBLICATION supabase_realtime ADD TABLE laporan_kantong;
ALTER PUBLICATION supabase_realtime ADD TABLE penerimaan_data;
ALTER PUBLICATION supabase_realtime ADD TABLE pengiriman_data;
ALTER PUBLICATION supabase_realtime ADD TABLE allowed_users;
ALTER PUBLICATION supabase_realtime ADD TABLE locked_dates;
ALTER PUBLICATION supabase_realtime ADD TABLE app_meta;
ALTER PUBLICATION supabase_realtime ADD TABLE stock_awal_overrides;

-- ================================================
-- Row Level Security (RLS) — allow all for now
-- ================================================
ALTER TABLE laporan_kantong ENABLE ROW LEVEL SECURITY;
ALTER TABLE penerimaan_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE pengiriman_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE allowed_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE locked_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_awal_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE jenis_kantong ENABLE ROW LEVEL SECURITY;
ALTER TABLE pabrik_list ENABLE ROW LEVEL SECURITY;

-- Allow all operations (bisa dikunci nanti)
CREATE POLICY "Allow all" ON laporan_kantong FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON penerimaan_data FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON pengiriman_data FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON allowed_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON locked_dates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON app_meta FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON stock_awal_overrides FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON vendors FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON jenis_kantong FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON pabrik_list FOR ALL USING (true) WITH CHECK (true);

-- Done!
SELECT 'Schema created successfully!' as status;
