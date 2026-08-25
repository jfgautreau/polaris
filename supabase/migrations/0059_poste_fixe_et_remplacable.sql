-- =====================================================================
-- Migration 0059 — Poste fixe (pré-remplissage du planning) + PTR/PTNR.
-- À exécuter dans le SQL Editor Supabase APRÈS 0058.
--
-- Deux besoins distincts, deux colonnes indépendantes :
--   1. poste.remplacable  — abaque : PTR (remplaçable) / PTNR (non). Nettoie
--      les rapports de fragilité/relève et isole les postes irremplaçables
--      « par nature » dans les compétences critiques.
--   2. personne.poste_fixe_id — la personne est placée par défaut sur ce poste
--      (bouton « Pré-remplir » du planning), sauf absence.
-- =====================================================================

-- 1. Remplaçabilité d'un poste. true = PTR (remplaçable, défaut) ; false = PTNR
--    (Position de Travail Non Remplaçable : un seul titulaire par conception —
--    directrice, responsable maintenance…). Les postes existants restent PTR :
--    aucun changement de comportement tant qu'on n'en marque pas un PTNR.
alter table public.poste
  add column if not exists remplacable boolean not null default true;

-- 2. Poste fixe d'une personne. NULL = pas de poste fixe (cas général).
--    on delete set null : désactiver/supprimer un poste ne casse pas la fiche.
alter table public.personne
  add column if not exists poste_fixe_id uuid references public.poste (id) on delete set null;
create index if not exists personne_poste_fixe_idx on public.personne (poste_fixe_id);
