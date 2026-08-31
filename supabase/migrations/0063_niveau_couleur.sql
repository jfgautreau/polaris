-- 0063 : couleur paramétrable par niveau (carré magique), PAR SITE.
--
-- La couleur de chaque pastille de niveau était codée en dur (rouge/orange/vert
-- clair/vert). On la rend réglable par site, depuis /admin/competences, en
-- limitant le choix aux 4 teintes historiques. Stockée sur la ligne du niveau
-- (competence_niveau_libelle est déjà site-scopée, PK (site_id, niveau)).
--
-- Seuls les niveaux POSITIFS portent une couleur : le niveau 0 reste
-- « blanc / contour seul » (couleur NULL), toujours.
--
-- CHECK : couleur NULL (niveau 0) OU l'une des 4 valeurs autorisées. Verrouille
-- la palette côté base, en plus de la validation applicative.
--
-- À exécuter dans le SQL Editor APRÈS 0062.

alter table public.competence_niveau_libelle
  add column if not exists couleur text
    check (couleur is null or couleur in ('#dc2626', '#f59e0b', '#84cc16', '#16a34a'));

-- Amorçage : reprend l'échelle historique pour chaque site, afin que rien ne
-- change visuellement tant qu'un site ne personnalise pas ses couleurs.
update public.competence_niveau_libelle
   set couleur = case niveau
                   when 1 then '#dc2626'
                   when 2 then '#f59e0b'
                   when 3 then '#84cc16'
                   when 4 then '#16a34a'
                 end
 where niveau between 1 and 4
   and couleur is null;
