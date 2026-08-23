# Exploitation — Polaris

## Mises à jour de l'application
- Modifier le code, vérifier : `npm run build` puis `npm test`.
- Pousser sur GitHub → Vercel redéploie automatiquement (preview sur branche,
  production sur `main`).

## Migrations de base de données
- Ajouter un fichier `supabase/migrations/00XX_*.sql` (idempotent : `if not exists`,
  `create or replace`, `drop policy if exists`...).
- L'exécuter dans le **SQL Editor** Supabase (ou `npm run db:migrate`).
- Après un DDL, le cache de schéma PostgREST peut mettre ~1 min à se rafraîchir
  (*Project Settings > API > Reload schema* pour forcer).

## Sauvegardes
- Supabase réalise des **sauvegardes automatiques** (selon le plan). Vérifier la
  rétention dans *Database > Backups*.
- Export manuel : *Database > Backups* (ou `pg_dump` via la chaîne de connexion).

## Gestion des utilisateurs
- `/admin/users` : bouton **« ＋ Ajouter »** (modale) — nom, email, rôle. **Aucun mot de
  passe à choisir** : le compte créé, un **lien** s'affiche ; transmettez-le (Teams, SMS,
  de vive voix), la personne définit elle-même son mot de passe.
- Même principe pour un oubli : bouton **« Lien de mot de passe »** sur la ligne du compte.
  Le lien est **à usage unique** et en générer un nouveau annule le précédent.
  Aucun e-mail n'est envoyé — le SMTP du projet n'est pas configuré, c'est assumé.
  ⚠️ Générez-le depuis l'**application en ligne** : depuis un `npm run dev`, le lien
  pointerait sur `localhost` et ne marcherait que sur votre machine (l'encart vous prévient).
- Le **rôle** s'enregistre dès que vous le changez dans la liste (plus de bouton Valider).
- Rôles **intégrés** : `admin`, `chef_equipe`, `ordo`, `rh`, `codir`, `planning`.
  Rôles **personnalisés** : bouton **« ＋ Nouveau rôle »** dans `/admin/users` — un
  rôle personnalisé naît sans aucun droit (à régler dans la matrice), puis devient
  assignable comme les autres. Table `role_custom` (migration `0042`).
- Les droits fins se règlent dans la **matrice rôle × module**, en bas du même écran ;
  elle fait foi partout (aucun rôle n'est câblé en dur dans le code, garde-fous
  anti-escalade calculés sur la matrice).
- Désigner les chefs d'équipe dans `/admin/equipes` (pilote le périmètre d'édition
  de la matrice / du planning / des habilitations).
- L'utilisateur peut changer son propre mot de passe depuis son menu (`/compte`), ou
  passer par `/forgot` s'il n'arrive plus à se connecter.

## Documentation utilisateur
- **Guide utilisateur** : accessible depuis la bulle du profil (avatar en haut à droite),
  sous « Changer le mot de passe ». Document autonome `public/guide.html`, ouvert dans un
  onglet séparé pour ne pas perdre une saisie en cours. Il reste derrière l'authentification.
- Pour le modifier : éditer `public/guide.html` (HTML statique, aucune dépendance) et pousser.

## RGPD
- Fiche personne (`/personnel/[id]`) : **Exporter** (JSON), **Anonymiser**, **Supprimer**.
- Registre des traitements : `/admin/rgpd`.

## Journal d'audit
- `/journal` (admin + codir) : toutes les modifications métier tracées.
- Conservation cible 3 ans (purge automatique à mettre en place via tâche planifiée).

## Affichage couloir
- `/affichage` (admin) liste les ateliers ; `/affichage/atelier/{id}` = écran TV
  (**fenêtre glissante** autour d'aujourd'hui, refresh **5 min**, bouton Imprimer/PDF).
- **Fenêtre paramétrable** dans `/admin/motifs` (section « Fenêtre d'affichage du
  planning ») : nombre de jours avant J et après J, auto-sauvegardés (défaut J-1 / J+4).
  Table `parametre_affichage`, une ligne **par site** depuis la migration `0051`.
- Restreindre l'accès réseau en production (cf. INSTALL.md §7).

## Plateforme multi-site (`/platform`)
- Réservé aux comptes `est_super_admin`. Permet de **lister / créer / suspendre /
  archiver** les sites, et d'**entrer dans un site** (impersonation tracée, bandeau
  rouge permanent, journal `audit_impersonation`).
- Un nouveau site démarre en **dupliquant les référentiels** d'un site source choisi
  au formulaire (motifs, contrats, agences, compétences, échelle, quarts, rôles,
  matrice des droits). Chaque site est ensuite totalement indépendant.
- Détail complet : `tasks/multi-site.md`.

## Dépannage
- « Could not find the table ... in the schema cache » : cache PostgREST pas à jour
  après une migration → attendre ~1 min ou recharger le schéma.
- Page qui redirige vers /login : session expirée (8 h) → se reconnecter.
