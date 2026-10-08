# Polaris — brief agent

App web de gestion des plannings d'une usine agroalimentaire, multi-site (Le Bignon,
La Vraie Croix). **Réponds en français.**

Ce fichier est le seul chargé automatiquement : il doit suffire pour 90 % des tâches.
Docs plus profondes (à lire **seulement si besoin**) : `ARCHITECTURE.md` (modèle de
données, RLS), `tasks/handoff.md` (détail écran par écran), `tasks/lessons.md` (pièges
rencontrés), `tasks/multi-site.md`, `tasks/todo.md`, `INSTALL.md` / `OPERATIONS.md`.
L'historique des décisions est dans git et dans l'en-tête de chaque migration.

## Stack & emplacements
- `C:\dev\planning-usine` · remote `github.com/jfgautreau/polaris` · branche **main**.
- **Next.js 16** (App Router, RSC + server actions) · React 19 · TypeScript · **Supabase**
  (Postgres + Auth + RLS) · **Vercel** (push `main` → build auto, région `cdg1`).
- Scripts : `npm run dev` · `npm run build` · `npm test` (Vitest). Sur ce poste (Windows ARM),
  Turbopack est indisponible : `npx next build --webpack`.

## Règles de travail (non négociables)
1. **Build avant tout commit.** Pas de config ESLint : le build ne signale PAS le code
   devenu inutile — nettoie à la main ce que tu retires.
2. **Commit + push sur `main` après chaque tâche terminée**, sans redemander. Message en
   français, style conventional commit. Trailer
   `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Pas de branche ni de PR.
3. **Auteur git = `jf.gautreau@gmail.com`** — jamais d'email no-reply (bloque Vercel Hobby).
4. **Repo GitHub PUBLIC.** INTERDIT de commit des données sensibles : dumps SQL, `.env`,
   exports réels (matricules, noms, absences…). Vérifier la staging list avant tout
   `git add -A`, refuser tout fichier > 100 Ko non légitime. Les scripts jetables
   (lecture de `SUPABASE_SERVICE_ROLE_KEY`, UUID en dur) vivent **hors du repo**
   (scratchpad) ; `.gitignore` bloque `_tmp_*`, `scratch_*`, `inject_*`, dumps, `.env*.local`.
5. **Base de données : jamais de DDL par l'agent.** Écrire la migration dans
   `supabase/migrations/` et **demander à l'utilisateur de l'exécuter** dans le SQL Editor.
   Pour de la *donnée* seulement, un script Node lisant `SUPABASE_SERVICE_ROLE_KEY` de
   `.env.local` est acceptable (simulation d'abord, écriture après accord).
   Projet Supabase : ref `stcxlsmmnplxpirrnefm`, eu-west-3.
   **Dernière migration appliquée : `0081`** (visite : médecin / infirmière cumulables). Toute nouvelle policy RLS s'écrit
   `site_id = (select public.current_site_id())` (forme InitPlan, calculée une fois par
   requête) — idem pour `is_admin()`, `has_role('x')`, `auth.uid()`.
6. **PowerShell 5.1** : message de commit multi-lignes via here-string `@'…'@` (le `'@`
   en colonne 0) ou `git commit -F`. **Jamais** `Get-Content`/`Set-Content`/`Out-File`
   pour éditer un fichier source accentué (mojibake + BOM) : outil Edit ou Node.
7. **Toute lecture Supabase pouvant dépasser 1000 lignes passe par `fetchAll()`**
   (`src/lib/fetch-all.ts`) : PostgREST tronque à 1000 **sans erreur**. Concernées :
   `matrice`, `personne_competence`, `placement`, `ouverture_quart`, `contrat_periode`.
   La fabrique pose un `.order()` déterministe (clé composite pour `ouverture_quart` /
   `jour_quart`, sans `id`).

## Sécurité / permissions
- **Deux couches à ne pas confondre** :
  - **A — matrice de modules** : `role_permission` surcharge `defaultsFor()`
    (`src/lib/permissions.ts` : `MODULES`, `canRead`, `canWrite`, `requireModule`).
  - **B — périmètre RLS** : `can_edit_personne()` = admin **ou** chef de l'équipe de la
    personne.
- `canWriteModule(role, mod)` renvoie **toujours `false` pour `chef_equipe`** : le chef reste
  dans son périmètre. En API : écriture « complète » → `getAdminClient()` (bypass RLS) ;
  sinon `getServerClient()` (RLS). Jamais le client admin pour un chef d'équipe.
- **Aucun `role === "admin"` en dur** : la matrice décide seule (`routes-gardees.test.ts`
  échoue sinon). Un droit accordé à l'écran doit fonctionner.
  - Server actions / routes de paramétrage → `requireModuleWrite(mod)` ; variante route API
    `moduleWriteGuard(mod)`. Une route qui écrit dans une table de paramétrage ne se
    contente **jamais** de `getServerClient()` (RLS à rôles en dur → 403 silencieux).
  - `placement` est écrite par Planning **et** Placement → `canWritePlacementData()`.
- **Anti-escalade** `droitsCouvertsPar(role, appelant)` : on ne donne pas ce qu'on n'a pas.
  Les routes `/api/users/*` passent par `userAdminGuard({ cibleUserId, roleVise })` (droit +
  escalade dans les deux sens + cible bornée au site de l'appelant). `/api/users/create`
  pose `user_metadata.site_id`.
- **`/api/droits`** : `verifierChangementDroit()` (testée), rôle validé contre
  `getAllRoles()` ; verrous : pas ses propres droits, rôle tout-puissant non modifiable,
  pas d'accord au-dessus de son niveau. Refus serveur → la cellule revient à sa valeur et
  le message s'affiche.
- **Site courant = `getCurrentProfile().siteId`**, conscient de l'impersonation (cookie
  signé ; le header `x-impersonate-site` est absent sur `/api/`). Toute écriture
  site-scopée utilise ce `siteId`. `getCurrentProfile` lit sa ligne en service_role.
  `app_user` sans `site_id` ou compte `is_active = false` → pas de profil.
- **Isolation multi-site** : toutes les tables de paramétrage sont site-scopées
  (`site_id NOT NULL`, aucune ligne partagée) ; un nouveau site copie les référentiels d'un
  site source (`copierReferentiels()`). Toute écriture pose `site_id` explicitement, même
  en service_role. Tout UUID de rattachement venu du client et écrit en service_role est
  validé par `verifierIdSite()` / `verifierFksSite()` (`src/lib/verifier-site.ts`).
- Les écrans de réglage s'ouvrent en **lecture** (`<LectureSeule>` = `fieldset disabled`) ;
  seul Placement exige `write`.
- Rôles intégrés : `admin`, `chef_equipe`, `ordo`, `rh`, `codir`, `planning`. Rôles
  personnalisés (`role_custom`, `getAllRoles()`) : naissent sans aucun droit.
- Routes publiques (`src/proxy.ts`) : `/login`, `/forgot`, `/reset`, `/auth/*`, `/affichage/*`.
  Le proxy vérifie le jeton par `getClaims()`.
- **Mot de passe** : jamais choisi par l'admin ; `/admin/users` génère un **lien**
  `{base}/reset?token_hash=…` (`src/lib/password-link.ts`) — ne pas revenir à `action_link`.
- **RGPD** (export / anonymiser / supprimer) : droit dédié `rgpd`, distinct de `personnel`.
- **Visites médicales** : deux droits, `visites` (écran de suivi) et `visites_param`
  (déclencheurs), accordés au rôle `rh` par défaut et **à personne d'autre**. Aucune
  donnée de santé en base : dates, type de visite, et `avis` borné par CHECK à
  quatre valeurs. Seule chose qui sorte du module : l'avertissement du Placement,
  **sans motif** (cf. `src/lib/visites-placement.ts`) — les quatre cas partent
  **éteints** (module vide = tout le monde en défaut), les RH les allument.

## Modèle métier — invariants et pièges
- **« Atelier » (code) = « Service » (UI).** `atelier` partout dans le code et la base ;
  **jamais « atelier » dans une chaîne visible**.
- **Quart ≠ Équipe.** Les équipes tournent sauf `equipe.quart_fixe`. **Rotation par
  référence datée** (`rotation_reference`, `src/lib/rotation.ts`) : on saisit le quart de
  chaque équipe pour UNE semaine, la suite est calculée ; changer = ajouter une référence
  (le passé n'est jamais recalculé). Quarts composant le cycle = `quart.rotation`.
- **Quarts : aucun code en dur** (`src/lib/quarts.ts`, test statique). Le `code` d'un quart
  est figé à la création et **peut ne plus correspondre au libellé** (La Vraie Croix : code
  `matin` = « Jour »). Ne JAMAIS déduire la sémantique du code : lire `creneau`
  (`matin`/`aprem`/null), `ordre`, `libelle`.
  - `quartParDefaut` = quart de `creneau = "matin"` ; placement sans `quart_code` = quart
    par défaut (`quartOuDefaut`, `memeQuart`).
  - `quartJournee` = quart sans créneau au plus petit `ordre` (pleine journée). Son
    activation (`jour_quart`) est **dérivée** = OU des quarts tournants du jour, maintenue
    par `/api/ordonnancement/quart` et `/reset-week`.
- **`poste_quart` = cycle et effectif PAR quart** (`src/lib/poste-quart.ts`, seul lecteur) —
  trois états : **aucune ligne** = tourne, effectif = `poste.effectif_requis` (colonne
  dépréciée, repli seulement) ; **`actif=false`** = « – », **ne tourne pas** ;
  **`actif=true`** = tourne, effectif 0 (« tourne à 0 », distinct de « – ») ou N.
  Helpers `tourneSurQuart`, `effectifSurQuart`, `quartsDuPoste`, `chargerPosteQuart`.
- **Ouverture / fermeture datée** (`ligne`/`poste`.`date_ouverture`/`date_fermeture`) :
  `actifLe(x, iso)` (`src/lib/referentiel-validite.ts`), évalué à aujourd'hui ; `actif` reste
  le coupe-circuit. Masque Planning, Placement, Ordonnancement et Bilans.
- **Ouverture des lignes (Ordonnancement)** — deux canaux distincts :
  - `jour_quart` = **visibilité du jour** : absent / inactif ⇒ colonne fermée « Jour sans
    production — pour l'activer, contacter l'ordo », aucune saisie.
  - `ouverture_quart` = **besoin** : `ouverte = false` ⇒ besoin 0, la ligne **reste visible
    et plaçable** (tuile « X/0 · fermée par ordo »).
  - Fermer un quart / réinitialiser une semaine portant des affectations → 409
    `{ conflit, affectes }`, puis « … quand même et retirer » (`force: true`).
- **Cycle de vie du personnel** : `personne.statut` ∈ `A_VENIR | ACTIF | PARTI` est un
  **cache calculé par trigger** depuis `contrat_periode` (seule source : arrivée = MIN
  début, départ = MAX fin si tout est fermé, motif = `motif_fin` du dernier). Helpers
  `src/lib/personne-statut.ts` (`statutALaDate`, `estAuTravailLe`, `contratCouvreLe`,
  `motifInactivite`).
- **Temps partiel** : `tp_config` (jsonb `demi`/`off`/`horaires`) + périodes `tp_periode`.
  « TP » s'écrit quand la **journée entière** est off, **ou** quand l'équipe est, cette
  semaine, sur le **créneau** que la personne ne fait pas (TP une semaine sur deux, piloté
  par la rotation). Le créneau d'un quart vient de `quart.creneau`. TP **matérialisé** :
  `placement.tp` + `tp_charge` (semaine « chargée » = le calcul virtuel s'éteint).
  Les demi-journées de `tp_config` (`matin`/`aprem`) sont un vocabulaire de créneau, pas
  des codes de quart.
- **Planning : deux masquages de case distincts** — `tpBlocked` (violet, « TP ») et
  `horsEffectif` (gris, hors contrat). Ne jamais recycler l'un pour l'autre.
- **Habilitations** : `competence` × `personne_competence`. `date_expiration` est stockée à
  la saisie : afficher avec repli `addMonthsIso(date_obtention, duree)`
  (`src/lib/habilitations.ts`). Rouge < 30 j · orange 30-90 j · vert > 90 j.
  Exigences d'un poste : `poste_competence_requise` ; placer sans elles demande
  confirmation (forçage tracé `placement.forcage_*`), le rouge est recalculé à l'affichage.
- **Poste** : `categorie` ∈ manager/conducteur/operateur (source des bilans ;
  `est_conducteur` déprécié, jamais lu) ; `remplacable=false` = **PTNR** (un seul titulaire
  par conception : exclu des fragilités, isolé dans les rapports, sans effet sur le
  planning) ; `imprimable=false` = masqué des PDF de placement seulement ;
  `numero_rotation` = texte « 12, 15-17 » (`parseNumeros()`), place mémorisée dans
  `placement.numero_rotation`.
- **Poste fixe** (`personne.poste_fixe_id`) : même donnée que la colonne « Titulaire » du
  Référentiel (plusieurs titulaires par poste, un seul poste fixe par personne).
  **Libéré automatiquement au départ** (trigger 0078 : statut → PARTI ⇒ `poste_fixe_id = null`).
- **Intérim** : piloté par `type_contrat.avec_agence` (intérim, CDI intérimaire…) → champ
  Agence, surlignage jaune (`styleInterim` / `estAvecAgence`, `getTypesAgenceC()`),
  Synthèses. `estInterim()` (code INTERIM littéral) sert seulement à l'alerte légale 18 mois
  (`date_livret_accueil + 18 mois`).
- **Absences longues** (`absence`) matérialisées en `placement` (un par jour,
  `placement.absence_id`). Les périodes affichées sont **reconstruites depuis les jours**
  (`src/lib/absences-periodes.ts`) : la plupart sont saisies au Planning sans période.
- **Horaire affiché** : exception ponctuelle > temps partiel > standard, par source
  (`src/lib/horaires.ts`, partagé TV / Synthèses) ; une exception saisie d’un seul côté
  complète la borne manquante par le temps partiel, sinon le standard du poste.
- **Séquences « effacer puis réécrire »** → fonction SQL (`set_rotation_reference`,
  `creer_absence`, `maj_absence`), jamais deux requêtes applicatives.

## Écritures de placement (Planning, Placement, pré-remplissage)
Routes `/api/placement/{cell,move,copy,prefill,reset-week}` ; helpers partagés dans
`src/lib/placement-helpers.ts` pour que saisie et déplacement ne divergent pas.
- **Unicité `(personne_id, jour)`** : `/cell` fait un upsert qui remplace poste, absence, NT ou TP.
  Un écran qui ne montre pas la case de la personne (vue Par poste) envoie **`proteger: true`** :
  refus 422 si la ligne existante est une absence / NT / TP, et un retrait ne supprime que le
  placement sur `poste_attendu`.
- **Le cycle du poste décide du quart.** Aucun poste sur un quart où il ne tourne pas :
  `/cell` et `/move` refusent en **422** (`posteNeTournePas`) ; `/copy` ne recopie pas
  (`horsCycle`). ⚠️ Au Placement, **409 = « déjà placé sur un autre quart »** (modale
  « placer quand même ») : ne pas réutiliser 409 pour autre chose.
- **Personne partie / hors effectif** (`motifInactivite`) : aucune affectation un jour
  qu'aucun contrat ne couvre (sans contrat : statut PARTI). 422 (`refusInactivite`) ;
  `/copy` compte `inactives`. **Retirer** une affectation reste toujours permis.
  Fin de contrat saisie **après** coup : Cycle de vie liste les affectations à venir hors
  contrat (poste / NT / TP, absences gardées) et propose de les retirer sur confirmation
  (`/api/personnel` ops `hors-contrat-list` / `hors-contrat-retirer`, droit Planning ou Placement).
- **Pré-remplissage « TP + pré-affectation »** (bouton par semaine du Planning,
  `/api/placement/prefill`) : TP matérialisés **puis** postes fixes, lundi→vendredi, sans
  jamais écraser (`ignoreDuplicates`). Quart d'un titulaire = `quartPourPosteFixe` :
  quart de l'équipe s'il fait partie du cycle du poste ; Journée pour un poste de Journée
  seule ; sinon **non placé et signalé** (`nonPlaces`, affiché dans l'alerte). Affectation
  automatique : ne force jamais une habilitation manquante (non placé).
- **Numéro de rotation** : `/cell` prend la 1ʳᵉ place libre **seulement si `numero` est
  absent** de la requête (Planning) ; le Placement envoie toujours `numero` (`null` =
  volontairement hors numéro).
- **Copie** (Placement) : postes du quart affiché, tout le site ; **ne touche jamais une
  ligne sans poste** du jour cible (absence, NT, TP). « Compléter » saute aussi les déjà
  placés ; « Écraser les affectations » ne supprime personne.
- **Glisser-déposer** (Planning) : `/move` déplace poste / NT / TP réel vers une case
  **vide** (409 si occupée), insertion cible avant suppression source, habilitation de la
  personne d'arrivée → 428 + forçage.
- **Placés hors plan** (Placement) : une personne placée sur ce quart sur un poste
  qu'aucun plan ne dessine (ne tourne pas, désactivé, fermé, service inactif) ou absente
  de la liste chargée (partie, hors effectif) est **toujours affichée** : en tête de liste,
  statut orange « ⚠ poste — raison », bandeau de décompte (`horsPlan`, calculé par
  `placement/page.tsx`). Pendant une recherche, « Masquer les placés » ne s'applique pas.

## Conventions UI (réutiliser, ne pas réinventer)
- **Écrans grille** (Matrice, Personnel, Planning, Habilitations, Ordonnancement) :
  `.pagecol` (100dvh, seule la grille défile) · `.headband` (+ `.hb-l1` titre · recherche ·
  fin, `.hb-l2` actions · filtres) · `.gridband` (pleine largeur ; `.scroll` + `grow` si
  plusieurs cartes). Les rapports Bilans et `/matrice/bilan` restent à 1500 px (imprimables).
- **Hauteur de rangée unique** `--grid-row-h: 32px` (`persongrid --row-h`,
  `.pers-table tbody td`, `.pcell`, `.rowh`) ; Référentiel : `.refpostes` / `.refhead`.
- **Grille personnes × colonnes** (Matrice, Habilitations) : `persongrid.module.css` +
  `usePersonGrid()` (virtualisation des lignes, croix de survol peinte dans le DOM). Ne pas
  la dupliquer. Panneau d'en-têtes en `overflow-y: scroll` (sinon décalage de 15 px).
- **Écrans de paramétrage** (référence `/admin/motifs`) : icônes SVG de
  `src/components/icons.tsx` (jamais d'emoji sur fond coloré) ; boutons `.iconbtn`
  (`.edit`, `.save`, `.ok`, `.del`, `.ghost`) ; colonne « Actif » via `<ActifCheckbox>`
  (`keyName="code"` si la PK n'est pas `id`) ; édition inline colonne par colonne (inputs
  reliés par `form=`) ; réglage simple = auto-save débouncé 500 ms via route API.
- **Modales** : TOUJOURS `<ModaleDeplacable>` avec un élément `.mdd-drag`.
- **Info-bulles et popovers** dans une zone `overflow: auto` : `position: fixed`, coordonnées
  depuis `getBoundingClientRect`, fermeture au scroll extérieur seulement
  (`<InfoBulle>`, `openPop` / `popStyle` d'`AbsencesModal`).
- **Filtres** : `.filterrow` + segments, navigation en `useTransition`, portés par l'URL
  (recherche débouncée). **Report entre écrans** par le menu (`src/components/MainNav.tsx`,
  table `ECRANS`) : recherche, équipe (deux dialectes traduits), service (`service` au
  Personnel, `atelier` ailleurs), quart. **Mémoire de session** (cookies,
  `src/lib/filtres-session.ts`) : dernier quart, dernier plan de Placement — toujours
  revalidés contre le site. Bilans : le Cockpit transmet service + quart avec un bandeau
  « Filtres repris ».
- **Composants partagés** : `SlideSwitch` (entre deux vues, largeur fixe) ≠ `ToggleSwitch`
  (actif/inactif) · `AtelierEquipeFiltres` · `LectureSeule` · `PageTitle` · `PrintButton` ·
  `DateRangePicker` (logique `src/lib/calendrier.ts`) · `BandeauErreur` · `InfoBulle`.
- **Pièges CSS globaux** : `button` impose `color` blanc (poser `color` sur un bouton clair)
  et `margin-top: 18px` (annuler par `margin: 0` dans une rangée d'icônes) ; `.navlink`
  porte un padding qui casse une taille fixe. Boutons icône côte à côte :
  `boxSizing: border-box`, `padding: 0`, `margin: 0`, `lineHeight: 1`.
- **Pièges React** : ne jamais définir un composant dans un autre (perte de focus) ; un
  `<select>` contrôlé ne se sérialise pas de façon fiable dans un `<form action>` → poster
  en JSON ; jamais d'`<input type="color">` (palette de pastilles) ; ne pas cibler un libellé
  par `:first-of-type`.
- **Intérim = jaune** (`INTERIM_BG`), vert réservé à « aujourd'hui » sur la TV.
- **Impression** : `@page` A4 paysage + `.noprint` dans `globals.css` ; faire tenir une page
  par `transform: scale()` mesuré (jamais `zoom`), cible de hauteur **plus courte** que la
  feuille (`ajusterFeuille`, `PAGE_H`). Tableaux imprimés multi-pages : `print-flow`,
  `sticky` neutralisé.
- **Erreurs d'écriture** : toujours lire l'erreur (`ecritures-verifiees.test.ts`) ;
  `messageErreur()` / `messageRefusPerimetre()` (`src/lib/erreurs.ts`) ; server actions →
  `?err=` + `<BandeauErreur>`. Sur refus : revenir à la valeur enregistrée et afficher le
  message, jamais un « Échec » muet.
- `prefetch={false}` sur tout lien répété en liste. Ne pas rogner les libellés.

## Performance — règles à préserver
- **Mémo par requête = `parRequete(fn)`** (`src/lib/par-requete.ts`), pas `cache()` : le
  `cache()` de React ne mémorise rien hors rendu (routes API). Déjà appliqué à
  `getServerClient`, `getCurrentProfile`, `getCurrentSite`, `getPermissions`, modules masqués.
- **Pas d'`await` en série sur des lectures indépendantes** : `Promise.all`, ou `enAvance()`
  (`src/lib/en-avance.ts`) pour lancer tôt et attendre plus tard. Dans les routes, les
  contrôles partent ensemble et les verdicts sont examinés dans l'ordre.
- **`fetchAll`** lit par vagues parallèles de 8 tranches (testé).
- **Données de référence** : `src/lib/refdata.ts` (`unstable_cache` par site, argument
  `site` obligatoire). Toute écriture dans une table référencée appelle
  `updateTag(TAG)` (`ATELIERS_TAG`, `EQUIPES_TAG`, `QUARTS_TAG`, `MOTIFS_TAG`, `NIVEAUX_TAG`,
  `NB_NIVEAUX_TAG`, `SEUIL_COMPETENT_TAG`, `ROTATION_TAG`, `TYPES_AGENCE_TAG`).
- **Socle** : profil + site en une requête ; `getAdminClient()` = client unique (sans
  session) ; `AppHeader` en `Promise.all`, compteur d'alertes en cache 60 s par site.
- **Cache navigateur** : `staleTimes.dynamic = 30` + `GardeCacheNavigation` (après toute
  écriture, une page mise en cache avant est rechargée complètement).
- **React Compiler** en mode opt-in (`"use memo"`, `next.config.ts`) : actif sur
  Personnel (`PersonnelEditor` + `LignePersonne`) et Planning (`PlanningGrid` +
  `LignePlanning`). Motif : ligne extraite et `memo`, props stables (valeurs en chaînes,
  sélection passée seulement à la ligne concernée, `ctx` en useMemo, actions d'identité
  constante via `useState` à initialiseur + ref « dernière version »). Le compilateur
  **renonce en silence** si : `eslint-disable` des hooks dans le fichier ; `try … finally`,
  `throw` ou `?? ?. ||` DANS un `try/catch` (sortir le réseau dans des fonctions de module
  qui ne lèvent pas) ; `useMemo(…, [])` non préservable ; `x++` capturé dans une lambda ;
  `[ternaires…].join() || …` en JSX ; fonction utilisée avant sa déclaration. **Vérifier**
  après build : `react.memo_cache_sentinel` dans `.next/static/chunks/app/<écran>/page-*.js`.
  Aussi `PlanningParPoste`. Prochain candidat : `PlacementBoard`.
- Acquis : `loading.tsx` sur tous les gros écrans ; options de `<select>` du Planning
  construites à l'ouverture ; bilan Matrice agrégé en une passe.

## Écrans — repères
- **Planning** (`src/app/planning/`) : 3 semaines, la choisie à gauche puis S+1, S+2. Filtres
  Quart / Service / Équipe (mode AUTO = équipes du quart ∪ personnes réellement placées sur
  ce quart). Bandeau de rappel du quart (`QuartBandeau`, couleur `quart.couleur`, gris en
  AUTO). Bascule **Suivre le quart / Suivre l'équipe** (`?vue=equipe`, une équipe
  tournante exigée) : chaque semaine prend le quart de l'équipe (`Jour.quart`, groupes
  et effectifs **par semaine** dans la grille ; bande de quart colorée par semaine en tête,
  `BANDE_H` décale tous les en-têtes figés) ; `»` écrit chaque jour sur son quart et
  saute un poste hors cycle. Jours de semaine toujours affichés (jour fermé = message fusionné). Bascule
  Conducteurs (`?cond=1`). Pendule 🕐 (horaire + commentaire, `horaire_exception`),
  recopie `»`, glisser-déposer, croix de survol. Le bouton de pré-remplissage recharge la vue.
  Bascule **Par nom / Par poste** (`?par=poste`, `PlanningParPoste.tsx`, règles pures
  `src/lib/planning-par-poste.ts`, spec `tasks/planning-par-poste.md`) : une rangée par place
  (attribution stable : n° de rotation > continuité > 1re place libre > surnombre), un seul quart,
  saisie au clic (candidats triés, `»` jusqu'à la fin de semaine, Remplacer / Retirer), postes
  `zone_attente` (0077) repliés « N à répartir ». Ces postes « en attente » sont **hors
  matrice** : absents de la Matrice (colonnes, « sans compétence », Conducteurs), de son
  bilan, du Cockpit, de Polyvalence & compétences et d'Assez de compétences ? (pas de la
  Feuille de route).
- **Placement** (`src/app/placement/`, droit `placement`) : plan par ligne → postes → cases
  numérotées, rangs en 1 à 3 colonnes (au-delà de 10 par colonne). Bascule Plan /
  Absences. `JourNav` (calendrier grisant les jours sans quart actif). Filtres de la liste
  (recherche, équipe) dans l'URL. Deux PDF : **PDF Manager** (A4, plan en couleurs + absents / TP du jour,
  ex-« PDF CE ») et **PDF** opérateurs (A3, plan seul, codes d'alerte en noir) ; sur les deux, les lignes qui tournent (≥ 1 personne placée) prennent la couleur fixe de leur ligne (`ligne.couleur`, 0082, choisie au Référentiel dans la palette fermée `src/lib/ligne-couleurs.ts`), celles à l'arrêt restent grisées ; en-tête service ·
  quart (pastille centrée) · date, hors zone mise à l'échelle ; numéros vides et commentaires du jour imprimés ; filtre
  `imprimable`. TP du jour sans placement = carte « Temps partiel », pas « à placer ».
  Postes `zone_attente` (CDT) : hors du plan, colonne « À répartir » entre le plan et les noms
  (dépôt et glisser-déposer comme une tuile) ; les PDF suivent seulement « Impr. ».
- **Ordonnancement** (`src/app/ordonnancement/`) : quinzaine (`?debut=`), sous-colonnes par
  quart tournant, ligne « Activation », lignes par service, Journée à part (activation
  dérivée) ; une ligne ne tournant sur aucun quart posté n'apparaît qu'en Journée.
  `weekDays()` ne pose pas `firstOfWeek` : la page le remet. Semaine type = même trame sur
  7 jours.
- **Personnel** (`src/app/personnel/`) : édition inline (casse normalisée par `noms.ts`),
  Contrat et Statut = résultantes ouvrant `CycleDeVieModal` ; fiche incomplète = aucun
  contrat ou agence manquante ; engrenage unique (commentaire, poste fixe, RGPD) ;
  recherche multi-colonnes ; filtres dans l'URL.
- **Matrice** (`src/app/matrice/`) : charge tout l'effectif, `displayedIds` = sous-ensemble
  par défaut, la recherche balaie tout ; colonnes bornées au service. Cible qui suit
  l'actuel si elle y collait, sinon `cible ≥ actuel`. Pastille « sans compétence » (aucun
  niveau ≥ 1 nulle part, calcul serveur). Filtre au clic sur un en-tête.
- **Habilitations** (`src/app/habilitations/`) : même principe de recherche transverse ;
  bilan sur le sous-ensemble affiché ; saisie au clic sur une pastille ; filtre au clic sur
  un en-tête.
- **Référentiel** (`src/app/admin/referentiel/`, `/api/referentiel`) : colonnes N° rot,
  Habil. requises, Rempl. (PTR/PTNR), Impr., Attente (`zone_attente`, 0077), Titulaire, effectif par quart (vide « – » / 0 /
  N), Ouvre / Ferme le, Regroup., Couleur de ligne (PDF du Placement) Noms de poste / nom court / ligne **uniques par site**
  parmi les actifs (409) ; erreurs en toast fixe bas-centre.
- **Absences** (module `absences`, `src/app/absences-specifiques/`) : périodes reconstruites
  depuis les jours ; édition inline ; filtres synchronisés à l'URL.
- **Bilans** (`src/app/bilans/`, liste `src/lib/bilans-rapports.ts`) : Cockpit + rapports
  imprimables (bouton « PDF »). Feuille de route (24 semaines × service × catégorie ;
  besoin = somme simple des quarts, **journée comprise** ; besoin actualisé par
  l'ordonnancement ; Total = titulaires tenant ≥ 1 poste de la catégorie, intérim à part).
  Assez de compétences ? (affectation optimale par jour, besoin additif). Polyvalence &
  compétences (couverture opérationnelle niveau_min + habilitation ; verdict de fragilité
  sur la relève globale). Synthèses (absences sur 4 semaines, intérim par agence). PTNR
  exclus des fragilités.
- **Affichage TV** (`src/app/affichage/`, public) : rattachement par service d'affectation ;
  sections Matin / Après-midi / Nuit classées par `creneau` ; fenêtre relative ou absolue
  (`getFenetreAffichage`, `joursDeFenetre`) ; PDF A3 portrait multi-pages.
- **Visites médicales** (`src/app/visites/`, droit `visites`) : deux écrans seulement,
  Suivi et Paramètres — pas de troisième. Le **régime** (`simple` / `adapte` / `renforce`)
  n'est jamais saisi : il est **calculé** (`src/lib/visites.ts`, pur et testé ;
  `visites-data.ts` pour les lectures) à partir des quarts de nuit, des postes tenus
  (titulaire **ou** N placements sur M semaines) et des habilitations détenues — le plus
  exigeant l'emporte, et l'écran dit toujours *pourquoi*. Les plafonds sont des **maxima**
  (`MAX_LEGAL`) : une valeur au-delà passe mais s'affiche en rouge ; une `prochaine_date`
  fixée par le médecin l'emporte si elle est plus proche. **ANCI** (attestation de non
  contre-indication) : un *usage* (`visite_anci_usage`, conduite / électrique) est **exigé**
  par un poste ou une habilitation et **délivré** par une visite — c'est ce qui distingue
  deux visites simples. Reprise : seuil en jours **calendaires** sur les motifs cochés.
  Intérim **exclu** (suivi par l'agence, R4625-8). Pas de date de naissance, donc pas de
  visite de mi-carrière. Paramétrage (`/admin/visites-param`, droit `visites_param`) :
  régimes, déclencheurs (quarts / postes / habilitations / motifs), catalogue, alertes —
  **séparé de Param. RH**, ce sont deux métiers.
- **Param. RH** (`/admin/motifs`, droit `motifs`) : motifs (code GT, planifié ou non),
  agences, types de contrat (`avec_agence`), fenêtre d'affichage TV, import des absences RH
  (`src/lib/import-absences-rh.ts`).
- **Plateforme** (super_admin, `src/app/platform/`) : sites, impersonation, masquage par
  site (`site_module` : menus, `guide`, rapports `bilan:<slug>`).

## Carte des fichiers (socle)
- `src/lib/` : `permissions`, `roles(-server)`, `current-user`, `current-site`,
  `supabase-server`, `par-requete`, `en-avance`, `fetch-all`, `refdata`, `site-modules`,
  `verifier-site`, `quarts`, `poste-quart`, `referentiel-validite`, `rotation`,
  `personne-statut`, `placement-helpers`, `habilitations`, `horaires`, `interim`, `week`,
  `calendrier`, `numeros-rotation`, `absences-periodes`, `erreurs`, `noms`, `parametres`,
  `filtres-session`, `bilans-rapports`, `*-data` (données des bilans), `visites`
  (règles pures), `visites-data` (lectures de l'écran Suivi), `visites-placement`
  (avertissement sans motif).
- `src/components/` : `AppHeader`, `MainNav`, `GardeCacheNavigation`, `icons`,
  `ModaleDeplacable`, `InfoBulle`, `usePersonGrid`, `persongrid.module.css`, composants
  partagés listés plus haut.
- Guide utilisateur : `public/guide.html` (lien dans `UserMenu`).

## Tests (Vitest)
Règles pures (`src/lib/*.test.ts`) + tests statiques de garde : `routes-gardees` (toute route
API a une garde, aucun rôle en dur), `routes-multi-site` (INSERT/UPSERT site-scopé avec
`site_id`), `refdata-cache` (`unstable_cache` avec argument `site`), `admin-client` et
`isolation-site` (en service_role, chaque lecture/écriture site-scopée bornée par
`.eq("site_id", …)`), `ecritures-verifiees` (erreurs d'écriture lues), tests interdisant
codes de quart en dur, `est_conducteur` et `equipe_quart_semaine`. `vitest.config.ts`
résout l'alias `@/`.
