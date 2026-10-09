# Exploitation — Polaris

## Mises à jour de l'application
- Modifier le code, vérifier : `npm run build` puis `npm test`.
- Pousser sur GitHub → Vercel redéploie automatiquement (preview sur branche,
  production sur `main`).

## Migrations de base de données
- Ajouter un fichier `supabase/migrations/00XX_*.sql` (idempotent : `if not exists`,
  `create or replace`, `drop policy if exists`...).
- **Ordre de mise en ligne** : la migration d'abord, le code qui lit ses colonnes ensuite.
  Pousser le code avant fait tomber en erreur les écrans qui lisent une colonne absente.
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

## Visites médicales (RH)
- **Droits** : modules `visites` (écran `/visites`) et `visites_param`
  (`/admin/visites-param`), accordés au seul rôle `rh` par défaut. À ouvrir à d'autres
  rôles dans la matrice si besoin — sans oublier qu'il s'agit d'un suivi nominatif.
- **Mise en route d'un site** (migration `0076` appliquée) :
  1. Relire les **déclencheurs** posés par la migration (quarts de nuit déduits de
     l'horaire, habilitations à autorisation de conduite en suivi renforcé, motifs
     d'arrêt cochés pour la reprise) dans `/admin/visites-param → Déclencheurs`.
  2. Cocher les **postes à risques particuliers** (la liste annuelle transmise au service
     de santé au travail est la bonne source).
  3. **Reprendre l'historique** des dernières visites : sans lui, tout le monde
     apparaît « En retard ». Saisie par la fiche de chaque personne (un import est à
     écrire, cf. `tasks/todo.md`).
  4. Seulement ensuite, allumer un à un les **avertissements du Placement**
     (`Param. Visites → Alertes`) — tous éteints au départ.
- **Ce qui n'entre jamais en base** : motif médical, contenu de l'avis, raison d'un
  « suivi adapté » ou d'une contrainte d'affectation. Le commentaire d'une visite est
  logistique (« convoqué, absent au rendez-vous »).
- Les intérimaires (types de contrat « avec agence ») sont **exclus** : leur suivi
  relève de l'agence (R4625-8).

## Documentation utilisateur
- **Guide utilisateur** : accessible depuis la bulle du profil (avatar en haut à droite),
  sous « Changer le mot de passe ». Document autonome `public/guide.html`, ouvert dans un
  onglet séparé pour ne pas perdre une saisie en cours. Il reste derrière l'authentification.
- Pour le modifier : éditer `public/guide.html` (HTML statique, aucune dépendance) et pousser.

## RGPD
- Fiche personne (`/personnel/[id]`) : **Exporter** (JSON), **Anonymiser**, **Supprimer**.
- Registre des traitements : `/admin/rgpd`.

## Journal d'audit
- `/journal` (droit `journal` de la matrice ; admin et CODIR par défaut) : toutes les
  modifications métier, avec leur auteur réel (y compris les écritures faites par le
  serveur, depuis la migration 0086). Filtres par période, auteur, élément, action et
  recherche ; une opération de masse (copie, import…) tient en une ligne.
- **Conservation** réglable en haut de l'écran (13 mois par défaut, droit `journal` en
  écriture). Ce qui dépasse est effacé à l'ouverture du Journal.
- **RGPD** : anonymiser une personne efface du journal les lignes de sa fiche ; la
  supprimer efface toutes les lignes qui la référencent.

## Horaires des postes
- `/admin/horaires` : horaire standard par poste × quart × jour.
- **Quart de nuit** : case « Nuit » dans *Équipes → Rotation des équipes & horaires des
  quarts* (même donnée que dans les paramètres des visites médicales). Indispensable pour
  les horaires « après une nuit ».
- **Horaires après une nuit** : case « Horaires après une nuit » dans Horaires ; appliqués
  automatiquement le lendemain d'une nuit où la ligne a tourné (d'après l'Ordonnancement).
- **Horaires par place** : un poste avec des numéros de rotation (Référentiel) a une ligne
  « Place N » par quart, valable toute la semaine. La personne prend l'horaire de la place
  qu'elle occupe : la poser sur la bonne place au Placement.

## Affichage couloir
- `/affichage` liste les services ; `/affichage/atelier/{id}` = écran TV
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
  matrice des droits, réglages des visites médicales). Chaque site est ensuite
  totalement indépendant.
- Détail complet : `tasks/multi-site.md`.

## Dépannage
- « Could not find the table ... in the schema cache » : cache PostgREST pas à jour
  après une migration → attendre ~1 min ou recharger le schéma.
- Page qui redirige vers /login : session expirée (8 h) → se reconnecter.
