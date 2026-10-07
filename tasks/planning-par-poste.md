# Cahier des charges — Planning « Par poste »

> Validé le 2026-10-07. Maquette interactive (données fictives) :
> https://claude.ai/artifact/THUVHFdcaGbC4viHqK9UUb
> Rien n'est développé à cette date.

## 1. Besoin

Le Planning montre aujourd'hui **une ligne par personne** sur 3 semaines. On veut la
lecture inverse : **une ligne par poste**, les 3 mêmes semaines en colonnes, les personnes
affectées dans les cases, **et pouvoir y saisir**. Usages visés :

- voir qui tient un poste dans la durée, et quand le titulaire est remplacé ;
- repérer les places vides à 3 semaines ;
- **répartir les opérateurs pré-affectés** (zone d'attente « CDT » du Bignon, remplie par
  le pré-remplissage) sur les vrais postes — travail des chefs d'équipe.

## 2. Emplacement

- **Pas de nouveau menu** : une bascule **Par nom / Par poste** (`SlideSwitch`) dans le
  bandeau du Planning, portée par l'URL (`?vue=poste`). Même droit (`planning`), même page
  serveur, mêmes données.
- Filtres conservés : **semaine**, **quart** (un seul à la fois), **service**. Le filtre
  **Équipe** et la bascule « Suivre l'équipe » ne s'appliquent pas à cette vue (masqués).
- La recherche devient **« Repérer »** : elle **surligne** les barres d'une personne
  (les autres s'estompent), sans masquer de poste.

## 3. Grille

- Ordre des postes = celui du Planning : service → ligne (`ordre_affichage`) → poste.
  Postes visibles = ceux qui **tournent sur le quart** (`tourneSurQuart`), ouverts à la date
  (`actifLe`), comme le Planning.
- **Une rangée par place** : un poste d'effectif N sur le quart (`effectifSurQuart`)
  occupe N rangées de `--grid-row-h` (32 px). Colonne figée à gauche : nom du poste,
  catégorie, effectif, habilitations exigées, titulaire(s).
- **Barres** : une personne qui tient la même rangée plusieurs jours consécutifs forme
  une seule barre, coupée à chaque changement de semaine.
  - titulaire du poste (`personne.poste_fixe_id`) en **gras** ;
  - intérim / avec agence en **jaune** (`styleInterim`) ;
  - habilitation manquante : liseré orange + « hab. » (recalculée à l'affichage, comme
    le Planning) ;
  - surnombre (au-delà de l'effectif) : rangée supplémentaire en pointillés.
- **Place requise vide** : « à pourvoir » en rouge. Si le titulaire est indisponible ce
  jour-là : « à pourvoir · tit. abs. » — **jamais le motif** de l'absence.
- **Stabilité des rangées** (pour que les barres se forment) : poste numéroté → la rangée
  correspond au numéro de rotation (`placement.numero_rotation`, ordre de `parseNumeros`) ;
  sinon la personne garde la rangée de la veille ; sinon première rangée libre.
- Jour sans quart actif (`jour_quart`) : colonne grisée. Ligne fermée par l'ordo
  (`ouverture_quart.ouverte = false`) : hachures « fermée ordo », besoin 0.
- **Placés hors plan** (poste désactivé, fermé, hors cycle) : affichés comme au Placement
  (bandeau de décompte + bloc en fin de grille), jamais perdus de vue.
- **Pied de grille**, par jour : **Couverture** (placés / besoin, vert ou rouge),
  **À répartir** (effectif des zones d'attente), **Non placés** (disponibles sans
  placement ce jour-là sur ce quart).

## 4. Zone d'attente (migration à écrire)

- Nouvelle colonne `poste.zone_attente boolean not null default false` — migration
  **0077** (à faire exécuter dans le SQL Editor). Code tolérant à son absence (repli
  `false`, codes 42703 / PGRST204), comme `imprimable`.
- Référentiel : colonne **« Attente »** (Oui/Non), même édition que « Impr. ».
- Vue par poste : le poste en zone d'attente s'affiche **replié en tête de son service**,
  une case par jour « N à répartir » ; un clic déplie une rangée par personne.
- Sortir quelqu'un d'une zone d'attente pour le placer **ne demande pas de confirmation** :
  c'est le but de la répartition.
- Aucun effet ailleurs (Placement, Bilans, TV inchangés) dans cette version.

## 5. Saisie

Droits identiques au Planning : écriture complète si `planning: write` hors chef ;
**chef d'équipe** = seules les personnes de ses équipes sont sélectionnables (les autres
apparaissent grisées « hors de vos équipes »).

### 5.1 Clic sur une place vide → panneau des candidats
Panneau flottant déplaçable (`ModaleDeplacable`), titre « poste · jour · quart · place n ».
Champ de filtre. Candidats = **tout l'effectif actif du site**, en groupes, dans cet ordre :

| Groupe | Sélection |
|---|---|
| À répartir · zone d'attente | directe |
| Disponibles · compétents (niveau matrice ≥ `niveau_min_requis`) | directe |
| Disponibles · niveau insuffisant | directe |
| Sans l'habilitation exigée | confirmation (forçage tracé, 428) |
| Déjà placés sur **ce quart** ailleurs | confirmation « retirer de X pour placer ici », le trou s'affiche |
| Non proposés : absent (code motif), temps partiel, hors effectif, déjà sur un **autre quart**, déjà sur ce poste, hors périmètre | grisés, non sélectionnables |

Les alertes visite médicale (428 `alertesRh`) passent par la même confirmation qu'au
Planning.

### 5.2 Durée
Le jour cliqué. Au survol d'une barre, une flèche **`»`** prolonge la personne **jusqu'au
vendredi** de la semaine, jour par jour. Elle **ne force jamais** : un jour impossible
(absence, TP, place prise, déjà ailleurs, habilitation, ligne fermée) est sauté, et un
compte rendu liste les jours non placés. Sortie de zone d'attente permise.

### 5.3 Clic sur une personne placée → menu
**Remplacer par…** (ouvre le panneau ; la personne remplacée devient non placée) ·
**Retirer ce jour** · **Retirer jusqu'à vendredi** · **Voir au Planning** (vue Par nom,
`search` = son nom, même semaine et quart). En zone d'attente : sans « Remplacer ».

### 5.4 Surnombre
Rangée **« + ajouter »** sous chaque poste (visible au survol) : ouvre le panneau pour
placer au-delà de l'effectif.

## 6. Règles techniques

- **Piège central** : `placement` est unique sur `(personne_id, jour)` ; `/api/placement/cell`
  fait un *upsert* qui **remplace** ce que la personne avait ce jour-là (poste, absence, NT,
  TP). Depuis la vue par poste, ce remplacement est hors champ :
  - **déplacement** d'un poste à l'autre (même quart) : voulu, confirmé côté client, une
    seule requête ;
  - **absence / NT / TP** : ne doit **jamais** être écrasée. Ajouter à `/cell` un drapeau
    `proteger: true` envoyé par cette vue : si la ligne existante porte une absence, un NT
    ou un TP, refus **422** (« X est absente ce jour-là »). Protection serveur, car les
    données affichées peuvent être périmées. Ne pas utiliser 409 (réservé à « autre quart »).
- Écritures **uniquement via `/api/placement/cell`** (cycle 422, inactivité 422, autre
  quart 409, habilitation / visites 428, numéro de rotation) — aucune règle dupliquée.
  - Placement : `numero` = numéro de la rangée si le poste est numéroté, sinon absent.
  - Remplacer : placer le nouveau **puis** retirer l'ancien (`value: ""`).
  - `»` et « Retirer jusqu'à vendredi » : appels successifs jour par jour, compte rendu.
  - Après écriture : rechargement des données (`router.refresh()`), comme le Planning.
- **Données** : celles déjà chargées par `planning/page.tsx` pour tout l'effectif
  (`initial`, `otherByCell`, `tpBlocked`, `horsEffectif`, `matrice`, `habPoste`,
  `habPers`, `chefEquipes`). À ajouter : `placement.numero_rotation`,
  `poste.numero_rotation`, `poste.zone_attente`, titulaires (`poste_fixe_id`). Le pivot
  personne → poste se fait **côté client**, la page serveur ne double pas ses lectures.
- **Composant** : `PlanningParPoste.tsx` (client), rangée extraite et `memo`, en
  `"use memo"` (règles React Compiler du CLAUDE.md). Virtualiser (`usePersonGrid` ou
  équivalent) si le nombre de rangées dépasse ~300 (Le Bignon : 99 postes).
- Couleurs, icônes, `InfoBulle`, popovers en `position: fixed` : conventions existantes.
- Tests : pivot et attribution des rangées (fonction pure, `src/lib/planning-par-poste.ts`),
  classement des candidats, `proteger` dans `/cell` ; tests de garde existants inchangés.

## 7. Hors périmètre V1 (à garder)

- **Impression A3 paysage** de la vue par poste.
- **Glisser-déposer** d'une barre vers une autre place.
- Plusieurs quarts affichés à la fois.

## 8. Critères d'acceptation

1. La bascule Par nom / Par poste conserve semaine, quart et service.
2. Chaque poste du quart a autant de rangées que son effectif ; trous en rouge ; couverture
   du pied juste.
3. Une personne absente, en TP, hors effectif ou sur un autre quart n'est jamais
   sélectionnable ; une absence n'est jamais écrasée, même avec des données périmées.
4. Déplacer une personne déjà placée demande confirmation, sauf depuis une zone d'attente.
5. `»` place jusqu'au vendredi sans rien forcer et liste les jours sautés.
6. Un chef d'équipe ne peut placer que les personnes de ses équipes.
7. Le poste CDT coché « Attente » au Référentiel s'affiche replié « N à répartir ».
