// Cliente mínimo do Supabase via HTTP (Auth = GoTrue, dados = PostgREST). Sem SDK.
import { SUPABASE } from '../config.js';
const U = SUPABASE.url.replace(/\/$/, '');

async function corpo(r) { const t = await r.text(); try { return t ? JSON.parse(t) : null; } catch { return t; } }

export async function signup(email, password) {
  const r = await fetch(`${U}/auth/v1/signup`, { method: 'POST', headers: { apikey: SUPABASE.anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return { ok: r.ok, status: r.status, body: await corpo(r) };
}
export async function login(email, password) {
  const r = await fetch(`${U}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: SUPABASE.anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const b = await corpo(r); if (!r.ok) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(b)}`);
  return { access_token: b.access_token, refresh_token: b.refresh_token, expires_at: b.expires_at || (Date.now() / 1000 + (b.expires_in || 3600)), email };
}
export async function renovar(sessao) {
  const r = await fetch(`${U}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: SUPABASE.anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: sessao.refresh_token }) });
  const b = await corpo(r); if (!r.ok) throw new Error(`renovar: ${r.status}`);
  return { ...sessao, access_token: b.access_token, refresh_token: b.refresh_token, expires_at: b.expires_at || (Date.now() / 1000 + (b.expires_in || 3600)) };
}
function hdr(token, extra = {}) {
  return { apikey: SUPABASE.anonKey, Authorization: `Bearer ${token || SUPABASE.anonKey}`, 'Content-Type': 'application/json', ...extra };
}
export async function rpc(fn, args, token) {
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: hdr(token), body: JSON.stringify(args || {}) });
  return { ok: r.ok, status: r.status, body: await corpo(r) };
}
export async function ler(tabela, query, token) {
  const r = await fetch(`${U}/rest/v1/${tabela}?${query || 'select=*'}`, { headers: hdr(token) });
  return { ok: r.ok, status: r.status, body: await corpo(r) };
}
export async function inserir(tabela, linhas, token) {
  const r = await fetch(`${U}/rest/v1/${tabela}`, { method: 'POST', headers: hdr(token, { Prefer: 'return=representation' }), body: JSON.stringify(linhas) });
  return { ok: r.ok, status: r.status, body: await corpo(r) };
}
export async function alterar(tabela, filtro, dados, token) {
  const r = await fetch(`${U}/rest/v1/${tabela}?${filtro}`, { method: 'PATCH', headers: hdr(token, { Prefer: 'return=representation' }), body: JSON.stringify(dados) });
  return { ok: r.ok, status: r.status, body: await corpo(r) };
}
export async function apagar(tabela, filtro, token) {
  const r = await fetch(`${U}/rest/v1/${tabela}?${filtro}`, { method: 'DELETE', headers: hdr(token, { Prefer: 'return=representation' }) });
  return { ok: r.ok, status: r.status, body: await corpo(r) };
}
// Quantas linhas a operação viu/afetou (0 ou erro = negado)
export const linhas = res => res.ok ? (Array.isArray(res.body) ? res.body.length : (res.body == null ? 0 : 1)) : 0;
