# Polaris

Application web de gestion des plannings d'une **usine agroalimentaire** :
référentiel (ateliers / lignes / postes), matrice de polyvalence, planning et
placement journalier, habilitations à recycler, affichage couloir (TV), bilans.
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
- **Référentiel** — ateliers / lignes / postes (abaque, catégorie, habilitations requises), équipes & chefs.
- **Personnel** — fiche, cycle de vie (contrats = source de vérité), absences, RGPD.
- **Matrice de polyvalence** — niveaux actuel / cible par personne × poste, objectifs, bilan. Échelle du carré magique paramétrable par site (nombre de niveaux, seuil « compétent », couleur par niveau) dans l'écran Compétences.
- **Habilitations** — échéances de recyclage, alertes couleur, cloche d'alerte.
- **Ordonnancement** — ouverture des lignes par quart, semaines types, rotation des équipes.
- **Planning** — placement (poste / absence / non travaillé) sur plusieurs semaines, indicateurs.
- **Placement** — saisie glisser-déposer par jour et par quart, copie, export PDF.
- **Affichage couloir** — écran TV public par atelier (fenêtre glissante paramétrable).
- **Bilans** — cockpit CODIR + rapports imprimables (effectifs, polyvalence, couverture, anticipation).
- **Journal d'audit** + notifications (cloche habilitations).
- **Plateforme** (`/platform`) — back-office super_admin : gestion des sites, impersonation tracée.

## Commandes
```sh
npm run dev      # développement
npm run build    # build production (échoue sur toute erreur TS/ESLint)
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
