-- =====================================================================
-- Migration 0068 — quart.couleur (bandeau visuel de rappel du quart)
--
-- Ajoute une colonne `couleur` (hex #rrggbb) à la table `quart` pour
-- permettre au manager d'identifier d'un coup d'œil, dans le Planning,
-- sur quel quart il est en train d'éditer (matin/après-midi/nuit/journée).
--
-- La colonne est réglée par site dans /admin/equipes (« Horaires des
-- quarts ») ; format hexadécimal validé côté application (palette
-- suggérée mais libre — cf. src/lib/quarts.ts NUANCIER_QUART).
--
-- Défauts appliqués aux quarts standards s'ils existent, mais ces valeurs
-- restent modifiables sans contrainte (autre qu'un format #rrggbb).
--
-- À exécuter dans le SQL Editor APRÈS 0067.
-- =====================================================================

ALTER TABLE public.quart
  ADD COLUMN IF NOT EXISTS couleur text
    CHECK (couleur ~* '^#[0-9a-f]{6}$');

-- Seeds "doux" : n'écrase pas une valeur déjà posée.
UPDATE public.quart SET couleur = '#fde68a' WHERE code = 'matin'      AND couleur IS NULL;
UPDATE public.quart SET couleur = '#bfdbfe' WHERE code = 'apres_midi' AND couleur IS NULL;
UPDATE public.quart SET couleur = '#4c1d95' WHERE code = 'nuit'       AND couleur IS NULL;
UPDATE public.quart SET couleur = '#bbf7d0' WHERE code = 'journee'    AND couleur IS NULL;
