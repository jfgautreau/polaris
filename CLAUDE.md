# Polaris — brief agent

App web de gestion des plannings d'une usine agroalimentaire. **Réponds en français.**

Ce fichier est le seul chargé automatiquement : il doit suffire pour 90 % des tâches.
Docs plus profondes (à lire **seulement si besoin**) : `ARCHITECTURE.md` (modèle de
données, RLS), `tasks/handoff.md` (détail écran par écran), `tasks/lessons.md`
(pièges déjà rencontrés), `tasks/multi-site.md` (chantier multi-tenant),
`tasks/todo.md` (reste à faire), `INSTALL.md` / `OPERATIONS.md`.

## Stack & emplacements
- `C:\dev\planning-usine` · remote `github.com/jfgautreau/polaris` · branche **main**.
- **Next.js 16** (App Router, RSC + server actions) · React 19 · TypeScript · **Supabase**
  (Postgres + Auth + RLS) · déploiement **Vercel** (push `main` → build auto, région `cdg1`).
- Scripts : `npm run dev` · `npm run build` · `npm test` (Vitest).

## Règles de travail (non négociables)
1. **`npm run build` avant tout commit.** Le build échoue sur les erreurs TS/ESLint
   (imports et variables inutilisés inclus) — nettoie ce que tu retires.
2. **Commit + push sur `main` après chaque tâche terminée**, sans redemander.
   Message en français, style conventional commit. Trailer
   `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Pas de branche ni de PR.
3. **Auteur git = `jf.gautreau@gmail.com`** — ne jamais forcer un email no-reply
   (bloque les déploiements Vercel Hobby).
4. **Repo GitHub public** (`github.com/jfgautreau/polaris`) — décidé le
   2026-08-19, cf. mémoire [[repo-github-public]]. **INTERDIT** de commit
   des données sensibles : dumps SQL prod, `.env`, exports contenant des
   matricules/noms/emails/absences réels. Avant tout `git add -A`, vérifier
   la staging list et refuser tout fichier > 100 Ko dont le contenu n'est
   pas légitime au repo. `.gitignore` bloque `backup*.sql`, `*.pgdump`,
   `dump-*.sql`, `pg_dump-*.sql`, `.env*.local` **et les scripts jetables**
   (`_tmp_*.js`, `_tmp_*.ts`, `scratch_*.js`, `scratch_*.ts`, `inject_*.js`).
   Ces scripts d'injection ponctuelle lisent `SUPABASE_SERVICE_ROLE_KEY` et
   portent souvent des UUID de site en dur — ils ne doivent JAMAIS atterrir
   dans le repo public (audit S1, 2026-09-10). Cf. [[interdit-donnees-sensibles]].
5. **Base de données : jamais de DDL par l'agent.** `SUPABASE_DB_URL` est vide et le
   MCP Supabase pointe sur un autre compte. Écris la migration dans
   `supabase/migrations/` et **demande à l'utilisateur de l'exécuter** dans le SQL Editor.
   Pour de la *donnée* seulement, un script Node lisant `SUPABASE_SERVICE_ROLE_KEY`
   de `.env.local` est acceptable.
   Projet Supabase : ref `stcxlsmmnplxpirrnefm`, eu-west-3. **Dernière migration appliquée : `0069`** (socle multi-site : `0043`–`0048` ; cycle de vie : `0049`–`0050` ; `parametre_affichage` multi-site : `0051` ; TP périodes : `0052` ; séparation totale des référentiels par site — `motif_absence`, `type_contrat`, `role_custom`, `role_permission`, `competence`, `competence_niveau_libelle`, `quart` tous en `site_id NOT NULL` : `0053` ; commentaire libre sur `personne_competence` : `0054` ; `app_user`/`audit_log` strictement scopés au site courant, retrait du passe-droit `OR is_super_admin()` : `0055` ; table `site_module` — masquage d'éléments par site depuis `/platform` : `0056` ; colonnes `quart.rotation` (quarts composant le cycle de rotation, explicites) + `quart.creneau` (`matin`/`aprem`/null, demi-journée pilotant le TP — fin du matin/apres_midi codé en dur) : `0057` ; `site_id` sur `tp_periode`, oubliée du lot 0053 alors que le code y écrivait déjà — provoquait « Could not find the 'site_id' column of 'tp_periode' » à l'enregistrement d'un temps partiel : `0058` ; `poste.remplacable` (PTR/PTNR — un PTNR est exclu des rapports de fragilité/relève et isolé dans les Compétences critiques) + `personne.poste_fixe_id` (poste fixe : pré-remplissage du planning via le bouton « Pré-remplir postes fixes » → `/api/placement/prefill`) : `0059` ; `motif_absence.non_planifie` (classification planifié/non planifié des absences, cochée dans `/admin/motifs` — source de vérité du rapport Absentéisme, repli sur l'heuristique de libellé tant que non renseigné) : `0060` ; `site.nb_niveaux` — nombre de niveaux positifs activés par site, 2..4, réglé dans `/admin/competences` ; le 0 blanc et la restriction restent toujours présents ; lecture `getNbNiveauxC()` repli 4 : `0061` ; `site.seuil_competent` — seuil « compétent » paramétrable par site, 1..4 borné à ≤ nb_niveaux, réglé dans `/admin/competences` ; n'affecte QUE les rapports : Cockpit, Anticipation, ligne « Compétences ≥N » de la Matrice (depuis la fusion 2026-09-08, Polyvalence & compétences est passé à la lentille opérationnelle niveau_min + habilitation et n'utilise plus ce seuil) ; distinct de `poste.niveau_min_requis` ; lecture `getSeuilCompetentC()` repli 2 : `0062` ; `competence_niveau_libelle.couleur` — couleur paramétrable par niveau POSITIF, choisie dans `/admin/competences` parmi les 4 teintes historiques, CHECK verrouillant la palette ; niveau 0 toujours blanc/contour ; lecture résiliente `getCouleursNiveauxC()` + `couleursNiveau()`/`COULEUR_NIVEAU_DEFAUT` dans `src/lib/couleurs-niveau.ts` ; `FILL` dans `Pie.tsx` en dérive : `0063` ; `placement.tp` + table `tp_charge` — temps partiel MATÉRIALISÉ (le bouton « TP + postes fixes » du planning pose de vraies lignes `placement.tp`, déplaçables au glisser-déposer, puis pré-remplit les postes fixes) ; `tp_charge(site_id, semaine_lundi)` marque une semaine « chargée » → le calcul virtuel du TP s'éteint pour elle (repli calculé tant que non chargée). Le calcul virtuel s'éteint AUSSI dès qu'une vraie ligne de placement existe pour la case (un vrai TP est donc toujours draggable, marqueur ou pas) : `0064` ; ouverture de `competence_niveau_libelle.couleur` au **nuancier** — le CHECK verrouillé de 0063 (4 teintes) est remplacé par un simple contrôle de format hexadécimal, la liste fermée restant imposée côté application (`NUANCIER`/`HEX_NIVEAUX_AUTORISES` dans `src/lib/couleurs-niveau.ts`) ; migration idempotente qui rattrape aussi le cas « 0063 jamais appliquée » (colonne absente → PostgREST `PGRST204`, désormais capté par le repli d'enregistrement au même titre que `42703`) : `0065` ; `motif_absence.code_gt` (code du logiciel RH rattaché à un motif, colonne « Code GT » dans Param RH) + table `import_absence_personne` (équivalence apprise *matricule fichier RH → personne*) — socle de l'**import des absences RH** depuis Param RH : `0066` ; `parametre_affichage.mode` (`'relatif' | 'absolu'`) + `nb_semaines` (1..6) — **mode d'affichage TV** paramétrable dans Param RH : *relatif* (X jours avant/Y jours après aujourd'hui, historique) OU *absolu* (N semaines calendaires à partir du lundi de la semaine courante — S, S+1…) ; `getFenetreAffichage()` + `joursDeFenetre()` dans `src/lib/parametres.ts` ; lecture/écriture tolèrent une base sans les colonnes (repli sur `jours_avant`/`jours_apres`) : `0067` ; `quart.couleur` (hex `^#[0-9a-f]{6}$`) — **bandeau de rappel du quart** en tête du Planning (`QuartBandeau`, `src/app/planning/QuartBandeau.tsx`) pour éviter aux managers de se tromper de quart ; réglée par site dans `/admin/equipes` « Horaires des quarts » (input hex + aperçu) ; seeds « doux » matin/après-midi/nuit/journée ; en mode AUTO le bandeau devient gris neutre « Tous quarts affichés » — le manager sait qu'il n'est plus sur un quart précis : `0068` ; `ligne.regroupement` + `personne.regroupement` (texte nullable) — **regroupement de lignes**, étiquette de reporting (PAS un niveau de hiérarchie). Saisi inline au Référentiel (champ « Regroup. » + autocomplétion `datalist` du vocabulaire du site) sur la ligne ; l'affectation d'une personne se pose depuis la colonne « Service » du Personnel (« Atelier — Regroupement », option encodée `atelierIdregroupement`, une option de repli garde une valeur orpheline). Seul le bilan **Projection — feuille de route** l'exploite : sous chaque catégorie, EN PLUS, un sous-total par regroupement (effectif ventilé par `personne.regroupement` — une personne = un groupe, pas de double compte ; besoin par `ligne.regroupement`) + bucket « Sans regroupement », rendu seulement si le service a des regroupements ; logique dans `src/lib/feuille-route-data.ts` (`SousTotalRegroupement`, `regroupements?` sur `BlocCategorie`). Renommage manuel des deux côtés (version texte assumée). `copierReferentiels` ne copie pas atelier/ligne/poste → duplication de site non concernée : `0069`). Cf. `tasks/multi-site.md` pour l'état complet du chantier multi-site.
6. **PowerShell 5.1** : pour un message de commit multi-lignes, here-string `@'…'@`
   (le `'@` final en colonne 0), ou `git commit -F fichier`. Pas de `"` inline.
   ⚠️ **Jamais** de `Get-Content`/`Set-Content`/`Out-File` pour éditer un fichier
   source accentué : PowerShell 5.1 lit l'UTF-8 en ANSI puis le ré-encode → mojibake
   (`é`→`Ã©`) + BOM, invisible au build. Utiliser l'outil Edit ou Node. Cf. lessons L34.
7. ⚠️ **Toute lecture Supabase pouvant dépasser 1000 lignes passe par `fetchAll()`**
   (`src/lib/fetch-all.ts`). PostgREST plafonne chaque réponse à 1000 lignes **sans
   erreur** : `data` en contient 1000, `error` vaut `null`, la page affiche des données
   incomplètes. Concernées : `matrice` (1600+), `personne_competence` (1400+),
   `placement` et `ouverture_quart` (croissantes). La fabrique de requête doit poser un
   `.order()` déterministe ; `ouverture_quart` et `jour_quart` n'ont pas d'`id` → trier
   sur la clé composite. Cf. `tasks/lessons.md` L8.

## Sécurité / permissions — les 2 couches à ne pas confondre
- **Couche A — matrice de modules** : table `role_permission` surchargeant `defaultsFor()`
  dans `src/lib/permissions.ts` (`MODULES`, `canRead`, `canWrite`, `requireModule`).
- **Couche B — périmètre RLS** : `can_edit_personne()` = admin **ou** chef de l'équipe
  de la personne.
- ⚠️ `canWriteModule(role, mod)` renvoie **toujours `false` pour `chef_equipe`** : le chef
  reste cantonné à son périmètre. Dans les API : si écriture « complète » →
  `getAdminClient()` (bypass RLS) ; sinon `getServerClient()` (RLS). Ne jamais donner
  le client admin à un chef d'équipe.
- 🚫 **Plus aucun `role === "admin"` en dur.** La matrice décide seule ; l'admin obtient
  tout parce qu'elle le lui donne (`defaultsFor("admin")`). Un droit accordé dans l'écran
  doit fonctionner : sinon on offre un bouton qui répond 403 (bug vécu sur la fusion de
  personnes et sur les server actions de Compétences / Motifs / Personnel).
  - Server actions et routes de paramétrage → `requireModuleWrite(mod)`
    (vérifie la matrice **et** rend le client admin, ces tables étant sous RLS `is_admin()`).
    Variante **route API** : `moduleWriteGuard(mod)` → `{ ok, supabase }` ou `{ ok:false, status }`.
  - ⚠️ **Une route qui écrit dans une table de paramétrage ne doit JAMAIS se contenter
    de `getServerClient()`.** Ces RLS nomment des rôles en dur (`is_admin()`,
    `has_role('ordo')`) : tout titulaire du droit qui ne porte pas ce rôle est refusé
    **en silence**, et l'écran offre un bouton qui répond 403. Bug vécu sur les 6 routes
    d'ordonnancement (un CODIR ne pouvait pas initialiser les semaines) et sur `/api/droits`.
  - Table `placement` : écrite par **deux** écrans (Planning et Placement) via
    `/api/placement/cell` → `canWritePlacementData()` = write sur l'un **ou** l'autre.
  - Restent volontairement en dur : les droits par défaut de l'admin (`defaultsFor`) ;
    l'exclusion du chef d'équipe ci-dessus, qui est un **périmètre**, pas un droit de
    module. Un test (`routes-gardees.test.ts`) échoue si un `role === "admin"`
    réapparaît dans une route API.
- **Anti-escalade — `droitsCouvertsPar(role, appelant)`** : « on ne donne pas ce qu'on
  n'a pas ». Vrai si les droits de `role` ne dépassent **nulle part** ceux de l'appelant,
  calculé sur la matrice — aucun nom de rôle en dur. Sans cela, un titulaire de
  `utilisateurs: write` créait un compte, le nommait admin, récupérait son **lien de mot
  de passe affiché en clair** et s'y connectait. Les 4 routes `/api/users/*` passent par
  `userAdminGuard({ cibleUserId, roleVise })`, qui vérifie le droit **et** l'escalade dans
  les deux sens (promotion *et* rétrogradation d'un compte qui vous domine).
  ⚠️ Conséquence assumée : déléguer `utilisateurs: write` à un rôle ne lui permet de
  gérer que les comptes dont le rôle est **entièrement couvert** par le sien. C'est le
  prix de « pas d'escalade » : le lien de mot de passe donne la session du compte visé.
  ⚠️ **Multi-site (PR 6)** : `userAdminGuard` borne aussi le SELECT de la
  cible par `site_id = appelant.siteId` (sauf super_admin). Sans cette borne,
  un admin du site A modifiait potentiellement les comptes du site B via
  leur user_id UUID (unique global) — la lecture app_user via `garde.supabase`
  est en service_role, donc bypass la RLS. `/api/users/create` pose aussi
  `user_metadata.site_id` sur `auth.admin.createUser()` : sans ça, le trigger
  `handle_new_user` retombait sur son fallback lebignon codé en dur et un
  admin d'un autre site créait ses utilisateurs chez Lebignon en silence.
- ⚠️ **« Site courant » = `getCurrentProfile().siteId`, conscient de l'impersonation**
  (pendant applicatif de `current_site_id()` SQL) : site cible quand un super_admin
  est « entré » dans un site (via le **cookie** signé), sinon le `site_id` de rattachement
  lu dans `app_user`. `getCurrentSite()` en dérive. **Toute écriture site-scopée utilise
  ce `siteId`** — jamais le site d'origine du super_admin. ⚠️ Le header `x-impersonate-site`
  est **absent sur `/api/`** (middleware exclu du matcher) → la source universelle est le
  cookie (`getImpersonatedSiteId`), lu par `getCurrentProfile` **et** `getServerClient`.
  Incident 2026-08-23 (cf. `tasks/multi-site.md §5bis`) : (1) `getCurrentProfile` doit lire
  sa propre ligne en **`getAdminClient`** (service_role), sinon en impersonation la RLS 0055
  masque la ligne du super_admin → profil null → **boucle `/login ↔ /`** ; (2) `site_id:
  profile.siteId` écrivait sur le mauvais site tant que `profile.siteId` n'était pas
  impersonation-aware.
- **`/api/droits` (matrice des droits)** obéit à `verifierChangementDroit()`, testée,
  avec trois verrous et **aucun rôle littéral**. ⚠️ Le rôle reçu est validé contre
  **`getAllRoles()`** (intégrés **+** `role_custom` du site), pas contre les seuls `ROLES`
  intégrés : sinon éditer les droits d'un **rôle personnalisé** retombait en `400 Paramètres
  invalides` (« Échec » à l'écran). Les trois verrous :
  1. **anti-verrou** — on ne modifie pas les droits de **son propre** rôle (sinon on se
     retire `utilisateurs` et l'écran devient inaccessible à tous) ;
  2. **`ROLE_TOUT_PUISSANT`** — le rôle à qui `defaultsFor` donne `write` partout (donc
     `admin`, mais **déduit**, pas écrit) n'est modifiable par personne, lui compris :
     sa colonne reste visible avec ses droits réels, grisée ;
  3. **anti-escalade** — on n'accorde pas un niveau supérieur au sien sur un module.

  Volontairement **non** couvert : abaisser les droits d'un rôle intermédiaire. Ce n'est
  pas une escalade (l'auteur n'y gagne rien) et c'est tracé au journal depuis la 0036.
  L'interdire supposerait de n'ouvrir que les rôles strictement plus faibles que soi —
  or les rôles ne sont pas ordonnés entre eux, la matrice serait **entièrement grisée**
  pour tout autre qu'un admin (vérifié sur les données réelles).
- **`is_active` est vérifié par `getCurrentProfile()`** (pas seulement par la RLS) :
  un compte désactivé n'a plus de profil, donc plus de navigation.
- ⚠️ **`app_user.site_id` absent = refus de session** (audit S6, 2026-09-10). Depuis
  0043 la colonne est `NOT NULL` ; le fallback historique « retomber sur `SITE_LEBIGNON_ID` »
  a été retiré de `current-user.ts` — il masquerait une régression en fuite cross-tenant
  silencieuse. Une ligne `app_user` sans site est désormais loggée en erreur et la session
  refusée. Idem pour le bloc « pré-0043 » qui retentait un SELECT sans `site_id` / `est_super_admin` :
  supprimé (0043 en prod depuis 2026-08).
- **Les 8 écrans de réglage s'ouvrent en LECTURE** (`requireModule(mod, "read")`) et
  passent en consultation seule via `<LectureSeule>` — un `<fieldset disabled>` neutralise
  tous les champs d'un coup. Le menu apparaît dès la lecture. Seul **Placement** fait
  exception : écran de saisie, sa page exige `write`, l'entrée de menu aussi.
- Rôles **intégrés** : `admin`, `chef_equipe`, `ordo`, `rh`, `codir`, `planning`
  (`src/lib/roles.ts`). **Rôles personnalisés** (migration 0042) : table `role_custom`,
  créés depuis l'écran Utilisateurs (`/api/roles`), lus par `getAllRoles()`
  (`src/lib/roles-server.ts`). Un rôle personnalisé naît **sans aucun droit**
  (`defaultsFor()` renvoie `none` pour tout code inconnu), donc jamais une escalade ;
  les garde-fous se calculant sur la matrice, ils s'appliquent à lui automatiquement.
  Le CHECK sur `app_user.role` a été retiré (0042) ; la validation d'un code de rôle
  se fait côté application (intégrés + `role_custom`), plus par `isRole()` seul.
- **Depuis 0053, toutes les tables de paramétrage sont site-scopées** (`site_id NOT
  NULL`) : `motif_absence`, `type_contrat`, `role_custom`, `role_permission`,
  `competence`, `competence_niveau_libelle`, `quart`. Chaque site a **sa propre
  matrice des droits, ses propres rôles custom, ses propres motifs, contrats,
  compétences, échelle et quarts** — plus aucune ligne partagée. Un nouveau site
  démarre en dupliquant les référentiels du **site source** choisi au formulaire
  `/platform/nouveau` (`copierReferentiels()` dans `src/app/platform/actions.ts`).
  Conséquence pour toute nouvelle route qui écrit dans l'une de ces 7 tables :
  poser `site_id` explicitement, même via `getAdminClient()` — le trigger
  `set_site_id_from_context` retomberait sinon sur le fallback `lebignon`.
- Routes publiques (`src/proxy.ts`) : `/login`, `/forgot`, `/reset`, `/auth/*`, `/affichage/*`.
- **Mot de passe** : l'admin n'en choisit jamais. `/admin/users` génère un **lien**
  `{base}/reset?token_hash=…` à transmettre (aucun e-mail envoyé, le SMTP n'est pas
  garanti). Cf. `src/lib/password-link.ts` et `tasks/lessons.md` L15 — ne pas revenir à
  `action_link`, il ne marche pas ici.

## Modèle métier — les pièges
- **« Atelier » (technique) = « Service » (affiché)** — décidé le 2026-09-08.
  Le terme métier reste `atelier` dans TOUT le code et la base (table `atelier`,
  `personne.atelier_id`, routes `/affichage/atelier/[atelier]`, composants
  `AtelierFilter` / `AtelierEquipeFiltres` / `ReportAtelierFilter` / `AtelierPlanning`,
  op API `create-atelier`/`update-atelier`, classes CSS), mais il est **libellé
  « Service » partout dans l'UI, sur les 2 sites** (filtres, en-têtes de colonnes,
  options, titres, messages, info-bulles, cartes Bilans, `public/guide.html`, libellés
  du journal d'audit). ⚠️ **Ne jamais réintroduire « atelier » dans une chaîne
  visible** ni renommer les identifiants techniques. Renommage = libellés seulement.
- **Quart ≠ Équipe.** Quarts : `journee`/`matin`/`apres_midi`/`nuit` (table `quart`,
  site-scopée depuis 0053 : PK composite `(code, site_id)`, FKs composites
  `(quart_code, site_id) → quart(code, site_id)` sur les 10 tables enfants —
  aucun code ne fait `.select("quart(...)")` en embed implicite, donc
  PostgREST-safe, contrairement au retour d'expérience 0046/0047).
  Les équipes tournent sauf si `equipe.quart_fixe`. **Rotation par référence datée**
  (`rotation_reference`, cf. `src/lib/rotation.ts` ; écran fusionné dans `/admin/equipes`) :
  on saisit, pour **une** semaine (lundi),
  le quart de chaque équipe tournante ; l'alternance des semaines suivantes est **calculée**
  (rotation cyclique du vecteur de quarts), jamais stockée. Pour une semaine cible, la
  référence active est la plus récente ≤ cette semaine → changer la rotation = **ajouter une
  nouvelle référence datée**, le passé n'est jamais recalculé. Avant toute référence : pas de
  rotation. L'ancienne table `equipe_quart_semaine` (saisie semaine-par-semaine) a été
  **droppée en 0038** — plus aucune trace en base ; un test statique interdit toute
  lecture qui la ferait ressurgir. Défaut planning = `matin`. Sur `/planning`, choisir un quart
  auto-sélectionne l'équipe de la rotation de la semaine (forçage possible via le filtre Équipe).
  ⚠️ **Quels quarts composent le cycle = colonne `quart.rotation`** (0057), cochée par quart
  dans « Horaires des quarts » (`/admin/equipes`). Le formulaire *Référence de rotation*
  ne propose plus que ces quarts (avant : tous, le sous-ensemble matin/après-midi était
  implicite). Le « quart fixe » d'une équipe, lui, reste choisi parmi **tous** les quarts.
- **`poste_quart`** : activation poste×quart, **défaut actif** → la table ne stocke que
  les *désactivations*.
- **Ouverture des lignes** (`jour_quart`, `ouverture_quart`) : décidée dans Ordonnancement.
  Deux canaux, deux effets **distincts** — à ne surtout pas confondre :
  - **`jour_quart` = visibilité du jour** (arrêt d'usine, semaine non initialisée). Absent
    ou `actif = false` ⇒ colonne **fermée** dans Planning/Placement/TV, avec le message
    « Jour sans production — pour l'activer, contacter l'ordo ». Aucune saisie possible.
  - **`ouverture_quart` = besoin par ligne** (depuis 2026-09-09 — avant, la ligne fermée
    disparaissait). Ligne absente ⇒ ouverte ; ligne présente avec `ouverte = false` ⇒
    **besoin = 0** mais la ligne **reste visible et plaçable** partout. Dans Placement,
    la tuile affiche « X/0 » avec mention « · fermée par ordo » et le sureffectif orange
    est désactivé (le compteur « /0 » signale déjà l'anomalie). Dans le bilan Planning,
    catRequis et besoin global tombent à 0 pour ces lignes — Delta devient négatif si des
    gens y sont placés. `/bilans/assez-competences` était déjà cohérent (`besoinsJour`
    exclut poste × quart d'une ligne fermée). TV : le placement s'affiche normalement
    (retrait du filtre `isOpen(ligneId,…)` → seul `jour_quart` masque). Ordonnancement
    est donc un **règleur de besoins**, pas une visibilité — le pré-remplissage
    `/api/placement/prefill` remplit y compris sur lignes fermées (décision assumée : si
    le manager les rouvrira, autant partir des postes fixes).
  ⚠️ **Activation « Journée » DÉRIVÉE** : le quart *journée* (pleine journée — détecté sans
  code en dur comme le quart **sans `creneau` au plus petit `ordre`**) n'a plus de bascule
  propre dans l'écran. Son `jour_quart.actif` est **maintenu en base = OU(quarts tournants
  du jour)** par `/api/ordonnancement/quart` (à chaque bascule d'un tournant) **et** par
  `/reset-week` (à l'initialisation). Planning / Placement / TV lisent donc une journée
  active dès qu'au moins matin/après-midi/nuit l'est, sans dérivation dupliquée en lecture.
  ⚠️ **Fermer un quart / une ligne (ou ré-initialiser une semaine) qui porte des
  affectations réelles** ne renvoie plus un mur : `/api/ordonnancement/quart` et
  `/reset-week` renvoient `{ conflit, affectes }` (liste des personnes) en **409**, et
  l'écran propose « **Fermer / Réinitialiser quand même et retirer** ». Avec `{ force: true }`
  le serveur **supprime ces affectations poste** (les absences restent) puis ferme. Le test
  de conflit couvre l'**angle mort `quart_code = NULL`** : un placement sans quart s'affiche
  sous le quart PAR DÉFAUT du site (`quartParDefaut`/`memeQuart`) → fermer ce quart-là les
  prend aussi en compte, au lieu de les orphaniser en silence (`reset-week` n'a pas cet
  angle mort : il vérifie toute la semaine sans filtre de quart).
- **Numéros de rotation** : `poste.numero_rotation`, texte libre saisi au Référentiel
  (« 12, 15-17 »). `parseNumeros()` (`src/lib/numeros-rotation.ts`, testé) le développe en
  cases de dépôt ; la place occupée est mémorisée dans `placement.numero_rotation`.
  Depuis le **Planning** (qui n'a pas de cases), `/api/placement/cell` prend la première
  place libre — mais **seulement si le champ `numero` est absent** de la requête : le
  Placement l'envoie toujours, `null` valant « volontairement hors numéro ».
- **Habilitations exigées par un poste** : `poste_competence_requise`. Placer quelqu'un qui
  ne l'a pas — ou plus — demande confirmation ; le forçage est tracé
  (`placement.forcage_*`) mais le **rouge est recalculé à l'affichage**, il s'efface donc
  dès la régularisation.
- **`poste.categorie`** ∈ manager/conducteur/operateur (source des bilans).
  `est_conducteur` est **déprécié et n'est plus lu nulle part** (colonne conservée en base,
  mais divergente : 9 postes ont `categorie='conducteur'` et `est_conducteur=false`).
  Un test échoue si une lecture réapparaît.
- **`poste.remplacable` (PTR / PTNR)** (migration 0059, colonne « Rempl. » du Référentiel) :
  `false` = **PTNR** (Position de Travail Non Remplaçable — un seul titulaire par
  conception : directrice, responsable maintenance…). Sert **uniquement aux rapports**
  (« nettoyer + isoler », cf. Bilans) : aucun impact sur le planning ni le placement.
  Défaut `true` (PTR) → aucun changement de comportement tant qu'un poste n'est pas marqué.
- **Poste fixe (`personne.poste_fixe_id`)** (migration 0059) : la personne « appartient »
  à ce poste et y est **pré-remplie** dans le planning (bouton « TP + pré-affectation »,
  cf. Planning). ⚠️ **Affectation AUTOMATIQUE ≠ saisie manuelle sur l'habilitation** : le
  pré-remplissage **ne demande pas et ne force pas**. Une personne qui n'a pas (ou plus) les
  habilitations exigées par son poste fixe **n'est simplement pas placée** (contrôle groupé
  dans `/api/placement/prefill`, mêmes règles que `habManquantes`). La saisie manuelle, elle,
  ouvre le pop-up de forçage. Saisi des **deux côtés, même donnée** : sélecteur de la fiche Personnel
  (modale Informations) **ou** colonne « Titulaire » du Référentiel. **Indépendant** de
  PTR/PTNR (un PTR peut avoir un titulaire pré-rempli ; un PTNR peut rester vacant).
- **Quarts : aucun code en dur.** `src/lib/quarts.ts` porte les deux règles qui étaient
  recopiées partout — le **quart par défaut** d'un écran (`matin` s'il existe, sinon le
  premier dans l'ordre) et le **repli des placements historiques** sans `quart_code`.
  ⚠️ Ces deux règles divergeaient : `/planning` utilisait `quartCodes[0]` (= `journee`,
  ordre 0) là où Placement, TV, copie et `/api/placement/cell` utilisaient `matin` — les
  mêmes lignes s'affichaient sous deux quarts selon l'écran. La migration 0038 a normalisé
  les 7 placements concernés. Un test interdit le retour d'un code de quart en dur.
  Exception documentée : `tp_config` stocke ses demi-journées sous les clés `matin`/`aprem`
  — vocabulaire distinct, à traiter avec le modèle du temps partiel, pas avec les quarts.
- **Habilitations** : `competence` (`a_recycler=true`, `duree_validite_mois`, `ordre`,
  `groupe`, `categorie`) × `personne_competence`. ⚠️ `date_expiration` est **stockée au
  moment de la saisie**, pas recalculée en lecture : si la durée de validité change
  après coup, l'échéance stockée reste fausse (ou nulle). À l'affichage, passer par
  `addMonthsIso(date_obtention, duree)` en repli — cf. `src/lib/habilitations.ts`.
  Statut : rouge < 30 j · orange 30-90 j · vert > 90 j.
- **Alerte 18 mois** (colonne « ⚠ 18 mois (livret) » sur `/personnel`) : basée sur
  `date_livret_accueil + 18 mois`, non-CDI uniquement. Livret non renseigné → pas
  d'alerte (`src/app/personnel/PersonnelEditor.tsx` fonction `alerte18`).
- **Absences longues** (`absence`) : matérialisées en `placement` (un par jour), liés par
  `placement.absence_id` (cascade).
- **Cycle de vie du personnel** (migrations 0049 + 0050) : `personne.statut` ∈
  `A_VENIR | ACTIF | PARTI` est un **cache calculé automatiquement** par trigger DB
  à partir des contrats. Plus de toggle manuel. Sources de vérité :
  `MIN(contrat_periode.date_debut)` = arrivée ; `MAX(contrat_periode.date_fin)` si
  aucun contrat ouvert = départ prévu ; `motif_fin` du dernier contrat = motif de
  départ. Anciens champs `personne.date_arrivee` / `date_depart_prevu` /
  `motif_depart` **supprimés** en 0050. Les 12 requêtes `.eq("statut","ACTIF")` en
  dur continuent à filtrer correctement (le cache est frais). Helper client
  `src/lib/personne-statut.ts` (statutALaDate / estAuTravailLe / contratCouvreLe /
  deriverArriveeDepart, 25 tests) sert de source pour le rendu et le masquage
  jour par jour dans le Planning.
- **Planning : deux canaux de masquage de cellule distincts** (`src/app/planning/`).
  ⚠️ `tpBlocked` = temps partiel (fond violet, label « TP ») ; `horsEffectif` =
  personne pas dans l'effectif ce jour-là — avant arrivée, dans un trou de contrat,
  après départ (fond gris clair, point discret, tooltip « Hors effectif »).
  **Ne jamais recycler l'un pour l'autre** : le rendu client interpréterait tout
  `tpBlocked` comme « TP », y compris sur des personnes sans temps partiel réel.
  Cf. `tasks/lessons.md` L28.
- **Temps partiel** : `personne.tp_config` (jsonb, options cumulables `demi`/`off`/`horaires`).
  Le planning calcule `tpBlocked` **côté serveur**. ⚠️ Règles métier (2026-07-24) —
  « TP » s'écrit dans le planning quand **l'une** des deux conditions est vraie :
  1. **Journée entière off** (les deux demi-journées `matin` et `aprem` dans `off`) ;
  2. **Équipe sur le créneau non travaillé cette semaine** : si l'équipe de la
     personne tourne, et qu'elle est cette semaine sur le créneau que la personne
     ne fait pas, TP toute la semaine. Ex. Sylvie mi-temps après-midi (off matin)
     en équipe B tournante : la semaine où B est au matin, TP tous les jours ;
     la semaine où B est l'après-midi, rien — d'où un **TP automatique une
     semaine sur deux**, piloté par la rotation datée. Calcul via
     `rotByWeek[wi]` + `equipe.quart_fixe` éventuel.
  ⚠️ **La demi-journée d'un quart (matin/aprem) n'est plus codée en dur** (0057) :
     `creneauDe` (planning) et `postesSemaine` (`TempsPartielModal`) lisent
     `quart.creneau` (`matin`/`aprem`/null). Un quart sans créneau (journée, nuit)
     ne bloque aucun mi-temps de ce chef. Réglé par quart dans « Horaires des quarts ».
     Le seed 0057 pose `matin→matin`, `apres_midi→aprem` : comportement inchangé.
  Un mi-temps sur un seul créneau **hors semaine « équipe au mauvais créneau »**
  n'écrit ni ne bloque rien — la case reste vide et plaçable. L'ancienne flèche
  « → Mat/Apr » (`tpRedirect`) a été **supprimée** : elle noyait l'écran de
  marqueurs sur les quarts ≠ celui de la personne.
- **Horaires affichés** (TV), par priorité : exception ponctuelle > temps partiel > standard.

## Ossature des écrans « grille » (globals.css)
Matrice, Personnel, Planning, Habilitations, Ordonnancement partagent trois classes :
- `.pagecol` — page à la hauteur de la fenêtre (`100dvh`). **Aucun défilement de page** :
  seule la grille défile. Remplace les hauteurs magiques `calc(100vh - N)`.
- `.headband` (+ `.headband-top`) — titre et filtres dans la colonne centrée de 1500 px.
  **En-tête commun à Personnel / Matrice / Habilitations**, à ne pas réinventer :
  `.hb-l1` (ligne 1 : titre · recherche `.hb-search` · complément `.hb-fin` calé à droite)
  et `.hb-l2` (ligne 2 : bascule ou actions à gauche · filtres `.hb-fin` à droite).
  ⚠️ La recherche vit dans le **composant client** qui porte son état — c'est pourquoi
  l'en-tête de la Matrice et des Habilitations est rendu par leur composant, pas par la page.
- `.gridband` — la grille prend **toute la largeur** de la fenêtre. Variante
  `.gridband.scroll` quand plusieurs cartes s'empilent (Ordonnancement).
  Dernière carte scrollable : lui donner la classe `grow`.

⚠️ **Les 6 pages de Bilans et `/matrice/bilan` restent à 1500 px** : ce sont des rapports
imprimables (A4 paysage, KPI, barres) que la pleine largeur dégraderait.

## Grille « personnes × colonnes » (partagée Matrice ↔ Habilitations)
`src/components/persongrid.module.css` + `usePersonGrid()`. **Ne pas la dupliquer.**
- Deux tableaux (en-têtes figés + liste scrollable), colonnes alignées par un `colgroup`
  commun + `table-layout: fixed`.
- Colonne des noms **figée** (`position: sticky; left: 0`).
- Colonnes **élastiques** : `min-width: calc(var(--name-w) + var(--n-cols) * var(--col-min))`
  (36 px mini) → scroll horizontal seulement quand la fenêtre est trop étroite.
- **Survol en croix** : la colonne est peinte via le fond du `<col>` + une classe sur son
  en-tête, écrits directement dans le DOM (aucun rendu React, gratuit sur 20 000 cellules).
- Réglages en un seul endroit : `--row-h: 32px`, `--cell: 28px` (la pastille fait 28 px,
  l'écart vertical 2 px), `--col-min: 36px`. `--accent*` teinte les en-têtes (la Matrice
  les surcharge selon Actuel/Cible via `.matrice.matrice[data-mode]`).
- La **cellule d'angle** (`.cornerHead`) porte, dans les Habilitations, les compteurs
  globaux (`.cornerKpis`, **une seule colonne** — sur deux, les libellés se font rogner)
  puis le bouton Bilan. La ligne de recherche n'y est plus : elle est montée dans `.hb-l1`.
- ⚠️ Le panneau d'en-têtes est en `overflow-y: scroll` (pas `auto` + `scrollbar-gutter`) :
  sur un axe `overflow: hidden`, Chrome retranche la gouttière de la zone défilable et le
  `scrollLeft` asservi s'arrête 15 px trop tôt. Cf. `tasks/lessons.md` L9.

## Ossature des écrans de paramétrage (référence : `/admin/motifs`)
Convention adoptée sur tous les écrans de paramétrage listant des lignes
(motifs d'absence, agences d'intérim, types de contrat, équipes, compétences,
habilitations, référentiel…). Applique-la ici plutôt que d'inventer :
- **Icônes SVG partagées** (`src/components/icons.tsx`) : `<EditIcon />` (crayon)
  pour Modifier, `<SaveIcon />` (disquette) pour Enregistrer, `<CheckIcon />`
  (coche verte) pour Valider une édition inline, `<TrashIcon />` pour Supprimer,
  `<PrintIcon />` pour l'impression (**refonte 2026-09-09** : style trait pur, viewBox
  24×24 avec marges internes [3,21], cohabite proprement avec les autres icônes du
  bandeau Planning ; l'ancien style « plein bleu » causait un désalignement visuel
  entre 🤒 et 🚛/OperateurIcon), `<AbsenceIcon />` pour Absences (Personnel),
  `<SearchIcon />` / `<InfoIcon />` / `<GearIcon />` pour la colonne d'actions,
  `<OperateurIcon />` (silhouette + étoile, choix 2026-09-09) pour le filtre
  « Conducteurs » du Planning et du Placement, `<TvIcon />` (2026-09-10, refonte
  plein cadre : antennes en V + écran 4:3, trait 2 px, taille 18 px dans un bouton
  30×30 pour la marge visuelle) pour le raccourci « Affichage TV » du bandeau
  Planning.
  L'emoji rendait avec ses couleurs propres, illisible sur un fond coloré — le
  SVG en `currentColor` suit la couleur du bouton (blanc sur bleu, gris sur
  clair). Un `<SaveIcon default>` reste ré-exporté depuis `@/components/SaveIcon`
  pour les imports historiques.
- **Boutons d'action normalisés** : classe partagée `.iconbtn` (globals.css) —
  boîte 30×28, fond blanc, bord gris, radius 7. Variantes de couleur : `.edit`
  (orange), `.save` (bleu), `.ok` (vert), `.del` (rouge), `.ghost` (annuler `✕`).
  Toutes les modales Absences et Param RH l'utilisent : mêmes tailles, mêmes
  alignements partout. Sur les grands boutons au libellé explicite, garder le
  texte et préfixer par l'icône (`<SaveIcon /> Enregistrer les horaires`).
- **Colonne « Actif » à droite**, case à cocher via `<ActifCheckbox id actif action />`
  (`src/components/ActifCheckbox.tsx`) — remplace le couple ancien
  « badge Statut + bouton Désactiver/Réactiver ». Ligne opacifiée à 0.55 quand
  inactive. Le composant est client, il rend un `<form action>` qui soumet à
  chaque coche. Pour une table dont la PK n'est pas `id`, passer `keyName="code"`
  (ex. `type_contrat.code`).
- **Réglages simples enregistrés en direct** (couple de nombres, singleton) :
  auto-save débouncé de 500 ms, pas de bouton. Cf.
  `src/app/admin/motifs/FenetreAffichageInline.tsx` et l'endpoint dédié
  `/api/param-affichage` — un server action `redirect()`erait à chaque touche.
- **Édition inline d'une ligne (colonne par colonne)** : le `<tr>` en édition
  déverrouille ses cellules **dans leurs colonnes** (le `<form>` vide est relié
  aux inputs par l'attribut `form=`, HTML valide et compatible server action).
  Bouton `<CheckIcon />` puis lien `✕` (Annuler) pointant sur la page sans `?edit=`.
  Plus de rangée pleine largeur qui casse l'alignement.

## Harmonisation des hauteurs de ligne (grilles)
Toutes les grilles principales (Matrice, Habilitations, Référentiel, Personnel,
Ordonnancement, Planning) partagent une **hauteur totale de rangée** unique via
la variable `--grid-row-h: 32px` (`globals.css :root`) — cohérence visuelle au
passage d'un écran à l'autre. La pastille de la Matrice reste à 28 px + 2 px de
marge. Sélecteurs qui s'y branchent : `persongrid --row-h`, `.pers-table tbody td`,
`.pcell`, et la classe utilitaire `.rowh` pour les tables `.matrix` du
Référentiel/Ordonnancement (`.matrix` étant partagé aussi par Bilans/Droits, on
ne peut pas le cibler globalement).

**Référentiel** — deux classes scope pour aligner la **hauteur du contenu** des
contrôles (`input`/`select`/bouton) à 28 px, sinon la ligne paraît bancale à
hauteur de rangée constante : `.refpostes` sur la table des postes,
`.refhead` sur les toolbars atelier/ligne.

## Autres patterns UI (réutilise-les, n'invente pas)
- **Édition inline auto-enregistrée** : `useState` + `fetch` debouncé → route API,
  avec indicateur « Enregistré ✓ ». Cf. `PersonnelEditor`, `ReferentielEditor`, `MatrixGrid`.
- ⚠️ **Ne pas définir un composant à l'intérieur d'un autre**, surtout s'il porte
  des `<input>` : chaque re-render du parent recrée une nouvelle référence de
  fonction, React voit un « type de composant différent » et démonte/remonte
  l'arbre — l'input perd son focus à chaque touche. Bug vécu deux fois sur les
  modales Absences (le champ Commentaire devenait inutilisable). Solutions :
  extraire au TOP-LEVEL du module (voir `RowsEdit` dans `AbsencesModal.tsx`),
  **ou** inliner le JSX (`{LigneEdition()}` au lieu de `<LigneEdition />`).
- ⚠️ **Un `<select>` contrôlé dans un composant client ne se sérialise pas de façon
  fiable** dans un `<form action={serverAction}>` parent. Pour une grille éditable,
  poster explicitement en JSON vers une route API (cf. `/api/ordonnancement/semaine-type`).
- ⚠️ **Jamais d'`<input type="color">`** : la boîte de dialogue OS fait planter le
  navigateur ici. Utiliser une palette de pastilles (`TeamColorPicker`).
- ⚠️ **Bouton à fond clair = poser aussi `color`** : le style global `button` impose
  `color: var(--primary-text)` (blanc) → un bouton qui passe son `background` en blanc
  devient un bouton « vide » (texte blanc sur blanc). Cf. `tasks/lessons.md` L11.
- ⚠️ **Boutons icône alignés côte à côte : DEUX pièges globaux à annuler** (2026-09-10) :
  1) `.navlink` (globals.css) porte `padding: 8px 12px` — mise sur un lien 30×30 elle
     ÉCRASE la taille (`box-sizing: content-box` par défaut, le padding s'ajoute) et
     désaligne le lien contre les autres icônes ; **ne PAS combiner `.navlink` avec une
     taille fixe** — écrire un style inline propre à la place.
  2) `button` (globals.css) impose `margin-top: 18px` (héritage des boutons de
     formulaire) : un `<button>` icône ajouté à une rangée d'`<a>` DESCEND de 18 px.
     Annuler avec `margin: 0` inline. Ces deux pièges expliquent le décalage des 4
     boutons d'actions du Planning (TV / 🕐 / 🤒 / Conducteurs) — cf. leur style inline
     unifié : `boxSizing: border-box`, `padding: 0`, `margin: 0`, `lineHeight: 1`.
- **Bouton « + Bilan » rose** (`#e11d48`, couleur du menu Bilans) : classe partagée
  `persongrid.module.css .bilanToggle`, utilisée par Matrice et Habilitations ; le Planning
  reprend le même style en inline.
- **Filtres** : `.filterrow` (label + segments), navigation en `useTransition`.
  Planning : ordre **Quart / Atelier / Équipe**.
- **Modales** : ⚠️ **TOUTE modale doit être déplaçable** via `<ModaleDeplacable>` —
  l'utilisateur a besoin de consulter le fond sans fermer la modale. Le contenu
  DOIT inclure un élément `.mdd-drag` (typiquement le bandeau titre) pour la
  poignée. Ne jamais créer de modale avec un overlay `position: fixed` fait main.
- **Info-bulle textuelle** : `<InfoBulle largeur={280}>…</InfoBulle>` pose une
  icône `i` qui déploie un tooltip en **`position: fixed`** ancré en haut à droite
  de l'icône. Le fixed est indispensable pour sortir d'un conteneur
  `overflow: auto` (modale) — un tooltip absolu y provoquait un ascenseur.
- **Popovers de liste** (menu Motif, choix Personne, calendrier de plage) :
  MÊME piège. Un popover en `position: absolute` dans la cellule est rogné par
  l'`overflow: auto` de la carte modale et déclenche un ascenseur : on ne voit
  que 2 lignes du menu. Solution : `position: fixed`, coordonnées calculées au
  clic depuis le rect du bouton (`getBoundingClientRect`), gauche bornée à
  `[8, vw - width - 8]`. Fermeture au scroll EXTÉRIEUR (fixed ne suit pas), mais
  **pas** quand on scrolle dans la liste elle-même (`popRef.current.contains(target)`
  → on ignore) — sinon impossible de dérouler une liste longue. Cf. `openPop` /
  `popStyle` dans `AbsencesModal.tsx` et `absences-specifiques/AbsencesEditor.tsx`.
- **Bouton d'action carré icône seule** (colonne d'actions Personnel) : classe
  `.iconbtn` (cf. « Ossature paramétrage »), 30×28 uniforme.
- **Ne pas rogner les libellés** : préférer une colonne plus large à un `text-overflow`.
- **Intérim = jaune** (`INTERIM_BG` de `src/lib/interim.ts`) sur Planning, Placement,
  Matrice, Habilitations et TV. Le vert est réservé à « aujourd'hui » sur la TV — les
  deux se distinguent d'un coup d'œil. Un seul endroit pour changer la teinte.
- **Choix d'une plage de dates** : `<DateRangePicker>` (deux mois côte à côte, sélection
  en deux clics, style Booking). La logique est dans `src/lib/calendrier.ts`, testée.
  Utilisé dans la modale Absences ; à reprendre partout où l'on demande *du…au*.
- **Composants partagés — les utiliser plutôt que d'en refaire un :**
  - `SlideSwitch` — bascule **entre deux vues** (Plan/Absences, Actuel/Cible, Grille/Liste).
    ⚠️ Ne pas confondre avec `ToggleSwitch`, qui dit actif/inactif en vert et rouge.
    Sa largeur est **fixe** à dessein : sur une largeur dictée par le contenu, le libellé le
    plus long déséquilibre les deux moitiés et la pastille ne tombe plus en face.
  - `AtelierEquipeFiltres` — filtres Atelier/Équipe en segments, portés par l'URL
    (Matrice **et** Habilitations) ; `base` = la route à repeindre.
  - `LectureSeule` — consultation seule d'un écran de paramétrage (cf. Sécurité).
  - `PageTitle` — titre + pastille du module. `PrintButton` — impression simple.
- `ToggleSwitch` partagé. **`prefetch={false}`** sur tout lien répété en liste.
- ⚠️ **Un libellé posé sur une pastille mobile ne se cible pas par position** :
  `:first-of-type` vise le premier élément **du même type**, souvent la pastille elle-même.
  Poser une classe explicite depuis le composant.
- **Impression** : `@page` A4 paysage et `.noprint` sont déjà dans `globals.css`. Pour
  faire tenir une vue sur une page, cf. `tasks/lessons.md` L16 (`transform: scale()`,
  **jamais** `zoom`) et `ajusterFeuille()` dans `PlacementBoard`.

## Performance (état : bon, ~300 ms à chaud — ne pas régresser)
Acquis à préserver : région `cdg1` + Fluid Compute · options de `<select>` construites
**à l'ouverture seulement** (planning) · `prefetch={false}` · cache des données de
référence (`src/lib/refdata.ts`, `unstable_cache` 30 s) · `loading.tsx` sur les gros écrans ·
compteurs du bilan matrice agrégés **en une passe** (`useMemo`, pas un balayage par cellule).

⚠️ **Invalidation immédiate du cache refdata** : toutes les entrées portent un tag
exporté (`ATELIERS_TAG`, `EQUIPES_TAG`, `QUARTS_TAG`, `MOTIFS_TAG`, `NIVEAUX_TAG`,
`NB_NIVEAUX_TAG`, `SEUIL_COMPETENT_TAG`, `ROTATION_TAG`). **Toute server action ou
route API qui écrit dans une de ces tables doit appeler `updateTag(TAG)`** (Next 16,
`next/cache`) — sinon la donnée n'apparaît qu'après expiration 30 s dans les menus
déroulants du planning. Sans cette invalidation, créer un atelier / une équipe / un
motif donne une expérience « le clic n'a rien fait » pendant une demi-minute. Cf.
audit P2 (2026-09-10).

⚠️ **Plafond connu** : `/matrice` sans filtre atelier construit **~22 000 cellules**
(268 personnes × 82 postes), chacune un `<button>` + un `<svg>` ; le HTML dépasse 1,8 Mo
et l'hydratation devient très lourde. Les habilitations sont dans le même ordre de grandeur
(231 × 31). La **virtualisation** des grandes grilles est la seule sortie — c'est le
prochain gros chantier, pas une optimisation cosmétique.

## Carte des fichiers
- Socle : `src/lib/{permissions,roles,roles-server,current-user,current-site,site-modules,week,refdata,parametres,habilitations,horaires,supabase-server,fetch-all,numeros-rotation,password-link,placement-helpers,rotation,password,erreurs,absence,absences-periodes,calendrier,quarts,semaine-type,interim,noms,bilans-rapports,synthese-data,verifier-site}.ts`, `src/proxy.ts`.
  - `verifier-site.ts` : `verifierIdSite()` + `verifierFksSite()` — valide qu'un UUID
    de rattachement (equipe_id, atelier_id, poste_id, motif_absence_id…) appartient
    bien au site de l'appelant AVANT d'écrire. **Obligatoire dès qu'une route accepte
    un UUID venu du client et écrit via `getAdminClient()`** : les FK du schéma ne
    portent pas `site_id`, le service_role bypass la RLS, un patch forgé injecterait
    silencieusement un rattachement cross-site (grille cassée côté lecture — cellules
    grises, pas d'erreur SQL). Appliqué sur `/api/personnel` (create + update),
    `/api/matrice/cell`, `/api/placement/cell` (audit S2, 2026-09-10). À étendre à
    toute nouvelle route qui écrit un UUID de FK venu du client.
  - `placement-helpers.ts` : `habManquantes()` + `premierNumeroLibre()`, partagés par
    `/api/placement/cell` **et** `/api/placement/move` (contrôle d'habilitation et numéro
    de rotation libre) pour ne pas diverger entre saisie et déplacement.
  - `horaires.ts` (testé) : **résolveur unique de l'horaire affiché** d'une personne
    sur un poste un jour donné — priorité **exception ponctuelle > temps partiel >
    horaire standard** (la priorité porte sur la SOURCE, pas borne par borne). Partagé
    entre l'affichage TV et la synthèse intérim (`/bilans/syntheses`) pour ne pas diverger.
- Nav : `src/components/{AppHeader,SettingsMenu,UserMenu,NavIcons}.tsx`.
  Logo → `/` (page d'accueil : logo centré + titre « planning »).
  `UserMenu` porte aussi le lien vers le **guide utilisateur** (`public/guide.html`,
  document autonome ouvert dans un onglet, mais servi derrière l'authentification).
- Composants partagés : `src/components/{SlideSwitch,ToggleSwitch,AtelierEquipeFiltres,LectureSeule,PageTitle,PrintButton,AutoRefresh,BandeauErreur,ConfirmForm,DateRangePicker,ActifCheckbox,ModaleDeplacable,InfoBulle,icons,SaveIcon,persongrid.module.css,usePersonGrid.ts}`.
  Icônes toutes centralisées dans `icons.tsx` (`SaveIcon`, `EditIcon`, `CheckIcon`, `TrashIcon`, `PrintIcon`, `AbsenceIcon`, `SearchIcon`, `InfoIcon`, `GearIcon`, `FillIcon` pot de peinture = pré-remplissage, `OperateurIcon`, `TvIcon`). `SaveIcon.tsx` reste comme shim d'import historique.
- Ordonnancement : `src/app/ordonnancement/{page,OrdoGrid,OrdoQuinzaineNav,semaine-type/*}.tsx`.
  **Fenêtre 15 jours** (2 semaines + le lundi suivant) à partir du lundi de la semaine
  choisie ; nav `OrdoQuinzaineNav` (`?debut=<lundiISO>`, flèches par 14 j). ⚠️ `weekDays()`
  **ne pose PAS `firstOfWeek`** — la page le remet (chaque lundi), sinon les blocs-semaine ne
  se découpent pas et le **même n° de semaine s'étale sur toute la fenêtre** (bug vécu, cf.
  lessons L39). **Grille unique** : sous chaque date, 3 sous-colonnes **matin / après-midi /
  nuit** ; **1ʳᵉ ligne « Activation »** (bascule `jour_quart` des quarts tournants), puis les
  **lignes groupées par atelier** (ordre du Référentiel : atelier → `ordre_affichage` → nom).
  **Journée** (pleine journée) **à part en dessous**, activation **dérivée** (cf. « Journée
  DÉRIVÉE » plus haut). **En-tête figé** par la **méthode du Planning** : deux cartes alignées
  par un `colgroup` partagé + `table-layout: fixed` — carte d'en-tête `flex:0 0 auto`
  (dates/quarts + Activation), carte de corps `flex:1` défilante (lignes). Une case grise
  « · » (individuelle) = la ligne ne tourne pas sur ce quart ; case verrouillée = quart
  inactif ce jour. ⚠️ **On ne rend PAS une rangée entièrement en « · »** : une ligne qui ne
  tourne sur AUCUN quart colonne (matin/après-midi/nuit — typiquement « journée seule »)
  est filtrée de la grille du haut (`gridLignes`), et l'en-tête d'atelier disparaît s'il n'a
  plus de ligne — la ligne reste visible dans la section Journée. En-tête : seul le bouton
  « ⚙️ Semaine type » (le bouton « Rotation des équipes » a été retiré, la rotation se règle
  dans `/admin/equipes`).
  ⚠️ **Semaine type** (`semaine-type/{page,SemaineTypeEditor}.tsx`, conteneur `maxWidth: 1200`
  pour montrer toutes les colonnes) reprend la **même trame** (même filtrage `gridLignes`)
  sur **7 jours de semaine** (Lun→Dim, dimanche en rouge) : ligne « Activation » (quarts
  tournants), lignes par atelier, **journée dérivée** à part en bas (colonnes alignées par
  `colgroup` partagé). Le gabarit sert de base au bouton « Initialiser ». APIs
  `/api/ordonnancement/{semaine-type,semaine-type-ouverture,semaine-type-profil}` inchangées.
- Planning : `src/app/planning/{page,PlanningGrid,PlanningFilters,AtelierFilter,QuartSelector,ConducteurToggle,QuartBandeau}.tsx`.
  ⚠️ **Bandeau plein-largeur de rappel du quart** (2026-09-10, `QuartBandeau`) rendu
  SOUS la ligne recherche+actions, AU-DESSUS de la grille — couleur = `quart.couleur`
  (migration 0068, réglée dans `/admin/equipes` « Horaires des quarts »), texte
  noir/blanc décidé par luminance ; en mode AUTO le bandeau devient **gris neutre
  « Tous quarts affichés »** (bug vécu : managers affectaient au mauvais quart). Le
  bandeau est **passé en prop `quartBandeau`** à `<PlanningGrid>` — la grille ne lit
  pas `quart.couleur` elle-même.
  ⚠️ **Les 4 boutons du bandeau (TV, 🕐, 🤒, Conducteurs) sont RENDUS EN HORIZONTAL**
  (2026-09-10) à droite de la barre de recherche, dans `PlanningGrid` (prop `actions`).
  L'ancienne colonne à droite du `.headband` (une `.filterrow` par bouton) est
  supprimée. La barre reste centrée par `position: absolute` sur le bloc `actions`
  → décorrélé du nombre de boutons visibles (le raccourci TV disparaît sans atelier
  sélectionné, sans décentrer la recherche). **Gabarit strictement identique** sur les
  4 : 30×30, `boxSizing: border-box`, `padding: 0`, `lineHeight: 1`, `display:
  inline-flex`. ⚠️ **Ne PAS utiliser `.navlink`** sur ces Links : son `padding: 8px 12px`
  écrase les 30×30 et casse l'alignement. ⚠️ `ConducteurToggle` étant le seul `<button>`,
  il subit le sélecteur global `button { margin-top: 18px }` de `globals.css` — l'annuler
  avec `margin: 0` inline sinon décalage vers le bas (bug vécu 2026-09-10).
  ⚠️ **Raccourci TV** (`TvIcon`, 2026-09-09) : visible seulement si un atelier est
  sélectionné, cible `/affichage/atelier/<atelierId>` dans un nouvel onglet.
  ⚠️ **Filtre AUTO élargi aux personnes réellement placées** (2026-09-09) :
  cliquer sur « Nuit » en mode AUTO remonte les équipes théoriquement de nuit
  cette semaine (rotation + `quart_fixe`) **∪** les personnes ayant au moins
  UN placement sur poste dans ce quart sur la fenêtre 3 semaines affichée
  (`autoPlacedIds`, match `quart_code = quart` avec repli sur NULL si `quart`
  est le quart par défaut du site, cohérent avec `memeQuart`). Sans cette union,
  une personne d'une autre équipe affectée manuellement sur nuit restait invisible
  tant qu'on ne basculait pas en « Toutes ». `poste_id NOT NULL` — les absences/NT
  sont neutres. fetchAll obligatoire (3 semaines de placements dépassent 1000).
  ⚠️ **Bascule « Conducteurs »** (icône `OperateurIcon` seule, rangée d'actions
  horizontale à droite de la barre de recherche, à côté de TV / 🕐 / 🤒) portée par
  `?cond=1` : `filtreConducteurs`
  côté serveur restreint `displayed` aux personnes ayant `niveau_actuel ≥ 1` sur au
  moins un poste `categorie='conducteur'` actif — même seuil que la pastille « sans
  compétence » de la Matrice. Intersection avec les autres filtres ; la recherche
  par nom court-circuite. Les 3 autres composants de filtre (`QuartSelector`,
  `AtelierFilter`, `PlanningFilters`) propagent `cond` dans leurs URLs.
  ⚠️ **Lien 🤒 vers `/absences-specifiques`** transmet `?atelier=` + `?search=`
  pour préserver le contexte (le retour se fait via un lien client dans l'éditeur,
  lisant l'URL LIVE — cf. section Absences).
  ⚠️ **Jours de semaine TOUJOURS affichés** (lundi→vendredi), même sur une semaine non
  initialisée : la colonne fermée (aucune ligne ouverte) porte alors, sur toute sa hauteur
  (cellule fusionnée `rowSpan`, alignée en haut), le message **« Jour sans production — pour
  l'activer, contacter l'ordo »** au lieu de disparaître (une semaine vide ne ressemble plus
  à un bug). Filtre côté serveur (`page.tsx`) : `dowMon(iso) < 5 || d.open` → on garde tous
  les jours de semaine, et les **week-ends seulement s'ils produisent** (`days[i].closed`
  porte l'état). La recopie hebdo (`»`) n'écrit pas sur un jour fermé.
  ⚠️ **Pré-remplissage « TP + pré-affectation »** (bouton **« ⛁ TP + pré-affectation »** dans
  l'entête de CHAQUE semaine du `PlanningGrid`, `FillIcon` pot de peinture, →
  `/api/placement/prefill`, droit Planning/Placement complet) : pose d'abord les **TP**
  matérialisés (cf. migration 0064), **puis** place chaque personne à **poste fixe**
  (`personne.poste_fixe_id`) sur son poste, **pour la semaine cliquée** (lundi→vendredi,
  une seule semaine), au **quart de son équipe** (quart fixe, sinon rotation de la semaine,
  sinon défaut) — indépendamment du quart affiché. ⚠️ **Affectation automatique : ne demande
  pas, ne force pas** — une personne **non habilitée** pour son poste fixe **n'est pas
  placée** (contrôle groupé). `upsert ignoreDuplicates` sur `(personne, jour)` → **n'écrase
  jamais** une case remplie (absence/affectation) ; saute les jours **hors effectif** (contrat
  ne couvrant pas le jour). ⚠️ La grille garde son état local (`useState(initial)`) et ignore
  `router.refresh()` : le bouton **recharge la vue** (`window.location.reload()`) après
  succès (sauf si 0 case créée), sinon l'écran ne se met à jour qu'au F5. Modèle « comme
  Ordonnancement » (un bouton par entête de semaine). L'entête des DEUX colonnes du
  bandeau (Année/Mois/Semaine · Quart/Atelier/Équipe) s'aligne via
  `.planning-top .filterrow { min-height }` (rangées de hauteur commune) ; la colonne
  d'icônes à droite du bandeau a été supprimée le 2026-09-10, les 4 boutons vivent
  désormais à côté de la barre de recherche.
  ⚠️ **Glisser-déposer des affectations** (DnD natif HTML5, comme le Placement) : on
  **DÉPLACE** une case remplie (**poste, NT, ou TP réel** — jamais une **absence**, jamais
  le vide) vers une case **VIDE**, entre jours et/ou entre personnes. **Déplacement
  uniquement** (pas de copie) ; **dépôt refusé sur une case occupée** (409) ou bloquée
  (hors-effectif, autre quart, TP calculé). Route dédiée **`/api/placement/move`**
  `{ from, to, equipe_id, quart, forcer }` : lit la source, réécrit la cible (recalcul du 1er
  numéro de rotation libre, contrôle d'habilitation de la personne d'arrivée → **428** +
  modale de forçage `askMove`), puis supprime la source (insertion cible AVANT suppression :
  un refus laisse la source en place). Un **TP réel** (`placement.tp`, cf. 0064) rend un
  bouton draggable, prioritaire sur l'aperçu TP calculé.
- Placement (saisie glisser-déposer, droit **`placement`**) : `src/app/placement/{page,PlacementBoard,JourNav,placement.module.css}`.
  Plan par ligne → postes → **cases numérotées** ; bascule **Plan / Absences** (`?vue=absences`,
  absences filtrées par l'atelier affiché) ; copie **écraser / compléter** ; bouton **PDF**
  (feuille A4 paysage : plan + colonne « **Absents / TP du jour** » — motifs d'absence **et**
  bloc **Temps partiel** ; TP du jour calculé serveur `tpIds`, mêmes règles que Planning/TV ;
  mise à l'échelle mesurée).
  **Filtre « Conducteurs »** (checkbox à côté de « Masquer les placés », icône `OperateurIcon`) :
  ne montre que les personnes ayant AU MOINS UNE compétence (`niveau_actuel ≥ 1`) sur AU
  MOINS UN poste `categorie='conducteur'` actif — set `conducteurIds` calculé serveur
  (fetchAll obligatoire, matrice > 1000 lignes). Intersection avec les autres filtres ; la
  recherche par nom court-circuite. État local (comme « Masquer les placés »), non porté
  en URL.
  **TP hors « à placer »** (2026-09-09) : un TP du jour SANS placement disparaît de la
  liste des noms (rank 0) — il apparaît dans la carte violette « **Temps partiel** » du
  volet Absences (couleur `#7c3aed`, **non-droppable** : le TP est calculé auto). Un TP
  DÉJÀ placé reste visible pour permettre le retrait (`rank=2`). Même règle que la
  feuille imprimée (`absPrint`), cohérence garantie.
  **Navigation par jour** = `JourNav` (remplace `<input type="date">`) : pastille date
  puis calendrier déroulant qui **grise** les jours sans ligne ouverte ; **la date
  d'aujourd'hui** apparaît en **surbrillance** (contour teal) dans le calendrier même
  quand elle n'est pas la date sélectionnée (2026-09-09). **Bouton « Aujourd'hui »**
  DÉPLACÉ SOUS le calendrier (2026-09-09, remplace les flèches ◀/▶ historiques et
  l'ancien bouton à côté de la pastille — le calendrier suffit à naviguer) : grisé
  quand on est déjà sur aujourd'hui ; `openDays` calculé serveur sur fenêtre
  [-90;+150] j = jours où `jour_quart.actif=true` pour ce quart (une ligne fermée par
  l'ordo ne grise plus le jour depuis 2026-09-09, cf. « Ouverture des lignes »). Écrit via `/api/placement/{cell,copy,reset-week,prefill,move}` — même
  table que le Planning. V2 prévue : vrai plan géographique (image + positions).
- Matrice : `src/app/matrice/{page,MatricePanel,MatrixGrid,Pie,LegendeModal}.tsx` + `matrice.module.css`.
  L'en-tête (titre · recherche · légende · bascule Actuel/Cible · filtres) est dans
  `MatricePanel` ; `MatrixGrid` reçoit `search` en prop.
  ⚠️ **Recherche transverse au filtre atelier** (comme le Planning) : `page.tsx` ne borne
  PLUS les personnes par équipe/atelier en base — il charge tout l'effectif actif et passe
  un `displayedIds` (personnes passant équipe+atelier) qui décide du sous-ensemble affiché
  PAR DÉFAUT ; la recherche par nom balaie tout l'effectif et fait apparaître quelqu'un hors
  atelier filtré (ex. taper GAUTREAU / Condi alors qu'on a filtré FAB). Les **colonnes**
  (postes) restent bornées à l'atelier ; le **bilan** (`stats`) est calculé sur le seul
  sous-ensemble affiché (`bilanPersonnes`), pas sur tout l'effectif.
  ⚠️ **Cible qui « colle » à l'actuel — symétrie CONDITIONNELLE** (2026-09-09,
  correction du bug historique). Dans `bump()` mode actuel : si la cible collait à
  l'actuel AVANT modif (`cur.c === cur.a`), on fait suivre la cible dans les DEUX
  sens (montée ET descente — le bug était que descendre l'actuel à 0 laissait la
  cible en l'air, ex. 3). Sinon (cible saisie plus haut volontairement), on la
  préserve mais on garantit toujours `cible ≥ actuel` (remontée forcée si l'actuel
  dépasse la cible). La restriction ❌ reste hors échelle, exclue de la comparaison.
  ⚠️ **Pastille orange `!` « sans compétence »** (devant le nom, comme la fiche
  incomplète du Personnel) : personne **ACTIVE** (les « À venir » sont exclues) sans
  **aucun** niveau actuel ≥ 1 sur **aucun poste actif, tous ateliers confondus**. Le
  drapeau `sansCompetence` est calculé **côté serveur** (`page.tsx`) par une requête
  `matrice` dédiée `.gte("niveau_actuel", 1)` (exclut d'office le blanc **et** la
  restriction −1 — une restriction n'est pas une compétence), **indépendante du filtre
  atelier** : sinon une personne toute blanche dans l'atelier affiché mais compétente
  ailleurs serait signalée à tort.
- Personnel : `src/app/personnel/*` + `src/app/api/personnel/{route,merge/route,[id]/export/route,[id]/absences/route}.ts`.
  Colonne **Absences** (calendrier barré) : historique regroupé en périodes, déclaration
  d'une absence. Le regroupement vit dans `src/lib/absences-periodes.ts` (testé) : il
  part des **jours** et non de la table `absence` — 401 des 421 jours sont saisis au
  Planning sans période déclarée. Il enjambe les week-ends (écart ≤ 3 jours) et ne
  réunit jamais deux motifs différents. L'en-tête complet est dans `PersonnelEditor`
  (la page ne rend que `AppHeader`). ⚠️ **Recherche multi-colonnes** (flag `search` sur
  `COLS`) : porte sur matricule, badge, nom, prénom, H/F, équipe, atelier, pointure — **pas**
  sur Contrat, Statut ni Commentaire. En lecture seule, la colonne **Équipe garde sa
  pastille colorée** (`eqStyle`), comme sexe/TP/statut (l'atelier n'a pas de couleur).
  ⚠️ **Colonnes Contrat et Statut = résultantes** — plus de saisie directe. Un clic
  ouvre la modale `CycleDeVieModal` qui unifie **Arrivée / Contrats / Départ prévu**
  (auparavant éparpillés entre ContratsModal, AbsencesModal et le toggle Actif/Parti).
  L'ancien `<ToggleSwitch>` + le bouton loupe « Contrats » ont disparu.
  Contrats = seule source ; les dates arrivée/départ sont dérivées MIN/MAX. La bascule
  Intérim → CDD → CDI se fait en ajoutant un contrat. Motif de départ (retraite,
  démission…) = `contrat_periode.motif_fin` du dernier contrat.
  **Fiche incomplète** : pastille orange `!` devant le nom si la personne n'a
  **aucun contrat** dans `contrat_periode`. Clic = ouvre la modale Cycle de vie.
  Flag `hasContrat` calculé serveur (`page.tsx`) et propagé au client. Segment
  de filtre « Fiche · Toutes / ⚠ Incomplètes » + badge d'alerte dans l'en-tête.
  Filtre Statut par défaut = **Actif** (avec segments « À venir / Actif / Parti »).
  **Colonne Commentaire** dans la grille (`personne.commentaire`) : éditée inline en
  écriture, tronquée + info-bulle en lecture. ⚠️ Largeurs des colonnes resserrées (sauf
  Nom/Prénom) pour la loger, plusieurs libellés d'en-tête raccourcis (`Matr.` non — libellé
  complet gardé —, `Livret`, `⚠ 18m`, `Point.`, `Abs.`) ; `Abs.` et `Statut` ont en plus un
  padding latéral réduit (`tightPad`). `table-layout: fixed` normalise les `%`, c'est le
  **rapport** entre colonnes qui compte.
  ⚠️ **Bouton engrenage UNIQUE** (colonne d'actions, avec la case de fusion à sa droite) :
  ouvre la modale « fiche » regroupant **Commentaire → Poste fixe → RGPD** (les anciens
  boutons « i » Informations et « engrenage » RGPD ont été fusionnés). Apparaît dès
  `canEdit` **ou** `canRgpd` ; en lecture seule les champs sont en consultation et la
  section RGPD ne s'affiche que pour `rgpd: write`.
  ⚠️ **RGPD (export / anonymiser / supprimer)** : gouverné par le droit **`rgpd`** (write),
  et non plus `personnel: write` — modifier une fiche ne donne plus le droit d'effacer/
  anonymiser. Les 3 actions (`actions.ts` + `/api/personnel/[id]/export`) passent toutes par
  `requireModuleWrite("rgpd")` / `canWriteModule(role,"rgpd")`.
  **Poste fixe** : sélecteur dans la modale ci-dessus ; écrit `personne.poste_fixe_id`
  (clé du pré-remplissage du planning). La ligne porte un liseré indigo + 📌 sur l'engrenage
  quand un poste fixe est défini. Même donnée que la colonne « Titulaire » du Référentiel.
- Référentiel : `src/app/admin/referentiel/*` + `src/app/api/referentiel/route.ts`
  (colonnes **N° Rot**, **Habil. requises**, **Rempl.** (PTR/PTNR) et **Titulaire**).
  ⚠️ **Rempl.** = `poste.remplacable` (PTR remplaçable / **PTNR** non — un seul titulaire
  par conception). ⚠️ **Titulaire** (op `toggle-titulaire`, par personne) écrit
  `personne.poste_fixe_id` (même donnée que la fiche Personnel). **Modale à cases à cocher**
  comme les Habil. requises (avec recherche) : un poste peut avoir **plusieurs titulaires** ;
  une personne n'a qu'**un seul** poste fixe (colonne mono-valuée), donc la cocher ici la
  **détache** de son poste fixe précédent (la modale le signale : « titulaire de X »).
  ⚠️ **Unicité des codes par site** (2026-09-10, `verifierUniciteNom` dans
  `/api/referentiel`) : les écritures sur `poste.nom`, `poste.nom_court` et
  `ligne.nom` refusent (**HTTP 409**) tout doublon parmi les entités **actives** du
  site courant, insensible à la casse. L'id courant est exclu (un renommage à
  l'identique reste permis) ; un champ vide/null n'est jamais compté (les entités
  créées vides pour saisie inline restent supportées). `atelier.nom` **n'est pas**
  contraint (décision assumée : très peu d'ateliers, doublon improbable et sans
  risque de confusion). Le message serveur (« Ce nom court est déjà utilisé… ») est
  relayé par le champ `error` du JSON et affiché par `ReferentielEditor` à côté de
  l'indicateur d'enregistrement, gardé 4 s (contre 1,5 s en succès) pour laisser le
  temps de lire.
- Habilitations : `src/app/habilitations/{page,HabilitationsList,HabMark,HabLegendeModal,HabMajModal,AutorisationMark}.tsx`
  + `src/app/admin/habilitations-param/*` + `src/app/api/habilitations/route.ts`.
  Saisie **au clic sur une pastille** (modale pré-remplie) ; l'en-tête est rendu par
  `HabilitationsList`, pas par la page.
  ⚠️ **Recherche transverse au filtre atelier/équipe** (2026-09-09, même pattern que
  Matrice) : `page.tsx` ne borne PLUS les personnes par équipe/atelier en base — il
  charge tout l'effectif actif et passe un `displayedIds` qui décide du sous-ensemble
  affiché par défaut ; la recherche par nom balaie `personnes` en entier et fait
  apparaître quelqu'un hors du filtre (ex. taper GAUTREAU / Condi alors qu'on a filtré
  FAB). Le **bilan** (`bilan` dans `HabilitationsList`) est calculé sur
  `displayedPersonnes` — un chef d'atelier veut le bilan de son atelier, pas celui du
  site. La vue Liste (`shownRows`) suit la même règle.
- Utilisateurs : `src/app/admin/users/{page,NouvelUtilisateur,NouveauRole,UserRoleSelect,UserRowActions,LienMotDePasse,DroitsMatrix}.tsx`
  + `src/app/api/users/{create,role,active,reset-password}/route.ts` + `/api/droits`
  + `/api/roles` (création de rôles personnalisés, garde `utilisateurs: write`).
  Les rôles assignables viennent de `getAllRoles()` (`src/lib/roles-server.ts`) :
  intégrés + `role_custom`. Un rôle personnalisé naît sans droit.
- Bilans : `src/app/bilans/*` (Cockpit + 8 rapports détaillés, impression PDF via
  `@media print`). Liste des rapports centralisée dans `src/lib/bilans-rapports.ts`
  (partagée Cockpit ↔ `/platform` pour le masquage par site, cf. Plateforme).
  - **Synthèses hebdomadaires** (`/bilans/syntheses` + `SyntheseFilters`, `AgencePrintButton`,
    données dans `src/lib/synthese-data.ts`) : un écran, deux vues (bascule) sur un sélecteur
    de semaine. **Absences** = **mini-calendrier jour par jour sur 4 semaines glissantes**
    (semaine courante → S+3, le sélecteur décale la fenêtre d'1 semaine), hors intérim, liste
    **à plat**, **seules les personnes absentes** au moins un jour sur la fenêtre. Chaque case
    = un jour, teintée de la couleur du motif + **code court** (`abregerMotif`, lisible en N&B)
    + info-bulle ; colonne « Tot. » et récap **par motif** (personnes distinctes / jours).
    Filtrable atelier/motif. C'est une **projection** (jours tombant dans la fenêtre), plus le
    relevé de périodes complètes d'avant. **Intérim** : planning prévisionnel groupé **par
    agence** (`contrat_periode.agence_interim`), horaires résolus par `horaires.ts` ; chaque
    bloc agence liste en bas ses **intérimaires non planifiés** (« Pas de besoin cette
    semaine ») → une agence sans aucun placement **réapparaît** avec cette seule liste.
    **Export PDF par agence** (`AgencePrintButton` isole une section à l'impression ;
    `.print-hidden`/`.agence-print` dans `globals.css`).
    ⚠️ **Impression** (cf. `tasks/lessons.md` L36) : trois pièges de « page blanche » réglés
    dans le bloc `@media print` — saut de page agence borné aux blocs **réellement visibles**
    (`.agence-print:not(.print-hidden) + …`), `position: sticky` **neutralisé** dans les
    tableaux imprimés, et la grille du calendrier porte `print-flow` pour se **scinder**
    naturellement entre pages (le `break-inside: avoid` global des `.card` sortait une 1re
    page quasi vide sur un tableau plus haut qu'une page).
  - **Polyvalence & compétences** (`/bilans/polyvalence`, `src/lib/polyvalence-competences-data.ts`) :
    **FUSION** (2026-09-08) des trois anciens rapports de compétences — Polyvalence,
    Plan de montée en compétence, Compétences critiques — en une lecture RH unique
    **constat → risque → action**, avec sous-navigation ancrée (imprimable d'un bloc).
    Décision de cadrage : la couverture est mesurée **à l'opérationnel** — une personne
    « tient » un poste si niveau ≥ `niveau_min_requis` **et** habilitation valide
    aujourd'hui ; le **seuil « compétent » paramétrable n'est plus utilisé ici** (il
    donnait trois définitions incohérentes de « poste fragile »). 4 blocs : ① polyvalence
    moyenne par service (**interne** : postes du service d'affectation tenables aujourd'hui)
    + personnes à développer ; ② postes critiques/fragiles par **relève sûre** (départs
    ≤ 180 j + expirations d'habilitation ≤ 90 j déduits) + **PTNR isolés** ; ③ personnes
    clés sur le départ + habilitations à échéance ; ④ plan de formation priorisé par
    fragilité. Le moteur de relève opérationnelle vit dans la couche données dédiée.
    ⚠️ `montee-competence` et `competences-critiques` ont été **supprimés** (pages + entrées
    `RAPPORTS_BILAN`) ; d'anciens `site_module` `bilan:montee-competence` /
    `bilan:competences-critiques` deviennent inertes.
    ⚠️ **Filtre Équipe** (2026-09-10, `ReportEquipeFilter`, `?equipe=`) sous le
    filtre Service : restreint la POPULATION analysée — polyvalence, personnes à
    développer, personnes clés partantes, habilitations à échéance, plan de
    formation, titulaires PTNR listés. **L'analyse structurelle des postes**
    (relèves, verdicts, fragilité) reste **GLOBALE** — un poste avec 3 relèves ne
    devient pas fragile parce qu'une seule est de l'équipe filtrée (décision
    assumée : sinon la lecture « qui est en danger » deviendrait fausse). Impl.
    dans `chargerPolyvalenceCompetences({ atelier, equipe })` via le prédicat
    `dansEquipe(pid)`.
  - **Assez de compétences ?** (`/bilans/assez-competences`, `src/lib/assez-competences-data.ts`,
    nav quinzaine `CouvertureSemaineNav`) : aide à la **validation des congés**, avant toute
    affectation. Grille **service × jour ouvré × créneau** sur 2 semaines. **Affectation
    optimale globale** chaque jour (`buildJourFlow`, une personne = une place, jamais
    comptée deux fois — moteur partagé avec la Projection). **Besoin par (poste × quart
    posté)** : source **référentiel** (`poste_quart`, défaut actif) par défaut, données
    **ordonnancement** quand le jour est initialisé (`jour_quart`/`ouverture_quart`). ⚠️ La
    **« journée »** (régulière) = agrégat pleine-journée (quart sans créneau au plus petit
    ordre, comme reset-week) : **jamais ajoutée** à matin/après-midi ; comptée seulement si
    c'est le **seul** quart du poste (`quartsEffectifs`). PTNR exclus. Présence = hors congé,
    hors TP indisponible (rotation datée), dans l'effectif (contrats).
  - ⚠️ **PTR/PTNR dans les rapports** (`poste.remplacable`, migration 0059) : « nettoyer +
    isoler ». Cockpit, **Polyvalence & compétences** et **Assez de compétences ?**
    **excluent** les PTNR des « postes fragiles / sans relève / écart-cible / besoin »
    (un titulaire unique par conception n'est pas une anomalie). **Polyvalence & compétences**
    les **isole** dans « **Postes à titulaire unique (PTNR)** » (bloc ②) : le vrai risque
    n'est pas l'absence de relève mais le **départ du titulaire** (fin de contrat, retraite)
    ou une **habilitation qui expire**.
- Affichage TV : `src/app/affichage/atelier/[atelier]/page.tsx` (public, refresh 5 min,
  **vue par nom uniquement**). ⚠️ Depuis 2026-08-25, l'écran est rattaché à
  l'**atelier d'affectation** (`personne.atelier_id`), pas à l'atelier de placement :
  une personne n'apparaît que sur SON atelier (roster = personnes dont `atelier_id`
  = cet atelier), **une seule fois**, même les jours où elle est prêtée ailleurs.
  Un placement sur un poste d'un **autre** atelier est annoté « (Atelier X) » sous
  le nom du poste (carte globale `posteInfo` = tous les postes du site → nom + atelier).
  Les personnes d'un autre atelier prêtées ici n'y figurent PAS — **sauf** les
  personnes **sans atelier d'affectation** (`atelier_id` null) : pas d'écran maison,
  donc elles restent sur leur atelier de **placement** (découvertes via `plHere`,
  les placements sur les postes de cet atelier dont `personne.atelier_id` est null).
  Allègement : une personne **qui ne travaille JAMAIS sur toute la période affichée**
  est retirée — prédicat `toutOff` = aucun placement **et** chaque jour affiché « off »
  (**absence OU TP**). Couvre l'absence complète (historique), le **TP complet** et un
  mélange absence/TP ; les absences/TP **partiels** restent visibles (« Absence » / « TP »
  sur les jours concernés).
  Colonnes (`shownDays`) = jours **ouverts** de CET atelier (`openDays`) **∪** jours
  où au moins une personne affichée est **placée** (`placementDays`) : ce second
  terme fait apparaître la feuille même quand l'atelier maison est fermé ce jour-là
  mais que des gens sont **prêtés** ailleurs.
  ⚠️ **Éclatement Matin / Après-midi** (2026-09-09) : deux tableaux EMPILÉS, en-têtes
  teal foncé (Matin) puis brun-rouge (Après-midi). Chaque personne est classée dans
  UNE SEULE section, d'après (dans l'ordre) : (1) créneau du quart de son placement
  **le plus fréquent** sur la fenêtre affichée (matin/aprem, `quart.creneau`) ; (2)
  à défaut (nuit, journée, ou aucun placement matin/AM) créneau du quart de son
  **équipe** cette semaine via rotation datée / quart fixe ; (3) matin par défaut.
  Objectif : réduire la longueur de chaque section pour un écran de couloir.
  ⚠️ **Fenêtre paramétrable en Param RH** : mode *relatif* (jours autour d'aujourd'hui,
  historique) ou *absolu* (N semaines calendaires à partir du lundi de la semaine
  courante — S, S+1…) — migration 0067, `getFenetreAffichage()` + `joursDeFenetre()`
  dans `src/lib/parametres.ts`. La page passe TOUJOURS par `joursDeFenetre(fen, pivot)`
  — plus d'appel direct à `joursAutour()`.
- Param. RH (clé de droit toujours `motifs`, route toujours `/admin/motifs`) :
  `src/app/admin/motifs/{page,actions,FenetreAffichageInline}.tsx(ts)`. L'écran regroupe
  désormais **quatre sections** : Motifs d'absence, Agences d'intérim (menu Agence de
  `PeriodesEditor`), Types de contrat (menu Contrat de `PersonnelEditor` et
  `PeriodesEditor`, alimenté par la table `type_contrat`), Fenêtre d'affichage du
  planning (auto-save via `/api/param-affichage` — cf. `src/lib/parametres.ts`,
  `getFenetreAffichage()`). ⚠️ **Deux MODES** (2026-09-10, migration 0067) :
  *relatif* (jours avant J / jours après J autour d'aujourd'hui, historique) ou
  *absolu* (N semaines calendaires 1..6 à partir du lundi de la semaine courante —
  S, S+1…). Radio dans le formulaire, un seul jeu d'inputs affiché à la fois. La
  fenêtre calculée passe par `joursDeFenetre(fen, pivot)` — utilisé par
  `/affichage/atelier/[atelier]` et `/affichage/impression`.
- Absences (écran Planning) : `src/app/absences-specifiques/{page,AbsencesEditor}.tsx`
  — reconstruit les périodes de TOUT l'effectif à partir des jours d'absence
  (`grouperAbsences`), pas de la seule table `absence` (401 jours sur 421 saisis au
  planning sans période déclarée). Même UX que la modale Personnel : édition inline
  (motif via palette, période au calendrier 2 mois, commentaire), crayon + corbeille,
  vérification de conflit avant écrasement. Popovers en `position: fixed` (piège
  `overflow: auto` de la carte modale, cf. patterns UI).
  ⚠️ **Filtres nom + atelier SYNCHRONISÉS À L'URL** (2026-09-09, `?search=` / `?atelier=`) :
  état local pour la réactivité de la frappe, `router.replace()` sans historique à chaque
  modif. Sans cette sync, un `router.refresh()` ultérieur (déclenché par une écriture)
  ré-appelait le server component qui relisait `?search=` inchangé → le nom effacé
  localement « revenait » à l'écran (bug vécu). Le lien « ← Planning » vit dans
  `AbsencesEditor` (client) et lit ces mêmes params → retour cohérent avec l'état visible.
  Le lien 🤒 du Planning (`src/app/planning/page.tsx`) transmet `?atelier=` + `?search=`
  pour préserver le contexte à l'aller.
- Plateforme (super_admin) : `src/app/platform/*` — back-office multi-site.
  `/platform/[id]` porte la section **« Éléments visibles pour ce site »**
  (`ModulesMasquesEditor.tsx` + server action `setModuleMasque`) : masquage
  **par site**, pour tous les users, au-dessus de la matrice. Table
  `site_module` (présence = masqué), helper `src/lib/site-modules.ts`
  (`getModulesMasquesC()`, impersonation-aware, `cache()` par requête).
  Trois familles d'éléments masquables : les **menus** (clés de `MODULES`) —
  blocage réel : `requireModule` redirige vers `/` si masqué, `AppHeader`
  filtre la nav ; des **extras hors nav** (`MASQUABLES_EXTRA` dans
  `site-modules.ts`) — aujourd'hui `guide` (lien « Guide utilisateur » du
  `UserMenu`, affiché si `guideVisible`, passé par `AppHeader`) ; et les
  **rapports Bilans** — section séparée « Rapports détaillés (Bilans) » sur
  `/platform/[id]`, clés `bilan:<slug>` de `RAPPORTS_BILAN`
  (`src/lib/bilans-rapports.ts`, source unique clé/libellé/href/icône/desc +
  module de garde). Le Cockpit (`/bilans`) filtre ses navcards sur
  `getModulesMasquesC()` ; chaque page-rapport garde via `requireRapportBilan(slug)`
  (applique la garde de module `bilans`/`matrice` **puis** redirige vers `/bilans`
  si le rapport est masqué). Réglage **indépendant** du masquage du menu Bilans.
  `setModuleMasque` accepte une clé de `MODULE_KEYS`, de `CLES_MASQUABLES_EXTRA`
  **ou** de `CLES_RAPPORTS_BILAN`.
- Migrations : `supabase/migrations/0001..0069` (dernière appliquée : **0069** —
  `ligne.regroupement` + `personne.regroupement` (texte nullable) : **regroupement de
  lignes**, étiquette de reporting saisie inline au Référentiel et posée en affectation
  via la colonne « Service » du Personnel ; exploitée en sous-totaux par le bilan
  **Projection — feuille de route** uniquement. Pas un niveau de hiérarchie.
  **`0068`** = `quart.couleur` (hex `^#[0-9a-f]{6}$`) : **bandeau de rappel du quart** en tête du
  Planning, réglé par site dans `/admin/equipes` « Horaires des quarts » (input hex +
  aperçu) ; seeds « doux » matin/après-midi/nuit/journée ; en mode AUTO le bandeau
  devient gris neutre « Tous quarts affichés » — le manager sait qu'il n'est plus sur
  un quart précis. Cf. `src/app/planning/QuartBandeau.tsx`, actions serveur et
  lectures tolèrent l'absence de la colonne. **`0067`** = `parametre_affichage.mode`
  (`'relatif' | 'absolu'`) + `nb_semaines` (1..6) : **mode d'affichage TV**
  paramétrable dans Param RH — *relatif* (X jours avant/Y jours après aujourd'hui,
  historique) OU *absolu* (N semaines calendaires à partir du lundi de la semaine
  courante — S, S+1…) ; API `getFenetreAffichage()` + `joursDeFenetre()` dans
  `src/lib/parametres.ts`, lecture/écriture tolérantes. **`0066`** = `motif_absence.code_gt`
  (code du logiciel RH rattaché à un motif, colonne « Code GT » dans Param RH) + table
  `import_absence_personne` (équivalence apprise *matricule fichier RH → personne*, les
  matricules RH ne correspondant pas à Polaris). Support de l'**import des absences RH**
  depuis Param RH : dépôt du CSV → aperçu (appariement **par nom**, motifs manquants créés
  d'après leur Code GT) → écriture qui **remplace** les jours d'absence sur la fenêtre du
  fichier. Parser/appariement purs et testés dans `src/lib/import-absences-rh.ts` ;
  route `/api/import-absences` (garde `motifs`), UI `src/app/admin/motifs/ImportAbsences.tsx`.
  Chaque ligne datée = **journée entière** d'absence. **`0065`** =
  ouverture de `competence_niveau_libelle.couleur` au **nuancier** — CHECK de format
  hexadécimal en remplacement du verrou 4 teintes de 0063, liste fermée imposée côté
  app ; migration idempotente rattrapant « 0063 jamais appliquée » ; **`0064`** =
  `placement.tp` + table `tp_charge` — temps partiel MATÉRIALISÉ dans le planning,
  déplaçable au glisser-déposer ; `tp_charge` marque une semaine « chargée » et
  éteint le calcul virtuel du TP ; **`0063`** = `competence_niveau_libelle.couleur` —
  couleur paramétrable par niveau ; **`0062`** = `site.seuil_competent`, seuil
  « compétent » ; **`0061`** = `site.nb_niveaux`, nombre de niveaux activés par site).
- **Écritures : lire l'erreur, toujours.** `messageErreur()` (`src/lib/erreurs.ts`) traduit
  les codes Postgres ; les server actions repassent le message par l'URL
  (`urlAvecErreur` → `?err=`) et la page l'affiche via `<BandeauErreur>`. Un test
  (`ecritures-verifiees.test.ts`) échoue si une écriture n'est pas destructurée.
- **Séquences « effacer puis réécrire » → fonction SQL.** `set_rotation_reference`,
  `creer_absence`, `maj_absence` (migration 0037, `SECURITY INVOKER` : le modèle
  d'autorisation est inchangé). En deux requêtes applicatives, un échec de la seconde
  perdait la donnée en silence — la rotation n'est pas reconstituable. Le même test
  interdit le retour au `delete` + `insert` applicatif sur ces tables.
- Tests (Vitest, **268** au 2026-09-10) : règles pures + `permissions.test.ts`
  (droits par défaut, périmètre du chef d'équipe, anti-escalade), `roles.test.ts`
  (slugifyRole), `routes-gardees.test.ts` (inventaire : **toute route API porte
  une garde** — le proxy exclut `api/`, une route nouvelle serait publique — et
  aucun rôle en dur). **Quatre tests statiques multi-site** :
  `routes-multi-site.test.ts` interdit un INSERT/UPSERT sur table site-scopée
  sans `site_id` ; `refdata-cache.test.ts` interdit un `unstable_cache` sans
  argument `site` (sinon les entrées de cache seraient partagées entre sites) ;
  `admin-client.test.ts` interdit un fichier utilisant `getAdminClient()` qui
  ne mentionnerait jamais `site_id` (whitelist : `/platform`, `current-*`,
  `password-link`, `supabase-server`) ; **`isolation-site.test.ts`** (Sujet 1,
  2026-08-23) va plus loin : dans un fichier admin-client, **chaque
  `.select`/`.update`/`.delete` sur une table site-scopée doit être borné par
  `.eq("site_id", …)`** dans la même chaîne — ferme le trou « lecture/écriture
  par `id` nu » que les deux précédents laissaient passer (même classe de faille
  que `userAdminGuard`). `vitest.config.ts` résout l'alias `@/`,
  sans quoi le socle n'est pas testable.
