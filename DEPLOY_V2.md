# Deploy V2 — Alur Verifikasi + Role Tindak Lanjut + Cleanse Data

Urutan WAJIB: **Backup → Deploy code.gs + Cleanse → Push app.js → Verifikasi**.

---

## FASE 0 — Backup dulu (5 menit, jangan skip)

1. Buka spreadsheet **Assesment 5R - Data**
   https://docs.google.com/spreadsheets/d/1NJ4vpwktaWcoq5myVk-24ux5geoAznptGdxiGIeWuUI/edit
2. Menu **File → Make a copy** → nama: `Assesment 5R - Data BACKUP 2026-09-04`
3. Folder foto `Assesment 5R - Foto` — cleanse nanti membuang isinya ke **Trash** (bisa dipulihkan ±30 hari), jadi tidak wajib di-copy. Kalau mau ekstra aman: klik kanan folder → Make a copy.

---

## FASE 1 — Deploy code.gs + Cleanse

1. Buka Apps Script **Assesment 5R Backend**:
   https://script.google.com/d/18DAk54C9wz-knCQoQVky8SQ9yNFtHm_LcztkuX6k41aZSNkvVNbAmSF4/edit
2. File `Code.gs` → **Ctrl+A → Delete** → paste isi `code.gs` yang baru → **Ctrl+S**
3. Dropdown fungsi (kiri tombol Run) → **`cekID`** → **Run**
   → Execution log HARUS:
   ```
   Spreadsheet ditemukan: Assesment 5R - Data
   Folder ditemukan: Assesment 5R - Foto
   ```
4. Dropdown → **`migrateHeaders`** → **Run**
   - Kalau minta izin: Review permissions → pilih akun → Advanced → Go to project → Allow
   - Menambah kolom `Catatan Verifikasi` + `Update Terakhir` ke tab Temuan & SafetyFindings. Log tanpa error merah.
5. Dropdown → **`cleanseData`** → **Run**
   → Menghapus SEMUA baris data uji (header baris 1 aman) + buang subfolder foto ke Trash.
   Log contoh:
   ```
   Assessment: 12 baris data dihapus
   Detail: 840 baris data dihapus
   Temuan: 30 baris data dihapus
   SafetyFindings: sudah kosong
   RiwayatStatus: 5 baris data dihapus
   Drive: 12 subfolder foto dibuang ke Trash
   ```
   **TIDAK menyentuh:** tab Users, config_master.json (form induk), header.
6. (OPSIONAL) Dropdown → **`cleanseFotoStandar`** → Run — kosongkan galeri Foto Standar/acuan yang terisi dari sync uji.
7. (OPSIONAL) Dropdown → **`cleanseUsers`** → Run — HAPUS semua akun asesor. **Hanya** kalau semua akun yang ada adalah akun uji; kalau ada akun asli, skip dan hapus manual per baris.
8. **Deploy → Manage deployments → ikon pensil (✏️ Edit)** — JANGAN "New deployment"
9. Dropdown **Version → New version** → (Description: `v14 - verifikasi + role TL`) → **Deploy**
   → Web App URL **tidak berubah**.
10. **Verifikasi backend** — buka di browser (ganti `<URL>`):
    ```
    <URL>?action=findings&secret=ganti-rahasia-ini-123
    <URL>?action=safetyFindings&secret=ganti-rahasia-ini-123
    ```
    Dua-duanya harus balas `{"ok":true,"findings":[]}` / `{"ok":true,"safety":[]}` (array kosong = cleanse berhasil).

---

## FASE 2 — Kosongkan Trash Drive (setelah yakin)

1. https://drive.google.com → **Trash / Sampah** (menu kiri)
2. Pastikan subfolder foto uji (`s..._PU_lokasi_...`) ada di situ
3. Kalau sudah yakin tidak perlu → **Empty trash**. (Atau biarkan 30 hari sebagai jaring pengaman — Trash tidak menghitung kuota setelah beberapa saat... sebenarnya tetap menghitung; kosongkan bila kuota mepet.)

---

## FASE 3 — Push app.js (terminal)

```powershell
cd "d:\PE\4. PROJECT\10. Webapp 5R"
git status
```
Harus ada: `modified: app.js`, `modified: code.gs`, `DEPLOY_V2.md` (untracked).

```powershell
git add app.js code.gs DEPLOY_V2.md DEPLOY_SAFETY.md DEV.md
git status
git commit -m "Alur verifikasi temuan oleh asesor pembuat + role Tindak Lanjut per-PU + draf batch + fungsi cleanse" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push
```
Kalau muncul popup login GitHub → login.
Sukses = baris `<hash lama>..<hash baru>  main -> main`.

---

## FASE 4 — Verifikasi situs live

```powershell
gh run list --repo apajugajadi/assesment-5r --limit 3
```
Tunggu `completed  success` (±1-2 menit).

Buka **https://apajugajadi.github.io/assesment-5r/** — **incognito** (biar localStorage bersih).

Uji alur lengkap:
1. `admin5r` → daftarkan 1 akun asesor asli (☰ → Kelola Formulir → Kelola Asesor)
2. Login asesor itu → buat 1 assessment (ada temuan + 1 temuan safety berfoto) → Kirim ke Google
3. Cek Sheet: tab `Temuan` & `SafetyFindings` ada barisnya, Status = `Open`
4. `tl-pug` / `tl-pug` (sesuaikan PU) → modul Tindak Lanjut → pilih temuan → isi perbaikan + foto after → Status = **Menunggu Verifikasi** → **Kirim ke Google**
5. Cek Sheet: Status jadi `Menunggu Verifikasi`, `Update Terakhir` terisi
6. Login asesor pembuat → Beranda ada banner 🔔 → **Temuan Saya** → tab Perlu Verifikasi → **Lihat Foto Before/After** → **✔ Sesuai · Tutup** → **Kirim ke Google**
7. Cek Sheet: Status `Close`, `Verifikator` = nama asesor; tab `RiwayatStatus` ada jejak Open→Menunggu→Close
8. Uji tolak: temuan lain → **✘ Belum sesuai** + catatan → Kirim → Status balik `Open`, `Catatan Verifikasi` terisi; tl-pu lihat kotak merah "Ditолak verifikator: …"

---

## FASE 5 — Reset data lokal di tiap perangkat uji

localStorage tiap browser masih menyimpan sesi/draf uji lama. Untuk bersih:
- Buka pakai **incognito**, ATAU
- DevTools (F12) → Application → Local Storage → klik kanan domain → Clear, ATAU
- Di app: login admin → **Pencadangan → Hapus Data pada Perangkat Ini**

Kunci localStorage yang dipakai app: `asesmen5r_v1`, `asesmen5r_draft`, `asesmen5r_auth`, `tl_draft`, `vf_draft`, `tl_viewmode`.

---

## Rollback

| Masalah | Aksi |
|---|---|
| Data ke-cleanse padahal masih perlu | Restore dari **Assesment 5R - Data BACKUP** (copy jadi file utama, atau salin isinya). Foto: Drive Trash → Restore. |
| Frontend error | `git revert HEAD && git push` |
| Backend error | Apps Script → Manage deployments → Edit → Version → pilih versi lama → Deploy |
