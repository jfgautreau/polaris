-- 0099 : couleur du texte d'un motif d'absence.
--
-- `motif_absence.couleur` est le fond de la case (Planning, Absences…). Un motif
-- réglé sur un fond noir s'écrivait noir sur noir. Le texte est désormais choisi
-- automatiquement (noir ou blanc, selon le fond) ; cette colonne permet aux RH
-- d'imposer une autre couleur de texte, motif par motif, dans Param. RH.
--
-- NULL = automatique (défaut : rien ne change pour les motifs existants, sinon
-- que le texte devient lisible sur les fonds sombres).
--
-- Colonne ajoutée à une table existante : droits et RLS de motif_absence inchangés.

alter table public.motif_absence
  add column if not exists couleur_texte text;

alter table public.motif_absence
  drop constraint if exists motif_absence_couleur_texte_format;
alter table public.motif_absence
  add constraint motif_absence_couleur_texte_format
  check (couleur_texte is null or couleur_texte ~* '^#[0-9a-f]{6}$');
