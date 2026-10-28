// Executor dos testes 1 e 2 contra o projeto Firebase de TESTE (plano gratuito Spark, sem Cloud Functions).
import { fs, instancia, criarUsuario, apagarConta } from './fb.js';
import { USUARIOS as U, IDS, uuid, senhaTeste, cenariosReserva, baseRodada, H, sobreposicoes, tabela, relatorio, PERM, NEG, INC, obs, veredito, resumo } from '../comum.js';
const { doc, getDoc, getDocs, getDocFromServer, getDocsFromServer, setDoc, addDoc, updateDoc, deleteDoc, collection, query, where, runTransaction, writeBatch, arrayUnion, arrayRemove } = fs;

const $ = id => document.getElementById(id);
const PLATAFORMA = 'Firebase (Spark, sem Functions)';
const log = m => { $('log').textContent += m + '\n'; };
// Classificação de erros: SÓ 'permission-denied' é recusa das regras. Rede, prazo, argumento inválido etc. NÃO são bloqueio.
const cod = e => (e && e.code) || '';
const negadoRegras = e => cod(e) === 'permission-denied';
// Gravações no Firestore ficam pendentes indefinidamente sem rede: o prazo transforma isso em erro técnico (INCONCLUSIVO).
const prazo = (pr, ms = 20000) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('prazo esgotado'), { code: 'prazo-esgotado' })), ms))]);
const inst = p => p === 'anon' ? instancia('anon', null) : instancia(p, U[p], senhaTeste());

// ---------- Preparação (com as REGRAS DE PREPARAÇÃO publicadas) ----------
// Os 8 usuários fictícios são criados MANUALMENTE no console (sem autocadastro pela página).
$('preparar').onclick = async () => {
  const s = senhaTeste(); if (!s) return;
  let db; try { db = (await inst('direcao')).db; } catch (e) { return log('Login da direção de teste falhou: crie os 8 usuários no console (ver guia). ' + (e.code || e)); }
  const b = writeBatch(db);
  const perfis = { direcao: ['direcao', 'Direção Teste'], operacoes: ['operacoes', 'Planejamento Teste'], comercial: ['comercial', 'Comercial Teste'],
    financeiro: ['financeiro', 'Financeiro Teste'], rh: ['rh', 'RH Teste'], rh2: ['rh', 'RH Teste 2'], operador1: ['operador', 'Operador Um'], operador2: ['operador', 'Operador Dois'] };
  for (const [k, [perfil, nome]] of Object.entries(perfis)) b.set(doc(db, 'usuarios', U[k]), { perfil, nome, ativo: true });
  const P = { direcao: ['perfis.editar', 'usuarios.ler', 'agenda.ler', 'os.ler_todas', 'car.ler', 'he.ler_todas', 'auditoria.ler', 'ativo.ler'],
    operacoes: ['agenda.ler', 'reserva.criar', 'os.ler_todas', 'ativo.ler'], comercial: ['agenda.ler', 'ativo.ler'], financeiro: ['car.ler', 'car.criar'],
    rh: ['he.ler_todas', 'he.lancar', 'he.aprovar'], operador: [] };
  for (const [perfil, permissoes] of Object.entries(P)) b.set(doc(db, 'perfis', perfil), { permissoes });
  b.set(doc(db, 'ativos', IDS.GG1), { patrimonio: 'PAT-0001', potencia_kva: 300, reservas: [], versao: 0, ultima_reserva: null, operadores: [U.operador1] });
  b.set(doc(db, 'ativos', IDS.GG2), { patrimonio: 'PAT-0002', potencia_kva: 300, reservas: [], versao: 0, ultima_reserva: null, operadores: [U.operador2] });
  b.set(doc(db, 'ativos', IDS.GG3), { patrimonio: 'PAT-0003', potencia_kva: 500, reservas: [], versao: 0, ultima_reserva: null, operadores: [] });
  const ev = [['ev-a', 'Evento Fictício A', 'Local A', 'confirmado', '(00) 0000-0000'], ['ev-b', 'Evento Fictício B', 'Local B', 'a_confirmar', null], ['ev-c', 'Evento Fictício C', 'Local C', 'cancelado', null]];
  for (const [id, titulo, local, status_evento, tel] of ev) {
    b.set(doc(db, 'eventos', id), { titulo, local, status_evento, telefone_contato: tel, observacoes_internas: 'nota interna' });
    if (status_evento !== 'cancelado') b.set(doc(db, 'tv', id), { titulo, local, status_evento });   // projeção pública
  }
  b.set(doc(db, 'os', IDS.OS1), { numero: 1, operadores: [U.operador1], ativos: [IDS.GG1], ativos_info: [{ id: IDS.GG1, patrimonio: 'PAT-0001' }] });
  b.set(doc(db, 'os', IDS.OS2), { numero: 2, operadores: [U.operador2], ativos: [IDS.GG2], ativos_info: [{ id: IDS.GG2, patrimonio: 'PAT-0002' }] });
  b.set(doc(db, 'contas_receber', 'car-seed'), { cliente: 'Cliente Fictício', valor: 1000 });
  b.set(doc(db, 'he_funcionario', 'he-seed-1'), { funcionario_email: U.operador1, horas: 3, valor: 54, lancado_por: U.rh, aprovado_por: null, status: 'lancada' });
  b.set(doc(db, 'he_funcionario', 'he-seed-2'), { funcionario_email: U.operador2, horas: 2, valor: 36, lancado_por: U.rh, aprovado_por: null, status: 'lancada' });
  b.set(doc(db, 'auditoria', 'aud-seed'), { tabela: 'semente', operacao: 'INSERT', quando: new Date().toISOString() });
  b.set(doc(db, 'marcador_regras', 'finais-v2'), { mensagem: 'legível por visitantes só com as REGRAS FINAIS v2' });
  b.set(doc(db, 'marcador_regras', 'finais-v1'), { mensagem: 'NÃO deve ser legível com as REGRAS FINAIS v2' });
  try { await b.commit(); log('Dados fictícios gravados. AGORA publique as REGRAS FINAIS no console e clique em "Verificar ambiente".'); }
  catch (e) { log('Não gravou (' + (e.code || e) + '). Se as REGRAS FINAIS já estão publicadas, a preparação já foi feita — siga para "Verificar ambiente".'); }
};

// ---------- Verificação do ambiente (obrigatória antes dos testes) ----------
let ambiente = null;
$('verificar').onclick = async () => {
  const s = senhaTeste(); if (!s) return; const itens = [];
  for (const [p, email] of Object.entries(U)) {
    try { await inst(p); itens.push({ verificacao: `login ${email}`, resultado: 'OK' }); }
    catch (e) { itens.push({ verificacao: `login ${email}`, obtido: e.code || String(e), resultado: 'FALHOU' }); }
  }
  // 1) Troca de regras: com as REGRAS FINAIS, (a) visitante LÊ o marcador e (b) a direção NÃO grava fora das coleções previstas.
  //    Com as regras temporárias acontece o contrário nos dois casos.
  // Cada prova tem 3 saídas: 'sim' (aconteceu), 'recusado' (permission-denied) ou 'erro' (técnico: não prova nada).
  const tentativa = async f => { try { return { r: 'sim', v: await prazo(f()) }; } catch (e) { return { r: negadoRegras(e) ? 'recusado' : 'erro', c: cod(e) || String(e) }; } };
  let dA = null; try { dA = (await inst('anon')).db; } catch {}
  const v2 = dA ? await tentativa(() => getDocFromServer(doc(dA, 'marcador_regras', 'finais-v2'))) : { r: 'erro', c: 'instância anônima' };
  if (v2.r === 'sim' && !v2.v.exists()) Object.assign(v2, { r: 'erro', c: 'marcador v2 ausente (preparação não rodou?)' });
  const v1 = dA ? await tentativa(() => getDocFromServer(doc(dA, 'marcador_regras', 'finais-v1'))) : { r: 'erro', c: 'instância anônima' };
  let sonda = { r: 'erro', c: 'login da direção' };
  try { const dD = (await inst('direcao')).db; sonda = await tentativa(() => setDoc(doc(dD, 'sonda', 'teste'), { em: new Date().toISOString() }));
    if (sonda.r === 'sim') await deleteDoc(doc(dD, 'sonda', 'teste')).catch(() => {}); } catch {}
  const finais = v2.r === 'sim' && v1.r === 'recusado' && sonda.r === 'recusado';
  const brecha = v2.r === 'recusado' || v1.r === 'sim' || sonda.r === 'sim';   // prova POSITIVA de regras erradas
  const txt = (x, ok) => x.r === 'erro' ? `ERRO TÉCNICO (${x.c})` : x.r === ok ? x.r : x.r.toUpperCase();
  itens.push({ verificacao: 'REGRAS FINAIS v2 publicadas (temporárias e v1 substituídas)',
    obtido: `visitante lê marcador v2: ${txt(v2, 'sim')} · marcador v1: ${txt(v1, 'recusado')} · direção grava fora do previsto: ${txt(sonda, 'recusado')}`,
    resultado: finais ? 'OK' : brecha ? 'FALHOU' : 'INCONCLUSIVO' });
  // 2) Autocadastro: tenta criar uma conta estranha; se conseguir, apaga na hora e registra.
  const intruso = `intruso-${uuid().slice(0, 8)}@example.com`; const r = await criarUsuario('intruso-' + uuid().slice(0, 4), intruso, uuid());
  if (r.resultado === 'criado') {
    // Mesmo com o autocadastro aberto, a conta estranha não tem perfil: exige RECUSA explícita ao ler a conta fictícia, depois apaga a conta
    const t = await tentativa(() => getDocFromServer(doc(r.db, 'contas_receber', 'car-seed')));
    const apagou = await apagarConta(r.auth);
    // Diferente do Supabase (onde o cadastro aberto REPROVA), aqui é LIMITAÇÃO porque fechar o autocadastro pode não estar disponível no Spark.
    // Não bloqueia SÓ se a conta estranha for comprovadamente RECUSADA ao ler dados (item seguinte). Decisão da direção registrada no relatório.
    itens.push({ verificacao: 'autocadastro público bloqueado', obtido: 'AUTOCADASTRO ACEITO' + (apagou ? ' — conta de teste apagada na hora' : ' — APAGUE no console: ' + intruso), resultado: apagou ? 'LIMITAÇÃO' : 'INCONCLUSIVO' });   // conta estranha não apagada bloqueia os testes
    itens.push({ verificacao: 'conta autocadastrada é RECUSADA ao ler dados (regras exigem perfil)', obtido: txt(t, 'recusado'), resultado: t.r === 'recusado' ? 'OK' : t.r === 'sim' ? 'FALHOU' : 'INCONCLUSIVO' });
  } else {
    const bloqueio = ['auth/admin-restricted-operation', 'auth/operation-not-allowed'].includes(r.resultado);
    itens.push({ verificacao: 'autocadastro público bloqueado', obtido: `recusado (${r.resultado})`, resultado: bloqueio ? 'OK' : 'INCONCLUSIVO' });
  }
  const ok = itens.every(i => i.resultado !== 'FALHOU' && i.resultado !== 'INCONCLUSIVO');
  ambiente = { ok, regras_finais_confirmadas: finais, verificado_em: new Date().toISOString(), itens };
  tabela($('r0'), itens, ['verificacao', 'obtido', 'resultado']);
  $('estado0').textContent = !finais ? 'REGRAS FINAIS NÃO CONFIRMADAS — publique as REGRAS FINAIS, aguarde 1 minuto e clique em Verificar de novo.' : ok ? 'AMBIENTE VERIFICADO — pode rodar os testes.' : 'AMBIENTE COM PROBLEMA — veja os itens em vermelho.';
  $('estado0').className = ok ? 'ok' : 'err';
  relatorio('Firebase (Spark, sem Functions)', 'verificacao_ambiente', ambiente);
};
const pronto = () => { if (ambiente?.ok) return true; alert('Rode primeiro "Verificar ambiente" (as REGRAS FINAIS precisam estar confirmadas).'); return false; };

// ---------- Reserva pela transação do app ----------
async function reservar(db, ativo, tipo, ini, fim, rodada) {
  return runTransaction(db, async tx => {
    const ref = doc(db, 'ativos', ativo); const a = (await tx.get(ref)).data();
    const lista = a.reservas || [];
    if (tipo !== 'pre' && lista.some(r => r.tipo !== 'pre' && r.ini < fim && ini < r.fim)) throw new Error('CONFLITO_RESERVA');
    const rid = uuid();
    tx.update(ref, { reservas: [...lista, { id: rid, ini, fim, tipo }], versao: a.versao + 1, ultima_reserva: rid });
    tx.set(doc(db, 'reservas', rid), { ativo_id: ativo, tipo, ini, fim, rodada });
    return rid;
  }, { maxAttempts: 30 });
}

// Erro técnico que interrompa o teste (ex.: login falhou) vira registro INCONCLUSIVO e o botão volta a funcionar
$('t1').onclick = async () => {
  if (!pronto()) return;
  $('t1').disabled = true;
  try { await teste1(); }
  catch (e) { log('Teste 1 interrompido por erro técnico (' + (e.code || e.message || e) + '): resultado INCONCLUSIVO, rode de novo.'); relatorio(PLATAFORMA, 'teste1_interrompido', { ambiente, resultado: 'INCONCLUSIVO', erro: String(e.code || e.message || e) }); }
  finally { $('t1').disabled = false; }
};
async function teste1() {
  const t0 = baseRodada(); const linhas = [];
  // 10 instâncias "aparelhos" logadas como planejamento, para concorrência real
  const pool = []; for (let k = 0; k < 10; k++) pool.push(await instancia('op-' + k, U.operacoes, senhaTeste()));
  for (const c of cenariosReserva(t0)) {
    const rodada = `fb-${c.id}-${uuid().slice(0, 8)}`; const ini = performance.now();
    const res = await Promise.allSettled(c.pedidos.map(([a, tipo, i, f], n) => reservar(pool[n % pool.length].db, a, tipo, i, f, rodada)));
    const ms = Math.round(performance.now() - ini);
    const aceitas = res.filter(r => r.status === 'fulfilled').length;
    const conflito = res.filter(r => r.status === 'rejected' && String(r.reason).includes('CONFLITO_RESERVA')).length;
    const erros = res.filter(r => r.status === 'rejected' && !String(r.reason).includes('CONFLITO_RESERVA'));
    let lst = null;
    try { const snap = await prazo(getDocsFromServer(query(collection((await inst('direcao')).db, 'reservas'), where('rodada', '==', rodada))));   // testemunha (servidor)
      lst = snap.docs.map(d => ({ ativo: d.data().ativo_id, tipo: d.data().tipo, ini: d.data().ini, fim: d.data().fim })); } catch {}
    const sob = lst ? sobreposicoes(lst) : null;
    const resultado = !lst ? 'INCONCLUSIVO (testemunha não conseguiu contar no banco)'
      : sob > 0 ? 'FALHOU (sobreposição gravada)'
      : erros.length > 0 ? `INCONCLUSIVO (${erros.length} erros técnicos/disputa, não de conflito)`
      : c.esperado(lst.length) && lst.length === aceitas ? 'PASSOU' : 'FALHOU (contagem diferente do esperado)';
    linhas.push({ cenario: `${c.id} ${c.nome}`, pedidos: c.pedidos.length, aceitas, conflito, erros: erros.length, 'no banco': lst ? lst.length : '?',
      'sobreposições': sob ?? '?', 'tempo (ms)': ms, esperado: c.esperadoTxt, mecanismo: 'checagem na transação do APP (cliente)', resultado,
      amostra_erro: erros[0] ? String(erros[0].reason?.code || erros[0].reason).slice(0, 140) : '' });
    tabela($('r1'), linhas, ['cenario', 'pedidos', 'aceitas', 'conflito', 'erros', 'no banco', 'sobreposições', 'tempo (ms)', 'esperado', 'resultado', 'amostra_erro']);
  }
  // C9: tentativa de BURLAR a checagem (gravação direta, sem a lógica do app), com usuário autorizado
  const { db } = pool[0]; const rodada = `fb-C9-${uuid().slice(0, 8)}`; const i0 = t0 + 8e9;
  let burlou = false, erro = '', codigo = '', baseOk = false;
  try { await reservar(db, IDS.GG1, 'definitiva', i0, i0 + 4 * H, rodada); baseOk = true; } catch (e) { erro = 'base: ' + (e.code || e); }
  let a9 = null;   // leitura preparatória FORA da tentativa: uma recusa aqui não pode ser contada como bloqueio da gravação
  if (baseOk) try { a9 = (await prazo(getDocFromServer(doc(db, 'ativos', IDS.GG1)))).data(); } catch (e) { erro = 'leitura preparatória: ' + (cod(e) || e); }
  if (a9) try {
    const ref = doc(db, 'ativos', IDS.GG1); const rid = uuid(); const b = writeBatch(db);
    b.update(ref, { reservas: [...a9.reservas, { id: rid, ini: i0 + H, fim: i0 + 2 * H, tipo: 'definitiva' }], versao: a9.versao + 1, ultima_reserva: rid });
    b.set(doc(db, 'reservas', rid), { ativo_id: IDS.GG1, tipo: 'definitiva', ini: i0 + H, fim: i0 + 2 * H, rodada });
    await prazo(b.commit()); burlou = true;
  } catch (e) { codigo = cod(e); erro = String(cod(e) || e).slice(0, 120); }
  linhas.push({ cenario: 'C9 BURLAR: gravar reserva sobreposta sem a checagem do app', pedidos: 1, aceitas: burlou ? 1 : 0, conflito: '', erros: erro ? 1 : 0,
    'no banco': '', 'sobreposições': burlou ? 1 : 0, 'tempo (ms)': '', esperado: 'mede o limite das regras',
    resultado: !baseOk ? 'INCONCLUSIVO (reserva de referência falhou)' : !a9 ? 'INCONCLUSIVO (leitura preparatória falhou)' : burlou ? 'LIMITAÇÃO: regras não impedem sobreposição'
      : codigo === 'permission-denied' ? 'PASSOU (bloqueado pelas regras)' : 'INCONCLUSIVO (erro não é das regras)', amostra_erro: erro });
  linhas.push(...await negativos(db, t0 + 9e9));
  tabela($('r1'), linhas, ['cenario', 'pedidos', 'aceitas', 'conflito', 'erros', 'no banco', 'sobreposições', 'tempo (ms)', 'esperado', 'resultado', 'amostra_erro']);
  relatorio('Firebase (Spark, sem Functions)', 'teste1_reservas', { ambiente, cenarios: linhas });
}

// ---------- Testes NEGATIVOS da integridade das reservas (usuário AUTORIZADO tentando burlar) ----------
// Critério: cada tentativa precisa ser BLOQUEADA pelas regras. Se passar, é FALHOU (brecha real), não limitação.
async function negativos(db, t) {
  const out = []; const R = (id) => doc(db, 'reservas', id); const A = (id) => doc(db, 'ativos', id); const rod = 'neg-' + uuid().slice(0, 8);
  let base = null;
  try { base = await reservar(db, IDS.GG2, 'definitiva', t, t + H, rod); } catch (e) { out.push({ cenario: 'N0 reserva válida de referência', resultado: 'INCONCLUSIVO (sem a reserva de referência os negativos não podem ser medidos)', amostra_erro: String(e).slice(0, 120) }); return out; }
  async function tentar(nome, montar, esperadoLimite = false) {
    let passou = false, erro = '', codigo = '', preparou = false;
    // Leitura e montagem FORA da tentativa classificada: só o commit pode ser "bloqueado pelas regras"
    let b; try { const a = (await prazo(getDocFromServer(A(IDS.GG2)))).data(); b = writeBatch(db); await montar(b, a); preparou = true; }
    catch (e) { erro = ('preparação: ' + (cod(e) || String(e))).slice(0, 80); }
    if (preparou) { try { await prazo(b.commit()); passou = true; } catch (e) { codigo = cod(e); erro = (cod(e) || String(e)).slice(0, 80); } }
    const res = !preparou ? 'INCONCLUSIVO (preparação da tentativa falhou)' : passou ? (esperadoLimite ? 'LIMITAÇÃO (aceito)' : 'FALHOU (brecha: gravação aceita)')
      : codigo === 'permission-denied' ? 'PASSOU (bloqueado pelas regras)' : 'INCONCLUSIVO (erro não é das regras)';
    out.push({ cenario: nome, pedidos: 1, aceitas: passou ? 1 : 0, conflito: '', erros: passou ? 0 : 1, 'no banco': '', 'sobreposições': '', 'tempo (ms)': '',
      esperado: esperadoLimite ? 'mede limite conhecido' : 'bloqueado pelas regras', resultado: res, amostra_erro: erro });
  }
  const nova = (id, ini, fim) => ({ id, ini, fim, tipo: 'definitiva' });
  const docR = (ativo, ini, fim) => ({ ativo_id: ativo, tipo: 'definitiva', ini, fim, rodada: rod });
  await tentar('N1 alterar o período de uma reserva ANTERIOR na lista (e acrescentar uma nova)', (b, a) => {
    const id = uuid(); const lista = a.reservas.map(x => ({ ...x })); const i = lista.findIndex(x => x.id === base); lista[i].fim = lista[i].fim + H;
    b.update(A(IDS.GG2), { reservas: [...lista, nova(id, t + 5 * H, t + 6 * H)], versao: a.versao + 1, ultima_reserva: id }); b.set(R(id), docR(IDS.GG2, t + 5 * H, t + 6 * H)); });
  await tentar('N2 SUBSTITUIR uma reserva anterior (remove uma e põe outra no lugar)', (b, a) => {
    const id = uuid(); const lista = a.reservas.filter(x => x.id !== base);
    b.update(A(IDS.GG2), { reservas: [...lista, nova(id, t, t + H), nova(uuid(), t + 7 * H, t + 8 * H)].slice(0, a.reservas.length + 1), versao: a.versao + 1, ultima_reserva: id }); b.set(R(id), docR(IDS.GG2, t, t + H)); });
  await tentar('N3 vincular a reserva a OUTRO patrimônio (entra na lista do PAT-0002, documento aponta PAT-0003)', async (b, a) => {
    // O PAT-0003 também é atualizado de forma válida no mesmo lote: assim só a checagem "documento aponta ESTE patrimônio"
    // da lista do PAT-0002 pode negar (não outra regra que mascare a brecha).
    const id = uuid(); const g3 = (await prazo(getDocFromServer(A(IDS.GG3)))).data(); const e = nova(id, t + 9 * H, t + 10 * H);
    b.update(A(IDS.GG2), { reservas: [...a.reservas, e], versao: a.versao + 1, ultima_reserva: id });
    b.update(A(IDS.GG3), { reservas: [...g3.reservas, e], versao: g3.versao + 1, ultima_reserva: id });
    b.set(R(id), docR(IDS.GG3, t + 9 * H, t + 10 * H)); });
  await tentar('N4 REAPROVEITAR o id de uma reserva existente (sem criar documento novo)', (b, a) => {
    b.update(A(IDS.GG2), { reservas: [...a.reservas, nova(base, t + 11 * H, t + 12 * H)], versao: a.versao + 1, ultima_reserva: base }); });
  await tentar('N5 criar documento de reserva SEM atualizar o patrimônio', (b) => { b.set(R(uuid()), docR(IDS.GG2, t + 13 * H, t + 14 * H)); });
  await tentar('N6 entrada da lista DIFERENTE do documento (lista 15h–16h, documento 17h–18h)', (b, a) => {
    const id = uuid(); b.update(A(IDS.GG2), { reservas: [...a.reservas, nova(id, t + 15 * H, t + 16 * H)], versao: a.versao + 1, ultima_reserva: id }); b.set(R(id), docR(IDS.GG2, t + 17 * H, t + 18 * H)); });
  await tentar('N7 acrescentar DUAS entradas no mesmo commit', (b, a) => {
    const id = uuid(); b.update(A(IDS.GG2), { reservas: [...a.reservas, nova(uuid(), t + 19 * H, t + 20 * H), nova(id, t + 21 * H, t + 22 * H)], versao: a.versao + 1, ultima_reserva: id }); b.set(R(id), docR(IDS.GG2, t + 21 * H, t + 22 * H)); });
  await tentar('N8 alterar um documento de reserva existente', (b) => { b.update(R(base), { fim: t + 30 * H }); });
  await tentar('N9 apagar um documento de reserva existente', (b) => { b.delete(R(base)); });
  await tentar('N10 apagar o histórico inteiro do patrimônio (lista vazia)', (b, a) => { b.update(A(IDS.GG2), { reservas: [], versao: a.versao + 1 }); });
  // N12: só a checagem "nenhuma anterior removida" (hasAll) pode negar: tamanho +1 e 1 entrada nova são respeitados,
  // mas uma reserva anterior some (trocada por uma cópia de outra). Precisa de 2 reservas anteriores na lista.
  let base2 = null; try { base2 = await reservar(db, IDS.GG2, 'definitiva', t + 40 * H, t + 41 * H, rod); } catch (e) { base2 = null; }
  if (base2) await tentar('N12 APAGAR uma reserva anterior mantendo o tamanho (duplica outra no lugar)', (b, a) => {
    const id = uuid(); const outra = a.reservas.find(x => x.id === base2); const lista = a.reservas.filter(x => x.id !== base);
    b.update(A(IDS.GG2), { reservas: [...lista, { ...outra }, nova(id, t + 25 * H, t + 26 * H)], versao: a.versao + 1, ultima_reserva: id }); b.set(R(id), docR(IDS.GG2, t + 25 * H, t + 26 * H)); });
  else out.push({ cenario: 'N12 APAGAR uma reserva anterior mantendo o tamanho', resultado: 'INCONCLUSIVO (segunda reserva de referência falhou)', amostra_erro: '' });
  let n11id = null;
  await tentar('N11 REORDENAR a lista ao acrescentar (conteúdo e vínculos intactos)', (b, a) => {
    const id = n11id = uuid(); b.update(A(IDS.GG2), { reservas: [nova(id, t + 23 * H, t + 24 * H), ...[...a.reservas].reverse()], versao: a.versao + 1, ultima_reserva: id }); b.set(R(id), docR(IDS.GG2, t + 23 * H, t + 24 * H)); }, true);
  // Conferência final do ESTADO PERSISTIDO pela testemunha (direção)
  let fim = null;
  try {
    const dW = (await inst('direcao')).db;
    const docs = (await prazo(getDocsFromServer(query(collection(dW, 'reservas'), where('rodada', '==', rod))))).docs.map(d => ({ id: d.id, ...d.data() }));
    const lista = (await prazo(getDocFromServer(doc(dW, 'ativos', IDS.GG2)))).data().reservas;
    const b0 = docs.find(d => d.id === base), e0 = lista.find(e => e.id === base);

    const intacta = b0 && b0.ini === t && b0.fim === t + H && b0.ativo_id === IDS.GG2 && e0 && e0.ini === t && e0.fim === t + H && (!base2 || lista.some(e => e.id === base2));
    // Só podem existir: a referência, a segunda referência e a do N11 (limite conhecido, aceita ou não; uma gravação atrasada dela não é brecha)
    const permitidos = [base, base2, n11id].filter(Boolean);
    const so_esperadas = docs.every(d => permitidos.includes(d.id) && d.ativo_id === IDS.GG2) && (!base2 || docs.some(d => d.id === base2));
    fim = { ok: !!(intacta && so_esperadas), docs: docs.length };
  } catch (e) { fim = null; }
  out.push({ cenario: 'N-final estado no banco conferido pela testemunha', pedidos: '', aceitas: '', conflito: '', erros: '', 'no banco': fim ? fim.docs : '?', 'sobreposições': '', 'tempo (ms)': '',
    esperado: 'reserva de referência intacta; só as gravações esperadas existem', resultado: fim == null ? 'INCONCLUSIVO (testemunha indisponível)' : fim.ok ? 'PASSOU' : 'FALHOU (estado alterado)', amostra_erro: '' });
  return out;
}

// ---------- Teste 2: permissões por perfil (classificação rigorosa, mesmos critérios do Supabase) ----------
// Leitura: PERMITIDO só se a fixture fictícia conhecida for lida NO SERVIDOR (getDocFromServer, sem cache).
//          NEGADO só com recusa explícita (permission-denied) E fixture comprovada pela TESTEMUNHA (direção).
//          (No Firestore as regras não filtram: não existe "vazio por filtro". Vazio/ausente = INCONCLUSIVO.)
// Escrita: o efeito é sempre conferido pela testemunha. NEGADO só com permission-denied E estado conferido sem alteração.
//          Erro de rede, prazo esgotado ou erro de outra natureza = INCONCLUSIVO.
const PERFIS = ['direcao', 'operacoes', 'comercial', 'financeiro', 'rh', 'rh2', 'operador1', 'operador2', 'anon'];
const FX = { CAR: 'car-seed', HE1: 'he-seed-1', HE2: 'he-seed-2', EVA: 'ev-a', AUD: 'aud-seed', TV_TITULO: 'Evento Fictício A' };
const ehEu = p => U[p] || 'anon';
// Testemunha: a direção de teste lê no servidor. true/false = estado comprovado; null = não foi possível provar.
async function testemunha(caminho, cond = d => d.exists()) {
  try { const dW = (await inst('direcao')).db; return !!cond(await prazo(getDocFromServer(doc(dW, ...caminho)))); } catch { return null; }
}
async function leitura(ler, confere, provaExistencia) {
  let r;
  try { r = await prazo(ler()); }
  catch (e) {
    if (!negadoRegras(e)) return obs(INC, `erro não relacionado a permissão (${cod(e) || 'sem código'})`, e.message);
    const existe = await provaExistencia();
    return existe === true ? obs(NEG, 'recusa explícita (permission-denied); fixture comprovada pela testemunha', e.message)
      : obs(INC, 'recusa sem fixture comprovada (pode ser dado ausente, não permissão)', `testemunha: ${existe}`);
  }
  const c = confere(r);
  return c.ok ? obs(PERM, 'fixture fictícia lida no servidor', c.ev) : obs(INC, 'leitura aceita, mas sem a fixture esperada', c.ev);
}
async function escrita(fazer, efeito) {
  let erro = null;
  try { await prazo(fazer()); } catch (e) { erro = e; }
  const p = await efeito();                                   // true = efeito persistido; false = estado sem alteração
  if (p === null) return obs(INC, 'testemunha não conseguiu conferir o estado', cod(erro) || 'sem erro');
  if (p === true) return obs(PERM, erro ? 'EFEITO PERSISTIU apesar do erro' : 'gravação confirmada pela testemunha', cod(erro));
  if (erro && negadoRegras(erro)) return obs(NEG, 'recusa explícita (permission-denied); estado conferido sem alteração', erro.message);
  return obs(INC, erro ? `erro não relacionado a permissão (${cod(erro) || 'sem código'})` : 'SDK confirmou a gravação, mas a testemunha não encontrou', String(erro?.message || ''));
}
const lerDoc = (db, col, id) => () => getDocFromServer(doc(db, col, id));
const existeDoc = s => ({ ok: s.exists(), ev: s.exists() ? s.id : 'documento ausente' });
let HE_RODADA = null;   // HE nova da rodada, lançada pelo RH de teste, para o teste de segregação
const ACOES = {
  'A01 ler conta a receber fictícia': (db) => leitura(lerDoc(db, 'contas_receber', FX.CAR), existeDoc, () => testemunha(['contas_receber', FX.CAR])),
  'A02 criar conta a receber': (db) => { const id = 'car-' + uuid(); return escrita(() => setDoc(doc(db, 'contas_receber', id), { cliente: 'X-' + id, valor: 1 }), () => testemunha(['contas_receber', id])); },
  'A03 ler HE de OUTRO funcionário': (db, p) => { const id = p === 'operador2' ? FX.HE1 : FX.HE2; return leitura(lerDoc(db, 'he_funcionario', id), existeDoc, () => testemunha(['he_funcionario', id])); },
  'A04 lançar HE': (db, p) => { const id = 'he-' + uuid();
    return escrita(() => setDoc(doc(db, 'he_funcionario', id), { funcionario_email: U.operador2, horas: 2, valor: 36, lancado_por: ehEu(p), aprovado_por: null, status: 'lancada' }), () => testemunha(['he_funcionario', id])); },
  'A05 aprovar HE lançada por outra pessoa do RH (segregação)': (db, p) => HE_RODADA
    ? escrita(() => updateDoc(doc(db, 'he_funcionario', HE_RODADA), { status: 'aprovada', aprovado_por: ehEu(p) }),
        () => testemunha(['he_funcionario', HE_RODADA], s => { if (!s.exists()) throw 0; return s.data().aprovado_por === ehEu(p); }))
    : obs(INC, 'HE da rodada não pôde ser criada/comprovada'),
  // A06: o lote (igual ao que a transação do app grava) é montado com a visão da TESTEMUNHA, para que só a regra de
  // GRAVAÇÃO decida. Uma recusa na leitura do patrimônio não pode ser contada como bloqueio da gravação.
  'A06 criar reserva (gravação igual à do app)': async (db) => {
    let a = null; try { a = (await prazo(getDocFromServer(doc((await inst('direcao')).db, 'ativos', IDS.GG3)))).data(); } catch {}
    if (!a) return obs(INC, 'pré-condição: a testemunha não leu o patrimônio PAT-0003');
    const i = baseRodada() + 7e9, m = 'perm-' + uuid(), rid = uuid();
    return escrita(() => { const b = writeBatch(db);
      b.update(doc(db, 'ativos', IDS.GG3), { reservas: [...a.reservas, { id: rid, ini: i, fim: i + H, tipo: 'definitiva' }], versao: a.versao + 1, ultima_reserva: rid });
      b.set(doc(db, 'reservas', rid), { ativo_id: IDS.GG3, tipo: 'definitiva', ini: i, fim: i + H, rodada: m }); return b.commit(); },
    () => testemunha(['reservas', rid])); },
  'A07 ver TODAS as OS (OS 1 e OS 2)': (db) => leitura(() => getDocsFromServer(collection(db, 'os')),
    s => { const ids = s.docs.map(d => d.id); return { ok: [IDS.OS1, IDS.OS2].every(i => ids.includes(i)), ev: `ids: ${ids.length}` }; },
    async () => (await testemunha(['os', IDS.OS1])) && (await testemunha(['os', IDS.OS2]))),
  'A08 ver a OS 1': (db) => leitura(lerDoc(db, 'os', IDS.OS1), existeDoc, () => testemunha(['os', IDS.OS1])),
  'A09 salvar registro de campo na OS 1 com gerador da OS': (db, p) => { const id = uuid();
    return escrita(() => setDoc(doc(db, 'registros_campo', id), { os_id: IDS.OS1, ativo_id: IDS.GG1, operador_email: ehEu(p), data: '2031-01-01', dados: {}, assinatura_sha256: 'x' }), () => testemunha(['registros_campo', id])); },
  'A10 salvar registro na OS 1 com gerador FORA da OS': (db, p) => { const id = uuid();
    return escrita(() => setDoc(doc(db, 'registros_campo', id), { os_id: IDS.OS1, ativo_id: IDS.GG2, operador_email: ehEu(p), data: '2031-01-01', dados: {}, assinatura_sha256: 'x' }), () => testemunha(['registros_campo', id])); },
  'A11 alterar perfis/permissões (dar car.ler ao comercial)': async (db) => {
    const temCar = s => { if (!s.exists()) throw 0; return (s.data().permissoes || []).includes('car.ler'); };
    const ja = await testemunha(['perfis', 'comercial'], temCar);
    if (ja !== false) return obs(INC, 'pré-condição: a permissão já existia ou não pôde ser conferida');
    const o = await escrita(() => updateDoc(doc(db, 'perfis', 'comercial'), { permissoes: arrayUnion('car.ler') }), () => testemunha(['perfis', 'comercial'], temCar));
    if (o.estado !== NEG) { try { await prazo(updateDoc(doc((await inst('direcao')).db, 'perfis', 'comercial'), { permissoes: arrayRemove('car.ler') })); } catch {} }   // limpa (também se INCONCLUSIVO)
    return o; },
  // A12/A13: sem Cloud Functions não há como gerar linha de auditoria nova; o alvo é a semente, com existência comprovada antes de cada tentativa.
  'A12 apagar trilha de auditoria': async (db) => {
    if ((await testemunha(['auditoria', FX.AUD])) !== true) return obs(INC, 'pré-condição: linha de auditoria alvo ausente ou não comprovada');
    return escrita(() => deleteDoc(doc(db, 'auditoria', FX.AUD)), async () => { const ainda = await testemunha(['auditoria', FX.AUD]); return ainda == null ? null : !ainda; }); },
  'A13 alterar trilha de auditoria': async (db) => {
    if ((await testemunha(['auditoria', FX.AUD])) !== true) return obs(INC, 'pré-condição: linha de auditoria alvo ausente ou não comprovada');
    const m = 'X-' + uuid(); return escrita(() => updateDoc(doc(db, 'auditoria', FX.AUD), { operacao: m }), () => testemunha(['auditoria', FX.AUD], s => { if (!s.exists()) throw 0; return s.data().operacao === m; })); },
  'A14 ler telefone de evento direto na tabela': (db) => leitura(lerDoc(db, 'eventos', FX.EVA), s => ({ ok: s.exists() && !!s.data().telefone_contato, ev: s.exists() ? 'telefone presente: ' + !!s.data().telefone_contato : 'documento ausente' }),
    () => testemunha(['eventos', FX.EVA])),
  'A15 ler cadastro de OUTROS usuários': (db, p) => { const alvo = [U.rh2, U.operador1, U.direcao].filter(e => e !== U[p]).slice(0, 2);
    return leitura(() => Promise.all(alvo.map(e => getDocFromServer(doc(db, 'usuarios', e)))), ss => ({ ok: ss.every(s => s.exists()), ev: ss.filter(s => s.exists()).length + '/' + alvo.length }),
      async () => (await testemunha(['usuarios', alvo[0]])) && (await testemunha(['usuarios', alvo[1]]))); },
  'A16 ler projeção da TV (tv_feed)': (db) => leitura(lerDoc(db, 'tv', FX.EVA), s => ({ ok: s.exists() && s.data().titulo === FX.TV_TITULO, ev: s.exists() ? s.data().titulo : 'documento ausente' }),
    () => testemunha(['tv', FX.EVA])),
  'A17 ler patrimônio PAT-0002 (de outra OS)': (db) => leitura(lerDoc(db, 'ativos', IDS.GG2), existeDoc, () => testemunha(['ativos', IDS.GG2])),
};
const ESP = {
  'A01 ler conta a receber fictícia': ['direcao', 'financeiro'], 'A02 criar conta a receber': ['financeiro'],
  'A03 ler HE de OUTRO funcionário': ['direcao', 'rh', 'rh2'], 'A04 lançar HE': ['rh', 'rh2'],
  'A05 aprovar HE lançada por outra pessoa do RH (segregação)': ['rh2'], 'A06 criar reserva (gravação igual à do app)': ['operacoes'],
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
  // Fixture da rodada: HE lançada pelo RH de teste (para testar a segregação na aprovação), comprovada pela testemunha
  HE_RODADA = null;
  try { const id = 'he-rod-' + uuid(); await prazo(setDoc(doc((await inst('rh')).db, 'he_funcionario', id), { funcionario_email: U.operador1, horas: 1, valor: 18, lancado_por: U.rh, aprovado_por: null, status: 'lancada' }));
    if ((await testemunha(['he_funcionario', id])) === true) HE_RODADA = id; } catch {}
  for (const [acao, fn] of Object.entries(ACOES)) for (const p of PERFIS) {
    let o, db;
    try { db = (await inst(p)).db; } catch (e) { o = obs(INC, 'falha de login do perfil de teste', e.code || e.message); }
    if (!o) { try { o = await fn(db, p); } catch (e) { o = obs(INC, 'erro inesperado no teste', String(e?.code || e)); } }
    const esp = ESP[acao].includes(p);
    matriz.push({ acao, perfil: p, esperado: esp ? PERM : NEG, obtido: o.estado, mecanismo: o.mecanismo, evidencia: o.evidencia, resultado: veredito(esp, o) });
  }
  // Verificações extras
  const extra = [];
  let tv = null, tvErro = '';
  try { tv = (await prazo(getDocsFromServer(collection((await inst('anon')).db, 'tv')))).docs.map(d => d.data()); } catch (e) { tvErro = cod(e) || String(e); }
  const temFix = !!tv && tv.some(x => x.titulo === FX.TV_TITULO);
  const chaves = tv ? [...new Set(tv.flatMap(Object.keys))].sort().join(',') : '';
  const vazou = tv ? /0000-0000|nota interna/.test(JSON.stringify(tv)) : false;
  extra.push({ verificacao: 'E1 TV expõe só local,status_evento,titulo', obtido: tv ? chaves : tvErro, resultado: !temFix ? 'INCONCLUSIVO' : chaves === 'local,status_evento,titulo' ? 'OK' : 'DIVERGENTE' });
  extra.push({ verificacao: 'E2 TV omite cancelados', obtido: tv ? tv.filter(x => x.status_evento === 'cancelado').length : '-', resultado: !temFix ? 'INCONCLUSIVO' : tv.every(x => x.status_evento !== 'cancelado') ? 'OK' : 'DIVERGENTE' });
  extra.push({ verificacao: 'E7 TV sem telefone/observação', obtido: tv ? (vazou ? 'vazou' : 'limpo') : '-', resultado: !temFix ? 'INCONCLUSIVO' : vazou ? 'DIVERGENTE' : 'OK' });
  // E3: concessão e retirada confirmadas pela testemunha; leitura classificada pelo mesmo critério da A01
  try {
    const dD = (await inst('direcao')).db, dC = (await inst('comercial')).db;
    const temCar = s => { if (!s.exists()) throw 0; return (s.data().permissoes || []).includes('car.ler'); };
    let com = null, sem = null, conc = null, ret = null;
    try { await prazo(updateDoc(doc(dD, 'perfis', 'comercial'), { permissoes: arrayUnion('car.ler') })); } catch {}
    conc = await testemunha(['perfis', 'comercial'], temCar);
    if (conc === true) com = await ACOES['A01 ler conta a receber fictícia'](dC);
    try { await prazo(updateDoc(doc(dD, 'perfis', 'comercial'), { permissoes: arrayRemove('car.ler') })); } catch {}
    ret = await testemunha(['perfis', 'comercial'], temCar);
    if (ret === false) sem = await ACOES['A01 ler conta a receber fictícia'](dC);
    const res = conc !== true || ret !== false || !com || !sem || com.estado === INC || sem.estado === INC ? 'INCONCLUSIVO' : com.estado === PERM && sem.estado === NEG ? 'OK' : 'DIVERGENTE';
    extra.push({ verificacao: 'E3 direção concede e retira car.ler do comercial: efeito imediato', obtido: `concedida: ${conc} · com: ${com?.estado || '-'} · retirada: ${ret === false} · sem: ${sem?.estado || '-'}`, resultado: res });
  } catch (e) { extra.push({ verificacao: 'E3 permissão em tempo real', obtido: cod(e) || String(e), resultado: 'INCONCLUSIVO' }); }
  extra.push({ verificacao: 'E4 mudança de permissão auditada com autor (servidor)', obtido: 'não disponível sem Cloud Functions (plano Spark)', resultado: 'LIMITAÇÃO' });
  // E6: idempotência. Só conta como aceito o envio confirmado pelo servidor; erro que não é de regra = INCONCLUSIVO.
  try {
    const dO = (await inst('operador1')).db; const rid = uuid(); const reg = { os_id: IDS.OS1, ativo_id: IDS.GG1, operador_email: U.operador1, data: '2031-01-02', dados: { h: 1 }, assinatura_sha256: 'x' };
    let aceitos = 0, negados = 0, tecnicos = 0;
    for (let i = 0; i < 5; i++) { try { await prazo(setDoc(doc(dO, 'registros_campo', rid), reg)); aceitos++; } catch (e) { negadoRegras(e) ? negados++ : tecnicos++; } }
    const existe = await testemunha(['registros_campo', rid]);
    extra.push({ verificacao: 'E6 mesmo registro enviado 5x: 5 envios aceitos e 1 documento', obtido: `aceitos ${aceitos} · recusados ${negados} · erros técnicos ${tecnicos} · existe ${existe}`,
      resultado: existe === null || tecnicos > 0 ? 'INCONCLUSIVO' : aceitos === 5 && existe ? 'OK' : 'DIVERGENTE' });
  } catch (e) { extra.push({ verificacao: 'E6 idempotência', obtido: cod(e) || String(e), resultado: 'INCONCLUSIVO' }); }
  extra.push({ verificacao: 'E8 servidor confere hash da assinatura', obtido: 'regras não calculam hash; exige Cloud Functions', resultado: 'LIMITAÇÃO' });
  const rm = resumo([...matriz, ...extra]);
  tabela($('r2'), [...matriz.filter(m => m.resultado !== 'OK'), ...extra.map(e => ({ acao: e.verificacao, perfil: '-', esperado: '', obtido: e.obtido, mecanismo: '', resultado: e.resultado }))], ['acao', 'perfil', 'esperado', 'obtido', 'mecanismo', 'resultado']);
  $('resumo2').textContent = `${matriz.length} casos + ${extra.length} verificações · OK ${rm.ok} · DIVERGENTE ${rm.divergentes} · INCONCLUSIVO ${rm.inconclusivos} · LIMITAÇÃO ${rm.limitacoes} · ${rm.aprovado ? 'APROVADO (com as limitações listadas)' : 'NÃO APROVADO'}`;
  relatorio('Firebase (Spark, sem Functions)', 'teste2_permissoes', { ambiente, criterio: 'PERMITIDO/NEGADO comprovados; vazio, erro técnico ou sem prova = INCONCLUSIVO', resumo: rm, matriz, extra });
}

// ---------- Conferência dos registros feitos nos celulares ----------
$('t3').onclick = async () => {
  const snap = await getDocs(collection((await inst('direcao')).db, 'registros_campo'));
  const lst = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => x.data < '2031-01-01');
  tabela($('r3'), lst.map(x => ({ id: x.id.slice(0, 8), operador: x.operador_email, data: x.data, capturado: x.capturado_em, assinatura: x.assinatura_sha256 ? 'com hash (não conferido no servidor)' : '—' })), ['id', 'operador', 'data', 'capturado', 'assinatura']);
  relatorio('Firebase (Spark, sem Functions)', 'conferencia_campo', { registros: lst.length, ids_distintos: new Set(lst.map(x => x.id)).size, lista: lst.map(x => ({ id: x.id, data: x.data, capturado_em: x.capturado_em })) });
};
