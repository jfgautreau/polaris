-- 0079 : visite médicale — professionnel vu, et professionnel attendu la fois suivante.
--
-- Le suivi en santé au travail se partage entre le médecin du travail et
-- l'infirmier(ère) en santé au travail (VIP déléguée, R4624-10 / R4623-31).
-- Les RH veulent savoir qui la personne a vu, et qui elle doit voir à la
-- prochaine visite (le médecin peut demander à la revoir lui-même).
--
--   professionnel           qui a reçu la personne (ou qui est prévu, pour un
--                           rendez-vous pas encore réalisé)
--   prochain_professionnel  qui elle doit voir à la prochaine visite
--
-- Bornés par CHECK comme `avis` : c'est une information d'organisation, pas
-- une donnée de santé, et elle doit le rester.

alter table public.visite
  add column if not exists professionnel text
    check (professionnel is null or professionnel in ('medecin','infirmier')),
  add column if not exists prochain_professionnel text
    check (prochain_professionnel is null or prochain_professionnel in ('medecin','infirmier'));
