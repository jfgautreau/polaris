-- =====================================================================
-- Migration 0056 - Masquage de menus par site (site_module)
--
-- OBJECTIF
-- Permettre au super_admin, depuis /platform, de masquer certains menus
-- pour un client (site) donné — globalement, pour TOUS ses utilisateurs,
-- au-dessus de la matrice de droits. Un module masqué disparaît de la
-- navigation ET sa route renvoie un refus (blocage réel, pas cosmétique).
--
-- MODÈLE (comme poste_quart : on ne stocke que les DÉVIATIONS)
-- Défaut = tout visible. Une ligne dans `site_module` = « ce module est
-- MASQUÉ pour ce site ». Absence de ligne = visible. Table volontairement
-- minimale : (site_id, module_key). `module_key` = clé de MODULES
-- (src/lib/permissions.ts), validée côté application.
--
-- RLS : chaque utilisateur lit les modules masqués de SON site (pour
-- construire sa navigation) ; l'écriture est réservée au super_admin
-- (le back-office /platform écrit de toute façon en service_role). Pas de
-- passe-droit `OR is_super_admin()` sur le SELECT (cf. leçon 0055 : ça
-- fuirait entre sites pendant l'impersonation) — current_site_id() suffit
-- et renvoie déjà le bon site (cible en impersonation).
--
-- À exécuter dans le SQL Editor APRÈS 0055.
-- =====================================================================

create table if not exists public.site_module (
  site_id     uuid not null references public.site (id) on delete cascade,
  module_key  text not null,
  primary key (site_id, module_key)
);

create index if not exists site_module_site_idx on public.site_module (site_id);

alter table public.site_module enable row level security;

drop policy if exists site_module_select on public.site_module;
create policy site_module_select on public.site_module for select to authenticated
  using (site_id = public.current_site_id());

drop policy if exists site_module_modify on public.site_module;
create policy site_module_modify on public.site_module for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());
