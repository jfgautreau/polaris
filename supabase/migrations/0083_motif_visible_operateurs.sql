-- 0083 : motif d'absence affiché ou non sur le PDF opérateurs du Placement.
--
-- Le PDF opérateurs (A3, « PDF » et « PDF heures ») ne montrait aucune absence.
-- Les RH choisissent, motif par motif dans Param. RH, ceux qui peuvent y
-- figurer (colonne « Absents du jour », motif écrit). Un motif non coché
-- n'apparaît pas du tout : la personne n'est simplement pas sur la feuille.
-- Le PDF Manager, lui, continue de montrer tous les motifs.
--
-- Défaut : décoché pour tous les motifs (décision du 2026-10-09) — rien ne
-- s'affiche tant que les RH n'ont pas coché les motifs à montrer.

alter table public.motif_absence
  add column if not exists visible_operateurs boolean not null default false;
