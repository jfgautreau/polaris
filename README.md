# Polaris

Application web de gestion des plannings d'une **usine agroalimentaire** :
référentiel (services / lignes / postes), matrice de polyvalence, planning et
placement journalier, absences, habilitations à recycler, visites médicales (RH),
horaires, affichage couloir (TV), bilans, journal d'audit.
Plateforme **multi-site** (SaaS multi-tenant : plusieurs usines isolées sur une
seule base). Interface en français.

## Stack
- **Next.js 16** (App Router, Server Components + Server Actions) · React 19 · TypeScript
- **Supabase** : PostgreSQL + Auth + Row Level Security
- **Déploiement** : Vercel (push `main` → build auto, région `cdg1`, Fluid Compute)
- **Tests** : Vitest

## Démarrage rapide
```sh
npm install
cp .env.local.example .env.local     # renseigner les clés Supabase
# appliquer les migrations supabase/migrations/*.sql dans le SQL Editor Supabase
npm run dev                           # http://localhost:3000
```
Détails : **[INSTALL.md](INSTALL.md)**.

## Modules
- **Référentiel** — services / lignes / postes (effectif par quart, catégorie, habilitations requises, numéros de rotation, couleur de ligne, ordre d'affichage), équipes & chefs.
- **Personnel** — fiche, cycle de vie (contrats = source de vérité), temps partiel, RGPD.
- **Absences** — périodes reconstruites depuis les jours posés, filtres service / équipe / motif.
- **Matrice de polyvalence** — niveaux actuel / cible par personne × poste, objectifs, bilan. Échelle du carré magique paramétrable par site (nombre de niveaux, seuil « compétent », couleur par niveau) dans l'écran Compétences.
- **Habilitations** — échéances de recyclage, alertes couleur, cloche d'alerte, historique (suppressions comprises).
- **Visites médicales** (RH) — dates et types de visites de médecine du travail, sans aucune donnée de santé. Le régime de suivi (simple / adapté / renforcé) est calculé à partir des quarts de nuit, des postes tenus et des habilitations ; les déclencheurs se règlent dans Param. Visites.
- **Ordonnancement** — ouverture des lignes par quart, semaines types, rotation des équipes.
- **Planning** — placement (poste / absence / non travaillé) sur plusieurs semaines, vues par nom ou par poste, recopie sans écrasement, indicateurs.
- **Placement** — saisie glisser-déposer par jour et par quart, copie, trois feuilles PDF (Manager, pour Affichage, pour Affichage + heures).
- **Horaires** — horaire par poste, quart et jour ; variantes « après une nuit » et par place.
- **Affichage couloir** — écran TV public par service (fenêtre glissante paramétrable).
- **Bilans** — cockpit CODIR + rapports imprimables (effectifs, polyvalence, couverture, anticipation).
- **Journal d'audit** — auteur réel, filtres, opérations groupées, conservation réglable ; notifications (cloche habilitations).
- **Plateforme** (`/platform`) — back-office super_admin : gestion des sites, impersonation tracée.

## Commandes
```sh
npm run dev      # développement
npm run build    # build production (échoue sur toute erreur TypeScript ; pas d'ESLint)
npm test         # tests unitaires (règles métier + gardes statiques)
```

## Documentation
| Fichier | Contenu |
|---|---|
| **[CLAUDE.md](CLAUDE.md)** | Brief agent : règles de travail, permissions, pièges métier, patterns UI. **La référence.** |
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | Modèle de données, RLS, rôles, sitemap. |
| **[INSTALL.md](INSTALL.md)** | Installation, Supabase, premier admin, déploiement. |
| **[OPERATIONS.md](OPERATIONS.md)** | Mises à jour, migrations, sauvegardes, utilisateurs, RGPD. |
| **[tasks/handoff.md](tasks/handoff.md)** | Détail écran par écran. |
| **[tasks/lessons.md](tasks/lessons.md)** | Pièges déjà rencontrés (à relire avant de recoder un sujet). |
| **[tasks/multi-site.md](tasks/multi-site.md)** | Architecture et état du chantier multi-tenant. |
| **[tasks/todo.md](tasks/todo.md)** | Reste à faire. |
