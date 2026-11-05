-- =====================================================================
-- 0093 — Excel agence des Synthèses intérim (2026-11-05)
--
-- Trois ajouts, indépendants, tous rejouables :
--
-- 1. atelier.couleur — couleur pastel d'un service, choisie au Référentiel
--    dans une palette fermée (src/lib/service-couleurs.ts). Colore, dans
--    l'Excel agence, chaque case du jour selon le service du poste tenu ce
--    jour-là. Vide = pas de couleur.
--
-- 2. parametre_rh — réglages RH d'un site (une ligne par site). Pour l'instant
--    la forme du nom du fichier Excel intérim (Param. RH), avec ses balises
--    {agence} {semaine} {annee} {date} {heure} {site}. Vide = forme par défaut.
--    Lu et écrit en service_role, borné au site, après la garde du module.
--
-- 3. export_interim_photo — « photo » de chaque extraction Excel d'une agence
--    pour une semaine : le contenu des cases par personne (personne_id → cases),
--    SANS nom ni prénom (relus à la comparaison). L'extraction suivante de la
--    même agence et de la même semaine surligne en jaune fluo ce qui a changé.
--    Aucune lecture sous RLS : service_role seulement, borné au site. Les photos
--    de plus de 8 semaines sont purgées par la route à chaque extraction.
--
-- Aucune référence inter-sites hors `site` : le trigger verifier_site_fk (0092)
-- n'a pas à être rejoué.
-- =====================================================================

-- 1. Couleur d'un service ---------------------------------------------------
alter table public.atelier
  add column if not exists couleur text
    check (couleur is null or couleur ~ '^#[0-9a-f]{6}$');

-- 2. Réglages RH ------------------------------------------------------------
create table if not exists public.parametre_rh (
  site_id              uuid primary key references public.site (id) on delete cascade,
  interim_nom_fichier  text check (interim_nom_fichier is null or char_length(interim_nom_fichier) <= 150),
  updated_at           timestamptz not null default now()
);

alter table public.parametre_rh enable row level security;

drop policy if exists parametre_rh_select on public.parametre_rh;
create policy parametre_rh_select on public.parametre_rh
  for select to authenticated
  using (site_id = (select public.current_site_id()));

grant select, insert, update, delete on public.parametre_rh to authenticated, service_role;

-- 3. Photos des extractions Excel agence ------------------------------------
create table if not exists public.export_interim_photo (
  id             bigint generated always as identity primary key,
  site_id        uuid not null references public.site (id) on delete cascade,
  agence         text not null,
  semaine_lundi  date not null,
  contenu        jsonb not null,
  created_at     timestamptz not null default now(),
  created_by     uuid
);

create index if not exists export_interim_photo_cle_idx
  on public.export_interim_photo (site_id, agence, semaine_lundi, created_at desc);

alter table public.export_interim_photo enable row level security;
-- Aucune policy : ni lecture ni écriture sous RLS (service_role seulement).

grant select, insert, update, delete on public.export_interim_photo to authenticated, service_role;
grant usage, select on sequence public.export_interim_photo_id_seq to authenticated, service_role;

-- Vérification :
--   select column_name from information_schema.columns
--    where table_name = 'atelier' and column_name = 'couleur';
--   select count(*) from public.parametre_rh;
--   select count(*) from public.export_interim_photo;
