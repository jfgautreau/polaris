-- =====================================================================
-- Migration 0071 — ouverture / fermeture datée des lignes et postes
--
-- Aujourd'hui une ligne ou un poste est actif OUI/NON (colonne `actif`),
-- sans notion de date. On ajoute deux dates PRÉVISIONNELLES, nullables :
--   • date_ouverture  — avant cette date, l'élément n'est pas encore ouvert ;
--   • date_fermeture  — après cette date, l'élément est fermé.
--
-- `actif` reste le coupe-circuit manuel immédiat. La visibilité effective à
-- une date J (cf. src/lib/referentiel-validite.ts, actifLe) =
--   actif  ET  (date_ouverture is null OU J >= date_ouverture)
--          ET  (date_fermeture is null OU J <= date_fermeture).
--
-- Défaut = les deux dates NULL → comportement identique à aujourd'hui. Le code
-- lit ces dates avec la date du jour : quand la fermeture est atteinte, la
-- ligne / le poste disparaît tout seul des écrans, sans geste manuel.
--
-- Colonnes nullables, aucun défaut : une base sans ces colonnes se comporte
-- exactement comme avant (les lectures tolèrent leur absence). Même esprit que
-- le cycle de vie du personnel (contrats -> statut).
--
-- À exécuter dans le SQL Editor APRÈS 0070.
-- =====================================================================

alter table public.ligne
  add column if not exists date_ouverture date,
  add column if not exists date_fermeture date;

alter table public.poste
  add column if not exists date_ouverture date,
  add column if not exists date_fermeture date;
