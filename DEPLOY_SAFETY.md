# Deploy Fitur Temuan Safety (K3) — Step by Step

Perubahan kali ini menyentuh **app.js DAN code.gs**, jadi Apps Script **wajib di-redeploy**.

Ringkasan perubahan:
- app.js: tombol "⚠ Temuan Safety" di kotak area, modal input (foto wajib), section di Kelola Temuan, menu drawer "Dashboard Safety (K3)" (admin).
- code.gs: tab baru `SafetyFindings`, foto ke Drive (prefix `safety__`), endpoint `?action=safetyFindings`, `?action=safetyPhotos`, `type:updateSafetyFinding`.

---

## 1. Cek dulu di localhost (sebelum deploy apa pun)

```powershell
cd "d:\PE\4. PROJECT\10. Webapp 5R"
node dev-server.js 8787
```

Buka **http://localhost:8787** (incognito). Yang bisa dites tanpa backend baru:
- [ ] Mulai assessment → di kotak hijau area ada tombol merah **⚠ Temuan Safety**
- [ ] Klik → modal muncul, coba Simpan tanpa foto → ditolak ("Foto temuan safety wajib dilampirkan")
- [ ] Isi lengkap + foto → tersimpan, badge angka di tombol nambah
- [ ] Lihat Hasil → kartu **Temuan Safety (K3)** muncul, bisa edit/hapus
- [ ] Kelola Temuan → section Temuan Safety juga muncul di sana
- [ ] Menu ☰ (login admin) → ada **Dashboard Safety (K3)**

> Catatan: **Dashboard Safety & sync masih pakai backend PRODUKSI**. Sebelum code.gs baru di-deploy, kalau sync assessment yang ada temuan safety-nya → data safety diabaikan server (sync tetap sukses, tidak error). Dashboard Safety akan kosong / error `unknown` sampai code.gs baru live.

---

## 2. Deploy code.gs ke Apps Script

1. Buka Google Sheet database → menu **Extensions → Apps Script**
2. Buka file `Code.gs`, **hapus semua isi**, paste seluruh isi `code.gs` yang baru
3. **Ctrl+S** (Save)
4. Di dropdown fungsi (sebelah tombol Run), pilih **`migrateHeaders`** → klik **Run**
   - Ini membuat tab `SafetyFindings` + header-nya. Aman diulang (idempoten).
   - Kalau muncul minta **Authorize** → izinkan (Advanced → Go to project → Allow)
   - Cek Execution log: tidak ada error merah

## 3. Publish versi baru (URL TIDAK berubah)

1. **Deploy** (kanan atas) → **Manage deployments**
2. Klik ikon **pensil (Edit)** pada deployment yang aktif
3. Dropdown **Version** → pilih **New version**
4. Description (opsional): `v13 - fitur Temuan Safety K3`
5. Klik **Deploy**
6. **URL Web App TETAP SAMA** → **tidak perlu ubah app.js**

> ⚠️ Kalau kamu tidak sengaja pilih **"New deployment"** (bukan Edit versi lama), URL berubah. Kalau itu terjadi:
> 1. Copy Web App URL yang baru
> 2. Buka `app.js`, cari `const SYNC_URL_DEFAULT='https://script.google.com/macros/s/.../exec';`
> 3. Ganti isinya dengan URL baru, Save
> 4. Lanjut ke langkah 4 (push) — dan pastikan file app.js di repo ikut ter-update

## 4. Push app.js (+ code.gs sebagai referensi) ke GitHub

```powershell
# dari folder kerja
git -C "<clone repo>" ...   # (Claude yang jalankan, atau:)
```
Claude akan: copy `app.js` ke clone repo `apajugajadi/assesment-5r`, commit, push ke `main`.
`code.gs` **tidak wajib** di repo (Apps Script only) tapi boleh ikut sebagai arsip.

## 5. Verifikasi setelah Pages rebuild (~1-2 menit)

Cek **Actions** tab di repo sampai hijau, lalu buka
**https://apajugajadi.github.io/assesment-5r/** (incognito / Ctrl+F5):

- [ ] Buat / buka 1 assessment, tambah 1 Temuan Safety (foto), Selesai → **Kirim ke Google**
- [ ] Alert sukses (tidak ada "Gagal terhubung")
- [ ] Buka Google Sheet → tab **`SafetyFindings`** → baris baru muncul, kolom Foto Temuan terisi
- [ ] Buka folder Drive sesi → ada file `safety__...jpg`
- [ ] Login admin → ☰ → **Dashboard Safety (K3)** → temuan muncul di ringkasan + daftar
- [ ] Di daftar: isi Deskripsi Tindak Lanjut + set Status = Close + Verifikator → **Simpan** → toast "Tersimpan"
- [ ] Klik **Riwayat Status** → perubahan Open→Close tercatat
- [ ] Asesor sinkron ulang sesi yang sama → tindak lanjut admin **tidak hilang** (test _oldSafetyMap)

---

## Rollback kalau ada masalah

- **Frontend**: `git revert <commit>` lalu push — Pages balik ke versi sebelumnya
- **Backend**: Apps Script → Manage deployments → Edit → Version → pilih versi lama → Deploy
- Tab `SafetyFindings` boleh dibiarkan (tidak mengganggu fungsi lama)
