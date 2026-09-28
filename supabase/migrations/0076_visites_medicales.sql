-- =====================================================================
-- Migration 0076 — Module « Visites médicales » (droit RH)
--
-- OBJET
-- Suivre les DATES et les TYPES de visites de médecine du travail, jamais un
-- motif médical. Le régime de suivi de chaque personne n'est pas saisi : il est
-- DÉDUIT de ce que Polaris sait déjà (quart de nuit, poste tenu, habilitation
-- détenue, absence longue), à partir de règles que les RH règlent elles-mêmes
-- dans « Param. Visites ». Aucune donnée de santé n'entre dans la base : seuls
-- le type de visite, sa date et le TYPE d'avis rendu (attestation, apte, apte
-- avec aménagements, inapte) sont stockés.
--
-- MODÈLE
--   visite_regime          plafonds de périodicité par régime (simple / adapté
--                          / renforcé). Valeurs par défaut = maxima du Code du
--                          travail ; les RH peuvent RACCOURCIR (protocole du
--                          service de santé au travail), jamais allonger sans
--                          que l'écran ne le signale.
--   visite_type            catalogue des visites (libellé libre, catégorie qui
--                          fixe le comportement).
--   visite_anci_usage      usages d'ANCI — attestation de non contre-indication
--                          (conduite, électricité…). Une habilitation ou un
--                          poste peut EXIGER un usage ; la visite le DÉLIVRE.
--   visite                 une visite planifiée puis réalisée, par personne.
--   visite_anci            usages délivrés par cette visite (0..n).
--   personne_suivi         réglages par personne SANS motif : suivi adapté,
--                          régime forcé.
--   contrainte_affectation contrainte opérationnelle SANS motif (« pas de
--                          quart Nuit jusqu'au … »), posée par les RH à la
--                          suite d'un avis. C'est la seule chose que le
--                          Placement voit — et encore, sans la raison.
--   visite_parametre       réglages simples du module (seuils, alertes),
--                          clé / valeur, défauts portés par le code.
--
-- DRAPEAUX AJOUTÉS AUX RÉFÉRENTIELS EXISTANTS (tous réglables par les RH
-- depuis l'écran du module, sans le droit « Référentiel ») :
--   quart.nuit                    ce quart est un poste de nuit  → suivi adapté
--   poste.suivi_renforce          poste à risques particuliers   → suivi renforcé
--   poste.suivi_motif             motif réglementaire (R4624-23), pour mémoire
--   poste.anci_usage              usage d'ANCI exigé par le poste
--   competence.suivi_renforce     habilitation à risque           → suivi renforcé
--   competence.anci_usage         usage d'ANCI exigé par l'habilitation
--   motif_absence.visite_reprise  ce motif compte pour la visite de reprise
--
-- SITE-SCOPÉ : toutes les tables portent `site_id NOT NULL`, aucune ligne
-- partagée (cf. 0053). Les policies utilisent la forme InitPlan
-- `(select public.current_site_id())` (cf. 0075).
--
-- À exécuter dans le SQL Editor APRÈS 0075.
-- =====================================================================


-- ---------------------------------------------------------------------
-- A. Régimes de suivi et leurs plafonds
-- ---------------------------------------------------------------------
create table if not exists public.visite_regime (
  code                text not null,
  site_id             uuid not null references public.site (id) on delete cascade,
  libelle             text not null,
  mois_renouvellement int  not null,
  mois_intermediaire  int,                      -- null = pas de visite intermédiaire
  ordre               int  not null default 0,
  primary key (code, site_id)
);
create index if not exists visite_regime_site_idx on public.visite_regime (site_id);

-- Seed sur TOUS les sites existants : maxima légaux.
--   simple   60 mois (R4624-16) · adapté 36 mois (R4624-17)
--   renforcé 48 mois + intermédiaire 24 mois (R4624-28)
insert into public.visite_regime (code, site_id, libelle, mois_renouvellement, mois_intermediaire, ordre)
select v.code, s.id, v.libelle, v.mois, v.inter, v.ordre
  from public.site s
 cross join (values
   ('simple',   'Simple',   60, null::int, 1),
   ('adapte',   'Adapté',   36, null::int, 2),
   ('renforce', 'Renforcé', 48, 24,        3)
 ) as v(code, libelle, mois, inter, ordre)
on conflict (code, site_id) do nothing;


-- ---------------------------------------------------------------------
-- B. Usages d'ANCI (attestation de non contre-indication)
--
-- Une visite « simple » ne se vaut pas : certaines délivrent une attestation de
-- non contre-indication exigée par une habilitation (conduite d'engin,
-- habilitation électrique). L'usage est ce qui relie les deux : l'habilitation
-- (ou le poste) l'EXIGE, la visite le DÉLIVRE. Validité = jusqu'à la prochaine
-- visite périodique due de la personne.
-- ---------------------------------------------------------------------
create table if not exists public.visite_anci_usage (
  id       uuid primary key default gen_random_uuid(),
  site_id  uuid not null references public.site (id) on delete cascade,
  code     text not null,
  libelle  text not null,
  actif    boolean not null default true,
  ordre    int not null default 0,
  unique (code, site_id)
);
create index if not exists visite_anci_usage_site_idx on public.visite_anci_usage (site_id);

insert into public.visite_anci_usage (site_id, code, libelle, ordre)
select s.id, v.code, v.libelle, v.ordre
  from public.site s
 cross join (values
   ('conduite',   'Conduite d''engin', 1),
   ('electrique', 'Habilitation électrique', 2)
 ) as v(code, libelle, ordre)
on conflict (code, site_id) do nothing;


-- ---------------------------------------------------------------------
-- C. Catalogue des types de visite
--
-- `categorie` fixe le COMPORTEMENT, le libellé reste libre :
--   initiale      première visite (embauche / avant affectation)
--   periodique    renouvellement, arme le compteur du régime
--   intermediaire visite intermédiaire du suivi renforcé
--   reprise       visite de reprise après absence
--   ponctuelle    pré-reprise, à la demande, fin de carrière — sans échéance
-- ---------------------------------------------------------------------
create table if not exists public.visite_type (
  id        uuid primary key default gen_random_uuid(),
  site_id   uuid not null references public.site (id) on delete cascade,
  code      text not null,
  libelle   text not null,
  categorie text not null check (categorie in ('initiale','periodique','intermediaire','reprise','ponctuelle')),
  actif     boolean not null default true,
  ordre     int not null default 0,
  unique (code, site_id)
);
create index if not exists visite_type_site_idx on public.visite_type (site_id);

insert into public.visite_type (site_id, code, libelle, categorie, ordre)
select s.id, v.code, v.libelle, v.cat, v.ordre
  from public.site s
 cross join (values
   ('vip_embauche',   'VIP d''embauche',                    'initiale',      1),
   ('vip_periodique', 'VIP périodique',                     'periodique',    2),
   ('aptitude',       'Examen médical d''aptitude (SIR)',   'periodique',    3),
   ('intermediaire',  'Visite intermédiaire (SIR)',         'intermediaire', 4),
   ('reprise',        'Visite de reprise',                  'reprise',       5),
   ('pre_reprise',    'Visite de pré-reprise',              'ponctuelle',    6),
   ('demande',        'Visite à la demande',                'ponctuelle',    7),
   ('fin_carriere',   'Fin de carrière / post-exposition',  'ponctuelle',    8)
 ) as v(code, libelle, cat, ordre)
on conflict (code, site_id) do nothing;


-- ---------------------------------------------------------------------
-- D. Visites (planifiées puis réalisées)
--
-- `avis` : TYPE d'avis rendu, pas son contenu. Volontairement borné par un
-- CHECK — laisser du texte libre ouvrirait la porte à une donnée de santé.
-- `commentaire` : logistique seulement (« convoqué, absent au rendez-vous »).
-- ---------------------------------------------------------------------
create table if not exists public.visite (
  id             uuid primary key default gen_random_uuid(),
  site_id        uuid not null references public.site (id) on delete cascade,
  personne_id    uuid not null references public.personne (id) on delete cascade,
  type_id        uuid not null references public.visite_type (id) on delete restrict,
  date_rdv       date,           -- rendez-vous pris, visite pas encore réalisée
  date_visite    date,           -- visite réalisée
  avis           text check (avis is null or avis in ('attestation','apte','apte_amenagement','inapte')),
  prochaine_date date,           -- date fixée par le professionnel, si plus proche que le plafond
  commentaire    text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists visite_site_idx     on public.visite (site_id);
create index if not exists visite_personne_idx on public.visite (personne_id, date_visite);

create table if not exists public.visite_anci (
  visite_id  uuid not null references public.visite (id) on delete cascade,
  usage_code text not null,
  site_id    uuid not null references public.site (id) on delete cascade,
  primary key (visite_id, usage_code)
);
create index if not exists visite_anci_site_idx on public.visite_anci (site_id);


-- ---------------------------------------------------------------------
-- E. Réglages par personne — SANS motif
--
-- `suivi_adapte` : la personne relève d'un suivi adapté (travailleur handicapé,
-- pension d'invalidité, situation particulière). On coche, on n'explique pas :
-- le motif est une donnée de santé, il reste chez le médecin du travail.
-- ---------------------------------------------------------------------
create table if not exists public.personne_suivi (
  personne_id  uuid primary key references public.personne (id) on delete cascade,
  site_id      uuid not null references public.site (id) on delete cascade,
  suivi_adapte boolean not null default false,
  regime_force text check (regime_force is null or regime_force in ('simple','adapte','renforce')),
  updated_at   timestamptz not null default now()
);
create index if not exists personne_suivi_site_idx on public.personne_suivi (site_id);


-- ---------------------------------------------------------------------
-- F. Contraintes d'affectation — SANS motif
--
-- Une contrainte vise un QUART ou un POSTE (au moins l'un des deux). C'est la
-- seule information du module qui sorte des RH, et elle ne dit jamais pourquoi.
-- ---------------------------------------------------------------------
create table if not exists public.contrainte_affectation (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid not null references public.site (id) on delete cascade,
  personne_id uuid not null references public.personne (id) on delete cascade,
  quart_code  text,
  poste_id    uuid references public.poste (id) on delete cascade,
  date_debut  date not null,
  date_fin    date,                    -- null = sans fin prévue
  created_by  uuid,
  created_at  timestamptz not null default now(),
  constraint contrainte_affectation_cible_check check (quart_code is not null or poste_id is not null),
  constraint contrainte_affectation_dates_check check (date_fin is null or date_fin >= date_debut)
);
create index if not exists contrainte_affectation_personne_idx on public.contrainte_affectation (personne_id, date_debut);
create index if not exists contrainte_affectation_site_idx     on public.contrainte_affectation (site_id);


-- ---------------------------------------------------------------------
-- G. Réglages simples du module (clé / valeur)
--
-- Les DÉFAUTS sont portés par le code (src/lib/visites.ts) : une clé absente
-- n'est pas une valeur nulle, c'est « valeur par défaut ». Rien n'est seedé ici.
-- ---------------------------------------------------------------------
create table if not exists public.visite_parametre (
  site_id uuid not null references public.site (id) on delete cascade,
  cle     text not null,
  valeur  text not null,
  primary key (site_id, cle)
);


-- ---------------------------------------------------------------------
-- H. Drapeaux posés sur les référentiels existants
-- ---------------------------------------------------------------------
alter table public.quart
  add column if not exists nuit boolean not null default false;

alter table public.poste
  add column if not exists suivi_renforce boolean not null default false,
  add column if not exists suivi_motif    text,
  add column if not exists anci_usage     text;

alter table public.competence
  add column if not exists suivi_renforce boolean not null default false,
  add column if not exists anci_usage     text;

alter table public.motif_absence
  add column if not exists visite_reprise boolean not null default false;

-- Reprise raisonnable, à relire par les RH dans l'écran :
--   * un quart dont l'horaire de début tombe entre 21 h et 5 h est proposé
--     comme quart de nuit (L3122-2 : au moins 3 h entre 21 h et 6 h) ;
--   * une habilitation qui suit une autorisation de conduite exige l'ANCI
--     « conduite » et relève du suivi renforcé (R4323-56) ;
--   * les motifs d'arrêt maladie / AT / MP / maternité comptent pour la
--     visite de reprise (R4624-31).
update public.quart
   set nuit = true
 where nuit = false
   and debut is not null
   and (debut >= time '21:00' or debut < time '05:00');

update public.competence
   set suivi_renforce = true, anci_usage = 'conduite'
 where a_autorisation_conduite = true
   and anci_usage is null;

update public.motif_absence
   set visite_reprise = true
 where visite_reprise = false
   and (upper(code_court) in ('AM','AT','MP','MAT')
        or libelle ilike '%maladie%'
        or libelle ilike '%accident%'
        or libelle ilike '%maternit%');


-- ---------------------------------------------------------------------
-- I. RLS
--
-- Lecture : bornée au site courant, pour tout utilisateur authentifié. Le
-- MODULE (matrice de droits, clé `visites`) décide de l'accès à l'écran ;
-- la RLS n'est que le filet d'isolation entre sites. L'écriture passe par les
-- routes API, gardées par `moduleWriteGuard` en service_role — la policy
-- d'écriture reste réservée à l'admin, comme les autres tables de paramétrage.
--
-- Forme InitPlan `(select public.current_site_id())` (cf. 0075) : la fonction
-- est évaluée une fois par requête, pas une fois par ligne.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'visite_regime','visite_anci_usage','visite_type','visite','visite_anci',
    'personne_suivi','contrainte_affectation','visite_parametre'
  ] loop
    execute format('alter table public.%I enable row level security;', t);

    execute format('drop policy if exists %I on public.%I;', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (site_id = (select public.current_site_id()));',
      t || '_select', t);

    execute format('drop policy if exists %I on public.%I;', t || '_modify', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select public.is_admin()) and site_id = (select public.current_site_id())) with check ((select public.is_admin()) and site_id = (select public.current_site_id()));',
      t || '_modify', t);
  end loop;
end $$;

-- Horodatage
do $$
declare t text;
begin
  foreach t in array array['visite','personne_suivi'] loop
    execute format('drop trigger if exists set_updated_at_%1$s on public.%1$s;', t);
    execute format('create trigger set_updated_at_%1$s before update on public.%1$s
                    for each row execute function public.set_updated_at();', t);
  end loop;
end $$;
