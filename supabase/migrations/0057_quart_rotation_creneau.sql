-- =====================================================================
-- Migration 0057 — Quarts : participation à la rotation + créneau explicite
--
-- Deux notions étaient implicites/codées en dur :
--   * QUELS quarts composent le cycle de rotation : jusqu'ici déduit de ce
--     qu'on mettait dans la référence. On le rend explicite → colonne
--     `rotation`. Le formulaire « Référence de rotation » n'offre plus que
--     les quarts cochés.
--   * À QUELLE demi-journée correspond un quart pour le temps partiel :
--     `planning/page.tsx` et `TempsPartielModal.tsx` testaient
--     `code === 'matin' ? 'matin' : code === 'apres_midi' ? 'aprem' : null`
--     en dur. On le rend explicite → colonne `creneau` (matin/aprem/null).
--
-- Seed : sur TOUS les sites, on coche `rotation` et on pose `creneau` pour
-- les quarts dont le code est `matin` / `apres_midi`, de sorte que le
-- comportement soit STRICTEMENT identique après la migration. Les autres
-- quarts (journee, nuit, quarts custom) restent hors rotation, sans créneau.
--
-- À exécuter dans le SQL Editor.
-- =====================================================================

alter table public.quart
  add column if not exists rotation boolean not null default false;

alter table public.quart
  add column if not exists creneau text;

-- Créneau borné : demi-journée matin/après-midi, ou aucun (quart plein).
-- `aprem` (et non `apres_midi`) : même vocabulaire que tp_config.off, qui
-- stocke ses demi-journées sous les clés `matin` / `aprem`.
do $$ begin
  alter table public.quart
    add constraint quart_creneau_check
    check (creneau is null or creneau in ('matin', 'aprem'));
exception when duplicate_object then null; end $$;

-- Seed préservant le comportement actuel (tous sites confondus).
update public.quart set rotation = true, creneau = 'matin' where code = 'matin';
update public.quart set rotation = true, creneau = 'aprem' where code = 'apres_midi';
