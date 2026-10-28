// App de campo (Supabase): fila offline própria em IndexedDB + envio idempotente + renovação de sessão.
import * as sb from './api.js';
import { uuid, sha256Hex, assinaturaPad } from '../comum.js';

const $ = id => document.getElementById(id);
let db, sessao = null, syncing = false, pad;

function idb() { return new Promise((res, rej) => { const r = indexedDB.open('prova-campo-sb', 1);
  r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('outbox', { keyPath: 'id' }); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
const rq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const st = (n, m) => db.transaction(n, m).objectStore(n);
const kvGet = k => rq(st('kv', 'readonly').get(k)), kvSet = (k, v) => rq(st('kv', 'readwrite').put(v, k));
const fila = () => rq(st('outbox', 'readonly').getAll()), salvarItem = i => rq(st('outbox', 'readwrite').put(i));

async function token() {
  if (sessao && sessao.expires_at - 60 < Date.now() / 1000) {  // expira em < 1 min: renova (precisa de rede)
    sessao = await sb.renovar(sessao); await kvSet('sessao', sessao);
  }
  return sessao.access_token;
}

async function render() {
  const it = await fila(); const p = it.filter(i => i.sync === 'pendente').length, f = it.filter(i => i.sync === 'falhou').length, c = it.filter(i => i.sync === 'confirmado').length;
  const el = $('status'); Object.assign(el.dataset, { pendentes: p, falhas: f, confirmados: c });
  if (syncing) { el.className = 'sync'; el.textContent = `Sincronizando… (${p} pendentes no aparelho)`; }
  else if (f) { el.className = 'err'; el.textContent = `${f} falhou · ${p} pendentes · ${c} confirmados`; }
  else if (p) { el.className = 'pend'; el.textContent = `${p} pendentes no aparelho · ${c} confirmados`; }
  else { el.className = 'ok'; el.textContent = `Tudo confirmado (${c})${(await kvGet('ultima')) ? ' às ' + await kvGet('ultima') : ''}`; }
  $('fila').innerHTML = it.sort((a, b) => a.criado - b.criado).map(i => `<li>${i.registro.data} · OS ${i.osNumero} · <b>${i.sync}</b>${i.erro ? ' — ' + i.erro : ''}</li>`).join('');
}

async function carregarOS() {
  let lista = null;
  try { const r = await sb.rpc('minhas_os', {}, await token()); if (r.ok) { lista = r.body; await kvSet('os_cache', lista); } } catch {}
  lista = lista || (await kvGet('os_cache')) || [];
  $('os').innerHTML = lista.map(o => `<option value="${o.id}" data-numero="${o.numero}">OS ${o.numero}</option>`).join('');
  const at = () => { const o = lista.find(x => x.id === $('os').value) || { ativos: [] }; $('ativo').innerHTML = o.ativos.map(a => `<option value="${a.id}">${a.patrimonio}</option>`).join(''); };
  $('os').onchange = at; at();
}

async function salvar(ev) {
  ev.preventDefault(); const b64 = pad.base64(); const o = $('os').selectedOptions[0];
  const registro = { id: uuid(), os_id: $('os').value, ativo_id: $('ativo').value, data: $('data').value, capturado_em: new Date().toISOString(),
    assinatura_sha256: await sha256Hex(b64), dados: { horimetro_ini: +$('hi').value, horimetro_fim: +$('hf').value, assinatura_png_base64: b64 } };
  await salvarItem({ id: registro.id, client_request_id: uuid(), registro, osNumero: o?.dataset.numero, sync: 'pendente', criado: Date.now() });
  pad.limpar(); await render(); sincronizar();
}

async function sincronizar() {
  if (syncing || !sessao || !navigator.onLine) return;
  syncing = true; await render();
  try {
    for (const i of (await fila()).filter(x => x.sync === 'pendente')) {
      let r;
      try { r = await sb.rpc('campo_salvar_registro', { p: i.registro, p_client_request_id: i.client_request_id }, await token()); }
      catch { break; }                                   // sem rede: tenta depois
      if (r.ok) { i.sync = 'confirmado'; i.erro = null; await kvSet('ultima', new Date().toLocaleTimeString('pt-BR')); }
      else if (r.status === 401) { break; }              // sessão: renova na próxima
      else if (r.status >= 400 && r.status < 500) { i.sync = 'falhou'; i.erro = (r.body && (r.body.message || r.body.hint)) || ('HTTP ' + r.status); }
      await salvarItem(i);                               // 5xx: continua pendente (mesmo client_request_id)
    }
  } finally { syncing = false; await render(); }
}

(async () => {
  db = await idb(); pad = assinaturaPad($('sig'));
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('../sw.js').catch(() => {});
  navigator.storage?.persist?.();
  $('data').value = new Date().toISOString().slice(0, 10);
  sessao = await kvGet('sessao');
  $('entrar').onclick = async () => {
    try { sessao = await sb.login($('email').value.trim(), $('senha').value); await kvSet('sessao', sessao); iniciar(); }
    catch (e) { alert('Não foi possível entrar (é preciso internet no primeiro acesso).'); }
  };
  $('form').onsubmit = salvar; $('sincronizar').onclick = sincronizar; $('limpar').onclick = () => pad.limpar();
  window.addEventListener('online', sincronizar); setInterval(sincronizar, 5000);
  if (sessao) iniciar(); else render();
})();
async function iniciar() { $('login').hidden = true; $('form').hidden = false; $('quem').textContent = sessao.email; await carregarOS(); await render(); sincronizar(); }
