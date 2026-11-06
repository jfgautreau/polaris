# Reste à faire — Polaris

> État au 2026-11-06. Migrations appliquées jusqu'à **0094**.
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

## À vérifier sur le terrain (lot du 2026-10-19)
- [ ] **Fin de contrat** : saisir une date de fin au Cycle de vie sur une personne déjà placée
      au-delà → la fenêtre « Retirer / Garder » s'ouvre à la sortie du champ (pas pendant la
      frappe), et aussi si l'on ferme la modale aussitôt. Retrait = une ligne LOT au Journal.
- [ ] **Noms de place** (Le Bignon, Palettisation) : saisir « Ailes, Panés, Aide
      palettisation » au Référentiel, puis contrôler les cases du Placement, le PDF pour
      Affich. et la vue Par poste du Planning.

## À vérifier sur le terrain (lot du 2026-11-04)
- [ ] **TV** : créer le rôle « TV » (droit `affichage` seul) et un compte, se connecter sur
      chaque écran, vérifier que la page tient plusieurs jours (retour sur `/login` puis sur
      le service si la session se perd).
- [ ] **En-têtes de sécurité** (CSP) : parcourir les écrans en production, console du
      navigateur ouverte — aucune ressource bloquée (PDF, Excel, captures du guide, TV).
- [ ] **Import du suivi des formations** (Le Bignon, 04/11) : 10 personnes présentes dans le
      fichier mais parties dans Polaris ont reçu leurs habilitations — statut à confirmer
      par les RH (liste dans le rapport hors dépôt, jamais dans le repo).

## À vérifier sur le terrain (lot du 2026-11-05)
- [ ] **TV** : un planning de service ne montre que les personnes affectées dans ce service ; une
      personne matin puis nuit figure dans les deux sections ; « ★ » sur les arrivées < 14 jours.
      Impression A3 (et A4) : une page par section, numéro de semaine en tête.
- [ ] **Excel agence** : choisir la couleur de chaque service au Référentiel, régler le nom du
      fichier dans Param. RH, puis extraire deux fois la même agence / semaine avec un changement
      entre les deux → cases en jaune fluo, retiré barré ; contrôler l'aperçu d'impression.
- [ ] **Mise en page PDF** : enregistrer une mise en page (cadres, postes en cases, cases vides),
      imprimer le PDF correspondant un jour chargé → postes à leur case, étirement sur les cases
      vides, page réduite si besoin ; une ligne non placée qui tourne s'imprime sous la grille.
- [ ] **Sous-droits des habilitations** : fermer une famille à un rôle dans Droits, vérifier le
      cadenas dans la grille et le refus à l'enregistrement.
- [ ] **Placement** : prénoms complets sur les tuiles et les PDF ; noms très longs.

## Base de données
- [ ] Table `import_absence_personne` inutilisée depuis le retrait de l'import des absences RH
      (2026-11-05) : la supprimer par une migration une fois le retrait confirmé.
- [ ] Commentaire de la migration 0094 : il décrit encore une grille 0-11 et un champ `postes` ;
      le format réel (grille 15 × 15, `places`) est dans `src/lib/mise-en-page-pdf.ts`.
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
      l'ancien import des absences RH (retiré le 2026-11-05, voir l'historique git de
      `src/lib/import-absences-rh.ts`) peut servir de modèle.
- [ ] **Relire les déclencheurs posés par la migration 0076** avec les RH : quarts de nuit,
      habilitations à autorisation de conduite, motifs d'arrêt cochés pour la reprise.
- [ ] **Postes à risques particuliers** : à cocher depuis la liste annuelle transmise au
      service de santé au travail (à demander aux RH, sans noms).
- [ ] **Motifs d'arrêt** : vérifier qu'AT, maladie professionnelle et maternité sont
      distincts de « AM » ; sinon la règle de reprise ne les distingue pas.
- [ ] **Visite de mi-carrière** (L4624-2-2) : type créé mais désactivé (pas de date de
      naissance). À confronter à la convention collective applicable.
- [ ] Rappel « rendez-vous de liaison » à 30 jours d'arrêt (L1226-1-3) : non codé.

## Sécurité / multi-site
- [ ] **Test d'isolation « en conditions réelles »** — les gardes actuelles sont statiques
      (analyse du source). Un vrai test RLS cross-site (deux sites, une base de test)
      reste à mettre en place quand un environnement de test avec base dédiée existera.
- [ ] **CSP sans `'unsafe-inline'`** (scripts) : passer à un nonce par requête posé par le
      proxy ; demande de rendre les pages dynamiques, à mesurer avant.
- [ ] **Domaine `polaris.app` + sous-domaines par site** — cosmétique, non bloquant
      (cf. `tasks/multi-site.md`).

## Chantiers techniques
- [ ] **Lenteurs post-0053 à investiguer** — pistes : index sur composite FK/PK
      `jour_quart` (EXPLAIN planning + placement), invalidations de cache Next.
      Cf. `tasks/multi-site.md`.
- [ ] Prochain candidat React Compiler : `PlacementBoard`.
- [ ] Pistes de l'audit du 2026-11-03 : Personnel lisant le référentiel par les caches de
      `refdata` (comme le Planning) ; index `placement (site_id, jour)` à confirmer par un
      EXPLAIN avant migration.

## Consommation Supabase (analyse du 2026-10-14)
Quota gratuit « Log Ingestion » de 1 Go/mois (0,77 Go au 14/10) : une ligne de journal par
appel à la base. Fait le 2026-10-14 : socle en cache (profil, droits, modules masqués),
types de contrat lus seulement par les ops qui en ont besoin (`/api/personnel`),
rechargement auto de la TV retiré, `fetchAll` par total demandé d'emblée (`count=exact`, 2026-10-16 :
plus aucune tranche vide), référentiel du Placement en cache (~13 appels de moins par affichage),
Ordonnancement sans rechargement à chaque case, TV en mise à jour économe.
Reste, par ordre d'impact :
- [ ] **Listes d'ids dans l'URL** (`.in("personne_id", [200-400 ids])`) : 8 à 15 Ko par ligne
      de journal, répétés à chaque tranche. **Planning fait le 2026-10-14** (filtre `site_id` /
      `statut` + tri en mémoire, horaires par place en cache), **Placement et Matrice aussi**
      (listes de postes gardées quand un service est filtré : courtes), **Journal aussi** (noms lus
      par site, lignes / postes du cache ; la recherche garde sa liste plafonnée à 38 ids). TV faite aussi.
- [ ] **Planning** : relit toute la matrice du site à chaque affichage
      (`planning/page.tsx`, `MatRow`), même filtré sur un service.
- [ ] Placement, encore lus à chaque affichage : `poste_competence_requise` (le nom et la
      durée de l'habilitation y sont joints : invalider aussi depuis les écrans d'habilitations),
      `chargerNuitsAvant` (4 appels, partagé avec Planning et TV).
- [ ] Planning, Ordonnancement, TV, Bilans : passer eux aussi par le référentiel en cache.
- [ ] Personnel : `refresh-statuts` à chaque ouverture de l'écran (une fois par jour suffit).
- [ ] **0090 appliquée le 2026-10-14** (journal compact) : vérifier sur les premières lignes
      écrites après coup (plus de created_at / updated_at / site_id dans old/new_values,
      taille moyenne en baisse). Option non retenue pour l'instant : raccourcir la
      conservation du Planning (décision utilisateur).

## Décisions ouvertes (arbitrage utilisateur)
- [ ] **Anonymisation RGPD** — conserve matricule, badge, sexe, pointure, contrats,
      motifs d'horaires : c'est une **pseudonymisation**, pas une anonymisation. Soit
      effacer tout ce qui ré-identifie, soit renommer le bouton. (Le journal d'audit, lui,
      est purgé des traces d'identité depuis 0086.)
- [ ] **Placement multi-quart** — afficher les quarts cochés côte à côte (3 dispositions
      proposées, en attente d'arbitrage).
- [ ] **Placement V2** — vrai plan géographique (image d'atelier + position x/y des
      postes, écran de calibrage) → migration à prévoir. La V1 schématique est en place.
- [ ] **Poste à cheval sur deux lignes** (sortie de ligne servant A et B) — EN ATTENTE.
      Proposition du 2026-10-13 : ligne principale + lignes partagées
      (`poste_ligne_partagee`, migration 0090) ; besoin si AU MOINS une ligne ouverte,
      compté une fois ; reflet en pointillés au Placement ; Matrice / bilans inchangés
      (ligne principale). Alternative sans code : une ligne commune « Sortie A/B ».
      À trancher : option, règle du besoin (une / toutes), même service seulement ?,
      placement depuis le reflet, impression du reflet.

## Rappels
- Tests et build avant chaque commit, en lisant leur **code de sortie** (pas de
  `vitest | grep`, cf. `lessons.md` L51) ; commit + push sur `main` (déploiement Vercel
  auto). Auteur git = `jf.gautreau@gmail.com`.
- Toute nouvelle migration s'exécute **manuellement** dans le SQL Editor Supabase ; le
  code qui la lit ne part qu'une fois la migration appliquée.
