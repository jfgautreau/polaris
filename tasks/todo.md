# Reste à faire — Polaris

> État au 2026-10-09. Migrations appliquées jusqu'à **0088**. **451** tests Vitest.
> Ce fichier ne garde que ce qui reste ouvert ; le détail de ce qui est fait est dans
> `git log` (et l'en-tête de chaque migration).

## À vérifier sur le terrain (lot du 2026-10-09)
- [ ] **Impressions du Placement** : PDF Manager et PDF pour Affich. compacts, en portrait
      ou paysage selon le plan. Si l'aperçu reste en paysage alors que le plan a été
      calculé en portrait (feuille réduite dans un coin), passer par un autre réglage
      d'impression (cf. `lessons.md` L52).
- [ ] **Journal** : contrôler que les nouvelles entrées ne sont plus signées « Système »
      (comptage en lecture seule à refaire quelques jours après le 2026-10-09).
- [ ] **Horaires après une nuit / par place** : saisir les variantes sur le site concerné,
      ajouter les numéros de rotation des postes à arrivées décalées, puis comparer la TV
      un jour qui suit une nuit et un jour sans nuit.
- [ ] Vérifier sur une vraie impression l'Affichage multi-services (2 ou 3 services cochés).
- [ ] Retirer les 2 affectations hors contrat restantes (15 et 16/10, Le Bignon) depuis le
      Cycle de vie de la personne concernée.

## Base de données
- [ ] **Supprimer les colonnes dépréciées** (plus lues nulle part) dans une prochaine
      migration : `poste.suivi_motif`, `poste.anci_usage` (0080), `visite.professionnel`,
      `visite.prochain_professionnel` (0081).
- [ ] **Backfill SQL** des `personne_competence.date_expiration` nulles alors que la
      formation a une durée de validité (aujourd'hui compensé à l'affichage seulement).
- [ ] RLS `audit_log` : `can_read_audit()` nomme encore admin + codir. L'écran Journal ne
      s'en sert plus (lecture service_role après la garde de module) ; l'aligner sur la
      matrice ou la laisser comme simple filet.

## Planning « Par poste »
Spécification : `tasks/planning-par-poste.md`.
- [ ] Mesurer la fluidité au Bignon (99 postes) ; virtualiser les rangées si besoin.
- [ ] **Plus tard** : impression A3 paysage de la vue par poste.
- [ ] **Plus tard** : glisser-déposer d'une barre.

## Visites médicales (module RH)
- [ ] **Import initial de l'historique** des visites (matricule, date, type, éventuelles
      ANCI). Sans lui, tout le personnel apparaît « En retard ». Format à obtenir des RH ;
      s'inspirer de l'import des absences RH (`src/lib/import-absences-rh.ts`).
- [ ] **Relire les déclencheurs posés par la migration 0076** avec les RH : quarts de nuit,
      habilitations à autorisation de conduite, motifs d'arrêt cochés pour la reprise.
- [ ] **Postes à risques particuliers** : à cocher depuis la liste annuelle transmise au
      service de santé au travail (à demander aux RH, sans noms).
- [ ] **Motifs d'arrêt** : vérifier qu'AT, maladie professionnelle et maternité sont
      distincts de « AM » ; sinon la règle de reprise ne les distingue pas.
- [ ] **Visite de mi-carrière** (L4624-2-2) : type créé mais désactivé (pas de date de
      naissance). À confronter à la convention collective applicable.
- [ ] Rappel « rendez-vous de liaison » à 30 jours d'arrêt (L1226-1-3) : non codé.
- [ ] Guide utilisateur (`public/guide.html`) : section Visites médicales à écrire.

## Sécurité / multi-site
- [ ] **Test d'isolation « en conditions réelles »** — les gardes actuelles sont statiques
      (analyse du source). Un vrai test RLS cross-site (deux sites, une base de test)
      reste à mettre en place quand un environnement de test avec base dédiée existera.
- [ ] **`/affichage` (TV public) par site** — seul flux sans compte connecté : slug dans le
      chemin (`/affichage/<slug>/…`).
- [ ] **Domaine `polaris.app` + sous-domaines par site** — cosmétique, non bloquant
      (cf. `tasks/multi-site.md`).

## Chantiers techniques
- [ ] **Lenteurs post-0053 à investiguer** — pistes : index sur composite FK/PK
      `jour_quart` (EXPLAIN planning + placement), invalidations de cache Next.
      Cf. `tasks/multi-site.md`.
- [ ] Prochain candidat React Compiler : `PlacementBoard`.

## Décisions ouvertes (arbitrage utilisateur)
- [ ] **Anonymisation RGPD** — conserve matricule, badge, sexe, pointure, contrats,
      motifs d'horaires : c'est une **pseudonymisation**, pas une anonymisation. Soit
      effacer tout ce qui ré-identifie, soit renommer le bouton. (Le journal d'audit, lui,
      est purgé des traces d'identité depuis 0086.)
- [ ] **Placement multi-quart** — afficher les quarts cochés côte à côte (3 dispositions
      proposées, en attente d'arbitrage).
- [ ] **Placement V2** — vrai plan géographique (image d'atelier + position x/y des
      postes, écran de calibrage) → migration à prévoir. La V1 schématique est en place.

## Rappels
- Tests et build avant chaque commit, en lisant leur **code de sortie** (pas de
  `vitest | grep`, cf. `lessons.md` L51) ; commit + push sur `main` (déploiement Vercel
  auto). Auteur git = `jf.gautreau@gmail.com`.
- Toute nouvelle migration s'exécute **manuellement** dans le SQL Editor Supabase ; le
  code qui la lit ne part qu'une fois la migration appliquée.
