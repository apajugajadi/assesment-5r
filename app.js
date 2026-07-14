/* ===== Assesment 5R — app logic (vanilla JS, offline-first, localStorage) =====
   + UPDATE: Multi-Tahun & Jenis (Resmi/Internal) + filter & tren di Dashboard Nilai
   Perubahan ditandai komentar  // [MT]  (Multi-Tahun) */
'use strict';

const LS_KEY='asesmen5r_v1';
const AUTH_KEY='asesmen5r_auth';
// Admin password (Fase 1: disimpan di kode; ganti sesuai kebutuhan)
const ADMIN_PASS='admin5r';
const ASESOR_PASS='asesor';

/* ===== FASE 2: Sync ke Google (Apps Script) =====
   Isi SYNC_URL dengan URL Web App hasil deploy Apps Script.
   SYNC_SECRET harus SAMA dengan SHARED_SECRET di Code.gs.
   Kalau SYNC_URL kosong, fitur sync nonaktif (app tetap jalan offline). */
const SYNC_URL='https://script.google.com/macros/s/AKfycbxGrxZH9wi05uOgvdR7ckQ0qqKV9SkyREAyftq83ISEtoQ8O4Pp_5NYI6WnzN_tXCZRXg/exec';
const SYNC_SECRET='ganti-rahasia-ini-123';

/* [MT] daftar tahun untuk dropdown: 2024 s/d tahun berjalan + 1 */
function tahunOptions(sel){
  var y=new Date().getFullYear(), o='';
  for(var t=2024;t<=y+1;t++){o+='<option '+(String(t)===String(sel)?'selected':(t===y&&sel==null?'selected':''))+'>'+t+'</option>';}
  return o;
}

/* ---------- Store ---------- */
function loadStore(){
  const SEED_VER=SEED_DATA.version||1;
  try{
    const r=localStorage.getItem(LS_KEY);
    if(r){
      const st=JSON.parse(r);
      const curVer=(st.config&&st.config.version)||1;
      if(SEED_VER>curVer){
        st.config=JSON.parse(JSON.stringify(SEED_DATA));
        st.sessions=st.sessions||[];
        try{localStorage.setItem(LS_KEY,JSON.stringify(st));}catch(e){}
        setTimeout(()=>toast('Klausul telah diperbarui ke versi terbaru'),400);
      }
      return st;
    }
  }catch(e){}
  // seed from SEED_DATA
  const s={
    config:JSON.parse(JSON.stringify(SEED_DATA)), // areaChecks, interview, matrix, grading, version
    sessions:[] // saved assessments
  };
  return s;
}
function saveStore(){try{localStorage.setItem(LS_KEY,JSON.stringify(STORE));}catch(e){toast('Gagal menyimpan: kemungkinan penyimpanan penuh');}}
let STORE=loadStore();

/* ---------- Auth ---------- */
function getAuth(){try{return JSON.parse(sessionStorage.getItem(AUTH_KEY))||null;}catch(e){return null;}}
function setAuth(a){sessionStorage.setItem(AUTH_KEY,JSON.stringify(a));}
function logout(){sessionStorage.removeItem(AUTH_KEY);DRAFT=null;render();}

/* ---------- App state ---------- */
let VIEW='home';          // home | assess | report | admin
let DRAFT=null;           // current assessment in progress
let ADMIN_TAB='area';     // area | items | matrix | sessions

/* ---------- Helpers ---------- */
const $=s=>document.querySelector(s);
const app=()=>$('#app');
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function toast(msg){const t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),2200);}
function gradeFor(score){
  if(score==null||isNaN(score))return{label:'—',color:'#6B7A72'};
  for(const g of STORE.config.grading){if(score>=g.min&&score<=g.max+0.0001)return g;}
  return score>=5?STORE.config.grading[STORE.config.grading.length-1]:STORE.config.grading[0];
}
const ASPECTS=['Ringkas','Rapi','Resik','Rawat'];

/* ---------- Scoring ----------
   Item biasa: per aspek 3 kriteria Ya/Tidak -> jumlah Ya: 3->4,2->3,1->2,0->1
   Interview: nilai langsung 1-5
*/
function aspectScore(yesCount){return Math.min(4,Math.max(1,yesCount+1));}

function computeReport(draft){
  // gather all aspect scores across selected areas + interview
  const rows=[]; // {area, aspek, score}
  let sum=0,n=0;
  draft.areas.forEach(areaId=>{
    const area=STORE.config.areaChecks.find(a=>a.id===areaId);if(!area)return;
    ASPECTS.forEach(asp=>{
      const krit=area.aspects[asp];if(!krit||!krit.length)return;
      let yes=0,answered=0;const detail=[];
      krit.forEach((q,i)=>{const v=draft.answers[`${areaId}|${asp}|${i}`];if(v==='ya')yes++;if(v)answered++;detail.push({q,v:v||null});});
      const sc=aspectScore(yes);
      rows.push({area:area.name,aspek:asp,score:sc,answered,total:krit.length,detail});
      sum+=sc;n++;
    });
  });
  // interview items (form-level, once per session)
  draft.interviewVals=draft.interviewVals||{};
  STORE.config.interview.forEach((it,idx)=>{
    const v=draft.interviewVals[idx];
    if(v){rows.push({area:it.area,aspek:it.aspek,score:v,interview:true});sum+=v;n++;}
  });
  const avg=n?sum/n:null;
  // per-5R aggregate for radar
  const per5={};['Ringkas','Rapi','Resik','Rawat','Rajin'].forEach(k=>per5[k]=[]);
  rows.forEach(r=>{
    const key=r.interview?'Rajin':r.aspek;
    if(per5[key])per5[key].push(r.score);
  });
  const radar={};Object.keys(per5).forEach(k=>{const a=per5[k];radar[k]=a.length?a.reduce((x,y)=>x+y,0)/a.length:0;});
  return {rows,avg,grade:gradeFor(avg),radar,n};
}

function draftProgress(draft){
  let total=0,done=0;
  draft.areas.forEach(areaId=>{
    const area=STORE.config.areaChecks.find(a=>a.id===areaId);if(!area)return;
    ASPECTS.forEach(asp=>{(area.aspects[asp]||[]).forEach((_,i)=>{total++;if(draft.answers[`${areaId}|${asp}|${i}`])done++;});});
  });
  STORE.config.interview.forEach((it,idx)=>{total++;if(draft.interviewVals&&draft.interviewVals[idx])done++;});
  return{total,done,pct:total?Math.round(done/total*100):0};
}

/* ---------- Photo handling (kompres agresif biar hemat storage) ---------- */
function handlePhoto(file,cb){
  if(!storageOK()){toast('Penyimpanan hampir penuh — mohon lakukan pencadangan dan hapus data lama terlebih dahulu');return;}
  const reader=new FileReader();
  reader.onload=e=>{
    const img=new Image();
    img.onload=()=>{
      const max=720;let{width:w,height:h}=img;          // turun dari 900 -> 720
      if(w>h&&w>max){h=h*max/w;w=max;}else if(h>max){w=w*max/h;h=max;}
      const cv=document.createElement('canvas');cv.width=w;cv.height=h;
      cv.getContext('2d').drawImage(img,0,0,w,h);
      const url=cv.toDataURL('image/jpeg',0.5);          // kualitas 0.6 -> 0.5
      cb(url);
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}
/* perkiraan sisa storage: localStorage limit ~5MB. Cek pemakaian sekarang. */
function storageUsage(){
  let bytes=0;try{for(const k in localStorage){if(localStorage.hasOwnProperty(k))bytes+=(localStorage[k].length+k.length)*2;}}catch(e){}
  return bytes; // approx bytes
}
function storageOK(){return storageUsage()<4.3*1024*1024;} // sisakan buffer dari ~5MB

/* main render dispatch defined in app2.js */
window.addEventListener('DOMContentLoaded',()=>{render();checkRemoteConfig();});

/* ===== FITUR 3: tarik config terbaru dari Google (kalau online) ===== */
async function checkRemoteConfig(){
  if(!SYNC_URL)return; // offline mode / belum setup
  // JANGAN timpa kalau admin punya editan lokal yang belum di-sync
  if(STORE.config&&STORE.config._dirty)return;
  try{
    const res=await fetch(SYNC_URL+'?action=config');
    const out=await res.json();
    if(!out.ok||!out.config)return; // belum ada config master di Google
    const remoteVer=out.config.version||0;
    const localVer=(STORE.config&&STORE.config.version)||0;
    if(remoteVer>localVer){
      STORE.config=out.config;
      saveStore();
      toast('📋 Form audit diperbarui ke versi '+remoteVer);
      if(VIEW==='home'||VIEW==='admin')render();
    }
  }catch(e){/* offline / gagal: diam saja, pakai config lokal */}
}

/* ================= RENDER ================= */
function render(){
  const auth=getAuth();
  if(!auth){renderLogin();return;}
  if(VIEW==='admin'&&auth.role==='admin'){renderAdmin();return;}
  if(VIEW==='assess'&&DRAFT){renderAssess();return;}
  if(VIEW==='report'&&DRAFT){renderReport();return;}
  if(VIEW==='findings'&&DRAFT){renderFindings();return;}
  if(VIEW==='dashboard'){renderDashboard();return;}
  if(VIEW==='dashnilai'){renderDashNilai();return;}
  renderHome();
}

/* ---------- LOGIN ---------- */
let loginRole='asesor';
function renderLogin(){
  app().innerHTML=`
  <div class="login-hero">
    <img src="${LOGO_5R}" alt="5R Komitmen Kita" class="login-logo5r">
    <h1>Assesment 5R</h1>
    <div class="tag">Audit Ringkas · Rapi · Resik · Rawat · Rajin — Direktorat Operasi</div>
    <div class="seg">
      <button class="${loginRole==='asesor'?'on':''}" onclick="loginRole='asesor';renderLogin()">Asesor</button>
      <button class="${loginRole==='admin'?'on':''}" onclick="loginRole='admin';renderLogin()">Admin</button>
    </div>
    <div id="login-err"></div>
    ${loginRole==='asesor'?`
      <label class="field"><span class="lbl">Nama Asesor</span>
        <input class="input" id="li-name" placeholder="Nama Lengkap" autocomplete="name"></label>
      <label class="field"><span class="lbl">Kata Sandi Asesor</span>
        <input class="input" id="li-pass" type="password" placeholder="••••••" inputmode="text"></label>
    `:`
      <label class="field"><span class="lbl">Kata Sandi Administrator</span>
        <input class="input" id="li-pass" type="password" placeholder="••••••"></label>
    `}
    <button class="btn btn-amber btn-block" style="margin-top:6px" onclick="doLogin()">Masuk</button>
    <div class="login-footer">
      <span class="cap">Dipersembahkan oleh</span>
      <img src="${LOGO_PL}" alt="Pertamina Lubricants" class="login-pl">
    </div>
  </div>`;
}
function doLogin(){
  const pass=($('#li-pass')||{}).value||'';
  const err=$('#login-err');
  if(loginRole==='admin'){
    if(pass!==ADMIN_PASS){err.innerHTML='<div class="login-err">Kata Sandi Administrator salah.</div>';return;}
    setAuth({role:'admin',name:'Admin'});VIEW='home';render();
  }else{
    const name=($('#li-name')||{}).value.trim();
    if(!name){err.innerHTML='<div class="login-err">Nama asesor wajib diisi.</div>';return;}
    if(pass!==ASESOR_PASS){err.innerHTML='<div class="login-err">Kata Sandi Asesor salah.</div>';return;}
    setAuth({role:'asesor',name});VIEW='home';render();
  }
}

/* ---------- TOPBAR ---------- */
function topbar(title,sub){
  const auth=getAuth();
  return `<div class="topbar">
    <button class="hb-btn" onclick="openDrawer()" title="Menu">☰</button>
    <img src="${LOGO_5R}" alt="5R" class="topbar-logo">
    <div><div class="ttl">${esc(title)}</div><div class="sub">${esc(sub||'')}</div></div>
    <div class="right">
      <span class="chip">${esc(auth.role)}</span>
      <button class="icon-btn" onclick="logout()" title="Keluar">⏻</button>
    </div></div>`;
}
function openDrawer(){
  const auth=getAuth();if(!auth)return;
  const dft=loadDraft();
  const mr=$('#modal-root');
  mr.innerHTML=`<div class="drawer-bg" id="drawer-bg" onclick="closeDrawer()"></div>
  <div class="drawer" id="drawer">
    <div class="drawer-head">
      <div class="nm">${esc(auth.name||'Pengguna')}</div>
      <div class="rl">${esc(auth.role)}</div>
    </div>
    <div class="drawer-nav">
      <button class="drawer-item" onclick="drawerGo('home')"><span class="di-ic">🏠</span> Beranda</button>
      ${auth.role==='admin'?`<button class="drawer-item" onclick="drawerGo('dashnilai')"><span class="di-ic">📊</span> Dashboard Nilai</button>`:''}
      <button class="drawer-item" onclick="drawerGo('dashboard')"><span class="di-ic">🔍</span> Dashboard Temuan</button>
      ${dft?`<button class="drawer-item" onclick="drawerResume()"><span class="di-ic">📝</span> Lanjutkan Konsep Tersimpan</button>`:''}
      ${auth.role==='admin'?`<button class="drawer-item" onclick="drawerGo('admin')"><span class="di-ic">⚙️</span> Kelola Formulirulir & Butir Audit</button>`:''}
      <button class="drawer-item danger" onclick="closeDrawer();logout()"><span class="di-ic">🚪</span> Keluar</button>
    </div>
    <div class="drawer-foot">Assesment 5R · Direktorat Operasi</div>
  </div>`;
  requestAnimationFrame(()=>{$('#drawer-bg').classList.add('on');$('#drawer').classList.add('on');});
}
function closeDrawer(){
  const bg=$('#drawer-bg'),dr=$('#drawer');
  if(bg)bg.classList.remove('on');if(dr)dr.classList.remove('on');
  setTimeout(()=>{const mr=$('#modal-root');if(mr)mr.innerHTML='';},250);
}
function drawerGo(view){
  closeDrawer();
  if(view==='admin'&&getAuth().role!=='admin')return;
  VIEW=view;render();
}
function drawerResume(){closeDrawer();resumeDraft();}

/* ---------- HOME ---------- */
let homePU=null;
function renderHome(){
  const auth=getAuth();
  const pus=Object.keys(STORE.config.matrix);
  if(!homePU)homePU=pus[0];
  const locs=Object.keys(STORE.config.matrix[homePU]||{});
  const dft=loadDraft();
  const resumeHtml=dft?`<div class="card" style="border:2px solid var(--amber);background:#FFF8EA">
      <div style="font-weight:800;font-family:Archivo;margin-bottom:4px">Lanjutkan Penilaian yang Belum Selesai?</div>
      <p class="hint" style="margin-bottom:12px">Terdapat penilaian yang belum selesai: <b>${esc(dft.pu)} — ${esc(dft.loc)}</b> (${draftProgress(dft).pct}% terisi).</p>
      <div style="display:flex;gap:10px">
        <button class="btn btn-amber" style="flex:1" onclick="resumeDraft()">Lanjutkan</button>
        <button class="btn btn-ghost btn-sm" onclick="discardDraft()">Batalkan</button>
      </div></div>`:'';
  app().innerHTML=topbar('Assesment 5R','Selamat datang, '+auth.name)+`
  <div class="wrap">
    ${resumeHtml}
    <div class="card">
      <h2>Mulai Penilaian</h2>
      <p class="hint">Pilih periode, tahun, jenis penilaian, Production Unit, dan lokasi yang akan dinilai.</p>
      <label class="field"><span class="lbl">Periode</span>
        <select class="input" id="h-periode">
          <option value="Mid Year">Mid Year ${new Date().getFullYear()}</option>
          <option value="End Year">End Year ${new Date().getFullYear()}</option>
        </select></label>
      <div style="display:flex;gap:10px">
        <label class="field" style="flex:1"><span class="lbl">Tahun</span>
          <select class="input" id="h-tahun">${tahunOptions()}</select></label>
        <label class="field" style="flex:1"><span class="lbl">Jenis</span>
          <select class="input" id="h-jenis">
            <option value="Resmi">Resmi</option>
            <option value="Internal">Internal</option>
          </select></label>
      </div>
      <label class="field"><span class="lbl">Production Unit</span>
        <select class="input" id="h-pu" onchange="homePU=this.value;renderHome()">
          ${pus.map(p=>`<option ${p===homePU?'selected':''}>${esc(p)}</option>`).join('')}
        </select></label>
      <label class="field"><span class="lbl">Lokasi / Area</span>
        <select class="input" id="h-loc">
          ${locs.map(l=>`<option>${esc(l)}</option>`).join('')}
        </select></label>
      <button class="btn btn-primary btn-block" onclick="startAssess()">Mulai →</button>
    </div>

    ${STORE.sessions.length?`<div class="card">
      <h2>Riwayat Penilaian Tersimpan</h2>
      <p class="hint">${STORE.sessions.length} penilaian tersimpan pada perangkat ini.</p>
      ${STORE.sessions.slice().reverse().slice(0,8).map(s=>{
        const g=gradeFor(s.avg);
        return `<div class="area-item" onclick="openSession('${s.id}')">
          <div><div class="nm">${esc(s.pu)} — ${esc(s.loc)}</div>
          <div class="st">${esc(s.periode||"")}${s.tahun?' '+esc(s.tahun):''}${s.jenis?' · '+esc(s.jenis):''} · ${esc(s.date)} · ${esc(s.asesor)}</div></div>
          <span class="badge done" style="background:${g.color}">${s.avg?s.avg.toFixed(2):'—'}</span>
          <span class="chev">›</span></div>`;
      }).join('')}
      <button class="btn btn-ghost btn-block btn-sm" style="margin-top:8px;color:var(--red);border-color:#E6B0AA" onclick="clearMyData()">Hapus Data pada Perangkat Ini</button>
    </div>`:''}

    ${auth.role==='admin'?`<button class="btn btn-ghost btn-block" style="margin-bottom:10px" onclick="VIEW='admin';render()">⚙ Kelola Formulirulir & Butir Audit</button>`:''}
    <button class="btn btn-ghost btn-block" onclick="VIEW='dashboard';render()">Dashboard Analisis Temuan</button>
  </div>`;
}

function clearMyData(){
  const unsynced=STORE.sessions.filter(s=>!s.synced).length;
  if(unsynced>0){
    if(!confirm(`⚠️ PERINGATAN: ada ${unsynced} assessment yang BELUM terkirim ke Google.\n\nKalau dihapus sekarang, data itu HILANG PERMANEN dan tidak bisa dikembalikan.\n\nDisarankan kirim dulu (☁) sebelum hapus. Tetap hapus?`))return;
    if(!confirm(`Yakin? ${unsynced} data yang belum terkirim akan benar-benar hilang.`))return;
  }else{
    if(!confirm('Hapus seluruh data penilaian pada perangkat ini? Seluruh data telah tersinkron ke Google sehingga aman untuk dihapus.'))return;
  }
  STORE.sessions=[];
  clearDraft();
  saveStore();
  toast('Data pada perangkat ini telah dihapus');
  renderHome();
}

function startAssess(){
  const pu=$('#h-pu').value, loc=$('#h-loc').value, periode=$('#h-periode').value;
  const tahun=parseInt(($('#h-tahun')||{}).value,10)||new Date().getFullYear();  // [MT]
  const jenis=($('#h-jenis')||{}).value||'Resmi';                                // [MT]
  // ANTI-DOUBLE: 1 PU+Lokasi+Periode+Tahun+Jenis cuma boleh sekali (cek data di HP ini) [MT]
  const dup=STORE.sessions.find(s=>s.pu===pu&&s.loc===loc&&(s.periode||'')===(periode||'')&&(s.tahun||'')===tahun&&(s.jenis||'Resmi')===jenis);
  if(dup){
    toast(`⛔ ${loc} (${pu}) ${periode} ${tahun} [${jenis}] sudah dinilai. Tidak boleh dobel.`);
    return;
  }
  const areas=(STORE.config.matrix[pu]||{})[loc]||[];
  // map area names -> ids
  const areaIds=areas.map(nm=>{const a=STORE.config.areaChecks.find(x=>x.name===nm);return a?a.id:null;}).filter(Boolean);
  DRAFT={id:'s'+Date.now(),pu,loc,periode,tahun,jenis,asesor:getAuth().name,date:new Date().toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}),
    areas:areaIds,answers:{},interviewVals:{},photos:{},notes:{},curArea:0};
  VIEW='assess';render();
}
function openSession(id){
  const s=STORE.sessions.find(x=>x.id===id);if(!s)return;
  DRAFT=JSON.parse(JSON.stringify(s));VIEW='report';render();
}
function resumeDraft(){const d=loadDraft();if(!d){toast('Konsep penilaian tidak ditemukan');renderHome();return;}DRAFT=d;VIEW='assess';render();}
function discardDraft(){if(!confirm('Batalkan isian yang belum selesai? Tidak bisa dikembalikan.'))return;clearDraft();renderHome();toast('Konsep penilaian telah dibatalkan');}

/* ---------- ASSESS ---------- */
function renderAssess(){
  const d=DRAFT;
  const prog=draftProgress(d);
  // area navigation: list of selected areas + a final "interview" step
  const totalSteps=d.areas.length+1; // +1 for interview step at end
  const step=d.curArea;
  const live=liveScore(d);
  const lg=gradeFor(live.avg);
  app().innerHTML=topbar(d.loc,d.pu+' · '+(d.periode||'')+' · '+d.asesor)+`
   <div class="spine">
     <div class="bar"><div class="fill" style="width:${prog.pct}%"></div></div>
     <div class="meta">
       <span>${prog.done}/${prog.total} terisi</span>
       <span id="live-score" style="font-weight:800;color:${lg.color}">${live.avg?'Total '+live.avg.toFixed(2)+' · '+lg.label:'Total —'}</span>
       <span id="save-ind" class="save-ind">✓ Tersimpan</span>
     </div>
   </div>
   <div class="wrap" id="assess-body"></div>
   <div class="botbar">
     <button class="btn btn-ghost" style="flex:.5" onclick="navArea(-1)" ${step===0?'disabled style="opacity:.4;flex:.5"':''}>‹ Balik</button>
     ${step<totalSteps-1
       ?`<button class="btn btn-primary" onclick="navArea(1)">Lanjut ›</button>`
       :`<button class="btn btn-amber" onclick="finishAssess()">Lihat Hasil ✓</button>`}
   </div>`;
  renderAssessBody();
}
/* nilai total berjalan (rata-rata seluruh aspek dan interview yang sudah terisi) */
function liveScore(d){
  let sum=0,n=0;
  d.areas.forEach(areaId=>{
    const area=STORE.config.areaChecks.find(a=>a.id===areaId);if(!area)return;
    ASPECTS.forEach(asp=>{
      const krit=area.aspects[asp];if(!krit||!krit.length)return;
      const anyAns=krit.some((_,i)=>d.answers[`${areaId}|${asp}|${i}`]);
      if(!anyAns)return;
      let yes=0;krit.forEach((_,i)=>{if(d.answers[`${areaId}|${asp}|${i}`]==='ya')yes++;});
      sum+=aspectScore(yes);n++;
    });
  });
  (d.interviewVals?Object.values(d.interviewVals):[]).forEach(v=>{if(v){sum+=v;n++;}});
  return{avg:n?sum/n:null,n};
}
function renderAssessBody(){
  const d=DRAFT, step=d.curArea, body=$('#assess-body');
  // step 0 = interview (di AWAL)
  if(step===0){
    body.innerHTML=`<div class="card"><h2>Wawancara Operator dan Supervisor</h2>
      <p class="hint">Dilaksanakan pada tahap awal. Berikan nilai 1 (paling rendah) sampai 5 (paling baik) sesuai kondisi sebenarnya.</p></div>`
      + STORE.config.interview.map((it,idx)=>{
        const val=d.interviewVals[idx]||0;
        const desc=val?it.rubrik[val-1]:'';
        return `<div class="card">
          <div class="aspect-head"><span class="tag5r t-Rajin">RAJIN</span> ${esc(it.area)} — ${esc(it.aspek)}</div>
          <div class="scale">${[1,2,3,4,5].map(n=>`<button class="${val===n?'on':''}" onclick="setInterview(${idx},${n})">${n}</button>`).join('')}</div>
          <div class="scale-desc" id="idesc-${idx}">${esc(desc)}</div>
        </div>`;
      }).join('')
      + (d.areas.length===0?`<div class="card"><h2>Belum Terdapat Area Penilaian</h2>
      <p class="hint">Tambahkan area yang akan dinilai di lapangan.</p>
      <button class="btn btn-primary btn-block" onclick="showAddArea()">+ Tambah Area Pemeriksaan</button></div>`:'');
    return;
  }
  const areaIdx=step-1; // area dimulai step 1
  const areaId=d.areas[areaIdx];
  const area=STORE.config.areaChecks.find(a=>a.id===areaId);
  if(!area){body.innerHTML='<div class="empty">Area tidak ditemukan.</div>';return;}
  let html=`<div class="card" style="background:var(--green);color:#fff;border:none">
    <div style="font-size:12px;opacity:.7;font-weight:700;letter-spacing:.05em">AREA ${areaIdx+1} DARI ${d.areas.length}</div>
    <h2 style="color:#fff;margin-top:4px">${esc(area.name)}</h2>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <button class="btn btn-sm" style="background:rgba(255,255,255,.15);color:#fff" onclick="removeAreaFromSession('${areaId}')">✕ Tidak Ditemukan di Lapangan</button>
      <button class="btn btn-sm" style="background:rgba(255,255,255,.15);color:#fff" onclick="showAddArea()">+ Tambah Area Lain</button>
    </div>
    </div>`;
  ASPECTS.forEach(asp=>{
    const krit=area.aspects[asp];if(!krit||!krit.length)return;
    let yes=0;krit.forEach((_,i)=>{if(d.answers[`${areaId}|${asp}|${i}`]==='ya')yes++;});
    const anyAns=krit.some((_,i)=>d.answers[`${areaId}|${asp}|${i}`]);
    html+=`<div class="aspect"><div class="aspect-head">
      <span class="tag5r t-${asp}">${asp.toUpperCase()}</span>
      <span class="aspect-score">${anyAns?'Nilai '+aspectScore(yes):''}</span></div>`;
    krit.forEach((q,i)=>{
      const key=`${areaId}|${asp}|${i}`;const v=d.answers[key];
      html+=`<div class="crit"><div class="q">${esc(q)}</div>
        <div class="yn">
          <button class="ya ${v==='ya'?'on':''}" onclick="setAns('${key}','ya')"><span class="ic">✓</span>Ya</button>
          <button class="tidak ${v==='tidak'?'on':''}" onclick="setAns('${key}','tidak')"><span class="ic">✕</span>Tidak</button>
        </div></div>`;
    });
    // photo + note PER ASPEK
    const akey=`${areaId}|${asp}`;
    const photos=d.photos[akey]||[];
    html+=`<div class="finding">
      <div class="finding-lbl">Temuan dan Dokumentasi Foto — ${asp} <span style="color:var(--muted);font-weight:400">(${photos.length}/5)</span></div>
      <div class="photo-row">
        ${photos.map((p,i)=>`<img src="${p}" class="photo-thumb" onclick="rmPhoto('${akey}',${i})">`).join('')}
        ${photos.length<5?`<label class="photo-add">+<input type="file" accept="image/*" capture="environment" style="display:none" onchange="addPhoto('${akey}',this)"></label>`:''}
      </div>
      <textarea class="note-input" placeholder="Catatan temuan ${asp.toLowerCase()}…" oninput="d_setNote('${akey}',this.value)">${esc(d.notes[akey]||'')}</textarea>
    </div>`;
    html+=`</div>`;
  });
  body.innerHTML=html;
}
function isLocked(){return !!(DRAFT&&DRAFT.locked);}
function lockBlock(){toast('Sesi telah terkunci karena sudah dikirim ke Google. Perubahan tidak dapat dilakukan.');}
function unlockSession(){
  const auth=getAuth();if(!auth||auth.role!=='admin'){toast('Hanya administrator yang dapat membuka kunci sesi');return;}
  if(!confirm('Buka kunci sesi ini untuk melakukan koreksi? Setelah diperbarui, sesi WAJIB disinkronkan ulang ke Google agar data tetap konsisten.'))return;
  DRAFT.locked=false;
  const i=STORE.sessions.findIndex(s=>s.id===DRAFT.id);
  if(i>=0)STORE.sessions[i].locked=false;
  saveStore();render();toast('Kunci telah dibuka — mohon lakukan sinkronisasi ulang setelah pembaruan selesai');
}
function setAns(key,val){if(isLocked())return lockBlock();DRAFT.answers[key]=DRAFT.answers[key]===val?undefined:val;saveDraftLite();renderAssessBody();updateSpine();}
function setInterview(idx,n){if(isLocked())return lockBlock();DRAFT.interviewVals[idx]=DRAFT.interviewVals[idx]===n?0:n;saveDraftLite();renderAssessBody();updateSpine();}
function d_setNote(areaId,v){if(isLocked())return;DRAFT.notes[areaId]=v;saveDraftLite();}
function updateSpine(){const p=draftProgress(DRAFT);const f=$('.spine .fill');if(f){f.style.width=p.pct+'%';const m=$('.spine .meta span');if(m)m.textContent=`${p.done}/${p.total} terisi`;}
  const ls=$('#live-score');if(ls){const lv=liveScore(DRAFT);const g=gradeFor(lv.avg);ls.style.color=g.color;ls.textContent=lv.avg?'Total '+lv.avg.toFixed(2)+' · '+g.label:'Total —';}}
function navArea(dir){DRAFT.curArea=Math.max(0,Math.min(DRAFT.areas.length,DRAFT.curArea+dir));saveDraftLite();window.scrollTo(0,0);renderAssess();}

/* ---- Dinamika area saat assessment (concern 4) ---- */
function removeAreaFromSession(areaId){
  if(isLocked())return lockBlock();
  const area=STORE.config.areaChecks.find(a=>a.id===areaId);
  if(!confirm(`Hapus area "${area?area.name:''}" dari penilaian ini? (tidak menghapus data induk formulir)`))return;
  // clear answers/photos/notes for this area
  Object.keys(DRAFT.answers).forEach(k=>{if(k.startsWith(areaId+'|'))delete DRAFT.answers[k];});
  Object.keys(DRAFT.photos).forEach(k=>{if(k.startsWith(areaId+'|')||k===areaId)delete DRAFT.photos[k];});
  Object.keys(DRAFT.notes).forEach(k=>{if(k.startsWith(areaId+'|')||k===areaId)delete DRAFT.notes[k];});
  DRAFT.areas=DRAFT.areas.filter(id=>id!==areaId);
  // step area = index+1; clamp ke step terakhir yang valid (areas.length)
  if(DRAFT.curArea>DRAFT.areas.length)DRAFT.curArea=Math.max(0,DRAFT.areas.length);
  saveDraftLite();renderAssess();toast('Area telah dihapus dari sesi ini');
}
function showAddArea(){
  const avail=STORE.config.areaChecks.filter(a=>!DRAFT.areas.includes(a.id));
  if(!avail.length){toast('Seluruh area telah ditambahkan');return;}
  $('#modal-root').innerHTML=`<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal">
    <h3>Tambah Area ke Penilaian</h3>
    <p class="hint">Pilih area yang ditemukan pada saat pemeriksaan lapangan.</p>
    ${avail.map(a=>`<div class="list-row"><div class="nm">${esc(a.name)}</div>
      <button class="btn btn-primary btn-sm" onclick="addAreaToSession('${a.id}')">+ Tambah</button></div>`).join('')}
    <button class="btn btn-ghost btn-block" style="margin-top:10px" onclick="closeModal()">Tutup</button>
  </div></div>`;
}
function addAreaToSession(areaId){
  if(isLocked())return lockBlock();
  if(!DRAFT.areas.includes(areaId))DRAFT.areas.push(areaId);
  DRAFT.curArea=DRAFT.areas.length; // step = area index(N-1)+1 = N, jump ke area baru
  saveDraftLite();closeModal();renderAssess();toast('Area telah ditambahkan');
}
function addPhoto(areaId,inp){if(isLocked())return lockBlock();const f=inp.files[0];if(!f)return;if((DRAFT.photos[areaId]||[]).length>=5){toast('Maksimal 5 foto untuk setiap aspek');return;}handlePhoto(f,url=>{(DRAFT.photos[areaId]=DRAFT.photos[areaId]||[]).push(url);saveDraftLite();renderAssessBody();});}
function rmPhoto(areaId,i){if(isLocked())return lockBlock();if(confirm('Hapus foto ini?')){DRAFT.photos[areaId].splice(i,1);saveDraftLite();renderAssessBody();}}

/* ---------- Auto-save draft ---------- */
const DRAFT_KEY='asesmen5r_draft';
let saveTimer=null;
function saveDraftLite(){
  if(!DRAFT)return;
  try{
    localStorage.setItem(DRAFT_KEY,JSON.stringify(DRAFT));
    flashSaved();
  }catch(e){
    // storage penuh
    toast('Penyimpanan penuh — mohon kurangi jumlah foto atau lakukan pencadangan terlebih dahulu');
  }
}
function flashSaved(){
  const el=$('#save-ind');if(!el)return;
  el.textContent='✓ Tersimpan';el.classList.add('on');
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{el.classList.remove('on');},1400);
}
function clearDraft(){try{localStorage.removeItem(DRAFT_KEY);}catch(e){}}
function loadDraft(){try{const r=localStorage.getItem(DRAFT_KEY);return r?JSON.parse(r):null;}catch(e){return null;}}

/* ---------- Temuan (findings) ----------
   Auto-suggest dari aspek yang ada jawaban "Tidak" (kriteria gagal).
   Tiap temuan: area, kategori 5R, deskripsi, saran, status, foto, dll. Bisa diedit/tambah/hapus.
*/
const R5MAP={'Ringkas':'R1','Rapi':'R2','Resik':'R3','Rawat':'R4','Rajin':'R5'};
function generateFindings(draft){
  const out=[];
  draft.areas.forEach(areaId=>{
    const area=STORE.config.areaChecks.find(a=>a.id===areaId);if(!area)return;
    ASPECTS.forEach(asp=>{
      const krit=area.aspects[asp];if(!krit||!krit.length)return;
      // hitung skor aspek
      let yes=0;krit.forEach((_,i)=>{if(draft.answers[`${areaId}|${asp}|${i}`]==='ya')yes++;});
      const skor=aspectScore(yes);
      if(skor>2)return; // hanya aspek skor rendah (1-2) yang jadi temuan
      // klausul yang BUKAN 'ya' (Tidak / belum dijawab) = yang perlu diperbaiki
      const gagal=krit.filter((_,i)=>draft.answers[`${areaId}|${asp}|${i}`]!=='ya');
      out.push({
        id:'f'+Date.now()+Math.random().toString(36).slice(2,6),
        area:area.name, kategori:asp, r5:R5MAP[asp],
        skor,
        deskripsi:`[Nilai ${skor}] ${asp} belum terpenuhi: ${gagal.join('; ')}`,
        foto:(draft.photos&&draft.photos[`${areaId}|${asp}`]&&draft.photos[`${areaId}|${asp}`][0])||'',
        saran:'', target:String(new Date().getFullYear()),
        fotoPerbaikan:'', deskPerbaikan:'', tglPerbaikan:'',
        status:'Open', verifikator:'', auto:true
      });
    });
  });
  return out;
}
function finishAssess(){
  const rep=computeReport(DRAFT);
  DRAFT.avg=rep.avg;DRAFT.finishedAt=new Date().toISOString();
  // hasilkan temuan hanya jika belum ada (agar perubahan manual tidak tertimpa)
  if(!DRAFT.findings)DRAFT.findings=generateFindings(DRAFT);
  // upsert into sessions
  const i=STORE.sessions.findIndex(s=>s.id===DRAFT.id);
  const rec=JSON.parse(JSON.stringify(DRAFT));
  if(i>=0)STORE.sessions[i]=rec;else STORE.sessions.push(rec);
  saveStore();clearDraft();VIEW='report';render();
}
function saveDraftSession(){
  // simpan perubahan temuan ke sessions (dipakai saat edit temuan dari report)
  const i=STORE.sessions.findIndex(s=>s.id===DRAFT.id);
  if(i>=0)STORE.sessions[i]=JSON.parse(JSON.stringify(DRAFT));
  saveStore();
}

/* ===== FASE 2: kirim sesi ke Google Apps Script ===== */
function buildSyncPayload(rec){
  const rep=computeReport(rec);
  const detail=[];
  rec.areas.forEach(areaId=>{
    const area=STORE.config.areaChecks.find(a=>a.id===areaId);if(!area)return;
    ASPECTS.forEach(asp=>{
      const krit=area.aspects[asp];if(!krit||!krit.length)return;
      let yes=0;krit.forEach((_,i)=>{if(rec.answers[`${areaId}|${asp}|${i}`]==='ya')yes++;});
      const skor=aspectScore(yes);
      krit.forEach((q,i)=>{
        const v=rec.answers[`${areaId}|${asp}|${i}`];
        detail.push({area:area.name,aspek:asp,no:i+1,klausul:q,
          jawaban:v==='ya'?'Ya':v==='tidak'?'Tidak':'belum',skor});
      });
    });
  });
  // [MT] pastikan tahun & jenis ikut terkirim ke Code.gs (kolom Tahun/Jenis)
  const recOut=Object.assign({},rec,{
    tahun:(rec.tahun!=null&&rec.tahun!==''?rec.tahun:new Date().getFullYear()),
    jenis:(rec.jenis||'Resmi')
  });
  return {secret:SYNC_SECRET,configVersion:(STORE.config.version||1),
    predikat:rep.grade.label,record:recOut,detail,
    findings:(rec.findings||[]).map(f=>({
      id:f.id,area:f.area,kategori:f.kategori,skor:f.skor||'',
      deskripsi:f.deskripsi||'',penyebab:f.penyebab||'',saran:f.saran||'',target:f.target||'',
      deskPerbaikan:f.deskPerbaikan||'',tglPerbaikan:f.tglPerbaikan||'',
      status:f.status||'Open',verifikator:f.verifikator||''
    }))};
}
async function syncSession(id){
  if(!SYNC_URL){alert('Alamat sinkronisasi (SYNC_URL) belum diatur.');return;}
  const rec=STORE.sessions.find(s=>s.id===id);
  if(!rec){alert('Sesi tidak ditemukan.');return;}
  toast('Sedang mengirim data ke Google…');
  try{
    const res=await fetch(SYNC_URL,{method:'POST',
      headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify(buildSyncPayload(rec))});
    const out=await res.json();
    if(out.ok){
      rec.synced=true;rec.syncedAt=new Date().toISOString();rec.locked=true;
      rec.syncCount=out.syncCount||((rec.syncCount||0)+1);saveStore();
      alert('BERHASIL DIKIRIM\n\n'+esc(rec.pu)+' — '+esc(rec.loc)+'\nJumlah foto terkirim: '+(out.photos||0)+'\n\nSesi ini kini terkunci dan hanya dapat dibaca.');
      if(VIEW==='admin')renderAdmin();
      if(VIEW==='report')render();
    }else alert('GAGAL mengirim data.\n\nPenyebab: '+(out.error||'tidak diketahui'));
  }catch(e){alert('GAGAL mengirim data. Mohon periksa sinyal atau koneksi internet.\n\nRincian: '+e.message);}
}
async function syncAllUnsynced(){
  if(!SYNC_URL){alert('Alamat sinkronisasi (SYNC_URL) belum diatur.');return;}
  const pending=STORE.sessions.filter(s=>!s.synced);
  if(!pending.length){alert('Seluruh data telah tersinkron ke Google.');return;}
  if(!confirm('Kirim '+pending.length+' penilaian yang belum tersinkron ke Google?'))return;
  toast(`Sedang mengirim ${pending.length} sesi…`);
  let ok=0,gagal=0;
  for(const s of pending){
    try{
      const res=await fetch(SYNC_URL,{method:'POST',
        headers:{'Content-Type':'text/plain;charset=utf-8'},
        body:JSON.stringify(buildSyncPayload(s))});
      const out=await res.json();
      if(out.ok){s.synced=true;s.syncedAt=new Date().toISOString();s.locked=true;s.syncCount=out.syncCount||((s.syncCount||0)+1);ok++;}
      else gagal++;
    }catch(e){gagal++;}
  }
  saveStore();renderAdmin();
  alert('PENGIRIMAN SELESAI\n\nBerhasil: '+ok+'\nGagal: '+gagal+(gagal?'\n\nData yang gagal terkirim dapat dicoba kembali.':''));
}

/* ---------- REPORT ---------- */
function renderReport(){
  const d=DRAFT, rep=computeReport(d), g=rep.grade;
  const auth=getAuth();const isAdmin=auth&&auth.role==='admin';
  const lockBanner=d.locked?`<div class="card" style="background:#FEF9EC;border-color:#F5DFA0;display:flex;align-items:center;gap:12px">
    <span style="font-size:22px">🔒</span>
    <div style="flex:1"><div style="font-weight:800;font-size:14px">Sesi Terkunci</div>
    <div style="font-size:12px;color:var(--muted)">Telah dikirim ke Google${d.syncCount?` (${d.syncCount}×)`:''}${d.syncedAt?' · '+new Date(d.syncedAt).toLocaleString('id-ID'):''}. Perubahan dinonaktifkan.</div></div>
    ${isAdmin?`<button class="btn btn-sm btn-amber" onclick="unlockSession()">Buka Kunci</button>`:''}
  </div>`:'';
  app().innerHTML=topbar('Hasil Penilaian',d.pu+' · '+d.loc)+`
  <div class="wrap">
    ${lockBanner}
    <div class="predikat-hero" style="background:linear-gradient(135deg,${g.color},${shade(g.color,-18)})">
      <div class="score">${rep.avg?rep.avg.toFixed(2):'—'}</div>
      <div class="lbl">${esc(g.label)}</div>
      <div class="sub">${esc(d.periode||"")}${d.tahun?' '+esc(d.tahun):''}${d.jenis?' · '+esc(d.jenis):''} · ${esc(d.loc)} · ${esc(d.date)} · ${esc(d.asesor)}</div>
    </div>
    <div class="radar-wrap">
      <div style="font-weight:800;font-family:Archivo;margin-bottom:10px">Profil 5R</div>
      ${radarSVG(rep.radar)}
    </div>
    <div class="card">
      <h2>Rincian Nilai</h2>
      <p class="hint">Ketuk salah satu baris untuk melihat klausul yang menentukan nilai tersebut.</p>
      <table class="rep"><thead><tr><th>Area</th><th>Aspek</th><th class="num">Nilai</th></tr></thead><tbody>
      ${rep.rows.map((r,ri)=>{
        const expandable=!r.interview&&r.detail&&r.detail.length;
        const head=`<tr class="rep-head${expandable?' tappable':''}"${expandable?` onclick="toggleDetail(${ri})"`:''}>
          <td>${esc(r.area)}</td>
          <td>${esc(r.aspek)}${r.interview?' <span style="font-size:10px;color:var(--amber)">●interview</span>':''}${expandable?` <span class="exp-caret" id="caret-${ri}">▸</span>`:''}</td>
          <td class="num" style="color:${gradeFor(r.score).color}">${r.score}</td></tr>`;
        if(!expandable)return head;
        const body=`<tr class="rep-detail hidden" id="detail-${ri}"><td colspan="3" style="padding:0 8px 12px">
          ${r.detail.map(d=>{
            const ic=d.v==='ya'?'<span style="color:var(--lime);font-weight:800">✓</span>':d.v==='tidak'?'<span style="color:var(--red);font-weight:800">✗</span>':'<span style="color:var(--muted)">–</span>';
            const tag=d.v==='ya'?'Ya':d.v==='tidak'?'Tidak':'belum';
            const col=d.v==='ya'?'var(--lime)':d.v==='tidak'?'var(--red)':'var(--muted)';
            return `<div class="klausul-row"><span class="kl-ic">${ic}</span><span class="kl-q">${esc(d.q)}</span><span class="kl-tag" style="color:${col}">${tag}</span></div>`;
          }).join('')}
        </td></tr>`;
        return head+body;
      }).join('')}
      </tbody></table>
    </div>
    ${reportNotes(d)}
    ${findingsCard(d)}
    <div class="card">
      <h2>Ekspor Data</h2>
      <p class="hint">Simpan hasil penilaian untuk keperluan laporan atau kearsipan.</p>
      ${SYNC_URL?`<button class="btn btn-primary btn-block" style="margin-bottom:10px" onclick="syncSession('${d.id}')">Kirim ke Google</button>`:''}
      <button class="btn btn-ghost btn-block" style="margin-bottom:10px" onclick="exportCSV()">Unduh sebagai CSV (Excel)</button>
      <button class="btn btn-ghost btn-block" onclick="window.print()">Cetak atau Simpan sebagai PDF</button>
    </div>
  </div>
  <div class="botbar">
    <button class="btn btn-ghost" onclick="VIEW='assess';render()">‹ Ubah</button>
    <button class="btn btn-primary" onclick="VIEW='home';DRAFT=null;render()">Selesai</button>
  </div>`;
}
function toggleDetail(ri){
  const row=document.getElementById('detail-'+ri),caret=document.getElementById('caret-'+ri);
  if(!row)return;
  const open=row.classList.toggle('hidden');
  if(caret)caret.textContent=open?'▸':'▾';
}
function reportNotes(d){
  const items=[];
  const keys=new Set([...Object.keys(d.notes||{}),...Object.keys(d.photos||{})]);
  keys.forEach(k=>{
    const note=(d.notes||{})[k], photos=((d.photos||{})[k])||[];
    if(!note&&!photos.length)return;
    // key format: areaId|aspek  (or legacy areaId)
    const parts=k.split('|');
    const a=STORE.config.areaChecks.find(x=>x.id===parts[0]);
    const label=(a?a.name:parts[0])+(parts[1]?' — '+parts[1]:'');
    items.push({label,note,photos});
  });
  if(!items.length)return '';
  return `<div class="card"><h2>Temuan dan Dokumentasi Foto</h2>
    ${items.map(it=>`<div style="margin-bottom:14px">
      <div style="font-weight:700;font-size:14px;margin-bottom:4px">${esc(it.label)}</div>
      ${it.note?`<div style="font-size:13px;color:var(--muted);margin-bottom:6px">${esc(it.note)}</div>`:''}
      <div class="photo-row">${it.photos.map(p=>`<img src="${p}" class="photo-thumb">`).join('')}</div>
    </div>`).join('')}</div>`;
}
function shade(hex,pct){
  const n=parseInt(hex.slice(1),16);let r=(n>>16)+pct,g=((n>>8)&255)+pct,b=(n&255)+pct;
  r=Math.max(0,Math.min(255,r));g=Math.max(0,Math.min(255,g));b=Math.max(0,Math.min(255,b));
  return '#'+((r<<16)|(g<<8)|b).toString(16).padStart(6,'0');
}
function radarSVG(radar){
  const keys=['Ringkas','Rapi','Resik','Rawat','Rajin'];
  const cx=140,cy=130,R=95,N=keys.length;
  function pt(i,r){const ang=-Math.PI/2+i*2*Math.PI/N;return[cx+r*Math.cos(ang),cy+r*Math.sin(ang)];}
  let grid='';
  [1,2,3,4,5].forEach(lv=>{
    const pts=keys.map((_,i)=>pt(i,R*lv/5).join(',')).join(' ');
    grid+=`<polygon points="${pts}" fill="none" stroke="#D6DED8" stroke-width="1"/>`;
  });
  let axes='',labels='';
  keys.forEach((k,i)=>{
    const[x,y]=pt(i,R);axes+=`<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#D6DED8"/>`;
    const[lx,ly]=pt(i,R+20);
    labels+=`<text x="${lx}" y="${ly}" font-size="11" font-weight="700" fill="#14201B" text-anchor="middle" dominant-baseline="middle">${k}</text>
      <text x="${lx}" y="${ly+12}" font-size="10" fill="#1E7A5A" text-anchor="middle">${(radar[k]||0).toFixed(1)}</text>`;
  });
  const dataPts=keys.map((k,i)=>pt(i,R*(radar[k]||0)/5).join(',')).join(' ');
  return `<svg viewBox="0 0 280 270" style="width:100%;max-width:320px;display:block;margin:0 auto">
    ${grid}${axes}
    <polygon points="${dataPts}" fill="rgba(57,181,74,.25)" stroke="#1E7A5A" stroke-width="2.5"/>
    ${keys.map((k,i)=>{const[x,y]=pt(i,R*(radar[k]||0)/5);return `<circle cx="${x}" cy="${y}" r="3.5" fill="#0B3D2E"/>`;}).join('')}
    ${labels}
  </svg>`;
}
function exportCSV(){
  const d=DRAFT,rep=computeReport(d);
  let rows=[['Periode',d.periode||''],['Tahun',d.tahun||''],['Jenis',d.jenis||'Resmi'],['Production Unit',d.pu],['Lokasi',d.loc],['Asesor',d.asesor],['Tanggal',d.date],['Nilai Akhir',rep.avg?rep.avg.toFixed(2):''],['Predikat',rep.grade.label],[],['Area','Aspek','Nilai','Catatan']];
  rep.rows.forEach(r=>rows.push([r.area,r.aspek+(r.interview?' (interview)':''),r.score,'']));
  rows.push([]);rows.push(['Rincian Klausul']);rows.push(['Area','Aspek','Klausul','Jawaban']);
  rep.rows.forEach(r=>{if(r.detail)r.detail.forEach(dt=>rows.push([r.area,r.aspek,dt.q,dt.v==='ya'?'Ya':dt.v==='tidak'?'Tidak':'belum dijawab']));});
  rows.push([]);rows.push(['Temuan']);
  Object.keys(d.notes||{}).forEach(k=>{if(d.notes[k]){const parts=k.split('|');const a=STORE.config.areaChecks.find(x=>x.id===parts[0]);rows.push([(a?a.name:parts[0])+(parts[1]?' — '+parts[1]:''),d.notes[k]]);}});
  const csv=rows.map(r=>r.map(c=>`"${String(c==null?'':c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=`Assesment5R_${d.pu}_${d.loc}_${d.date}.csv`.replace(/[^\w.\-]/g,'_');a.click();
  toast('Berkas CSV telah diunduh');
}

/* ---------- ADMIN CMS ---------- */
function renderAdmin(){
  app().innerHTML=topbar('Kelola Formulir','Mode Administrator')+`
  <div class="wrap">
    <div class="adm-tab">
      <button class="${ADMIN_TAB==='area'?'on':''}" onclick="ADMIN_TAB='area';renderAdmin()">Area Pemeriksaan</button>
      <button class="${ADMIN_TAB==='matrix'?'on':''}" onclick="ADMIN_TAB='matrix';renderAdmin()">Formulir per Lokasi</button>
      <button class="${ADMIN_TAB==='target'?'on':''}" onclick="ADMIN_TAB='target';renderAdmin()">Target Nilai</button>
      <button class="${ADMIN_TAB==='sessions'?'on':''}" onclick="ADMIN_TAB='sessions';renderAdmin()">Data Tersimpan</button>
      <button class="${ADMIN_TAB==='data'?'on':''}" onclick="ADMIN_TAB='data';renderAdmin()">Pencadangan</button>
    </div>
    <div id="adm-body"></div>
  </div>
  <div class="botbar"><button class="btn btn-primary btn-block" onclick="VIEW='home';render()">‹ Kembali ke Beranda</button></div>`;
  const b=$('#adm-body');
  if(ADMIN_TAB==='area')b.innerHTML=admArea();
  else if(ADMIN_TAB==='matrix')b.innerHTML=admMatrix();
  else if(ADMIN_TAB==='target')b.innerHTML=admTarget();
  else if(ADMIN_TAB==='sessions')b.innerHTML=admSessions();
  else b.innerHTML=admData();
}
function admArea(){
  return `<div class="card"><h2>Master Area Pemeriksaan</h2>
    <p class="hint">${STORE.config.areaChecks.length} area. Ketuk untuk mengubah aspek dan kriteria (Ya/Tidak).</p>
    <button class="btn btn-amber btn-sm" onclick="editArea(null)">+ Tambah Area Pemeriksaan</button></div>
    ${STORE.config.areaChecks.map(a=>{
      const nItems=ASPECTS.reduce((s,asp)=>s+((a.aspects[asp]||[]).length),0);
      return `<div class="list-row"><div class="nm">${esc(a.name)}<div style="font-size:12px;color:var(--muted);font-weight:400">${nItems} kriteria</div></div>
        <button class="btn btn-ghost btn-sm" onclick="editArea('${a.id}')">Ubah</button>
        <button class="btn btn-danger btn-sm" onclick="delArea('${a.id}')">Hapus</button></div>`;
    }).join('')}
    ${syncConfigBtn()}`;
}
function syncConfigBtn(){
  if(!SYNC_URL)return '';
  const dirty=STORE.config&&STORE.config._dirty;
  return `<div class="card" style="background:${dirty?'#FEF9EC':'#F4F8F5'};${dirty?'border-color:#F5DFA0':''}">
    ${dirty?'<p class="hint" style="margin-bottom:8px;color:#9A6B00;font-weight:700">Terdapat perubahan yang BELUM disinkronkan. Asesor belum menerima versi terbaru.</p>':`<p class="hint" style="margin-bottom:8px">Formulir telah tersinkron. Versi saat ini: <b>v${STORE.config.version||1}</b>.</p>`}
    <button class="btn btn-primary btn-block" onclick="pushConfig()">Sinkronkan Formulir ke Seluruh Asesor</button>
  </div>`;
}
function editArea(id){
  const area=id?STORE.config.areaChecks.find(a=>a.id===id):{id:'new'+Date.now(),name:'',aspects:{Ringkas:[''],Rapi:[''],Resik:[''],Rawat:['']}};
  const isNew=!id;
  let html=`<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal">
    <h3>${isNew?'Tambah':'Ubah'} Area Pemeriksaan</h3>
    <label class="field"><span class="lbl">Nama Area Pemeriksaan</span>
      <input class="input" id="ea-name" value="${esc(area.name)}" placeholder="contoh: Papan 5R / STK"></label>`;
  ASPECTS.forEach(asp=>{
    const krit=area.aspects[asp]||[];
    html+=`<div style="margin-bottom:14px"><div class="aspect-head"><span class="tag5r t-${asp}">${asp.toUpperCase()}</span></div>
      <div id="ea-${asp}">`;
    krit.forEach((k,i)=>{html+=critRow(asp,i,k);});
    html+=`</div><button class="btn btn-ghost btn-sm" onclick="addCrit('${asp}')">+ Tambah Kriteria</button></div>`;
  });
  html+=`<div style="display:flex;gap:10px;margin-top:8px">
    <button class="btn btn-ghost" style="flex:1" onclick="closeModal()">Batalkan</button>
    <button class="btn btn-primary" style="flex:1" onclick="saveArea('${area.id}',${isNew})">Simpan</button></div>
    </div></div>`;
  $('#modal-root').innerHTML=html;
}
function critRow(asp,i,val){return `<div style="display:flex;gap:6px;margin-bottom:6px" data-crit="${asp}">
  <textarea class="note-input" style="flex:1;height:46px;margin-top:0" placeholder="Kriteria ${i+1}">${esc(val||'')}</textarea>
  <button class="btn btn-danger btn-sm" onclick="this.parentNode.remove()">✕</button></div>`;}
function addCrit(asp){const wrap=$('#ea-'+asp);const div=document.createElement('div');div.innerHTML=critRow(asp,wrap.children.length,'');wrap.appendChild(div.firstChild);}
function saveArea(id,isNew){
  const name=$('#ea-name').value.trim();if(!name){toast('Nama area wajib diisi');return;}
  const aspects={};
  ASPECTS.forEach(asp=>{aspects[asp]=Array.from(document.querySelectorAll(`#ea-${asp} textarea`)).map(t=>t.value.trim()).filter(Boolean);});
  if(isNew){STORE.config.areaChecks.push({id:id,name,aspects});}
  else{const a=STORE.config.areaChecks.find(x=>x.id===id);a.name=name;a.aspects=aspects;}
  STORE.config._dirty=true;saveStore();closeModal();renderAdmin();toast('Area telah tersimpan');
}
function delArea(id){if(!confirm('Hapus area pemeriksaan ini? Butir penilaian terkait akan turut terhapus.'))return;
  STORE.config.areaChecks=STORE.config.areaChecks.filter(a=>a.id!==id);
  // remove from matrix
  Object.keys(STORE.config.matrix).forEach(pu=>Object.keys(STORE.config.matrix[pu]).forEach(loc=>{
    STORE.config.matrix[pu][loc]=STORE.config.matrix[pu][loc].filter(nm=>{const a=STORE.config.areaChecks.find(x=>x.name===nm);return !!a;});
  }));
  STORE.config._dirty=true;saveStore();renderAdmin();toast('Area telah dihapus');
}
function closeModal(){$('#modal-root').innerHTML='';}

function admMatrix(){
  const pus=Object.keys(STORE.config.matrix);
  if(!window._mxPU)window._mxPU=pus[0];
  const pu=window._mxPU;const locs=Object.keys(STORE.config.matrix[pu]||{});
  return `<div class="card"><h2>Formulir per Lokasi</h2>
    <p class="hint">Atur area pemeriksaan yang berlaku pada setiap lokasi. Tanda centang berarti area tersebut dinilai pada lokasi itu.</p>
    <label class="field"><span class="lbl">Production Unit</span>
      <select class="input" onchange="window._mxPU=this.value;renderAdmin()">${pus.map(p=>`<option ${p===pu?'selected':''}>${esc(p)}</option>`).join('')}</select></label>
    <button class="btn btn-amber btn-sm" onclick="addLoc()">+ Tambah Lokasi</button>
    </div>
    ${locs.map(loc=>`<div class="card"><div style="display:flex;align-items:center;margin-bottom:10px">
      <h2 style="margin:0;font-size:16px">${esc(loc)}</h2>
      <button class="btn btn-danger btn-sm" style="margin-left:auto" onclick="delLoc('${esc(loc)}')">Hapus Lokasi</button></div>
      ${STORE.config.areaChecks.map(a=>{
        const on=(STORE.config.matrix[pu][loc]||[]).includes(a.name);
        return `<label style="display:flex;align-items:center;gap:10px;padding:7px 0;font-size:14px">
          <input type="checkbox" ${on?'checked':''} style="width:20px;height:20px" onchange="toggleArea('${pu}','${esc(loc)}','${a.id}',this.checked)">
          ${esc(a.name)}</label>`;
      }).join('')}
    </div>`).join('')}
    ${syncConfigBtn()}`;
}
function toggleArea(pu,loc,areaId,on){
  const a=STORE.config.areaChecks.find(x=>x.id===areaId);if(!a)return;
  let arr=STORE.config.matrix[pu][loc]||[];
  if(on){if(!arr.includes(a.name))arr.push(a.name);}else{arr=arr.filter(n=>n!==a.name);}
  STORE.config.matrix[pu][loc]=arr;
  STORE.config._dirty=true; // tandai ada perubahan lokal belum di-sync
  saveStore();
}
function addLoc(){const nm=prompt('Nama lokasi baru:');if(!nm)return;STORE.config.matrix[window._mxPU][nm.trim()]=[];STORE.config._dirty=true;saveStore();renderAdmin();}
function delLoc(loc){if(!confirm('Hapus Lokasi '+loc+'?'))return;delete STORE.config.matrix[window._mxPU][loc];STORE.config._dirty=true;saveStore();renderAdmin();}

/* ===== TARGET per LOKASI/ZONA (key: PU::lokasi) ===== */
function targetLoc(pu,loc){const t=STORE.config.targets||{};return t[pu+'::'+loc]||0;}
function targetPU(pu){
  const locs=Object.keys(STORE.config.matrix[pu]||{});
  const vals=locs.map(l=>targetLoc(pu,l)).filter(v=>v>0);
  return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
}
function targetNasional(){
  const pus=Object.keys(STORE.config.matrix);
  const vals=pus.map(targetPU).filter(v=>v!=null);
  return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
}
function admTarget(){
  STORE.config.targets=STORE.config.targets||{};
  STORE.config.weights=STORE.config.weights||{midYear:35,endYear:65};
  const w=STORE.config.weights;
  const totalW=(Number(w.midYear)||0)+(Number(w.endYear)||0);
  const wOk=totalW===100;
  const pus=Object.keys(STORE.config.matrix);
  const nas=targetNasional();
  let html=`<div class="card"><h2>Bobot Nilai Akhir</h2>
    <p class="hint">Nilai akhir dihitung dari (Mid Year × bobot) ditambah (End Year × bobot). Total bobot harus 100%.</p>
    <div style="display:flex;gap:10px">
      <label class="field" style="flex:1"><span class="lbl">Bobot Mid Year (%)</span>
        <input class="input" type="number" min="0" max="100" step="1" value="${w.midYear}" style="text-align:center"
          onchange="setWeight('midYear',this.value)"></label>
      <label class="field" style="flex:1"><span class="lbl">Bobot End Year (%)</span>
        <input class="input" type="number" min="0" max="100" step="1" value="${w.endYear}" style="text-align:center"
          onchange="setWeight('endYear',this.value)"></label>
    </div>
    <div style="padding:10px;border-radius:10px;text-align:center;font-weight:700;font-size:13px;background:${wOk?'#EAF5EC':'#FBEEEC'};color:${wOk?'var(--green)':'var(--red)'}">
      ${wOk?'Total bobot 100% — telah sesuai':'Total bobot = '+totalW+'% — harus 100%. Mohon diperbaiki sebelum digunakan.'}
    </div>
  </div>
  <div class="card"><h2>Target Nilai per Lokasi</h2>
    <p class="hint">Atur target nilai (1–5) pada setiap lokasi/zona. Target PU dan Nasional dihitung otomatis sebagai rata-rata lokasi.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">
      ${pus.map(pu=>{const tp=targetPU(pu);return `<div style="flex:1;min-width:90px;text-align:center;padding:10px;background:var(--concrete);border-radius:10px">
        <div style="font-family:Archivo;font-weight:800;font-size:20px;color:var(--green)">${tp?tp.toFixed(2):'—'}</div>
        <div style="font-size:10px;color:var(--muted);font-weight:700">${esc(pu)}</div></div>`;}).join('')}
      <div style="flex:1;min-width:90px;text-align:center;padding:10px;background:var(--green);border-radius:10px">
        <div style="font-family:Archivo;font-weight:800;font-size:20px;color:#fff">${nas?nas.toFixed(2):'—'}</div>
        <div style="font-size:10px;color:rgba(255,255,255,.8);font-weight:700">NASIONAL</div></div>
    </div>
  </div>`;
  pus.forEach(pu=>{
    const locs=Object.keys(STORE.config.matrix[pu]||{});
    if(!locs.length)return;
    const nKosong=locs.filter(l=>!(targetLoc(pu,l)>0)).length;
    html+=`<div class="card"><h2 style="font-size:16px">${esc(pu)} · target PU ${targetPU(pu)?targetPU(pu).toFixed(2):'—'}${nKosong?` <span style="font-size:11px;font-weight:800;color:var(--amber)">(${nKosong} belum diisi)</span>`:''}</h2>`;
    locs.forEach(loc=>{
      const val=targetLoc(pu,loc);
      const kosong=!(val>0);
      html+=`<div class="list-row" style="${kosong?'border-color:var(--amber);background:#FFF9EC':''}"><div class="nm">${esc(loc)}${kosong?' <span style="font-size:10px;font-weight:800;color:var(--amber);text-transform:uppercase;letter-spacing:.04em">• belum diisi</span>':''}</div>
        <input class="input" type="number" min="1" max="5" step="0.01" value="${val||''}" placeholder="—" style="width:80px;text-align:center;${kosong?'border-color:var(--amber)':''}"
          onchange="setTarget('${esc(pu)}','${esc(loc)}',this.value)"></div>`;
    });
    html+=`</div>`;
  });
  html+=`<div class="card">
    <p class="hint">Setelah atur target, sebarkan ke semua asesor lewat tab Pencadangan → Sinkronkan Form.</p>
    ${SYNC_URL?`<button class="btn btn-primary btn-block" onclick="pushConfig()">Sinkronkan Target dan Formulir ke Seluruh Asesor</button>`:''}
  </div>`;
  return html;
}
function setTarget(pu,loc,v){
  const n=parseFloat(v);
  if(isNaN(n)||n<1||n>5){toast('Target harus berada pada rentang 1–5');renderAdmin();return;}
  STORE.config.targets[pu+'::'+loc]=Math.round(n*100)/100;
  STORE.config._dirty=true;
  saveStore();renderAdmin();
}
function setWeight(which,v){
  const n=parseFloat(v);
  if(isNaN(n)||n<0||n>100){toast('Bobot harus berada pada rentang 0–100');renderAdmin();return;}
  STORE.config.weights=STORE.config.weights||{midYear:35,endYear:65};
  STORE.config.weights[which]=Math.round(n);
  STORE.config._dirty=true;
  saveStore();renderAdmin();
}

function admSessions(){
  if(!STORE.sessions.length)return `<div class="empty"><div class="ic">📋</div>Belum terdapat penilaian yang tersimpan.</div>`;
  const pending=STORE.sessions.filter(s=>!s.synced).length;
  const syncBar=SYNC_URL?`<button class="btn btn-primary btn-block btn-sm" style="margin-bottom:12px" onclick="syncAllUnsynced()">Kirim Seluruh Data ke Google${pending?` (${pending} belum tersinkron)`:' ✓'}</button>`:'';
  return syncBar+STORE.sessions.slice().reverse().map(s=>{const g=gradeFor(s.avg);
    const sync=s.synced?'<span style="font-size:10px;color:var(--lime);font-weight:700">Tersinkron</span>':'<span style="font-size:10px;color:var(--amber);font-weight:700">Belum Tersinkron</span>';
    return `<div class="list-row"><div class="nm">${esc(s.pu)} — ${esc(s.loc)}<div style="font-size:12px;color:var(--muted);font-weight:400">${esc(s.periode||"")}${s.tahun?' '+esc(s.tahun):''}${s.jenis?' · '+esc(s.jenis):''} · ${esc(s.date)} · ${esc(s.asesor)} · ${sync}</div></div>
      <span class="badge done" style="background:${g.color};color:#fff;font-family:Archivo;font-weight:800;padding:6px 11px;border-radius:9px">${s.avg?s.avg.toFixed(2):'—'}</span>
      ${SYNC_URL?`<button class="btn btn-ghost btn-sm" onclick="syncSession('${s.id}')">☁</button>`:''}
      <button class="btn btn-ghost btn-sm" onclick="openSession('${s.id}')">Buka</button>
      <button class="btn btn-danger btn-sm" onclick="delSession('${s.id}')">✕</button></div>`;
  }).join('');
}
function delSession(id){if(!confirm('Hapus data penilaian ini?'))return;STORE.sessions=STORE.sessions.filter(s=>s.id!==id);saveStore();renderAdmin();}

/* ===== FITUR 2: Pemantauan Menyeluruh (tarik dari Google) ===== */
let PANTAU_FILTER={pu:'',asesor:''};
async function loadPantau(){
  const b=$('#adm-body');if(!b)return;
  try{
    const res=await fetch(SYNC_URL+'?action=list&secret='+encodeURIComponent(SYNC_SECRET));
    const out=await res.json();
    if(!out.ok){b.innerHTML=`<div class="empty"><div class="ic">⚠️</div>Gagal: ${esc(out.error||'unknown')}</div>`;return;}
    window._pantauData=out.assessments||[];
    renderPantau();
  }catch(e){b.innerHTML=`<div class="empty"><div class="ic">⚠️</div>Gagal mengambil data. Mohon periksa sinyal.<br><button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="loadPantau()">Coba Lagi</button></div>`;}
}
function renderPantau(){
  const b=$('#adm-body');if(!b)return;
  let rows=window._pantauData||[];
  const pus=[...new Set(rows.map(x=>x['PU']).filter(Boolean))];
  const asesors=[...new Set(rows.map(x=>x['Asesor']).filter(Boolean))];
  if(PANTAU_FILTER.pu)rows=rows.filter(x=>x['PU']===PANTAU_FILTER.pu);
  if(PANTAU_FILTER.asesor)rows=rows.filter(x=>x['Asesor']===PANTAU_FILTER.asesor);
  const total=rows.length;
  const avg=total?(rows.reduce((s,x)=>s+(Number(x['Nilai Akhir'])||0),0)/total):0;
  b.innerHTML=`
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h2 style="margin:0">Pemantauan Menyeluruh</h2>
        <button class="btn btn-ghost btn-sm" onclick="loadPantau()">Perbarui</button>
      </div>
      <p class="hint">Data dari seluruh asesor yang telah dikirim ke Google.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <select class="input" style="flex:1;min-width:120px" onchange="PANTAU_FILTER.pu=this.value;renderPantau()">
          <option value="">Seluruh PU</option>${pus.map(p=>`<option ${p===PANTAU_FILTER.pu?'selected':''}>${esc(p)}</option>`).join('')}</select>
        <select class="input" style="flex:1;min-width:120px" onchange="PANTAU_FILTER.asesor=this.value;renderPantau()">
          <option value="">Seluruh Asesor</option>${asesors.map(a=>`<option ${a===PANTAU_FILTER.asesor?'selected':''}>${esc(a)}</option>`).join('')}</select>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <div class="card" style="flex:1;text-align:center;margin:0;padding:16px">
        <div style="font-family:Archivo;font-weight:800;font-size:28px;color:var(--green)">${total}</div>
        <div style="font-size:11px;color:var(--muted);font-weight:700">PENILAIAN</div></div>
      <div class="card" style="flex:1;text-align:center;margin:0;padding:16px">
        <div style="font-family:Archivo;font-weight:800;font-size:28px;color:${gradeFor(avg).color}">${avg?avg.toFixed(2):'—'}</div>
        <div style="font-size:11px;color:var(--muted);font-weight:700">RATA-RATA</div></div>
    </div>
    ${total===0?'<div class="empty"><div class="ic">📊</div>Belum terdapat data yang tersinkron.</div>':
    rows.slice().reverse().map(x=>{const g=gradeFor(Number(x['Nilai Akhir'])||0);
      return `<div class="list-row"><div class="nm">${esc(x['PU']||'')} — ${esc(x['Lokasi']||'')}
        <div style="font-size:12px;color:var(--muted);font-weight:400">${esc(x['Periode']||'')} · ${esc(x['Tanggal']||'')} · ${esc(x['Asesor']||'')}${x['Sync Count']?' · sync '+x['Sync Count']+'×':''}</div></div>
        ${x['Folder Foto']?`<a href="${x['Folder Foto']}" target="_blank" class="btn btn-ghost btn-sm">📷</a>`:''}
        <span class="badge done" style="background:${g.color};color:#fff;font-family:Archivo;font-weight:800;padding:6px 11px;border-radius:9px">${x['Nilai Akhir']?Number(x['Nilai Akhir']).toFixed(2):'—'}</span></div>`;
    }).join('')}`;
}

function admData(){
  const used=storageUsage(),pct=Math.min(100,Math.round(used/(5*1024*1024)*100));
  const mb=(used/1024/1024).toFixed(2);
  const barColor=pct>85?'var(--red)':pct>60?'var(--amber)':'var(--lime)';
  return `<div class="card"><h2>Penyimpanan pada Perangkat</h2>
    <p class="hint">Terpakai kurang lebih ${mb} MB dari sekitar 5 MB (${pct}%). Foto merupakan penyumbang penggunaan ruang terbesar.</p>
    <div class="bar" style="height:10px;background:#DCE4DF;border-radius:99px;overflow:hidden;margin-bottom:6px"><div style="height:100%;width:${pct}%;background:${barColor};border-radius:99px"></div></div>
    ${pct>85?'<div class="login-err" style="background:var(--red)">Hampir penuh! Pencadangan lalu hapus data lama.</div>':''}
  </div>
  <div class="card"><h2>Pencadangan & Restore</h2>
    <p class="hint">Data tersimpan di perangkat ini saja. Pencadangan berkala agar tidak hilang.</p>
    <button class="btn btn-ghost btn-block" style="margin-bottom:10px" onclick="backupData()">⬇ Unduh Pencadangan (JSON)</button>
    <label class="btn btn-ghost btn-block" style="margin-bottom:10px">⬆ Pulihkan dari Pencadangan<input type="file" accept=".json" style="display:none" onchange="restoreData(this)"></label>
    <button class="btn btn-ghost btn-block" style="margin-bottom:10px" onclick="syncSeed()">Perbarui Klausul dari Data Awal (aman, data tetap tersimpan)</button>
    <button class="btn btn-danger btn-block" onclick="resetData()">Kembalikan ke Data Awal</button>
  </div>
  ${SYNC_URL?`<div class="card"><h2>Sinkronisasi Formulir (Daring)</h2>
    <p class="hint">Sebarkan perubahan area dan klausul ke SELURUH asesor. Pembaruan akan diterima saat aplikasi dibuka dalam keadaan daring. Versi formulir saat ini: <b>v${STORE.config.version||1}</b>.</p>
    <button class="btn btn-primary btn-block" onclick="pushConfig()">Sinkronkan Formulir ke Seluruh Asesor</button>
    <p class="hint" style="margin-top:8px;margin-bottom:0">Pastikan formulir sudah benar sebelum disinkronkan — perubahan akan langsung berlaku bagi seluruh pengguna. Versi akan naik secara otomatis setiap kali disinkronkan.</p>
  </div>`:''}`;
}
function pushConfig(){
  if(!SYNC_URL){alert('Alamat sinkronisasi (SYNC_URL) belum diatur.');return;}
  if(!confirm('Sinkronkan formulir ke seluruh asesor? Versi formulir akan dinaikkan dan disebarkan. Pastikan formulir telah benar.'))return;
  // naikkan versi config & bersihkan tanda dirty (perubahan ini yang jadi sumber kebenaran)
  STORE.config.version=(STORE.config.version||1)+1;
  delete STORE.config._dirty;
  saveStore();
  toast('Sedang mengirim formulir ke Google…');
  fetch(SYNC_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:JSON.stringify({secret:SYNC_SECRET,type:'config',config:STORE.config})})
    .then(r=>r.json()).then(out=>{
      if(out.ok){
        alert('BERHASIL\n\nFormulir dan target telah disinkronkan ke versi '+(out.version||STORE.config.version)+'.\n\nSeluruh asesor akan menerima pembaruan saat membuka aplikasi dalam keadaan daring.');
        renderAdmin();
      }else{
        alert('GAGAL menyinkronkan formulir.\n\nPenyebab: '+(out.error||'tidak diketahui')+'\n\nSilakan coba kembali.');
      }
    }).catch(e=>alert('GAGAL mengirim data. Mohon periksa sinyal atau koneksi internet.\n\nRincian: '+e.message));
}
function backupData(){const blob=new Blob([JSON.stringify(STORE)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='backup_asesmen5r_'+new Date().toISOString().slice(0,10)+'.json';a.click();toast('Pencadangan diunduh');}
function restoreData(inp){const f=inp.files[0];if(!f)return;const r=new FileReader();r.onload=e=>{try{STORE=JSON.parse(e.target.result);saveStore();toast('Data telah dipulihkan');renderAdmin();}catch(err){toast('Berkas cadangan tidak valid');}};r.readAsText(f);}
function resetData(){if(!confirm('Kembalikan seluruh data ke kondisi awal? Penilaian yang tersimpan akan hilang.'))return;localStorage.removeItem(LS_KEY);STORE=loadStore();saveStore();renderAdmin();toast('Data telah dikembalikan ke kondisi awal');}
function syncSeed(){
  if(!confirm('Perbarui daftar area dan klausul ke versi data awal terbaru? Penilaian yang tersimpan TIDAK akan dihapus.'))return;
  STORE.config=JSON.parse(JSON.stringify(SEED_DATA));
  STORE.sessions=STORE.sessions||[];
  saveStore();renderAdmin();toast('Klausul telah diperbarui dari data awal');
}

/* ---------- Warning sebelum nutup halaman saat mengisi ---------- */
/* ============ TEMUAN & TINDAK LANJUT ============ */
function findingsCard(d){
  const f=d.findings||[];
  const open=f.filter(x=>x.status==='Open').length, close=f.filter(x=>x.status==='Close').length;
  const pctClose=f.length?Math.round(close/f.length*100):0;
  return `<div class="card">
    <h2>Temuan dan Tindak Lanjut</h2>
    <p class="hint">${f.length} temuan, terbentuk otomatis dari aspek bernilai rendah (≤2). Dapat diubah, ditambah, atau dihapus.</p>
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <div style="flex:1;text-align:center;padding:12px;background:#FBEEEC;border-radius:10px">
        <div style="font-family:Archivo;font-weight:800;font-size:22px;color:var(--red)">${open}</div>
        <div style="font-size:11px;color:var(--muted);font-weight:700">TERBUKA</div></div>
      <div style="flex:1;text-align:center;padding:12px;background:#EAF5EC;border-radius:10px">
        <div style="font-family:Archivo;font-weight:800;font-size:22px;color:var(--green-400)">${close}</div>
        <div style="font-size:11px;color:var(--muted);font-weight:700">SELESAI</div></div>
      <div style="flex:1;text-align:center;padding:12px;background:var(--concrete);border-radius:10px">
        <div style="font-family:Archivo;font-weight:800;font-size:22px;color:var(--green)">${pctClose}%</div>
        <div style="font-size:11px;color:var(--muted);font-weight:700">% SELESAI</div></div>
    </div>
    <button class="btn btn-ghost btn-block btn-sm" style="margin-bottom:8px" onclick="regenTemuan()">Buat Ulang Temuan dari Nilai (menimpa temuan otomatis)</button>
    <button class="btn btn-primary btn-block" onclick="VIEW='findings';render()">Kelola Temuan →</button>
  </div>`;
}
function regenTemuan(){
  if(isLocked())return lockBlock();
  if(!confirm('Buat ulang temuan otomatis dari aspek bernilai ≤2? Temuan yang ditambahkan atau diubah secara manual akan tetap dipertahankan.'))return;
  const auto=generateFindings(DRAFT);
  const manual=(DRAFT.findings||[]).filter(f=>!f.auto); // simpan yang manual
  DRAFT.findings=auto.concat(manual);
  saveDraftSession();render();toast('Temuan telah diperbarui berdasarkan nilai');
}

function renderFindings(){
  const d=DRAFT;const f=d.findings||[];
  app().innerHTML=topbar('Temuan 5R',d.loc+' · '+(d.periode||''))+`
  <div class="wrap">
    <div class="card">
      <h2>Daftar Temuan</h2>
      <p class="hint">${f.length} temuan. Ketuk untuk mengubah rincian, tindak lanjut, dan status.</p>
      <button class="btn btn-amber btn-block" onclick="editFinding(null)">+ Tambah Temuan Manual</button>
    </div>
    ${f.length?f.map(x=>findingRow(x)).join(''):'<div class="empty"><div class="ic">✓</div>Belum terdapat temuan.</div>'}
  </div>
  <div class="botbar"><button class="btn btn-primary btn-block" onclick="VIEW='report';render()">‹ Kembali ke Hasil</button></div>`;
}
function findingRow(x){
  const stColor=x.status==='Close'?'var(--green-400)':'var(--red)';
  const berulangTag=x.berulang==='Ya'?`<span style="font-size:9px;font-weight:800;background:var(--amber);color:#fff;padding:2px 8px;border-radius:99px">BERULANG</span>`:'';
  return `<div class="card" style="padding:14px" onclick="editFinding('${x.id}')">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap">
      <span class="tag5r t-${x.kategori}">${(x.kategori||'').toUpperCase()}</span>
      ${berulangTag}
      <span style="margin-left:auto;font-size:11px;font-weight:800;padding:3px 10px;border-radius:99px;color:#fff;background:${stColor}">${esc(x.status)}</span>
    </div>
    <div style="font-weight:700;font-size:13px;margin-bottom:3px">${esc(x.area)}</div>
    <div style="font-size:13px;color:var(--muted)">${esc(x.deskripsi||'(tanpa deskripsi)')}</div>
    ${x.penyebab?`<div style="font-size:11px;color:var(--muted);margin-top:4px">Penyebab: <b>${esc(x.penyebab)}</b></div>`:''}
    ${x.saran?`<div style="font-size:12px;color:var(--green-400);margin-top:6px">↳ ${esc(x.saran)}</div>`:''}
  </div>`;
}
function editFinding(id){
  const d=DRAFT;
  const isNew=!id;
  const x=id?d.findings.find(f=>f.id===id):{id:'f'+Date.now()+Math.random().toString(36).slice(2,6),area:d.areas.length?(STORE.config.areaChecks.find(a=>a.id===d.areas[0])||{}).name||'':'',kategori:'Ringkas',r5:'R1',deskripsi:'',foto:'',penyebab:'',saran:'',target:String(new Date().getFullYear()),fotoPerbaikan:'',deskPerbaikan:'',tglPerbaikan:'',status:'Open',verifikator:''};
  const areaOpts=STORE.config.areaChecks.map(a=>`<option ${a.name===x.area?'selected':''}>${esc(a.name)}</option>`).join('');
  const katOpts=['Ringkas','Rapi','Resik','Rawat','Rajin'].map(k=>`<option ${k===x.kategori?'selected':''}>${k}</option>`).join('');
  const penyebabOpts=['','Kurang training','SOP tidak jelas','Alat/sarana rusak','Kelalaian operator','Lainnya']
    .map(p=>`<option value="${esc(p)}" ${p===x.penyebab?'selected':''}>${p===''?'— Pilih penyebab —':esc(p)}</option>`).join('');
  const berulangBadge=x.auto&&x.berulang==='Ya'?`<span style="font-size:9px;font-weight:800;background:var(--amber);color:#fff;padding:2px 8px;border-radius:99px;margin-left:6px">TEMUAN BERULANG</span>`:'';
  $('#modal-root').innerHTML=`<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal">
    <h3>${isNew?'Tambah':'Ubah'} Temuan ${berulangBadge}</h3>
    <div style="font-size:11px;font-weight:800;color:var(--green);letter-spacing:.05em;margin-bottom:8px">A · HASIL TEMUAN</div>
    <label class="field"><span class="lbl">Area Pemeriksaan</span><select class="input" id="ef-area">${areaOpts}</select></label>
    <label class="field"><span class="lbl">Kategori 5R</span><select class="input" id="ef-kat">${katOpts}</select></label>
    <label class="field"><span class="lbl">Deskripsi Temuan</span><textarea class="input" id="ef-desk" style="min-height:60px">${esc(x.deskripsi||'')}</textarea></label>
    <label class="field"><span class="lbl">Dokumentasi Foto Temuan</span>
      <div class="photo-row">${x.foto?`<img src="${x.foto}" class="photo-thumb" onclick="efRmPhoto('foto')">`:`<label class="photo-add">+<input type="file" accept="image/*" capture="environment" style="display:none" onchange="efAddPhoto('foto',this)"></label>`}</div>
    </label>
    <div style="font-size:11px;font-weight:800;color:var(--amber);letter-spacing:.05em;margin:14px 0 8px">B · TINDAK LANJUT</div>
    <label class="field"><span class="lbl">Penyebab (Root Cause)</span><select class="input" id="ef-penyebab">${penyebabOpts}</select></label>
    <p class="hint" style="margin-top:-8px;margin-bottom:12px">Pilih penyebab yang paling mendasari temuan ini. Membantu Direktorat melihat pola penyebab secara nasional, agar tindak lanjut mencegah temuan berulang.</p>
    <label class="field"><span class="lbl">Saran Tindak Lanjut</span><textarea class="input" id="ef-saran" style="min-height:50px">${esc(x.saran||'')}</textarea></label>
    <label class="field"><span class="lbl">Target Penyelesaian</span><input class="input" id="ef-target" value="${esc(x.target||'')}" placeholder="contoh: 2026"></label>
    <label class="field"><span class="lbl">Deskripsi Tindak Lanjut</span><textarea class="input" id="ef-deskp" style="min-height:50px">${esc(x.deskPerbaikan||'')}</textarea></label>
    <label class="field"><span class="lbl">Tanggal Penyelesaian</span><input class="input" id="ef-tglp" type="date" value="${esc((x.tglPerbaikan||'').slice(0,10))}"></label>
    <label class="field"><span class="lbl">Dokumentasi Foto Tindak Lanjut</span>
      <div class="photo-row">${x.fotoPerbaikan?`<img src="${x.fotoPerbaikan}" class="photo-thumb" onclick="efRmPhoto('fotoPerbaikan')">`:`<label class="photo-add">+<input type="file" accept="image/*" capture="environment" style="display:none" onchange="efAddPhoto('fotoPerbaikan',this)"></label>`}</div>
    </label>
    <div style="font-size:11px;font-weight:800;color:var(--green-400);letter-spacing:.05em;margin:14px 0 8px">C · VERIFIKASI</div>
    <label class="field"><span class="lbl">Status</span><select class="input" id="ef-status">
      <option ${x.status==='Open'?'selected':''}>Open</option><option ${x.status==='Close'?'selected':''}>Close</option></select></label>
    <label class="field"><span class="lbl">Verifikator</span><input class="input" id="ef-verif" value="${esc(x.verifikator||'')}" placeholder="Nama Verifikator"></label>
    <div style="display:flex;gap:10px;margin-top:8px">
      ${isNew?'':`<button class="btn btn-danger" onclick="delFinding('${x.id}')">Hapus</button>`}
      <button class="btn btn-ghost" style="flex:1" onclick="closeModal()">Batalkan</button>
      <button class="btn btn-primary" style="flex:1" onclick="saveFinding('${x.id}',${isNew})">Simpan</button>
    </div>
  </div></div>`;
  window._efPhoto={foto:x.foto||'',fotoPerbaikan:x.fotoPerbaikan||''};
}
function efAddPhoto(field,inp){const f=inp.files[0];if(!f)return;handlePhoto(f,url=>{window._efPhoto[field]=url;
  // refresh just that photo-row by re-rendering modal preview
  inp.closest('.photo-row').innerHTML=`<img src="${url}" class="photo-thumb" onclick="efRmPhoto('${field}')">`;});}
function efRmPhoto(field){window._efPhoto[field]='';const lbl=document.querySelector(`[onclick="efRmPhoto('${field}')"]`);if(lbl)lbl.parentNode.innerHTML=`<label class="photo-add">+<input type="file" accept="image/*" capture="environment" style="display:none" onchange="efAddPhoto('${field}',this)"></label>`;}
function saveFinding(id,isNew){
  if(isLocked())return lockBlock();
  const d=DRAFT;d.findings=d.findings||[];
  const kat=$('#ef-kat').value;
  const obj={id,area:$('#ef-area').value,kategori:kat,r5:R5MAP[kat],
    deskripsi:$('#ef-desk').value.trim(),foto:window._efPhoto.foto||'',
    penyebab:$('#ef-penyebab').value,
    saran:$('#ef-saran').value.trim(),target:$('#ef-target').value.trim(),
    deskPerbaikan:$('#ef-deskp').value.trim(),tglPerbaikan:$('#ef-tglp').value,
    fotoPerbaikan:window._efPhoto.fotoPerbaikan||'',
    status:$('#ef-status').value,verifikator:$('#ef-verif').value.trim(),auto:false};
  if(isNew)d.findings.push(obj);
  else{const i=d.findings.findIndex(f=>f.id===id);if(i>=0)d.findings[i]={...d.findings[i],...obj};}
  saveDraftSession();closeModal();renderFindings();toast('Temuan telah tersimpan');
}
function delFinding(id){if(isLocked())return lockBlock();if(!confirm('Hapus temuan ini?'))return;DRAFT.findings=DRAFT.findings.filter(f=>f.id!==id);saveDraftSession();closeModal();renderFindings();toast('Temuan telah dihapus');}


/* ============ DASHBOARD NILAI (narik cloud, admin) ============ */
let _dashNilaiData=null;
let DN_FILTER={tahun:'',jenis:''};   // [MT] filter tahun & jenis
let DN_SHOWTREN=false;               // [MT] toggle view tren
function renderDashNilai(){
  app().innerHTML=topbar('Dashboard Nilai','Realisasi terhadap Target — Data dari Google')+`
  <div class="wrap" id="dn-body">
    <div class="empty"><div class="ic">⏳</div>Sedang mengambil data dari Google…</div>
  </div>
  <div class="botbar"><button class="btn btn-primary btn-block" onclick="VIEW='home';render()">‹ Beranda</button></div>`;
  loadDashNilai();
}
async function loadDashNilai(){
  const b=$('#dn-body');if(!b)return;
  if(!SYNC_URL){b.innerHTML='<div class="empty">Sinkronisasi belum diaktifkan.</div>';return;}
  try{
    const res=await fetch(SYNC_URL+'?action=list&secret='+encodeURIComponent(SYNC_SECRET));
    const out=await res.json();
    if(!out.ok){b.innerHTML=`<div class="empty"><div class="ic">⚠️</div>Gagal: ${esc(out.error||'unknown')}</div>`;return;}
    _dashNilaiData=out.assessments||[];
    drawDashNilai();
  }catch(e){b.innerHTML=`<div class="empty"><div class="ic">⚠️</div>Gagal mengambil data. Mohon periksa sinyal.<br><button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="loadDashNilai()">Coba Lagi</button></div>`;}
}
/* [MT] baca kolom Tahun (fallback dari Tanggal), dan Jenis (default Resmi) */
function _rowTahun(x){
  var t=x['Tahun'];
  if(t!=null&&t!=='')return String(t).trim();
  var tg=String(x['Tanggal']||'');
  var m=tg.match(/(20\d\d)/);
  return m?m[1]:'';
}
function _rowJenis(x){return (x['Jenis']||'Resmi');}
function drawDashNilai(){
  const b=$('#dn-body');if(!b)return;
  const all=_dashNilaiData||[];
  if(!all.length){b.innerHTML='<div class="empty"><div class="ic">📊</div>Belum terdapat data yang tersinkron.</div>';return;}

  // [MT] opsi filter dari data
  const tahunList=[...new Set(all.map(_rowTahun).filter(Boolean))].sort();
  // [MT] terapkan filter tahun & jenis
  let rows=all.slice();
  if(DN_FILTER.tahun)rows=rows.filter(x=>_rowTahun(x)===DN_FILTER.tahun);
  if(DN_FILTER.jenis)rows=rows.filter(x=>_rowJenis(x)===DN_FILTER.jenis);

  // [MT] panel filter + toggle tren (selalu tampil di atas)
  const filterPanel=`<div class="card">
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
      <label class="field" style="flex:1;min-width:110px;margin:0"><span class="lbl">Tahun</span>
        <select class="input" onchange="DN_FILTER.tahun=this.value;drawDashNilai()">
          <option value="">Semua Tahun</option>${tahunList.map(t=>`<option ${t===DN_FILTER.tahun?'selected':''}>${esc(t)}</option>`).join('')}
        </select></label>
      <label class="field" style="flex:1;min-width:110px;margin:0"><span class="lbl">Jenis</span>
        <select class="input" onchange="DN_FILTER.jenis=this.value;drawDashNilai()">
          <option value="">Semua Jenis</option>
          <option ${DN_FILTER.jenis==='Resmi'?'selected':''}>Resmi</option>
          <option ${DN_FILTER.jenis==='Internal'?'selected':''}>Internal</option>
        </select></label>
    </div>
    <button class="btn btn-ghost btn-block btn-sm" style="margin-top:10px" onclick="DN_SHOWTREN=!DN_SHOWTREN;drawDashNilai()">${DN_SHOWTREN?'Sembunyikan Tren Antar-Tahun':'Lihat Tren Antar-Tahun'}</button>
    ${DN_SHOWTREN?trenAntarTahun(all):''}
  </div>`;

  if(!rows.length){b.innerHTML=filterPanel+'<div class="empty"><div class="ic">📊</div>Tidak terdapat data untuk kombinasi penyaring ini.</div>';return;}

  const w=STORE.config.weights||{midYear:35,endYear:65};
  const wMid=(Number(w.midYear)||0)/100, wEnd=(Number(w.endYear)||0)/100;

  // nilai lokasi per PERIODE (Mid/End). key: PU::loc::periode
  const byLocPer={};
  rows.forEach(x=>{
    const pu=x['PU'],loc=x['Lokasi'];if(!pu||!loc)return;
    const per=(x['Periode']||'').toLowerCase().indexOf('end')>=0?'end':'mid';
    byLocPer[pu+'::'+loc+'::'+per]={pu,loc,per,nilai:Number(x['Nilai Akhir'])||0};
  });
  // nilai PU per periode
  function puNilaiPeriode(pu,per){
    const locs=Object.keys(STORE.config.matrix[pu]||{});
    const vals=locs.map(l=>{const o=byLocPer[pu+'::'+l+'::'+per];return o?o.nilai:0;}).filter(v=>v>0);
    return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0;
  }
  // nilai final tertimbang PU: kalau End belum ada -> tampilkan Mid apa adanya
  function puFinal(pu){
    const mid=puNilaiPeriode(pu,'mid'), end=puNilaiPeriode(pu,'end');
    if(mid>0 && end>0) return {final:mid*wMid+end*wEnd, mid, end, lengkap:true};
    if(end>0) return {final:end, mid, end, lengkap:false};
    return {final:mid, mid, end, lengkap:false};
  }
  const pus=Object.keys(STORE.config.matrix).filter(pu=>{
    return Object.keys(STORE.config.matrix[pu]||{}).some(l=>byLocPer[pu+'::'+l+'::mid']||byLocPer[pu+'::'+l+'::end']);
  });
  const puRows=pus.map(pu=>{const f=puFinal(pu);return {pu,...f,target:targetPU(pu)};});
  const nasFinal=puRows.length?puRows.reduce((s,p)=>s+p.final,0)/puRows.length:0;
  const nasMid=puRows.length?puRows.reduce((s,p)=>s+p.mid,0)/puRows.length:0;
  const nasEnd=puRows.length?puRows.reduce((s,p)=>s+p.end,0)/puRows.length:0;
  const nasTarget=targetNasional();
  const semuaLengkap=puRows.every(p=>p.lengkap);

  // warning target kosong
  const allLoc=Object.values(byLocPer);
  const tanpaTarget=[...new Set(allLoc.filter(o=>o.nilai>0 && !targetLoc(o.pu,o.loc)).map(o=>o.pu+' — '+o.loc))];
  let warnHtml='';
  if(tanpaTarget.length){
    warnHtml=`<div class="card" style="background:#FEF9EC;border-color:#F5DFA0">
      <div style="display:flex;gap:10px;align-items:flex-start">
        <span style="font-size:20px">⚠️</span>
        <div><div style="font-weight:800;font-size:14px;margin-bottom:4px">Sebagian Target Nilai Belum Ditetapkan</div>
        <div style="font-size:13px;color:var(--muted)">Terdapat ${tanpaTarget.length} lokasi yang telah memiliki realisasi namun belum memiliki target. Mohon lengkapi target pada menu <b>Kelola Formulir → Target Nilai</b>.</div>
        </div></div></div>`;
  }
  // warning bobot != 100
  const totalW=(Number(w.midYear)||0)+(Number(w.endYear)||0);
  let wWarn='';
  if(totalW!==100){
    wWarn=`<div class="card" style="background:#FBEEEC;border-color:#E6B0AA"><div style="font-weight:700;color:var(--red);font-size:13px">Total bobot Mid ditambah End = ${totalW}% (harus 100%). Nilai final mungkin tidak akurat. Perbaiki di Kelola Formulir → Target Nilai.</div></div>`;
  }

  // ===== HERO: Nilai Final Tertimbang =====
  let html=filterPanel+warnHtml+wWarn+`<div class="card" style="text-align:center;background:linear-gradient(135deg,var(--green),${shade('#1E7A5A',-18)});color:#fff">
    <div style="font-size:12px;opacity:.7;font-weight:700;letter-spacing:.05em">NILAI AKHIR NASIONAL ${semuaLengkap?'(TERTIMBANG)':'(SEMENTARA · Mid Year)'}${DN_FILTER.tahun?' · '+esc(DN_FILTER.tahun):''}${DN_FILTER.jenis?' · '+esc(DN_FILTER.jenis):''}</div>
    <div style="font-family:Archivo;font-weight:800;font-size:46px;line-height:1;margin:4px 0">${nasFinal?nasFinal.toFixed(2):'—'}</div>
    <div style="font-size:13px;opacity:.85">Target ${nasTarget?nasTarget.toFixed(2):'—'} · ${vsTarget(nasFinal,nasTarget)}</div>
    <div style="font-size:11px;opacity:.7;margin-top:8px">Mid Year: ${nasMid?nasMid.toFixed(2):'—'} (${w.midYear}%) · End Year: ${nasEnd?nasEnd.toFixed(2):'—'} (${w.endYear}%)</div>
  </div>`;

  // ===== Scorecard per PU =====
  html+=`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
    ${puRows.map(p=>{
      const ok=p.target&&p.final>=p.target;
      const col=p.target?(ok?'var(--lime)':'var(--amber)'):'var(--green-400)';
      return `<div class="card" style="flex:1;min-width:100px;text-align:center;margin:0;padding:14px;border-top:3px solid ${col}">
        <div style="font-family:Archivo;font-weight:800;font-size:26px;color:${col}">${p.final?p.final.toFixed(2):'—'}</div>
        <div style="font-size:11px;color:var(--muted);font-weight:700">${esc(p.pu)}</div>
        <div style="font-size:10px;color:var(--muted)">target ${p.target?p.target.toFixed(2):'—'}</div>
      </div>`;}).join('')}
  </div>`;

  // ===== TABEL KPI =====
  html+=`<div class="card"><h2 style="font-size:16px">Tabel Indikator Kinerja — Realisasi terhadap Target</h2>
    <table class="rep"><thead><tr><th>PU</th><th class="num">Mid</th><th class="num">End</th><th class="num">Final</th><th class="num">Target</th><th class="num">Capai</th></tr></thead><tbody>
    ${puRows.map(p=>{
      const pc=p.target?Math.round(p.final/p.target*100):0;
      const ok=p.target&&p.final>=p.target;
      return `<tr><td>${esc(p.pu)}</td>
        <td class="num">${p.mid?p.mid.toFixed(2):'—'}</td>
        <td class="num">${p.end?p.end.toFixed(2):'—'}</td>
        <td class="num" style="font-weight:800">${p.final?p.final.toFixed(2):'—'}</td>
        <td class="num">${p.target?p.target.toFixed(2):'—'}</td>
        <td class="num" style="color:${ok?'var(--green)':'var(--red)'};font-weight:700">${p.target?pc+'%':'—'}</td></tr>`;
    }).join('')}
    <tr style="background:var(--concrete);font-weight:800"><td>NASIONAL</td>
      <td class="num">${nasMid?nasMid.toFixed(2):'—'}</td>
      <td class="num">${nasEnd?nasEnd.toFixed(2):'—'}</td>
      <td class="num">${nasFinal?nasFinal.toFixed(2):'—'}</td>
      <td class="num">${nasTarget?nasTarget.toFixed(2):'—'}</td>
      <td class="num" style="color:${nasTarget&&nasFinal>=nasTarget?'var(--green)':'var(--red)'}">${nasTarget?Math.round(nasFinal/nasTarget*100)+'%':'—'}</td></tr>
    </tbody></table></div>`;

  // ===== GRAFIK realisasi vs target (final per PU) =====
  html+=`<div class="card"><h2 style="font-size:16px">Grafik Nilai Akhir terhadap Target per Production Unit</h2>${barVsTarget(puRows.map(p=>({label:p.pu,nilai:p.final,target:p.target})))}</div>`;

  // ===== SIMULASI =====
  html+=`<div class="card"><h2 style="font-size:16px">Simulasi Pencapaian Target</h2>
    <p class="hint">Hitung skenario nilai akhir. Bobot: Mid ${w.midYear}% · End ${w.endYear}%.</p>
    <div class="seg" style="background:var(--concrete);margin-bottom:10px">
      <button class="${SIM_MODE==='reverse'?'on':''}" style="color:${SIM_MODE==='reverse'?'#fff':'var(--muted)'};background:${SIM_MODE==='reverse'?'var(--green)':'transparent'}" onclick="SIM_MODE='reverse';drawDashNilai()">Berapa Nilai End yang Dibutuhkan?</button>
      <button class="${SIM_MODE==='predict'?'on':''}" style="color:${SIM_MODE==='predict'?'#fff':'var(--muted)'};background:${SIM_MODE==='predict'?'var(--green)':'transparent'}" onclick="SIM_MODE='predict';drawDashNilai()">Prediksi Nilai Akhir</button>
    </div>
    <label class="field"><span class="lbl">Pilih Cakupan</span>
      <select class="input" id="sim-scope">
        <option value="nasional" ${SIM.scope==='nasional'?'selected':''}>Nasional</option>
        ${pus.map(p=>`<option value="${esc(p)}" ${SIM.scope===p?'selected':''}>${esc(p)}</option>`).join('')}
      </select></label>
    ${SIM_MODE==='reverse'?`
      <label class="field"><span class="lbl">Nilai Mid Year (aktual/asumsi)</span><input class="input" id="sim-mid" type="number" step="0.01" min="1" max="5" value="${SIM.mid||''}" placeholder="contoh 3,5"></label>
      <label class="field"><span class="lbl">Target Nilai Akhir yang Ingin Dicapai</span><input class="input" id="sim-target" type="number" step="0.01" min="1" max="5" value="${SIM.target||''}" placeholder="contoh 4,0"></label>
      <button class="btn btn-primary btn-block" onclick="runSimReverse()">Hitung Nilai End Year yang Dibutuhkan</button>
    `:`
      <label class="field"><span class="lbl">Nilai Mid Year</span><input class="input" id="sim-mid" type="number" step="0.01" min="1" max="5" value="${SIM.mid||''}" placeholder="contoh 3,5"></label>
      <label class="field"><span class="lbl">Nilai End Year</span><input class="input" id="sim-end" type="number" step="0.01" min="1" max="5" value="${SIM.end||''}" placeholder="contoh 4,2"></label>
      <button class="btn btn-primary btn-block" onclick="runSimPredict()">Hitung Nilai Akhir</button>
    `}
    <div id="sim-result"></div>
  </div>`;

  html+=`<div class="card"><button class="btn btn-ghost btn-block" onclick="loadDashNilai()">Perbarui dari Google</button></div>`;
  b.innerHTML=html;
  // render hasil simulasi terakhir kalau ada
  if(SIM.lastResult){$('#sim-result').innerHTML=SIM.lastResult;}
}

/* [MT] Tren antar-tahun: rata-rata Nilai Akhir per PU per tahun (ikut filter jenis) */
function trenAntarTahun(allRows){
  const jenisF=DN_FILTER.jenis;
  const acc={}; // pu -> tahun -> {sum,n}
  (allRows||[]).forEach(x=>{
    if(jenisF && _rowJenis(x)!==jenisF)return;
    const pu=x['PU']||'-'; const th=_rowTahun(x); if(!th)return;
    const nv=Number(x['Nilai Akhir']); if(!nv)return;
    acc[pu]=acc[pu]||{}; acc[pu][th]=acc[pu][th]||{sum:0,n:0};
    acc[pu][th].sum+=nv; acc[pu][th].n++;
  });
  const puList=Object.keys(acc).sort();
  const thSet={}; puList.forEach(pu=>Object.keys(acc[pu]).forEach(t=>thSet[t]=1));
  const thList=Object.keys(thSet).sort();
  if(!thList.length)return '<p class="hint" style="margin-top:10px">Belum terdapat data untuk tren.</p>';

  // SVG line chart sederhana (skala 1-5)
  const W=300,H=190,padL=30,padB=26,padT=14,padR=10;
  const plotW=W-padL-padR, plotH=H-padT-padB;
  const xPos=i=>thList.length===1?padL+plotW/2:padL+plotW*i/(thList.length-1);
  const yPos=v=>padT+plotH*(1-(v-1)/4);
  const palette=['#2a78d6','#1baf7a','#eda100','#9085e9','#e66767','#16A085'];
  let grid='';
  for(let g=1;g<=5;g++){const y=yPos(g);grid+=`<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="#E4EBE6"/><text x="${padL-6}" y="${y+3}" font-size="9" fill="#889" text-anchor="end">${g}</text>`;}
  let xlab='';thList.forEach((t,i)=>{xlab+=`<text x="${xPos(i)}" y="${H-8}" font-size="9" fill="#556" text-anchor="middle">${esc(t)}</text>`;});
  let lines='',legend='';
  puList.forEach((pu,si)=>{
    const col=palette[si%palette.length];
    let dpath='',started=false,dots='';
    thList.forEach((t,i)=>{
      const c=acc[pu][t]; if(!c)return;
      const v=c.sum/c.n, X=xPos(i), Y=yPos(v);
      dpath+=(started?'L':'M')+X.toFixed(1)+' '+Y.toFixed(1)+' '; started=true;
      dots+=`<circle cx="${X.toFixed(1)}" cy="${Y.toFixed(1)}" r="3" fill="${col}"/><text x="${(X+4).toFixed(1)}" y="${(Y-5).toFixed(1)}" font-size="8" fill="${col}">${v.toFixed(2)}</text>`;
    });
    lines+=`<path d="${dpath}" fill="none" stroke="${col}" stroke-width="2"/>${dots}`;
    legend+=`<span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;font-size:11px"><span style="width:12px;height:3px;background:${col};display:inline-block"></span>${esc(pu)}</span>`;
  });
  return `<div style="margin-top:12px">
    <div style="font-weight:700;font-size:13px;margin-bottom:6px">Tren Rata-rata Nilai per Production Unit${jenisF?' ('+esc(jenisF)+')':''}</div>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:420px;display:block">${grid}${xlab}${lines}</svg>
    <div style="margin-top:6px">${legend}</div>
  </div>`;
}

let SIM_MODE='reverse';
let SIM={scope:'nasional',mid:'',end:'',target:'',lastResult:''};
function _simWeights(){const w=STORE.config.weights||{midYear:35,endYear:65};return {wMid:(Number(w.midYear)||0)/100,wEnd:(Number(w.endYear)||0)/100,mp:w.midYear,ep:w.endYear};}
function runSimReverse(){
  const {wMid,wEnd,mp,ep}=_simWeights();
  SIM.scope=$('#sim-scope').value; SIM.mid=$('#sim-mid').value; SIM.target=$('#sim-target').value;
  const mid=parseFloat(SIM.mid), tgt=parseFloat(SIM.target);
  if(isNaN(mid)||isNaN(tgt)){$('#sim-result').innerHTML='<div style="color:var(--red);font-size:13px;margin-top:10px">Mohon isi Mid Year dan Target terlebih dahulu.</div>';return;}
  if(wEnd===0){$('#sim-result').innerHTML='<div style="color:var(--red);font-size:13px;margin-top:10px">Bobot End Year 0%, perhitungan tidak dapat dilakukan.</div>';return;}
  // final = mid*wMid + end*wEnd  =>  end = (target - mid*wMid)/wEnd
  const endNeeded=(tgt-mid*wMid)/wEnd;
  let note='',col='var(--green)';
  if(endNeeded>5){note='Tidak mungkin tercapai — membutuhkan nilai End Year di atas 5 (di luar skala).';col='var(--red)';}
  else if(endNeeded<1){note='Target sudah pasti tercapai — bahkan dengan End Year minimum (1) sekalipun.';col='var(--green)';}
  else note='Untuk mencapai target nilai akhir '+tgt.toFixed(2)+', nilai End Year harus mencapai minimal angka tersebut.';
  SIM.lastResult=`<div style="margin-top:12px;padding:14px;background:var(--concrete);border-radius:12px;text-align:center">
    <div style="font-size:11px;color:var(--muted);font-weight:700">NILAI END YEAR YANG DIBUTUHKAN (${esc(SIM.scope)})</div>
    <div style="font-family:Archivo;font-weight:800;font-size:34px;color:${col}">${endNeeded>5||endNeeded<1?(endNeeded>5?'>5':'<1'):endNeeded.toFixed(2)}</div>
    <div style="font-size:12px;color:var(--muted);margin-top:4px">${note}</div>
    <div style="font-size:11px;color:var(--muted);margin-top:6px">Mid ${mid.toFixed(2)}×${mp}% + End ?×${ep}% = ${tgt.toFixed(2)}</div>
  </div>`;
  $('#sim-result').innerHTML=SIM.lastResult;
}
function runSimPredict(){
  const {wMid,wEnd,mp,ep}=_simWeights();
  SIM.scope=$('#sim-scope').value; SIM.mid=$('#sim-mid').value; SIM.end=$('#sim-end').value;
  const mid=parseFloat(SIM.mid), end=parseFloat(SIM.end);
  if(isNaN(mid)||isNaN(end)){$('#sim-result').innerHTML='<div style="color:var(--red);font-size:13px;margin-top:10px">Mohon isi Mid Year dan End Year terlebih dahulu.</div>';return;}
  const final=mid*wMid+end*wEnd;
  const tgt=SIM.scope==='nasional'?targetNasional():targetPU(SIM.scope);
  const ok=tgt&&final>=tgt;
  SIM.lastResult=`<div style="margin-top:12px;padding:14px;background:var(--concrete);border-radius:12px;text-align:center">
    <div style="font-size:11px;color:var(--muted);font-weight:700">PREDIKSI NILAI AKHIR (${esc(SIM.scope)})</div>
    <div style="font-family:Archivo;font-weight:800;font-size:34px;color:${tgt?(ok?'var(--green)':'var(--red)'):'var(--ink)'}">${final.toFixed(2)}</div>
    <div style="font-size:12px;color:var(--muted);margin-top:4px">${tgt?(ok?'Mencapai target '+tgt.toFixed(2):'Berada di bawah target '+tgt.toFixed(2)):'(target belum diisi)'}</div>
    <div style="font-size:11px;color:var(--muted);margin-top:6px">Mid ${mid.toFixed(2)}×${mp}% + End ${end.toFixed(2)}×${ep}% = ${final.toFixed(2)}</div>
  </div>`;
  $('#sim-result').innerHTML=SIM.lastResult;
}
function vsTarget(nilai,target){
  if(!target||!nilai)return '';
  const d=nilai-target;
  if(d>=0)return `<span style="color:#8FE3A0">▲ +${d.toFixed(2)} di atas target</span>`;
  return `<span style="color:#F5B5AE">▼ ${d.toFixed(2)} di bawah target</span>`;
}
function barVsTarget(items){
  if(!items.length)return '<p class="hint">Belum terdapat data.</p>';
  return items.map(it=>{
    const pct=Math.min(100,(it.nilai/5)*100);
    const tpct=it.target?Math.min(100,(it.target/5)*100):0;
    const ok=it.target&&it.nilai>=it.target;
    const col=it.target?(ok?'var(--lime)':'var(--amber)'):'var(--green-400)';
    return `<div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
        <span style="font-weight:600">${esc(it.label)}</span>
        <span style="font-family:Archivo;font-weight:800;color:${col}">${it.nilai?it.nilai.toFixed(2):'—'}${it.target?` <span style="color:var(--muted);font-weight:600;font-size:11px">/ ${it.target.toFixed(1)}</span>`:''}</span>
      </div>
      <div style="position:relative;height:14px;background:#E4EBE6;border-radius:99px">
        <div style="height:100%;width:${pct}%;background:${col};border-radius:99px"></div>
        ${it.target?`<div title="target" style="position:absolute;top:-3px;bottom:-3px;left:${tpct}%;width:2px;background:var(--ink)"></div>`:''}
      </div>
    </div>`;
  }).join('');
}

/* ============ DASHBOARD ANALISIS ============ */
let dashFilter={pu:'',periode:'',status:''};
let DASH_SRC='local'; // 'local' | 'cloud'
let _dashCloudData=null;
function allFindings(){
  if(DASH_SRC==='cloud'){
    // dari Google: array temuan {PU,Lokasi,Periode,Asesor,Area,Kategori,Status,...}
    return (_dashCloudData||[]).map(t=>({
      id:t['ID Temuan']||t['id']||'', area:t['Area']||'', kategori:t['Kategori']||'',
      deskripsi:t['Deskripsi']||'', saran:t['Saran']||'', target:t['Target']||'',
      deskPerbaikan:t['Deskripsi Perbaikan']||'', tglPerbaikan:t['Tgl Perbaikan']||'',
      status:t['Status']||'Open', verifikator:t['Verifikator']||'',
      penyebab:t['Penyebab']||'', berulang:t['Berulang']||'Tidak',
      pu:t['PU']||'', loc:t['Lokasi']||'', periode:t['Periode']||'', asesor:t['Asesor']||'',
      sessionId:t['ID Sesi']||'', 'Folder Foto':t['Folder Foto']||''
    }));
  }
  const out=[];
  STORE.sessions.forEach(s=>{
    (s.findings||[]).forEach(f=>{
      out.push({...f,pu:s.pu,loc:s.loc,periode:s.periode||'',asesor:s.asesor,sessionId:s.id});
    });
  });
  return out;
}
async function loadDashCloud(){
  if(!SYNC_URL){toast('Sinkronisasi belum aktif');return;}
  toast('Sedang mengambil temuan dari Google…');
  try{
    const res=await fetch(SYNC_URL+'?action=findings&secret='+encodeURIComponent(SYNC_SECRET));
    const out=await res.json();
    if(!out.ok){toast('Gagal: '+(out.error||'unknown'));return;}
    _dashCloudData=out.findings||[];
    renderDashboard();
  }catch(e){toast('Gagal mengambil data. Mohon periksa sinyal: '+e.message);}
}
async function updateFindingStatus(id,status){
  if(getAuth().role!=='admin'){alert('Hanya administrator yang dapat mengubah status.');return;}
  if(!SYNC_URL){alert('Sinkronisasi belum aktif.');return;}
  toast('Sedang menyimpan status…');
  try{
    const res=await fetch(SYNC_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({secret:SYNC_SECRET,type:'updateStatus',findingId:id,status,verifikator:getAuth().name||'Admin'})});
    const out=await res.json();
    if(out.ok){
      (_dashCloudData||[]).forEach(t=>{if((t['ID Temuan']||t['id'])===id)t['Status']=status;});
      alert('Status temuan telah diubah menjadi "'+status+'" dan tersimpan ke Google.');renderDashboard();
    }else alert('GAGAL mengubah status.\n\nPenyebab: '+(out.error||'tidak diketahui'));
  }catch(e){alert('GAGAL menyimpan. Mohon periksa sinyal.\n\nRincian: '+e.message);}
}
function _cloudFindingById(id){
  return (_dashCloudData||[]).find(t=>(t['ID Temuan']||t['id'])===id);
}
function openCloudFinding(id){
  const t=_cloudFindingById(id);if(!t)return;
  const katOpts=['Ringkas','Rapi','Resik','Rawat','Rajin'].map(k=>`<option ${k===(t['Kategori']||'')?'selected':''}>${k}</option>`).join('');
  const penyebabOpts=['','Kurang training','SOP tidak jelas','Alat/sarana rusak','Kelalaian operator','Lainnya']
    .map(p=>`<option value="${esc(p)}" ${p===(t['Penyebab']||'')?'selected':''}>${p===''?'— Pilih penyebab —':esc(p)}</option>`).join('');
  const folderUrl=t['Folder Foto']||'';
  const berulangBadge=t['Berulang']==='Ya'?`<span style="font-size:9px;font-weight:800;background:var(--amber);color:#fff;padding:2px 8px;border-radius:99px;margin-left:6px">TEMUAN BERULANG</span>`:'';
  $('#modal-root').innerHTML=`<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal">
    <h3>Rincian Temuan (Cloud) ${berulangBadge}</h3>
    <div style="font-size:12px;color:var(--muted);margin-bottom:10px">${esc(t['PU']||'')} — ${esc(t['Lokasi']||'')} · ${esc(t['Periode']||'')} · ${esc(t['Asesor']||'')}</div>
    <div style="font-size:11px;font-weight:800;color:var(--green);letter-spacing:.05em;margin-bottom:8px">A · HASIL TEMUAN</div>
    <label class="field"><span class="lbl">Area Pemeriksaan</span><input class="input" id="cf-area" value="${esc(t['Area']||'')}"></label>
    <label class="field"><span class="lbl">Kategori 5R</span><select class="input" id="cf-kat">${katOpts}</select></label>
    <label class="field"><span class="lbl">Deskripsi Temuan</span><textarea class="input" id="cf-desk" style="min-height:60px">${esc(t['Deskripsi']||'')}</textarea></label>
    ${folderUrl?`<a href="${esc(folderUrl)}" target="_blank" class="btn btn-ghost btn-block btn-sm" style="margin-bottom:10px">Lihat Foto pada Drive</a>`:'<p class="hint">Tidak terdapat folder foto.</p>'}
    <div style="font-size:11px;font-weight:800;color:var(--amber);letter-spacing:.05em;margin:14px 0 8px">B · TINDAK LANJUT</div>
    <label class="field"><span class="lbl">Penyebab (Root Cause)</span><select class="input" id="cf-penyebab">${penyebabOpts}</select></label>
    <label class="field"><span class="lbl">Saran Tindak Lanjut</span><textarea class="input" id="cf-saran" style="min-height:50px">${esc(t['Saran']||'')}</textarea></label>
    <label class="field"><span class="lbl">Target Penyelesaian</span><input class="input" id="cf-target" value="${esc(t['Target']||'')}"></label>
    <label class="field"><span class="lbl">Deskripsi Tindak Lanjut</span><textarea class="input" id="cf-deskp" style="min-height:50px">${esc(t['Deskripsi Perbaikan']||'')}</textarea></label>
    <label class="field"><span class="lbl">Tanggal Penyelesaian</span><input class="input" id="cf-tglp" type="date" value="${esc((t['Tgl Perbaikan']||'').slice(0,10))}"></label>
    <div style="font-size:11px;font-weight:800;color:var(--green-400);letter-spacing:.05em;margin:14px 0 8px">C · VERIFIKASI</div>
    <label class="field"><span class="lbl">Status</span><select class="input" id="cf-status">
      <option ${t['Status']==='Open'?'selected':''}>Open</option><option ${t['Status']==='Close'?'selected':''}>Close</option></select></label>
    <label class="field"><span class="lbl">Verifikator</span><input class="input" id="cf-verif" value="${esc(t['Verifikator']||'')}"></label>
    <button class="btn btn-ghost btn-block btn-sm" style="margin-bottom:8px" onclick="lihatRiwayatStatus('${esc(id)}')">Lihat Riwayat Perubahan Status</button>
    <div style="display:flex;gap:10px;margin-top:8px">
      <button class="btn btn-ghost" style="flex:1" onclick="closeModal()">Batalkan</button>
      <button class="btn btn-primary" style="flex:1" onclick="saveCloudFinding('${esc(id)}')">Simpan ke Google</button>
    </div>
  </div></div>`;
}
async function lihatRiwayatStatus(findingId){
  toast('Sedang mengambil riwayat status…');
  try{
    const res=await fetch(SYNC_URL+'?action=riwayatStatus&findingId='+encodeURIComponent(findingId)+'&secret='+encodeURIComponent(SYNC_SECRET));
    const out=await res.json();
    if(!out.ok){toast('Gagal mengambil riwayat: '+(out.error||'tidak diketahui'));return;}
    const riwayat=out.riwayat||[];
    $('#modal-root').innerHTML=`<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal">
      <h3>Riwayat Perubahan Status</h3>
      <p class="hint">Jejak audit seluruh perubahan status pada temuan ini.</p>
      ${riwayat.length?riwayat.map(r=>`<div class="list-row"><div class="nm">
          <span style="color:var(--red)">${esc(r['Status Lama']||'—')}</span> → <span style="color:var(--green-400)">${esc(r['Status Baru']||'—')}</span>
          <div style="font-size:11px;color:var(--muted);font-weight:400">${esc(r['Diubah Oleh']||'Tidak diketahui')} · ${r['Waktu Perubahan']?new Date(r['Waktu Perubahan']).toLocaleString('id-ID'):''}</div>
        </div></div>`).join(''):'<div class="empty">Belum terdapat perubahan status yang tercatat.</div>'}
      <button class="btn btn-ghost btn-block" style="margin-top:10px" onclick="openCloudFinding('${esc(findingId)}')">‹ Kembali ke Rincian Temuan</button>
    </div></div>`;
  }catch(e){ toast('Gagal mengambil riwayat (periksa sinyal): '+e.message); }
}
async function saveCloudFinding(id){
  if(getAuth().role!=='admin'){toast('Hanya administrator yang berwenang');return;}
  const payload={
    secret:SYNC_SECRET,type:'updateFinding',findingId:id,
    fields:{
      Area:$('#cf-area').value, Kategori:$('#cf-kat').value,
      Deskripsi:$('#cf-desk').value, Saran:$('#cf-saran').value,
      Target:$('#cf-target').value, 'Deskripsi Perbaikan':$('#cf-deskp').value,
      'Tgl Perbaikan':$('#cf-tglp').value, Status:$('#cf-status').value,
      Verifikator:$('#cf-verif').value
    }
  };
  toast('Sedang menyimpan ke Google…');
  try{
    const res=await fetch(SYNC_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify(payload)});
    const out=await res.json();
    if(out.ok){
      // update cache lokal
      const t=_cloudFindingById(id);
      if(t)Object.keys(payload.fields).forEach(k=>{t[k]=payload.fields[k];});
      closeModal();alert('Temuan berhasil disimpan ke Google.');renderDashboard();
    }else alert('GAGAL menyimpan.\n\nPenyebab: '+(out.error||'tidak diketahui'));
  }catch(e){alert('GAGAL menyimpan. Mohon periksa sinyal.\n\nRincian: '+e.message);}
}
function renderDashboard(){
  const auth=getAuth();
  let F=allFindings();
  // apply filters
  if(dashFilter.pu)F=F.filter(x=>x.pu===dashFilter.pu);
  if(dashFilter.periode)F=F.filter(x=>x.periode===dashFilter.periode);
  if(dashFilter.status)F=F.filter(x=>x.status===dashFilter.status);
  const pus=[...new Set(allFindings().map(x=>x.pu))];
  const periodes=[...new Set(allFindings().map(x=>x.periode).filter(Boolean))];

  const total=F.length, open=F.filter(x=>x.status==='Open').length, close=total-open;
  const pctClose=total?Math.round(close/total*100):0;

  // per PU
  const byPU={};F.forEach(x=>{byPU[x.pu]=byPU[x.pu]||{t:0,o:0,c:0};byPU[x.pu].t++;x.status==='Open'?byPU[x.pu].o++:byPU[x.pu].c++;});
  // per Area
  const byArea={};F.forEach(x=>{const k=x.pu+' · '+x.loc;byArea[k]=byArea[k]||{t:0,o:0,c:0,pic:x.asesor};byArea[k].t++;x.status==='Open'?byArea[k].o++:byArea[k].c++;});
  // per Assessor
  const byAsesor={};F.forEach(x=>{byAsesor[x.asesor]=byAsesor[x.asesor]||{t:0,o:0,c:0};byAsesor[x.asesor].t++;x.status==='Open'?byAsesor[x.asesor].o++:byAsesor[x.asesor].c++;});
  // per kategori 5R
  const by5R={};['Ringkas','Rapi','Resik','Rawat','Rajin'].forEach(k=>by5R[k]=0);F.forEach(x=>{if(by5R[x.kategori]!=null)by5R[x.kategori]++;});
  // per penyebab (root cause) — hanya yang telah diisi
  const byPenyebab={};F.forEach(x=>{if(x.penyebab){byPenyebab[x.penyebab]=(byPenyebab[x.penyebab]||0)+1;}});
  const jumlahBerulang=F.filter(x=>x.berulang==='Ya').length;

  app().innerHTML=topbar('Dashboard Temuan','Analisis 5R')+`
  <div class="wrap">
    ${auth.role==='admin'&&SYNC_URL?`<div class="card" style="padding:10px">
      <div class="seg" style="background:var(--concrete);margin:0">
        <button class="${DASH_SRC==='local'?'on':''}" style="color:${DASH_SRC==='local'?'#fff':'var(--muted)'};background:${DASH_SRC==='local'?'var(--green)':'transparent'}" onclick="DASH_SRC='local';renderDashboard()">Perangkat Ini</button>
        <button class="${DASH_SRC==='cloud'?'on':''}" style="color:${DASH_SRC==='cloud'?'#fff':'var(--muted)'};background:${DASH_SRC==='cloud'?'var(--green)':'transparent'}" onclick="DASH_SRC='cloud';${_dashCloudData?'renderDashboard()':'loadDashCloud()'}">☁ Seluruh Asesor (Cloud)</button>
      </div>
    </div>`:''}
    <div class="card">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <select class="input" style="flex:1;min-width:110px" onchange="dashFilter.pu=this.value;renderDashboard()">
          <option value="">Seluruh PU</option>${pus.map(p=>`<option ${p===dashFilter.pu?'selected':''}>${esc(p)}</option>`).join('')}</select>
        <select class="input" style="flex:1;min-width:110px" onchange="dashFilter.periode=this.value;renderDashboard()">
          <option value="">Seluruh Periode</option>${periodes.map(p=>`<option ${p===dashFilter.periode?'selected':''}>${esc(p)}</option>`).join('')}</select>
        <select class="input" style="flex:1;min-width:100px" onchange="dashFilter.status=this.value;renderDashboard()">
          <option value="">Seluruh Status</option><option ${dashFilter.status==='Open'?'selected':''}>Open</option><option ${dashFilter.status==='Close'?'selected':''}>Close</option></select>
      </div>
    </div>

    ${total===0?'<div class="empty"><div class="ic">📊</div>Belum terdapat data temuan.<br>'+(DASH_SRC==='cloud'?'Belum terdapat temuan yang tersinkron.':'Mohon selesaikan penilaian terlebih dahulu.')+'</div>':`
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <div class="card" style="flex:1;text-align:center;margin:0;padding:16px">
        <div style="font-family:Archivo;font-weight:800;font-size:28px;color:var(--green)">${total}</div>
        <div style="font-size:11px;color:var(--muted);font-weight:700">TEMUAN</div></div>
      <div class="card" style="flex:1;text-align:center;margin:0;padding:16px">
        <div style="font-family:Archivo;font-weight:800;font-size:28px;color:var(--red)">${open}</div>
        <div style="font-size:11px;color:var(--muted);font-weight:700">TERBUKA</div></div>
      <div class="card" style="flex:1;text-align:center;margin:0;padding:16px">
        <div style="font-family:Archivo;font-weight:800;font-size:28px;color:var(--green-400)">${pctClose}%</div>
        <div style="font-size:11px;color:var(--muted);font-weight:700">SELESAI</div></div>
    </div>

    ${jumlahBerulang>0?`<div class="card" style="background:#FEF9EC;border-color:#F5DFA0">
      <div style="display:flex;gap:10px;align-items:flex-start">
        <span style="font-size:18px">⚠️</span>
        <div><div style="font-weight:800;font-size:13px;margin-bottom:2px">${jumlahBerulang} Temuan Berulang</div>
        <div style="font-size:12px;color:var(--muted)">Kombinasi area dan kategori yang sama telah tercatat pada periode sebelumnya di lokasi yang sama — mengindikasikan perbaikan belum efektif.</div></div>
      </div></div>`:''}

    <div class="card"><h2>Status Terbuka terhadap Selesai</h2>${donutSVG(close,open)}</div>

    <div class="card"><h2>Temuan per Kategori 5R</h2>${barChart(by5R)}</div>

    <div class="card"><h2>Per Production Unit</h2>
      ${dashTable(byPU,['PU','Temuan','Open','Close','% Close'])}</div>

    <div class="card"><h2>Per Area / Zona</h2>
      ${dashTable(byArea,['Area','Temuan','Open','Close','% Close'])}</div>

    <div class="card"><h2>Per Asesor</h2>
      ${dashTable(byAsesor,['Assessor','Temuan','Open','Close','% Close'])}</div>

    ${Object.keys(byPenyebab).length?`<div class="card"><h2>Penyebab Utama (Root Cause)</h2>
      <p class="hint">Kategori penyebab yang dicatat asesor saat melengkapi temuan — membantu tindak lanjut yang mencegah temuan berulang, bukan sekadar perbaikan sesaat.</p>
      ${barChart(byPenyebab)}</div>`:''}

    ${DASH_SRC==='cloud'&&auth.role==='admin'?`<div class="card"><h2>Kelola Status Temuan</h2>
      <p class="hint">Ketuk salah satu temuan untuk melihat dan mengubah rincian. Hanya dapat dilakukan oleh administrator. Perubahan tersimpan ke Google.</p>
      ${F.map(x=>{const stc=x.status==='Close'?'var(--green-400)':'var(--red)';
        return `<div class="card" style="padding:13px;margin-bottom:8px;cursor:pointer" onclick="openCloudFinding('${esc(x.id)}')">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
          <span class="tag5r t-${x.kategori}">${(x.kategori||'').toUpperCase()}</span>
          ${x.berulang==='Ya'?'<span style="font-size:9px;font-weight:800;background:var(--amber);color:#fff;padding:2px 8px;border-radius:99px">BERULANG</span>':''}
          <span style="margin-left:auto;font-size:11px;font-weight:800;padding:3px 10px;border-radius:99px;color:#fff;background:${stc}">${esc(x.status)}</span>
        </div>
        <div style="font-weight:700;font-size:13px">${esc(x.pu)} — ${esc(x.loc)}</div>
        <div style="font-size:12px;color:var(--ink);font-weight:600">${esc(x.area||'')}</div>
        <div style="font-size:12px;color:var(--muted)">${esc((x.deskripsi||'').slice(0,90))}${(x.deskripsi||'').length>90?'…':''}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
          <span style="font-size:11px;color:var(--green);font-weight:700">Ketuk untuk rincian ›</span>
          ${x['Folder Foto']?'<span style="font-size:11px;color:var(--amber);font-weight:700">📷 terdapat foto</span>':''}
        </div>
      </div>`;}).join('')}
    </div>`:''}

    <div class="card"><button class="btn btn-ghost btn-block" onclick="exportDashCSV()">Unduh Rekapitulasi (CSV)</button>${DASH_SRC==='cloud'?'<button class="btn btn-ghost btn-block" style="margin-top:8px" onclick="loadDashCloud()">Perbarui dari Google</button>':''}</div>
    `}
  </div>
  <div class="botbar"><button class="btn btn-primary btn-block" onclick="VIEW='home';render()">‹ Beranda</button></div>`;
}
function dashTable(obj,heads){
  const keys=Object.keys(obj);
  if(!keys.length)return '<p class="hint">Tidak ada data.</p>';
  return `<table class="rep"><thead><tr>${heads.map((h,i)=>`<th${i>0?' class="num"':''}>${h}</th>`).join('')}</tr></thead><tbody>
    ${keys.map(k=>{const v=obj[k];const pc=v.t?Math.round(v.c/v.t*100):0;
      return `<tr><td>${esc(k)}</td><td class="num">${v.t}</td><td class="num" style="color:var(--red)">${v.o}</td><td class="num" style="color:var(--green-400)">${v.c}</td><td class="num">${pc}%</td></tr>`;}).join('')}
  </tbody></table>`;
}
function donutSVG(close,open){
  const total=close+open;if(!total)return '';
  const pct=close/total;const r=60,c=2*Math.PI*r;const dash=pct*c;
  return `<div style="display:flex;align-items:center;gap:20px;justify-content:center">
    <svg viewBox="0 0 160 160" style="width:150px">
      <circle cx="80" cy="80" r="${r}" fill="none" stroke="#E6B0AA" stroke-width="22"/>
      <circle cx="80" cy="80" r="${r}" fill="none" stroke="var(--green-400)" stroke-width="22"
        stroke-dasharray="${dash} ${c}" transform="rotate(-90 80 80)" stroke-linecap="round"/>
      <text x="80" y="74" text-anchor="middle" font-size="26" font-weight="800" font-family="Archivo" fill="var(--green)">${Math.round(pct*100)}%</text>
      <text x="80" y="96" text-anchor="middle" font-size="11" fill="#6B7A72">Close</text>
    </svg>
    <div style="font-size:13px">
      <div style="margin-bottom:6px"><span style="display:inline-block;width:12px;height:12px;background:var(--green-400);border-radius:3px;margin-right:6px"></span>Close: <b>${close}</b></div>
      <div><span style="display:inline-block;width:12px;height:12px;background:#E6B0AA;border-radius:3px;margin-right:6px"></span>Open: <b>${open}</b></div>
    </div></div>`;
}
function barChart(obj){
  const keys=Object.keys(obj);const max=Math.max(1,...keys.map(k=>obj[k]));
  const colors={Ringkas:'#1E7A5A',Rapi:'#2D7DD2',Resik:'#16A085',Rawat:'#8E44AD',Rajin:'#E8A317'};
  return `<div>${keys.map(k=>`<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
    <div style="width:64px;font-size:12px;font-weight:700">${k}</div>
    <div style="flex:1;background:#EEF1EE;border-radius:6px;height:22px;overflow:hidden">
      <div style="width:${obj[k]/max*100}%;height:100%;background:${colors[k]};border-radius:6px;min-width:${obj[k]?'24px':'0'};display:flex;align-items:center;justify-content:flex-end;padding-right:6px;color:#fff;font-size:11px;font-weight:700">${obj[k]||''}</div>
    </div></div>`).join('')}</div>`;
}
function exportDashCSV(){
  let F=allFindings();
  if(dashFilter.pu)F=F.filter(x=>x.pu===dashFilter.pu);
  if(dashFilter.periode)F=F.filter(x=>x.periode===dashFilter.periode);
  if(dashFilter.status)F=F.filter(x=>x.status===dashFilter.status);
  const head=['PU','Lokasi','Periode','Assessor','Area Pemeriksaan','Kategori','Deskripsi Temuan','Saran Tindak Lanjut','Target','Deskripsi Tindak Lanjut','Tgl Perbaikan','Status','Verifikator'];
  const rows=[head];
  F.forEach(x=>rows.push([x.pu,x.loc,x.periode,x.asesor,x.area,x.kategori,x.deskripsi,x.saran,x.target,x.deskPerbaikan,x.tglPerbaikan,x.status,x.verifikator]));
  const csv=rows.map(r=>r.map(c=>`"${String(c==null?'':c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='Rekap_Temuan_5R.csv';a.click();
  toast('Rekapitulasi telah diunduh');
}

window.addEventListener('beforeunload',function(e){
  if(VIEW==='assess'&&DRAFT){
    const p=draftProgress(DRAFT);
    if(p.done>0&&p.done<p.total){e.preventDefault();e.returnValue='';}
  }
});
