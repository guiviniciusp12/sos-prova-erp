// Executor dos testes 1 e 2 contra o projeto Supabase de TESTE (rodar num computador, no navegador).
import * as sb from './api.js';
import { USUARIOS as U, IDS, uuid, sha256Hex, senhaTeste, cenariosReserva, baseRodada, H, tabela, relatorio, PERM, NEG, INC, obs, veredito, resumo } from '../comum.js';

const $ = id => document.getElementById(id);
const PLATAFORMA = 'Supabase';
const log = m => { $('log').textContent += m + '\n'; };
const sessoes = {};
async function sessao(perfil) {
  if (perfil === 'anon') return null;
  const s = sessoes[perfil];   // token perto de expirar é renovado: um 401 por token vencido não pode virar "bloqueio"
  if (!s || s.expires_at * 1000 - Date.now() < 120e3) sessoes[perfil] = await sb.login(U[perfil], senhaTeste());
  return sessoes[perfil].access_token;
}

// ---------- Verificação do ambiente (obrigatória antes dos testes) ----------
// Os 8 usuários fictícios são criados MANUALMENTE no painel (cadastro público fica DESLIGADO o tempo todo).
let ambiente = null;
$('verificar').onclick = async () => {
  const s = senhaTeste(); if (!s) return;
  const itens = [];
  for (const [p, email] of Object.entries(U)) {
    try { delete sessoes[p]; await sessao(p); itens.push({ verificacao: `login ${email}`, resultado: 'OK' }); }
    catch (e) { itens.push({ verificacao: `login ${email}`, resultado: 'FALHOU', obtido: 'usuário não existe ou senha diferente' }); }
  }
  const intruso = `intruso-${uuid().slice(0, 8)}@example.com`;
  const r = await sb.signup(intruso, uuid()).catch(e => ({ ok: false, status: 0, body: { message: String(e) } }));
  // Exige a recusa ESPECÍFICA de cadastro desligado. Rede, 500 ou outro erro não provam que o cadastro está fechado → INCONCLUSIVO.
  const recusaCadastro = !r.ok && /signup_disabled|email_provider_disabled|signups? (are )?(not allowed|disabled)/i.test(JSON.stringify(r.body));
  itens.push({ verificacao: 'cadastro público desligado (tentativa de autocadastro)', obtido: r.ok ? 'AUTOCADASTRO ACEITO' : `recusado (HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 80)})`,
    resultado: r.ok ? 'FALHOU' : recusaCadastro ? 'OK' : 'INCONCLUSIVO' });
  let a; try { a = await sb.ler('usuarios', 'select=email', null); } catch (e) { a = { ok: false, status: 0 }; }
  // Exige recusa EXPLÍCITA (401/403). 200 com lista vazia não prova nada → INCONCLUSIVO (bloqueia os testes).
  itens.push({ verificacao: 'visitante anônimo é RECUSADO na tabela de usuários', obtido: a.ok ? `HTTP 200 com ${(a.body || []).length} linhas` : `HTTP ${a.status} ${a.body?.code || ''}`,
    resultado: [401, 403].includes(a.status) && a.body?.code === '42501' ? 'OK' : a.ok && (a.body || []).length > 0 ? 'FALHOU' : 'INCONCLUSIVO' });
  const ok = itens.every(i => i.resultado === 'OK');
  ambiente = { ok, verificado_em: new Date().toISOString(), itens };
  tabela($('r0'), itens, ['verificacao', 'obtido', 'resultado']);
  $('estado0').textContent = ok ? 'AMBIENTE VERIFICADO — pode rodar os testes.' : 'AMBIENTE COM PROBLEMA — corrija antes de rodar os testes (ver guia).';
  $('estado0').className = ok ? 'ok' : 'err';
  if (r.ok) log('ATENÇÃO: o autocadastro está aberto. Desligue "Allow new users to sign up" e apague o usuário ' + intruso + ' em Authentication > Users.');
  relatorio('Supabase', 'verificacao_ambiente', ambiente);
};
const pronto = () => { if (ambiente?.ok) return true; alert('Rode primeiro "Verificar ambiente" e corrija o que estiver vermelho.'); return false; };

// ---------- Teste 1: reservas concorrentes ----------
// Erro técnico que interrompa o teste (ex.: login falhou) vira registro INCONCLUSIVO e o botão volta a funcionar
$('t1').onclick = async () => {
  if (!pronto()) return;
  $('t1').disabled = true;
  try { await teste1(); }
  catch (e) { log('Teste 1 interrompido por erro técnico (' + (e.code || e.message || e) + '): resultado INCONCLUSIVO, rode de novo.'); relatorio(PLATAFORMA, 'teste1_interrompido', { ambiente, resultado: 'INCONCLUSIVO', erro: String(e.code || e.message || e) }); }
  finally { $('t1').disabled = false; }
};
async function teste1() {
  const tok = await sessao('operacoes'); const t0 = baseRodada(); const linhasRes = [];
  for (const c of cenariosReserva(t0)) {
    const rodada = `sb-${c.id}-${uuid().slice(0, 8)}`; const ini = performance.now();
    const res = await Promise.all(c.pedidos.map(([a, tipo, i, f]) =>
      sb.rpc('criar_reserva', { p_ativo: a, p_tipo: tipo, p_inicio: new Date(i).toISOString(), p_fim: new Date(f).toISOString(), p_rodada: rodada }, tok)
        .catch(e => ({ ok: false, status: 0, body: { message: String(e) } }))));
    const ms = Math.round(performance.now() - ini);
    const aceitas = res.filter(r => r.ok).length;
    const conflito = res.filter(r => !r.ok && JSON.stringify(r.body).includes('CONFLITO_RESERVA')).length;
    const erros = res.filter(r => !r.ok && !JSON.stringify(r.body).includes('CONFLITO_RESERVA'));
    const banco = (await sb.rpc('contagem_rodada', { p_rodada: rodada }, tok).catch(() => ({}))).body || {};
    const contou = typeof banco.aceitas === 'number' && typeof banco.sobreposicoes === 'number';
    const resultado = !contou ? 'INCONCLUSIVO (contagem no banco indisponível)'
      : banco.sobreposicoes > 0 ? 'FALHOU (sobreposição gravada)'
      : erros.length > 0 ? `INCONCLUSIVO (${erros.length} erros técnicos, não de conflito)`
      : c.esperado(banco.aceitas) && banco.aceitas === aceitas ? 'PASSOU' : 'FALHOU (contagem diferente do esperado)';
    linhasRes.push({ cenario: `${c.id} ${c.nome}`, pedidos: c.pedidos.length, aceitas, conflito, erros: erros.length,
      'no banco': banco.aceitas, 'sobreposições': banco.sobreposicoes, 'tempo (ms)': ms, esperado: c.esperadoTxt, mecanismo: 'trava do banco (exclusion constraint)',
      resultado, amostra_erro: erros[0] ? `${erros[0].status} ${JSON.stringify(erros[0].body).slice(0, 110)}` : '' });
    tabela($('r1'), linhasRes, ['cenario', 'pedidos', 'aceitas', 'conflito', 'erros', 'no banco', 'sobreposições', 'tempo (ms)', 'esperado', 'resultado']);
  }
  linhasRes.push(...await negativosSb(await sessao('operacoes'), t0 + 9e9));
  tabela($('r1'), linhasRes, ['cenario', 'pedidos', 'aceitas', 'conflito', 'erros', 'no banco', 'sobreposições', 'tempo (ms)', 'esperado', 'resultado']);
  relatorio('Supabase', 'teste1_reservas', { ambiente, cenarios: linhasRes });
}

// ---------- Testes NEGATIVOS da integridade das reservas (mesmas intenções do Firebase, usuário AUTORIZADO) ----------
async function negativosSb(tok, t) {
  const out = []; const iso = x => new Date(x).toISOString(); const rod = 'neg-' + uuid().slice(0, 8);
  const base = await sb.rpc('criar_reserva', { p_ativo: IDS.GG2, p_tipo: 'definitiva', p_inicio: iso(t), p_fim: iso(t + H), p_rodada: rod }, tok).catch(e => ({ ok: false, status: 0, body: { message: String(e) } }));
  if (!base.ok) { out.push({ cenario: 'N0 reserva válida de referência', resultado: 'INCONCLUSIVO (sem a reserva de referência os negativos não podem ser medidos)', amostra_erro: JSON.stringify(base.body).slice(0, 120) }); return out; }
  const id = base.body;
  // Só conta como bloqueio a recusa pelo motivo certo: permissão (401/403 com código 42501) ou conflito de reserva. Outro erro = INCONCLUSIVO.
  async function tentar(nome, fn, motivo = 'permissao') {
    const r = await fn().catch(e => ({ ok: false, status: 0, body: { message: 'rede: ' + String(e) } })); const passou = r.ok && (Array.isArray(r.body) ? r.body.length > 0 : true);
    const certo = motivo === 'conflito' ? JSON.stringify(r.body).includes('CONFLITO_RESERVA') : EXPLICITO(r);
    out.push({ cenario: nome, pedidos: 1, aceitas: passou ? 1 : 0, conflito: '', erros: passou ? 0 : 1, 'no banco': '', 'sobreposições': '', 'tempo (ms)': '',
      esperado: 'bloqueado', resultado: passou ? 'FALHOU (brecha: gravação aceita)' : certo ? 'PASSOU (bloqueado)' : 'INCONCLUSIVO (erro não é de permissão/conflito)',
      amostra_erro: `${r.status} ${JSON.stringify(r.body).slice(0, 100)}` });
  }
  await tentar('N1 alterar o período de uma reserva existente', () => sb.alterar('reservas', `id=eq.${id}`, { janela: `[${iso(t)},${iso(t + 5 * H)})` }, tok));
  await tentar('N3 vincular uma reserva existente a OUTRO patrimônio', () => sb.alterar('reservas', `id=eq.${id}`, { ativo_id: IDS.GG3 }, tok));
  await tentar('N5 gravar reserva direto na tabela, sem a função de reserva', () => sb.inserir('reservas', [{ ativo_id: IDS.GG2, tipo: 'definitiva', janela: `[${iso(t + 13 * H)},${iso(t + 14 * H)})`, rodada: rod }], tok));
  await tentar('N9 apagar uma reserva existente', () => sb.apagar('reservas', `id=eq.${id}`, tok));
  await tentar('C9 (equivalente) reservar período sobreposto à reserva existente', () => sb.rpc('criar_reserva', { p_ativo: IDS.GG2, p_tipo: 'definitiva', p_inicio: iso(t + H / 2), p_fim: iso(t + 2 * H), p_rodada: rod }, tok), 'conflito');
  // Conferência final do ESTADO PERSISTIDO pela testemunha: só a reserva de referência existe e está intacta
  const fim = await testemunha('reservas', `select=id,ativo_id,janela&rodada=eq.${rod}`, rows => rows);
  const ts = x => new Date(x.trim().replace(/^"|"$/g, '').replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')).getTime();
  const lim = j => { const m = String(j).match(/^[\[(](.*),(.*)[\])]$/); return m ? [ts(m[1]), ts(m[2])] : [NaN, NaN]; };
  const intacta = Array.isArray(fim) && fim.length === 1 && fim[0].id === id && fim[0].ativo_id === IDS.GG2 &&
    lim(fim[0].janela)[0] === t && lim(fim[0].janela)[1] === t + H;
  out.push({ cenario: 'N-final estado no banco conferido pela testemunha', pedidos: '', aceitas: '', conflito: '', erros: '', 'no banco': Array.isArray(fim) ? fim.length : '?', 'sobreposições': '', 'tempo (ms)': '',
    esperado: '1 reserva (a de referência), intacta', resultado: fim == null ? 'INCONCLUSIVO (testemunha indisponível)' : intacta ? 'PASSOU' : 'FALHOU (estado alterado)', amostra_erro: JSON.stringify(fim).slice(0, 120) });
  return out;
}

// ---------- Teste 2: permissões por perfil (classificação rigorosa) ----------
// Leitura: só é PERMITIDO se a fixture fictícia conhecida aparecer. Só é NEGADO com recusa explícita (401/403)
// ou, se o servidor devolver vazio (filtro RLS), quando a TESTEMUNHA (direção) comprovar que a fixture existe.
// Escrita: o efeito é sempre conferido pela testemunha no banco. Vazio sem prova = INCONCLUSIVO.
const PERFIS = ['direcao', 'operacoes', 'comercial', 'financeiro', 'rh', 'rh2', 'operador1', 'operador2', 'anon'];
const PIX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const FX = { CAR: '41000000-0000-0000-0000-000000000001', HE1: '42000000-0000-0000-0000-000000000001', HE2: '42000000-0000-0000-0000-000000000002',
  EVA: '20000000-0000-0000-0000-000000000001', TV_TITULO: 'Evento Fictício A' };
const EXPLICITO = r => [401, 403].includes(r?.status) && r?.body?.code === '42501';   // 401 de token vencido (PGRST301) ou chave errada NÃO conta
const seguro = async f => { try { return await f(); } catch (e) { return { ok: false, status: 0, rede: true, body: { message: String(e) } }; } };
async function registro(os, ativo) {
  return { p: { id: uuid(), os_id: os, ativo_id: ativo, data: '2031-01-01', capturado_em: new Date().toISOString(),
    assinatura_sha256: await sha256Hex(PIX), dados: { horimetro_ini: 1, horimetro_fim: 2, assinatura_png_base64: PIX } }, p_client_request_id: uuid() };
}
// Testemunha: a direção de teste lê o banco para provar existência/efeito. null = não foi possível provar.
async function testemunha(tabela, filtro, cond = rows => rows.length > 0) {
  let t; try { t = await sessao('direcao'); } catch { return null; }
  const r = await seguro(() => sb.ler(tabela, filtro, t));
  return r.ok && Array.isArray(r.body) ? cond(r.body) : null;
}
async function leitura(fazer, ids, campo, provaExistencia, extra = () => true) {
  const r = await seguro(fazer);
  if (r.rede) return obs(INC, 'erro de rede', r.body.message);
  if (EXPLICITO(r)) { const ex = await provaExistencia();
    return ex === true ? obs(NEG, `recusa explícita HTTP ${r.status} (42501); fixture comprovada pela testemunha`, r.body?.message || r.body?.code)
      : obs(INC, 'recusa sem fixture comprovada (pode ser dado ausente, não permissão)', `testemunha: ${ex}`); }
  if (!r.ok || !Array.isArray(r.body)) return obs(INC, `resposta inesperada HTTP ${r.status}`, JSON.stringify(r.body));
  const vistos = ids.filter(id => r.body.some(x => x[campo] === id && extra(x)));
  if (vistos.length === ids.length) return obs(PERM, 'fixture fictícia lida', vistos.join(','));
  const existe = await provaExistencia();
  if (existe === true) return obs(NEG, vistos.length ? 'filtro do servidor (visão parcial); fixtures comprovadas pela testemunha' : 'filtro do servidor; fixtures comprovadas pela testemunha', `visíveis: ${vistos.length}/${ids.length}`);
  return obs(INC, 'resultado sem a fixture e existência não comprovada', `testemunha: ${existe}`);
}
async function escrita(fazer, efeito, erroDeRegra = null, alvoComprovado = false) {
  const r = await seguro(fazer);
  if (r.rede) return obs(INC, 'erro de rede', r.body.message);
  const p = await efeito();                                   // true = efeito persistido; false = estado sem alteração
  if (p === null) return obs(INC, 'testemunha não conseguiu conferir o estado', `HTTP ${r.status}`);
  if (p === true) return obs(PERM, r.ok ? 'gravação confirmada pela testemunha' : 'EFEITO PERSISTIU apesar do erro', `HTTP ${r.status}`);
  const linhas = Array.isArray(r.body) ? r.body.length : (r.body == null ? 0 : 1);
  if (r.ok && linhas === 0 && alvoComprovado) return obs(NEG, 'filtro do servidor (0 linhas afetadas); estado conferido sem alteração', `HTTP ${r.status}`);
  if (!r.ok && EXPLICITO(r)) return obs(NEG, `recusa explícita HTTP ${r.status} (42501); estado conferido sem alteração`, r.body?.message);
  if (!r.ok && erroDeRegra && JSON.stringify(r.body).includes(erroDeRegra)) return obs(NEG, `regra do servidor (${erroDeRegra}); estado conferido sem alteração`, `HTTP ${r.status}`);
  return obs(INC, r.ok ? 'servidor disse que gravou, mas a testemunha não encontrou' : `erro não relacionado a permissão (HTTP ${r.status})`, JSON.stringify(r.body));
}
let HE_RODADA = null;
// Cria um fato auditável (o financeiro de teste lança uma conta fictícia) e devolve o id da linha de auditoria gerada pelo servidor
async function novaLinhaAuditoria() {
  try {
    const m = 'AUD-' + uuid(); await sb.inserir('contas_receber', [{ cliente: m, valor: 1 }], await sessao('financeiro'));
    const r = await sb.ler('auditoria', `select=id&tabela=eq.contas_receber&registro->>cliente=eq.${m}`, await sessao('direcao'));
    return r.ok && r.body?.length === 1 ? r.body[0].id : null;
  } catch { return null; }
}   // HE nova da rodada, lançada pelo RH, para o teste de aprovação
const ACOES = {
  'A01 ler conta a receber fictícia': (t) => leitura(() => sb.ler('contas_receber', `select=id&id=eq.${FX.CAR}`, t), [FX.CAR], 'id', () => testemunha('contas_receber', `select=id&id=eq.${FX.CAR}`)),
  'A02 criar conta a receber': (t) => { const m = 'X-' + uuid(); return escrita(() => sb.inserir('contas_receber', [{ cliente: m, valor: 1 }], t), () => testemunha('contas_receber', `select=id&cliente=eq.${m}`)); },
  'A03 ler HE de OUTRO funcionário': (t, p) => { const id = p === 'operador2' ? FX.HE1 : FX.HE2; return leitura(() => sb.ler('he_funcionario', `select=id&id=eq.${id}`, t), [id], 'id', () => testemunha('he_funcionario', `select=id&id=eq.${id}`)); },
  'A04 lançar HE': (t, p) => { const id = uuid();
    return escrita(() => sb.inserir('he_funcionario', [{ id, funcionario_email: U.operador2, horas: 2, valor: 36, lancado_por: U[p] || 'anon' }], t), () => testemunha('he_funcionario', `select=id&id=eq.${id}`)); },
  'A05 aprovar HE lançada por outra pessoa do RH (segregação)': (t, p) => HE_RODADA ? escrita(() => sb.alterar('he_funcionario', `id=eq.${HE_RODADA}`, { status: 'aprovada', aprovado_por: U[p] || 'anon' }, t),
    () => testemunha('he_funcionario', `select=aprovado_por&id=eq.${HE_RODADA}`, rows => rows.length === 1 ? rows[0].aprovado_por === (U[p] || 'anon') : null), null, true) : obs(INC, 'HE da rodada não pôde ser criada/comprovada'),
  'A06 criar reserva (RPC)': (t) => { const i = baseRodada() + 7e9, m = 'perm-' + uuid(); return escrita(() => sb.rpc('criar_reserva', { p_ativo: IDS.GG3, p_tipo: 'definitiva', p_inicio: new Date(i).toISOString(), p_fim: new Date(i + H).toISOString(), p_rodada: m }, t), () => testemunha('reservas', `select=id&rodada=eq.${m}`), 'SEM_PERMISSAO'); },
  'A07 ver TODAS as OS (OS 1 e OS 2)': (t) => leitura(() => sb.ler('os', 'select=id', t), [IDS.OS1, IDS.OS2], 'id', () => testemunha('os', 'select=id', rows => [IDS.OS1, IDS.OS2].every(i => rows.some(x => x.id === i)))),
  'A08 ver a OS 1': (t) => leitura(() => sb.ler('os', `select=id&id=eq.${IDS.OS1}`, t), [IDS.OS1], 'id', () => testemunha('os', `select=id&id=eq.${IDS.OS1}`)),
  'A09 salvar registro de campo na OS 1 com gerador da OS': async (t) => { const reg = await registro(IDS.OS1, IDS.GG1); return escrita(() => sb.rpc('campo_salvar_registro', reg, t), () => testemunha('registros_campo', `select=id&id=eq.${reg.p.id}`), 'OS_NAO_ATRIBUIDA'); },
  'A10 salvar registro na OS 1 com gerador FORA da OS': async (t) => { const reg = await registro(IDS.OS1, IDS.GG2); return escrita(() => sb.rpc('campo_salvar_registro', reg, t), () => testemunha('registros_campo', `select=id&id=eq.${reg.p.id}`), 'ATIVO_FORA_DA_OS'); },
  'A11 alterar perfis/permissões (dar car.ler ao comercial)': async (t) => {
    const ja = await testemunha('perfil_permissao', 'select=perfil&perfil=eq.comercial&permissao=eq.car.ler');
    if (ja !== false) return obs(INC, 'pré-condição: a permissão já existia ou não pôde ser conferida');
    const o = await escrita(() => sb.inserir('perfil_permissao', [{ perfil: 'comercial', permissao: 'car.ler' }], t), () => testemunha('perfil_permissao', 'select=perfil&perfil=eq.comercial&permissao=eq.car.ler'));
    if (o.estado !== NEG) await seguro(async () => sb.apagar('perfil_permissao', 'perfil=eq.comercial&permissao=eq.car.ler', await sessao('direcao')));   // limpa (também se INCONCLUSIVO)
    return o; },
  // A12/A13: alvo = uma linha de auditoria NOVA, criada antes de cada tentativa (pré-condição comprovada pela testemunha).
  'A12 apagar trilha de auditoria': async (t) => { const alvo = await novaLinhaAuditoria(); if (!alvo) return obs(INC, 'pré-condição: não foi possível criar/comprovar a linha de auditoria alvo');
    return escrita(() => sb.apagar('auditoria', `id=eq.${alvo}`, t), async () => { const ainda = await testemunha('auditoria', `select=id&id=eq.${alvo}`); return ainda == null ? null : !ainda; }, null, true); },
  'A13 alterar trilha de auditoria': async (t) => { const alvo = await novaLinhaAuditoria(); if (!alvo) return obs(INC, 'pré-condição: não foi possível criar/comprovar a linha de auditoria alvo');
    const m = 'X-' + uuid(); return escrita(() => sb.alterar('auditoria', `id=eq.${alvo}`, { operacao: m }, t),
      () => testemunha('auditoria', `select=id,operacao&id=eq.${alvo}`, rows => rows.length === 1 ? rows[0].operacao === m : null), null, true); },
  'A14 ler telefone de evento direto na tabela': (t) => leitura(() => sb.ler('eventos', `select=id,telefone_contato&id=eq.${FX.EVA}`, t), [FX.EVA], 'id', () => testemunha('eventos', `select=id,telefone_contato&id=eq.${FX.EVA}`, rows => rows.some(x => !!x.telefone_contato)), x => !!x.telefone_contato),
  'A15 ler cadastro de OUTROS usuários': (t, p) => { const alvo = [U.rh2, U.operador1, U.direcao].filter(e => e !== U[p]).slice(0, 2);
    return leitura(() => sb.ler('usuarios', 'select=email', t), alvo, 'email', () => testemunha('usuarios', 'select=email', rows => alvo.every(a => rows.some(x => x.email === a)))); },
  'A16 ler projeção da TV (tv_feed)': (t) => leitura(() => sb.rpc('tv_feed', {}, t), [FX.TV_TITULO], 'titulo', async () => {
    let td; try { td = await sessao('direcao'); } catch { return null; }
    const r = await seguro(() => sb.rpc('tv_feed', {}, td)); return Array.isArray(r.body) ? r.body.some(x => x.titulo === FX.TV_TITULO) : null; }),
  'A17 ler patrimônio PAT-0002 (de outra OS)': (t) => leitura(() => sb.ler('ativos', `select=id&id=eq.${IDS.GG2}`, t), [IDS.GG2], 'id', () => testemunha('ativos', `select=id&id=eq.${IDS.GG2}`)),
};
const ESP = {
  'A01 ler conta a receber fictícia': ['direcao', 'financeiro'], 'A02 criar conta a receber': ['financeiro'],
  'A03 ler HE de OUTRO funcionário': ['direcao', 'rh', 'rh2'], 'A04 lançar HE': ['rh', 'rh2'],
  'A05 aprovar HE lançada por outra pessoa do RH (segregação)': ['rh2'], 'A06 criar reserva (RPC)': ['operacoes'],
  'A07 ver TODAS as OS (OS 1 e OS 2)': ['direcao', 'operacoes'], 'A08 ver a OS 1': ['direcao', 'operacoes', 'operador1'],
  'A09 salvar registro de campo na OS 1 com gerador da OS': ['operador1'], 'A10 salvar registro na OS 1 com gerador FORA da OS': [],
  'A11 alterar perfis/permissões (dar car.ler ao comercial)': ['direcao'], 'A12 apagar trilha de auditoria': [], 'A13 alterar trilha de auditoria': [],
  'A14 ler telefone de evento direto na tabela': ['direcao', 'operacoes', 'comercial'], 'A15 ler cadastro de OUTROS usuários': ['direcao'],
  'A16 ler projeção da TV (tv_feed)': PERFIS, 'A17 ler patrimônio PAT-0002 (de outra OS)': ['direcao', 'operacoes', 'comercial', 'operador2'],
};
// Erro técnico que interrompa o teste (ex.: login falhou) vira registro INCONCLUSIVO e o botão volta a funcionar
$('t2').onclick = async () => {
  if (!pronto()) return;
  $('t2').disabled = true;
  try { await teste2(); }
  catch (e) { log('Teste 2 interrompido por erro técnico (' + (e.code || e.message || e) + '): resultado INCONCLUSIVO, rode de novo.'); relatorio(PLATAFORMA, 'teste2_interrompido', { ambiente, resultado: 'INCONCLUSIVO', erro: String(e.code || e.message || e) }); }
  finally { $('t2').disabled = false; }
};
async function teste2() {
  const matriz = [];
  // Fixture da rodada: HE lançada pelo RH (para testar a segregação na aprovação)
  HE_RODADA = null;
  try { const r = await sb.inserir('he_funcionario', [{ funcionario_email: U.operador1, horas: 1, valor: 18, lancado_por: U.rh }], await sessao('rh')); const id = r.ok && r.body?.[0]?.id; if (id && (await testemunha('he_funcionario', `select=id&id=eq.${id}`)) === true) HE_RODADA = id; } catch {}
  for (const [acao, fn] of Object.entries(ACOES)) for (const p of PERFIS) {
    let o, t;
    try { t = await sessao(p); } catch (e) { o = obs(INC, 'falha de login do perfil de teste', e.message); }
    if (!o) { try { o = await fn(t, p); } catch (e) { o = obs(INC, 'erro inesperado no teste', String(e)); } }
    const esp = ESP[acao].includes(p);
    matriz.push({ acao, perfil: p, esperado: esp ? PERM : NEG, obtido: o.estado, mecanismo: o.mecanismo, evidencia: o.evidencia, resultado: veredito(esp, o) });
  }
  // Verificações extras
  const extra = [];
  const tvR = await seguro(() => sb.rpc('tv_feed', {}, null)); const tv = Array.isArray(tvR.body) ? tvR.body : null;
  const temFix = tv && tv.some(x => x.titulo === FX.TV_TITULO);
  const chaves = tv ? [...new Set(tv.flatMap(Object.keys))].sort().join(',') : '';
  extra.push({ verificacao: 'E1 TV expõe só local,status_evento,titulo', obtido: tv ? chaves : `HTTP ${tvR.status}`, resultado: !temFix ? 'INCONCLUSIVO' : chaves === 'local,status_evento,titulo' ? 'OK' : 'DIVERGENTE' });
  extra.push({ verificacao: 'E2 TV omite cancelados', obtido: tv ? tv.filter(x => x.status_evento === 'cancelado').length : '-', resultado: !temFix ? 'INCONCLUSIVO' : tv.every(x => x.status_evento !== 'cancelado') ? 'OK' : 'DIVERGENTE' });
  extra.push({ verificacao: 'E7 TV sem telefone/observação', obtido: tv ? (JSON.stringify(tv).match(/0000-0000|nota interna/) ? 'vazou' : 'limpo') : '-', resultado: !temFix ? 'INCONCLUSIVO' : JSON.stringify(tv).match(/0000-0000|nota interna/) ? 'DIVERGENTE' : 'OK' });
  let tD, tC; try { tD = await sessao('direcao'); tC = await sessao('comercial'); } catch {}
  if (tD && tC) {
    // Concessão e retirada confirmadas pela testemunha: se não forem comprovadas, o resultado é INCONCLUSIVO (não DIVERGENTE)
    const perm = () => testemunha('perfil_permissao', 'select=perfil&perfil=eq.comercial&permissao=eq.car.ler');
    let com = null, sem = null;
    const audN = () => testemunha('auditoria', `select=id&tabela=eq.perfil_permissao&usuario=eq.${U.direcao}&registro->>perfil=eq.comercial&registro->>permissao=eq.car.ler`, rows => rows.length);
    const aud0 = await audN();
    const ini = await perm();   // pré-condição: a permissão NÃO existe antes da concessão (senão a concessão não é testada)
    const ins = ini === false ? await seguro(() => sb.inserir('perfil_permissao', [{ perfil: 'comercial', permissao: 'car.ler' }], tD)) : null;
    const conc = ins?.ok ? await perm() : null; if (conc === true) com = await ACOES['A01 ler conta a receber fictícia'](tC);
    await seguro(() => sb.apagar('perfil_permissao', 'perfil=eq.comercial&permissao=eq.car.ler', tD));
    const ret = await perm(); if (ret === false) sem = await ACOES['A01 ler conta a receber fictícia'](tC);
    extra.push({ verificacao: 'E3 direção concede e retira car.ler do comercial: efeito imediato', obtido: `concedida: ${conc} · com: ${com?.estado || '-'} · retirada: ${ret === false} · sem: ${sem?.estado || '-'}`,
      resultado: conc !== true || ret !== false || !com || !sem || com.estado === INC || sem.estado === INC ? 'INCONCLUSIVO' : com.estado === PERM && sem.estado === NEG ? 'OK' : 'DIVERGENTE' });
    const aud1 = await audN(); const novas = typeof aud0 === 'number' && typeof aud1 === 'number' ? aud1 - aud0 : null;
    extra.push({ verificacao: 'E4 mudança de permissão auditada com autor (servidor): concessão + retirada desta rodada', obtido: `linhas novas de auditoria: ${novas ?? '?'}`,
      resultado: novas == null || conc !== true || ret !== false ? 'INCONCLUSIVO' : novas >= 2 ? 'OK' : 'DIVERGENTE' });
  } else extra.push({ verificacao: 'E3/E4 permissão em tempo real e auditoria', obtido: 'login falhou', resultado: 'INCONCLUSIVO' });
  try {
    const reg = await registro(IDS.OS1, IDS.GG1); const tO = await sessao('operador1');
    let aceitos = 0, negados = 0, tecnicos = 0;
    for (let i = 0; i < 5; i++) { const r = await seguro(() => sb.rpc('campo_salvar_registro', reg, tO)); r.ok ? aceitos++ : EXPLICITO(r) ? negados++ : tecnicos++; }
    const c = (await seguro(() => sb.rpc('contagem_registros', { p_ids: [reg.p.id] }, tO))).body;
    extra.push({ verificacao: 'E6 mesmo registro enviado 5x: 5 envios aceitos e 1 linha', obtido: `aceitos ${aceitos} · recusados ${negados} · erros técnicos ${tecnicos} · linhas ${c}`,
      resultado: typeof c !== 'number' || tecnicos > 0 ? 'INCONCLUSIVO' : aceitos === 5 && c === 1 ? 'OK' : 'DIVERGENTE' });
  } catch (e) { extra.push({ verificacao: 'E6 idempotência', obtido: String(e), resultado: 'INCONCLUSIVO' }); }
  const rm = resumo([...matriz, ...extra]);
  tabela($('r2'), [...matriz.filter(m => m.resultado !== 'OK'), ...extra.map(e => ({ acao: e.verificacao, perfil: '-', esperado: '', obtido: e.obtido, mecanismo: '', resultado: e.resultado }))], ['acao', 'perfil', 'esperado', 'obtido', 'mecanismo', 'resultado']);
  $('resumo2').textContent = `${matriz.length} casos + ${extra.length} verificações · OK ${rm.ok} · DIVERGENTE ${rm.divergentes} · INCONCLUSIVO ${rm.inconclusivos} · ${rm.aprovado ? 'APROVADO' : 'NÃO APROVADO'}`;
  relatorio('Supabase', 'teste2_permissoes', { ambiente, criterio: 'PERMITIDO/NEGADO comprovados; vazio sem prova = INCONCLUSIVO', resumo: rm, matriz, extra });
}


// ---------- Conferência dos registros feitos nos celulares ----------
$('t3').onclick = async () => {
  const r = await sb.ler('registros_campo', 'select=id,client_request_id,data,capturado_em,recebido_em,assinatura_sha256,operador_email', await sessao('direcao'));
  const lst = (r.body || []).filter(x => x.data < '2031-01-01');   // exclui os registros sintéticos dos testes 1 e 2
  const ids = new Set(lst.map(x => x.id)), crids = new Set(lst.map(x => x.client_request_id));
  tabela($('r3'), lst.map(x => ({ id: x.id.slice(0, 8), operador: x.operador_email, data: x.data, capturado: x.capturado_em, recebido: x.recebido_em, assinatura: x.assinatura_sha256 ? 'com hash' : '—' })), ['id', 'operador', 'data', 'capturado', 'recebido', 'assinatura']);
  relatorio('Supabase', 'conferencia_campo', { registros: lst.length, ids_distintos: ids.size, envios_distintos: crids.size, lista: lst.map(x => ({ id: x.id, data: x.data, capturado_em: x.capturado_em, recebido_em: x.recebido_em })) });
};
