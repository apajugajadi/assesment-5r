# Migrasi Database ke Akun Google Lain

Memindahkan Spreadsheet + Folder Foto + Apps Script dari akun pribadi
(`apajugajadi@gmail.com`) ke akun lain (mis. akun resmi unit/tim).

**Mulai dari nol di akun tujuan.** Data assessment di akun lama **tidak dibawa** —
ditinggalkan begitu saja. `seed_data.js` di repo sudah berisi formulir versi
terkini (v18), jadi aplikasi langsung punya formulir yang benar tanpa perlu
menyalin apa pun dari akun lama.

> Google **tidak bisa transfer ownership antar-akun** (kecuali satu domain
> Workspace). Karena itu kita **buat baru** di akun tujuan.

---

## Yang berubah

| Komponen | Sesudah migrasi |
|---|---|
| Spreadsheet `Assesment 5R - Data` | dibuat baru, milik akun tujuan |
| Folder `Assesment 5R - Foto` | dibuat baru, milik akun tujuan |
| Apps Script `Assesment 5R Backend` | project baru, milik akun tujuan |
| **Web App URL** (`SYNC_URL_DEFAULT` di app.js) | **BERUBAH** → wajib commit + push |
| `SHARED_SECRET` / `SYNC_SECRET` | tetap `ganti-rahasia-ini-123` (atau ganti sekalian, lihat bawah) |
| Data assessment lama | ditinggalkan di akun lama |
| Akun asesor | didaftarkan ulang lewat menu Admin |

---

## LANGKAH

### 1. (Akun BARU) Buat Apps Script + database

1. Login akun Google tujuan → https://script.google.com → **New project**
2. Ganti nama → **Assesment 5R Backend**
3. File `Code.gs` → hapus semua → **paste seluruh isi `code.gs`** dari repo
4. Di bagian atas, **KOSONGKAN** dua konstanta:
   ```js
   var SHEET_ID  = '';
   var FOLDER_ID = '';
   ```
5. **Ctrl+S**
6. Dropdown fungsi → **`bootstrapDatabase`** → **Run**
   - Authorize: pilih akun baru → Advanced → Go to project → Allow
   - Execution log mencetak:
     ```
     SHEET_ID BARU  = 1AbC...
     FOLDER_ID BARU = 1DeF...
     6 tab + header dibuat/diselaraskan.
     ```
7. **Salin** kedua ID ke konstanta `SHEET_ID` & `FOLDER_ID` → **Ctrl+S**
8. Jalankan **`cekID`** → log harus menyebut nama Spreadsheet & Folder yang benar

### 2. (Akun BARU) Deploy Web App

1. **Deploy → New deployment** → ikon gerigi ⚙️ → **Web app**
2. Isi:
   - **Description**: `v1 - akun resmi`
   - **Execute as**: **Me**
   - **Who has access**: **Anyone**
3. **Deploy** → authorize bila diminta
4. **COPY Web app URL** — bentuk `https://script.google.com/macros/s/AKfyc.../exec`

### 3. (Repo) Ganti URL di app.js + push

Serahkan URL baru ke Claude, atau kerjakan sendiri:
1. `app.js` baris ~26 — ganti isi string `SYNC_URL_DEFAULT` dengan URL baru
2. ```powershell
   cd "d:\PE\4. PROJECT\10. Webapp 5R"
   git add app.js
   git commit -m "Migrasi database: ganti Web App URL ke backend akun baru" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
   git push
   ```
3. Tunggu Pages build success.

### 4. (App) Baseline & akun

Buka **https://apajugajadi.github.io/assesment-5r/** — **incognito**:
1. Masuk `admin5r` → Beranda harus **"✓ Formulir terbaru"** (bukan ⚠️ Gagal)
   → artinya app konek ke backend baru
2. **Kelola Formulir → Sinkronkan Formulir ke Seluruh Asesor**
   → membuat `config_master.json` di folder baru sebagai baseline (v18)
3. **Kelola Asesor** → daftarkan ulang seluruh akun asesor
4. Uji 1 assessment kecil → Kirim ke Google → cek muncul di Spreadsheet **akun baru**
5. Cek langsung: `<URL baru>?action=findings&secret=ganti-rahasia-ini-123` → `{"ok":true,"findings":[]}`

### 5. Nonaktifkan yang lama (setelah ±1 minggu aman)

- Akun lama → Apps Script → **Deploy → Manage deployments** → hapus/arsipkan deployment (URL lama mati)
- Spreadsheet & folder lama boleh dibiarkan sebagai arsip atau dibuang ke Trash.

---

## Ganti SYNC_SECRET sekalian (opsional, disarankan)

Repo ini public — `ganti-rahasia-ini-123` terlihat semua orang. Saat migrasi
momen bagus menggantinya:
1. `code.gs` akun baru: `var SHARED_SECRET = 'string-acak-panjang-baru';`
2. `app.js`: `const SYNC_SECRET='string-acak-panjang-baru';` (harus sama persis)
3. Deploy + push.

## Bila akun tujuan adalah Google Workspace

Ownership file BISA dipindah lewat Admin console (Drive → Transfer ownership) atau
per-file (Share → ubah Owner). Tapi karena data lama tidak dibawa, cara buat-baru
di atas tetap paling bersih. Apps Script tetap harus dibuat ulang.
