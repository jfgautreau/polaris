-- 0082 : couleur fixe par ligne, choisie au Référentiel.
--
-- Les PDF du Placement colorent les lignes qui tournent (au moins une personne
-- placée). La couleur était attribuée selon le rang de la ligne dans le plan du
-- jour : une ligne absente d'un quart décalait celle des suivantes. Les chefs
-- d'équipe veulent qu'une ligne garde toujours la même couleur.
--
-- Palette fermée (src/lib/ligne-couleurs.ts) : seule la teinte de base est
-- stockée, en minuscules. Reprise : chaque ligne existante reçoit la couleur
-- que lui donnait l'attribution automatique (rang dans son service, par
-- n° d'affichage puis nom), pour que les feuilles ne changent pas d'aspect.

alter table public.ligne
  add column if not exists couleur text
    check (couleur is null or couleur ~ '^#[0-9a-f]{6}$');

with rang as (
  select id,
         row_number() over (
           partition by atelier_id
           order by actif desc, coalesce(ordre_affichage, 0), nom
         ) - 1 as r
    from public.ligne
)
update public.ligne l
   set couleur = (array['#2557c7','#7a3fc4','#0f7a8a','#b3307a','#4338ca','#8a5a2b','#0369a1','#86198f'])[(rang.r % 8) + 1]
  from rang
 where rang.id = l.id
   and l.couleur is null;
