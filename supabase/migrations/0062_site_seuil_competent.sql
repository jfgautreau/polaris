-- 0062 : seuil « compétent » paramétrable, PAR SITE.
--
-- Les bilans (Cockpit, Polyvalence, Anticipation, Montée en compétence) et la
-- ligne « Compétences (≥N) » de la Matrice comptent une personne comme
-- COMPÉTENTE sur un poste dès qu'elle atteint un certain niveau. Ce seuil était
-- codé en dur à 2 partout. On le rend réglable par site, depuis l'écran
-- /admin/competences, à côté du nombre de niveaux activés (0061).
--
-- Borné à 1..4 (repli 2 = comportement historique) ; l'application le contraint
-- en plus à ≤ nb_niveaux (un seuil au-dessus du plus haut niveau activé n'aurait
-- pas de sens). N'affecte QUE les rapports : aucun impact sur la saisie ni le
-- placement. Le niveau requis PAR POSTE (poste.niveau_min_requis), lui, reste une
-- notion distincte et n'est pas touché.
--
-- À exécuter dans le SQL Editor APRÈS 0061.

alter table public.site
  add column if not exists seuil_competent int not null default 2
    check (seuil_competent between 1 and 4);
