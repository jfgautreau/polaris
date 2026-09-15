-- 0072 : drapeau « piloté par agence » sur type_contrat.
--
-- Généralise la notion d'intérim. Jusqu'ici « intérim » = le code type_contrat
-- littéral « INTERIM », testé en dur dans plusieurs écrans (champ Agence activé,
-- surbrillance jaune, rapport Synthèses hebdomadaires). Un « CDI Intérim » (CDI
-- intérimaire) ne rentrait donc dans aucun de ces circuits.
--
-- Désormais tout type de contrat coché « avec_agence » (intérim classique, CDI
-- intérimaire, ou tout futur type) :
--   - active le champ Agence dans la fiche Personnel / le Cycle de vie ;
--   - remonte dans le rapport Synthèses hebdomadaires (vue Intérim par agence) ;
--   - est surligné en jaune comme l'intérim.
-- Le drapeau se coche par site dans Param RH → Types de contrat.
--
-- type_contrat est site-scopée depuis 0053 (PK composite (code, site_id)) :
-- la reprise ci-dessous vaut pour tous les sites.

alter table type_contrat
  add column if not exists avec_agence boolean not null default false;

-- Reprise : le code intérim historique est piloté par agence par défaut.
update type_contrat set avec_agence = true where upper(code) = 'INTERIM';
