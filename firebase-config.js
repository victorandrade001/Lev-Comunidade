// Lev Negócios | Configuração pública do Firebase Web.
// SEM SENHAS. A autenticação e as regras do Firestore controlam a segurança.
// Não utilizamos Firebase Analytics nesta versão de testes.
window.LEV_FIREBASE_CONFIG = {
  "apiKey": "AIzaSyBLLXCQxmQeeN0yKcEKSio96swkodSdDtc",
  "authDomain": "lev-comunidade-teste.firebaseapp.com",
  "projectId": "lev-comunidade-teste",
  "storageBucket": "lev-comunidade-teste.firebasestorage.app",
  "messagingSenderId": "694027771077",
  "appId": "1:694027771077:web:8e4095a06d1234227aa4ac",
  "measurementId": "G-PY5YWEHWC2"
};
window.LEV_FIREBASE_ACTIVE = Boolean(
  window.LEV_FIREBASE_CONFIG.apiKey &&
  window.LEV_FIREBASE_CONFIG.authDomain &&
  window.LEV_FIREBASE_CONFIG.projectId &&
  window.LEV_FIREBASE_CONFIG.appId
);
if (window.LEV_FIREBASE_ACTIVE) document.documentElement.classList.add('lev-firebase-enabled');
