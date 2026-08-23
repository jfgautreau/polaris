-- =====================================================================
-- Migration 0055 - L'impersonation borne le super_admin au site cible
--
-- CONSTAT (bug vécu 2026-08-23)
-- Un super_admin qui « Entre dans le site » LVC via /platform voyait
-- quand même TOUS les comptes de TOUS les sites sur l'écran Utilisateurs
-- (et le Journal). Cause : les policies RLS de `app_user` (et
-- `audit_log`) portent un passe-droit `OR is_super_admin()` :
--
--     using ( site_id = current_site_id() OR is_super_admin() )
--
-- Pendant l'impersonation, `current_site_id()` renvoie bien le site cible
-- (LVC, cf. 0048) — mais `OR is_super_admin()` court-circuite ce filtre :
-- le super_admin reste super_admin, donc voit tout. L'impersonation n'est
-- alors PAS étanche : elle affiche les données d'un autre site.
--
-- MODÈLE VOULU
-- « Entrer dans un site » = agir COMME un admin local, borné à ce site.
-- Le pouvoir cross-site du super_admin ne doit s'exercer que HORS
-- impersonation (et /platform, qui passe de toute façon en service_role
-- et bypass la RLS).
--
-- CORRECTIF
--   1. `is_impersonating()` : vrai quand un header x-impersonate-site
--      valide est présent ET honoré (appelant super_admin) — exactement
--      la condition sous laquelle current_site_id() renvoie le site cible.
--   2. Les policies `app_user` et `audit_log` remplacent
--      `OR is_super_admin()` par `OR (is_super_admin() AND NOT
--      is_impersonating())`.
--
-- EFFET
--   - Super_admin impersonant LVC : is_impersonating() = true → le
--     passe-droit tombe → filtre `site_id = current_site_id()` (= LVC).
--     Il ne voit et ne modifie QUE les comptes/journaux de LVC. Il peut
--     tout de même agir en local car `is_admin()` reste vrai sur sa
--     propre ligne (admin d'un site actif).
--   - Super_admin HORS impersonation : is_impersonating() = false →
--     comportement inchangé (accès cross-site conservé).
--
-- NON TRAITÉ ICI (volontaire)
--   - `audit_impersonation` : journal de gouvernance de la plateforme,
--     propriété du super_admin ; sa visibilité globale est assumée.
--
-- À exécuter dans le SQL Editor APRÈS 0054.
-- =====================================================================

-- 1) Détecte une session d'impersonation effective.
create or replace function public.is_impersonating()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_txt  text;
  v_uuid uuid;
begin
  begin
    v_txt := current_setting('request.headers', true)::json->>'x-impersonate-site';
  exception when others then
    v_txt := null;
  end;

  if v_txt is null or v_txt = '' then
    return false;
  end if;

  begin
    v_uuid := v_txt::uuid;
  exception when others then
    return false;
  end;

  -- Honoré uniquement si l'appelant est réellement super_admin — même
  -- garde que current_site_id() (0048). Un header forcé sur une session
  -- normale ne « déclenche » pas l'impersonation.
  return exists (
    select 1 from public.app_user
    where user_id = auth.uid() and est_super_admin = true and is_active = true
  );
end;
$$;

-- 2) app_user : chaque site voit/gère SES comptes ; le super_admin garde
--    l'accès cross-site SAUF quand il impersonne (il est alors borné au
--    site cible).
drop policy if exists app_user_select on public.app_user;
create policy app_user_select on public.app_user for select to authenticated
  using (
    site_id = public.current_site_id()
    or (public.is_super_admin() and not public.is_impersonating())
  );

drop policy if exists app_user_modify on public.app_user;
create policy app_user_modify on public.app_user for all to authenticated
  using (
    (site_id = public.current_site_id() and public.is_admin())
    or (public.is_super_admin() and not public.is_impersonating())
  )
  with check (
    (site_id = public.current_site_id() and public.is_admin())
    or (public.is_super_admin() and not public.is_impersonating())
  );

-- 3) audit_log (écran Journal) : même correction — pas de fuite du journal
--    d'un autre site pendant l'impersonation.
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated
  using (
    public.can_read_audit()
    and (
      site_id = public.current_site_id()
      or (public.is_super_admin() and not public.is_impersonating())
    )
  );
