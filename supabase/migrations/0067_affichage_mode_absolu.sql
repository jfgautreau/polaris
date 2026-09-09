-- =====================================================================
-- Migration 0067 — Mode d'affichage TV : relatif (jours) ou absolu (semaines)
--
-- Jusque-là, la fenêtre TV était purement RELATIVE : `jours_avant` et
-- `jours_apres` autour d'aujourd'hui. Certains sites préfèrent un cadrage
-- absolu (« S, S+1 »), calé sur les semaines calendaires.
--
-- On ajoute deux colonnes à `parametre_affichage` :
--   - `mode`         'relatif' (défaut) | 'absolu'
--   - `nb_semaines`  1..6, utilisé quand mode = 'absolu' (défaut 2)
--
-- Les colonnes `jours_avant` / `jours_apres` restent inchangées : elles
-- servent au mode 'relatif'. En mode 'absolu' la fenêtre est calculée
-- côté application (lundi de la semaine courante → dimanche de la
-- Nᵉ semaine).
--
-- À exécuter dans le SQL Editor APRÈS 0066.
-- =====================================================================

ALTER TABLE public.parametre_affichage
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'relatif'
    CHECK (mode IN ('relatif', 'absolu')),
  ADD COLUMN IF NOT EXISTS nb_semaines int NOT NULL DEFAULT 2
    CHECK (nb_semaines BETWEEN 1 AND 6);
