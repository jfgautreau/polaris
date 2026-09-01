-- =====================================================================
-- Migration 0064 — Temps partiel MATÉRIALISÉ dans le planning.
-- À exécuter dans le SQL Editor Supabase APRÈS 0063.
--
-- Jusqu'ici, le « TP » du planning était PUREMENT CALCULÉ à l'affichage
-- (src/app/planning/page.tsx : tpBlocked, dérivé de personne.tp_config +
-- rotation datée). Impossible à déplacer : le recalcul le remettait en
-- place. Le manager veut charger les TP d'une semaine puis DÉPLACER un
-- jour de TP au glisser-déposer.
--
-- Deux ajouts :
--   1. placement.tp — une case « temps partiel » matérialisée (jour entier
--      non travaillé pour cause de TP). Distinct de non_travaille (« NT »
--      saisi à la main) et d'une absence (motif). Devient une vraie ligne,
--      donc déplaçable.
--   2. tp_charge — drapeau « les TP de cette semaine ont été chargés ».
--      Présence ⇒ le planning n'affiche QUE les vraies lignes placement.tp
--      pour cette semaine (plus de calcul virtuel), ce qui permet de
--      déplacer / retirer un TP sans qu'il soit recréé. Granularité
--      semaine entière (comme la semaine-type d'Ordonnancement, non
--      rétroactive). Le calcul virtuel reste l'aperçu des semaines NON
--      chargées (« repli tant que non chargé »).
-- =====================================================================


-- 1. Marqueur TP sur placement. Défaut false : aucune ligne existante
--    n'est un TP tant qu'on ne charge pas une semaine.
alter table public.placement
  add column if not exists tp boolean not null default false;


-- 2. Semaines dont les TP ont été chargés (matérialisés), par site.
--    site_id : DEFAULT lebignon le temps du backfill (aucune ligne au
--    départ), retiré ensuite — l'application fournit site_id explicitement.
create table if not exists public.tp_charge (
  site_id       uuid not null
                default '00000000-0000-4000-8000-00000000c0de'
                references public.site (id) on delete cascade,
  semaine_lundi date not null,
  charge_le     timestamptz not null default now(),
  charge_par    uuid,
  primary key (site_id, semaine_lundi)
);
alter table public.tp_charge alter column site_id drop default;
create index if not exists tp_charge_site_idx on public.tp_charge (site_id);

-- Filet de sécurité multi-site (cohérence avec 0043 §H / 0058 §E).
drop trigger if exists set_site_id_tp_charge on public.tp_charge;
create trigger set_site_id_tp_charge
  before insert on public.tp_charge
  for each row execute function public.set_site_id_from_context();

-- RLS : lecture bornée au site courant ; écriture admin/ordo/planning
-- (le bouton du Planning écrit via service_role, qui bypasse la RLS —
--  cette policy sert la cohérence et les clients RLS).
alter table public.tp_charge enable row level security;
drop policy if exists tp_charge_select on public.tp_charge;
create policy tp_charge_select on public.tp_charge for select to authenticated
  using (site_id = public.current_site_id());
drop policy if exists tp_charge_modify on public.tp_charge;
create policy tp_charge_modify on public.tp_charge for all to authenticated
  using (site_id = public.current_site_id()
         and (public.is_admin() or public.has_role('ordo') or public.has_role('planning')))
  with check (site_id = public.current_site_id()
         and (public.is_admin() or public.has_role('ordo') or public.has_role('planning')));

-- =====================================================================
-- FIN 0064
-- =====================================================================
