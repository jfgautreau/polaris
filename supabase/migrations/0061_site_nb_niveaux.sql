-- 0061 : nombre de niveaux de compétence activés, PAR SITE.
--
-- Le « carré magique » de polyvalence est câblé sur une échelle 0→4 (5 pastilles
-- + la restriction ❌). Certains sites n'exploitent que 2 ou 3 niveaux positifs.
-- On rend le nombre de niveaux POSITIFS activés (1..N) réglable par site, depuis
-- l'écran /admin/competences. Le niveau 0 (blanc = aucune compétence) et la
-- restriction restent TOUJOURS présents, quel que soit N.
--
-- Choix assumé : N reste borné à 4 (le maximum historique). On active un
-- SOUS-ENSEMBLE de l'échelle existante — donc AUCUNE contrainte `between 0 and 4`
-- des tables matrice / poste / competence_niveau_libelle n'est touchée, et la
-- palette de couleurs des pastilles est inchangée. Un site qui abaisse N ne perd
-- pas ses données : une case saisie au-dessus de N reste en base, simplement plus
-- proposée à la saisie (l'affichage la borne visuellement à N).
--
-- Le paramètre vit sur `site` (config structurelle du site, à côté des crochets
-- plan/quota/accent déjà présents), pas sur une table métier site-scopée.
--
-- À exécuter dans le SQL Editor APRÈS 0060.

alter table public.site
  add column if not exists nb_niveaux int not null default 4
    check (nb_niveaux between 2 and 4);
