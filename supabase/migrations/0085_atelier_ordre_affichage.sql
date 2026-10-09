-- 0085 : numéro d'affichage des services (ateliers), réglé au Référentiel.
--
-- Les services étaient partout classés par nom. Le Référentiel porte désormais
-- un « N° aff. » par service, comme les lignes : tous les écrans (filtres,
-- Placement, TV, bilans…) classent par ce numéro, puis par nom.
--
-- Reprise : chaque service reçoit son rang alphabétique dans son site
-- (10, 20, 30… pour pouvoir en intercaler un sans tout renuméroter) — l'ordre
-- affiché ne change donc pas tant qu'on ne touche à rien.

alter table public.atelier
  add column if not exists ordre_affichage int not null default 0;

with rang as (
  select id, row_number() over (partition by site_id order by nom) * 10 as r
    from public.atelier
)
update public.atelier a
   set ordre_affichage = rang.r
  from rang
 where rang.id = a.id
   and a.ordre_affichage = 0;
