-- =====================================================================
-- Migration 0074 - Suppression de policies RLS permissives orphelines
--
-- CONTEXTE / BUG
-- La 0043 (multi-site) a réécrit toutes les policies RLS en les nommant
-- `<table>_select` / `<table>_modify`. Elle droppe l'ancienne policy AVANT
-- de recréer la sienne — mais UNIQUEMENT si l'ancienne portait déjà ce nom.
-- Deux tables avaient des policies au nom NON standard, jamais droppées :
--
--   • semaine_type_profil : `stp_select` (using true) + `stp_modify`  (0028)
--   • poste_competence_requise : `pcr_select` (using true) + `pcr_modify` (0032)
--
-- Les policies permissives se combinent en OR : la vieille `*_select using
-- (true)` restait active À CÔTÉ de la nouvelle `*_select using (site_id =
-- current_site_id())`. Résultat : ces deux tables étaient visibles (et,
-- pour le modify sans borne de site, modifiables) CROSS-SITE.
--
-- Symptôme constaté : sur le site La Vraie Croix, l'écran Ordonnancement
-- affichait les semaines type (profils) de Le Bignon.
--
-- CORRECTIF
-- On droppe les policies orphelines. Les policies site-scopées créées par
-- la 0043 (`semaine_type_profil_select/_modify`,
-- `poste_competence_requise_select/_modify`) restent seules en place et
-- filtrent correctement par site.
--
-- A executer dans le SQL Editor.
-- =====================================================================

drop policy if exists stp_select on public.semaine_type_profil;
drop policy if exists stp_modify on public.semaine_type_profil;

drop policy if exists pcr_select on public.poste_competence_requise;
drop policy if exists pcr_modify on public.poste_competence_requise;
