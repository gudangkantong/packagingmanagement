# Packaging Management — Rekap Lengkap
## Tanggal: 25 Juli 2026

---

## 1. Masalah Awal

**Semua data di web tidak tampil** setelah commit `563a767`.

**Root cause:** `getDocsFromServer` diubah ke `getDocs` di cascade effect. `getDocs` baca dari local cache (IndexedDB) yang kosong → cascade kira tidak ada data → buat dokumen baru dari nol → **timpa data asli di Firestore**.

---

## 2. Semua Perubahan yang Sudah Dilakukan

### Commit 1: `fae98f9` — Fix data tidak tampil
- Revert `getDocs` → `getDocsFromServer` di 3 tempat (cascade, old-date stock, old-date prevDay)
- Fix OPT stock awal display (prioritas: manual edit > saved > prevDayData)
- Fix OPT input rendering (pakai editBuffer)

### Commit 2: `68c49e1` — Reduce Firestore reads
- Cascade cooldown 5 menit
- Cascade debounce 10s → 30s

### Commit 3: `75a4eb4` — Cascade 1x per hari
- localStorage guard: cascade hanya jalan 1x per tanggal per hari
- Tombol Sync bisa force bypass

### Commit 4: `b1dd6c7` — Local-first stock computation (REFACTOR BESAR)
- **Hapus:** cascade, DirectSync, autoSave, onSnapshot stock_harian
- **Ganti:** compute stock 100% lokal dari data sumber (penerimaan, pengiriman, laporan)
- **Tambah:** `stock_awal_overrides` collection (1 doc per lokasi)
- **Result:** 0 reads untuk stock, 5 reads untuk overrides

### Commit 5: `20c5282` — Auto-migrate manual edits
- Fallback: baca manual edits dari `stock_harian` (manuallyEdited: true) → copy ke `stock_awal_overrides`
- Jalankan untuk semua user (bukan hanya super_admin)

### Commit 6: `45aeffb` — Fix migration runs for all users
- Remove isMasterAdmin guard dari migration

### Commit 7: `b58eed2` — Remove Sync button
- Hapus tombol Sync dari OPT dan Pabrik tables
- Hapus RefreshCw import dan refreshTrigger prop

### Commit 8: `a5a1b89` — Laporan onSnapshot window 30 → 7 hari
- Kurangi laporan query dari 30 hari ke 7 hari (hemat 75% reads)

### Commit 9: `f64874d` — Revert to onSnapshot for penerimaan/pengiriman
- Polling 5 menit dengan 50 user = 2.5 juta reads/hari (BENCANA)
- Balik ke onSnapshot (initial read + incremental updates)

---

## 3. Arsitektur Saat Ini (Setelah Semua Fix)

### Firestore Reads per Hari (50 Users)
| Sumber | Reads |
|--------|-------|
| Laporan (7 hari onSnapshot) | 12,000 |
| Penerimaan onSnapshot | 1,275 |
| Pengiriman onSnapshot | 7,650 |
| Overrides onSnapshot | 250 |
| Others (users, locked, meta) | 2,600 |
| **Total** | **~23,780** |
| **Limit** | **50,000** |
| **Sisa** | **26,220** ✅ |

### Data Flow
```
Input Admin → Firestore → onSnapshot → State → UI
                                        ↓
Stock Compute → 100% lokal dari penerimaan + pengiriman + laporan
                ↓
Manual Edit → stock_awal_overrides → 1 write per lokasi
```

### Collections yang Dipakai
| Collection | Method | Docs Est. |
|-----------|--------|-----------|
| laporan_kantong | onSnapshot (7 hari) | ~210 |
| penerimaan_data | onSnapshot (all) | ~25 |
| pengiriman_data | onSnapshot (all) | ~150 |
| allowed_users | onSnapshot | ~50 |
| locked_dates | onSnapshot | ~30 |
| app_meta | onSnapshot | 1 |
| stock_awal_overrides | onSnapshot | 5 |
| vendors | getDocs | ~20 |
| jenis_kantong | getDocs | ~15 |
| pabrik_list | getDocs | ~5 |
| stock_harian | getDocs (migration only) | ~500 |

---

## 4. Supabase Migration (Sudah Disiapkan, Belum Selesai)

### Yang Sudah Selesai
- ✅ Supabase project URL: `https://jerraibjvwishoebnavw.supabase.co`
- ✅ SQL schema: 10 tabel sudah dibuat di Supabase
- ✅ `src/supabase.ts` — Supabase client
- ✅ `src/dataLayer.ts` — Semua fungsi CRUD (fetch, upsert, delete, subscribe)
- ✅ `src/db-compat.ts` — Compatibility layer (drop-in replacement)
- ✅ `supabase-schema.sql` — SQL untuk buat tabel

### Yang Belum Selesai
- ❌ Modifikasi App.tsx (ganti Firestore → Supabase)
- ❌ Modifikasi StockHarianPage.tsx (ganti overrides Firestore → Supabase)
- ❌ Data migration (export dari Firestore → import ke Supabase)
- ❌ Testing
- ❌ Deploy

### Supabase Keys
```
Project URL: https://jerraibjvwishoebnavw.supabase.co
Publishable Key: (lihat di Supabase Dashboard → Settings → API)
Secret Key: (lihat di Supabase Dashboard → Settings → API)
```

### Supabase Tables (Sudah Dibuat)
```sql
1. laporan_kantong    — Laporan harian pemakaian
2. penerimaan_data    — Penerimaan kantong
3. pengiriman_data    — Pengiriman kantong
4. allowed_users      — User permissions
5. locked_dates       — Tanggal terkunci
6. app_meta           — Last update sync
7. stock_awal_overrides — Manual stock edits
8. vendors            — Daftar vendor
9. jenis_kantong      — Daftar jenis kantong
10. pabrik_list       — Daftar pabrik
```

### Supabase Free Tier vs Firebase Free Tier
| | Firebase | Supabase |
|--|---------|----------|
| Reads/hari | 50,000 | **Unlimited** |
| Writes/hari | 20,000 | **Unlimited** |
| Real-time | onSnapshot (reads!) | WebSocket (no reads!) |
| Storage | 1 GiB | 500 MB |
| Users | Unlimited | 50,000 MAU |

---

## 5. Langkah Selanjutnya

### Hari Ini (Setelah Jam 4 Sore WIB)
1. Buka web → cek apakah data tampil normal
2. Cek stock awal tanggal 1 Juli (migration otomatis)
3. Cek preview laporan bulanan

### Migrasi Supabase (Kapan Saja)
1. Buka session baru dengan AI
2. Kasih file rekap ini
3. Lanjutkan migrasi:
   - Modifikasi App.tsx (ganti Firestore → Supabase)
   - Testing
   - Deploy

### File yang Sudah Dibuat untuk Supabase
```
src/supabase.ts        — Supabase client
src/dataLayer.ts       — Semua fungsi CRUD
src/db-compat.ts       — Compatibility layer
supabase-schema.sql    — SQL schema (sudah dijalankan)
```

---

## 6. Peringatan Penting

### Token GitHub
Token `ghp_JJ…5U9x` sudah ter-expose di chat **3 kali**.
**WAJIB REVOKE** di: https://github.com/settings/tokens

### Supabase Keys
Secret key juga ter-expose.
**Sebaiknya rotate** di: Supabase Dashboard → Settings → API → Regenerate

### Firebase Config
Firebase config (API key, project ID) ada di `src/firebase.ts`.
Ini public key (aman), tapi jangan share service account key.

---

## 7. Troubleshooting

### Kalau masih error setelah jam 4 sore:
1. Clear browser cache (DevTools → Application → Clear site data)
2. Buka di Incognito/Private window
3. Login sebagai super_admin (supaya migration jalan)
4. Cek Console (F12) untuk error

### Kalau data stock awal masih 0:
1. Cek Console → cari log `[StockHarian] Migrated X edits`
2. Kalau tidak ada log → migration tidak jalan
3. Manual fix: buka Supabase Dashboard → Table Editor → stock_awal_overrides → tambah data manual

### Kalau quota habis lagi:
1. Cek Firebase Console → Usage → Reads per hari
2. Kalau > 50,000 → ada onSnapshot yang boros
3. Solusi: kurangi laporan window (7 → 3 hari) atau kurangi user
