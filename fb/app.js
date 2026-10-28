// App de campo (Firebase): usa o cache offline NATIVO do Firestore (fila de escrita do próprio SDK).
import { fs, instancia, onAuthStateChanged, signOut } from './fb.js';
import { uuid, sha256Hex, assinaturaPad } from '../comum.js';
const { doc, setDoc, getDocs, collection, query, where, onSnapshot } = fs;

const $ = id => document.getElementById(id);
let ctx, pad, listaOS = [];
const falhas = JSON.parse(localStorage.getItem('prova_fb_falhas') || '[]');   // gravações recusadas pelas regras
let pend = 0, conf = 0, itens = [], parar = null;
const enviados = JSON.parse(localStorage.getItem('prova_fb_enviados') || '{}');  // id -> {data, confirmado}
const guardar = () => { localStorage.setItem('prova_fb_enviados', JSON.stringify(enviados)); localStorage.setItem('prova_fb_falhas', JSON.stringify(falhas)); };

function render() {
  const el = $('status'); Object.assign(el.dataset, { pendentes: pend, falhas: falhas.length, confirmados: conf });
  el.className = falhas.length ? 'err' : pend ? 'pend' : 'ok';
  el.textContent = falhas.length ? `${falhas.length} falhou · ${pend} pendentes · ${conf} confirmados`
    : pend ? `${pend} pendentes no aparelho · ${conf} confirmados` : `Tudo confirmado (${conf})`;
  $('fila').innerHTML = itens.map(i => `<li>${i.data} · OS ${i.osNumero || '?'} · <b>${i.pendente ? 'pendente' : 'confirmado'}</b></li>`).join('')
    + falhas.map(f => `<li><b>falhou</b> — ${f.data} · ${f.erro}</li>`).join('');
}

async function carregarOS() {
  // Sem rede, o SDK responde a partir do cache local
  const snap = await getDocs(query(collection(ctx.db, 'os'), where('operadores', 'array-contains', ctx.auth.currentUser.email.toLowerCase())));
  listaOS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  $('os').innerHTML = listaOS.map(o => `<option value="${o.id}">OS ${o.numero}</option>`).join('');
  const at = () => { const o = listaOS.find(x => x.id === $('os').value) || { ativos_info: [] }; $('ativo').innerHTML = (o.ativos_info || []).map(a => `<option value="${a.id}">${a.patrimonio}</option>`).join(''); };
  $('os').onchange = at; at();
}

function observar() {
  const q = query(collection(ctx.db, 'registros_campo'), where('operador_email', '==', ctx.auth.currentUser.email.toLowerCase()));
  if (parar) parar();
  parar = onSnapshot(q, { includeMetadataChanges: true }, s => {
    const presentes = new Set(s.docs.map(d => d.id));
    for (const d of s.docs) if (!d.metadata.hasPendingWrites && enviados[d.id]) enviados[d.id].confirmado = true;
    // Gravação reenviada pelo SDK após reabrir o app e recusada pelas regras: o documento some sem aviso
    if (!s.metadata.fromCache) for (const [id, e] of Object.entries(enviados))
      if (!e.confirmado && !presentes.has(id) && !falhas.some(f => f.id === id)) falhas.push({ id, data: e.data, erro: 'recusado pelo servidor (sumiu da fila)' });
    guardar();
    itens = s.docs.map(d => ({ ...d.data(), pendente: d.metadata.hasPendingWrites, osNumero: (listaOS.find(o => o.id === d.data().os_id) || {}).numero }))
      .sort((a, b) => (a.capturado_em > b.capturado_em ? 1 : -1));
    pend = itens.filter(i => i.pendente).length; conf = itens.length - pend; render();
  }, () => {});
}

async function salvar(ev) {
  ev.preventDefault(); const b64 = pad.base64(); const id = uuid();
  const reg = { os_id: $('os').value, ativo_id: $('ativo').value || null, operador_email: ctx.auth.currentUser.email.toLowerCase(),
    data: $('data').value, capturado_em: new Date().toISOString(), assinatura_sha256: await sha256Hex(b64),
    dados: { horimetro_ini: +$('hi').value, horimetro_fim: +$('hf').value, assinatura_png_base64: b64 } };
  // Não aguardar: offline, a promessa só resolve quando o servidor confirmar
  enviados[id] = { data: reg.data, confirmado: false }; guardar();
  setDoc(doc(ctx.db, 'registros_campo', id), reg).catch(e => {
    falhas.push({ id, data: reg.data, erro: e.code || String(e) }); guardar(); render();
  });
  pad.limpar();
}

(async () => {
  pad = assinaturaPad($('sig'));
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('../sw.js').catch(() => {});
  navigator.storage?.persist?.();
  $('data').value = new Date().toISOString().slice(0, 10);
  ctx = await instancia('campo', null, null, { offline: true });
  onAuthStateChanged(ctx.auth, async u => {
    if (!u) { $('login').hidden = false; $('form').hidden = true; render(); return; }
    $('login').hidden = true; $('form').hidden = false; $('quem').textContent = u.email;
    try { await carregarOS(); } catch (e) { $('quem').textContent += ' (OS: ' + (e.code || e) + ')'; }
    observar();
  });
  $('entrar').onclick = async () => {
    const { signInWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js');
    try { await signInWithEmailAndPassword(ctx.auth, $('email').value.trim(), $('senha').value); }
    catch (e) { alert('Não foi possível entrar (é preciso internet no primeiro acesso): ' + (e.code || e)); }
  };
  $('form').onsubmit = salvar; $('limpar').onclick = () => pad.limpar();
  $('sincronizar').onclick = () => alert('No Firebase a sincronização é automática ao voltar a rede.');
  $('sair').onclick = () => signOut(ctx.auth);
})();
