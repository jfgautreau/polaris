-- =====================================================================
-- Migration 0058 - site_id sur tp_periode
--
-- La table tp_periode (0052) a été créée AVANT le passage multi-site des
-- référentiels (0053) et a été oubliée du lot : elle n'a jamais reçu de
-- colonne site_id. Le code applicatif (/api/personnel, op « tp-periode-* »)
-- filtre pourtant et insère déjà sur site_id, d'où l'erreur à
-- l'enregistrement d'un temps partiel :
--   « Could not find the 'site_id' column of 'tp_periode' in the schema cache ».
--
-- Cette migration aligne tp_periode sur les autres tables site-scopées :
--   backfill depuis personne.site_id, NOT NULL, index, trigger de
--   filet de sécurité set_site_id_from_context.
--
-- À exécuter dans le SQL Editor du projet Supabase APRÈS 0057.
-- =====================================================================


-- A. Ajout de la colonne. DEFAULT lebignon le temps du backfill, retiré en §D.
alter table public.tp_periode
  add column if not exists site_id uuid not null
  default '00000000-0000-4000-8000-00000000c0de'
  references public.site (id) on delete cascade;


-- B. Backfill : chaque période prend le site de sa personne (source de vérité).
--    Écrase le DEFAULT lebignon pour les personnes rattachées à un autre site.
update public.tp_periode tp
   set site_id = p.site_id
  from public.personne p
 where p.id = tp.personne_id
   and tp.site_id is distinct from p.site_id;


-- C. Index de filtrage.
create index if not exists tp_periode_site_idx on public.tp_periode (site_id);


-- D. Retrait du DEFAULT : l'application fournit site_id explicitement (le
--    trigger ci-dessous reste un filet de sécurité). Laisser un DEFAULT
--    lebignon masquerait un oubli de site_id en écrivant chez Lebignon.
alter table public.tp_periode alter column site_id drop default;


-- E. Trigger set_site_id_from_context (cohérence avec 0053 §H).
drop trigger if exists set_site_id_tp_periode on public.tp_periode;
create trigger set_site_id_tp_periode
  before insert on public.tp_periode
  for each row execute function public.set_site_id_from_context();


-- =====================================================================
-- FIN 0058
-- =====================================================================
