# Reste à faire — Polaris

> État au 2026-08-26. Migrations appliquées jusqu'à **0060**. **252** tests Vitest.
> Historique détaillé : `git log`.

## Revue — Poste imprimable + colonnes de noms Placement (2026-09-16)
- [x] **Migration `0073_poste_imprimable.sql` appliquée** (2026-09-17) dans le SQL Editor
      Supabase (`poste.imprimable boolean not null default true`). Le code reste tolérant à
      son absence (repli `imprimable = true`, codes 42703/PGRST204) pour les autres sites.
- [x] **Référentiel — colonne « Impr. »** (Oui/Non) par poste : choisit s'il figure sur les
      **feuilles de placement imprimées** (PDF / PDF CE). « Non » masque à l'impression les
      postes qui ne servent qu'à **construire le planning** ; ils restent utilisables à
      l'écran. Whitelist `posteValue` + `updateTable` (repli colonne absente).
- [x] **Placement PDF/PDF CE** : le plan imprimé (`groupsImpr`) exclut les postes non
      imprimables et les lignes qui n'ont plus aucun poste imprimable. L'écran montre tous
      les postes.
- [x] **Placement écran — noms sur 2/3 colonnes** : les rangs d'un poste (numéros de rotation
      + case sans numéro) se répartissent en colonnes de **10 rangs max** (plafond 3 colonnes),
      via multi-colonnes CSS pilotées par `--cols` (calc largeur de tuile). Évite les tuiles
      interminables sur les postes à nombreux numéros.
- [x] `tsc`, `npm run build`, `npm test` (313) OK.

## Revue — PDF Placement & tooltip Planning (2026-09-16)
- [x] **PDF & PDF CE Placement** : les **numéros de rotation** figurent maintenant sur
      chaque poste numéroté, même vide (ligne « n° · libre ») — avant, un numéro sans
      personne était invisible (cf. `PlacementBoard.tsx`, section feuille imprimable).
- [x] **PDF & PDF CE Placement** : les **commentaires du jour** (`horaire_exception.motif`,
      saisis via la pendule du Planning) s'affichent en italique à côté du nom. Chargés
      dans `placement/page.tsx` (lecture bornée à 1 jour, site-scopée), passés en prop
      `commentaires`.
- [x] **PDF Placement en A3 paysage** (bouton « PDF » seulement ; le « PDF CE » reste A4) :
      page nommée `plcA3` (globals.css) activée via `body.print-a3` le temps du print ;
      feuille et cible d'échelle redimensionnées (`PAGE_*_A3`, `LARGEURS_ESSAI_A3`,
      `.printSheet[data-mode="simple"]`). Respecte L42 (cible < feuille).
- [x] **Planning** : horaire spécifique + commentaire affichés au survol de **toute la
      case** (title de la cellule et du bouton), plus seulement de la pendule 🕐.
- [x] `tsc`, `npm run build`, `npm test` (313) OK.

## Sécurité / multi-site
- [x] Isolation multi-tenant : `site_id` + RLS sur toutes les tables métier (0043–0054).
- [x] Bornage explicite `site_id` de **toutes** les lectures/écritures via `getAdminClient()`,
      verrouillé par `isolation-site.test.ts` (Sujet 1, 2026-08-23).
- [ ] **Test d'isolation « en conditions réelles »** — les gardes actuelles sont statiques
      (analyse du source). Un vrai test RLS cross-site (deux sites, une base de test)
      reste à mettre en place quand un environnement de test avec base dédiée existera.
- [x] **Résolution du site par le compte connecté** (2026-08-23) : « site courant » =
      `getCurrentProfile().siteId`, conscient de l'impersonation (cookie). Multi-site
      fonctionnel sur `bigplann.vercel.app` **sans sous-domaine**. ⚠️ L'approche
      `app_metadata`/`x-site-id` (proxy) a été **abandonnée** — le `site_id` vient de la
      table `app_user`. Le script `scripts/backfill-app-metadata-site.mjs` est **obsolète**
      (peut être supprimé). Incident du jour consigné dans `tasks/multi-site.md §5bis`.
- [x] **Masquage d'éléments par site** (2026-08-24) : `/platform/[id]` → « Éléments visibles ».
      Table `site_module` (0056, appliquée). Menus = blocage réel (nav + route) ;
      extras hors nav (`MASQUABLES_EXTRA`) = `guide` (lien Guide utilisateur du menu user).
      Helper `src/lib/site-modules.ts`.
- [ ] **`/affichage` (TV public) par site** — seul flux sans compte connecté. À faire au
      2ᵉ site : slug dans le chemin (`/affichage/<slug>/…`).
- [ ] **Domaine `polaris.app` + sous-domaines par site** — cosmétique désormais (non
      bloquant) ; `polaris.app` non acheté (plan Vercel gratuit). Le jour venu : wildcard
      DNS + slug → `x-site-id` dans `src/proxy.ts` (cf. `tasks/multi-site.md`).

## Chantiers techniques
- [x] **Virtualisation des grandes grilles** (2026-08-26) — Matrice + Habilitations ne
      rendent que les lignes visibles (fenêtre + overscan 16, cales `<tr>` calées sur
      `--grid-row-h`), via le socle partagé `usePersonGrid`. Colonnes **non** virtualisées
      (noms figés, en-têtes collants, survol en croix intacts). Allège dessin + hydratation ;
      **n'accélère pas** la récupération serveur (cf. « Lenteurs post-0053 » ci-dessous).
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
