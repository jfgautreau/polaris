# Reste à faire — Polaris

> État au 2026-08-23. Migrations appliquées jusqu'à **0054**. **223** tests Vitest.
> Historique détaillé des sessions : `git log`.

## Sécurité / multi-site
- [x] Isolation multi-tenant : `site_id` + RLS sur toutes les tables métier (0043–0054).
- [x] Bornage explicite `site_id` de **toutes** les lectures/écritures via `getAdminClient()`,
      verrouillé par `isolation-site.test.ts` (Sujet 1, 2026-08-23).
- [ ] **Test d'isolation « en conditions réelles »** — les gardes actuelles sont statiques
      (analyse du source). Un vrai test RLS cross-site (deux sites, une base de test)
      reste à mettre en place quand un environnement de test avec base dédiée existera.
- [x] **Résolution du site par le compte connecté** (2026-08-23) : le middleware pose
      `x-site-id` depuis `user.app_metadata.site_id` (inviolable). Multi-site fonctionnel
      sur `bigplann.vercel.app` **sans sous-domaine**. Backfill des comptes historiques :
      `node scripts/backfill-app-metadata-site.mjs`.
- [ ] **`/affichage` (TV public) par site** — seul flux sans compte connecté. À faire au
      2ᵉ site : slug dans le chemin (`/affichage/<slug>/…`).
- [ ] **Domaine `polaris.app` + sous-domaines par site** — cosmétique désormais (non
      bloquant) ; `polaris.app` non acheté (plan Vercel gratuit). Le jour venu : wildcard
      DNS + slug → `x-site-id` dans `src/proxy.ts` (cf. `tasks/multi-site.md`).

## Chantiers techniques
- [ ] **Virtualisation des grandes grilles** (Matrice ~22 000 cellules, Habilitations du
      même ordre). Plafond structurel connu ; prochain gros chantier (cf. CLAUDE.md § Performance).
- [ ] **Lenteurs post-0053 à investiguer** — chargement perçu plus lent depuis la
      séparation des référentiels. Pistes : index sur composite FK/PK `jour_quart`
      (EXPLAIN planning + placement), round-trip `getCurrentSite()` par appel de
      permissions, invalidations de cache Next. Cf. `tasks/multi-site.md`.
- [ ] **Backfill SQL** des `personne_competence.date_expiration` nulles alors que la
      formation a une durée de validité (aujourd'hui compensé à l'affichage seulement).
- [ ] Journal : les tables sans colonne d'auteur (ex. `personne`) restent en « Système ».
      Choix « ciblé » assumé (cf. `lessons.md` L12).

## Décisions ouvertes (arbitrage utilisateur)
- [ ] **Anonymisation RGPD** — aujourd'hui conserve matricule, badge, sexe, pointure,
      contrats, motifs d'horaires : c'est une **pseudonymisation**, pas une anonymisation.
      Soit effacer tout ce qui ré-identifie, soit renommer le bouton. Par ailleurs
      `/api/personnel/[id]/export` exige le droit `personnel: write` alors que c'est une
      lecture sensible → devrait relever du module `rgpd`.
- [ ] **Placement multi-quart** — afficher les quarts cochés côte à côte (3 dispositions
      proposées, en attente d'arbitrage).
- [ ] **Placement V2** — vrai plan géographique (image d'atelier + position x/y des
      postes, écran de calibrage) → migration à prévoir. La V1 schématique est en place.

## Rappels
- `npm run build` **et** `npm test` avant chaque commit ; commit + push sur `main`
  (déploiement Vercel auto). Auteur git = `jf.gautreau@gmail.com`.
- Toute nouvelle migration s'exécute **manuellement** dans le SQL Editor Supabase.
