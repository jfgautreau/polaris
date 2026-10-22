-- =====================================================================
-- 0091 — Droits de l'API rendus explicites (changement Supabase du 2026-10-30)
--
-- À partir du 30 octobre 2026, Supabase n'accorde plus d'office l'accès à
-- l'API (supabase-js / PostgREST) aux tables créées dans « public ». Sans
-- GRANT, toute lecture d'une nouvelle table répond « permission denied ».
--
-- Ce que fait cette migration (idempotente, rejouable sans effet de bord) :
--   1. Réaffirme les droits des tables et séquences EXISTANTES pour les deux
--      rôles dont l'application se sert : `authenticated` (écrans sous RLS) et
--      `service_role` (écritures complètes côté serveur). Aujourd'hui sans
--      effet en production (elles les ont déjà) ; indispensable si la base est
--      un jour reconstruite à partir des migrations sur un projet neuf.
--   2. Rétablit, par des privilèges PAR DÉFAUT, l'ancien comportement pour les
--      tables et séquences que le rôle qui exécute les migrations (postgres,
--      SQL Editor) créera à l'avenir : elles naîtront ouvertes à ces deux
--      rôles, comme avant. Le test `migrations-sql` exige malgré tout un GRANT
--      explicite dans chaque migration qui crée une table (ceinture et bretelles).
--
-- Ce que cette migration NE fait PAS :
--   - Elle n'ouvre rien à `anon` : aucune table n'est lue sans session (l'Affichage
--     TV public lit en service_role). Les droits existants d'`anon` restent tels quels.
--   - Elle ne touche pas aux fonctions (0086 en a volontairement fermé trois).
--   - La RLS reste le filtre : un GRANT ouvre la table à l'API, la policy décide
--     des lignes.
--
-- Vérifié avant écriture : aucune migration ne retire de droit sur une table
-- (seuls des REVOKE sur fonctions, 0086) et aucune vue n'existe dans « public ».
-- À exécuter dans le SQL Editor, AVANT le 30/10/2026 de préférence.
-- =====================================================================

-- 1. Tables et séquences existantes.
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- 2. Futures tables et séquences créées par postgres (rôle du SQL Editor).
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to authenticated, service_role;

-- Contrôle (facultatif) : les privilèges par défaut posés.
--   select defaclrole::regrole, defaclobjtype, defaclacl
--   from pg_default_acl where defaclnamespace = 'public'::regnamespace;
