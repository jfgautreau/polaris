# Multi-site — architecture & état du chantier

> Polaris est une plateforme **multi-tenant** : plusieurs usines isolées sur une
> seule base Supabase, un seul déploiement Vercel. Ce document décrit l'architecture
> **telle que construite** (migrations 0043 → 0054) et ce qui reste à faire.
> Pièges détaillés : `tasks/lessons.md` (L25, L29). Règles de sécurité au quotidien :
> `CLAUDE.md`.

## Où on en est (2026-08-23)

**✅ Livré en production** (site historique `lebignon`, `bigplann.vercel.app`) :

| Lot | Contenu | Migrations |
|----|---------|------------|
| Socle | Table `site` + `lebignon` ; `site_id` sur les tables métier ; RLS réécrite via `current_site_id()` ; trigger `set_site_id_from_context` ; `getCurrentSite()` ; `refdata` segmenté par site ; `app_user.est_super_admin` | 0043 |
| Correctifs | Fonctions SQL prennent `p_site` explicite (0044) ; `audit_trigger` tolérant aux PK non-`id` (0045) ; FKs simples restaurées pour PostgREST (0046) ; composite FKs `(id, site_id)` retirées (0047, cf. L25) | 0044–0047 |
| Écrans site | `site.nom` en pastille (AppHeader), pied du PDF placement, TV ; login refusé si `site.statut != 'actif'` (sauf super_admin) | — |
| Plateforme | Back-office `/platform` (liste/créer/suspendre/archiver) ; impersonation super_admin (cookie HMAC + header + bandeau + journal) | 0048 |
| Onboarding | `parametre_affichage` par site ; `site_id` explicite sur toutes les routes API | 0051 |
| Séparation totale | Les 7 dernières tables partagées passent en `site_id NOT NULL` (voir §3) ; `createSite` copie les référentiels d'un site source | 0053 |
| Verrouillage | Tests statiques cross-site (`routes-multi-site`, `refdata-cache`, `admin-client`, `isolation-site`) ; `userAdminGuard` borné par site ; `create user` pose `site_id` | — |

**✅ Résolution du site par le compte connecté** (2026-08-23) : multi-site
**pleinement fonctionnel sur `bigplann.vercel.app`, sans sous-domaine ni DNS**. Le
« site courant » applicatif = `getCurrentProfile().siteId`, **pendant exact de
`current_site_id()` en SQL** : site impersonné si un super_admin est « entré » dans un
site (via le **cookie** signé), sinon le `site_id` de rattachement lu dans `app_user`.
`getCurrentSite()` en dérive ; le middleware ne pose plus de `x-site-id`.
⚠️ **Le header `x-impersonate-site` est absent sur les routes `/api/`** (exclues du
matcher middleware) : la source d'impersonation universelle est le **cookie**, lu par
`getCurrentProfile`, `getServerClient` et donc partout. L'approche `app_metadata` +
`x-site-id` (proxy) a été **abandonnée** : `proxy.ts` est revenu à sa version d'avant,
et le backfill `app_metadata` n'est plus nécessaire (le `site_id` vient de la table
`app_user`, source fiable et non falsifiable par l'utilisateur).
⚠️ **Incident 2026-08-23** : deux régressions en chaîne, cf. §7 (boucle de redirect au
chargement du profil ; écritures `site_id: profile.siteId` sur le mauvais site).

**⏸️ Reste à faire** (cf. `tasks/todo.md`) :
- **`/affichage` (TV, public, sans compte)** — seul flux qui a encore besoin du site
  dans l'URL (pas de session → repli lebignon). À faire au moment d'ouvrir un 2ᵉ site :
  slug dans le chemin (`/affichage/<slug>/atelier/[atelier]`).
- **Sous-domaines par site** (cosmétique) — `polaris.app` non acheté. Plus un blocage :
  le site vient du compte connecté ; un sous-domaine ne ferait que fournir la même
  valeur autrement. Reporté tant que le plan Vercel gratuit ne le permet pas.
- **Lenteurs post-0053** à investiguer (index composite, round-trips `getCurrentSite`).
- **Test d'isolation en base réelle** (deux sites) — les gardes actuelles sont statiques.
- **Reporting groupe, quotas, custom domains, Stripe** — reporté à V2 (§6).

## Décisions cadrantes (session 2026-08-19)

1. **Isolation** — une seule base + `site_id` sur toutes les tables métier + RLS.
2. **1 compte = 1 site** (pas de multi-appartenance). `personne.matricule` unique **par site**.
3. **Tout le paramétrage est propre au site** — y compris quarts, compétences,
   habilitations, motifs, contrats, matrice des droits. ⚠️ *Divergence assumée* : le
   cadrage prévoyait des référentiels « partagés au niveau groupe » ; la **0053 a tranché
   pour la séparation totale** (aucune ligne partagée), plus simple et sans surcharge.
4. **URL** — un sous-domaine par site sur `polaris.app` (cible ; non encore en place).
5. **Gouvernance** — `app_user.est_super_admin` (booléen dédié, **hors matrice des
   rôles**, invisible dans `/admin/users`). Back-office `/platform`.
6. **Support** — « Entrer dans le site » (impersonation) avec bandeau rouge + journal.
7. **Onboarding** — ⚠️ *Divergence assumée* : le cadrage prévoyait une « page blanche » ;
   l'implémentation **duplique les référentiels d'un site source** (bien plus utilisable).
8. **Migration** — big-bang 0043, tout le legacy rattaché au site `lebignon`,
   rétrocompatible (l'usine en prod ne voit aucune différence).

## 1. La table `site`
```
site(id uuid pk, slug text unique, nom text, statut text check(actif|suspendu|archive),
     fuseau text, cree_le, cree_par, plan?, quota_*?, logo_url?, accent?)
```
- `slug` = futur sous-domaine ; blacklist applicative (`platform/api/auth/admin/app/www`).
- `statut` piloté depuis `/platform` : `suspendu` = login refusé ; `archive` = accessible
  au seul super_admin pour audit.
- `plan` / `quota_*` : crochets V2 (Stripe) laissés en table, non utilisés en V1.

## 2. Contexte site sur chaque requête
- Résolu **une seule fois** par requête dans `getCurrentSite()` (`src/lib/current-site.ts`),
  dédupliqué par le `cache()` de React. Priorité : header `x-impersonate-site`
  (impersonation) > header `x-site-id` > site historique. Le middleware (`src/proxy.ts`)
  pose `x-site-id` depuis `user.app_metadata.site_id` du compte connecté (gratuit : déjà
  dans le JWT). `app_metadata` et non `user_metadata` : ce dernier est modifiable par
  l'utilisateur (`supabase.auth.updateUser`) et falsifierait le site côté
  `getAdminClient()`. Un futur sous-domaine ne ferait que fournir la même valeur autrement.
  ⚠️ Sur erreur de lecture (hors schéma pré-0043), `getCurrentSite()` **lève** plutôt que
  de retomber en silence sur Lebignon — sinon un incident afficherait le mauvais site.
- `app_user.site_id NOT NULL` — un compte appartient à un site. `est_super_admin` est un
  champ dédié, jamais lu par `getAllRoles()`.
- ⚠️ `auth.users.email` est unique **global Supabase** : deux comptes de deux usines ne
  peuvent pas partager un email (alias `+` sinon).

## 3. Isolation des données
- **Toutes les tables métier portent `site_id NOT NULL`.** Depuis la 0053, cela inclut
  les 7 tables auparavant candidates au partage : `motif_absence`, `type_contrat`,
  `role_custom`, `role_permission`, `competence`, `competence_niveau_libelle`, `quart`.
  **Aucune ligne n'est partagée entre sites** — chaque site a sa propre matrice des
  droits, ses rôles, motifs, contrats, compétences, échelle et quarts.
- **Unicités** réécrites en `(site_id, code)` (ex. `personne.matricule`, `quart.code`…).
- **RLS** : chaque policy exige `site_id = current_site_id()`. `current_site_id()` déduit
  le site de l'`app_user` appelant (ou honore `x-impersonate-site` si super_admin).
- **Trigger `set_site_id_from_context`** : sur INSERT, remplit `site_id` depuis le
  contexte. ⚠️ En `service_role` (`getAdminClient()`), `auth.uid()` est NULL → le trigger
  retombe sur un fallback Lebignon codé en dur. **Toute route qui écrit via `getAdminClient()`
  doit poser `site_id` explicitement** (cf. L29) — et **borner toute lecture/modification**
  par `.eq("site_id", …)` (verrouillé par `isolation-site.test.ts`).

### Quarts par site — composite FK (le point invasif)
`quart` est site-scopé, PK composite `(code, site_id)`. Les 10 tables enfants qui
référençaient `quart.code` portent une FK composite `(quart_code, site_id) → quart(code,
site_id)`. C'est **de la sécurité prouvée par le schéma** (impossible de référencer un
quart d'un autre site) obtenue sans changer aucun type de colonne ni casser le TS qui
compare `quart_code === "matin"`. Contrairement au cas général (§L25), ces composite FKs
sont **PostgREST-safe** car aucun code ne fait d'embed implicite sur `quart`.
⚠️ Le vrai coût des quarts par site n'est pas en SQL : ce sont les constantes `"matin"`
en dur (une trentaine, dont le repli `quart_code ?? "matin"`). Elles cessent d'être
universelles le jour où un site nomme ses quarts autrement — centralisées dans
`src/lib/quarts.ts`.

### La frontière de sécurité (à écrire noir sur blanc)
- **La RLS** porte le *droit d'accès* : un compte du site A ne peut ni lire ni écrire une
  donnée du site B, quelles que soient les requêtes de l'application.
- **L'application** porte la *sélection* du site (via `getCurrentSite()`), et doit border
  explicitement chaque accès en `service_role`.
- **Risque résiduel** : les accès `getAdminClient()` (bypass RLS). D'où la règle « site_id
  partout » et les quatre tests statiques qui la vérifient.

## 4. Plateforme & impersonation (`/platform`)
Réservé aux `est_super_admin` (layout dédié, défense en profondeur middleware + layout).
- `createSite` : crée `site`, l'auth user (avec `site_id` en `user_metadata`), force
  role=admin/site_id/is_active, **copie les référentiels du site source**, génère le lien
  mot de passe. Rollback si la création d'utilisateur échoue.
- **Impersonation** : cookie signé HMAC-SHA256 (`polaris-impersonate`, TTL 60 min). Le
  middleware valide et pose le header `x-impersonate-site` ; `current_site_id()` (0048) ne
  l'honore **que** si l'appelant est super_admin. Bandeau rouge sticky, trace complète
  dans `audit_impersonation` (entrée avec IP/UA/raison, sortie mise à jour).

## 5. Carte des migrations multi-site
`0043` socle · `0044` `p_site` sur fonctions SQL · `0045` audit tolérant PK composite ·
`0046` FKs simples restaurées · `0047` composite FKs `(id, site_id)` retirées ·
`0048` `current_site_id()` lit `x-impersonate-site` · `0049`–`0050` cycle de vie personnel ·
`0051` `parametre_affichage` par site · `0052` `tp_periode` · `0053` séparation totale des
référentiels (7 tables) + composite FK sur `quart` · `0054` commentaire `personne_competence` ·
`0055` **`app_user` et `audit_log` strictement scopés au site courant** (retire le passe-droit
`OR is_super_admin()` : l'écran montre toujours le site courant, super_admin inclus ; le
cross-site passe par `/platform` en service_role). **Appliquée le 2026-08-23.**

## 5 bis. Incident 2026-08-23 (deux régressions en chaîne après 0055)
Après application de 0055, prod HS puis écritures sur le mauvais site. À retenir :
1. **Boucle de redirect** (`ERR_TOO_MANY_REDIRECTS`) : 0055 a retiré `OR is_super_admin()`
   de `app_user_select`. En impersonation, `current_site_id()` = site cible, donc la propre
   ligne `app_user` du super_admin (autre site) devenait invisible via `getServerClient` →
   `getCurrentProfile` null → `/login` ↔ `/`. **Fix** : `getCurrentProfile` lit sa ligne en
   `getAdminClient` (service_role), découplée de la RLS site-scopée.
2. **Écritures sur le mauvais site** : ~20 routes écrivent `site_id: profile.siteId`, or
   `profile.siteId` valait le site d'origine du super_admin, pas le site impersonné (compte
   + atelier créés sur Le Bignon depuis LVC). **Fix** : `getCurrentProfile().siteId` conscient
   de l'impersonation via le **cookie** (le header `x-impersonate-site` est absent sur `/api/`,
   middleware exclu) ; `getServerClient` et `getCurrentSite()` idem. Le « site courant » est
   désormais résolu en un seul endroit et vaut partout le site consulté.

## 6. Points ouverts / V2
- **Sous-domaines** — wildcard DNS `*.polaris.app` + slug lu dans `src/proxy.ts`.
- **Multi-appartenance** — refusée en V1 (contrainte email unique). Reviendrait à une
  table de jointure `app_user_site`.
- **Reporting groupe** — vue matérialisée `mv_bilans_groupe` + rôle `codir_groupe`.
- **Facturation** — Stripe branché sur `site.plan` / `site.quota_*` + webhook statut.
- **Test RLS cross-site** en base dédiée (deux sites), au-delà des gardes statiques.

## 7. Risques identifiés
- **Fuite RLS** — une policy oubliée ou un `getAdminClient()` non borné exposerait un autre
  site. Défense : `.eq("site_id", …)` partout + les 4 tests statiques.
  ⚠️ **Piège vécu (0055)** : un passe-droit `OR is_super_admin()` dans une policy RLS
  **court-circuite le filtre de site** — le super_admin voyait les `app_user` et `audit_log`
  de TOUS les sites (y compris en impersonation). Règle : les policies d'écran applicatif se
  scopent sur `site_id = current_site_id()` **sans passe-droit** ; le pouvoir cross-site du
  super_admin passe exclusivement par `/platform`, qui accède en service_role (bypass RLS).
- **Migration irréversible** — pas de retour arrière propre après 0043 ; `pg_dump`
  **obligatoire** avant toute migration multi-site.
- **Composite FKs vs embeds PostgREST** — ne jamais mélanger FK composite et simple sur la
  même colonne (data null silencieux). Cf. L25.
