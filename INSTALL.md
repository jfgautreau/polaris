# Installation — Polaris

## Prérequis
- Node.js 20+
- Un projet **Supabase** (le plan gratuit suffit pour démarrer)

## 1. Code et dépendances
```sh
npm install
```

## 2. Configurer Supabase
1. Créer un projet sur https://supabase.com.
2. Dans *Project Settings > API*, récupérer : l'**URL**, la clé **publishable (anon)**
   et la clé **service_role**.
3. Copier `.env.local.example` en `.env.local` et renseigner :
   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   NEXT_PUBLIC_SITE_URL=https://<votre-domaine>   # base des liens de mot de passe
   ```

## 3. Appliquer les migrations
Dans le **SQL Editor** de Supabase, exécuter **dans l'ordre** tous les fichiers de
`supabase/migrations/` (0001 → dernière du dépôt). Voir CLAUDE.md § Base de données
pour la dernière migration appliquée en production.

> Alternative : renseigner `SUPABASE_DB_URL` (*Database > Connection string*) dans
> `.env.local` puis `npm run db:migrate`.

Le socle **multi-site** (migration 0043) crée la table `site` et insère le site
historique « lebignon ». Toutes les données existantes lui sont rattachées.

## 4. Créer le premier administrateur
1. Supabase → *Authentication > Users > Add user* (email + mot de passe, ☑ Auto Confirm).
2. SQL Editor :
   ```sql
   update public.app_user set role = 'admin', is_active = true
   where email = 'ton.email@exemple.fr';
   ```
   Pour un compte de plateforme (gestion des sites) : ajouter `est_super_admin = true`.
   (Depuis la migration 0092, un compte créé hors de l'écran Utilisateurs naît **inactif** :
   c'est cette requête qui l'ouvre.)

## 5. Lancer en local
```sh
npm run dev      # http://localhost:3000
```
Se connecter, puis construire la structure (Référentiel, Équipes, Personnel…).

## 6. Tests et build
```sh
npm test
npm run build
```

## 7. Déploiement Vercel
1. Pousser le dépôt sur GitHub, l'importer dans Vercel (framework Next.js détecté).
2. Définir les variables d'environnement (mêmes valeurs que `.env.local`).
3. Supabase → *Authentication > URL Configuration* : ajouter l'URL Vercel (et
   `http://localhost:3000`) aux *Redirect URLs*.
4. **Affichage couloir** : depuis le 2026-11-03, les pages `/affichage/*` exigent un compte.
   Créer dans `/admin/users` un rôle personnalisé (ex. « TV ») qui n'a que le droit
   `affichage` en lecture, un compte de ce rôle, puis se connecter avec lui sur le poste
   relié à la TV et laisser la page du service ouverte.
5. **En-têtes de sécurité** (CSP, anti-clickjacking) : posés par `next.config.ts`. La CSP
   n'autorise que le site lui-même et l'URL Supabase (`NEXT_PUBLIC_SUPABASE_URL`) : tout
   nouveau service externe (script, image, API) doit y être ajouté.
