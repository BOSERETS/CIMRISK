/* Analyse de Risque Terrain — CimeEnvie
   PWA autonome. ES5 synchrone sauf IndexedDB (async par nature).
   Stockage: IndexedDB, 2 object stores: 'catalogue', 'analyses'.
   Matrice P×I validée — codée en dur, ne pas modifier sans revalidation. */

(function () {
  'use strict';

  /* ---------- Matrice de décision (validée) ---------- */
  function severite(p, i) {
    if (p === 0 || p === '' || p === null || typeof p === 'undefined') {
      return { classe: 'Hors matrice', couleur: 'gris' };
    }
    var T = {
      4: { 1: 'Inadmissible', 2: 'Inadmissible', 3: 'Intolérable',  4: 'Intolérable' },
      3: { 1: 'Tolérable',    2: 'Inadmissible', 3: 'Inadmissible', 4: 'Intolérable' },
      2: { 1: 'Admissible',   2: 'Tolérable',    3: 'Inadmissible', 4: 'Inadmissible' },
      1: { 1: 'Admissible',   2: 'Admissible',   3: 'Admissible',   4: 'Inadmissible' }
    };
    if (!i || !T[i] || !T[i][p]) return { classe: '—', couleur: 'gris' };
    var classe = T[i][p];
    var couleurs = { 'Admissible': 'vert', 'Tolérable': 'jaune', 'Inadmissible': 'orange', 'Intolérable': 'rouge' };
    return { classe: classe, couleur: couleurs[classe] };
  }

  /* ---------- Catalogue initial (transcrit et validé) ---------- */
  var CATALOGUE_SEED = {
    humain_orga: [
      "Manque d'expérience d'un ou plusieurs participants",
      "Équipement inadéquat",
      "Mauvaise préparation physique d'un ou plusieurs participants",
      "Sous-estimation des conditions météorologiques",
      "Manque d'hydratation et malnutrition",
      "Manque de connaissance du terrain",
      "Absence de communication",
      "Fatigue mentale",
      "Manque de formation aux premiers secours",
      "Absence de planification d'itinéraire",
      "Taille du groupe inadéquate",
      "Mauvaise dynamique de groupe"
    ],
    environnement: [
      "Situation administrative non-conforme",
      "Orage",
      "Pluie intense",
      "Vent violent",
      "Froid extrême",
      "Sécheresse",
      "Chaleur extrême",
      "Brouillard",
      "Chutes de neige",
      "Sentiers escarpés ou mal balisés",
      "Glissements de terrain",
      "Torrent en crue",
      "Chutes de pierres",
      "Avalanches",
      "Lave torrentielle",
      "Morsures",
      "Piqûres d'insectes ou acariens",
      "Comportement dangereux",
      "Isolement",
      "Retard",
      "Absence d'eau potable",
      "Épuisement",
      "Inexpérience, émotions, stress et pièges de l'inconscient",
      "Conflit"
    ]
  };
  var FAMILLES = { humain_orga: 'Facteurs humains & organisationnels', environnement: 'Dangers environnementaux & externes' };

  /* ---------- IndexedDB ---------- */
  var DB = null;
  function openDB(cb) {
    var req = indexedDB.open('risque_db', 1);
    req.onupgradeneeded = function (e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains('catalogue')) {
        db.createObjectStore('catalogue', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('analyses')) {
        db.createObjectStore('analyses', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = function (e) { DB = e.target.result; cb(); };
    req.onerror = function () { alert("Erreur d'ouverture de la base locale."); };
  }
  function tx(store, mode) { return DB.transaction(store, mode).objectStore(store); }
  function getAll(store, cb) {
    var out = [], c = tx(store, 'readonly').openCursor();
    c.onsuccess = function (e) { var cur = e.target.result; if (cur) { out.push(cur.value); cur.continue(); } else cb(out); };
  }
  function put(store, val, cb) { var r = tx(store, 'readwrite').put(val); r.onsuccess = function (e) { cb && cb(e.target.result); }; }
  function del(store, id, cb) { var r = tx(store, 'readwrite').delete(id); r.onsuccess = function () { cb && cb(); }; }

  /* seed catalogue once */
  function seedCatalogue(cb) {
    getAll('catalogue', function (rows) {
      if (rows.length > 0) { cb(); return; }
      var ops = [];
      ['humain_orga', 'environnement'].forEach(function (fam) {
        CATALOGUE_SEED[fam].forEach(function (lib) {
          ops.push({ libelle: lib, famille: fam, actif: true });
        });
      });
      var n = ops.length, done = 0;
      ops.forEach(function (o) { put('catalogue', o, function () { done++; if (done === n) cb(); }); });
    });
  }

  /* ---------- Helpers ---------- */
  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function nowISO() { return new Date().toISOString(); }
  function fmtDate(iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('fr-BE'); }

  /* ---------- State / routing ---------- */
  var STATE = { screen: 'liste', analyseId: null };
  function go(screen, id) { STATE.screen = screen; STATE.analyseId = (typeof id === 'undefined') ? STATE.analyseId : id; render(); }

  /* ---------- Render dispatch ---------- */
  function render() {
    var root = el('app');
    if (STATE.screen === 'liste') return renderListe(root);
    if (STATE.screen === 'entete') return renderEntete(root);
    if (STATE.screen === 'scenarios') return renderScenarios(root);
    if (STATE.screen === 'catalogue') return renderCatalogue(root);
  }

  /* ---------- Screen 1: liste des analyses ---------- */
  function renderListe(root) {
    getAll('analyses', function (rows) {
      rows.sort(function (a, b) { return (b.modifie_le || '').localeCompare(a.modifie_le || ''); });
      var h = '<header class="hd"><h1>Analyses de risque</h1>'
        + '<button class="btn-ic" id="goCat" title="Catalogue">☰</button></header>';
      h += '<div class="bar"><button class="btn primary" id="newA">+ Nouvelle analyse</button></div>';
      if (rows.length === 0) {
        h += '<p class="empty">Aucune analyse. Crée ta première analyse pour une sortie.</p>';
      } else {
        h += '<ul class="list">';
        rows.forEach(function (a) {
          var nb = (a.scenarios || []).length;
          h += '<li class="card" data-id="' + a.id + '">'
            + '<div class="card-main" data-open="' + a.id + '">'
            + '<div class="card-t">' + esc(a.entete && a.entete.nom || '(sans nom)') + '</div>'
            + '<div class="card-s">' + esc(fmtDate(a.entete && a.entete.date)) + (a.entete && a.entete.lieu ? ' · ' + esc(a.entete.lieu) : '') + ' · ' + nb + ' scénario(s)</div>'
            + '</div>'
            + '<div class="card-act">'
            + '<button class="btn-ic" data-exp="' + a.id + '" title="Exporter">⤓</button>'
            + '<button class="btn-ic danger" data-del="' + a.id + '" title="Supprimer">🗑</button>'
            + '</div></li>';
        });
        h += '</ul>';
      }
      h += '<div class="bar"><button class="btn ghost" id="impA">Importer une analyse (JSON)</button>'
        + '<input type="file" id="impFile" accept="application/json" style="display:none"></div>';
      root.innerHTML = h;

      el('newA').onclick = function () { go('entete', null); };
      el('goCat').onclick = function () { go('catalogue'); };
      el('impA').onclick = function () { el('impFile').click(); };
      el('impFile').onchange = function (e) { importAnalyse(e.target.files[0]); };
      Array.prototype.forEach.call(root.querySelectorAll('[data-open]'), function (n) {
        n.onclick = function () { go('scenarios', parseInt(n.getAttribute('data-open'), 10)); };
      });
      Array.prototype.forEach.call(root.querySelectorAll('[data-del]'), function (n) {
        n.onclick = function (ev) { ev.stopPropagation(); var id = parseInt(n.getAttribute('data-del'), 10);
          if (confirm('Supprimer définitivement cette analyse ?')) del('analyses', id, function () { render(); }); };
      });
      Array.prototype.forEach.call(root.querySelectorAll('[data-exp]'), function (n) {
        n.onclick = function (ev) { ev.stopPropagation(); exportAnalyse(parseInt(n.getAttribute('data-exp'), 10)); };
      });
    });
  }

  /* ---------- Screen 2: en-tête ---------- */
  function renderEntete(root) {
    function draw(a) {
      var e = a.entete || {};
      var h = '<header class="hd"><button class="btn-ic" id="back">‹</button><h1>' + (a.id ? 'Modifier l\'en-tête' : 'Nouvelle analyse') + '</h1></header>';
      h += '<div class="form">'
        + field('Nom de la sortie *', 'f_nom', e.nom)
        + field('Date', 'f_date', e.date ? e.date.substr(0, 10) : '', 'date')
        + field('Lieu / massif', 'f_lieu', e.lieu)
        + field('Auteur', 'f_auteur', e.auteur)
        + area('Engagement / synthèse itinéraire', 'f_eng', e.engagement)
        + '<button class="btn primary block" id="saveE">' + (a.id ? 'Enregistrer' : 'Créer et passer aux scénarios') + '</button>'
        + '</div>';
      root.innerHTML = h;
      el('back').onclick = function () { go('liste'); };
      el('saveE').onclick = function () {
        var nom = el('f_nom').value.trim();
        if (!nom) { alert('Le nom de la sortie est obligatoire.'); return; }
        a.entete = {
          nom: nom,
          date: el('f_date').value ? new Date(el('f_date').value).toISOString() : '',
          lieu: el('f_lieu').value.trim(),
          auteur: el('f_auteur').value.trim(),
          engagement: el('f_eng').value.trim()
        };
        a.modifie_le = nowISO();
        if (!a.cree_le) a.cree_le = a.modifie_le;
        if (!a.scenarios) a.scenarios = [];
        put('analyses', a, function (id) { STATE.analyseId = a.id || id; go('scenarios'); });
      };
    }
    if (STATE.analyseId) {
      tx('analyses', 'readonly').get(STATE.analyseId).onsuccess = function (e) { draw(e.target.result); };
    } else { draw({ scenarios: [] }); }
  }

  function field(label, id, val, type) {
    return '<label class="fl">' + esc(label) + '<input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(val) + '"></label>';
  }
  function area(label, id, val) {
    return '<label class="fl">' + esc(label) + '<textarea id="' + id + '" rows="3">' + esc(val) + '</textarea></label>';
  }

  /* ---------- Screen 3: scénarios ---------- */
  function renderScenarios(root) {
    tx('analyses', 'readonly').get(STATE.analyseId).onsuccess = function (ev) {
      var a = ev.target.result;
      if (!a.scenarios) a.scenarios = [];
      // migration douce: ancien modèle {libelle,source} -> {nom,facteurs[]}
      a.scenarios.forEach(function (s) {
        if (!s.facteurs && s.libelle) {
          s.nom = s.libelle;
          s.facteurs = [{ libelle: s.libelle, source: s.source || 'autre' }];
          delete s.libelle; delete s.source;
        }
        if (!s.facteurs) s.facteurs = [];
        if (!s.nom) s.nom = '(sans nom)';
      });
      getAll('catalogue', function (cat) {
        var actifs = cat.filter(function (c) { return c.actif; });
        var h = '<header class="hd"><button class="btn-ic" id="back">‹</button>'
          + '<h1>' + esc(a.entete.nom) + '</h1>'
          + '<button class="btn-ic" id="editE" title="En-tête">✎</button></header>';

        // résumé
        var counts = { 'Intolérable': 0, 'Inadmissible': 0, 'Tolérable': 0, 'Admissible': 0, 'Hors matrice': 0 };
        a.scenarios.forEach(function (s) {
          var sv = severite(s.p_residuel !== '' && s.p_residuel != null ? s.p_residuel : s.p_initial,
                            s.i_residuel !== '' && s.i_residuel != null ? s.i_residuel : s.i_initial);
          counts[sv.classe] = (counts[sv.classe] || 0) + 1;
        });
        h += '<div class="synth">' + chip('rouge', counts['Intolérable']) + chip('orange', counts['Inadmissible'])
          + chip('jaune', counts['Tolérable']) + chip('vert', counts['Admissible'])
          + chip('gris', counts['Hors matrice']) + '<span class="synth-l">résiduel</span></div>';

        // liste scénarios
        h += '<div class="scn-list">';
        a.scenarios.forEach(function (s, idx) {
          var svI = severite(s.p_initial, s.i_initial);
          var svR = severite(s.p_residuel, s.i_residuel);
          var facs = (s.facteurs || []).map(function (f) { return esc(f.libelle); }).join(' · ');
          h += '<div class="scn">'
            + '<div class="scn-h"><span class="scn-t">' + esc(s.nom) + '</span>'
            + '<span class="scn-btns">'
            + '<button class="btn-ic" data-edit="' + idx + '" title="Modifier facteurs">✎</button>'
            + '<button class="btn-ic danger" data-rm="' + idx + '" title="Retirer">×</button>'
            + '</span></div>';
          if (facs) h += '<div class="scn-fac">' + facs + '</div>';
          // initial
          h += '<div class="cot"><span class="cot-l">Initial</span>'
            + selP('pi_' + idx, s.p_initial) + selI('ii_' + idx, s.i_initial, s.p_initial)
            + '<span class="sev ' + svI.couleur + '">' + svI.classe + '</span></div>';
          // mesures (seulement si coté)
          h += '<div class="mes ' + (s.p_initial === 0 || s.p_initial === '' || s.p_initial == null ? 'hidden' : '') + '" data-mes="' + idx + '">'
            + area2('Mesures — diminuer la probabilité', 'mp_' + idx, s.mesures_proba)
            + area2("Mesures — diminuer l'impact", 'mi_' + idx, s.mesures_impact)
            + '<div class="cot"><span class="cot-l">Résiduel</span>'
            + selP('pr_' + idx, s.p_residuel) + selI('ir_' + idx, s.i_residuel, s.p_residuel)
            + '<span class="sev ' + svR.couleur + '">' + svR.classe + '</span></div>'
            + '</div>';
          h += '</div>';
        });
        h += '</div>';

        h += '<div class="bar"><button class="btn primary block" id="newScn">+ Ajouter un scénario</button></div>';

        root.innerHTML = h;

        el('back').onclick = function () { go('liste'); };
        el('editE').onclick = function () { go('entete'); };

        function saveScn() { a.modifie_le = nowISO(); put('analyses', a); }

        // cotation handlers
        a.scenarios.forEach(function (s, idx) {
          bindSel('pi_' + idx, function (v) {
            s.p_initial = v; if (v === 0) { s.i_initial = ''; }
            saveScn(); renderScenarios(root);
          });
          bindSel('ii_' + idx, function (v) { s.i_initial = v; saveScn(); renderScenarios(root); });
          bindSel('pr_' + idx, function (v) { s.p_residuel = v; if (v === 0) { s.i_residuel = ''; } saveScn(); renderScenarios(root); });
          bindSel('ir_' + idx, function (v) { s.i_residuel = v; saveScn(); renderScenarios(root); });
          bindArea('mp_' + idx, function (v) { s.mesures_proba = v; saveScn(); });
          bindArea('mi_' + idx, function (v) { s.mesures_impact = v; saveScn(); });
        });

        Array.prototype.forEach.call(root.querySelectorAll('[data-rm]'), function (n) {
          n.onclick = function () { var i = parseInt(n.getAttribute('data-rm'), 10);
            if (confirm('Retirer ce scénario ?')) { a.scenarios.splice(i, 1); saveScn(); renderScenarios(root); } };
        });
        Array.prototype.forEach.call(root.querySelectorAll('[data-edit]'), function (n) {
          n.onclick = function () { openScnForm(root, a, actifs, parseInt(n.getAttribute('data-edit'), 10)); };
        });
        el('newScn').onclick = function () { openScnForm(root, a, actifs, null); };
      });
    };
  }

  /* ---------- Formulaire scénario (création / édition) ---------- */
  function openScnForm(root, a, actifs, idx) {
    var editing = (idx != null);
    var s = editing ? a.scenarios[idx] : { nom: '', facteurs: [] };
    // facteurs sélectionnés : set de libellés (snapshots)
    var sel = {};
    (s.facteurs || []).forEach(function (f) { sel[f.libelle] = f; });

    function draw() {
      var h = '<header class="hd"><button class="btn-ic" id="fBack">‹</button>'
        + '<h1>' + (editing ? 'Modifier le scénario' : 'Nouveau scénario') + '</h1></header>';
      h += '<div class="form">';
      h += '<label class="fl">Nom du scénario *<input id="scnNom" type="text" value="' + esc(s.nom) + '" placeholder="ex. Glissade au franchissement du col"></label>';
      h += '<div class="fl">Facteurs déclencheurs * (au moins un)</div>';
      ['humain_orga', 'environnement'].forEach(function (fam) {
        h += '<details class="add" open><summary>' + esc(FAMILLES[fam]) + '</summary>';
        actifs.filter(function (c) { return c.famille === fam; }).forEach(function (c) {
          var on = sel.hasOwnProperty(c.libelle);
          h += '<label class="chk"><input type="checkbox" data-fac="' + esc(c.libelle) + '" data-src="' + c.id + '"' + (on ? ' checked' : '') + '> ' + esc(c.libelle) + '</label>';
        });
        h += '</details>';
      });
      // facteurs "Autre" déjà attachés (source autre) + ajout libre
      var autres = Object.keys(sel).filter(function (k) { return sel[k].source === 'autre'; });
      h += '<details class="add" open><summary>Autre</summary>';
      autres.forEach(function (k) {
        h += '<label class="chk"><input type="checkbox" data-fac="' + esc(k) + '" data-src="autre" checked> ' + esc(k) + '</label>';
      });
      h += '<div class="add-other"><input id="facOther" placeholder="Facteur hors liste…"><button class="btn" id="facAdd">+</button></div>';
      h += '</details>';
      h += '<button class="btn primary block" id="scnSave">' + (editing ? 'Enregistrer' : 'Créer le scénario') + '</button>';
      h += '</div>';
      root.innerHTML = h;

      el('fBack').onclick = function () { renderScenarios(root); };
      // checkbox toggles
      Array.prototype.forEach.call(root.querySelectorAll('[data-fac]'), function (n) {
        n.onchange = function () {
          var lib = n.getAttribute('data-fac'), src = n.getAttribute('data-src');
          if (n.checked) sel[lib] = { libelle: lib, source: src === 'autre' ? 'autre' : parseInt(src, 10) };
          else delete sel[lib];
        };
      });
      el('facAdd').onclick = function () {
        var v = el('facOther').value.trim(); if (!v) return;
        sel[v] = { libelle: v, source: 'autre' };
        draw(); // redraw to show the new "Autre" checkbox checked
      };
      el('scnSave').onclick = function () {
        var nom = el('scnNom').value.trim();
        if (!nom) { alert('Le nom du scénario est obligatoire.'); return; }
        var facteurs = Object.keys(sel).map(function (k) { return sel[k]; });
        if (facteurs.length === 0) { alert('Sélectionne au moins un facteur déclencheur.'); return; }
        if (editing) {
          s.nom = nom; s.facteurs = facteurs;
        } else {
          a.scenarios.push({ nom: nom, facteurs: facteurs, p_initial: '', i_initial: '',
            mesures_proba: '', mesures_impact: '', p_residuel: '', i_residuel: '' });
        }
        a.modifie_le = nowISO();
        put('analyses', a, function () { renderScenarios(root); });
      };
    }
    draw();
  }
  function chip(coul, n) { return '<span class="chip ' + coul + '">' + (n || 0) + '</span>'; }

  function selP(id, val) {
    var opts = '<option value="">P</option>';
    for (var k = 0; k <= 4; k++) opts += '<option value="' + k + '"' + (String(val) === String(k) ? ' selected' : '') + '>P' + k + '</option>';
    return '<select id="' + id + '" class="sel">' + opts + '</select>';
  }
  function selI(id, val, pVal) {
    var dis = (pVal === 0 || pVal === '' || pVal == null) ? ' disabled' : '';
    var opts = '<option value="">I</option>';
    for (var k = 1; k <= 4; k++) opts += '<option value="' + k + '"' + (String(val) === String(k) ? ' selected' : '') + '>I' + k + '</option>';
    return '<select id="' + id + '" class="sel"' + dis + '>' + opts + '</select>';
  }
  function area2(label, id, val) { return '<label class="fl sm">' + esc(label) + '<textarea id="' + id + '" rows="2">' + esc(val) + '</textarea></label>'; }
  function bindSel(id, cb) { var n = el(id); if (n) n.onchange = function () { cb(n.value === '' ? '' : parseInt(n.value, 10)); }; }
  function bindArea(id, cb) { var n = el(id); if (n) n.onblur = function () { cb(n.value); }; }

  /* ---------- Screen 4: catalogue ---------- */
  function renderCatalogue(root) {
    getAll('catalogue', function (cat) {
      var h = '<header class="hd"><button class="btn-ic" id="back">‹</button><h1>Catalogue</h1></header>';
      h += '<p class="note">Modifier le catalogue n\'affecte pas les analyses déjà enregistrées (libellés figés à l\'usage).</p>';
      ['humain_orga', 'environnement'].forEach(function (fam) {
        h += '<div class="cat-fam">' + esc(FAMILLES[fam]) + '</div>';
        var items = cat.filter(function (c) { return c.famille === fam; });
        items.forEach(function (c) {
          h += '<div class="cat-it' + (c.actif ? '' : ' off') + '" data-id="' + c.id + '">'
            + '<span class="cat-lib">' + esc(c.libelle) + (c.actif ? '' : ' (masqué)') + '</span>'
            + '<span class="cat-act">'
            + '<button class="btn-ic" data-ren="' + c.id + '" title="Renommer">✎</button>'
            + '<button class="btn-ic ' + (c.actif ? 'danger' : '') + '" data-tog="' + c.id + '" title="' + (c.actif ? 'Masquer' : 'Réactiver') + '">' + (c.actif ? '🗑' : '↺') + '</button>'
            + '</span></div>';
        });
        h += '<div class="cat-add"><input id="catNew_' + fam + '" placeholder="Ajouter un item…"><button class="btn" data-newfam="' + fam + '">+</button></div>';
      });
      root.innerHTML = h;
      el('back').onclick = function () { go('liste'); };
      Array.prototype.forEach.call(root.querySelectorAll('[data-ren]'), function (n) {
        n.onclick = function () {
          var id = parseInt(n.getAttribute('data-ren'), 10);
          var item = cat.filter(function (c) { return c.id === id; })[0];
          var v = prompt('Nouveau libellé :', item.libelle);
          if (v != null && v.trim()) { item.libelle = v.trim(); put('catalogue', item, function () { renderCatalogue(root); }); }
        };
      });
      Array.prototype.forEach.call(root.querySelectorAll('[data-tog]'), function (n) {
        n.onclick = function () {
          var id = parseInt(n.getAttribute('data-tog'), 10);
          var item = cat.filter(function (c) { return c.id === id; })[0];
          item.actif = !item.actif; put('catalogue', item, function () { renderCatalogue(root); });
        };
      });
      Array.prototype.forEach.call(root.querySelectorAll('[data-newfam]'), function (n) {
        n.onclick = function () {
          var fam = n.getAttribute('data-newfam');
          var inp = el('catNew_' + fam); var v = inp.value.trim(); if (!v) return;
          put('catalogue', { libelle: v, famille: fam, actif: true }, function () { renderCatalogue(root); });
        };
      });
    });
  }

  /* ---------- Export / import ---------- */
  function exportAnalyse(id) {
    tx('analyses', 'readonly').get(id).onsuccess = function (e) {
      var a = e.target.result;
      var blob = new Blob([JSON.stringify(a, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      var nom = (a.entete && a.entete.nom || 'analyse').replace(/[^\w\-]+/g, '_');
      link.href = url; link.download = 'risque_' + nom + '.json';
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      URL.revokeObjectURL(url);
    };
  }
  function importAnalyse(file) {
    if (!file) return;
    var r = new FileReader();
    r.onload = function () {
      try {
        var a = JSON.parse(r.result);
        delete a.id; // nouvel enregistrement
        if (!a.scenarios) a.scenarios = [];
        a.modifie_le = nowISO();
        put('analyses', a, function () { go('liste'); });
      } catch (err) { alert('Fichier JSON invalide.'); }
    };
    r.readAsText(file);
  }

  /* ---------- Boot ---------- */
  openDB(function () { seedCatalogue(function () { render(); }); });
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('./sw.js'); });
  }
})();
