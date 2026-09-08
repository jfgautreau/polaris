-- =====================================================================
-- Migration 0066 — Import des absences depuis le logiciel RH (GT)
--
-- CONTEXTE
-- L'entreprise exporte chaque semaine, depuis son logiciel de gestion des
-- temps (GT), un CSV d'absences groupé par section puis par matricule
-- (« Matricule : 100709 DOLIN PAMELA »), une ligne par jour :
--   Date;Motif;Libellé;Valorisation;Jours;Nombre;Heures;H début;H fin
--   31/08/26;00CLFA;Congé payé annuel;Jours;1; ;07:00; ;
-- On veut déposer ce fichier dans « Paramètres RH » et matérialiser les
-- absences sur chaque personne (un placement par jour, comme le planning).
--
-- DEUX BESOINS DE SCHÉMA
-- 1) motif_absence.code_gt : le code du logiciel RH (« 00CLFA ») rattaché à
--    chaque motif Polaris, réglé dans l'écran Motifs d'absence. À l'import,
--    un code GT inconnu crée automatiquement un motif portant ce code.
-- 2) import_absence_personne : les MATRICULES du fichier RH ne correspondent
--    PAS à ceux de Polaris. L'appariement se fait donc par NOM, avec
--    résolution manuelle des cas douteux à l'import. Cette table MÉMORISE
--    l'équivalence « matricule RH → personne » (ou « ignorer ») pour ne plus
--    reposer la question aux imports suivants.
--
-- Site-scopées toutes les deux (référentiels séparés par site, cf. 0053).
--
-- À exécuter dans le SQL Editor APRÈS 0065. Idempotente.
-- =====================================================================

-- 1) Code GT sur les motifs -------------------------------------------------
alter table public.motif_absence
  add column if not exists code_gt text;

-- Un même code GT ne peut désigner qu'un seul motif PAR SITE (index partiel :
-- les motifs sans code GT ne se gênent pas entre eux).
create unique index if not exists motif_absence_code_gt_site_uidx
  on public.motif_absence (site_id, code_gt)
  where code_gt is not null;

-- 2) Équivalences apprises « matricule RH -> personne » ---------------------
create table if not exists public.import_absence_personne (
  site_id       uuid not null references public.site(id) on delete cascade,
  matricule_rh  text not null,
  personne_id   uuid references public.personne(id) on delete cascade,
  ignorer       boolean not null default false,
  nom_fichier   text,                       -- dernier nom vu dans le fichier (aide au diagnostic)
  updated_at    timestamptz not null default now(),
  primary key (site_id, matricule_rh)
);

alter table public.import_absence_personne enable row level security;

-- RLS : chaque site voit et écrit ses seules équivalences. L'application
-- passe par le service_role (getAdminClient) qui bypass la RLS mais borne
-- explicitement site_id ; ces policies restent le filet pour un accès
-- éventuel en session (getServerClient).
drop policy if exists import_abs_pers_sel on public.import_absence_personne;
create policy import_abs_pers_sel on public.import_absence_personne
  for select using (site_id = public.current_site_id());

drop policy if exists import_abs_pers_ins on public.import_absence_personne;
create policy import_abs_pers_ins on public.import_absence_personne
  for insert with check (site_id = public.current_site_id());

drop policy if exists import_abs_pers_upd on public.import_absence_personne;
create policy import_abs_pers_upd on public.import_absence_personne
  for update using (site_id = public.current_site_id())
  with check (site_id = public.current_site_id());

drop policy if exists import_abs_pers_del on public.import_absence_personne;
create policy import_abs_pers_del on public.import_absence_personne
  for delete using (site_id = public.current_site_id());
