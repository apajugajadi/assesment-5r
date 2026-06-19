/* ===== Assesment 5R — app logic (vanilla JS, offline-first, localStorage) ===== */
'use strict';

const LS_KEY='asesmen5r_v1';
const AUTH_KEY='asesmen5r_auth';
// Admin password (Fase 1: disimpan di kode; ganti sesuai kebutuhan)
const ADMIN_PASS='admin5r';
const ASESOR_PASS='asesor';

/* ---------- Store ---------- */
function loadStore(){
  try{const r=localStorage.getItem(LS_KEY);if(r)return JSON.parse(r);}catch(e){}
  // seed from SEED_DATA
  const s={
    config:JSON.parse(JSON.stringify(SEED_DATA)), // areaChecks, interview, matrix, grading
    sessions:[] // saved assessments
  };
  return s;
}
function saveStore(){try{localStorage.setItem(LS_KEY,JSON.stringify(STORE));}catch(e){toast('Gagal simpan: storage penuh?');}}
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
      let yes=0,answered=0;
      krit.forEach((_,i)=>{const v=draft.answers[`${areaId}|${asp}|${i}`];if(v==='ya')yes++;if(v)answered++;});
      const sc=aspectScore(yes);
      rows.push({area:area.name,aspek:asp,score:sc,answered,total:krit.length});
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
  if(!storageOK()){toast('⚠ Penyimpanan hampir penuh — backup & hapus data lama dulu');return;}
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
window.addEventListener('DOMContentLoaded',()=>render());

/* ================= RENDER ================= */
function render(){
  const auth=getAuth();
  if(!auth){renderLogin();return;}
  if(VIEW==='admin'&&auth.role==='admin'){renderAdmin();return;}
  if(VIEW==='assess'&&DRAFT){renderAssess();return;}
  if(VIEW==='report'&&DRAFT){renderReport();return;}
  renderHome();
}

/* ---------- LOGIN ---------- */
let loginRole='asesor';
function renderLogin(){
  app().innerHTML=`
  <div class="login-hero">
    <div class="brandmark">5R</div>
    <h1>Assesment 5R</h1>
    <div class="tag">Audit Ringkas · Rapi · Resik · Rawat · Rajin — Direktorat Operasi</div>
    <div class="seg">
      <button class="${loginRole==='asesor'?'on':''}" onclick="loginRole='asesor';renderLogin()">Asesor</button>
      <button class="${loginRole==='admin'?'on':''}" onclick="loginRole='admin';renderLogin()">Admin</button>
    </div>
    <div id="login-err"></div>
    ${loginRole==='asesor'?`
      <label class="field"><span class="lbl">Nama Asesor</span>
        <input class="input" id="li-name" placeholder="Nama lengkap" autocomplete="name"></label>
      <label class="field"><span class="lbl">Kata sandi asesor</span>
        <input class="input" id="li-pass" type="password" placeholder="••••••" inputmode="text"></label>
    `:`
      <label class="field"><span class="lbl">Kata sandi admin</span>
        <input class="input" id="li-pass" type="password" placeholder="••••••"></label>
    `}
    <button class="btn btn-amber btn-block" style="margin-top:6px" onclick="doLogin()">Masuk</button>
    <div class="rail-5r"><span>RINGKAS</span><span>RAPI</span><span>RESIK</span><span>RAWAT</span><span>RAJIN</span></div>
  </div>`;
}
function doLogin(){
  const pass=($('#li-pass')||{}).value||'';
  const err=$('#login-err');
  if(loginRole==='admin'){
    if(pass!==ADMIN_PASS){err.innerHTML='<div class="login-err">Kata sandi admin salah.</div>';return;}
    setAuth({role:'admin',name:'Admin'});VIEW='home';render();
  }else{
    const name=($('#li-name')||{}).value.trim();
    if(!name){err.innerHTML='<div class="login-err">Isi nama asesor dulu.</div>';return;}
    if(pass!==ASESOR_PASS){err.innerHTML='<div class="login-err">Kata sandi asesor salah.</div>';return;}
    setAuth({role:'asesor',name});VIEW='home';render();
  }
}

/* ---------- TOPBAR ---------- */
function topbar(title,sub){
  const auth=getAuth();
  return `<div class="topbar">
    <div class="logo">5R</div>
    <div><div class="ttl">${esc(title)}</div><div class="sub">${esc(sub||'')}</div></div>
    <div class="right">
      <span class="chip">${esc(auth.role)}</span>
      <button class="icon-btn" onclick="logout()" title="Keluar">⏻</button>
    </div></div>`;
}

/* ---------- HOME ---------- */
let homePU=null;
function renderHome(){
  const auth=getAuth();
  const pus=Object.keys(STORE.config.matrix);
  if(!homePU)homePU=pus[0];
  const locs=Object.keys(STORE.config.matrix[homePU]||{});
  const dft=loadDraft();
  const resumeHtml=dft?`<div class="card" style="border:2px solid var(--amber);background:#FFF8EA">
      <div style="font-weight:800;font-family:Archivo;margin-bottom:4px">📝 Lanjutkan assessment?</div>
      <p class="hint" style="margin-bottom:12px">Ada isian belum selesai: <b>${esc(dft.pu)} — ${esc(dft.loc)}</b> (${draftProgress(dft).pct}% terisi).</p>
      <div style="display:flex;gap:10px">
        <button class="btn btn-amber" style="flex:1" onclick="resumeDraft()">Lanjutkan</button>
        <button class="btn btn-ghost btn-sm" onclick="discardDraft()">Buang</button>
      </div></div>`:'';
  app().innerHTML=topbar('Assesment 5R','Hai, '+auth.name)+`
  <div class="wrap">
    ${resumeHtml}
    <div class="card">
      <h2>Mulai Assesment</h2>
      <p class="hint">Pilih production unit dan lokasi yang mau dinilai.</p>
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
      <h2>Riwayat Tersimpan</h2>
      <p class="hint">${STORE.sessions.length} assessment di perangkat ini.</p>
      ${STORE.sessions.slice().reverse().slice(0,8).map(s=>{
        const g=gradeFor(s.avg);
        return `<div class="area-item" onclick="openSession('${s.id}')">
          <div><div class="nm">${esc(s.pu)} — ${esc(s.loc)}</div>
          <div class="st">${esc(s.date)} · ${esc(s.asesor)}</div></div>
          <span class="badge done" style="background:${g.color}">${s.avg?s.avg.toFixed(2):'—'}</span>
          <span class="chev">›</span></div>`;
      }).join('')}
    </div>`:''}

    ${auth.role==='admin'?`<button class="btn btn-ghost btn-block" onclick="VIEW='admin';render()">⚙ Kelola Form & Item Audit</button>`:''}
  </div>`;
}

function startAssess(){
  const pu=$('#h-pu').value, loc=$('#h-loc').value;
  const areas=(STORE.config.matrix[pu]||{})[loc]||[];
  // map area names -> ids
  const areaIds=areas.map(nm=>{const a=STORE.config.areaChecks.find(x=>x.name===nm);return a?a.id:null;}).filter(Boolean);
  DRAFT={id:'s'+Date.now(),pu,loc,asesor:getAuth().name,date:new Date().toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}),
    areas:areaIds,answers:{},interviewVals:{},photos:{},notes:{},curArea:0};
  VIEW='assess';render();
}
function openSession(id){
  const s=STORE.sessions.find(x=>x.id===id);if(!s)return;
  DRAFT=JSON.parse(JSON.stringify(s));VIEW='report';render();
}
function resumeDraft(){const d=loadDraft();if(!d){toast('Draft tidak ada');renderHome();return;}DRAFT=d;VIEW='assess';render();}
function discardDraft(){if(!confirm('Buang isian yang belum selesai? Tidak bisa dikembalikan.'))return;clearDraft();renderHome();toast('Draft dibuang');}

/* ---------- ASSESS ---------- */
function renderAssess(){
  const d=DRAFT;
  const prog=draftProgress(d);
  // area navigation: list of selected areas + a final "interview" step
  const totalSteps=d.areas.length+1; // +1 for interview step at end
  const step=d.curArea;
  app().innerHTML=topbar(d.loc,d.pu+' · '+d.asesor)+`
   <div class="spine">
     <div class="bar"><div class="fill" style="width:${prog.pct}%"></div></div>
     <div class="meta"><span>${prog.done}/${prog.total} terisi</span><span id="save-ind" class="save-ind">✓ Tersimpan</span></div>
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
function renderAssessBody(){
  const d=DRAFT, step=d.curArea, body=$('#assess-body');
  // last step = interview
  if(step>=d.areas.length){
    body.innerHTML=`<div class="card"><h2>Wawancara Operator & Supervisor</h2>
      <p class="hint">Nilai langsung 1 (terburuk) sampai 5 (terbaik) sesuai kondisi.</p></div>`
      + STORE.config.interview.map((it,idx)=>{
        const val=d.interviewVals[idx]||0;
        const desc=val?it.rubrik[val-1]:'';
        return `<div class="card">
          <div class="aspect-head"><span class="tag5r t-Rajin">RAJIN</span> ${esc(it.area)} — ${esc(it.aspek)}</div>
          <div class="scale">${[1,2,3,4,5].map(n=>`<button class="${val===n?'on':''}" onclick="setInterview(${idx},${n})">${n}</button>`).join('')}</div>
          <div class="scale-desc" id="idesc-${idx}">${esc(desc)}</div>
        </div>`;
      }).join('');
    return;
  }
  const areaId=d.areas[step];
  const area=STORE.config.areaChecks.find(a=>a.id===areaId);
  if(!area){body.innerHTML='<div class="empty">Area tidak ditemukan.</div>';return;}
  let html=`<div class="card" style="background:var(--green);color:#fff;border:none">
    <div style="font-size:12px;opacity:.7;font-weight:700;letter-spacing:.05em">AREA ${step+1} DARI ${d.areas.length}</div>
    <h2 style="color:#fff;margin-top:4px">${esc(area.name)}</h2></div>`;
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
      <div class="finding-lbl">Temuan & foto — ${asp}</div>
      <div class="photo-row">
        ${photos.map((p,i)=>`<img src="${p}" class="photo-thumb" onclick="rmPhoto('${akey}',${i})">`).join('')}
        <label class="photo-add">+<input type="file" accept="image/*" capture="environment" style="display:none" onchange="addPhoto('${akey}',this)"></label>
      </div>
      <textarea class="note-input" placeholder="Catatan temuan ${asp.toLowerCase()}…" oninput="d_setNote('${akey}',this.value)">${esc(d.notes[akey]||'')}</textarea>
    </div>`;
    html+=`</div>`;
  });
  body.innerHTML=html;
}
function setAns(key,val){DRAFT.answers[key]=DRAFT.answers[key]===val?undefined:val;saveDraftLite();renderAssessBody();updateSpine();}
function setInterview(idx,n){DRAFT.interviewVals[idx]=DRAFT.interviewVals[idx]===n?0:n;saveDraftLite();renderAssessBody();updateSpine();}
function d_setNote(areaId,v){DRAFT.notes[areaId]=v;saveDraftLite();}
function updateSpine(){const p=draftProgress(DRAFT);const f=$('.spine .fill');if(f){f.style.width=p.pct+'%';const m=$('.spine .meta span');if(m)m.textContent=`${p.done}/${p.total} terisi`;}}
function navArea(dir){DRAFT.curArea=Math.max(0,Math.min(DRAFT.areas.length,DRAFT.curArea+dir));saveDraftLite();window.scrollTo(0,0);renderAssess();}
function addPhoto(areaId,inp){const f=inp.files[0];if(!f)return;handlePhoto(f,url=>{(DRAFT.photos[areaId]=DRAFT.photos[areaId]||[]).push(url);saveDraftLite();renderAssessBody();});}
function rmPhoto(areaId,i){if(confirm('Hapus foto ini?')){DRAFT.photos[areaId].splice(i,1);saveDraftLite();renderAssessBody();}}

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
    toast('⚠ Penyimpanan penuh — kurangi foto / backup dulu');
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

function finishAssess(){
  const rep=computeReport(DRAFT);
  DRAFT.avg=rep.avg;DRAFT.finishedAt=new Date().toISOString();
  // upsert into sessions
  const i=STORE.sessions.findIndex(s=>s.id===DRAFT.id);
  const rec=JSON.parse(JSON.stringify(DRAFT));
  if(i>=0)STORE.sessions[i]=rec;else STORE.sessions.push(rec);
  saveStore();clearDraft();VIEW='report';render();
}

/* ---------- REPORT ---------- */
function renderReport(){
  const d=DRAFT, rep=computeReport(d), g=rep.grade;
  app().innerHTML=topbar('Hasil Assesment',d.pu+' · '+d.loc)+`
  <div class="wrap">
    <div class="predikat-hero" style="background:linear-gradient(135deg,${g.color},${shade(g.color,-18)})">
      <div class="score">${rep.avg?rep.avg.toFixed(2):'—'}</div>
      <div class="lbl">${esc(g.label)}</div>
      <div class="sub">${esc(d.loc)} · ${esc(d.date)} · ${esc(d.asesor)}</div>
    </div>
    <div class="radar-wrap">
      <div style="font-weight:800;font-family:Archivo;margin-bottom:10px">Profil 5R</div>
      ${radarSVG(rep.radar)}
    </div>
    <div class="card">
      <h2>Rincian Nilai</h2>
      <table class="rep"><thead><tr><th>Area</th><th>Aspek</th><th class="num">Nilai</th></tr></thead><tbody>
      ${rep.rows.map(r=>`<tr><td>${esc(r.area)}</td><td>${esc(r.aspek)}${r.interview?' <span style="font-size:10px;color:var(--amber)">●interview</span>':''}</td><td class="num" style="color:${gradeFor(r.score).color}">${r.score}</td></tr>`).join('')}
      </tbody></table>
    </div>
    ${reportNotes(d)}
    <div class="card">
      <h2>Ekspor</h2>
      <p class="hint">Simpan hasil untuk laporan atau arsip.</p>
      <button class="btn btn-ghost btn-block" style="margin-bottom:10px" onclick="exportCSV()">⬇ Unduh CSV (Excel)</button>
      <button class="btn btn-ghost btn-block" onclick="window.print()">🖨 Cetak / Simpan PDF</button>
    </div>
  </div>
  <div class="botbar">
    <button class="btn btn-ghost" onclick="VIEW='assess';render()">‹ Edit</button>
    <button class="btn btn-primary" onclick="VIEW='home';DRAFT=null;render()">Selesai</button>
  </div>`;
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
  return `<div class="card"><h2>Temuan & Foto</h2>
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
  let rows=[['Production Unit',d.pu],['Lokasi',d.loc],['Asesor',d.asesor],['Tanggal',d.date],['Nilai Akhir',rep.avg?rep.avg.toFixed(2):''],['Predikat',rep.grade.label],[],['Area','Aspek','Nilai','Catatan']];
  rep.rows.forEach(r=>rows.push([r.area,r.aspek+(r.interview?' (interview)':''),r.score,'']));
  rows.push([]);rows.push(['Temuan']);
  Object.keys(d.notes||{}).forEach(k=>{if(d.notes[k]){const parts=k.split('|');const a=STORE.config.areaChecks.find(x=>x.id===parts[0]);rows.push([(a?a.name:parts[0])+(parts[1]?' — '+parts[1]:''),d.notes[k]]);}});
  const csv=rows.map(r=>r.map(c=>`"${String(c==null?'':c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=`Assesment5R_${d.pu}_${d.loc}_${d.date}.csv`.replace(/[^\w.\-]/g,'_');a.click();
  toast('CSV diunduh');
}

/* ---------- ADMIN CMS ---------- */
function renderAdmin(){
  app().innerHTML=topbar('Kelola Form','Mode admin')+`
  <div class="wrap">
    <div class="adm-tab">
      <button class="${ADMIN_TAB==='area'?'on':''}" onclick="ADMIN_TAB='area';renderAdmin()">Area Check</button>
      <button class="${ADMIN_TAB==='matrix'?'on':''}" onclick="ADMIN_TAB='matrix';renderAdmin()">Form per Lokasi</button>
      <button class="${ADMIN_TAB==='sessions'?'on':''}" onclick="ADMIN_TAB='sessions';renderAdmin()">Data Tersimpan</button>
      <button class="${ADMIN_TAB==='data'?'on':''}" onclick="ADMIN_TAB='data';renderAdmin()">Backup</button>
    </div>
    <div id="adm-body"></div>
  </div>
  <div class="botbar"><button class="btn btn-primary btn-block" onclick="VIEW='home';render()">‹ Kembali ke Beranda</button></div>`;
  const b=$('#adm-body');
  if(ADMIN_TAB==='area')b.innerHTML=admArea();
  else if(ADMIN_TAB==='matrix')b.innerHTML=admMatrix();
  else if(ADMIN_TAB==='sessions')b.innerHTML=admSessions();
  else b.innerHTML=admData();
}
function admArea(){
  return `<div class="card"><h2>Master Area Check</h2>
    <p class="hint">${STORE.config.areaChecks.length} area. Klik untuk edit aspek & kriteria (Ya/Tidak).</p>
    <button class="btn btn-amber btn-sm" onclick="editArea(null)">+ Tambah Area Check</button></div>
    ${STORE.config.areaChecks.map(a=>{
      const nItems=ASPECTS.reduce((s,asp)=>s+((a.aspects[asp]||[]).length),0);
      return `<div class="list-row"><div class="nm">${esc(a.name)}<div style="font-size:12px;color:var(--muted);font-weight:400">${nItems} kriteria</div></div>
        <button class="btn btn-ghost btn-sm" onclick="editArea('${a.id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="delArea('${a.id}')">Hapus</button></div>`;
    }).join('')}`;
}
function editArea(id){
  const area=id?STORE.config.areaChecks.find(a=>a.id===id):{id:'new'+Date.now(),name:'',aspects:{Ringkas:[''],Rapi:[''],Resik:[''],Rawat:['']}};
  const isNew=!id;
  let html=`<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal">
    <h3>${isNew?'Tambah':'Edit'} Area Check</h3>
    <label class="field"><span class="lbl">Nama Area Check</span>
      <input class="input" id="ea-name" value="${esc(area.name)}" placeholder="cth: 5R Board / STK"></label>`;
  ASPECTS.forEach(asp=>{
    const krit=area.aspects[asp]||[];
    html+=`<div style="margin-bottom:14px"><div class="aspect-head"><span class="tag5r t-${asp}">${asp.toUpperCase()}</span></div>
      <div id="ea-${asp}">`;
    krit.forEach((k,i)=>{html+=critRow(asp,i,k);});
    html+=`</div><button class="btn btn-ghost btn-sm" onclick="addCrit('${asp}')">+ kriteria</button></div>`;
  });
  html+=`<div style="display:flex;gap:10px;margin-top:8px">
    <button class="btn btn-ghost" style="flex:1" onclick="closeModal()">Batal</button>
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
  saveStore();closeModal();renderAdmin();toast('Area tersimpan');
}
function delArea(id){if(!confirm('Hapus area check ini? Item assessment terkait akan hilang.'))return;
  STORE.config.areaChecks=STORE.config.areaChecks.filter(a=>a.id!==id);
  // remove from matrix
  Object.keys(STORE.config.matrix).forEach(pu=>Object.keys(STORE.config.matrix[pu]).forEach(loc=>{
    STORE.config.matrix[pu][loc]=STORE.config.matrix[pu][loc].filter(nm=>{const a=STORE.config.areaChecks.find(x=>x.name===nm);return !!a;});
  }));
  saveStore();renderAdmin();toast('Area dihapus');
}
function closeModal(){$('#modal-root').innerHTML='';}

function admMatrix(){
  const pus=Object.keys(STORE.config.matrix);
  if(!window._mxPU)window._mxPU=pus[0];
  const pu=window._mxPU;const locs=Object.keys(STORE.config.matrix[pu]||{});
  return `<div class="card"><h2>Form per Lokasi</h2>
    <p class="hint">Atur area check mana yang masuk di tiap lokasi. Centang = dinilai di lokasi itu.</p>
    <label class="field"><span class="lbl">Production Unit</span>
      <select class="input" onchange="window._mxPU=this.value;renderAdmin()">${pus.map(p=>`<option ${p===pu?'selected':''}>${esc(p)}</option>`).join('')}</select></label>
    <button class="btn btn-amber btn-sm" onclick="addLoc()">+ Tambah Lokasi</button>
    </div>
    ${locs.map(loc=>`<div class="card"><div style="display:flex;align-items:center;margin-bottom:10px">
      <h2 style="margin:0;font-size:16px">${esc(loc)}</h2>
      <button class="btn btn-danger btn-sm" style="margin-left:auto" onclick="delLoc('${esc(loc)}')">Hapus lokasi</button></div>
      ${STORE.config.areaChecks.map(a=>{
        const on=(STORE.config.matrix[pu][loc]||[]).includes(a.name);
        return `<label style="display:flex;align-items:center;gap:10px;padding:7px 0;font-size:14px">
          <input type="checkbox" ${on?'checked':''} style="width:20px;height:20px" onchange="toggleArea('${pu}','${esc(loc)}','${a.id}',this.checked)">
          ${esc(a.name)}</label>`;
      }).join('')}
    </div>`).join('')}`;
}
function toggleArea(pu,loc,areaId,on){
  const a=STORE.config.areaChecks.find(x=>x.id===areaId);if(!a)return;
  let arr=STORE.config.matrix[pu][loc]||[];
  if(on){if(!arr.includes(a.name))arr.push(a.name);}else{arr=arr.filter(n=>n!==a.name);}
  STORE.config.matrix[pu][loc]=arr;saveStore();
}
function addLoc(){const nm=prompt('Nama lokasi baru:');if(!nm)return;STORE.config.matrix[window._mxPU][nm.trim()]=[];saveStore();renderAdmin();}
function delLoc(loc){if(!confirm('Hapus lokasi '+loc+'?'))return;delete STORE.config.matrix[window._mxPU][loc];saveStore();renderAdmin();}

function admSessions(){
  if(!STORE.sessions.length)return `<div class="empty"><div class="ic">📋</div>Belum ada assessment tersimpan.</div>`;
  return STORE.sessions.slice().reverse().map(s=>{const g=gradeFor(s.avg);
    return `<div class="list-row"><div class="nm">${esc(s.pu)} — ${esc(s.loc)}<div style="font-size:12px;color:var(--muted);font-weight:400">${esc(s.date)} · ${esc(s.asesor)}</div></div>
      <span class="badge done" style="background:${g.color};color:#fff;font-family:Archivo;font-weight:800;padding:6px 11px;border-radius:9px">${s.avg?s.avg.toFixed(2):'—'}</span>
      <button class="btn btn-ghost btn-sm" onclick="openSession('${s.id}')">Buka</button>
      <button class="btn btn-danger btn-sm" onclick="delSession('${s.id}')">✕</button></div>`;
  }).join('');
}
function delSession(id){if(!confirm('Hapus data assessment ini?'))return;STORE.sessions=STORE.sessions.filter(s=>s.id!==id);saveStore();renderAdmin();}

function admData(){
  const used=storageUsage(),pct=Math.min(100,Math.round(used/(5*1024*1024)*100));
  const mb=(used/1024/1024).toFixed(2);
  const barColor=pct>85?'var(--red)':pct>60?'var(--amber)':'var(--lime)';
  return `<div class="card"><h2>Penyimpanan Perangkat</h2>
    <p class="hint">Terpakai ~${mb} MB dari ±5 MB (${pct}%). Foto paling banyak makan tempat.</p>
    <div class="bar" style="height:10px;background:#DCE4DF;border-radius:99px;overflow:hidden;margin-bottom:6px"><div style="height:100%;width:${pct}%;background:${barColor};border-radius:99px"></div></div>
    ${pct>85?'<div class="login-err" style="background:var(--red)">Hampir penuh! Backup lalu hapus data lama.</div>':''}
  </div>
  <div class="card"><h2>Backup & Restore</h2>
    <p class="hint">Data tersimpan di perangkat ini saja. Backup berkala agar tidak hilang.</p>
    <button class="btn btn-ghost btn-block" style="margin-bottom:10px" onclick="backupData()">⬇ Unduh Backup (JSON)</button>
    <label class="btn btn-ghost btn-block" style="margin-bottom:10px">⬆ Pulihkan dari Backup<input type="file" accept=".json" style="display:none" onchange="restoreData(this)"></label>
    <button class="btn btn-danger btn-block" onclick="resetData()">⟲ Reset ke Data Awal</button>
  </div>`;
}
function backupData(){const blob=new Blob([JSON.stringify(STORE)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='backup_asesmen5r_'+new Date().toISOString().slice(0,10)+'.json';a.click();toast('Backup diunduh');}
function restoreData(inp){const f=inp.files[0];if(!f)return;const r=new FileReader();r.onload=e=>{try{STORE=JSON.parse(e.target.result);saveStore();toast('Data dipulihkan');renderAdmin();}catch(err){toast('File backup tidak valid');}};r.readAsText(f);}
function resetData(){if(!confirm('Reset semua ke data awal? Assessment tersimpan akan hilang.'))return;localStorage.removeItem(LS_KEY);STORE=loadStore();saveStore();renderAdmin();toast('Data direset');}

/* ---------- Warning sebelum nutup halaman saat mengisi ---------- */
window.addEventListener('beforeunload',function(e){
  if(VIEW==='assess'&&DRAFT){
    const p=draftProgress(DRAFT);
    if(p.done>0&&p.done<p.total){e.preventDefault();e.returnValue='';}
  }
});
