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
  affichage couloir public, export RGPD, écritures « module » validées).
- `src/lib/current-user.ts` — `getCurrentProfile()`, `requireAdmin()`.
- `src/lib/permissions.ts` — matrice de droits par module (`MODULES`, `defaultsFor`,
  `getPermissions`, `canRead`/`canWrite`, `canWriteModule`, `requireModule`).
- `src/lib/refdata.ts` — cache des données de référence (`unstable_cache`, 30 s).
- `src/lib/fetch-all.ts` — `fetchAll()`. PostgREST plafonne **chaque réponse à 1000 lignes**
  (`db-max-rows`) sans lever d'erreur. Toute lecture d'une table qui peut dépasser ce
  seuil (`matrice`, `personne_competence`, `placement`, `ouverture_quart`,
  `contrat_periode`, `visite`) doit passer par cet utilitaire, avec un `.order()`
  déterministe.
- `src/proxy.ts` — protège les routes (redirige vers /login). Public : `/login`, `/forgot`,
  `/reset`, `/auth/*`, `/affichage/*`.
- `src/components/AppHeader.tsx` — navigation par rôle + cloche d'alerte habilitations.

## Modèle de données (Supabase / PostgreSQL)
- **Auth & droits** : `app_user` (compte + rôle), liée à `auth.users` (trigger
  `handle_new_user`) ; `role_permission` (surcharge de la matrice de droits par module).
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
  `equipe_quart_semaine` (ancienne saisie semaine-par-semaine, **conservée mais plus
  lue/écrite**), `poste_quart` (**effectif PAR quart** depuis 0070, colonne
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
  (`date_obtention`, `date_expiration` **stockée à la saisie**, `date_autorisation_conduite`),
  `personne_competence_historique` (0084 : ajout / modification / suppression, écrite par
  déclencheur, reprise depuis `audit_log` ; une suppression n'efface plus rien).
- **Planning** : `ligne_ouverture`, `jour_equipe`, `placement` (1 personne/jour : poste,
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
  - Drapeaux posés sur les référentiels existants, écrits **seulement** par
    `/api/visites-param` : `quart.nuit` (aussi réglable dans Équipes depuis 0087),
    `poste.suivi_renforce` / `suivi_motifs` / `anci_usages` (tableaux, 0080 ; les colonnes
    scalaires `suivi_motif` / `anci_usage` sont dépréciées), `competence.suivi_renforce` /
    `anci_usage`, `motif_absence.visite_reprise`.
  - Le **régime n'est pas stocké** : il est recalculé à chaque affichage
    (`evaluerPersonne`) depuis ces drapeaux, les placements récents et les habilitations.
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
- Matrice / placement / habilitations : **admin ou chef de l'équipe** (`can_edit_personne()`).
- Ouverture de lignes, rotation des équipes : **admin ou ordo** (`has_role('ordo')`).
- Journal d'audit : la matrice décide (module `journal`) ; l'écran lit en service_role
  borné au site (la RLS `can_read_audit()` nomme encore admin + codir, simple filet).
- Visites médicales : modules `visites` et `visites_param`, accordés au seul rôle `rh`
  par défaut. Lecture RLS bornée au site ; écriture par les routes API gardées par
  `moduleWriteGuard` (service_role). Le Placement n'en voit qu'un avertissement **sans
  motif** (`src/lib/visites-placement.ts`), désactivé par défaut.

Rôles : `admin`, `chef_equipe`, `ordo`, `rh`, `codir`, `planning`.

## Audit
Triggers PostgreSQL (`audit_trigger`) sur les tables métier → `audit_log`
(qui, action, table, ancienne/nouvelle valeur en JSON, site, lot).
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
  (`journal_purger_personne`). Ces fonctions sont réservées au service_role.

## Migrations
Fichiers SQL ordonnés dans `supabase/migrations/` (**0001 → 0089**, dernière appliquée :
**0089**), **exécutés manuellement** par l'utilisateur dans le SQL Editor Supabase
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
  **0066** — import des absences depuis le logiciel RH ; **0067** — affichage TV en mode
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

**Octobre 2026 (0079 → 0089)** :
- **0079 → 0081** — visites : professionnel vu / attendu (médecin, infirmière, cumulables
  en 0081) ; poste à risque avec plusieurs motifs et attestations (0080).
- **0082** — `ligne.couleur` ; **0083** — `motif_absence.visible_operateurs` ;
  **0084** — historique des habilitations ; **0085** — `atelier.ordre_affichage`.
- **0086** — refonte du journal (auteur par en-tête, lots, conservation, purge RGPD).
- **0087** — horaires « après une nuit » ; **0088** — horaires par place (`horaire_place`).
- **0089** — suppression des colonnes dépréciées : `poste.suivi_motif`, `poste.anci_usage`,
  `visite.professionnel`, `visite.prochain_professionnel` (`competence.anci_usage` est gardée).

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
- Public : `/affichage` (choix des services), `/affichage/impression?atelier=…` (A3, une
  page par service coché), `/affichage/atelier/[atelier]` (écran TV, refresh 5 min,
  fenêtre glissante paramétrable dans Param. RH — cf. `getFenetreAffichage()`).
- Super_admin (multi-site) : `/platform` (back-office : lister / créer / suspendre un
  site, impersonation tracée).
