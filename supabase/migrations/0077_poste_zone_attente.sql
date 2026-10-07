-- 0077 : poste.zone_attente — poste servant de ZONE D'ATTENTE (pré-affectation).
--
-- Certains postes ne sont pas de vrais postes de travail : le pré-remplissage y
-- range les opérateurs d'un service (ex. « CDT » au Bignon, atelier Condi), puis
-- les chefs d'équipe les RÉPARTISSENT sur les vrais postes. Effectif 0, jusqu'à
-- une vingtaine de personnes par jour.
--
-- Le drapeau change la vue « Par poste » du Planning (tasks/planning-par-poste.md) :
--   - le poste s'affiche replié en tête de son service, « N à répartir » par jour ;
--   - ses occupants sont proposés EN TÊTE des candidats d'une place vide ;
--   - en sortir pour un vrai poste ne demande pas de confirmation.
-- Aucun effet ailleurs (Placement, Bilans, TV).
--
-- Défaut false = comportement inchangé. Réglé au Référentiel (colonne « Attente »).

alter table poste
  add column if not exists zone_attente boolean not null default false;
