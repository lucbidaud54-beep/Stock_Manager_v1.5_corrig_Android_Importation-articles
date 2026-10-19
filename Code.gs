/**
 * STOCK MANAGER - Base de données partagée dans Google Sheets
 * DNMADE Daunot
 *
 * Ce script est la "base de données" de l'appli. Tous les appareils s'y synchronisent.
 *
 * Onglets cachés (la vraie base, NE PAS MODIFIER) : _DB_ARTICLES, _DB_UTILISATEURS,
 *   _DB_MOUVEMENTS, _DB_DEMANDES, _DB_HISTORIQUE
 * Onglets lisibles (mis à jour automatiquement, pour consulter et filtrer) :
 *   ARTICLES, UTILISATEURS, MOUVEMENTS, DEMANDES, HISTORIQUE, DERNIERE_SYNC
 *
 * Les mots de passe ne sont jamais écrits en clair : seulement leur empreinte.
 */

// Ce jeton doit être IDENTIQUE à celui de app.js (ligne "token")
const TOKEN = '1d64286613ac7f2f27a38b85';

const TABLES = ['articles', 'users', 'movements', 'requests', 'history'];
const TITRES = {
  articles: 'ARTICLES',
  users: 'UTILISATEURS',
  movements: 'MOUVEMENTS',
  requests: 'DEMANDES',
  history: 'HISTORIQUE'
};
const ENTETE = ['uid', 'id', 'rev', 'supprime', 'modifieLe', 'donnees'];

// Test rapide : ouvrir l'adresse /exec dans un navigateur doit afficher "OK"
function doGet() {
  return rep_({ success: true, message: 'Stock Manager : script OK' });
}

function doPost(e) {
  const verrou = LockService.getScriptLock();
  try {
    verrou.waitLock(25000);
    const corps = JSON.parse(e.postData.contents);
    if (corps.token !== TOKEN) return rep_({ success: false, error: 'Jeton invalide' });
    if (corps.action !== 'SYNC') return rep_({ success: false, error: 'Action inconnue' });
    return rep_(synchroniser_(corps));
  } catch (err) {
    return rep_({ success: false, error: String(err) });
  } finally {
    try { verrou.releaseLock(); } catch (x) {}
  }
}

function synchroniser_(corps) {
  const props = PropertiesService.getScriptProperties();
  const rev0 = Number(props.getProperty('REV') || 0);
  const depuis = Number(corps.since || 0);
  const changements = corps.changes || {};
  const suppressions = corps.deletions || {};

  const ecritures = !!corps.reset || TABLES.some(t =>
    (changements[t] || []).length || (suppressions[t] || []).length);

  const rep = { success: true, rev: rev0, idMap: {}, records: {}, deleted: {} };
  TABLES.forEach(t => { rep.idMap[t] = {}; rep.records[t] = []; rep.deleted[t] = []; });

  // Rien à envoyer et rien de nouveau : réponse immédiate
  if (!ecritures && depuis === rev0) return rep;

  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  const base = {};
  TABLES.forEach(t => { base[t] = charger_(classeur, t); });
  let rev = rev0;

  if (ecritures) {
    const maintenant = new Date().toISOString();

    // Remplacement total : tout l'existant est marqué supprimé
    if (corps.reset) {
      TABLES.forEach(t => {
        const B = base[t];
        B.lignes.forEach(l => {
          if (!l[3]) { rev++; l[2] = rev; l[3] = 1; l[5] = ''; }
        });
        B.ids = {};
        B.maxId = 0;
        B.modifie = true;
      });
    }

    const remapArticles = {};   // ancien numéro d'article -> nouveau numéro

    TABLES.forEach(t => {
      const B = base[t];

      // Suppressions d'abord (elles libèrent des numéros)
      (suppressions[t] || []).forEach(uid => {
        const i = B.parUid[uid];
        if (i === undefined) return;
        const l = B.lignes[i];
        if (l[3]) return;
        rev++;
        l[2] = rev; l[3] = 1; l[5] = '';
        if (B.ids[l[1]] === uid) delete B.ids[l[1]];
        B.modifie = true;
      });

      // Créations et modifications
      (changements[t] || []).forEach(c => {
        const donnees = c.data || {};
        const ancienId = Number(c.id);
        if (t === 'movements' || t === 'requests') corrigerRefs_(t, donnees, remapArticles);

        let id = ancienId;
        const detenteur = B.ids[id];
        if (!id || isNaN(id) || (detenteur && detenteur !== c.uid)) {
          // Ce numéro est déjà pris par un autre enregistrement : on en donne un nouveau
          B.maxId++;
          id = B.maxId;
          rep.idMap[t][c.uid] = id;
          if (t === 'articles' && ancienId) remapArticles[ancienId] = id;
        }

        donnees.id = id;
        donnees.uid = c.uid;
        rev++;
        const ligne = [c.uid, id, rev, 0, maintenant, JSON.stringify(donnees)];

        const i = B.parUid[c.uid];
        if (i !== undefined) {
          const ancien = B.lignes[i];
          if (!ancien[3] && B.ids[ancien[1]] === c.uid) delete B.ids[ancien[1]];
          B.lignes[i] = ligne;
        } else {
          B.parUid[c.uid] = B.lignes.length;
          B.lignes.push(ligne);
        }
        B.ids[id] = c.uid;
        if (id > B.maxId) B.maxId = id;
        B.modifie = true;
      });
    });

    TABLES.forEach(t => { if (base[t].modifie) ecrire_(base[t]); });
    props.setProperty('REV', String(rev));
  }

  // Nouveautés écrites par d'autres appareils (pas ce que cet appareil vient d'envoyer)
  TABLES.forEach(t => {
    base[t].lignes.forEach(l => {
      const r = Number(l[2]);
      if (r > depuis && r <= rev0) {
        if (l[3]) { if (depuis > 0) rep.deleted[t].push(l[0]); }
        else rep.records[t].push(JSON.parse(l[5]));
      }
    });
  });

  rep.rev = rev;

  if (ecritures) {
    try {
      mettreAJourVues_(classeur, base, corps, rev);
    } catch (err) {
      // Les onglets lisibles sont un confort : une erreur ici ne doit jamais bloquer la synchro
    }
  }
  return rep;
}

// Un article a changé de numéro : on corrige les mouvements et demandes qui le citent
function corrigerRefs_(t, donnees, remap) {
  if (t === 'movements' && remap[donnees.articleId] !== undefined) {
    donnees.articleId = remap[donnees.articleId];
  }
  if (t === 'requests' && Array.isArray(donnees.articles)) {
    donnees.articles.forEach(l => {
      if (remap[l.articleId] !== undefined) l.articleId = remap[l.articleId];
    });
  }
}

// Lit un onglet-base en mémoire
function charger_(classeur, t) {
  const nom = '_DB_' + TITRES[t];
  let f = classeur.getSheetByName(nom);
  if (!f) {
    f = classeur.insertSheet(nom);
    f.getRange(1, 1, 1, ENTETE.length).setValues([ENTETE]);
    f.getRange('A:A').setNumberFormat('@');
    f.getRange('E:F').setNumberFormat('@');
    try { f.hideSheet(); } catch (x) {}
  }
  const n = f.getLastRow() - 1;
  const lignes = n > 0 ? f.getRange(2, 1, n, ENTETE.length).getValues() : [];
  const B = { feuille: f, lignes: lignes, parUid: {}, ids: {}, maxId: 0, modifie: false };
  lignes.forEach((l, i) => {
    B.parUid[l[0]] = i;
    if (!l[3]) {
      const id = Number(l[1]);
      B.ids[id] = l[0];
      if (id > B.maxId) B.maxId = id;
    }
  });
  return B;
}

function ecrire_(B) {
  const tout = [ENTETE].concat(B.lignes);
  B.feuille.getRange(1, 1, tout.length, ENTETE.length).setValues(tout);
}

// Onglets lisibles, régénérés après chaque changement
function mettreAJourVues_(classeur, base, corps, rev) {
  const vivants = {};
  TABLES.forEach(t => {
    vivants[t] = base[t].lignes
      .filter(l => !l[3])
      .map(l => JSON.parse(l[5]))
      .sort((a, b) => Number(a.id) - Number(b.id));
  });

  const nomArticle = {};
  vivants.articles.forEach(a => { nomArticle[a.id] = a.name; });

  const mouvements = vivants.movements.map(m =>
    Object.assign({ article: nomArticle[m.articleId] || '(supprimé)' }, m));

  const demandes = vivants.requests.map(r =>
    Object.assign({
      resumeArticles: (r.articles || []).map(l => l.name + ' x' + l.quantity).join(' ; ')
    }, r));

  const utilisateurs = vivants.users.map(u => {
    const c = Object.assign({}, u);
    delete c.passwordHash;   // inutile à lire
    return c;
  });

  ecrireVue_(classeur, TITRES.articles, vivants.articles);
  ecrireVue_(classeur, TITRES.users, utilisateurs);
  ecrireVue_(classeur, TITRES.movements, mouvements);
  ecrireVue_(classeur, TITRES.requests, demandes);
  ecrireVue_(classeur, TITRES.history, vivants.history);
  ecrireVue_(classeur, 'DERNIERE_SYNC', [{
    dateServeur: new Date().toISOString(),
    version: rev,
    modifiePar: corps.user || '',
    appareil: corps.device || '',
    articles: vivants.articles.length,
    mouvements: vivants.movements.length,
    demandes: vivants.requests.length,
    historique: vivants.history.length
  }]);
}

function ecrireVue_(classeur, nom, lignes) {
  let f = classeur.getSheetByName(nom);
  if (!f) f = classeur.insertSheet(nom);
  f.clearContents();
  if (!lignes.length) {
    f.getRange(1, 1).setValue('(aucune donnée)');
    return;
  }
  const colonnes = [];
  lignes.forEach(l => Object.keys(l).forEach(k => {
    if (k !== 'uid' && colonnes.indexOf(k) === -1) colonnes.push(k);
  }));
  const valeurs = lignes.map(l => colonnes.map(k => celluleVue_(l[k])));
  const tout = [colonnes].concat(valeurs);
  f.getRange(1, 1, tout.length, colonnes.length).setValues(tout);
  f.getRange(1, 1, 1, colonnes.length).setFontWeight('bold').setBackground('#E8F0FE');
  f.setFrozenRows(1);
}

function celluleVue_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string' && v.length > 45000) return v.substring(0, 45000) + '…';
  return v;
}

function rep_(objet) {
  return ContentService.createTextOutput(JSON.stringify(objet))
    .setMimeType(ContentService.MimeType.JSON);
}
