# Architecture — Polaris

Application web de gestion des plannings d'usine (matrice de polyvalence,
placement journalier, habilitations, visites médicales, affichage couloir, bilans).

> Vue d'ensemble et règles de travail : **CLAUDE.md**.

## Stack
- **Next.js 16** (App Router, Server Components + Server Actions) + React 19 + TypeScript
- **Supabase** : PostgreSQL + Auth + Row Level Security (RLS), via `@supabase/ssr`
- **Déploiement** : Vercel (push GitHub → build automatique, région `cdg1`, Fluid Compute)
- **Tests** : Vitest (règles métier pures)

## Couches
- `src/lib/supabase.ts` — client navigateur (clé anon, soumis à la RLS).
- `src/lib/supabase-server.ts` — `getServerClient()` (session utilisateur, RLS) et
  `getAdminClient()` (service_role, **bypass RLS**, usage serveur contrôlé : invitations,
  export RGPD, écritures « module » validées, lectures d'`app_user` et du dossier médical
  bornées au site — 0092).
- `src/lib/current-user.ts` — `getCurrentProfile()`, `requireAdmin()`. Ligne `app_user` en
  cache inter-requêtes (`PROFIL_TAG`, invalidé par `/api/users/*` et `/platform`).
- `src/lib/permissions.ts` — matrice de droits par module (`MODULES`, `defaultsFor`,
  `getPermissions`, `canRead`/`canWrite`, `canWriteModule`, `requireModule`). Surcharges
  `role_permission` en cache (`PERMISSIONS_TAG`, invalidé par `/api/droits`).
- `src/lib/refdata.ts` — cache des données de référence (`unstable_cache`, segmenté par site,
  invalidé par tag à chaque écriture ; `revalidate` 300 s en filet) : services, équipes, quarts, motifs,
  niveaux, rotation, types d'agence, et depuis le 2026-10-14 le **référentiel des postes**
  (`REFERENTIEL_TAG` : lignes + postes, `poste_quart`, dates d'ouverture, horaires).
  ⚠️ En route API, invalider par `revalidateTag(tag, { expire: 0 })` (`updateTag` lève).
- `src/lib/fetch-all.ts` — `fetchAll()`. PostgREST plafonne **chaque réponse à 1000 lignes**
  (`db-max-rows`) sans lever d'erreur. Toute lecture d'une table qui peut dépasser ce
  seuil (`matrice`, `personne_competence`, `placement`, `ouverture_quart`,
  `contrat_periode`, `visite`, `personne` lue sans filtre de statut) doit passer par cet
  utilitaire, avec un `.order()` déterministe. La 1re tranche demande le total
  (`count=exact`), puis exactement les tranches restantes par vagues de 8.
- `src/proxy.ts` — protège les routes : jeton vérifié par `getClaims()`, sinon redirection vers
  `/login?next=<page>`. Public : `/login`, `/forgot`, `/reset`, `/auth/*` (plus `/affichage`
  depuis le 2026-11-03). Tout `next` passe par `cheminInterne()` (`src/lib/redirection.ts`,
  anti-redirection ouverte, aussi dans `/auth/callback` et `/login`).
- `next.config.ts` — en-têtes de sécurité sur toutes les pages (2026-11-04) : CSP
  (`default-src 'self'`, Supabase seul en `connect-src`, `frame-ancestors 'none'`,
  `object-src 'none'`), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`,
  `Permissions-Policy` ; `poweredByHeader: false`. Un nouveau domaine externe (script,
  image, API) doit y être ajouté, sinon le navigateur le bloque.
- `src/components/AppHeader.tsx` — navigation par rôle + cloche d'alerte habilitations.

## Modèle de données (Supabase / PostgreSQL)
- **Auth & droits** : `app_user` (compte + rôle), liée à `auth.users` (trigger
  `handle_new_user`, compte créé **inactif** depuis 0092) ; écrite **uniquement** en
  service_role (aucun droit d'écriture à `authenticated`, 0092), lue sous RLS pour sa
  propre ligne seulement (+ l'admin du site) ; `role_permission` (surcharge de la matrice de droits par module).
- **Référentiel** : `atelier` (= « service » à l'écran ; `ordre_affichage`, 0085 : ordre des
  services sur tous les écrans) > `ligne` (`couleur`, 0082 : couleur fixe sur les PDF du
  Placement, palette fermée `src/lib/ligne-couleurs.ts`) > `poste` (`effectif_requis` = abaque **déprécié**,
  repli de l'effectif par quart depuis 0070 ; `nom_court`,
  `categorie` manager/conducteur/operateur, `niveau_min_requis`, `objectif_polyvalence`,
  `objectif_cible`, `ordre_affichage`, `zone_attente` — 0077 : poste de pré-affectation
  à répartir, ex. CDT ; hors matrice et hors bilans de compétence), `equipe` (+ `quart_fixe`), `equipe_chef`.
  `ligne` et `poste` portent aussi `date_ouverture`/`date_fermeture` (0071 :
  ouverture/fermeture datée, helper `src/lib/referentiel-validite.ts`).
- **Quarts** : `quart` (code figé à la création, `libelle`, horaires, `rotation`, `creneau`,
  `couleur`, `nuit` — 0076, réglable aussi dans Équipes),
  `rotation_reference` (**rotation par référence datée** : une semaine (lundi) × équipe →
  quart ; l'alternance des semaines suivantes est *calculée* par `src/lib/rotation.ts`,
  jamais stockée — pour une semaine cible, la référence active est la plus récente ≤ cette
  semaine, donc changer la rotation = ajouter une référence datée sans toucher le passé),
  `poste_quart` (**effectif PAR quart** depuis 0070, colonne
  `effectif_requis` : trois états lus par `src/lib/poste-quart.ts` — aucune ligne =
  repli sur `poste.effectif_requis` ; `actif=false` = « – » ne tourne pas ;
  `actif=true` = tourne à 0 ou N. L'ancien « ne stocke que les désactivations » n'est
  plus vrai), `jour_quart`, `ouverture_quart`, `horaire_poste` (poste × quart × jour,
  = horaire *standard* affiché à la TV et proposé par défaut dans la pendule du planning ;
  variante facultative `debut_apres_nuit` / `fin_apres_nuit`, 0087, appliquée quand la ligne a
  tourné de nuit la veille), `horaire_place` (0088 : horaire d'une **place** = numéro de
  rotation du poste, toute la semaine, avec sa variante après une nuit). Résolution :
  `src/lib/horaires.ts` (`horaireDuPoste`, `resoudreHoraire`) et `src/lib/nuit-avant.ts`.
- **Personnel** : `personne` (équipe, atelier, type_contrat, sexe, `numero_badge`,
  `date_livret_accueil`, temps partiel `tp_config` jsonb ; champs RGPD
  `anonymise`/`anonymise_at`) ; `contrat_periode` (source de vérité du cycle de vie).
  ⚠️ **`personne.statut` (`A_VENIR` / `ACTIF` / `PARTI`) est un cache calculé
  automatiquement** par trigger DB à partir des contrats (migrations 0049 + 0050) —
  plus de saisie manuelle. Arrivée = `MIN(contrat_periode.date_debut)` ; départ prévu =
  `MAX(date_fin)` si aucun contrat ouvert ; motif de départ = `motif_fin` du dernier
  contrat. Les anciens champs `personne.date_arrivee` / `date_depart_prevu` /
  `motif_depart` ont été **supprimés en 0050**. `personne.poste_fixe_id` (titulaire du
  poste) est remis à null quand le statut passe à `PARTI` (trigger 0078).
- **Matrice** : `matrice` (niveau actuel/cible par personne×poste, valeur spéciale
  « restriction »), `competence_niveau_libelle` (échelle paramétrable : `libelle` +
  `couleur` par niveau, migration 0063). L'échelle du carré magique se règle par site
  dans `/admin/competences` : `site.nb_niveaux` = nombre de niveaux positifs activés
  (2..4, 0061), `site.seuil_competent` = niveau minimal « compétent » des bilans
  (1..4 borné à ≤ nb_niveaux, 0062), et une couleur par niveau positif choisie dans
  une palette fermée de 4 teintes (0063). Le niveau 0 (blanc = aucune compétence) et
  la restriction restent toujours présents.
- **Habilitations** : `competence` (`a_recycler`, `duree_validite_mois`, `categorie`,
  `groupe`, `ordre`, `a_autorisation_conduite`), `personne_competence`
  (`date_obtention`, `date_expiration` **stockée à la saisie** = obtention + `duree_validite_mois`,
  `date_autorisation_conduite`). Changer la durée d'une formation recalcule les échéances
  déjà saisies (`src/lib/echeances-habilitations.ts`, une ligne de lot au Journal, 2026-11-04) ;
  `personne_competence_historique` (0084 : ajout / modification / suppression, écrite par
  déclencheur, reprise depuis `audit_log` ; une suppression n'efface plus rien).
- **Planning** : `placement` (1 personne/jour : poste,
  ou motif d'absence, ou non travaillé), `horaire_exception` (personne × jour),
  `absence` (période longue → `placement.absence_id`, cascade),
  `semaine_type` (+ ouverture, profils).
- **Absences** : `motif_absence` (paramétrable, couleur ; `visite_reprise` depuis 0076 ;
  `visible_operateurs`, 0083 : motif montré sur le « PDF pour Affich. »).
- **Visites médicales** (0076, module RH) — **aucune donnée de santé** : des dates, un
  type de visite, et un `avis` borné par CHECK à quatre valeurs (attestation, apte, apte
  avec aménagements, inapte).
  - `visite_regime` (plafonds par régime `simple` / `adapte` / `renforce`, PK
    `(code, site_id)`), `visite_type` (catalogue, `categorie` qui fixe le comportement :
    initiale / periodique / intermediaire / reprise / ponctuelle), `visite_anci_usage`
    (usages d'attestation de non contre-indication : conduite, électrique…),
    `visite_parametre` (clé / valeur, défauts portés par `src/lib/visites.ts`).
  - `visite` (personne × type : `date_rdv`, `date_visite`, `avis`, `prochaine_date` fixée
    par le professionnel, `professionnels` / `prochains_professionnels` = médecin et/ou
    infirmière, 0081, commentaire logistique) et `visite_anci` (usages délivrés par
    la visite).
  - `personne_suivi` (`suivi_adapte` **sans motif**, `regime_force`) et
    `contrainte_affectation` (quart ou poste exclu sur une période, **sans motif**).
  - **Aucune lecture sous RLS** (0092) pour `visite`, `visite_anci`, `personne_suivi`,
    `contrainte_affectation` : l'écran Suivi (après `requireModule("visites")`) et
    l'avertissement du Placement lisent en service_role borné au site.
  - Drapeaux posés sur les référentiels existants, écrits **seulement** par
    `/api/visites-param` : `quart.nuit` (aussi réglable dans Équipes depuis 0087),
    `poste.suivi_renforce` / `suivi_motifs` / `anci_usages` (tableaux, 0080 ; les colonnes
    scalaires `suivi_motif` / `anci_usage` ont été supprimées en 0089), `competence.suivi_renforce` /
    `anci_usage`, `motif_absence.visite_reprise`.
  - Le **régime n'est pas stocké** : il est recalculé à chaque affichage
    (`evaluerPersonne`) depuis ces drapeaux, les placements récents et les habilitations.
- **Filet inter-sites** (0092) : trigger générique `verifier_site_fk` posé sur toute FK
  (une colonne) entre deux tables portant `site_id` (hors `site` / `app_user`) — refuse une
  référence vers une ligne d'un autre site, même en service_role. Une nouvelle table est
  couverte en rejouant le bloc DO de 0092. Les références vers `app_user` (chefs) restent
  vérifiées dans le code (`verifierIdSite` / `verifierFksSite`).
- **Transverse** : `audit_log` (alimenté par triggers ; `lot` / `lot_libelle` depuis 0086),
  `site.journal_conservation_mois` (0086).

## Rôles & périmètres
Deux couches, à ne pas confondre :
1. **Matrice de modules** (`role_permission` + `defaultsFor()`) : `none` / `read` / `write`
   par module et par rôle.
2. **Périmètre RLS** : `can_edit_personne()` = admin **ou** chef de l'équipe de la personne.

`canWriteModule()` renvoie toujours `false` pour `chef_equipe` : même si le module est en
`write`, le chef n'obtient jamais le client admin et reste borné à son équipe par la RLS.

**Rôles personnalisés** (migration 0042) : en plus des rôles intégrés, des rôles sur mesure
(`role_custom`) sont créés depuis l'écran Utilisateurs. Un rôle personnalisé naît **sans
aucun droit** ; la matrice décide seule (aucun nom de rôle en dur côté serveur).

**Multi-site** (migrations 0043 → 0054) : l'application est **multi-tenant** — une seule
base, un `site_id` sur chaque table métier, isolation par RLS. Chaque site a ses propres
référentiels (droits, rôles, motifs, contrats, compétences, quarts). Détail complet du
chantier : `tasks/multi-site.md`.

Écriture en base :
- Référentiel, équipes, compétences, motifs, objectifs, personnel : **admin**.
- Comptes (`app_user`) : **service_role seulement** (`/api/users/*`, `userAdminGuard`).
- Matrice / placement / habilitations : **admin ou chef de l'équipe** (`can_edit_personne()`).
- Ouverture de lignes, rotation des équipes : **admin ou ordo** (`has_role('ordo')`).
- Journal d'audit : la matrice décide (module `journal`) ; l'écran lit en service_role
  borné au site (la RLS `can_read_audit()` nomme encore admin + codir, simple filet).
- Visites médicales : modules `visites` et `visites_param`, accordés au seul rôle `rh`
  par défaut. Aucune lecture sous RLS (0092) : lecture et écriture en service_role
  bornées au site, après la garde du module (`requireModule` / `moduleWriteGuard`). Le Placement n'en voit qu'un avertissement **sans
  motif** (`src/lib/visites-placement.ts`), désactivé par défaut.

Rôles : `admin`, `chef_equipe`, `ordo`, `rh`, `codir`, `planning`.

## Audit
Triggers PostgreSQL (`audit_trigger`) sur les tables métier → `audit_log`
(qui, action, table, ancienne/nouvelle valeur en JSON, site, lot).
- **Format compact** (0090) : une modification ne garde, avant comme après, que les champs
  modifiés + des champs de contexte (personne, jour, quart, poste, motif, nom, rôle…) ; les
  colonnes techniques (`id`, `created_at`, `updated_at`, `created_by`, `site_id`…) sont
  retirées (l'identifiant reste dans `record_id`, le site dans `site_id`) ; une écriture
  sans changement utile ne laisse plus de ligne. Lignes antérieures au 2026-10-14 : complètes.
- **Auteur** (refonte 0086) : `auth.uid()` ; sinon l'en-tête `x-polaris-auteur` que le
  serveur joint à chaque écriture service_role (fetch des clients Supabase,
  `src/lib/journal-contexte.ts`) ; sinon les colonnes d'auteur de la ligne. Avant 0086,
  36 % des entrées (dont tous les changements de droits) tombaient en « Système ».
- **Lots** : une opération de masse (copie, pré-remplissage, réinitialisation, imports,
  absence sur une période) passe par `avecLotJournal()` ; ses lignes portent le même `lot`
  et une ligne de synthèse `LOT` est ajoutée (`journal_clore_lot`).
- **Écran** `/journal` : filtres dans l'URL (période, auteur, élément, action, recherche
  personne / poste / habilitation), 100 lignes par page, Planning + Polyvalence masqués par
  défaut, élément décrit en clair (`src/lib/journal.ts`, testé), badge « via support ».
- **Conservation** : `site.journal_conservation_mois` (13 par défaut), purge
  `journal_purger()` à l'ouverture du Journal. **RGPD** : anonymiser une personne efface les
  lignes de sa fiche, la supprimer efface tout ce qui la référence
  (`journal_purger_personne`). Ces fonctions sont réservées au service_role. Avant de
  supprimer, la fiche affiche ce qui serait effacé (jours placés passés / à venir, absences,
  habilitations, contrats : `/api/personnel/[id]/impact`) ; anonymiser et supprimer sont
  bornés au site courant.

## Migrations
Fichiers SQL ordonnés dans `supabase/migrations/` (**0001 → 0094**, dernière appliquée :
**0094**), **exécutés manuellement** par l'utilisateur dans le SQL Editor Supabase
(`SUPABASE_DB_URL` est vide ; `npm run db:migrate` ne fonctionne que s'il est défini).

Depuis la **0037**, trois séquences délicates passent par des **fonctions SQL** appelées
en RPC : `set_rotation_reference`, `creer_absence`, `maj_absence`. Elles s'exécutent dans
la transaction de l'appelant — un `delete` puis un `insert` deviennent indivisibles —
sans changer le modèle d'autorisation (`SECURITY INVOKER`). Auparavant, un échec de la
seconde requête laissait la donnée corrompue en silence.

La **0038** a supprimé trois tables mortes (`equipe_quart_semaine`, `ligne_ouverture`,
`jour_equipe`) que plus aucune lecture n'utilisait ; la **0039** ajoute le départ prévu.
La **0040** paramètre les types de contrat (`type_contrat`) et la fenêtre d'affichage
du planning (`parametre_affichage`, singleton `id=1`) ; la **0041** retire le CHECK
enum sur `personne.type_contrat` et `contrat_periode.type_contrat` (validation côté
application, cf. `lessons.md` L23) ; la **0042** ouvre les **rôles personnalisés**
(`role_custom`) et retire le CHECK sur `app_user.role` (validation côté application :
intégrés + `role_custom`).

**Chantier multi-site (0043 → 0063)** — cf. `tasks/multi-site.md` et CLAUDE.md pour le détail :
- **0043–0048** — socle multi-tenant : table `site`, `site_id` sur les tables métier,
  RLS d'isolation, `est_super_admin`, FKs simplifiées pour PostgREST, impersonation
  par header (`x-impersonate-site`, honoré uniquement pour un super_admin).
- **0049–0050** — cycle de vie du personnel : `personne.statut` devient un cache calculé
  par trigger, `contrat_periode` devient la source de vérité (champs de départ supprimés).
- **0051** — `parametre_affichage` multi-site ; **0052** — périodes de temps partiel
  (`tp_periode`).
- **0053** — **séparation totale des référentiels par site** : `motif_absence`,
  `type_contrat`, `role_custom`, `role_permission`, `competence`,
  `competence_niveau_libelle`, `quart` passent tous en `site_id NOT NULL` (chaque site a
  sa propre matrice des droits, ses rôles, motifs, contrats, compétences et quarts).
- **0054** — commentaire libre sur `personne_competence`.
- **0055–0060** — `app_user`/`audit_log` scopés au site courant (0055) ; table
  `site_module` (masquage d'éléments par site depuis `/platform`, 0056) ;
  `quart.rotation`/`quart.creneau` (0057) ; `site_id` sur `tp_periode` (0058) ;
  `poste.remplacable` (PTR/PTNR) + `personne.poste_fixe_id` (0059) ;
  `motif_absence.non_planifie` (0060).
- **0061–0063 — échelle du carré magique paramétrable par site** (réglée dans
  `/admin/competences`) : `site.nb_niveaux` (nombre de niveaux positifs activés,
  2..4, 0061) ; `site.seuil_competent` (niveau minimal « compétent » des bilans,
  1..4 borné à ≤ nb_niveaux, 0062) ; `competence_niveau_libelle.couleur` (couleur
  par niveau positif, palette fermée de 4 teintes, CHECK en base, 0063). Le niveau
  0 (blanc) et la restriction restent toujours présents. Lectures résilientes
  (`getNbNiveauxC` / `getSeuilCompetentC` / `getCouleursNiveauxC`, replis 4 / 2 /
  échelle historique).

**Après le multi-site (0064 → 0078)** :
- **0064** — temps partiel **matérialisé** dans le planning (`placement.tp`, semaine
  « chargée ») ; **0065** — couleur de niveau ouverte au nuancier (rattrapage 0063) ;
  **0066** — import des absences depuis le logiciel RH (écran retiré le 2026-11-05, table
  `import_absence_personne` laissée en base) ; **0067** — affichage TV en mode
  relatif ou absolu ; **0068** — `quart.couleur` (bandeau de rappel du Planning).
- **0069** (deux fichiers) — cible de la matrice alignée sur le niveau actuel ;
  `regroupement` de lignes (étiquette de reporting).
- **0070** — **effectif par quart** (`poste_quart.effectif_requis`, trois états) ;
  **0071** — ouverture / fermeture datée des lignes et postes ; **0072** —
  `type_contrat.avec_agence` (généralise l'intérim) ; **0073** — `poste.imprimable`.
- **0074** — suppression de policies RLS permissives orphelines ; **0075** — RLS en
  forme InitPlan (`(select public.current_site_id())`, une évaluation par requête).
- **0076** — module **Visites médicales** (tables `visite_*`, `personne_suivi`,
  `contrainte_affectation`, drapeaux sur `quart` / `poste` / `competence` /
  `motif_absence`, seed des régimes, types et usages sur tous les sites).
- **0077** — `poste.zone_attente` (vue « Par poste » du Planning, colonne « À répartir »
  du Placement) ; **0078** — un départ libère le poste fixe (trigger
  `liberer_poste_fixe_au_depart` sur la mise à jour du statut, + rattrapage).

**Octobre 2026 (0079 → 0090)** :
- **0079 → 0081** — visites : professionnel vu / attendu (médecin, infirmière, cumulables
  en 0081) ; poste à risque avec plusieurs motifs et attestations (0080).
- **0082** — `ligne.couleur` ; **0083** — `motif_absence.visible_operateurs` ;
  **0084** — historique des habilitations ; **0085** — `atelier.ordre_affichage`.
- **0086** — refonte du journal (auteur par en-tête, lots, conservation, purge RGPD).
- **0087** — horaires « après une nuit » ; **0088** — horaires par place (`horaire_place`).
- **0089** — suppression des colonnes dépréciées : `poste.suivi_motif`, `poste.anci_usage`,
  `visite.professionnel`, `visite.prochain_professionnel` (`competence.anci_usage` est gardée).
- **0090** — journal d'audit compact : une modification ne garde que les champs modifiés +
  le contexte (personne, jour, quart, poste, nom…), créations / suppressions sans colonnes
  techniques, modifications sans effet non journalisées (lignes futures seulement).
  ⚠️ La 0086 n'avait jamais été appliquée avant le 2026-10-14 (délimiteurs `$`, cf. L54).

**Novembre 2026 (0091 → 0094)** :
- **0091** — droits de l'API explicites (`grant` sur toutes les tables + privilèges par
  défaut de `postgres` sur `public`) avant le changement Supabase du 2026-10-30 : toute
  nouvelle table porte son `grant … to authenticated, service_role` (test `migrations-sql`).
- **0092** — durcissement après l'audit du 2026-11-03 : `app_user` fermé en écriture à
  `authenticated` (⚠️ tout futur « grant … on all tables » doit être suivi du même REVOKE),
  nouveau compte inactif, dossier médical sans lecture RLS, trigger `verifier_site_fk`,
  fonction `fusionner_personnes(keep, dup, site, patch)` (fusion de deux fiches en une
  transaction, FK et index uniques introspectés ; service_role seulement — la route
  `/api/personnel/merge` resynchronise ensuite le contrat affiché et le temps partiel).
- **0093** — Excel intérim des Synthèses : `atelier.couleur` (pastel, palette fermée), `parametre_rh`
  (une ligne par site : forme du nom du fichier Excel intérim), `export_interim_photo` (photo de chaque
  « Excel agence », personne_id → texte des cases, aucune lecture sous RLS, purge 8 semaines par la route).
  Les sous-droits des habilitations par famille (même jour) n'ont pas de migration : lignes
  `role_permission` de module `habfam:<famille>`.
- **0094** — `placement_mise_en_page` (site × service × PDF : format, orientation, blocs jsonb sur une grille
  12 × 12), lecture RLS du site, écriture service_role par la route, trigger `verifier_site_fk` sur atelier_id.

## Sitemap (principales routes)
- `/` accueil (logo + titre « planning »), `/planning` (+ vue `?par=poste`), `/placement` (saisie par
  glisser-déposer, cf. CLAUDE.md), `/ordonnancement`
  (+ `/ordonnancement/semaine-type`), `/matrice` (+ `/matrice/bilan`), `/habilitations`,
  `/personnel` (+ `/personnel/[id]`), `/bilans` (+ personnel, polyvalence, couverture,
  anticipation, competences), `/horaires-specifiques`, `/absences-specifiques`,
  `/visites` (suivi des visites médicales, RH).
- Admin : `/admin/referentiel`, `/admin/equipes` (gestion des équipes **+ rotation des
  quarts**), `/admin/competences`, `/admin/habilitations-param`, `/admin/motifs`,
  `/admin/horaires`, `/admin/visites-param` (déclencheurs des visites, RH),
  `/admin/users` (comptes **+ matrice des droits**, admin), `/admin/rgpd`,
  `/journal`.
- Droit `affichage` (compte requis depuis le 2026-11-03 ; une TV se connecte avec un
  compte dédié) : `/affichage` (choix des services), `/affichage/impression?atelier=…` (A3, une
  page par service coché), `/affichage/atelier/[atelier]` (écran TV, refresh 5 min,
  fenêtre glissante paramétrable dans Param. RH — cf. `getFenetreAffichage()`).
- Super_admin (multi-site) : `/platform` (back-office : lister / créer / suspendre un
  site, impersonation tracée).
