# Architecture — Polaris

Application web de gestion des plannings d'usine (matrice de polyvalence,
placement journalier, habilitations, affichage couloir, bilans).

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
  seuil (`matrice`, `personne_competence`, `placement`, `ouverture_quart`) doit passer
  par cet utilitaire, avec un `.order()` déterministe.
- `src/proxy.ts` — protège les routes (redirige vers /login). Public : `/login`, `/forgot`,
  `/reset`, `/auth/*`, `/affichage/*`.
- `src/components/AppHeader.tsx` — navigation par rôle + cloche d'alerte habilitations.

## Modèle de données (Supabase / PostgreSQL)
- **Auth & droits** : `app_user` (compte + rôle), liée à `auth.users` (trigger
  `handle_new_user`) ; `role_permission` (surcharge de la matrice de droits par module).
- **Référentiel** : `atelier` > `ligne` > `poste` (`effectif_requis` = abaque, `nom_court`,
  `categorie` manager/conducteur/operateur, `niveau_min_requis`, `objectif_polyvalence`,
  `objectif_cible`, `ordre_affichage`), `equipe` (+ `quart_fixe`), `equipe_chef`.
- **Quarts** : `quart` (`journee`/`matin`/`apres_midi`/`nuit` + horaires),
  `rotation_reference` (**rotation par référence datée** : une semaine (lundi) × équipe →
  quart ; l'alternance des semaines suivantes est *calculée* par `src/lib/rotation.ts`,
  jamais stockée — pour une semaine cible, la référence active est la plus récente ≤ cette
  semaine, donc changer la rotation = ajouter une référence datée sans toucher le passé),
  `equipe_quart_semaine` (ancienne saisie semaine-par-semaine, **conservée mais plus
  lue/écrite**), `poste_quart` (activation poste×quart, défaut actif : ne stocke que les
  désactivations), `jour_quart`, `ouverture_quart`, `horaire_poste` (poste × quart × jour,
  = horaire *standard* affiché à la TV et proposé par défaut dans la pendule du planning).
- **Personnel** : `personne` (équipe, atelier, type_contrat, sexe, `numero_badge`,
  `date_livret_accueil`, temps partiel `tp_config` jsonb ; champs RGPD
  `anonymise`/`anonymise_at`) ; `contrat_periode` (source de vérité du cycle de vie).
  ⚠️ **`personne.statut` (`A_VENIR` / `ACTIF` / `PARTI`) est un cache calculé
  automatiquement** par trigger DB à partir des contrats (migrations 0049 + 0050) —
  plus de saisie manuelle. Arrivée = `MIN(contrat_periode.date_debut)` ; départ prévu =
  `MAX(date_fin)` si aucun contrat ouvert ; motif de départ = `motif_fin` du dernier
  contrat. Les anciens champs `personne.date_arrivee` / `date_depart_prevu` /
  `motif_depart` ont été **supprimés en 0050**.
- **Matrice** : `matrice` (niveau actuel/cible par personne×poste, valeur spéciale
  « restriction »), `competence_niveau_libelle` (échelle paramétrable).
- **Habilitations** : `competence` (`a_recycler`, `duree_validite_mois`, `categorie`,
  `groupe`, `ordre`, `a_autorisation_conduite`), `personne_competence`
  (`date_obtention`, `date_expiration` **stockée à la saisie**, `date_autorisation_conduite`).
- **Planning** : `ligne_ouverture`, `jour_equipe`, `placement` (1 personne/jour : poste,
  ou motif d'absence, ou non travaillé), `horaire_exception` (personne × jour),
  `absence` (période longue → `placement.absence_id`, cascade),
  `semaine_type` (+ ouverture, profils).
- **Absences** : `motif_absence` (paramétrable, couleur).
- **Transverse** : `audit_log` (alimenté par triggers).

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
chantier : `ARCHITECTURE-MULTISITE.md` et `tasks/multi-site.md`.

Écriture en base :
- Référentiel, équipes, compétences, motifs, objectifs, personnel : **admin**.
- Matrice / placement / habilitations : **admin ou chef de l'équipe** (`can_edit_personne()`).
- Ouverture de lignes, rotation des équipes : **admin ou ordo** (`has_role('ordo')`).
- Journal d'audit : lecture **admin + codir** (`can_read_audit()`).

Rôles : `admin`, `chef_equipe`, `ordo`, `rh`, `codir`, `planning`.

## Audit
Triggers PostgreSQL (`audit_trigger`) sur les tables métier → `audit_log`
(qui, action, table, ancienne/nouvelle valeur en JSON).
⚠️ L'auteur est `auth.uid()`, **null quand l'écriture passe par le service role**
(`getAdminClient()`, utilisé dès qu'un module est en écriture « complète ») → l'entrée
tombait en « Système ». Depuis la **migration 0031**, le trigger prend en repli
`new/old.created_by` puis `auteur_app_user_id` : `placement`, `matrice` et
`horaire_exception` sont donc attribués. Les tables sans colonne d'auteur (ex. `personne`)
restent en « Système » — c'est le choix « ciblé » retenu.
Le journal (`/journal`) affiche qui / valeur avant / valeur après / date-heure, en masquant
les champs techniques et en résolvant les clés étrangères en libellés.

## Migrations
Fichiers SQL ordonnés dans `supabase/migrations/` (**0001 → 0054**, dernière appliquée :
**0054**), **exécutés manuellement** par l'utilisateur dans le SQL Editor Supabase
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

**Chantier multi-site (0043 → 0054)** — cf. `tasks/multi-site.md` pour le détail :
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

## Sitemap (principales routes)
- `/` accueil (logo + titre « planning »), `/planning`, `/placement` (saisie par
  glisser-déposer, cf. CLAUDE.md), `/ordonnancement`
  (+ `/ordonnancement/semaine-type`), `/matrice` (+ `/matrice/bilan`), `/habilitations`,
  `/personnel` (+ `/personnel/[id]`), `/bilans` (+ personnel, polyvalence, couverture,
  anticipation, competences), `/horaires-specifiques`, `/absences-specifiques`.
- Admin : `/admin/referentiel`, `/admin/equipes` (gestion des équipes **+ rotation des
  quarts**), `/admin/competences`, `/admin/habilitations-param`, `/admin/motifs`,
  `/admin/horaires`, `/admin/users` (comptes **+ matrice des droits**, admin), `/admin/rgpd`,
  `/journal`.
- Public : `/affichage`, `/affichage/atelier/[atelier]` (écran TV, refresh 5 min,
  fenêtre glissante paramétrable dans Param. RH — cf. `getFenetreAffichage()`).
- Super_admin (multi-site) : `/platform` (back-office : lister / créer / suspendre un
  site, impersonation tracée).
