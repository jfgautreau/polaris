-- 0065 : couleur de niveau — ouverture au nuancier + rattrapage 0063.
--
-- Contexte : la 0063 ajoutait competence_niveau_libelle.couleur avec un CHECK
-- verrouillant la palette aux 4 teintes historiques. Elle n'a PAS été appliquée
-- partout (l'écran /admin/competences renvoyait, à l'enregistrement d'une couleur,
-- « Could not find the 'couleur' column of 'competence_niveau_libelle' in the
-- schema cache » — PostgREST ne connaissait pas la colonne).
--
-- Cette migration est IDEMPOTENTE et se suffit à elle-même :
--   1. garantit la colonne `couleur` (que 0063 ait été jouée ou non) ;
--   2. remplace le CHECK verrouillé par un simple contrôle de FORMAT hexadécimal,
--      ouvrant la couleur à tout le nuancier (la liste fermée reste imposée côté
--      application, cf. src/lib/couleurs-niveau.ts) ;
--   3. amorce l'échelle historique pour les niveaux 1..4 non encore renseignés.
--
-- À exécuter dans le SQL Editor APRÈS 0064.

-- 1. Colonne (sans CHECK ici : on le pose proprement à l'étape 2).
alter table public.competence_niveau_libelle
  add column if not exists couleur text;

-- 2. Contrainte : retirer l'ancien CHECK verrouillé (0063) s'il existe, puis
--    poser un CHECK de FORMAT (couleur NULL — niveau 0 — ou #RRGGBB).
alter table public.competence_niveau_libelle
  drop constraint if exists competence_niveau_libelle_couleur_check;

alter table public.competence_niveau_libelle
  add constraint competence_niveau_libelle_couleur_check
    check (couleur is null or couleur ~ '^#[0-9a-fA-F]{6}$');

-- 3. Amorçage : échelle historique pour chaque site, afin que rien ne change
--    visuellement tant qu'un site ne personnalise pas ses couleurs.
update public.competence_niveau_libelle
   set couleur = case niveau
                   when 1 then '#dc2626'
                   when 2 then '#f59e0b'
                   when 3 then '#84cc16'
                   when 4 then '#16a34a'
                 end
 where niveau between 1 and 4
   and couleur is null;
