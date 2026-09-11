-- =====================================================================
-- Migration 0069 — regroupement de lignes (étiquette de reporting)
--
-- Ajoute une étiquette TEXTE « regroupement » à DEUX endroits, avec le
-- même vocabulaire (une valeur par service) :
--
--   • ligne.regroupement    — déclaré au Référentiel (saisie inline, à
--     côté du nom de la ligne). Taper « Façonnage » sur des lignes d'un
--     service CRÉE de facto le regroupement. Sert à ventiler le BESOIN
--     (les postes ont une ligne) et à alimenter la liste des
--     regroupements proposés dans la fiche Personnel.
--
--   • personne.regroupement — l'AFFECTATION de la personne, posée depuis
--     la colonne « Service » du Personnel (« Atelier 1 — Façonnage »).
--     C'est elle qui ventile l'EFFECTIF dans le bilan « Projection de
--     compétences — feuille de route », sans double compte (une
--     personne = un seul regroupement).
--
-- Ce N'EST PAS un niveau de hiérarchie : ni la table, ni la navigation,
-- ni le Planning/Placement ne changent. Simple attribut de reporting.
--
-- Colonnes nullables, aucun défaut : une base sans regroupement se
-- comporte exactement comme avant (le bilan n'affiche alors aucun
-- sous-total). Renommage manuel des deux côtés (assumé — cf. décision
-- « version texte », l'autocomplétion évite les fautes de frappe).
--
-- À exécuter dans le SQL Editor APRÈS 0068.
-- =====================================================================

ALTER TABLE public.ligne
  ADD COLUMN IF NOT EXISTS regroupement text;

ALTER TABLE public.personne
  ADD COLUMN IF NOT EXISTS regroupement text;
