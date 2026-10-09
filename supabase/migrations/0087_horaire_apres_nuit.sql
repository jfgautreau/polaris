-- 0087 : horaire de prise de service « après une nuit ».
--
-- Sur un site, la prise de service n'est pas la même selon que la ligne a
-- tourné de nuit la veille ou non. L'horaire saisi jusqu'ici reste la
-- référence (« sans nuit avant ») ; chaque horaire de poste reçoit une variante
-- FACULTATIVE « après une nuit » (vide = même horaire, borne par borne).
--
-- Règle (src/lib/nuit-avant.ts, testée) : le jour J, une ligne « sort d'une
-- nuit » si un quart marqué `quart.nuit` était activé la veille (jour_quart),
-- que la ligne n'y était pas fermée (ouverture_quart) et qu'au moins un de ses
-- postes tourne sur ce quart (poste_quart). La nuit compte sur le jour où elle
-- commence. Priorité inchangée : horaire spécifique du jour > temps partiel
-- (qui garde son horaire) > horaire du poste (avec ou sans nuit avant).
--
-- `quart.nuit` (0076) devient aussi réglable dans « Rotation des équipes &
-- horaires des quarts ».

alter table public.horaire_poste
  add column if not exists debut_apres_nuit text,
  add column if not exists fin_apres_nuit text;
