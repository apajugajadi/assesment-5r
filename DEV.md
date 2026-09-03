# Menjalankan Assesment 5R di localhost (DEV)

## Jalankan

```powershell
cd "d:\PE\4. PROJECT\10. Webapp 5R"
npm run dev        # atau: node dev-server.js
```

Buka **http://localhost:8787**. Server tanpa dependency (pakai Node bawaan), `Cache-Control: no-store` jadi tiap refresh selalu ambil file terbaru.

Port lain: `node dev-server.js 8080`

## File

Shell statis (`index.html`, `logos.js`, `seed_data.js`, ikon) disalin dari folder `10. Web app 5R`.
Yang dikembangkan: **`app.js`** + **`code.gs`** (referensi Apps Script, tidak di-serve).

## Backend saat dev

Secara default app tetap menembak **Apps Script PRODUKSI** — artinya login/sync **menulis ke Google Sheet asli**. Untuk aman:

1. **Cara cepat (read-only-ish):** tinggal buka localhost, jangan pencet "Kirim ke Google".
2. **Cara benar:** buat deployment Apps Script + Google Sheet **terpisah untuk dev**, lalu di Console browser:
   ```js
   localStorage.setItem('dev_sync_url','https://script.google.com/macros/s/XXXX/exec')
   location.reload()
   ```
   atau buka `http://localhost:5173/?sync=https://script.google.com/macros/s/XXXX/exec` (tersimpan otomatis).
   Balik ke produksi: `localStorage.removeItem('dev_sync_url')`.

Override ini via `SYNC_URL` di [app.js](app.js) — hanya aktif kalau `dev_sync_url` di-set, jadi tidak berpengaruh di produksi.

## Login

- Admin: password `admin5r` (`ADMIN_PASS` di app.js)
- Asesor: butuh akun di tab `Users` backend — daftarkan lewat Admin -> Kelola Asesor (butuh backend yang jalan)

## Yang baru diubah (konteks)

Foto **Good Condition dihapus**; foto kini hanya untuk **Temuan** dan **wajib** saat ada jawaban "Tidak". Payload sync jadi jauh lebih ringan — perbaikan untuk error *"Gagal terhubung ke server"* saat sync assessment berfoto banyak.
