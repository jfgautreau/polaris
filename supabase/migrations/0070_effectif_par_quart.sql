-- =====================================================================
-- Migration 0070 — effectif par quart (fin du doublon de poste)
--
-- Aujourd'hui un poste porte UN seul `poste.effectif_requis`, valable sur
-- tous les quarts, et `poste_quart` ne sert qu'à DÉSACTIVER un poste sur un
-- quart (défaut actif → la table ne stocke que les `actif = false`).
--
-- Désormais l'effectif est porté PAR QUART sur `poste_quart`, avec TROIS
-- états lus par `src/lib/poste-quart.ts` :
--   • aucune ligne            → repli sur poste.effectif_requis (historique) ;
--   • ligne actif = false     → « – » : le poste ne tourne pas sur ce quart ;
--   • ligne actif = true      → tourne, effectif = poste_quart.effectif_requis
--                               (0 = tourne à 0, N = N personnes).
--
-- 1) Ajout de la colonne (nullable : repli poste tant qu'elle n'est pas saisie).
-- 2) REPRISE DES DONNÉES : pour chaque poste et chaque quart de son site où le
--    poste tourne aujourd'hui (= aucune ligne de désactivation), on matérialise
--    une ligne `actif = true` avec l'effectif COURANT du poste. Résultat : le
--    jour de la migration, rien ne change à l'écran ; l'ajustement matin /
--    après-midi / nuit se fait ensuite au Référentiel, quart par quart.
--
-- `poste.effectif_requis` reste en base comme repli et source de la reprise ;
-- il n'est plus la source de vérité (colonne « Effectif » retirée du Référentiel).
--
-- ⚠️ `poste_quart` est site-scopée (site_id NOT NULL, PK (poste_id, quart_code)) :
-- la reprise joint poste et quart sur le MÊME site et pose site_id explicitement.
--
-- À exécuter dans le SQL Editor APRÈS 0069.
-- =====================================================================

alter table public.poste_quart
  add column if not exists effectif_requis int check (effectif_requis >= 0);

-- Reprise : matérialise les couples (poste × quart) actuellement ACTIFS
-- (aucune ligne de désactivation) avec l'effectif courant du poste.
insert into public.poste_quart (poste_id, quart_code, actif, effectif_requis, site_id)
select p.id, q.code, true, coalesce(p.effectif_requis, 0), p.site_id
from public.poste p
join public.quart q on q.site_id = p.site_id
where not exists (
  select 1 from public.poste_quart pq
  where pq.poste_id = p.id and pq.quart_code = q.code and pq.site_id = p.site_id
)
on conflict (poste_id, quart_code) do nothing;
