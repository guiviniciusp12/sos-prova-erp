// Utilidades comuns da prova (sem bibliotecas externas).
export const USUARIOS = {
  direcao: 'prova.direcao@example.com', operacoes: 'prova.operacoes@example.com', comercial: 'prova.comercial@example.com',
  financeiro: 'prova.financeiro@example.com', rh: 'prova.rh@example.com', rh2: 'prova.rh2@example.com',
  operador1: 'prova.operador1@example.com', operador2: 'prova.operador2@example.com'
};
export const IDS = {
  GG1: '10000000-0000-0000-0000-000000000001', GG2: '10000000-0000-0000-0000-000000000002', GG3: '10000000-0000-0000-0000-000000000003',
  OS1: '30000000-0000-0000-0000-000000000001', OS2: '30000000-0000-0000-0000-000000000002'
};
export const uuid = () => crypto.randomUUID();

export async function sha256Hex(b64) {
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const h = await crypto.subtle.digest('SHA-256', bin);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Senha de teste: digitada uma vez, guardada só nesta aba (sessionStorage), nunca no código.
export function senhaTeste() {
  let s = sessionStorage.getItem('senha_prova');
  if (!s) { s = prompt('Senha dos usuários de TESTE (a mesma usada na preparação):'); if (s) sessionStorage.setItem('senha_prova', s); }
  return s;
}

export function assinaturaPad(canvas) {
  const x = canvas.getContext('2d'); let d = false; x.lineWidth = 3;
  const pos = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height]; };
  canvas.onpointerdown = e => { d = true; x.beginPath(); x.moveTo(...pos(e)); canvas.setPointerCapture(e.pointerId); };
  canvas.onpointermove = e => { if (d) { x.lineTo(...pos(e)); x.stroke(); } };
  canvas.onpointerup = () => d = false;
  return { limpar: () => x.clearRect(0, 0, canvas.width, canvas.height), base64: () => canvas.toDataURL('image/png').split(',')[1] };
}

// Janela de datas exclusiva por rodada (evita colisão entre execuções diferentes do teste)
export function baseRodada() {
  const d = new Date(Date.UTC(2031, 0, 1, 11, 0, 0));          // 08:00 em Brasília
  d.setUTCDate(d.getUTCDate() + Math.floor(Math.random() * 3000));
  return d.getTime() + Math.floor(Math.random() * 1440) * 60e3 * 7;  // + minutos aleatórios
}
export const H = 3600e3, M = 60e3;

// Os mesmos cenários da Etapa 1 (C1–C7). Cada pedido: [ativo, tipo, inicio_ms, fim_ms]
export function cenariosReserva(t0) {
  const N = 50, r = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  return [
    { id: 'C1', nome: 'janelas idênticas (50x)', pedidos: r(N, () => [IDS.GG1, 'definitiva', t0, t0 + 10 * H]), esperado: n => n === 1, esperadoTxt: 'exatamente 1' },
    { id: 'C2', nome: 'sobreposição PARCIAL com trecho comum', pedidos: r(N, i => [IDS.GG1, 'definitiva', t0 + 1e9 + i * M, t0 + 1e9 + i * M + 6 * H]), esperado: n => n === 1, esperadoTxt: 'exatamente 1' },
    { id: 'C3', nome: 'sobreposição PARCIAL em cadeia', pedidos: r(N, i => [IDS.GG1, 'definitiva', t0 + 2e9 + i * 10 * M, t0 + 2e9 + i * 10 * M + 6 * H]), esperado: n => n >= 1, esperadoTxt: '≥1, sem pares sobrepostos' },
    { id: 'C4', nome: 'janelas encostadas (20 blocos de 1h)', pedidos: r(20, i => [IDS.GG1, 'definitiva', t0 + 3e9 + i * H, t0 + 3e9 + (i + 1) * H]), esperado: n => n === 20, esperadoTxt: 'todas as 20' },
    { id: 'C5', nome: 'mesmo período, 2 geradores de 300 kVA', pedidos: r(N, i => [i % 2 ? IDS.GG2 : IDS.GG1, 'definitiva', t0 + 4e9, t0 + 4e9 + 10 * H]), esperado: n => n === 2, esperadoTxt: '1 por ativo (2)' },
    { id: 'C6', nome: 'pré-reservas sobrepostas (10)', pedidos: r(10, i => [IDS.GG3, 'pre', t0 + 5e9 + i * M, t0 + 5e9 + 6 * H]), esperado: n => n === 10, esperadoTxt: 'todas as 10' },
    { id: 'C7', nome: 'definitiva x manutenção concorrentes', pedidos: r(N, i => [IDS.GG1, i % 2 ? 'definitiva' : 'manutencao', t0 + 6e9 + (i % 5) * M, t0 + 6e9 + 4 * H]), esperado: n => n === 1, esperadoTxt: 'exatamente 1' },
  ];
}
export function sobreposicoes(lista) { // lista de {ativo, tipo, ini, fim}
  let n = 0; const bloq = lista.filter(x => x.tipo !== 'pre');
  for (let i = 0; i < bloq.length; i++) for (let j = i + 1; j < bloq.length; j++)
    if (bloq[i].ativo === bloq[j].ativo && bloq[i].ini < bloq[j].fim && bloq[j].ini < bloq[i].fim) n++;
  return n;
}

export function tabela(el, linhas, cols) {
  el.innerHTML = '<table><tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr>' +
    linhas.map(l => '<tr>' + cols.map(c => `<td class="${String(l[c]).startsWith('PASSOU') || l[c] === 'OK' ? 'ok' : (String(l[c]).match(/FALHOU|DIVERGENTE/) ? 'err' : '')}">${l[c] ?? ''}</td>`).join('') + '</tr>').join('') + '</table>';
}
export function relatorio(plataforma, nome, dados) {
  const r = { plataforma, teste: nome, executado_em: new Date().toISOString(), navegador: navigator.userAgent, ...dados };
  const box = document.getElementById('json'); box.value = JSON.stringify(r, null, 1);
  document.getElementById('copiar').onclick = () => { box.select(); navigator.clipboard?.writeText(box.value); };
  return r;
}

// ---------- Classificação rigorosa (igual para as duas plataformas) ----------
// PERMITIDO: efeito comprovado (dado fictício conhecido lido / gravação confirmada por testemunha)
// NEGADO: recusa comprovada (erro explícito de permissão, ou filtro do servidor COM existência da fixture
//         comprovada por testemunha e estado conferido sem alteração)
// INCONCLUSIVO: qualquer outra situação (vazio sem prova, rede, login, erro inesperado, testemunha indisponível)
export const PERM = 'PERMITIDO', NEG = 'NEGADO', INC = 'INCONCLUSIVO';
export const obs = (estado, mecanismo, evidencia = '') => ({ estado, mecanismo, evidencia: String(evidencia).slice(0, 160) });
export function veredito(esperaPermite, o) {
  if (o.estado === INC) return 'INCONCLUSIVO';
  return (o.estado === PERM) === esperaPermite ? 'OK' : 'DIVERGENTE';
}
export function resumo(linhas) {
  const c = k => linhas.filter(l => l.resultado === k).length;
  const r = { ok: c('OK'), divergentes: c('DIVERGENTE'), inconclusivos: c('INCONCLUSIVO'), limitacoes: c('LIMITAÇÃO') };
  r.aprovado = r.divergentes === 0 && r.inconclusivos === 0;
  return r;
}
