-- 0073 : poste.imprimable — le poste figure-t-il sur les feuilles de placement imprimées ?
--
-- Certains postes ne servent qu'à CONSTRUIRE le planning (on y place des personnes
-- à l'écran du Placement) mais n'ont pas à apparaître sur les PDF distribués
-- (« PDF » et « PDF CE »). Ce drapeau permet de les masquer à l'impression tout en
-- les gardant pleinement utilisables dans l'écran de saisie.
--
-- Défaut true = comportement inchangé (tous les postes s'impriment).
-- Réglé au Référentiel (colonne « Impr. »).

alter table poste
  add column if not exists imprimable boolean not null default true;
