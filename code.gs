/************************************************************
 * ASSESMENT 5R — Backend Apps Script — VERSI FINAL
 * Direktorat Operasi, PT Pertamina Lubricants
 *
 * Pembaruan pada versi ini:
 *  - Multi-Tahun & Jenis Penilaian (Resmi / Internal)
 *  - Penyebab (Root Cause) pada setiap temuan
 *  - Deteksi otomatis temuan berulang antar-periode
 *  - Riwayat perubahan status temuan (jejak audit)
 *
 * Setelah menempelkan berkas ini: simpan (Ctrl+S), kemudian
 * Deploy -> Manage deployments -> ikon pensil -> New version -> Deploy.
 *
 * SEKALI SAJA setelah deploy pertama: pilih fungsi "migrateHeaders"
 * pada menu drop-down di sebelah tombol Run, lalu jalankan.
 ************************************************************/

// ====== KONFIGURASI ======
var SHEET_ID  = '1NJ4vpwktaWcoq5myVk-24ux5geoAznptGdxiGIeWuUI'; // Spreadsheet tujuan
var FOLDER_ID = '1XN5q2GDjNyZAFPsXLFkDGq3yYg1LpcgO';            // Folder foto pada Drive
var SHARED_SECRET = 'ganti-rahasia-ini-123'; // harus sama dengan SYNC_SECRET pada app.js
// ==========================

var SHEET_DATA    = 'Assessment';      // satu baris ringkasan per assessment
var SHEET_DETAIL  = 'Detail';          // satu baris per klausul (jawaban mentah)
var SHEET_TEMUAN  = 'Temuan';          // satu baris per temuan
var SHEET_RIWAYAT = 'RiwayatStatus';   // jejak perubahan status temuan (BARU)
var SHEET_USERS   = 'Users';           // (P-uid) akun asesor: username + password (hash) — BARU

// Header tab Users (BARU). Password TIDAK PERNAH disimpan plain text — selalu
// dalam bentuk hash SHA-256 (lihat _hashPassword). 'Aktif' = 'Ya'/'Tidak' untuk
// menonaktifkan akun tanpa harus menghapus barisnya (jejak tetap ada).
var HEAD_USERS = [
  'Username','Nama Lengkap','Password Hash','Aktif','Dibuat Oleh','Dibuat Pada','Direset Pada'
];

// Header tab Assessment & Detail. Tahun dan Jenis diletakkan di akhir
// agar kolom yang sudah ada sebelumnya (termasuk Folder Foto) tidak bergeser.
// 'Asesor Username' (BARU) — dipakai untuk filter kepemilikan temuan secara akurat,
// karena 'Asesor' (nama lengkap) bisa duplikat/berubah, sedangkan username unik.
var HEAD_DATA = [
  'ID Sesi','Sync Count','Last Sync','Config Version','PU','Lokasi','Periode',
  'Asesor','Tanggal','Nilai Akhir','Predikat','Jumlah Temuan','Folder Foto',
  'Tahun','Jenis','Asesor Username'
];
var HEAD_DETAIL = [
  'ID Sesi','PU','Lokasi','Area','Aspek','No','Klausul','Jawaban','Skor Aspek',
  'Tahun','Jenis'
];
// Header tab Temuan: ditambahkan 'Penyebab' dan 'Berulang', serta 'Foto Temuan (DataURL)'
// dan 'Foto Perbaikan (DataURL)' (BARU) agar before/after bisa ditampilkan langsung di Dashboard Cloud.
// 'Area ID' (BARU) disimpan terpisah dari 'Area' (nama) — dipakai untuk mencocokkan foto standar
// secara ANDAL walau nama area sempat diubah admin sejak temuan ini pertama kali tercatat.
var HEAD_TEMUAN = [
  'ID Temuan','ID Sesi','PU','Lokasi','Periode','Asesor','Area','Kategori','Skor',
  'Deskripsi','Saran','Target','Deskripsi Perbaikan','Tgl Perbaikan','Status','Verifikator','Folder Foto',
  'Penyebab','Berulang','Foto Temuan (DataURL)','Foto Perbaikan (DataURL)','Dijadikan Standar','Area ID','Asesor Username'
];
// Batas aman panjang string per sel Sheets (~50rb char); dataURL foto yang sudah dikompres
// biasanya jauh di bawah ini, tapi kita pasang jaga-jaga agar tidak error saat setValues.
var MAX_CELL_CHARS = 45000;
// Header tab RiwayatStatus (BARU) — satu baris per perubahan status
var HEAD_RIWAYAT = [
  'ID Temuan','ID Sesi','Status Lama','Status Baru','Diubah Oleh','Waktu Perubahan'
];

// ===== TEMUAN SAFETY (K3) — BARU =====
// Terpisah dari Temuan 5R. Satu baris per temuan safety. 'ID Safety' unik (dibuat app.js).
// Kolom tindak lanjut (Status s/d Foto Perbaikan) dikelola admin lewat Dashboard Safety —
// dipertahankan saat asesor sinkron ulang sesi (lihat _oldSafetyMap).
var SHEET_SAFETY = 'SafetyFindings';
var HEAD_SAFETY = [
  'ID Safety','ID Sesi','PU','Lokasi','Periode','Tahun','Asesor','Asesor Username',
  'Kategori','Lokasi Titik','Deskripsi','Tanggal Temuan',
  'Status','Deskripsi Perbaikan','Tgl Perbaikan','Verifikator',
  'Foto Temuan (DataURL)','Foto Perbaikan (DataURL)','Folder Foto'
];
// Kolom foto dikecualikan dari listing utama (hemat payload) — diambil on-demand.
var SAFETY_KOLOM_FOTO = ['Foto Temuan (DataURL)','Foto Perbaikan (DataURL)'];

var TAHUN_DEFAULT = 2025; // dipakai untuk mengisi baris lama saat migrasi

// Ambil tahun & jenis dari record; berikan nilai baku apabila kosong
function _tahunJenis(rec) {
  var th = (rec && rec.tahun != null && rec.tahun !== '') ? rec.tahun : new Date().getFullYear();
  var jn = (rec && rec.jenis) ? rec.jenis : 'Resmi';
  return { tahun: th, jenis: jn };
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.secret !== SHARED_SECRET) return _json({ok:false, error:'unauthorized'});

    // ---- mode: admin mengirim config induk ----
    if (body.type === 'config') {
      _writeConfig(body.config);
      return _json({ok:true, type:'config', version:(body.config&&body.config.version)||null});
    }

    // ---- mode: admin memperbarui status temuan (dengan jejak audit) ----
    if (body.type === 'updateStatus') {
      return _json(_updateTemuanStatus(body.findingId, body.status, body.verifikator));
    }

    // ---- mode: admin memperbarui beberapa kolom temuan ----
    if (body.type === 'updateFinding') {
      return _json(_updateTemuanFields(body.findingId, body.fields, body.verifikator));
    }

    // ---- mode: admin memperbarui tindak lanjut Temuan Safety (K3) ----
    if (body.type === 'updateSafetyFinding') {
      return _json(_updateSafetyFields(body.safetyId, body.fields, body.verifikator));
    }

    // ---- (P-closing) mode: ASESOR menutup temuan miliknya sendiri (upload foto after,
    //      deskripsi tindak lanjut, tanggal, dan set status Close). Kepemilikan divalidasi
    //      DI SERVER (bukan cuma dipercaya dari client) — hanya boleh update temuan yang
    //      'Asesor Username'-nya sama dengan username yang sedang login. ----
    if (body.type === 'updateMyFinding') {
      return _json(_updateMyFinding(body.findingId, body.username, body.fields));
    }

    // ---- (P6) mode: admin menjadikan foto perbaikan (after) sebagai foto standar/acuan
    //      untuk klausul (area+kategori) tertentu, lalu otomatis menaikkan versi config
    //      agar tersebar sebagai notifikasi pembaruan formulir ke seluruh asesor ----
    if (body.type === 'markAsStandard') {
      return _json(_markFindingAsStandard(body.findingId));
    }

    // ---- (P-concern2) mode: admin membatalkan status "Dijadikan Standar" pada temuan ini.
    //      Menghapus entri fotoStandar terkait dari config_master dan menaikkan versi
    //      supaya seluruh asesor juga berhenti melihat foto acuan yang dibatalkan ----
    if (body.type === 'unmarkAsStandard') {
      return _json(_unmarkFindingAsStandard(body.findingId));
    }

    // ============================================================
    //  (P-galeri) GALERI FOTO STANDAR PER-PU — kelola manual oleh admin
    // ============================================================
    // Admin mengunggah foto standar manual untuk PU tertentu (masuk galeri, FIFO
    // sama seperti otomatis) — dipakai dari tab Foto Standar.
    if (body.type === 'uploadGaleriFoto') {
      return _json(_uploadGaleriFoto(body.areaId, body.aspek, body.pu, body.dataUrl));
    }
    // Admin menghapus satu foto tertentu dari galeri (dicocokkan lewat URL persis).
    if (body.type === 'deleteGaleriFoto') {
      return _json(_deleteGaleriFoto(body.areaId, body.aspek, body.pu, body.url));
    }
    // Admin menandai notifikasi FIFO sebagai telah dibaca (badge di tab Foto Standar).
    if (body.type === 'markGaleriNotifDibaca') {
      return _json(_markGaleriNotifDibaca());
    }

    // ============================================================
    //  (P-uid) SISTEM AKUN ASESOR — login, kelola akun oleh admin
    // ============================================================
    // Password TIDAK PERNAH dikirim/disimpan plain text — app.js meng-hash
    // dengan SHA-256 sebelum mengirim, dan yang dibandingkan/disimpan di
    // sini juga selalu hash. Endpoint ini tetap mensyaratkan SHARED_SECRET
    // (sudah dicek di baris paling atas doPost) sebagai pembatas akses API
    // dasar — bukan pengganti verifikasi password itu sendiri.
    if (body.type === 'login') {
      return _json(_loginUser(body.username, body.passwordHash));
    }
    if (body.type === 'registerUser') {
      return _json(_registerUser(body.username, body.namaLengkap, body.passwordHash, body.dibuatOleh));
    }
    if (body.type === 'resetPassword') {
      return _json(_resetUserPassword(body.username, body.passwordHash));
    }
    if (body.type === 'setUserActive') {
      return _json(_setUserActive(body.username, body.aktif));
    }

    var ss = _getSheet();
    var sData    = _tab(ss, SHEET_DATA,    HEAD_DATA);
    var sDetail  = _tab(ss, SHEET_DETAIL,  HEAD_DETAIL);
    var sTemuan  = _tab(ss, SHEET_TEMUAN,  HEAD_TEMUAN);
    _tab(ss, SHEET_RIWAYAT, HEAD_RIWAYAT); // pastikan tab riwayat tersedia

    var rec = body.record;            // satu assessment
    var tj = _tahunJenis(rec);        // { tahun, jenis }
    var configVer = body.configVersion || 1;
    var nowStr = new Date().toISOString();

    // ---- folder foto per sesi (apabila terdapat foto) ----
    // (P-galeri) rec.photos = Foto Good Condition, rec.photosTemuan = Foto Not Good/Temuan
    // (BARU) — keduanya di-backup ke folder Drive yang sama, dengan prefix key pembeda
    // supaya nama file tidak bentrok dan tetap bisa dibedakan saat dilihat manual di Drive.
    var folderUrl = '';
    var photosGabung = {};
    for (var pgKey in (rec.photos || {})) photosGabung['good__' + pgKey] = rec.photos[pgKey];
    for (var ptKey in (rec.photosTemuan || {})) photosGabung['temuan__' + ptKey] = rec.photosTemuan[ptKey];
    // Foto temuan safety (K3) ikut di-backup ke folder Drive sesi, prefix 'safety__'
    (body.safetyFindings || []).forEach(function(sf, i){
      if (sf && sf.foto) photosGabung['safety__' + (sf.id || i)] = [sf.foto];
    });
    var photoCount = _countPhotos(photosGabung);
    if (photoCount > 0) {
      var parent = _getFolder();
      var sub = parent.createFolder(rec.id + '_' + (rec.pu||'') + '_' + (rec.loc||'') + '_' + Date.now());
      _savePhotos(photosGabung, sub);
      folderUrl = sub.getUrl();
    }

    // ---- UPSERT baris ringkasan (mencari ID Sesi pada kolom A) ----
    var idCol = sData.getRange(2, 1, Math.max(sData.getLastRow()-1,1), 1).getValues();
    var foundRow = -1, syncCount = 1;
    for (var r = 0; r < idCol.length; r++) {
      if (idCol[r][0] === rec.id) { foundRow = r + 2; break; }
    }

    // ---- (P3) Deteksi DOUBLE PENGISIAN: kombinasi PU+Lokasi+Periode+Tahun+Jenis yang SAMA
    //      namun berasal dari ID Sesi BERBEDA (berarti diisi oleh asesor lain / device lain) ----
    var dupInfo = _cekDoublePengisian(sData, rec, tj, foundRow);

    var rowVals = [
      rec.id, 0, nowStr, configVer, rec.pu||'', rec.loc||'', rec.periode||'',
      rec.asesor||'', rec.date||'', (rec.avg!=null?rec.avg:''),
      body.predikat||'', (rec.findings? rec.findings.length:0), folderUrl,
      tj.tahun, tj.jenis, rec.asesorUsername||''
    ];
    if (foundRow > 0) {
      var prevCount = sData.getRange(foundRow, 2).getValue();
      syncCount = (Number(prevCount)||0) + 1;
      rowVals[1] = syncCount;
      if (!folderUrl) rowVals[12] = sData.getRange(foundRow, 13).getValue(); // pertahankan Folder Foto sebelumnya
      sData.getRange(foundRow, 1, 1, rowVals.length).setValues([rowVals]);
    } else {
      rowVals[1] = 1;
      sData.appendRow(rowVals);
    }

    // ---- DETAIL: hapus baris lama untuk ID ini, lalu tulis ulang ----
    _deleteDetailRows(sDetail, rec.id);
    if (body.detail && body.detail.length) {
      var rows = body.detail.map(function(d){
        return [rec.id, rec.pu||'', rec.loc||'', d.area, d.aspek, d.no, d.klausul, d.jawaban, d.skor,
                tj.tahun, tj.jenis];
      });
      sDetail.getRange(sDetail.getLastRow()+1, 1, rows.length, rows[0].length).setValues(rows);
    }

    // ---- Deteksi temuan berulang: bandingkan dengan histori PU+Lokasi+Area+Kategori
    //      pada sesi-sesi SEBELUMNYA (ID Sesi berbeda) yang berstatus Open/Close ----
    var historyKeys = _findingHistoryKeys(sTemuan, rec.id, rec.pu, rec.loc);

    // ---- TEMUAN: simpan status & penyebab lama (mungkin telah diubah admin),
    //      hapus baris sesi ini, lalu tulis ulang ----
    var oldData = _oldTemuanMap(sTemuan, rec.id); // {idTemuan: {status, penyebab, standar}}
    _deleteTemuanRows(sTemuan, rec.id);
    if (body.findings && body.findings.length) {
      var trows = body.findings.map(function(f){
        var prev = oldData[f.id] || {};
        var st = prev.status || f.status || 'Open';       // pertahankan status yang sudah diubah admin
        var penyebab = f.penyebab || prev.penyebab || '';  // penyebab (root cause)
        var key = (f.area||'') + '|' + (f.kategori||'');
        var berulang = historyKeys[key] ? 'Ya' : 'Tidak';
        var fotoT = _clampCell(f.foto || '');
        var fotoP = _clampCell(f.fotoPerbaikan || '');
        var standar = prev.standar || 'Tidak'; // pertahankan penanda "dijadikan standar" agar tidak hilang saat re-sync
        return [f.id, rec.id, rec.pu||'', rec.loc||'', rec.periode||'', rec.asesor||'',
                f.area||'', f.kategori||'', f.skor||'', f.deskripsi||'', f.saran||'',
                f.target||'', f.deskPerbaikan||'', f.tglPerbaikan||'', st, f.verifikator||'', folderUrl,
                penyebab, berulang, fotoT, fotoP, standar, f.areaId||'', rec.asesorUsername||''];
      });
      sTemuan.getRange(sTemuan.getLastRow()+1, 1, trows.length, trows[0].length).setValues(trows);
    }

    // ---- TEMUAN SAFETY (K3): upsert per sesi (hapus baris sesi ini, tulis ulang) ----
    // Kolom tindak lanjut yang sudah diisi admin (Status s/d Foto Perbaikan) DIPERTAHANKAN
    // walau asesor sinkron ulang sesinya.
    var sSafety = _tab(ss, SHEET_SAFETY, HEAD_SAFETY);
    var oldSafety = _oldSafetyMap(sSafety, rec.id);
    _deleteSafetyRows(sSafety, rec.id);
    if (body.safetyFindings && body.safetyFindings.length) {
      var sfrows = body.safetyFindings.map(function(sf){
        var prev = oldSafety[sf.id] || {};
        var stS = prev.status || 'Open';
        return [ sf.id, rec.id, rec.pu||'', rec.loc||'', rec.periode||'', tj.tahun, rec.asesor||'', rec.asesorUsername||'',
                 sf.kategori||'', sf.lokasi||'', sf.deskripsi||'', sf.tanggal||'',
                 stS, prev.deskPerbaikan||'', prev.tglPerbaikan||'', prev.verifikator||'',
                 _clampCell(sf.foto||''), _clampCell(prev.fotoPerbaikan||''), folderUrl ];
      });
      sSafety.getRange(sSafety.getLastRow()+1, 1, sfrows.length, sfrows[0].length).setValues(sfrows);
    }

    // ---- (P-galeri) Auto-masuk galeri foto standar dari foto Good Condition ----
    // Setiap assessment yang disinkronkan otomatis menyumbang foto Good Condition-nya
    // (kalau ada) ke galeri foto standar PU yang bersangkutan, FIFO maks 3 foto per PU
    // per area+aspek. Ini TIDAK menunggu approval admin — supaya asesor tidak terhambat
    // saat sync; admin cukup mendapat notifikasi pasif (lihat _tambahFotoGaleri) dan bisa
    // menghapus foto yang kurang cocok kapan saja lewat tab Foto Standar.
    if (rec.photos && rec.pu) {
      var cfgGaleri = _readConfig() || {};
      var galeriBerubah = false;
      for (var pkey in rec.photos) {
        var arr = rec.photos[pkey] || [];
        if (!arr.length) continue;
        var parts = pkey.split('|'); // format: "areaId|aspek"
        var gAreaId = parts[0], gAspek = parts[1];
        if (!gAreaId || !gAspek) continue;
        // Ambil foto PERTAMA dari aspek ini sebagai representasi Good Condition
        _tambahFotoGaleri(cfgGaleri, gAreaId, gAspek, rec.pu, {
          url: arr[0], source: 'assessment', sourceLabel: 'penilaian ' + (rec.loc||'') + ' (' + (rec.date||'') + ')', tanggal: nowStr
        });
        galeriBerubah = true;
      }
      if (galeriBerubah) { cfgGaleri.version = (cfgGaleri.version || 1) + 1; _writeConfig(cfgGaleri); configVer = cfgGaleri.version; }
    }

    return _json({ok:true, id:rec.id, photos:photoCount, folder:folderUrl, syncCount:syncCount,
                  safety:(body.safetyFindings||[]).length, duplicateWarning:dupInfo});
  } catch (err) {
    return _json({ok:false, error:String(err)});
  }
}

// ============================================================
//  (P3) DETEKSI DOUBLE PENGISIAN oleh asesor/device berbeda
// ============================================================
// Mencari baris LAIN (ID Sesi berbeda dari sesi yang sedang disinkronkan)
// dengan kombinasi PU+Lokasi+Periode+Tahun+Jenis yang sama persis.
// Kalau ditemukan, berarti ada dua asesor/dua device yang menilai kombinasi
// yang sama pada periode yang sama — dikembalikan sebagai info ke app.js
// supaya bisa ditampilkan sebagai notifikasi kepada asesor & admin.
function _cekDoublePengisian(sData, rec, tj, foundRow) {
  var last = sData.getLastRow();
  if (last < 2) return null;
  var vals = sData.getRange(2, 1, last - 1, sData.getLastColumn()).getValues();
  var head = sData.getRange(1, 1, 1, sData.getLastColumn()).getValues()[0];
  var iId = head.indexOf('ID Sesi'), iPU = head.indexOf('PU'), iLoc = head.indexOf('Lokasi'),
      iPer = head.indexOf('Periode'), iAsesor = head.indexOf('Asesor'),
      iTahun = head.indexOf('Tahun'), iJenis = head.indexOf('Jenis');
  for (var r = 0; r < vals.length; r++) {
    var row = vals[r];
    if (row[iId] === rec.id) continue; // baris sesi ini sendiri (upsert normal), bukan double
    var sameCombo = (row[iPU] === (rec.pu||'')) && (row[iLoc] === (rec.loc||'')) &&
                     (row[iPer] === (rec.periode||'')) &&
                     (String(row[iTahun]) === String(tj.tahun)) &&
                     (row[iJenis] === tj.jenis);
    if (sameCombo) {
      return {
        pu: rec.pu||'', loc: rec.loc||'', periode: rec.periode||'', tahun: tj.tahun, jenis: tj.jenis,
        asesorLain: row[iAsesor] || '(tidak diketahui)', idSesiLain: row[iId] || ''
      };
    }
  }
  return null;
}

// ============================================================
//  (P-galeri) GALERI FOTO STANDAR PER-PU — helper terpusat
// ============================================================
// Struktur baru: cfg.fotoStandar = { [areaId]: { [aspek]: { [pu]: [ {url, source,
// sourceLabel, tanggal}, ... maksimal GALERI_MAX_PER_PU, FIFO — foto terlama
// otomatis tergantikan foto terbaru ] } } }
// 'source' salah satu dari: 'admin' (unggah manual), 'assessment' (foto Good
// Condition otomatis dari sesi yang disinkronkan), 'temuan' (foto perbaikan
// otomatis saat temuan ditutup/closed).
var GALERI_MAX_PER_PU = 3;

// Menambahkan satu foto ke galeri PU tertentu, FIFO otomatis kalau sudah penuh.
// Mengembalikan {added:true, evicted:<foto lama yang tergantikan, atau null>}
function _tambahFotoGaleri(cfg, areaKey, aspek, pu, fotoEntry) {
  cfg.fotoStandar = cfg.fotoStandar || {};
  cfg.fotoStandar[areaKey] = cfg.fotoStandar[areaKey] || {};
  cfg.fotoStandar[areaKey][aspek] = cfg.fotoStandar[areaKey][aspek] || {};
  var galeri = cfg.fotoStandar[areaKey][aspek][pu] || [];
  var evicted = null;
  if (galeri.length >= GALERI_MAX_PER_PU) {
    evicted = galeri.shift(); // buang yang TERLAMA (FIFO)
  }
  galeri.push(fotoEntry);
  cfg.fotoStandar[areaKey][aspek][pu] = galeri;
  // (P-notif) catat notifikasi pasif untuk admin — dilihat kapan saja saat buka tab Foto Standar
  if (evicted) {
    cfg.fotoStandarNotif = cfg.fotoStandarNotif || [];
    cfg.fotoStandarNotif.push({
      areaKey: areaKey, aspek: aspek, pu: pu,
      pesan: 'Storage foto standar ' + pu + ' — ' + aspek + ' telah penuh (maks ' + GALERI_MAX_PER_PU + '). Foto terlama otomatis digantikan foto baru dari ' + (fotoEntry.sourceLabel || fotoEntry.source) + '.',
      tanggal: new Date().toISOString(), dibaca: false
    });
    // Batasi riwayat notifikasi agar config tidak membengkak tanpa batas
    if (cfg.fotoStandarNotif.length > 50) cfg.fotoStandarNotif = cfg.fotoStandarNotif.slice(-50);
  }
  return { added: true, evicted: evicted };
}

// Admin mengunggah foto standar secara manual untuk PU tertentu — masuk galeri
// dengan mekanisme FIFO yang sama seperti otomatis.
function _uploadGaleriFoto(areaId, aspek, pu, dataUrl) {
  try {
    if (!areaId || !aspek || !pu || !dataUrl) return {ok:false, error:'data tidak lengkap'};
    var cfg = _readConfig() || {};
    var hasil = _tambahFotoGaleri(cfg, areaId, aspek, pu, {
      url: dataUrl, source: 'admin', sourceLabel: 'unggahan manual admin', tanggal: new Date().toISOString()
    });
    cfg.version = (cfg.version || 1) + 1;
    _writeConfig(cfg);
    return {ok:true, configVersion: cfg.version, evicted: !!hasil.evicted};
  } catch (e) { return {ok:false, error:String(e)}; }
}
// Admin menghapus satu foto tertentu dari galeri PU (dicocokkan lewat URL persis).
function _deleteGaleriFoto(areaId, aspek, pu, url) {
  try {
    var cfg = _readConfig() || {};
    cfg.fotoStandar = cfg.fotoStandar || {};
    var galeri = (cfg.fotoStandar[areaId] && cfg.fotoStandar[areaId][aspek] && cfg.fotoStandar[areaId][aspek][pu]) || [];
    var idx = galeri.findIndex(function(g){ return g.url === url; });
    if (idx === -1) return {ok:false, error:'foto tidak ditemukan pada galeri'};
    galeri.splice(idx, 1);
    cfg.fotoStandar[areaId][aspek][pu] = galeri;
    cfg.version = (cfg.version || 1) + 1;
    _writeConfig(cfg);
    return {ok:true, configVersion: cfg.version};
  } catch (e) { return {ok:false, error:String(e)}; }
}
// Menandai seluruh notifikasi FIFO sebagai telah dibaca admin (badge dihilangkan).
function _markGaleriNotifDibaca() {
  try {
    var cfg = _readConfig() || {};
    (cfg.fotoStandarNotif || []).forEach(function(n){ n.dibaca = true; });
    _writeConfig(cfg);
    return {ok:true};
  } catch (e) { return {ok:false, error:String(e)}; }
}

// ============================================================
//  (P6) JADIKAN FOTO PERBAIKAN SEBAGAI STANDAR/ACUAN KLAUSUL (manual, oleh admin)
// ============================================================
// Menandai satu temuan sebagai sumber foto standar, menambahkan fotonya ke
// galeri PU yang bersangkutan di config_master.json, lalu menaikkan versi
// config supaya seluruh asesor menerima pembaruan saat online berikutnya.
function _markFindingAsStandard(findingId) {
  try {
    var ss = _getSheet();
    var sh = ss.getSheetByName(SHEET_TEMUAN);
    if (!sh || sh.getLastRow() < 2) return {ok:false, error:'belum ada temuan'};
    var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var iArea = head.indexOf('Area'), iAreaId = head.indexOf('Area ID'), iKat = head.indexOf('Kategori'),
        iFotoP = head.indexOf('Foto Perbaikan (DataURL)'), iStandar = head.indexOf('Dijadikan Standar'),
        iPU = head.indexOf('PU');
    var last = sh.getLastRow();
    var vals = sh.getRange(2, 1, last-1, sh.getLastColumn()).getValues();
    for (var r = 0; r < vals.length; r++) {
      if (vals[r][0] === findingId) {
        var area = vals[r][iArea], areaId = iAreaId > -1 ? vals[r][iAreaId] : '', kat = vals[r][iKat],
            fotoP = vals[r][iFotoP], pu = vals[r][iPU];
        if (!fotoP) return {ok:false, error:'temuan ini belum memiliki foto perbaikan (after)'};
        if (!pu) return {ok:false, error:'temuan ini tidak memiliki data PU'};
        var cfg = _readConfig() || {};
        // (P-concern1) Utamakan Area ID yang tersimpan langsung di baris temuan — andal
        // walau nama area sudah berubah sejak temuan ini dicatat.
        var areaKey = areaId || '';
        if (!areaKey) {
          var areaObj = (cfg.areaChecks || []).find(function(a){ return a.name === area; });
          areaKey = areaObj ? areaObj.id : area;
        }
        var hasil = _tambahFotoGaleri(cfg, areaKey, kat, pu, {
          url: fotoP, source: 'temuan', sourceLabel: 'penutupan temuan ' + findingId, tanggal: new Date().toISOString()
        });
        cfg.version = (cfg.version || 1) + 1;
        _writeConfig(cfg);
        if (iStandar > -1) sh.getRange(r + 2, iStandar + 1).setValue('Ya');
        return {ok:true, findingId: findingId, area: area, kategori: kat, pu: pu, configVersion: cfg.version, evicted: !!hasil.evicted};
      }
    }
    return {ok:false, error:'temuan tidak ditemukan'};
  } catch (e) { return {ok:false, error:String(e)}; }
}

// (P-concern2) Batalkan penanda "Dijadikan Standar" — menghapus foto yang bersangkutan
// dari galeri PU di config_master.json (mencocokkan URL persis agar tidak salah hapus
// foto lain), lalu naikkan versi config.
function _unmarkFindingAsStandard(findingId) {
  try {
    var ss = _getSheet();
    var sh = ss.getSheetByName(SHEET_TEMUAN);
    if (!sh || sh.getLastRow() < 2) return {ok:false, error:'belum ada temuan'};
    var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var iArea = head.indexOf('Area'), iAreaId = head.indexOf('Area ID'), iKat = head.indexOf('Kategori'),
        iFotoP = head.indexOf('Foto Perbaikan (DataURL)'), iStandar = head.indexOf('Dijadikan Standar'),
        iPU = head.indexOf('PU');
    var last = sh.getLastRow();
    var vals = sh.getRange(2, 1, last-1, sh.getLastColumn()).getValues();
    for (var r = 0; r < vals.length; r++) {
      if (vals[r][0] === findingId) {
        var area = vals[r][iArea], areaId = iAreaId > -1 ? vals[r][iAreaId] : '', kat = vals[r][iKat],
            fotoP = vals[r][iFotoP], pu = vals[r][iPU];
        var cfg = _readConfig() || {};
        cfg.fotoStandar = cfg.fotoStandar || {};
        var areaKey = areaId || area;
        var galeri = (cfg.fotoStandar[areaKey] && cfg.fotoStandar[areaKey][kat] && cfg.fotoStandar[areaKey][kat][pu]) || [];
        var idx = galeri.findIndex(function(g){ return g.url === fotoP; });
        if (idx > -1) {
          galeri.splice(idx, 1);
          cfg.fotoStandar[areaKey][kat][pu] = galeri;
          cfg.version = (cfg.version || 1) + 1;
          _writeConfig(cfg);
        }
        if (iStandar > -1) sh.getRange(r + 2, iStandar + 1).setValue('Tidak');
        return {ok:true, findingId: findingId, configVersion: cfg.version};
      }
    }
    return {ok:false, error:'temuan tidak ditemukan'};
  } catch (e) { return {ok:false, error:String(e)}; }
}

function _deleteDetailRows(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return;
  var ids = sh.getRange(2, 1, last-1, 1).getValues();
  for (var r = ids.length - 1; r >= 0; r--) {
    if (ids[r][0] === id) sh.deleteRow(r + 2);
  }
}

// ============================================================
//  DETEKSI TEMUAN BERULANG
// ============================================================
// Mengumpulkan kombinasi (Area|Kategori) yang PERNAH tercatat sebagai
// temuan pada PU & Lokasi yang sama, dari ID Sesi SELAIN sesi saat ini.
// Digunakan untuk menandai temuan baru sebagai "Berulang" bila kombinasi
// tersebut sudah pernah muncul pada periode/tahun sebelumnya.
function _findingHistoryKeys(sh, currentSessionId, pu, loc) {
  var map = {};
  var last = sh.getLastRow();
  if (last < 2) return map;
  // Kolom: B=ID Sesi(1), C=PU(2), D=Lokasi(3), G=Area(6), H=Kategori(7) — index 0-based
  var vals = sh.getRange(2, 1, last-1, 19).getValues();
  for (var r = 0; r < vals.length; r++) {
    var row = vals[r];
    var sesiId = row[1], rPu = row[2], rLoc = row[3], area = row[6], kategori = row[7];
    if (sesiId === currentSessionId) continue;      // abaikan sesi yang sedang diproses
    if (rPu !== pu || rLoc !== loc) continue;        // hanya PU & Lokasi yang sama
    var key = (area||'') + '|' + (kategori||'');
    map[key] = true;
  }
  return map;
}

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || '';
    var secret = (e && e.parameter && e.parameter.secret) || '';
    if (action === 'list') {
      if (secret !== SHARED_SECRET) return _json({ok:false, error:'unauthorized'});
      return _json({ok:true, assessments:_listAssessments()});
    }
    if (action === 'config') {
      return _json({ok:true, config:_readConfig()});
    }
    if (action === 'findings') {
      if (secret !== SHARED_SECRET) return _json({ok:false, error:'unauthorized'});
      return _json({ok:true, findings:_listTemuan()});
    }
    // (Safety K3) Daftar seluruh temuan safety untuk Dashboard Safety admin
    if (action === 'safetyFindings') {
      if (secret !== SHARED_SECRET) return _json({ok:false, error:'unauthorized'});
      return _json({ok:true, safety:_listSafety()});
    }
    // (Safety K3) Foto before/after untuk SATU temuan safety — diambil on-demand
    if (action === 'safetyPhotos') {
      if (secret !== SHARED_SECRET) return _json({ok:false, error:'unauthorized'});
      return _json(Object.assign({ok:true}, _getSafetyPhotos(e.parameter.safetyId || '')));
    }
    // (P-closing) Temuan milik SATU asesor tertentu (untuk menu "Temuan Saya") — difilter
    // di server berdasarkan Asesor Username, bukan nama, supaya akurat walau ada nama sama.
    if (action === 'myFindings') {
      if (secret !== SHARED_SECRET) return _json({ok:false, error:'unauthorized'});
      var muUsername = (e.parameter.username || '');
      return _json({ok:true, findings:_listTemuan().filter(function(f){ return f['Asesor Username'] === muUsername; })});
    }
    // (P-perf) Foto before/after untuk SATU temuan, diambil terpisah dari listing utama
    if (action === 'findingPhotos') {
      if (secret !== SHARED_SECRET) return _json({ok:false, error:'unauthorized'});
      var fpId = (e.parameter.findingId || '');
      return _json(Object.assign({ok:true}, _getFindingPhotos(fpId)));
    }
    if (action === 'trend') {
      return _json({ok:true, trend:getTrendSummary()});
    }
    if (action === 'riwayatStatus') {
      // Riwayat perubahan status untuk satu ID Temuan tertentu (jejak audit)
      if (secret !== SHARED_SECRET) return _json({ok:false, error:'unauthorized'});
      var fId = (e.parameter.findingId || '');
      return _json({ok:true, riwayat:_getRiwayatStatus(fId)});
    }
    // (P-uid) Daftar akun asesor untuk menu admin "Kelola Asesor" (tanpa password hash)
    if (action === 'listUsers') {
      if (secret !== SHARED_SECRET) return _json({ok:false, error:'unauthorized'});
      return _json({ok:true, users:_listUsers()});
    }
    if (action === 'debugid') {
      return _json({ok:true, sheet_id:SHEET_ID, folder_id:FOLDER_ID});
    }
    return _json({ok:true, service:'Assesment 5R backend', time:new Date().toISOString()});
  } catch (err) {
    return _json({ok:false, error:String(err)});
  }
}

function _listAssessments() {
  var ss = _getSheet();
  var sh = ss.getSheetByName(SHEET_DATA);
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var head = vals[0];
  var out = [];
  for (var r = 1; r < vals.length; r++) {
    var o = {};
    for (var c = 0; c < head.length; c++) o[head[c]] = vals[r][c];
    out.push(o);
  }
  return out;
}

// ---- Bantuan pengolahan TEMUAN ----
function _oldTemuanMap(sh, sesiId) {
  // Mengembalikan {idTemuan: {status, penyebab, standar}} untuk baris lama pada sesi ini,
  // agar status/penyebab/penanda-standar yang sudah diedit admin tidak tertimpa saat sinkron ulang.
  var map = {};
  var last = sh.getLastRow();
  if (last < 2) return map;
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var iStatus = head.indexOf('Status');
  var iPenyebab = head.indexOf('Penyebab');
  var iStandar = head.indexOf('Dijadikan Standar');
  var vals = sh.getRange(2, 1, last-1, sh.getLastColumn()).getValues();
  for (var r = 0; r < vals.length; r++) {
    if (vals[r][1] === sesiId) {
      map[vals[r][0]] = {
        status: iStatus > -1 ? vals[r][iStatus] : '',
        penyebab: iPenyebab > -1 ? vals[r][iPenyebab] : '',
        standar: iStandar > -1 ? vals[r][iStandar] : ''
      };
    }
  }
  return map;
}
// (P6) Batasi panjang dataURL foto agar aman ditulis ke satu sel Sheets.
// Kalau kelebihan panjang, foto dilewatkan (kosong) daripada bikin request gagal total —
// folder Drive tetap menyimpan foto aslinya sebagai cadangan (lihat Folder Foto).
function _clampCell(dataUrl) {
  if (!dataUrl) return '';
  if (dataUrl.length <= MAX_CELL_CHARS) return dataUrl;
  return ''; // terlalu besar untuk 1 sel — foto tetap tersimpan di Drive via folderUrl
}
function _deleteTemuanRows(sh, sesiId) {
  var last = sh.getLastRow();
  if (last < 2) return;
  var ids = sh.getRange(2, 2, last-1, 1).getValues(); // kolom B = ID Sesi
  for (var r = ids.length - 1; r >= 0; r--) {
    if (ids[r][0] === sesiId) sh.deleteRow(r + 2);
  }
}
// (P-perf) Kolom yang SENGAJA dikecualikan dari listing utama karena berisi dataURL
// foto yang bisa besar — supaya _listTemuan/_listAssessments tetap ringan saat
// jumlah temuan bertambah banyak. Foto diambil terpisah, on-demand, lewat
// action=findingPhotos hanya saat modal rincian temuan dibuka.
var TEMUAN_KOLOM_FOTO = ['Foto Temuan (DataURL)', 'Foto Perbaikan (DataURL)'];

function _listTemuan() {
  var ss = _getSheet();
  var sh = ss.getSheetByName(SHEET_TEMUAN);
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var head = vals[0];
  var out = [];
  for (var r = 1; r < vals.length; r++) {
    var o = {};
    for (var c = 0; c < head.length; c++) {
      if (TEMUAN_KOLOM_FOTO.indexOf(head[c]) > -1) continue; // skip kolom foto — hemat payload
      o[head[c]] = vals[r][c];
    }
    // penanda ringan: apakah temuan ini punya foto, tanpa mengirim isi fotonya
    var iFotoT = head.indexOf('Foto Temuan (DataURL)'), iFotoP = head.indexOf('Foto Perbaikan (DataURL)');
    o['_adaFotoTemuan'] = iFotoT > -1 ? !!vals[r][iFotoT] : false;
    o['_adaFotoPerbaikan'] = iFotoP > -1 ? !!vals[r][iFotoP] : false;
    out.push(o);
  }
  return out;
}

// (P-perf) Ambil dataURL foto (before/after) untuk SATU temuan saja — dipanggil
// on-demand saat admin membuka modal rincian temuan, bukan saat listing.
function _getFindingPhotos(findingId) {
  var ss = _getSheet();
  var sh = ss.getSheetByName(SHEET_TEMUAN);
  if (!sh || sh.getLastRow() < 2) return {foto:'', fotoPerbaikan:''};
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var iId = head.indexOf('ID Temuan'), iFotoT = head.indexOf('Foto Temuan (DataURL)'), iFotoP = head.indexOf('Foto Perbaikan (DataURL)');
  var last = sh.getLastRow();
  var ids = sh.getRange(2, iId + 1, last - 1, 1).getValues();
  for (var r = 0; r < ids.length; r++) {
    if (ids[r][0] === findingId) {
      var rowNum = r + 2;
      return {
        foto: iFotoT > -1 ? (sh.getRange(rowNum, iFotoT + 1).getValue() || '') : '',
        fotoPerbaikan: iFotoP > -1 ? (sh.getRange(rowNum, iFotoP + 1).getValue() || '') : ''
      };
    }
  }
  return {foto:'', fotoPerbaikan:''};
}

// Memperbarui status temuan DAN mencatat perubahan ke tab RiwayatStatus (jejak audit — BARU)
function _updateTemuanStatus(findingId, status, verifikator) {
  try {
    var ss = _getSheet();
    var sh = ss.getSheetByName(SHEET_TEMUAN);
    if (!sh || sh.getLastRow() < 2) return {ok:false, error:'belum ada temuan'};
    var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var iStatus = head.indexOf('Status');
    var ids = sh.getRange(2, 1, sh.getLastRow()-1, 1).getValues(); // kolom A = ID Temuan
    for (var r = 0; r < ids.length; r++) {
      if (ids[r][0] === findingId) {
        var rowNum = r + 2;
        var sesiId = sh.getRange(rowNum, 2).getValue();
        var statusLama = sh.getRange(rowNum, iStatus+1).getValue();
        sh.getRange(rowNum, iStatus+1).setValue(status);
        _catatRiwayatStatus(findingId, sesiId, statusLama, status, verifikator || '');
        return {ok:true, findingId:findingId, status:status};
      }
    }
    return {ok:false, error:'temuan tidak ditemukan'};
  } catch (e) { return {ok:false, error:String(e)}; }
}
function _updateTemuanFields(findingId, fields, verifikator) {
  try {
    var ss = _getSheet();
    var sh = ss.getSheetByName(SHEET_TEMUAN);
    if (!sh || sh.getLastRow() < 2) return {ok:false, error:'belum ada temuan'};
    var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var iStatus = head.indexOf('Status'), iFotoP = head.indexOf('Foto Perbaikan (DataURL)'),
        iAreaId = head.indexOf('Area ID'), iArea = head.indexOf('Area'), iKat = head.indexOf('Kategori'), iPU = head.indexOf('PU');
    var last = sh.getLastRow();
    var vals = sh.getRange(2, 1, last-1, sh.getLastColumn()).getValues();
    for (var r = 0; r < vals.length; r++) {
      if (vals[r][0] === findingId) {
        var rowNum = r + 2;
        var statusLama = iStatus > -1 ? vals[r][iStatus] : '';
        // jika field Status ikut diubah lewat updateFinding, catat juga ke riwayat
        if (fields && Object.prototype.hasOwnProperty.call(fields, 'Status') && iStatus > -1) {
          var sesiId = vals[r][1];
          if (statusLama !== fields['Status']) {
            _catatRiwayatStatus(findingId, sesiId, statusLama, fields['Status'], verifikator || '');
          }
        }
        for (var key in fields) {
          var col = head.indexOf(key);
          if (col >= 0) sh.getRange(rowNum, col+1).setValue(fields[key]);
        }
        // (P-galeri) Sama seperti closing oleh asesor: kalau admin mengubah status
        // menjadi Close dan ada foto perbaikan, otomatis masuk galeri foto standar.
        var configVersionBaru = null;
        var fotoUntukGaleri = (fields && fields['Foto Perbaikan (DataURL)']) || (iFotoP > -1 ? vals[r][iFotoP] : '');
        var statusBaru = (fields && fields['Status']) || statusLama;
        if (statusBaru === 'Close' && statusLama !== 'Close' && fotoUntukGaleri) {
          var gAreaId = iAreaId > -1 ? vals[r][iAreaId] : '', gArea = iArea > -1 ? vals[r][iArea] : '',
              gKat = iKat > -1 ? vals[r][iKat] : '', gPU = iPU > -1 ? vals[r][iPU] : '';
          if (gPU && gKat) {
            var cfgG = _readConfig() || {};
            var areaKeyG = gAreaId || '';
            if (!areaKeyG) {
              var areaObjG = (cfgG.areaChecks || []).find(function(a){ return a.name === gArea; });
              areaKeyG = areaObjG ? areaObjG.id : gArea;
            }
            _tambahFotoGaleri(cfgG, areaKeyG, gKat, gPU, {
              url: fotoUntukGaleri, source: 'temuan', sourceLabel: 'penutupan temuan oleh admin (' + (verifikator||'Admin') + ')', tanggal: new Date().toISOString()
            });
            cfgG.version = (cfgG.version || 1) + 1;
            _writeConfig(cfgG);
            configVersionBaru = cfgG.version;
          }
        }
        return {ok:true, findingId:findingId, configVersion: configVersionBaru};
      }
    }
    return {ok:false, error:'temuan tidak ditemukan'};
  } catch (e) { return {ok:false, error:String(e)}; }
}

// (P-closing) Asesor menutup temuan MILIKNYA SENDIRI. Kepemilikan divalidasi di sini
// (server), bukan cuma dipercaya dari parameter yang dikirim client — mencegah asesor
// mengedit temuan asesor lain walau tahu ID Temuan-nya. Field yang boleh diubah asesor
// dibatasi ketat (whitelist) — target/penyebab tetap murni domain admin di Monitoring Temuan.
var MY_FINDING_ALLOWED_FIELDS = ['Deskripsi Perbaikan', 'Tgl Perbaikan', 'Status', 'Foto Perbaikan (DataURL)', 'Verifikator'];
function _updateMyFinding(findingId, username, fields) {
  try {
    if (!username) return {ok:false, error:'sesi tidak valid, silakan login ulang'};
    var ss = _getSheet();
    var sh = ss.getSheetByName(SHEET_TEMUAN);
    if (!sh || sh.getLastRow() < 2) return {ok:false, error:'belum ada temuan'};
    var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var iId = head.indexOf('ID Temuan'), iUser = head.indexOf('Asesor Username'), iStatus = head.indexOf('Status'),
        iFotoP = head.indexOf('Foto Perbaikan (DataURL)'), iAreaId = head.indexOf('Area ID'),
        iArea = head.indexOf('Area'), iKat = head.indexOf('Kategori'), iPU = head.indexOf('PU');
    var last = sh.getLastRow();
    var vals = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
    for (var r = 0; r < vals.length; r++) {
      if (vals[r][iId] === findingId) {
        // ---- VALIDASI KEPEMILIKAN: baris ini harus milik username yang sedang login ----
        if (vals[r][iUser] !== username) {
          return {ok:false, error:'Anda tidak berwenang mengubah temuan ini — bukan temuan yang Anda buat.'};
        }
        var rowNum = r + 2;
        var statusLama = iStatus > -1 ? vals[r][iStatus] : '';
        var safeFields = {};
        for (var key in fields) {
          if (MY_FINDING_ALLOWED_FIELDS.indexOf(key) === -1) continue; // abaikan field di luar whitelist
          var col = head.indexOf(key);
          if (col < 0) continue;
          safeFields[key] = fields[key];
          if (key === 'Foto Perbaikan (DataURL)') safeFields[key] = _clampCell(fields[key] || '');
          sh.getRange(rowNum, col + 1).setValue(safeFields[key]);
        }
        if (safeFields['Status'] && safeFields['Status'] !== statusLama) {
          var sesiId = vals[r][1]; // kolom ID Sesi
          _catatRiwayatStatus(findingId, sesiId, statusLama, safeFields['Status'], username);
        }
        // (P-galeri) Temuan ditutup (Close) DAN memiliki foto perbaikan -> otomatis
        // masuk galeri foto standar PU yang bersangkutan (FIFO), tanpa perlu admin
        // menekan "Jadikan Foto Standar" secara manual.
        var configVersionBaru = null;
        var fotoUntukGaleri = safeFields['Foto Perbaikan (DataURL)'] || (iFotoP > -1 ? vals[r][iFotoP] : '');
        if (safeFields['Status'] === 'Close' && fotoUntukGaleri) {
          var gAreaId = iAreaId > -1 ? vals[r][iAreaId] : '', gArea = iArea > -1 ? vals[r][iArea] : '',
              gKat = iKat > -1 ? vals[r][iKat] : '', gPU = iPU > -1 ? vals[r][iPU] : '';
          if (gPU && gKat) {
            var cfgG = _readConfig() || {};
            var areaKeyG = gAreaId || '';
            if (!areaKeyG) {
              var areaObjG = (cfgG.areaChecks || []).find(function(a){ return a.name === gArea; });
              areaKeyG = areaObjG ? areaObjG.id : gArea;
            }
            _tambahFotoGaleri(cfgG, areaKeyG, gKat, gPU, {
              url: fotoUntukGaleri, source: 'temuan', sourceLabel: 'penutupan temuan oleh ' + username, tanggal: new Date().toISOString()
            });
            cfgG.version = (cfgG.version || 1) + 1;
            _writeConfig(cfgG);
            configVersionBaru = cfgG.version;
          }
        }
        return {ok:true, findingId: findingId, configVersion: configVersionBaru};
      }
    }
    return {ok:false, error:'temuan tidak ditemukan'};
  } catch (e) { return {ok:false, error:String(e)}; }
}

// ============================================================
//  RIWAYAT STATUS (JEJAK AUDIT) — BARU
// ============================================================
function _catatRiwayatStatus(findingId, sesiId, statusLama, statusBaru, diubahOleh) {
  var ss = _getSheet();
  var sh = _tab(ss, SHEET_RIWAYAT, HEAD_RIWAYAT);
  sh.appendRow([findingId, sesiId || '', statusLama || '', statusBaru || '', diubahOleh || '', new Date().toISOString()]);
}
function _getRiwayatStatus(findingId) {
  var ss = _getSheet();
  var sh = ss.getSheetByName(SHEET_RIWAYAT);
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var head = vals[0];
  var out = [];
  for (var r = 1; r < vals.length; r++) {
    if (!findingId || vals[r][0] === findingId) {
      var o = {};
      for (var c = 0; c < head.length; c++) o[head[c]] = vals[r][c];
      out.push(o);
    }
  }
  return out;
}

// ============================================================
//  TEMUAN SAFETY (K3) — helper
// ============================================================
// Peta baris safety lama untuk sesi ini → agar tindak lanjut yang sudah diisi admin
// tidak tertimpa saat asesor sinkron ulang. {idSafety: {status, deskPerbaikan, tglPerbaikan, verifikator, fotoPerbaikan}}
function _oldSafetyMap(sh, sesiId) {
  var map = {};
  var last = sh.getLastRow();
  if (last < 2) return map;
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var iId = head.indexOf('ID Safety'), iSesi = head.indexOf('ID Sesi'),
      iStatus = head.indexOf('Status'), iDP = head.indexOf('Deskripsi Perbaikan'),
      iTgl = head.indexOf('Tgl Perbaikan'), iVerif = head.indexOf('Verifikator'),
      iFP = head.indexOf('Foto Perbaikan (DataURL)');
  var vals = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  for (var r = 0; r < vals.length; r++) {
    if (vals[r][iSesi] === sesiId) {
      map[vals[r][iId]] = {
        status: iStatus > -1 ? vals[r][iStatus] : '',
        deskPerbaikan: iDP > -1 ? vals[r][iDP] : '',
        tglPerbaikan: iTgl > -1 ? vals[r][iTgl] : '',
        verifikator: iVerif > -1 ? vals[r][iVerif] : '',
        fotoPerbaikan: iFP > -1 ? vals[r][iFP] : ''
      };
    }
  }
  return map;
}
function _deleteSafetyRows(sh, sesiId) {
  var last = sh.getLastRow();
  if (last < 2) return;
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var iSesi = head.indexOf('ID Sesi');
  var ids = sh.getRange(2, iSesi + 1, last - 1, 1).getValues();
  for (var r = ids.length - 1; r >= 0; r--) {
    if (ids[r][0] === sesiId) sh.deleteRow(r + 2);
  }
}
function _listSafety() {
  var ss = _getSheet();
  var sh = ss.getSheetByName(SHEET_SAFETY);
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var head = vals[0];
  var iFotoT = head.indexOf('Foto Temuan (DataURL)'), iFotoP = head.indexOf('Foto Perbaikan (DataURL)');
  var out = [];
  for (var r = 1; r < vals.length; r++) {
    var o = {};
    for (var c = 0; c < head.length; c++) {
      if (SAFETY_KOLOM_FOTO.indexOf(head[c]) > -1) continue; // skip foto — hemat payload
      o[head[c]] = vals[r][c];
    }
    o['_adaFotoTemuan'] = iFotoT > -1 ? !!vals[r][iFotoT] : false;
    o['_adaFotoPerbaikan'] = iFotoP > -1 ? !!vals[r][iFotoP] : false;
    out.push(o);
  }
  return out;
}
function _getSafetyPhotos(safetyId) {
  var ss = _getSheet();
  var sh = ss.getSheetByName(SHEET_SAFETY);
  if (!sh || sh.getLastRow() < 2) return {foto:'', fotoPerbaikan:''};
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var iId = head.indexOf('ID Safety'), iFotoT = head.indexOf('Foto Temuan (DataURL)'), iFotoP = head.indexOf('Foto Perbaikan (DataURL)');
  var last = sh.getLastRow();
  var ids = sh.getRange(2, iId + 1, last - 1, 1).getValues();
  for (var r = 0; r < ids.length; r++) {
    if (ids[r][0] === safetyId) {
      var rowNum = r + 2;
      return {
        foto: iFotoT > -1 ? (sh.getRange(rowNum, iFotoT + 1).getValue() || '') : '',
        fotoPerbaikan: iFotoP > -1 ? (sh.getRange(rowNum, iFotoP + 1).getValue() || '') : ''
      };
    }
  }
  return {foto:'', fotoPerbaikan:''};
}
// Admin memperbarui tindak lanjut satu temuan safety. Perubahan Status dicatat ke
// tab RiwayatStatus (jejak audit) sama seperti Temuan 5R.
var SAFETY_ALLOWED_FIELDS = ['Status','Deskripsi Perbaikan','Tgl Perbaikan','Verifikator','Foto Perbaikan (DataURL)','Kategori','Lokasi Titik','Deskripsi'];
function _updateSafetyFields(safetyId, fields, verifikator) {
  try {
    if (!safetyId) return {ok:false, error:'safetyId kosong'};
    var ss = _getSheet();
    var sh = ss.getSheetByName(SHEET_SAFETY);
    if (!sh || sh.getLastRow() < 2) return {ok:false, error:'belum ada temuan safety'};
    var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var iId = head.indexOf('ID Safety'), iSesi = head.indexOf('ID Sesi'), iStatus = head.indexOf('Status');
    var last = sh.getLastRow();
    var vals = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
    for (var r = 0; r < vals.length; r++) {
      if (vals[r][iId] === safetyId) {
        var rowNum = r + 2;
        var statusLama = iStatus > -1 ? vals[r][iStatus] : '';
        if (fields && Object.prototype.hasOwnProperty.call(fields, 'Status') && iStatus > -1 && fields['Status'] !== statusLama) {
          _catatRiwayatStatus(safetyId, vals[r][iSesi], statusLama, fields['Status'], verifikator || '');
        }
        for (var key in fields) {
          if (SAFETY_ALLOWED_FIELDS.indexOf(key) === -1) continue;
          var col = head.indexOf(key);
          if (col < 0) continue;
          var v = fields[key];
          if (key === 'Foto Perbaikan (DataURL)') v = _clampCell(v || '');
          sh.getRange(rowNum, col + 1).setValue(v);
        }
        return {ok:true, safetyId: safetyId};
      }
    }
    return {ok:false, error:'temuan safety tidak ditemukan'};
  } catch (e) { return {ok:false, error:String(e)}; }
}


var CONFIG_FILE = 'config_master.json';
function _configFile(create) {
  var folder = _getFolder();
  var it = folder.getFilesByName(CONFIG_FILE);
  if (it.hasNext()) return it.next();
  if (create) return folder.createFile(CONFIG_FILE, '{}', 'application/json');
  return null;
}
function _readConfig() {
  var f = _configFile(false);
  if (!f) return null;
  try { return JSON.parse(f.getBlob().getDataAsString()); } catch (e) { return null; }
}
function _writeConfig(cfg) {
  var f = _configFile(true);
  f.setContent(JSON.stringify(cfg));
  return true;
}

// ---- fungsi bantuan umum ----
// ============================================================
//  (P-uid) FUNGSI AKUN ASESOR
// ============================================================
function _usersSheet() {
  var ss = _getSheet();
  return _tab(ss, SHEET_USERS, HEAD_USERS);
}
function _findUserRow(sh, username) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var usernames = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var r = 0; r < usernames.length; r++) {
    if (String(usernames[r][0]).toLowerCase() === String(username).toLowerCase()) return r + 2;
  }
  return -1;
}
// Verifikasi login: cocokkan hash password, dan pastikan akun berstatus Aktif.
function _loginUser(username, passwordHash) {
  try {
    if (!username || !passwordHash) return {ok:false, error:'username dan password wajib diisi'};
    var sh = _usersSheet();
    var row = _findUserRow(sh, username);
    if (row < 0) return {ok:false, error:'Username tidak ditemukan'};
    var vals = sh.getRange(row, 1, 1, HEAD_USERS.length).getValues()[0];
    var namaLengkap = vals[1], storedHash = vals[2], aktif = vals[3];
    if (aktif !== 'Ya') return {ok:false, error:'Akun ini telah dinonaktifkan. Hubungi admin.'};
    if (storedHash !== passwordHash) return {ok:false, error:'Password salah'};
    return {ok:true, username: username, namaLengkap: namaLengkap || username};
  } catch (e) { return {ok:false, error:String(e)}; }
}
// Admin mendaftarkan akun asesor baru. Username harus unik (tidak boleh dobel).
function _registerUser(username, namaLengkap, passwordHash, dibuatOleh) {
  try {
    if (!username || !passwordHash) return {ok:false, error:'username dan password wajib diisi'};
    var sh = _usersSheet();
    if (_findUserRow(sh, username) > -1) return {ok:false, error:'Username sudah terdaftar, gunakan username lain'};
    sh.appendRow([username, namaLengkap || username, passwordHash, 'Ya', dibuatOleh || 'Admin', new Date().toISOString(), '']);
    return {ok:true, username: username};
  } catch (e) { return {ok:false, error:String(e)}; }
}
// Admin mereset password akun asesor yang lupa password-nya.
function _resetUserPassword(username, passwordHash) {
  try {
    if (!username || !passwordHash) return {ok:false, error:'username dan password baru wajib diisi'};
    var sh = _usersSheet();
    var row = _findUserRow(sh, username);
    if (row < 0) return {ok:false, error:'Username tidak ditemukan'};
    sh.getRange(row, 3).setValue(passwordHash); // kolom Password Hash
    sh.getRange(row, 7).setValue(new Date().toISOString()); // kolom Direset Pada
    return {ok:true, username: username};
  } catch (e) { return {ok:false, error:String(e)}; }
}
// Admin mengaktifkan/menonaktifkan akun (tanpa menghapus barisnya — jejak tetap ada).
function _setUserActive(username, aktif) {
  try {
    var sh = _usersSheet();
    var row = _findUserRow(sh, username);
    if (row < 0) return {ok:false, error:'Username tidak ditemukan'};
    sh.getRange(row, 4).setValue(aktif ? 'Ya' : 'Tidak'); // kolom Aktif
    return {ok:true, username: username, aktif: aktif ? 'Ya' : 'Tidak'};
  } catch (e) { return {ok:false, error:String(e)}; }
}
// Daftar akun untuk ditampilkan di menu admin "Kelola Asesor" — TIDAK menyertakan
// Password Hash sama sekali, walau sudah di-hash, sebagai praktik keamanan berlapis.
function _listUsers() {
  var sh = _usersSheet();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, HEAD_USERS.length).getValues();
  return vals.map(function(r){
    return {username: r[0], namaLengkap: r[1], aktif: r[3], dibuatOleh: r[4], dibuatPada: r[5], diresetPada: r[6]};
  });
}

function _getSheet() {
  if (SHEET_ID) return SpreadsheetApp.openById(SHEET_ID);
  var ss = SpreadsheetApp.create('Assesment 5R - Data');
  Logger.log('SHEET_ID baru: ' + ss.getId());
  return ss;
}
function _getFolder() {
  if (FOLDER_ID) return DriveApp.getFolderById(FOLDER_ID);
  var f = DriveApp.createFolder('Assesment 5R - Foto');
  Logger.log('FOLDER_ID baru: ' + f.getId());
  return f;
}
// _tab: membuat tab apabila belum ada; apabila tab sudah ada namun header-nya
// belum lengkap (misalnya belum memiliki kolom Tahun/Jenis/Penyebab/Berulang),
// kolom yang belum ada akan ditambahkan secara otomatis di ujung kanan.
function _tab(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    return sh;
  }
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var cur = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var changed = false;
  for (var i = 0; i < headers.length; i++) {
    if (cur.indexOf(headers[i]) === -1) {
      cur.push(headers[i]);
      sh.getRange(1, cur.length).setValue(headers[i]);
      changed = true;
    }
  }
  if (changed) sh.setFrozenRows(1);
  return sh;
}
function _countPhotos(photos) {
  var n = 0; if (!photos) return 0;
  for (var k in photos) n += (photos[k]||[]).length;
  return n;
}
function _savePhotos(photos, folder) {
  for (var key in photos) {
    var arr = photos[key] || [];
    for (var i = 0; i < arr.length; i++) {
      var dataUrl = arr[i];
      var m = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl);
      if (!m) continue;
      var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1],
                  key.replace(/[^\w]/g,'_') + '_' + (i+1) + '.' + m[1].split('/')[1]);
      folder.createFile(blob);
    }
  }
}
function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  MULTI-TAHUN: MIGRASI & RINGKASAN TREN
// ============================================================

// Jalankan SEKALI dari editor (pilih "migrateHeaders" pada menu drop-down, lalu Run).
// - Menambahkan kolom Tahun, Jenis, Penyebab, dan Berulang apabila belum ada.
// - Mengisi baris lama yang kosong: Tahun = TAHUN_DEFAULT, Jenis = 'Resmi',
//   Berulang = 'Tidak' (nilai baku yang aman untuk data historis).
// Aman dijalankan berulang kali (idempoten).
function migrateHeaders() {
  var ss = _getSheet();
  var targets = [ [SHEET_DATA, HEAD_DATA], [SHEET_DETAIL, HEAD_DETAIL], [SHEET_TEMUAN, HEAD_TEMUAN], [SHEET_SAFETY, HEAD_SAFETY] ];
  var log = [];
  targets.forEach(function(pair){
    var name = pair[0], wantHeader = pair[1];
    var sh = ss.getSheetByName(name);
    if (!sh) { log.push(name + ': tab belum ada, dilewati'); return; }

    _tab(ss, name, wantHeader); // pastikan header lengkap

    var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var iTahun = header.indexOf('Tahun');
    var iJenis = header.indexOf('Jenis');
    var iBerulang = header.indexOf('Berulang');
    var lastRow = sh.getLastRow();
    if (lastRow < 2) { log.push(name + ': header siap, tidak ada baris lama'); return; }

    var n = lastRow - 1;
    if (iTahun > -1) {
      var rngT = sh.getRange(2, iTahun+1, n, 1);
      var vT = rngT.getValues();
      for (var r = 0; r < n; r++) if (vT[r][0] === '' || vT[r][0] === null) vT[r][0] = TAHUN_DEFAULT;
      rngT.setValues(vT);
    }
    if (iJenis > -1) {
      var rngJ = sh.getRange(2, iJenis+1, n, 1);
      var vJ = rngJ.getValues();
      for (var r2 = 0; r2 < n; r2++) if (vJ[r2][0] === '' || vJ[r2][0] === null) vJ[r2][0] = 'Resmi';
      rngJ.setValues(vJ);
    }
    if (iBerulang > -1) {
      var rngB = sh.getRange(2, iBerulang+1, n, 1);
      var vB = rngB.getValues();
      for (var r3 = 0; r3 < n; r3++) if (vB[r3][0] === '' || vB[r3][0] === null) vB[r3][0] = 'Tidak';
      rngB.setValues(vB);
    }
    log.push(name + ': ' + n + ' baris lama diperbarui');
  });
  Logger.log(log.join('\n'));
  return log.join('\n');
}

// Ringkasan rata-rata Nilai Akhir per Tahun/PU/Jenis (untuk grafik tren).
function getTrendSummary() {
  var ss = _getSheet();
  var sh = ss.getSheetByName(SHEET_DATA);
  if (!sh || sh.getLastRow() < 2) return [];
  var data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var head = data[0];
  var iPU = head.indexOf('PU'),
      iNilai = head.indexOf('Nilai Akhir'),
      iTahun = head.indexOf('Tahun'),
      iJenis = head.indexOf('Jenis');
  var acc = {};
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var th = (iTahun > -1 ? row[iTahun] : '') || TAHUN_DEFAULT;
    var pu = (iPU > -1 ? row[iPU] : '') || '';
    var jn = (iJenis > -1 ? row[iJenis] : '') || 'Resmi';
    var nv = parseFloat(iNilai > -1 ? row[iNilai] : '');
    if (isNaN(nv)) continue;
    var k = th + '|' + pu + '|' + jn;
    if (!acc[k]) acc[k] = { tahun: th, pu: pu, jenis: jn, sum: 0, n: 0 };
    acc[k].sum += nv; acc[k].n += 1;
  }
  var out = [];
  Object.keys(acc).forEach(function(k){
    var a = acc[k];
    out.push({ tahun: a.tahun, pu: a.pu, jenis: a.jenis,
               rata2: Math.round(a.sum / a.n * 100) / 100, jumlah: a.n });
  });
  return out;
}

// ---- fungsi pemeriksaan manual (jalankan dari editor bila diperlukan) ----
function cekID() {
  Logger.log('SHEET_ID  = [' + SHEET_ID + ']');
  Logger.log('FOLDER_ID = [' + FOLDER_ID + ']');
  try { Logger.log('Spreadsheet ditemukan: ' + SpreadsheetApp.openById(SHEET_ID).getName()); }
  catch(e){ Logger.log('SHEET ERROR: ' + e); }
  try { Logger.log('Folder ditemukan: ' + DriveApp.getFolderById(FOLDER_ID).getName()); }
  catch(e){ Logger.log('FOLDER ERROR: ' + e); }
}
