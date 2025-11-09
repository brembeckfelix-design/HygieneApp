// === Config & Storage ===
const KEY_CFG='hyg_cfg_v1'; const KEY_PROGRESS='hyg_progress_v1'; const KEY_EXAM='hyg_exam_v1';
const DIFFS=['leicht','mittel','schwer']; const QTYPES=['single','multi'];
let QUESTIONS=[], TOPICS=[];
const cfg = load(KEY_CFG, { examCount: 20, passPct: 80 });
let progress = load(KEY_PROGRESS, { byId:{} });
let examState = load(KEY_EXAM, null);

function load(key, fallback){ try{ const x = JSON.parse(localStorage.getItem(key)); return x==null? fallback : x; }catch(e){ return fallback; } }
function save(key, val){ localStorage.setItem(key, JSON.stringify(val)); }
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function uid(){ return Math.random().toString(36).slice(2,10); }

document.addEventListener('DOMContentLoaded', async()=>{
  await loadQuestions();
  buildFilters();
  updateStats(); populateReview();
});

async function loadQuestions(){
  const res = await fetch('data/questions.json'); const json = await res.json();
  QUESTIONS = json.questions || [];
  TOPICS = Array.from(new Set(QUESTIONS.map(q=>q.topic))).sort();
}

// === Tabs ===
function showTab(tab){
  ['home','learn','exam','stats'].forEach(t=>{
    document.getElementById('view-'+t).classList.toggle('hidden', t!==tab);
    document.getElementById('tab-'+t).classList.toggle('active', t===tab);
  });
  if(tab==='learn') renderLearn();
  if(tab==='stats') { updateStats(); populateReview(); }
}
window.showTab=showTab;

// === Config ===
function saveConfig(){
  const ec = parseInt(document.getElementById('cfgExamCount').value||cfg.examCount,10);
  const pp = parseInt(document.getElementById('cfgPassPct').value||cfg.passPct,10);
  cfg.examCount = clamp(ec, 10, 50); cfg.passPct = clamp(pp, 50, 100);
  save(KEY_CFG, cfg); alert('Einstellungen gespeichert.');
}
window.saveConfig=saveConfig;

// === Learn Mode ===
let learnIdx=0;
function buildFilters(){
  const topicSel=document.getElementById('topicSelect'); topicSel.innerHTML = TOPICS.map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  const typeSel=document.getElementById('qtypeSelect'); typeSel.innerHTML=['alle',...QTYPES].map(x=>`<option value="${x}">${x}</option>`).join('');
  const diffSel=document.getElementById('difficultySelect'); diffSel.innerHTML=['alle',...DIFFS].map(x=>`<option value="${x}">${x}</option>`).join('');
}
function renderLearn(){
  const topic=document.getElementById('topicSelect').value||TOPICS[0];
  const qt=document.getElementById('qtypeSelect').value||'alle';
  const df=document.getElementById('difficultySelect').value||'alle';
  const pool = QUESTIONS.filter(q=>(q.topic===topic) && (qt==='alle'||q.type===qt) && (df==='alle'||q.difficulty===df));
  if(pool.length===0){ document.getElementById('learnArea').innerHTML='<p class="muted">Keine Fragen zu diesem Filter.</p>'; return; }
  if(learnIdx>=pool.length) learnIdx=0;
  const q=pool[learnIdx];
  document.getElementById('learnArea').innerHTML = renderQuestionCard(q,true);
}
function nextLearn(){ learnIdx++; renderLearn(); } function prevLearn(){ learnIdx=Math.max(0,learnIdx-1); renderLearn(); }
window.nextLearn=nextLearn; window.prevLearn=prevLearn;

// === Exam Mode ===
function startExam(){
  const pool = shuffle(QUESTIONS); // alle Themen
  const order = pool.slice(0, cfg.examCount).map(q=>q.id);
  examState={ id:uid(), startedAt:Date.now(), idx:0, order, answers:{}, done:false };
  save(KEY_EXAM, examState); renderExam();
}
function resumeExam(){ if(!examState){ alert('Keine laufende Prüfung.'); return; } renderExam(); }
function cancelExam(){ if(confirm('Laufende Prüfung beenden?')){ examState=null; save(KEY_EXAM,null); document.getElementById('examArea').innerHTML=''; } }
window.startExam=startExam; window.resumeExam=resumeExam; window.cancelExam=cancelExam;

function renderExam(){
  const area=document.getElementById('examArea');
  if(!examState){ area.innerHTML='<p class="muted">Keine laufende Prüfung.</p>'; return; }
  const qid=examState.order[examState.idx]; const q=QUESTIONS.find(x=>x.id===qid);
  area.innerHTML = `
    <div class="item"><div>Frage ${examState.idx+1}/${examState.order.length}</div><div class="pill">${escapeHtml(q.topic)}</div></div>
    <div class="card"><div class="q-card">${renderQuestionInner(q, examState.answers[q.id])}</div></div>
    <div class="row" style="margin-top:10px">
      <button class="btn" onclick="examPrev()">Zurück</button>
      <button class="btn" onclick="saveExamAnswer('${q.id}')">Antwort speichern</button>
      <button class="btn primary" onclick="examNext()">Weiter</button>
      <button class="btn" onclick="finishExam()">Abgeben</button>
    </div>`;
}
function saveExamAnswer(qid){
  const q=QUESTIONS.find(x=>x.id===qid); const sel=collectSelection(q);
  examState.answers[qid]=sel; save(KEY_EXAM, examState); alert('Antwort gespeichert.');
}
function examPrev(){ if(examState.idx>0){ examState.idx--; save(KEY_EXAM,examState); renderExam(); } }
function examNext(){ if(examState.idx<examState.order.length-1){ examState.idx++; save(KEY_EXAM,examState); renderExam(); } }
window.saveExamAnswer=saveExamAnswer; window.examPrev=examPrev; window.examNext=examNext;

function finishExam(){
  const res = gradeExam(examState);
  examState.done=true; examState.result=res; save(KEY_EXAM, examState);
  res.byId && Object.entries(res.byId).forEach(([id, r])=> markResult(id, r.correct));
  const area=document.getElementById('examArea');
  area.innerHTML=`
    <div class="card"><h2>Ergebnis</h2>
      <p>Punkte: <b>${res.points}</b> / ${res.total} — ${res.passed?'<span class="pill" style="border-color:#1e6b36;background:rgba(34,197,94,.08)">Bestanden</span>':'<span class="pill" style="border-color:#7a2031;background:rgba(239,68,68,.08)">Nicht bestanden</span>'}</p>
      <p class="muted">Quote: ${res.pct}% • Dauer: ${formatDuration(res.durationMs)}</p>
      <p class="muted">Bestehensgrenze: ${cfg.passPct}%</p>
    </div>
    <div class="card"><h3>Fehlerliste</h3>
      ${res.review.map(r=>!r.correct?`
        <details class="item">
          <summary>${r.q.id}: ${escapeHtml(r.q.question.slice(0,120))} ❌</summary>
          ${renderQuestionInner(r.q, r.selected, true)}
          <div class="muted">Deine Auswahl: ${formatSelection(r.q, r.selected)} — Lösung: ${formatSelection(r.q, correctKeys(r.q))}</div>
        </details>`:'').join('') || '<p class="muted">Keine Fehler 🎉</p>'}
    </div>`;
}
window.finishExam=finishExam;

function gradeExam(ex){
  let points=0,total=0; const review=[]; const byId={};
  ex.order.forEach(id=>{
    const q=QUESTIONS.find(x=>x.id===id); const sel=ex.answers[id]||[];
    const ok=isCorrect(q, sel); const p=(q.points||1);
    total+=p; if(ok) points+=p; review.push({q, selected:sel, correct:ok, points:p}); byId[id]={correct:ok, points:p};
  });
  const pct = total? Math.round(100*points/total) : 0;
  return { points, total, pct, passed: pct>=cfg.passPct, durationMs: Date.now()-ex.startedAt, review, byId };
}

// === Rendering helpers ===
function renderQuestionCard(q, withCheck=false){
  return `<div class="card"><div class="q-card">${renderQuestionInner(q)}</div>
    ${withCheck?'<div class="row"><button class="btn" onclick="checkAnswer(\''+q.id+'\', this)">Prüfen</button></div>':''}
  </div>`;
}
function renderQuestionInner(q, preselected=null, showSolution=false){
  const ans=q.answers||[]; const type=q.type||'single'; const name='q_'+q.id;
  const inputs=ans.map((a,i)=>{
    const checked = preselected && preselected.includes(i) ? 'checked' : '';
    return `<label class="ans"><input type="${type==='multi'?'checkbox':'radio'}" name="${name}" value="${i}" ${checked}> <div>${escapeHtml(a.text)}</div></label>`;
  }).join('');
  const meta = `<div class="pill">${type==='multi'?'Mehrfachwahl':'Einfachwahl'}</div> <div class="pill">${q.points||1} Pkt</div> <div class="pill">${escapeHtml(q.topic)}</div>`;
  const sol = showSolution? `<div class="muted">Lösung: ${formatSelection(q, correctKeys(q))}${q.explanation?'<br><em>'+escapeHtml(q.explanation)+'</em>':''}</div>` : '';
  return `${meta}<p>${escapeHtml(q.question)}</p><div class="answers">${inputs}</div>${sol}`;
}
function escapeHtml(str){ return (str||'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
function collectSelection(q){ const nodes=[...document.querySelectorAll('input[name="q_'+q.id+'"]')]; return nodes.filter(n=>n.checked).map(n=>parseInt(n.value,10)); }
function isCorrect(q, sel){ const c=correctKeys(q); const s=[...sel].sort(); return JSON.stringify(c)===JSON.stringify(s); }
function correctKeys(q){ return (q.answers||[]).map((a,i)=>a.correct? i: null).filter(x=>x!==null); }
function formatSelection(q, sel){ if(!sel || sel.length===0) return '—'; return sel.map(i=>String.fromCharCode(65+i)).join(', '); }
function checkAnswer(qid, btn){
  const q=QUESTIONS.find(x=>x.id===qid); const sel=collectSelection(q); const ok=isCorrect(q, sel);
  markResult(qid, ok);
  const name='q_'+q.id; const nodes=[...document.querySelectorAll('input[name="'+name+'"]')];
  nodes.forEach((n,i)=>{
    const wrap=n.closest('.ans'); wrap.classList.remove('correct','wrong');
    const isC=!!q.answers[i].correct; if(isC) wrap.classList.add('correct'); if(n.checked && !isC) wrap.classList.add('wrong');
  });
  btn.textContent = ok? 'Richtig ✅' : 'Falsch ❌';
}
function formatDuration(ms){ const s=Math.round(ms/1000); const m=Math.floor(s/60); return `${m} min ${s%60} s`; }

// === Progress, Stats & Review ===
function markResult(id, ok){
  if(!progress.byId[id]) progress.byId[id]={ seen:0, correct:0 };
  progress.byId[id].seen += 1; if(ok) progress.byId[id].correct += 1;
  save(KEY_PROGRESS, progress); updateStats(); populateReview();
}
function updateStats(){
  const total=QUESTIONS.length;
  const seen=Object.keys(progress.byId).length;
  const rate = total? Math.round(100 * (sum(Object.values(progress.byId).map(x=>x.correct)) / sum(Object.values(progress.byId).map(x=>x.seen)))) : 0;
  setTxt('statTotal', total); setTxt('statSeen', seen); setTxt('statRate', isNaN(rate)? '–' : rate+'%');
  setTxt('statLastExam', examState && examState.result ? new Date(examState.startedAt).toLocaleString() : '–');
}
function sum(arr){ return arr.reduce((a,b)=>a+b,0); }
function setTxt(id, v){ const el=document.getElementById(id); if(el) el.textContent=v; }
function populateReview(){
  const div=document.getElementById('reviewList'); if(!div) return;
  const weak = QUESTIONS.filter(q=>{
    const p=progress.byId[q.id]; if(!p) return false;
    return p.correct / p.seen < 0.6 && p.seen >= 2;
  });
  div.innerHTML = weak.length? weak.map(q=>`<div class="item"><div>${q.id}: ${escapeHtml(q.question.slice(0,80))}</div><button class="btn" onclick="openReview('${q.id}')">Üben</button></div>`).join('') : '<p class="muted">Noch keine Wiederholung nötig.</p>';
}
function openReview(id){
  const q=QUESTIONS.find(x=>x.id===id);
  alert('Wiederholen: '+q.id+' — '+q.question);
  showTab('learn');
}

// === Import/Export ===
function exportAll(){
  const payload={ cfg, progress };
  const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
  const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='hygiene-backup.json'; a.click(); URL.revokeObjectURL(url);
}
function importAll(ev){
  const file=ev.target.files[0]; if(!file) return;
  const reader=new FileReader(); reader.onload=()=>{
    try{ const obj=JSON.parse(reader.result);
      if(obj.cfg){ Object.assign(cfg,obj.cfg); save(KEY_CFG,cfg); }
      if(obj.progress){ progress=obj.progress; save(KEY_PROGRESS,progress); }
      updateStats(); populateReview(); alert('Import erfolgreich.');
    }catch(e){ alert('Import-Fehler: '+e.message); }
  }; reader.readAsText(file);
}
window.exportAll=exportAll; window.importAll=importAll;

// === Utils ===
function shuffle(arr){ const a=[...arr]; for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
