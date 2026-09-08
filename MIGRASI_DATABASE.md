# Migrasi Database ke Akun Google Lain

Memindahkan Spreadsheet + Folder Foto + Apps Script dari akun pribadi
(`apajugajadi@gmail.com`) ke akun lain (mis. akun resmi unit/tim).

**Waktu paling tepat: SEKARANG** — database sudah kosong (habis `cleanseData`),
jadi tidak ada data assessment yang perlu ikut pindah. Yang perlu dibawa cuma:
- **`config_master.json`** (definisi formulir: area, matriks, target, wawancara)
- **Isi tab `Users`** (akun asesor + hash sandi) — bila sudah ada akun asli

> **Catatan seed**: `seed_data.js` di repo sudah disamakan dengan formulir live
> (versi 18) pada commit terbaru. Jadi walaupun langkah upload `config_master.json`
> terlewat, perangkat dengan cache bersih tetap memuat formulir yang benar. Upload
> `config_master.json` tetap disarankan agar galeri Foto Standar & versi ikut terbawa.

---

## Yang berubah setelah migrasi

| Komponen | Sebelum | Sesudah |
|---|---|---|
| Spreadsheet | `apajugajadi` | akun baru |
| Folder Foto | `apajugajadi` | akun baru |
| Apps Script `Assesment 5R Backend` | `apajugajadi` | project BARU milik akun baru |
| Web App URL (`SYNC_URL_DEFAULT` di app.js) | `AKfycbxOfB...` | **URL BARU** → wajib commit + push |
| `SHARED_SECRET` / `SYNC_SECRET` | `ganti-rahasia-ini-123` | tetap sama (tidak perlu diubah) |

> **Ownership Google tidak bisa dipindah antar-akun** (kecuali satu domain Workspace).
> Karena itu kita **buat baru** di akun tujuan, bukan transfer.

---

## LANGKAH

### 1. (Akun LAMA) Amankan yang perlu dibawa

1. Buka [folder **Assesment 5R - Foto**](https://drive.google.com/drive/folders/1XN5q2GDjNyZAFPsXLFkDGq3yYg1LpcgO)
2. Klik kanan file **`config_master.json`** → **Download**. Simpan.
3. Buka [spreadsheet **Assesment 5R - Data**](https://docs.google.com/spreadsheets/d/1NJ4vpwktaWcoq5myVk-24ux5geoAznptGdxiGIeWuUI/edit) → tab **`Users`**
   - Kalau ada akun asli: blok baris 2 sampai akhir → **Ctrl+C**. Biarkan clipboard, atau tempel sementara ke Notepad.
   - Kalau semua akun uji / kosong: lewati.

### 2. (Akun BARU) Buat Apps Script + database

1. Login ke akun Google tujuan. Buka https://script.google.com → **New project**
2. Ganti nama project → **Assesment 5R Backend**
3. File `Code.gs` → hapus semua → **paste seluruh isi `code.gs`** dari repo
4. Di bagian atas, **KOSONGKAN** dua konstanta:
   ```js
   var SHEET_ID  = '';
   var FOLDER_ID = '';
   ```
5. **Ctrl+S**
6. Dropdown fungsi → **`bootstrapDatabase`** → **Run**
   - Authorize: pilih akun baru → Advanced → Go to project → Allow
   - **Execution log** akan mencetak:
     ```
     SHEET_ID BARU  = 1AbC...xyz
     FOLDER_ID BARU = 1DeF...uvw
     6 tab + header dibuat/diselaraskan.
     ```
7. **Salin** kedua ID itu ke konstanta `SHEET_ID` dan `FOLDER_ID` → **Ctrl+S**
8. Jalankan **`cekID`** → log harus sebut nama Spreadsheet & Folder yang benar

### 3. (Akun BARU) Bawa config formulir

1. Buka Drive akun baru → folder **Assesment 5R - Foto** (baru dibuat `bootstrapDatabase`)
2. **Upload** file `config_master.json` yang tadi di-download dari akun lama
3. (Bila tab Users tadi di-copy) Buka Spreadsheet baru → tab **`Users`** → klik sel A2 → **Ctrl+V**

### 4. (Akun BARU) Deploy Web App

1. **Deploy → New deployment** → ikon gerigi → **Web app**
2. Isi:
   - **Description**: `v1 - akun resmi`
   - **Execute as**: **Me** (akun baru)
   - **Who has access**: **Anyone**
3. **Deploy** → authorize bila diminta
4. **COPY Web app URL** — bentuknya `https://script.google.com/macros/s/AKfyc.../exec`

### 5. (Repo) Ganti URL di app.js + push

Di `d:\PE\4. PROJECT\10. Webapp 5R`:
1. Buka `app.js`, cari baris ~26:
   ```js
   const SYNC_URL_DEFAULT='https://script.google.com/macros/s/AKfycbxOfB.../exec';
   ```
2. Ganti isi string dengan **URL baru** dari langkah 4. Save.
3. Terminal:
   ```powershell
   cd "d:\PE\4. PROJECT\10. Webapp 5R"
   git add app.js code.gs MIGRASI_DATABASE.md
   git commit -m "Migrasi database ke akun Google baru: ganti SYNC_URL + bootstrapDatabase" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
   git push
   ```
4. Tunggu Pages build (`gh run list --repo apajugajadi/assesment-5r --limit 3` → success)

### 6. Verifikasi

Buka **https://apajugajadi.github.io/assesment-5r/** — **incognito**:
1. `admin5r` masuk → Beranda harus "✓ Formulir terbaru" (bukan ⚠️ Gagal) → artinya app konek ke backend baru
2. Kelola Formulir → cek area & matriks sesuai (dari `config_master.json` yang di-upload)
3. Kelola Asesor → cek akun (dari tab Users yang di-copy), atau daftarkan ulang
4. Uji 1 assessment kecil → Kirim ke Google → cek muncul di Spreadsheet **akun baru**
5. Cek langsung: `<URL baru>?action=findings&secret=ganti-rahasia-ini-123` → `{"ok":true,...}`

### 7. Nonaktifkan yang lama (setelah yakin ±1 minggu)

1. Akun lama → Apps Script `Assesment 5R Backend` → **Deploy → Manage deployments** → arsipkan/hapus deployment (biar URL lama mati)
2. Spreadsheet & folder lama boleh dibiarkan sebagai arsip, atau dipindah ke Trash.

---

## Kalau akun baru adalah Google Workspace (domain resmi)

Bila akun tujuan satu domain Workspace dan kamu admin-nya, ownership BISA
dipindah lewat **Admin console → Apps → Google Workspace → Drive → Transfer ownership**,
atau per-file: buka file → Share → ubah "Owner". Tapi Apps Script tetap paling
bersih dengan cara buat-baru di atas. `bootstrapDatabase` juga bisa dilewati bila
kamu memilih transfer file — cukup salin ID Spreadsheet & Folder hasil transfer
ke konstanta, lalu deploy.

## Ganti SYNC_SECRET sekalian? (opsional, disarankan)

Repo ini public — `ganti-rahasia-ini-123` kelihatan semua orang. Saat migrasi
adalah momen bagus menggantinya:
1. Di `code.gs` akun baru: `var SHARED_SECRET = 'string-acak-panjang-baru';`
2. Di `app.js`: `const SYNC_SECRET='string-acak-panjang-baru';` (harus sama persis)
3. Deploy + push. (Keamanan tetap lemah selama repo public, tapi minimal bukan default.)
