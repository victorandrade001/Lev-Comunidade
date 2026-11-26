
/*
 * Lev Negócios | Firebase / Firestore Bridge - protótipo de testes
 * Firebase Web SDK 13.4.0; público: leitura somente de publicados
 * Central: autenticação por e-mail/senha e papéis pré-cadastrados em lev_staff/<UID>
 * Imagens armazenadas em SUBDOCUMENTOS do Firestore, para teste sem Cloud Storage pago.
 * Para produção com alto volume, migrar imagens para Cloud Storage (Blaze) e adotar auditoria.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import { getFirestore, collection, doc, getDoc, getDocs, query, where, onSnapshot, writeBatch } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";

if (!window.LEV_FIREBASE_ACTIVE) {
  // Inativo: os HTML originais permanecem em modo demonstrativo local.
} else {
  const cfg = window.LEV_FIREBASE_CONFIG;
  const isCentral = /(?:^|\/)central\.html$/i.test(location.pathname);
  const KEY = 'lev_editorial_publicacoes_v1';
  const ROOT = 'lev_editorial_publicacoes';
  const IMG_DIR = 'imagens';
  const MAX_IMAGES = 4;
  const MAX_IMG_DATA = 700000;
  const allowedRoles = ['editor','approver'];
  const $ = selector => document.querySelector(selector);
  const cleanError = e => {
    const code = String(e?.code||'');
    if (/permission-denied/.test(code)) return 'Permissão negada. Confira as regras e o perfil autorizado.';
    if (/invalid-credential|wrong-password|user-not-found/.test(code)) return 'E-mail ou senha incorretos.';
    if (/auth\/unauthorized-domain/.test(code)) return 'Domínio não autorizado. Inclua o domínio github.io na lista de domínios autorizados do Firebase Authentication.';
    if (/failed-precondition/.test(code)) return 'Banco ou índice não configurado. Confira o projeto Firestore.';
    return String(e?.message || 'Erro desconhecido').slice(0,240);
  };
  function makeStatus() {
    const node = document.createElement('div');
    node.id = 'levCloudStatus';
    node.setAttribute('role','status');
    node.setAttribute('aria-live','polite');
    node.style.cssText = 'position:fixed;bottom:15px;right:15px;z-index:100000;background:#512D6D;color:#F6F6F6;border:1px solid #9063CD;border-radius:12px;padding:11px 14px;box-shadow:0 8px 22px #32144840;font:700 12px/1.4 Nunito,Arial,sans-serif;max-width:min(350px,calc(100vw - 30px));';
    document.body.append(node);
    return text => {node.textContent = text;};
  }
  const status = makeStatus();
  status('Firebase: conectando ao banco da Lev...');
  let firebaseApp, db, auth;
  try {
    firebaseApp = initializeApp(cfg);
    db = getFirestore(firebaseApp);
    auth = getAuth(firebaseApp);
  } catch (err) {
    status('Firebase: configuração inválida. '+cleanError(err));
    throw err;
  }
  let cloudRevision = 0;
  let listenerStop = null;
  let cloudReady = false;
  let cloudSaving = false;
  let currentRole = '';
  let currentEmail = '';
  let publishedCache = [];

  const isImage = str => typeof str === 'string' && /^data:image\/(png|jpeg|webp);base64,/i.test(str) && str.length <= MAX_IMG_DATA;
  function normalizeImage(image) {
    return {name:String(image?.name||'Imagem').slice(0,90),data:String(image?.data||'')};
  }
  function articleMeta(article) {
    const img = Array.isArray(article.images)? article.images.slice(0,MAX_IMAGES):[];
    const {images, ...meta} = article;
    return {...meta,id:String(article.id||''),imageCount:img.length};
  }
  function articleId(article) {
    const id = String(article?.id||'');
    if(!/^[a-zA-Z0-9_-]{1,140}$/.test(id))throw Error('Identificador de publicação inválido: '+id);
    return id;
  }
  async function loadImages(id, amount) {
    if(!amount) return [];
    const docs = await getDocs(collection(db,ROOT,id,IMG_DIR));
    return docs.docs.sort((a,b)=>Number(a.id)-Number(b.id)).slice(0,MAX_IMAGES)
      .map(s=>normalizeImage(s.data())).filter(im=>isImage(im.data));
  }
  async function loadArticle(snapshot) {
    const item = snapshot.data();
    const id = snapshot.id;
    const images = await loadImages(id, Number(item.imageCount)||0);
    return {...item,id,images};
  }
  async function hydrateSnapshots(snap, rev) {
    const items = await Promise.all(snap.docs.map(loadArticle));
    if (rev !== cloudRevision) return null;
    return items;
  }
  function publishToScreens(items) {
    // Only published content is exposed in the partner & GC portals.
    publishedCache = items.filter(x=>x.status==='published');
    window.LEV_FIREBASE_NEWS = publishedCache;
    window.dispatchEvent(new Event('lev-news-updated'));
    window.dispatchEvent(new CustomEvent('lev-cloud-ready', {detail:{count:publishedCache.length}}));
  }
  function listenPublic() {
    window.LEV_FIREBASE_NEWS = [];
    const q=query(collection(db,ROOT),where('status','==','published'));
    listenerStop=onSnapshot(q, async snapshot=>{
      const rev=++cloudRevision;
      try {
        const items=await hydrateSnapshots(snapshot,rev);
        if(!items) return;
        cloudReady=true;
        publishToScreens(items);
        status('Firebase conectado • '+publishedCache.length+' publicação(ões) sincronizada(s)');
      } catch(err) {status('Firebase: falha ao carregar imagens. '+cleanError(err));}
    },err=>{
      cloudReady=false;
      window.LEV_FIREBASE_NEWS=[];
      window.dispatchEvent(new Event('lev-news-updated'));
      status('Firebase: leitura indisponível. '+cleanError(err));
    });
  }

  function makeAuthPanel() {
    const overlay = document.createElement('div');
    overlay.id='levCloudLogin';
    overlay.style.cssText='position:fixed;inset:0;z-index:200000;display:grid;place-items:center;background:linear-gradient(130deg,#512D6D,#753BBD);font-family:Nunito,Arial,sans-serif;padding:16px;';
    overlay.innerHTML=`<div style="background:#F6F6F6;border-radius:20px;padding:30px;max-width:450px;width:100%;box-shadow:0 24px 50px #22083077">
      <div style="font-size:12px;font-weight:900;letter-spacing:.1em;color:#753BBD">LEV NEGÓCIOS • FIREBASE</div>
      <h1 style="margin:10px 0;color:#512D6D;font-size:26px;line-height:1.2">Central Editorial</h1>
      <p style="font-size:13px;color:#655473;line-height:1.5;margin:0 0 20px">Acesso restrito a colaboradores autorizados. Use sua conta cadastrada no Firebase Authentication.</p>
      <form id="levCloudForm" style="display:grid;gap:12px">
        <label style="display:grid;gap:5px;font-size:13px;font-weight:700;color:#512D6D">E-mail<input id="levCloudEmail" type="email" autocomplete="username" required style="font:inherit;padding:12px;border:1px solid #cbc0d8;border-radius:10px"></label>
        <label style="display:grid;gap:5px;font-size:13px;font-weight:700;color:#512D6D">Senha<input id="levCloudPassword" type="password" autocomplete="current-password" required style="font:inherit;padding:12px;border:1px solid #cbc0d8;border-radius:10px"></label>
        <button type="submit" style="background:#753BBD;border:0;border-radius:10px;padding:13px;color:white;font:800 14px Nunito,Arial,sans-serif;cursor:pointer">Entrar na Central</button>
      </form>
      <p id="levCloudAuthError" role="alert" style="color:#ac2222;font-size:12px;margin:12px 0 0;min-height:17px"></p>
      <p style="color:#6a6371;font-size:11px;line-height:1.5">Sem autocadastro. A equipe responsável cria usuários e atribui o papel Editor ou Aprovador no Firebase.</p>
    </div>`;
    document.body.append(overlay);
    const form=overlay.querySelector('#levCloudForm');
    form.addEventListener('submit',async e=>{
      e.preventDefault();
      const button=form.querySelector('button');button.disabled=true;
      overlay.querySelector('#levCloudAuthError').textContent='Verificando credenciais...';
      try {
        await signInWithEmailAndPassword(auth,overlay.querySelector('#levCloudEmail').value.trim(),overlay.querySelector('#levCloudPassword').value);
        overlay.querySelector('#levCloudPassword').value='';
      } catch(err){overlay.querySelector('#levCloudAuthError').textContent=cleanError(err);}
      finally {button.disabled=false;}
    });
    return overlay;
  }

  async function applyCentralDocs(snapshot) {
    const rev=++cloudRevision;
    try {
      const items=await hydrateSnapshots(snapshot,rev);
      if(!items) return;
      cloudReady=true;
      if (typeof window.LEV_CENTRAL_CLOUD_APPLY === 'function') {
        window.LEV_CENTRAL_CLOUD_APPLY(items);
      }
      status('Firebase conectado • '+items.length+' publicação(ões) • '+(currentRole==='editor'?'Editor':'Aprovador'));
    } catch(err){status('Firebase: falha na leitura. '+cleanError(err));}
  }

  async function writeDifference(before,after) {
    const oldMap = new Map(before.map(x=>[String(x.id),x]));
    const newMap = new Map(after.map(x=>[String(x.id),x]));
    for(const [id] of oldMap) {
      if(newMap.has(id)) continue;
      const batch=writeBatch(db);
      batch.delete(doc(db,ROOT,id));
      for(let slot=0;slot<MAX_IMAGES;slot++)batch.delete(doc(db,ROOT,id,IMG_DIR,String(slot)));
      await batch.commit();
    }
    for(const [id,item] of newMap) {
      articleId(item);
      const previous=oldMap.get(id);
      const afterMeta=articleMeta(item);
      const prevMeta=previous? articleMeta(previous):null;
      const img=Array.isArray(item.images)? item.images.slice(0,MAX_IMAGES).map(normalizeImage):[];
      const oldImg=Array.isArray(previous?.images)? previous.images.slice(0,MAX_IMAGES).map(normalizeImage):[];
      const imageChanged=JSON.stringify(img)!==JSON.stringify(oldImg);
      const metaChanged=!previous||JSON.stringify(afterMeta)!==JSON.stringify(prevMeta);
      if(!imageChanged&&!metaChanged)continue;
      // Quando só as imagens mudam, também atualizamos o documento pai.
      // Assim a assinatura em tempo real dos outros computadores é acionada.
      if(imageChanged)afterMeta.imageRevision=Date.now();
      const batch=writeBatch(db);
      if(metaChanged||imageChanged)batch.set(doc(db,ROOT,id),afterMeta);
      if(imageChanged) {
        for(let slot=0;slot<MAX_IMAGES;slot++) {
          const target=doc(db,ROOT,id,IMG_DIR,String(slot));
          if (slot < img.length) {
            if (!isImage(img[slot].data))throw Error('Imagem inválida ou acima do limite. Comprima antes de publicar.');
            batch.set(target,img[slot]);
          } else {
            batch.delete(target);
          }
        }
      }
      await batch.commit();
    }
  }
  function saveCentral(next,before) {
    if(!cloudReady || !allowedRoles.includes(currentRole)) {
      alert('Firebase ainda não está pronto ou seu acesso não foi autorizado. Nenhuma alteração foi enviada.');return false;
    }
    if(cloudSaving) {alert('Aguarde o salvamento da última publicação.');return false;}
    cloudSaving=true;
    status('Firebase: salvando alterações na nuvem...');
    writeDifference(before,next).then(()=>{
      status('Firebase: alterações enviadas. Atualizando os portais...');
    }).catch(err=>{
      status('Firebase: FALHA AO SALVAR. '+cleanError(err));
      alert('A alteração NÃO foi confirmada no Firebase. Verifique a conexão e suas permissões.\n\n'+cleanError(err));
    }).finally(()=>{cloudSaving=false;});
    return true;
  }
  if(isCentral) {
    const panel=makeAuthPanel();
    window.LEV_CLOUD_SAVE=saveCentral;
    onAuthStateChanged(auth,async user=>{
      if(listenerStop) {listenerStop();listenerStop=null;}
      cloudRevision++; cloudReady=false;
      currentRole='';currentEmail='';
      window.LEV_CENTRAL_CLOUD_LOCK?.();
      if(!user){panel.style.display='grid';status('Central: faça login no Firebase.');return;}
      status('Firebase: validando permissões da equipe...');
      try {
        const staff=await getDoc(doc(db,'lev_staff',user.uid));
        const role=staff.exists()?String(staff.data().role||''):'';
        if(!allowedRoles.includes(role))throw Error('O usuário não tem perfil. Cadastre lev_staff/'+user.uid+' com role editor ou approver no Firebase.');
        currentRole=role;currentEmail=user.email||'';window.LEV_CLOUD_AUTH_EMAIL=currentEmail;
        window.LEV_CENTRAL_CLOUD_ENTER?.(role,currentEmail);
        panel.style.display='none';
        status('Firebase: carregando as publicações...');
        listenerStop=onSnapshot(collection(db,ROOT),applyCentralDocs,err=>{
          cloudReady=false;status('Central: sem acesso à coleção. '+cleanError(err));
        });
      } catch(err){
        panel.style.display='grid';panel.querySelector('#levCloudAuthError').textContent=cleanError(err);
        status('Central: usuário não autorizado.');
        await signOut(auth);
      }
    });
    document.getElementById('centralLogout')?.addEventListener('click',()=>signOut(auth));
  } else {
    listenPublic();
  }
}
