-- =====================================================================
-- 0094 — Mise en page des PDF de placement (2026-11-05)
--
-- Une mise en page par SERVICE et par PDF (Manager, pour Affich., pour Affich.
-- + heures), réglée dans l'écran « Mise en page PDF » (droit dédié
-- `placement_pdf`) : format (A4 / A3), orientation, et des blocs posés sur une
-- grille de 12 × 12 cases :
--   blocs = [{ "type": "entete" | "legende" | "absents" | "ligne",
--              "ligne_id"?: uuid, "x": 0-11, "y": 0-11, "w": 1-12, "h": 1-12,
--              "postes"?: [uuid…] }]      -- ordre des postes dans la ligne
-- Aucune ligne = disposition automatique actuelle du PDF.
--
-- Lecture sous RLS (le Placement lit la mise en page de son site) ; écriture en
-- service_role par /api/placement-mise-en-page, après la garde du module.
-- La référence atelier_id est couverte par le trigger verifier_site_fk (0092).
-- =====================================================================

create table if not exists public.placement_mise_en_page (
  site_id      uuid not null references public.site (id) on delete cascade,
  atelier_id   uuid not null references public.atelier (id) on delete cascade,
  pdf          text not null check (pdf in ('manager', 'affich', 'affich_heures')),
  format       text not null default 'A3' check (format in ('A4', 'A3')),
  orientation  text not null default 'paysage' check (orientation in ('paysage', 'portrait')),
  blocs        jsonb not null default '[]'::jsonb,
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  primary key (site_id, atelier_id, pdf)
);

alter table public.placement_mise_en_page enable row level security;

drop policy if exists placement_mise_en_page_select on public.placement_mise_en_page;
create policy placement_mise_en_page_select on public.placement_mise_en_page
  for select to authenticated
  using (site_id = (select public.current_site_id()));

grant select, insert, update, delete on public.placement_mise_en_page to authenticated, service_role;

-- Filet inter-sites (0092) : l'atelier référencé appartient au même site.
drop trigger if exists verifier_site_fk on public.placement_mise_en_page;
create trigger verifier_site_fk before insert or update on public.placement_mise_en_page
  for each row execute function public.verifier_site_fk('atelier_id', 'atelier', 'id', 'uuid');

-- Vérification :
--   select count(*) from public.placement_mise_en_page;
--   select tgname from pg_trigger where tgrelid = 'public.placement_mise_en_page'::regclass;
