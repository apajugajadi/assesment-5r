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
var SHEET_ID  = '12brRNsQznR7Bgws_LXHpNleG2QIS9HFW6_JIPOVTCPA'; // Spreadsheet tujuan (akun processengineeringptpl)
var FOLDER_ID = '15nDVpa8FqZFa5tZw1nm0DHdrnb3wEN08';            // Folder foto pada Drive (akun processengineeringptpl)
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
// 'Periode' (BARU) ditaruh di ujung kanan (bukan disisipkan) supaya _tab() cukup
// menambahkan kolom ini di sheet lama tanpa menggeser kolom yang sudah ada.
// Baris lama (sebelum kolom ini ditambahkan) akan kosong di kolom Periode —
// dianggap tidak masuk hitungan radar Mid/End sampai asesor sync ulang sesinya.
var HEAD_DETAIL = [
  'ID Sesi','PU','Lokasi','Area','Aspek','No','Klausul','Jawaban','Skor Aspek',
  'Tahun','Jenis','Periode'
];
// Header tab Temuan: ditambahkan 'Penyebab' dan 'Berulang', serta 'Foto Temuan (DataURL)'
// dan 'Foto Perbaikan (DataURL)' (BARU) agar before/after bisa ditampilkan langsung di Dashboard Cloud.
// 'Area ID' (BARU) disimpan terpisah dari 'Area' (nama) — dipakai untuk mencocokkan foto standar
// secara ANDAL walau nama area sempat diubah admin sejak temuan ini pertama kali tercatat.
var HEAD_TEMUAN = [
  'ID Temuan','ID Sesi','PU','Lokasi','Periode','Asesor','Area','Kategori','Skor',
  'Deskripsi','Saran','Target','Deskripsi Perbaikan','Tgl Perbaikan','Status','Verifikator','Folder Foto',
  'Penyebab','Berulang','Foto Temuan (DataURL)','Foto Perbaikan (DataURL)','Dijadikan Standar','Area ID','Asesor Username',
  'Catatan Verifikasi','Update Terakhir'
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
  'Foto Temuan (DataURL)','Foto Perbaikan (DataURL)','Folder Foto',
  'Catatan Verifikasi','Update Terakhir'
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
      _refreshRingkasanDashboard(); // target/bobot bisa berubah -> Ringkasan & Dashboard perlu ikut update
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

    // ---- mode: ASESOR pembuat (atau admin) memverifikasi temuan ----
    if (body.type === 'verifyFinding') {
      return _json(_verifyFinding(body.findingId, body.username, !!body.admin, body.fields || {}));
    }
    if (body.type === 'verifySafetyFinding') {
      return _json(_verifySafetyFinding(body.safetyId, body.username, !!body.admin, body.fields || {}));
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
                tj.tahun, tj.jenis, rec.periode||''];
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
        var st = prev.status || f.status || 'Open';       // pertahankan status yang sudah diubah tim TL
        var penyebab = f.penyebab || prev.penyebab || '';  // penyebab (root cause)
        var key = (f.area||'') + '|' + (f.kategori||'');
        var berulang = historyKeys[key] ? 'Ya' : 'Tidak';
        var fotoT = _clampCell(f.foto || '');
        // Kolom tindak lanjut: nilai yang sudah diisi tim TL di baris lama diutamakan,
        // supaya sinkron ulang oleh asesor TIDAK menghapus progress penutupan temuan.
        var target = prev.target || f.target || '';
        var deskP = prev.deskPerbaikan || f.deskPerbaikan || '';
        var tglP = prev.tglPerbaikan || f.tglPerbaikan || '';
        var verif = prev.verifikator || f.verifikator || '';
        var fotoP = _clampCell(prev.fotoPerbaikan || f.fotoPerbaikan || '');
        var standar = prev.standar || 'Tidak'; // pertahankan penanda "dijadikan standar" agar tidak hilang saat re-sync
        var catV = prev.catatanVerifikasi || '';
        var updT = prev.updateTerakhir || nowStr;
        return [f.id, rec.id, rec.pu||'', rec.loc||'', rec.periode||'', rec.asesor||'',
                f.area||'', f.kategori||'', f.skor||'', f.deskripsi||'', f.saran||'',
                target, deskP, tglP, st, verif, folderUrl,
                penyebab, berulang, fotoT, fotoP, standar, f.areaId||'', rec.asesorUsername||'',
                catV, updT];
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
                 _clampCell(sf.foto||''), _clampCell(prev.fotoPerbaikan||''), folderUrl,
                 prev.catatanVerifikasi||'', prev.updateTerakhir||nowStr ];
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

    _refreshRingkasanDashboard(); // sesi baru tersimpan -> Ringkasan & Dashboard perlu ikut update

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
  // Mengembalikan {idTemuan: {status, penyebab, standar, target, deskPerbaikan, tglPerbaikan,
  // verifikator, fotoPerbaikan}} untuk baris lama pada sesi ini — SEMUA kolom tindak lanjut
  // yang dikelola tim Tindak Lanjut / admin dipertahankan saat asesor sinkron ulang.
  var map = {};
  var last = sh.getLastRow();
  if (last < 2) return map;
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var iStatus = head.indexOf('Status');
  var iPenyebab = head.indexOf('Penyebab');
  var iStandar = head.indexOf('Dijadikan Standar');
  var iTarget = head.indexOf('Target');
  var iDeskP = head.indexOf('Deskripsi Perbaikan');
  var iTglP = head.indexOf('Tgl Perbaikan');
  var iVerif = head.indexOf('Verifikator');
  var iFotoP = head.indexOf('Foto Perbaikan (DataURL)');
  var iCatV = head.indexOf('Catatan Verifikasi');
  var iUpd = head.indexOf('Update Terakhir');
  var vals = sh.getRange(2, 1, last-1, sh.getLastColumn()).getValues();
  for (var r = 0; r < vals.length; r++) {
    if (vals[r][1] === sesiId) {
      map[vals[r][0]] = {
        status: iStatus > -1 ? vals[r][iStatus] : '',
        penyebab: iPenyebab > -1 ? vals[r][iPenyebab] : '',
        standar: iStandar > -1 ? vals[r][iStandar] : '',
        target: iTarget > -1 ? vals[r][iTarget] : '',
        deskPerbaikan: iDeskP > -1 ? vals[r][iDeskP] : '',
        tglPerbaikan: iTglP > -1 ? vals[r][iTglP] : '',
        verifikator: iVerif > -1 ? vals[r][iVerif] : '',
        fotoPerbaikan: iFotoP > -1 ? vals[r][iFotoP] : '',
        catatanVerifikasi: iCatV > -1 ? vals[r][iCatV] : '',
        updateTerakhir: iUpd > -1 ? vals[r][iUpd] : ''
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
        // Catat "Update Terakhir" saat Status berubah — dipakai deteksi temuan mandek
        var iUpd0 = head.indexOf('Update Terakhir');
        if (iUpd0 > -1 && fields && Object.prototype.hasOwnProperty.call(fields,'Status') && statusLama !== fields['Status']) {
          sh.getRange(rowNum, iUpd0+1).setValue(new Date().toISOString());
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
var SAFETY_ALLOWED_FIELDS = ['Status','Deskripsi Perbaikan','Tgl Perbaikan','Verifikator','Foto Perbaikan (DataURL)','Kategori','Lokasi Titik','Deskripsi','Catatan Verifikasi'];
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
        var iUpdS = head.indexOf('Update Terakhir');
        if (iUpdS > -1 && fields && Object.prototype.hasOwnProperty.call(fields,'Status') && statusLama !== fields['Status']) {
          sh.getRange(rowNum, iUpdS+1).setValue(new Date().toISOString());
        }
        return {ok:true, safetyId: safetyId};
      }
    }
    return {ok:false, error:'temuan safety tidak ditemukan'};
  } catch (e) { return {ok:false, error:String(e)}; }
}

// ============================================================
//  VERIFIKASI TEMUAN oleh ASESOR PEMBUAT (atau admin sebagai fallback)
// ============================================================
// Asesor yang membuat temuan meninjau bukti perbaikan tim TL lalu:
//   - Status 'Close'  -> disetujui (Verifikator terisi otomatis)
//   - Status 'Open'   -> ditolak (wajib Catatan Verifikasi -> tim TL revisi)
// Kepemilikan divalidasi DI SERVER: 'Asesor Username' baris harus sama dengan
// username pemanggil, KECUALI isAdmin=true.
var VERIFY_ALLOWED = ['Status','Verifikator','Catatan Verifikasi'];
function _verifyGeneric(sheetName, idHeader, itemId, username, isAdmin, fields) {
  try {
    if (!itemId) return {ok:false, error:'id kosong'};
    if (!isAdmin && !username) return {ok:false, error:'sesi tidak valid, silakan login ulang'};
    var ss = _getSheet();
    var sh = ss.getSheetByName(sheetName);
    if (!sh || sh.getLastRow() < 2) return {ok:false, error:'data tidak ditemukan'};
    var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var iId = head.indexOf(idHeader), iUser = head.indexOf('Asesor Username'),
        iSesi = head.indexOf('ID Sesi'), iStatus = head.indexOf('Status'), iUpd = head.indexOf('Update Terakhir');
    var last = sh.getLastRow();
    var vals = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
    for (var r = 0; r < vals.length; r++) {
      if (vals[r][iId] === itemId) {
        if (!isAdmin && String(vals[r][iUser]) !== String(username)) {
          return {ok:false, error:'Anda bukan pembuat temuan ini — tidak berwenang memverifikasi.'};
        }
        var rowNum = r + 2;
        var statusLama = iStatus > -1 ? vals[r][iStatus] : '';
        var newStatus = fields && fields['Status'];
        if (newStatus === 'Open' && !(fields['Catatan Verifikasi'] || '').trim()) {
          return {ok:false, error:'Catatan Verifikasi wajib diisi saat menolak.'};
        }
        for (var key in fields) {
          if (VERIFY_ALLOWED.indexOf(key) === -1) continue;
          var col = head.indexOf(key);
          if (col >= 0) sh.getRange(rowNum, col + 1).setValue(fields[key]);
        }
        if (iStatus > -1 && newStatus && newStatus !== statusLama) {
          _catatRiwayatStatus(itemId, vals[r][iSesi], statusLama, newStatus, (fields['Verifikator'] || username || 'Admin'));
          if (iUpd > -1) sh.getRange(rowNum, iUpd + 1).setValue(new Date().toISOString());
        }
        return {ok:true, id: itemId, status: newStatus};
      }
    }
    return {ok:false, error:'temuan tidak ditemukan'};
  } catch (e) { return {ok:false, error:String(e)}; }
}
function _verifyFinding(findingId, username, isAdmin, fields) {
  return _verifyGeneric(SHEET_TEMUAN, 'ID Temuan', findingId, username, isAdmin, fields);
}
function _verifySafetyFinding(safetyId, username, isAdmin, fields) {
  return _verifyGeneric(SHEET_SAFETY, 'ID Safety', safetyId, username, isAdmin, fields);
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
//  BOOTSTRAP DATABASE BARU (untuk migrasi ke akun Google lain)
// ============================================================
// Di akun Google BARU: buat project Apps Script baru, tempel code.gs ini,
// KOSONGKAN SHEET_ID dan FOLDER_ID di atas (jadi '' keduanya), Save, lalu
// Run fungsi ini SEKALI. Ia membuat Spreadsheet + Folder + seluruh tab, dan
// mencetak ID keduanya di Execution log. Salin ID itu ke konstanta SHEET_ID
// & FOLDER_ID, Save lagi, baru Deploy sebagai Web App.
function bootstrapDatabase() {
  var log = [];
  var ss;
  if (SHEET_ID) { ss = SpreadsheetApp.openById(SHEET_ID); log.push('Pakai Spreadsheet yang sudah ada: ' + ss.getName()); }
  else { ss = SpreadsheetApp.create('Assesment 5R - Data'); log.push('SHEET_ID BARU  = ' + ss.getId()); }

  _tab(ss, SHEET_DATA, HEAD_DATA);
  _tab(ss, SHEET_DETAIL, HEAD_DETAIL);
  _tab(ss, SHEET_TEMUAN, HEAD_TEMUAN);
  _tab(ss, SHEET_SAFETY, HEAD_SAFETY);
  _tab(ss, SHEET_RIWAYAT, HEAD_RIWAYAT);
  _tab(ss, SHEET_USERS, HEAD_USERS);
  log.push('6 tab + header dibuat/diselaraskan.');

  var folder;
  if (FOLDER_ID) { folder = DriveApp.getFolderById(FOLDER_ID); log.push('Pakai Folder yang sudah ada: ' + folder.getName()); }
  else { folder = DriveApp.createFolder('Assesment 5R - Foto'); log.push('FOLDER_ID BARU = ' + folder.getId()); }

  // Sheet1 kosong bawaan Google — hapus bila ada
  var def = ss.getSheetByName('Sheet1') || ss.getSheetByName('Sheet 1');
  if (def && ss.getSheets().length > 1) { ss.deleteSheet(def); log.push('Sheet1 bawaan dihapus.'); }

  Logger.log(log.join('\n'));
  return log.join('\n');
}

// ============================================================
//  RINGKASAN NILAI PER PU (Mid/End/Final) — jalankan MANUAL dari editor
// ============================================================
// Membuat/menyegarkan tab "Ringkasan" berisi rata-rata Nilai Akhir untuk
// Mid Year & End Year (dibaca dari tab Assessment), lalu Final = blending
// sesuai bobot di Kelola Formulir (fallback 35/65 kalau belum pernah diatur).
// Dua bagian: rekap PER LOKASI dulu, baru rekap PER PU (rata-rata semua
// lokasi PU itu) di bawahnya. Kolom Target & Capaian(%) diambil sebagai
// SNAPSHOT (nilai statis, bukan formula) dari config_master.json — target
// aslinya tetap dikelola & diubah lewat Admin app (Kelola Formulir > Target
// Nilai), tab ini murni untuk DILIHAT, bukan diedit manual.
// Aman dijalankan berkali-kali — isi lama ditimpa ulang.
// Filter Tahun/Jenis di B1/B2 bisa diubah manual, formula Mid/End/Final ikut kesesuaikan
// (Target & Capaian tidak ikut filter itu — murni snapshot config saat fungsi dijalankan).
function buatRingkasanNilai() {
  var ss = _getSheet();
  var sh = ss.getSheetByName('Ringkasan');
  if (sh) ss.deleteSheet(sh);
  sh = ss.insertSheet('Ringkasan');

  var cfg = _readConfig() || {};
  var w = cfg.weights || { midYear: 35, endYear: 65 };
  var targets = cfg.targets || {}; // key: "PU::Lokasi" -> angka target

  // ---- daftar kombinasi PU+Lokasi unik, dan daftar PU unik, dari tab Assessment ----
  var src = ss.getSheetByName(SHEET_DATA);
  var combos = [], pus = [];
  if (src && src.getLastRow() > 1) {
    var iPu = HEAD_DATA.indexOf('PU'), iLoc = HEAD_DATA.indexOf('Lokasi');
    var vals = src.getRange(2, 1, src.getLastRow() - 1, src.getLastColumn()).getValues();
    var seenCombo = {}, seenPu = {};
    vals.forEach(function (r) {
      var pu = String(r[iPu] || '').trim();
      var loc = String(r[iLoc] || '').trim();
      if (pu && loc) {
        var key = pu + '||' + loc;
        if (!seenCombo[key]) { seenCombo[key] = true; combos.push({ pu: pu, loc: loc }); }
      }
      if (pu && !seenPu[pu]) { seenPu[pu] = true; pus.push(pu); }
    });
    combos.sort(function (a, b) { return a.pu === b.pu ? a.loc.localeCompare(b.loc) : a.pu.localeCompare(b.pu); });
    pus.sort();
  }

  // ---- header & sel filter ----
  sh.getRange('A1').setValue('Tahun filter').setFontWeight('bold');
  sh.getRange('B1').setValue(new Date().getFullYear());
  sh.getRange('A2').setValue('Jenis filter').setFontWeight('bold');
  sh.getRange('B2').setValue('Resmi');
  sh.getRange('A3').setValue('Bobot Mid (%)').setFontWeight('bold');
  sh.getRange('B3').setValue(w.midYear || 35);
  sh.getRange('A4').setValue('Bobot End (%)').setFontWeight('bold');
  sh.getRange('B4').setValue(w.endYear || 65);

  var tab = "'" + SHEET_DATA + "'"; // nama tab di-quote biar aman kalau ada spasi

  // ---- styling filter cells (label muted, biar senada sama Dashboard) ----
  sh.getRange('A1:A4').setFontColor(DASH_COLOR.muted);
  sh.getRange('B1:B4').setBackground('#ffffff').setBorder(true, true, true, true, false, false, DASH_COLOR.line, SpreadsheetApp.BorderStyle.SOLID);

  // ============================================================
  //  BAGIAN 1: REKAP PER LOKASI
  // ============================================================
  var locTitleRow = 6;
  sh.getRange(locTitleRow, 1, 1, 7).merge()
    .setValue('PER LOKASI')
    .setBackground(DASH_COLOR.dark).setFontColor('#ffffff')
    .setFontWeight('bold').setFontSize(11).setHorizontalAlignment('left')
    .setBorder(true, true, false, true, false, false, DASH_COLOR.dark, SpreadsheetApp.BorderStyle.SOLID);
  sh.setRowHeight(locTitleRow, 24);
  var locHeaderRow = locTitleRow + 1;
  sh.getRange(locHeaderRow, 1, 1, 7).setValues([['PU', 'Lokasi', 'Mid', 'End', 'Final', 'Target', 'Capaian (%)']])
    .setBackground(DASH_COLOR.mid).setFontColor('#ffffff').setFontWeight('bold')
    .setHorizontalAlignment('center');
  // Simpan target per-lokasi yang dipakai, dipetakan lewat baris, untuk dipakai
  // ulang menghitung Target rata-rata per PU di Bagian 2 (meniru targetPU() di app.js:
  // rata-rata target lokasi yang > 0 saja).
  var targetByPu = {}; // { pu: [target1, target2, ...] (hanya yang > 0) }
  var locCapaiCells = [];
  combos.forEach(function (c, i) {
    var row = locHeaderRow + 1 + i;
    var tVal = Number(targets[c.pu + '::' + c.loc]) || 0;
    if (tVal > 0) { (targetByPu[c.pu] = targetByPu[c.pu] || []).push(tVal); }
    sh.getRange(row, 1).setValue(c.pu);
    sh.getRange(row, 2).setValue(c.loc);
    sh.getRange(row, 3).setFormula(
      '=IFERROR(AVERAGEIFS(' + tab + '!J:J,' + tab + '!E:E,A' + row + ',' + tab + '!F:F,B' + row + ',' + tab + '!G:G,"Mid*",' + tab + '!N:N,$B$1,' + tab + '!O:O,$B$2),0)'
    );
    sh.getRange(row, 4).setFormula(
      '=IFERROR(AVERAGEIFS(' + tab + '!J:J,' + tab + '!E:E,A' + row + ',' + tab + '!F:F,B' + row + ',' + tab + '!G:G,"End*",' + tab + '!N:N,$B$1,' + tab + '!O:O,$B$2),0)'
    );
    sh.getRange(row, 5).setFormula(
      '=IF(AND(C' + row + '>0,D' + row + '>0),C' + row + '*$B$3/100+D' + row + '*$B$4/100,IF(D' + row + '>0,D' + row + ',C' + row + '))'
    );
    sh.getRange(row, 6).setValue(tVal || '');
    if (tVal > 0) {
      sh.getRange(row, 7).setFormula('=IFERROR(ROUND(E' + row + '/F' + row + '*100,1),"")');
      locCapaiCells.push(sh.getRange(row, 7));
    }
    sh.getRange(row, 1, 1, 7).setBackground(i % 2 === 1 ? DASH_COLOR.bg : '#ffffff');
  });
  var locLastDataRow = locHeaderRow + combos.length;
  sh.getRange(locHeaderRow, 1, combos.length + 1, 7)
    .setBorder(true, true, true, true, true, true, DASH_COLOR.line, SpreadsheetApp.BorderStyle.SOLID)
    .setVerticalAlignment('middle');
  sh.getRange(locHeaderRow + 1, 3, combos.length, 5).setHorizontalAlignment('center');

  // ============================================================
  //  BAGIAN 2: REKAP PER PU (rata-rata seluruh lokasi PU tsb)
  // ============================================================
  var puTitleRow = locLastDataRow + 3; // jeda 2 baris kosong dari tabel Lokasi
  sh.getRange(puTitleRow, 1, 1, 6).merge()
    .setValue('PER PU')
    .setBackground(DASH_COLOR.dark).setFontColor('#ffffff')
    .setFontWeight('bold').setFontSize(11).setHorizontalAlignment('left')
    .setBorder(true, true, false, true, false, false, DASH_COLOR.dark, SpreadsheetApp.BorderStyle.SOLID);
  sh.setRowHeight(puTitleRow, 24);
  var puHeaderRow = puTitleRow + 1;
  sh.getRange(puHeaderRow, 1, 1, 6).setValues([['PU', 'Mid', 'End', 'Final', 'Target', 'Capaian (%)']])
    .setBackground(DASH_COLOR.mid).setFontColor('#ffffff').setFontWeight('bold')
    .setHorizontalAlignment('center');
  var puCapaiCells = [];
  pus.forEach(function (pu, i) {
    var row = puHeaderRow + 1 + i;
    var tArr = targetByPu[pu] || [];
    var tPu = tArr.length ? (tArr.reduce(function (a, b) { return a + b; }, 0) / tArr.length) : 0;
    sh.getRange(row, 1).setValue(pu);
    sh.getRange(row, 2).setFormula(
      '=IFERROR(AVERAGEIFS(' + tab + '!J:J,' + tab + '!E:E,A' + row + ',' + tab + '!G:G,"Mid*",' + tab + '!N:N,$B$1,' + tab + '!O:O,$B$2),0)'
    );
    sh.getRange(row, 3).setFormula(
      '=IFERROR(AVERAGEIFS(' + tab + '!J:J,' + tab + '!E:E,A' + row + ',' + tab + '!G:G,"End*",' + tab + '!N:N,$B$1,' + tab + '!O:O,$B$2),0)'
    );
    sh.getRange(row, 4).setFormula(
      '=IF(AND(B' + row + '>0,C' + row + '>0),B' + row + '*$B$3/100+C' + row + '*$B$4/100,IF(C' + row + '>0,C' + row + ',B' + row + '))'
    );
    sh.getRange(row, 5).setValue(tPu ? Math.round(tPu * 100) / 100 : '');
    if (tPu > 0) {
      sh.getRange(row, 6).setFormula('=IFERROR(ROUND(D' + row + '/E' + row + '*100,1),"")');
      puCapaiCells.push(sh.getRange(row, 6));
    }
    sh.getRange(row, 1, 1, 6).setBackground(i % 2 === 1 ? DASH_COLOR.bg : '#ffffff');
  });
  sh.getRange(puHeaderRow, 1, pus.length + 1, 6)
    .setBorder(true, true, true, true, true, true, DASH_COLOR.line, SpreadsheetApp.BorderStyle.SOLID)
    .setVerticalAlignment('middle');
  sh.getRange(puHeaderRow + 1, 2, pus.length, 5).setHorizontalAlignment('center');

  // ---- conditional formatting Capaian% (merah <80, amber 80-99.9, hijau >=100) ----
  var allCapaiCells = locCapaiCells.concat(puCapaiCells);
  if (allCapaiCells.length) {
    var rules = sh.getConditionalFormatRules();
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenNumberLessThan(80).setBackground('#FBEEEC').setFontColor(DASH_COLOR.red)
      .setRanges(allCapaiCells).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenNumberBetween(80, 99.999).setBackground('#FEF9EC').setFontColor('#9A6B00')
      .setRanges(allCapaiCells).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThanOrEqualTo(100).setBackground('#EAF5EC').setFontColor(DASH_COLOR.mid)
      .setRanges(allCapaiCells).build());
    sh.setConditionalFormatRules(rules);
  }

  sh.setFrozenRows(locHeaderRow);
  sh.autoResizeColumns(1, 7);
  Logger.log('Ringkasan dibuat: ' + combos.length + ' lokasi, ' + pus.length + ' PU (target diambil dari config_master.json)');
  return 'OK — ' + combos.length + ' lokasi, ' + pus.length + ' PU: ' + pus.join(', ');
}

// ============================================================
//  DASHBOARD VISUAL — KPI card, tabel Per PU, radar 5R Mid vs End — MANUAL
// ============================================================
// Tab TERPISAH dari "Ringkasan" ('Dashboard'), murni tampilan visual untuk
// analisis cepat: KPI card (Nasional + per PU) dengan warna traffic-light
// sesuai capaian target, tabel Per PU rapi, dan radar chart 5R (Ringkas/
// Rapi/Resik/Rawat/Rajin) membandingkan Mid Year vs End Year per PU.
// Filter Tahun/Jenis ada di B4/B5 — ubah kapan saja, seluruh formula ikut
// menyesuaikan (radar TIDAK ikut menyesuaikan otomatis karena datanya statis
// snapshot saat fungsi dijalankan — jalankan ulang fungsi ini kalau filter
// tahun/jenis berubah dan mau radar ikut update).
// Target diambil snapshot dari config_master.json (sama seperti di Ringkasan)
// — tetap diubah lewat Admin app > Kelola Formulir > Target Nilai, BUKAN di sini.
// Palet warna disamakan dengan tampilan app (hijau tua Pertamina Lubricants).
var DASH_COLOR = {
  dark: '#0B3D2E', mid: '#1E7A5A', lime: '#39B54A',
  amber: '#E8A317', red: '#C0392B', bg: '#EEF1EE',
  line: '#D6DED8', muted: '#6B7A72'
};
var DASH_ASPEK = ['Ringkas', 'Rapi', 'Resik', 'Rawat', 'Rajin'];

// Dipanggil otomatis dari doPost (setiap kali config di-sinkronkan admin ATAU sesi
// assessment baru berhasil disimpan) supaya tab Ringkasan & Dashboard SELALU
// up-to-date tanpa perlu dijalankan manual dari editor lagi. Dibungkus try/catch
// SENGAJA — kalau bagian regenerasi tabel/chart ini gagal karena sebab apa pun,
// respons sync ke app.js (asesor/admin) TETAP berhasil; error-nya cuma tercatat
// di log, tidak menggagalkan permintaan yang sedang diproses.
function _refreshRingkasanDashboard() {
  try { buatRingkasanNilai(); } catch (e) { Logger.log('Auto-refresh Ringkasan gagal: ' + e); }
  try { buatDashboard(); } catch (e) { Logger.log('Auto-refresh Dashboard gagal: ' + e); }
}

// Jalankan SEKALI (dari editor, pilih fungsi ini di dropdown) SEBELUM buatDashboard()
// pertama kali dipakai, KALAU sudah ada data lama di tab Assessment/Detail dari
// sebelum kolom 'Periode' ditambahkan. Mengisi kolom Periode di tab Detail dengan
// mencocokkan ID Sesi ke tab Assessment (yang Periode-nya sudah ada dari awal).
// Aman dijalankan berkali-kali (idempoten) — baris yang Periode-nya sudah terisi dilewati.
function backfillPeriodeDetail() {
  var ss = _getSheet();
  var shA = ss.getSheetByName(SHEET_DATA);
  var shD = ss.getSheetByName(SHEET_DETAIL);
  if (!shA || !shD) return 'Tab Assessment/Detail belum ada';
  _tab(ss, SHEET_DETAIL, HEAD_DETAIL); // pastikan kolom Periode sudah ada

  var lastA = shA.getLastRow();
  if (lastA < 2) return 'Tab Assessment kosong, tidak ada yang bisa di-backfill';
  var headA = shA.getRange(1, 1, 1, shA.getLastColumn()).getValues()[0];
  var iIdA = headA.indexOf('ID Sesi'), iPerA = headA.indexOf('Periode');
  var valsA = shA.getRange(2, 1, lastA - 1, shA.getLastColumn()).getValues();
  var periodeBySesi = {};
  valsA.forEach(function (r) { periodeBySesi[r[iIdA]] = r[iPerA] || ''; });

  var lastD = shD.getLastRow();
  if (lastD < 2) return 'Tab Detail kosong, tidak ada yang bisa di-backfill';
  var headD = shD.getRange(1, 1, 1, shD.getLastColumn()).getValues()[0];
  var iIdD = headD.indexOf('ID Sesi'), iPerD = headD.indexOf('Periode');
  var rngD = shD.getRange(2, 1, lastD - 1, shD.getLastColumn());
  var valsD = rngD.getValues();
  var filled = 0;
  for (var r = 0; r < valsD.length; r++) {
    if (valsD[r][iPerD]) continue; // sudah terisi, lewati
    var per = periodeBySesi[valsD[r][iIdD]];
    if (per) { valsD[r][iPerD] = per; filled++; }
  }
  rngD.setValues(valsD);
  Logger.log('Backfill Periode di tab Detail: ' + filled + ' baris terisi dari ' + valsD.length + ' baris total.');
  return 'OK — ' + filled + ' baris Detail terisi Periode-nya.';
}

function buatDashboard() {
  var ss = _getSheet();
  var old = ss.getSheetByName('Dashboard');
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet('Dashboard', 0); // taruh di paling depan (tab pertama)
  sh.setTabColor(DASH_COLOR.dark);

  var cfg = _readConfig() || {};
  var w = cfg.weights || { midYear: 35, endYear: 65 };
  var wMid = Number(w.midYear) || 35, wEnd = Number(w.endYear) || 65;
  var targets = cfg.targets || {};

  // ---- daftar PU unik dari tab Assessment ----
  var src = ss.getSheetByName(SHEET_DATA);
  var pus = [];
  if (src && src.getLastRow() > 1) {
    var iPu = HEAD_DATA.indexOf('PU');
    var vals = src.getRange(2, iPu + 1, src.getLastRow() - 1, 1).getValues();
    var seen = {};
    vals.forEach(function (r) {
      var pu = String(r[0] || '').trim();
      if (pu && !seen[pu]) { seen[pu] = true; pus.push(pu); }
    });
    pus.sort();
  }

  var tabA = "'" + SHEET_DATA + "'";
  var tabD = "'" + SHEET_DETAIL + "'";
  var nCards = pus.length + 1; // +1 kartu Nasional
  var totalCols = Math.max(9, nCards * 3);

  // ============================================================
  //  JUDUL
  // ============================================================
  sh.getRange(1, 1, 1, totalCols).merge()
    .setValue('DASHBOARD NILAI ASSESSMENT 5R')
    .setBackground(DASH_COLOR.dark).setFontColor('#ffffff')
    .setFontWeight('bold').setFontSize(16)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(1, 36);
  sh.getRange(2, 1, 1, totalCols).merge()
    .setValue('Direktorat Operasi — PT Pertamina Lubricants · diperbarui ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'GMT+7', 'dd MMM yyyy HH:mm'))
    .setBackground(DASH_COLOR.mid).setFontColor('#ffffff')
    .setFontStyle('italic').setFontSize(9).setHorizontalAlignment('center');
  sh.setRowHeight(2, 22);

  sh.getRange('A4').setValue('Tahun filter').setFontWeight('bold').setFontColor(DASH_COLOR.muted);
  sh.getRange('B4').setValue(new Date().getFullYear());
  sh.getRange('A5').setValue('Jenis filter').setFontWeight('bold').setFontColor(DASH_COLOR.muted);
  sh.getRange('B5').setValue('Resmi');

  // ============================================================
  //  KPI CARD: NASIONAL + PER PU
  // ============================================================
  var rTitle = 7, rValue = 8, rTarget = 9, rCapai = 10;
  var cw = 3; // lebar tiap kartu, dalam kolom
  var finalCellAddr = []; // kumpulan alamat cell Final tiap PU (buat hitung Nasional)
  var capaiCells = []; // kumpulan Range Capaian% (buat conditional formatting)

  pus.forEach(function (pu, i) {
    var c0 = 1 + (i + 1) * cw; // geser 1 slot ke kanan, slot pertama buat Nasional
    var rTitleRange = sh.getRange(rTitle, c0, 1, cw).merge();
    rTitleRange.setValue(pu).setBackground(DASH_COLOR.dark).setFontColor('#ffffff')
      .setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center');

    var valRange = sh.getRange(rValue, c0, 1, cw).merge();
    var mF = 'IFERROR(AVERAGEIFS(' + tabA + '!J:J,' + tabA + '!E:E,"' + pu + '",' + tabA + '!G:G,"Mid*",' + tabA + '!N:N,$B$4,' + tabA + '!O:O,$B$5),0)';
    var eF = 'IFERROR(AVERAGEIFS(' + tabA + '!J:J,' + tabA + '!E:E,"' + pu + '",' + tabA + '!G:G,"End*",' + tabA + '!N:N,$B$4,' + tabA + '!O:O,$B$5),0)';
    valRange.setFormula('=ROUND(IF(AND(' + mF + '>0,' + eF + '>0),' + mF + '*' + wMid + '/100+' + eF + '*' + wEnd + '/100,IF(' + eF + '>0,' + eF + ',' + mF + ')),2)');
    valRange.setFontSize(22).setFontWeight('bold').setHorizontalAlignment('center')
      .setBackground('#ffffff').setBorder(true, true, false, true, false, false, DASH_COLOR.line, SpreadsheetApp.BorderStyle.SOLID);
    finalCellAddr.push(valRange.getCell(1, 1).getA1Notation());

    var tArr = Object.keys(targets).filter(function (k) { return k.indexOf(pu + '::') === 0; })
      .map(function (k) { return Number(targets[k]) || 0; }).filter(function (v) { return v > 0; });
    var tPu = tArr.length ? Math.round((tArr.reduce(function (a, b) { return a + b; }, 0) / tArr.length) * 100) / 100 : 0;

    var tgtRange = sh.getRange(rTarget, c0, 1, cw).merge();
    tgtRange.setValue(tPu > 0 ? ('Target: ' + tPu) : 'Target belum diatur')
      .setFontSize(9).setFontColor(DASH_COLOR.muted).setHorizontalAlignment('center')
      .setBackground('#ffffff').setBorder(false, true, false, true, false, false, DASH_COLOR.line, SpreadsheetApp.BorderStyle.SOLID);

    var capRange = sh.getRange(rCapai, c0, 1, cw).merge();
    if (tPu > 0) {
      capRange.setFormula('=ROUND(' + valRange.getCell(1, 1).getA1Notation() + '/' + tPu + '*100,1)&"% capaian"');
      capaiCells.push(sh.getRange(rCapai, c0)); // sel angka mentahnya sebenarnya teks gabungan — lihat catatan di bawah
    } else {
      capRange.setValue('—');
    }
    capRange.setFontSize(10).setFontWeight('bold').setHorizontalAlignment('center')
      .setBackground('#ffffff').setBorder(false, true, true, true, false, false, DASH_COLOR.line, SpreadsheetApp.BorderStyle.SOLID);
  });

  // ---- kartu NASIONAL (kolom paling kiri, dihitung dari rata-rata semua kartu PU) ----
  var nc0 = 1;
  sh.getRange(rTitle, nc0, 1, cw).merge().setValue('NASIONAL')
    .setBackground(DASH_COLOR.lime).setFontColor('#ffffff')
    .setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center');
  var nasValRange = sh.getRange(rValue, nc0, 1, cw).merge();
  if (finalCellAddr.length) {
    nasValRange.setFormula('=ROUND(AVERAGE(' + finalCellAddr.join(',') + '),2)');
  } else {
    nasValRange.setValue(0);
  }
  nasValRange.setFontSize(24).setFontWeight('bold').setHorizontalAlignment('center')
    .setBackground('#ffffff').setBorder(true, true, false, true, false, false, DASH_COLOR.lime, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sh.getRange(rTarget, nc0, 1, cw).merge().setValue('Rata-rata seluruh PU')
    .setFontSize(9).setFontColor(DASH_COLOR.muted).setHorizontalAlignment('center')
    .setBackground('#ffffff').setBorder(false, true, false, true, false, false, DASH_COLOR.lime, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sh.getRange(rCapai, nc0, 1, cw).merge().setValue('')
    .setBackground('#ffffff').setBorder(false, true, true, true, false, false, DASH_COLOR.lime, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  sh.setRowHeights(rTitle, 4, 24);
  sh.setRowHeight(rValue, 32);

  // ============================================================
  //  TABEL PER PU (rapi, header hijau tua + zebra striping)
  // ============================================================
  var tblTitleRow = rCapai + 3;
  sh.getRange(tblTitleRow, 1).setValue('RINGKASAN PER PU').setFontWeight('bold').setFontSize(12).setFontColor(DASH_COLOR.dark);
  var tblHeaderRow = tblTitleRow + 1;
  var tblHeader = ['PU', 'Mid', 'End', 'Final', 'Target', 'Capaian (%)'];
  sh.getRange(tblHeaderRow, 1, 1, tblHeader.length).setValues([tblHeader])
    .setBackground(DASH_COLOR.dark).setFontColor('#ffffff').setFontWeight('bold');
  var capaianNumCells = [];
  pus.forEach(function (pu, i) {
    var row = tblHeaderRow + 1 + i;
    var mF = 'IFERROR(AVERAGEIFS(' + tabA + '!J:J,' + tabA + '!E:E,A' + row + ',' + tabA + '!G:G,"Mid*",' + tabA + '!N:N,$B$4,' + tabA + '!O:O,$B$5),0)';
    var eF = 'IFERROR(AVERAGEIFS(' + tabA + '!J:J,' + tabA + '!E:E,A' + row + ',' + tabA + '!G:G,"End*",' + tabA + '!N:N,$B$4,' + tabA + '!O:O,$B$5),0)';
    sh.getRange(row, 1).setValue(pu);
    sh.getRange(row, 2).setFormula('=ROUND(' + mF + ',2)');
    sh.getRange(row, 3).setFormula('=ROUND(' + eF + ',2)');
    sh.getRange(row, 4).setFormula('=ROUND(IF(AND(B' + row + '>0,C' + row + '>0),B' + row + '*' + wMid + '/100+C' + row + '*' + wEnd + '/100,IF(C' + row + '>0,C' + row + ',B' + row + ')),2)');
    var tArr = Object.keys(targets).filter(function (k) { return k.indexOf(pu + '::') === 0; })
      .map(function (k) { return Number(targets[k]) || 0; }).filter(function (v) { return v > 0; });
    var tPu = tArr.length ? Math.round((tArr.reduce(function (a, b) { return a + b; }, 0) / tArr.length) * 100) / 100 : 0;
    sh.getRange(row, 5).setValue(tPu || '');
    if (tPu > 0) {
      sh.getRange(row, 6).setFormula('=ROUND(D' + row + '/' + tPu + '*100,1)');
      capaianNumCells.push(sh.getRange(row, 6));
    }
    if (i % 2 === 1) sh.getRange(row, 1, 1, tblHeader.length).setBackground(DASH_COLOR.bg);
  });
  sh.getRange(tblHeaderRow, 1, pus.length + 1, tblHeader.length)
    .setBorder(true, true, true, true, true, true, DASH_COLOR.line, SpreadsheetApp.BorderStyle.SOLID);

  // conditional formatting: Capaian% -> merah <80, amber 80-99.9, hijau >=100
  if (capaianNumCells.length) {
    var rules = sh.getConditionalFormatRules();
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenNumberLessThan(80).setBackground('#FBEEEC').setFontColor(DASH_COLOR.red)
      .setRanges(capaianNumCells).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenNumberBetween(80, 99.999).setBackground('#FEF9EC').setFontColor('#9A6B00')
      .setRanges(capaianNumCells).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThanOrEqualTo(100).setBackground('#EAF5EC').setFontColor(DASH_COLOR.mid)
      .setRanges(capaianNumCells).build());
    sh.setConditionalFormatRules(rules);
  }

  // ============================================================
  //  DATA PENDUKUNG RADAR (zona terpisah, jangan dihapus) + CHART
  // ============================================================
  var dataZoneRow = tblHeaderRow + pus.length + 4;
  sh.getRange(dataZoneRow, 1).setValue('DATA PENDUKUNG RADAR — JANGAN DIHAPUS/DIUBAH (dipakai chart di atas)')
    .setFontStyle('italic').setFontColor(DASH_COLOR.muted).setFontSize(9);

  var chartAnchorRow = tblHeaderRow + pus.length + 3; // radar dimulai sejajar area setelah tabel
  var chartsPerRow = 2, chartW = 420, chartH = 260;
  var blockRow = dataZoneRow + 2;

  pus.forEach(function (pu, i) {
    // ---- tabel data kecil: Aspek | Mid | End ----
    var hdrRow = blockRow;
    sh.getRange(hdrRow, 1, 1, 3).setValues([['Aspek (' + pu + ')', 'Mid', 'End']]).setFontWeight('bold').setFontSize(9);
    DASH_ASPEK.forEach(function (asp, j) {
      var row = hdrRow + 1 + j;
      sh.getRange(row, 1).setValue(asp);
      sh.getRange(row, 2).setFormula(
        '=IFERROR(AVERAGEIFS(' + tabD + '!I:I,' + tabD + '!B:B,"' + pu + '",' + tabD + '!E:E,"' + asp + '",' + tabD + '!J:J,$B$4,' + tabD + '!K:K,$B$5,' + tabD + '!L:L,"Mid*"),0)'
      );
      sh.getRange(row, 3).setFormula(
        '=IFERROR(AVERAGEIFS(' + tabD + '!I:I,' + tabD + '!B:B,"' + pu + '",' + tabD + '!E:E,"' + asp + '",' + tabD + '!J:J,$B$4,' + tabD + '!K:K,$B$5,' + tabD + '!L:L,"End*"),0)'
      );
    });
    var dataRange = sh.getRange(hdrRow, 1, 6, 3);

    // ---- radar chart ----
    var chart = sh.newChart()
      .setChartType(Charts.ChartType.RADAR)
      .addRange(dataRange)
      .setOption('title', 'Radar 5R — ' + pu + ' (Mid vs End)')
      .setOption('titleTextStyle', { color: DASH_COLOR.dark, fontSize: 12, bold: true })
      .setOption('colors', [DASH_COLOR.amber, DASH_COLOR.mid])
      .setOption('width', chartW).setOption('height', chartH)
      .setPosition(chartAnchorRow + Math.floor(i / chartsPerRow) * 15, 1 + (i % chartsPerRow) * 6, 0, 0)
      .build();
    sh.insertChart(chart);

    blockRow = hdrRow + 7; // jeda 1 baris antar blok data PU berikutnya
  });

  sh.autoResizeColumns(1, totalCols);
  Logger.log('Dashboard dibuat: ' + pus.length + ' PU, ' + pus.length + ' radar chart.');
  return 'OK — Dashboard dibuat untuk ' + pus.length + ' PU: ' + pus.join(', ');
}

// ============================================================
//  PEMBERSIHAN DATA (jalankan MANUAL dari editor — TIDAK otomatis)
// ============================================================
// cleanseData(): HAPUS SELURUH baris data assessment/temuan/detail/safety/riwayat
// (header baris 1 dipertahankan) + buang semua subfolder foto ke Trash Drive.
// TIDAK menyentuh: tab Users, file config_master.json (form induk), header.
// Foto masuk Trash Drive (bisa dipulihkan ±30 hari) — kosongkan Trash manual bila yakin.
function cleanseData() {
  var ss = _getSheet();
  var tabs = [SHEET_DATA, SHEET_DETAIL, SHEET_TEMUAN, SHEET_SAFETY, SHEET_RIWAYAT];
  var log = [];
  tabs.forEach(function(name){
    var sh = ss.getSheetByName(name);
    if (!sh) { log.push(name + ': tab tidak ada, dilewati'); return; }
    var last = sh.getLastRow();
    if (last > 1) { sh.deleteRows(2, last - 1); log.push(name + ': ' + (last - 1) + ' baris data dihapus'); }
    else { log.push(name + ': sudah kosong'); }
  });
  var folder = _getFolder();
  var subs = folder.getFolders();
  var nf = 0;
  while (subs.hasNext()) { subs.next().setTrashed(true); nf++; }
  log.push('Drive: ' + nf + ' subfolder foto dibuang ke Trash');
  Logger.log(log.join('\n'));
  return log.join('\n');
}
// cleanseFotoStandar(): kosongkan galeri Foto Standar & notifikasinya di config_master.json,
// lalu naikkan versi config agar seluruh asesor menerima pembaruan. OPSIONAL.
function cleanseFotoStandar() {
  var cfg = _readConfig() || {};
  cfg.fotoStandar = {};
  cfg.fotoStandarNotif = [];
  cfg.version = (cfg.version || 1) + 1;
  _writeConfig(cfg);
  Logger.log('fotoStandar & notif dikosongkan. Versi config -> ' + cfg.version);
  return 'ok, versi -> ' + cfg.version;
}
// cleanseUsers(): HAPUS semua akun asesor di tab Users (header dipertahankan).
// Pakai hanya bila akun-akun lama semuanya akun uji. OPSIONAL.
function cleanseUsers() {
  var sh = _usersSheet();
  var last = sh.getLastRow();
  if (last > 1) { sh.deleteRows(2, last - 1); Logger.log((last - 1) + ' akun dihapus'); return (last - 1) + ' akun dihapus'; }
  Logger.log('Users sudah kosong'); return 'kosong';
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

// Debug: cetak isi cfg.targets & cfg.weights yang benar-benar tersimpan di
// config_master.json, plus daftar PU+Lokasi yang ada di tab Assessment —
// biar gampang lihat apakah key target-nya cocok persis sama nama Lokasi.
function cekTargets() {
  var cfg = _readConfig();
  if (!cfg) { Logger.log('config_master.json TIDAK DITEMUKAN / kosong.'); return; }
  Logger.log('weights = ' + JSON.stringify(cfg.weights || {}));
  Logger.log('targets = ' + JSON.stringify(cfg.targets || {}));

  var ss = _getSheet();
  var src = ss.getSheetByName(SHEET_DATA);
  if (src && src.getLastRow() > 1) {
    var iPu = HEAD_DATA.indexOf('PU'), iLoc = HEAD_DATA.indexOf('Lokasi');
    var vals = src.getRange(2, 1, src.getLastRow() - 1, src.getLastColumn()).getValues();
    var seen = {};
    vals.forEach(function (r) {
      var key = String(r[iPu] || '') + '::' + String(r[iLoc] || '');
      seen[key] = true;
    });
    Logger.log('Kombinasi PU::Lokasi di tab Assessment = ' + JSON.stringify(Object.keys(seen)));
  }
}

// Perbaikan sekali-pakai: nama lokasi "FL01 - FL04" (pakai spasi di sekitar strip,
// versi lama di Kelola Formulir) vs "FL01-FL04" (tanpa spasi, versi yang benar-benar
// tersimpan di data assessment PUG) bikin key target-nya "yatim" — tidak pernah
// kebaca oleh Ringkasan/Dashboard. Fungsi ini memindahkan nilainya ke key yang benar.
// Aman dijalankan berkali-kali (idempoten) — kalau key lama sudah tidak ada, tidak ngapa-ngapain.
function fixTargetKeyFL01FL04() {
  var cfg = _readConfig() || {};
  cfg.targets = cfg.targets || {};
  var keyLama = 'PUG::FL01 - FL04';
  var keyBenar = 'PUG::FL01-FL04';
  if (!Object.prototype.hasOwnProperty.call(cfg.targets, keyLama)) {
    Logger.log('Key lama "' + keyLama + '" tidak ditemukan — mungkin sudah pernah diperbaiki, atau memang belum pernah diisi.');
    return 'tidak ada perubahan';
  }
  var nilai = cfg.targets[keyLama];
  cfg.targets[keyBenar] = nilai;
  delete cfg.targets[keyLama];
  cfg.version = (cfg.version || 1) + 1;
  _writeConfig(cfg);
  _refreshRingkasanDashboard();
  Logger.log('Dipindahkan: "' + keyLama + '" (' + nilai + ') -> "' + keyBenar + '". Ringkasan & Dashboard di-refresh ulang.');
  return 'OK — nilai ' + nilai + ' dipindah ke key "' + keyBenar + '"';
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
