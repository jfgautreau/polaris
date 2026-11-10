-- =====================================================================
-- 0095 — Nom de l'application par site (2026-11-10)
--
-- L'application ne porte pas le même nom selon les usines (ex. « BigPlann »).
-- Le nom affiché (onglet du navigateur, en-tête, accueil, affichage TV, guide
-- utilisateur, pied des PDF des Synthèses) se règle par site dans la
-- Plateforme (super_admin, écriture en service_role).
-- Vide (null) = nom par défaut « Polaris » (src/lib/nom-application.ts).
--
-- Colonne ajoutée à une table existante : aucun grant nouveau à poser.
-- =====================================================================

alter table public.site
  add column if not exists nom_application text;

alter table public.site
  drop constraint if exists site_nom_application_check;

alter table public.site
  add constraint site_nom_application_check
  check (nom_application is null or char_length(btrim(nom_application)) between 1 and 40);
