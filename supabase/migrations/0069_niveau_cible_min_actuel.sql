-- 0069 — Aligne la cible sur le niveau actuel là où elle est en-dessous.
--
-- Depuis la refonte 2026-09-09 de MatrixGrid.bump(), la saisie interactive
-- garantit `niveau_cible >= niveau_actuel` (mode Actuel) : la cible « suit »
-- l'actuel quand elle collait, et remonte de force si l'actuel la dépasse. Le
-- mode Cible, lui, restreint le cycle à `[niveau_actuel .. nbNiveaux, ❌]`.
--
-- Cette migration APPLIQUE la même règle sur l'historique (une donnée saisie
-- avant la refonte, ou provenant d'un import initial, pouvait porter une
-- cible strictement inférieure à l'actuel — cas absurde métier : on ne « vise »
-- pas plus bas que ce qu'on tient déjà).
--
-- Périmètre :
--   - `niveau_actuel > 0` (rien à faire à 0 : la cible peut valablement rester à 0) ;
--   - `niveau_cible >= 0` : on ne touche PAS une cible en restriction (-1,
--     RESTRICT côté app), qui signifie une décision médicale/physique et vit
--     hors de l'échelle numérique.
--
-- Idempotente : la seconde exécution ne modifie plus rien.

update public.matrice
   set niveau_cible = niveau_actuel
 where niveau_actuel > 0
   and niveau_cible >= 0
   and niveau_cible < niveau_actuel;
