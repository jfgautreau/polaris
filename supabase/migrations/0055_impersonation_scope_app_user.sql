-- =====================================================================
-- Migration 0055 - app_user / audit_log strictement scopés au site courant
--
-- OBJECTIF (demandé 2026-08-23)
-- L'écran Utilisateurs (et le Journal) doit TOUJOURS montrer le site
-- courant, y compris pour le super_admin :
--   - super_admin connecté normalement sur Le Bignon  -> comptes Le Bignon
--   - super_admin « Entre dans le site » LVC (impersonation) -> comptes LVC
--
-- CONSTAT (bug vécu)
-- Les policies RLS de `app_user` et `audit_log` portaient un passe-droit
-- `OR is_super_admin()` : le super_admin voyait TOUS les comptes de TOUS
-- les sites, même en impersonation. `current_site_id()` renvoie pourtant
-- déjà le bon site (le site cible en impersonation, cf. 0048) — c'est le
-- `OR is_super_admin()` qui court-circuitait le filtre.
--
-- CORRECTIF
-- On retire purement le passe-droit : les deux policies se scopent sur
-- `current_site_id()`. Le pouvoir cross-site du super_admin passe
-- exclusivement par le back-office `/platform`, qui accède en service_role
-- (bypass RLS) — donc AUCUNE perte de capacité de gestion.
--
-- EFFET
--   - Hors impersonation : chaque compte (super_admin inclus) ne voit que
--     les app_user / audit_log de SON site.
--   - En impersonation : current_site_id() = site cible -> le super_admin
--     ne voit que ce site. Il peut toujours y AGIR comme admin local, car
--     is_admin() reste vrai sur sa propre ligne (admin d'un site actif).
--   - /platform (liste tous les sites, compteurs) : inchangé, service_role.
--
-- NOTE : les référentiels (competence, quart, role_permission, motifs…)
-- sont déjà scopés sans passe-droit depuis 0053. app_user et audit_log
-- étaient les deux dernières policies d'écran applicatif à fuir.
--
-- À exécuter dans le SQL Editor APRÈS 0054.
-- =====================================================================

-- app_user : chaque site voit / gère STRICTEMENT ses comptes.
drop policy if exists app_user_select on public.app_user;
create policy app_user_select on public.app_user for select to authenticated
  using (site_id = public.current_site_id());

drop policy if exists app_user_modify on public.app_user;
create policy app_user_modify on public.app_user for all to authenticated
  using (site_id = public.current_site_id() and public.is_admin())
  with check (site_id = public.current_site_id() and public.is_admin());

-- audit_log (écran Journal) : lecture selon can_read_audit(), scopée au
-- site courant, sans passe-droit super_admin.
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated
  using (
    public.can_read_audit()
    and site_id = public.current_site_id()
  );
