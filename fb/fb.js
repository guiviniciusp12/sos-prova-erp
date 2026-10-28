// Carrega o SDK oficial do Firebase (CDN gstatic, mesma origem usada pelos apps legados) e cria instâncias.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, deleteUser } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import * as fs from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { FIREBASE } from '../config.js';
export { fs, signOut, onAuthStateChanged };

const apps = {}, criados = {}, dbs = {};
// Uma instância por usuário de teste (sessões independentes, como aparelhos diferentes)
export async function instancia(nome, email, senha, { offline = false } = {}) {
  if (apps[nome]) return apps[nome];
  // O app é reaproveitado numa nova tentativa: um login que falhou não pode travar o nome (app/duplicate-app)
  const app = criados[nome] ||= initializeApp(FIREBASE, nome);
  const auth = getAuth(app);
  const db = dbs[nome] ||= offline ? fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) })
                     : fs.getFirestore(app);
  if (email) { if (!auth.currentUser || auth.currentUser.email !== email) await signInWithEmailAndPassword(auth, email, senha); }
  return (apps[nome] = { app, auth, db, email });
}
// Usado SÓ para provar que o autocadastro está bloqueado (a conta estranha é apagada na hora se passar)
export async function criarUsuario(nome, email, senha) {
  const app = initializeApp(FIREBASE, 'cria-' + nome); const auth = getAuth(app);
  try { await createUserWithEmailAndPassword(auth, email, senha); return { resultado: 'criado', auth, db: fs.getFirestore(app) }; }
  catch (e) { return { resultado: e.code || String(e), auth }; }
}
export async function apagarConta(auth) {
  try { await deleteUser(auth.currentUser); return true; } catch { return false; }
}
