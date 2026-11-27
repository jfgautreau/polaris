-- 0098 : motif d'absence masqué ou non sur l'Affichage (plannings TV / A3).
--
-- L'Affichage (écran TV d'un service et ses feuilles imprimées) écrivait
-- « Absence » pour tout le monde, sans jamais dire le motif. Une personne en
-- formation y passait donc pour absente. Les RH choisissent désormais, motif par
-- motif dans Param. RH (colonne « Motif masqué »), ceux dont le libellé peut
-- s'afficher : décoché = le libellé du motif est écrit (« Formation ») ; coché =
-- « Absence », sans motif.
--
-- Défaut : coché pour tous les motifs — rien ne change à l'écran tant que les RH
-- n'ont pas décoché un motif (la confidentialité reste la règle).
--
-- Colonne ajoutée à une table existante : droits et RLS de motif_absence inchangés.

alter table public.motif_absence
  add column if not exists masque_affichage boolean not null default true;
