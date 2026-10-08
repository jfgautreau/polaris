# Détail par écran — Polaris

> **Ne pas lire d'office.** Les règles de travail, la stack, les permissions et les
> pièges tiennent dans **`CLAUDE.md`** (chargé automatiquement). Ce fichier est la
> couche de détail : à consulter quand on touche précisément un des écrans ci-dessous.
> Historique des sessions et des migrations : `git log` et `ARCHITECTURE.md`.

## Placement (`/placement`)
Saisie « un jour / un quart » par glisser-déposer. **Module de droits à part entière**
(`MODULES`, entrée normale de `MAIN_ORDER`) ; sa page exige `write`, donc l'entrée de
menu suit l'écriture, pas la lecture.
- **Écrit dans `placement`** via `/api/placement/cell` — même route que le Planning →
  lien automatique avec Planning, Bilans et TV. Aucune table dédiée.
- Plan **schématique auto-généré** (postes de l'atelier groupés par ligne) = zones de
  dépôt avec `présents/requis`. La **V2** prévue est un vrai plan géographique (image
  d'atelier + position x/y des postes) → migration + écran de calibrage à venir.
- Liste de droite : personnel actif **pré-filtré sur l'équipe qui tourne ce quart ce
  jour** (`defaultEquipeId`), regroupé *à placer → absents → sur poste → autre quart*.
- **Aide à la compétence** au glissement : postes compatibles en vert, restrictions
  (`matrice` = -1) en rouge, niveaux insuffisants grisés.
- `/api/placement/copy` : copie les affectations d'un jour vers un autre, même quart,
  en deux modes — `ecraser` (défaut) ou `completer` (ne touche à aucune personne déjà
  saisie ce jour-là). Mode appliqué côté serveur.
- ⚠️ `placement` est unique par **(personne, jour)** : `/api/placement/cell` renvoie
  **409** si on pose la personne sur un autre quart le même jour. Si l'état client
  connaît l'autre affectation (`autreQuart`), le board la libère d'avance (delete puis
  upsert). Sinon (état périmé après copie / navigation), le 409 remonte tagué
  (`autreQuart`) et le board ouvre la modale **« Placer quand même (retirer de l'autre
  quart) »** (`askAutreQuart` → `confirmerAutreQuart`) au lieu d'un échec muet — P1c,
  2026-09-15, cf. CLAUDE.md § Placement.
- Board **keyé** sur `atelier|jour|quart` : il remonte à chaque changement de filtre,
  réinitialisant l'état local depuis les props serveur (cf. `lessons.md` L26).
- **Lignes fermées** : le plan applique `jour_quart` / `ouverture_quart` comme le
  Planning (asymétrie des défauts dans CLAUDE.md). Semaine non initialisée → plan vide
  + message renvoyant vers l'Ordonnancement.
- **Cases numérotées** : `poste.numero_rotation` développé par `parseNumeros()` ; au-delà
  des numéros saisis (et postes non numérotés) → zone « sans numéro ».
- **Alertes couleur** : sureffectif → tuile orange ; niveau sous le minimum du poste →
  pastille rouge ; habilitation manquante/périmée → rouge **encadré** (distinct du niveau).
- **Vue Absences** : `SlideSwitch` Plan / Absences (`?vue=absences`), une carte par motif,
  filtrée par l'atelier affiché.
- **Avertissement « À vérifier avec les RH »** (module Visites médicales) : `/cell` et
  `/move` peuvent répondre **428** avec `alertesRh` (messages génériques, jamais de
  motif), dans le même 428 que les habilitations manquantes. Le board ouvre la modale
  `askRh` → « Placer quand même » renvoie `forcer: true`. Au Planning, la modale de
  forçage existante affiche les deux (`Refus = { manquantes, alertes }`). Les quatre cas
  sont **désactivés par défaut** (`Param. Visites → Alertes`) : sans cas actif, la route
  ne lit que les réglages.
- **Navigation par jour** (`JourNav.tsx`, remplace le `<input type="date">` natif) : les
  flèches **◀ / ▶ sautent** au jour **ouvert** précédent / suivant (≥ 1 ligne de l'atelier
  ouverte sur le quart courant ; repli ±1 j si aucun connu). Le **calendrier déroulant
  grise** (désactive) les jours sans ligne ouverte — le natif ne sait pas désactiver des
  jours arbitraires. `openDays` calculé **serveur** (`page.tsx`) sur une fenêtre
  **[-90 ; +150] jours** autour du jour affiché, bornée **quart + atelier** (mêmes règles
  que `ligneOuverte` : `jour_quart.actif` + `ouverture_quart`, défaut ouvert), à laquelle
  la navigation du calendrier est bornée. **Aujourd'hui** est marqué en vert (même style que
  le `DateRangePicker` des absences : `STYLE_AUJOURDHUI`, `src/lib/calendrier.ts`).
- **Deux boutons PDF**, mise à l'échelle **mesurée** (cf. `lessons.md` L16, L42) :
  - **PDF Manager** (`mode="ce"`, **A4 paysage**) = plan + colonne de droite « **Absents / TP du
    jour** » (motifs d'absence **et** bloc « **Temps partiel** » — personnes indisponibles ce
    jour au sens TP, non déjà placées ni absentes ; TP calculé **serveur** `page.tsx`/`tpIds`,
    mêmes règles que Planning / TV).
  - **PDF** (`mode="simple"`, **A3 paysage**, plan seul) — A3 via `print-a3` posé sur `<body>`
    (page nommée `plcA3`, globals.css). Feuille **opérateurs, sans couleur** : couverture,
    surnombre et compétence manquante imprimés en noir (`.printSheet[data-mode="simple"]`).
  - Sur les deux : **numéros de rotation imprimés même vides** (« n° · libre ») et
    **commentaire du jour** (`horaire_exception.motif`) à côté du nom. Le plan imprimé exclut
    les postes `imprimable = false` (`groupsImpr`).
  - **En-tête** (2026-10-07) : grille 3 colonnes `1fr auto 1fr` — service à gauche, quart
    en **pastille noire** au **centre** de la page, date en toutes lettres à droite (jour de
    la semaine en gras, `jourLong`). Pas d'équipe. Noir et gris seulement (identique sur
    les deux PDF ; un cran plus grand en A3). L'en-tête est **hors de `printInner`** : il
    n'est jamais réduit par `ajusterFeuille()`, qui retranche sa hauteur (`printHeadRef`)
    de la cible `PAGE_H` / `PAGE_H_A3`.
- **Écran** : les rangs d'un poste (numéros + occupants) se répartissent en **2-3 colonnes**
  (10 lignes max par colonne, variable CSS `--cols`) — chaque occupant est une rangée.
- **Colonne « À répartir »** (2026-10-07) : les postes `zone_attente` (0077, ex. CDT) sortent
  du plan (`groupsPlan`) et s'affichent entre le plan et les noms (`postesAttente`, 220 px,
  violet) ; mêmes `chip` / `overProps` / `clickTarget` qu'une tuile. Ligne mixte : seuls les
  postes en attente partent. Les PDF partent de `groups` (seule « Impr. » décide) ; leurs
  occupants sont « placés », donc hors du compteur « à placer ».

## Personnel — Cycle de vie (`CycleDeVieModal`)
- Arrivée, départ prévu et statut sont **dérivés des contrats** (`contrat_periode`) ; le
  statut bascule par `rafraichir_statuts_personnes()` (cf. L48).
- **Affectations hors contrat** (2026-10-08) : le pré-remplissage et les saisies refusent
  déjà un jour qu'aucun contrat ne couvre, mais une fin de contrat saisie ou avancée
  **après** coup laissait les affectations déjà posées (cf. L49). La modale affiche un
  bandeau rouge « N affectations hors contrat déjà posées : jj/mm (poste)… » et un bouton
  **Retirer…** avec confirmation en deux temps. `/api/personnel` ops `hors-contrat-list` /
  `hors-contrat-retirer` : lignes à venir (jour ≥ aujourd'hui) poste / NT / TP dont le jour
  n'est couvert par aucun contrat (`motifInactivite`) ; absences conservées. Le retrait exige
  `canWritePlacementData` ; sans lui, le bandeau dit « À retirer au Planning ».

## Temps partiel (`personne.tp_config`, jsonb, options cumulables)
Modale `TempsPartielModal`, API `/api/personnel` op `tp`. Périodes datées dans
`tp_periode` (migration 0052) avec repli sur `personne.tp_config`.
- `demi` : `{ mode: matin|aprem|tournant, source: quart|horaires, matin?/aprem?: {dow:{debut,fin}} }`.
- `off` : `{ dow: ["matin","aprem"] }` demi-journées non travaillées.
- `horaires` : `{ dow: {debut,fin} }` horaires journée entière.

⚠️ **Calcul de `tpBlocked`** (`src/app/planning/page.tsx`, côté serveur). « TP » s'écrit
dans le planning quand l'une des deux conditions est vraie :
1. **Journée entière off** — les deux demi-journées `matin` et `aprem` dans `off`.
2. **Équipe sur le créneau non travaillé cette semaine** — si l'équipe tourne et se
   retrouve, la semaine considérée, sur le créneau que la personne ne fait pas. Ex.
   Sylvie mi-temps après-midi (off matin) en équipe B tournante : la semaine où B est au
   matin → TP tous les jours ; la semaine où B est l'après-midi → rien. D'où un **TP
   automatique une semaine sur deux**, via `rotByWeek[wi]` + `equipe.quart_fixe`.

⚠️ **Ne pas confondre `tpBlocked` (TP, fond violet) et `horsEffectif`** (hors effectif,
fond gris) — deux canaux distincts de bout en bout (cf. `lessons.md` L28). L'ancienne
flèche `tpRedirect` a été supprimée.

⚠️ **TP MATÉRIALISÉ** (migration 0064). Le calcul `tpBlocked` ci-dessus reste l'**aperçu**
des semaines **non chargées**. Le bouton « TP + postes fixes » du Planning pose de **vraies
lignes `placement.tp`** (jeton `"TP"`, déplaçables au glisser-déposer) et un marqueur
`tp_charge(site_id, semaine_lundi)` : sur une semaine chargée, le calcul virtuel s'éteint et
seules les lignes réelles font foi (sinon un TP déplacé serait recréé). Le virtuel s'éteint
AUSSI dès qu'une vraie ligne de placement existe pour la case. La **TV** suit les lignes
réelles sur les semaines chargées (jour de TP éventuellement déplacé), repli calculé sinon.

Priorité d'affichage de l'horaire (TV) : **exception ponctuelle > temps partiel > standard**.

## Planning (`/planning`)
- Filtres, dans l'ordre : **Quart / Atelier / Équipe**. Choisir un quart auto-sélectionne
  l'équipe de la rotation de la semaine (`rotationForWeek()` depuis `rotation_reference`,
  sinon `equipe.quart_fixe`) ; le filtre Équipe force une autre équipe. Aucune équipe
  associée → équipe vide (toutes les personnes).
- Panneau d'affectation (`.cellpick`) : ateliers en colonnes côte à côte, **sans
  ascenseur** ; les ateliers longs (ex. CONDI) sont répartis sur jusqu'à 3 colonnes.
  ⚠️ **S'ouvre TOUJOURS sur les postes compétents** (matrice, niveau ≥ min hors
  restriction) : l'état de la bascule « Voir tous » n'est **plus mémorisé** (ni
  localStorage, ni entre deux ouvertures — `setShowAllPostes(false)` à chaque clic de
  case). ⚠️ « **Voir tous** » affiche **TOUTE l'usine** (tous ateliers), pas seulement
  l'atelier filtré : le filtre atelier ne cadre que la grille et les indicateurs, pas les
  postes plaçables (prêt inter-atelier). Le panneau lit `allGroups` + `openAllByIso`
  (indépendants du filtre), la compétence étant calculée depuis l'objet poste.
- **Chargement « ⛁ TP + postes fixes »** (`FillIcon`, pot de peinture) dans l'**entête de
  CHAQUE semaine** (modèle « Initialiser » d'Ordonnancement), → `/api/placement/prefill`,
  **semaine cliquée uniquement**, écriture complète (`canPrefill`). Deux passes, dans cet
  ordre : (1) **matérialise les TP** de la semaine (vraies lignes `placement.tp`, cf.
  migration 0064, + marqueur `tp_charge` qui éteint le calcul virtuel), (2) **pré-remplit les
  postes fixes** (`personne.poste_fixe_id`). ⚠️ **Affectation AUTOMATIQUE : ne demande pas,
  ne force pas** — une personne **non habilitée** pour son poste fixe **n'est pas placée**
  (contrôle groupé). N'écrase jamais une case remplie (`ignoreDuplicates`). Recharge la vue
  au succès (l'état local ignore `router.refresh()`).
- **Glisser-déposer des affectations** (DnD natif) : on **DÉPLACE** une case remplie (poste,
  NT, ou **TP réel**), **jamais une absence**, vers une case **vide**, entre jours et
  personnes. Déplacement seul, dépôt refusé sur case occupée/bloquée. Route
  `/api/placement/move` (contrôle d'habilitation sur la personne d'arrivée → modale de
  forçage `askMove`, recalcul du numéro de rotation libre). Un TP réel devient déplaçable ;
  le déplacer ne le fait pas revenir (le marqueur `tp_charge` a éteint le recalcul).
- **Bandeau de filtres** — 3 colonnes (nav Année/Mois/Semaine · Quart/Atelier/Équipe ·
  boutons 🕐/🤒) alignées par une **hauteur de rangée commune** :
  `.planning-top .filterrow { min-height }` (cf. `lessons.md`, piège du `margin-top`
  global sur les `<button>`).
- Options de case construites **à l'ouverture seulement** (`onMouseDown`/`onFocus`) :
  sinon ~110k `<option>` dans le DOM.
- Colonne des noms : largeur `nb car. × 8 px + 46` (160–480 px), **pas de troncature**.
- Pendule 🕐 (horaire spécifique, `horaire_exception`) : sur une case affectée, sur le
  motif **Formation**, et tant qu'une exception subsiste. Champ libre = **commentaire**
  (colonne `motif` réutilisée) affiché sur la TV. L'infobulle propose l'horaire par
  défaut (`horaire_poste`).
- Flèche `»` de recopie : lundi→jeudi = fin de semaine en cours ; à partir du vendredi =
  jours affichés de la semaine suivante.
- Info-bulles de l'horaire spécifique : une borne non saisie est complétée par l'horaire
  standard du poste (`excLabel(e, std)`), même règle que `src/lib/horaires.ts`.
- **Vue « Par poste »** (`?par=poste`, 2026-10-07) — spec `tasks/planning-par-poste.md`.
  Bascule `VueBascule` (SlideSwitch) à **gauche de la recherche** dans les deux vues (prop
  `gauche`) ; `par` propagé par `QuartSelector`, `AtelierFilter` et l'`extra` des
  navigations. Même page serveur : `page.tsx` prépare `parPoste` (postes du quart avec
  `numeros`, `attente`, titulaires ; `equipesQuart` par semaine ; `numeroParCase` ;
  placés hors plan) et rend `PlanningParPoste.tsx` au lieu de `PlanningGrid`. Filtres
  Équipe / Conducteurs et « Suivre l'équipe » masqués. Rangées : `attribuerRangees`
  (n° de rotation > continuité sur place requise > 1re place libre > surnombre) ;
  candidats : `classerCandidat` (`src/lib/planning-par-poste.ts`, testé). Écritures via
  `/cell` avec `proteger: true` (422 sur absence / NT / TP ; retrait borné à
  `poste_attendu`) ; `numero` toujours envoyé (`null` en surnombre). Postes
  `zone_attente` repliés « N à répartir » en tête de service. React Compiler actif
  (`"use memo"`) — aucun `d++` dans une fonction imbriquée (cf. `lessons.md` L47).

## Ordonnancement (`/ordonnancement`)
- **Fenêtre 15 jours** (2 semaines + le lundi suivant), à partir du lundi de la semaine
  choisie. Nav `OrdoQuinzaineNav` (`?debut=<lundiISO>`, flèches par 14 j, bouton
  Aujourd'hui). ⚠️ `weekDays()` **ne pose pas `firstOfWeek`** : la page le remet sur chaque
  lundi (sinon même n° de semaine sur toute la fenêtre — `lessons.md` L39).
- **Grille unique**, en-tête figé par la **méthode du Planning** (deux cartes alignées par un
  `colgroup` partagé + `table-layout: fixed` : en-tête `flex:0`, corps `flex:1` défilant).
  Sous chaque date, 3 sous-colonnes **matin / après-midi / nuit**. **1ʳᵉ ligne « Activation »**
  = bascule `jour_quart` des quarts tournants. Puis **lignes groupées par atelier** (ordre du
  Référentiel : atelier → `ordre_affichage` → nom). Case grise « · » = la ligne ne tourne pas
  sur ce quart ; case verrouillée = quart inactif ce jour.
- **Journée** (pleine journée) **à part, en dessous** ; colonnes alignées (colgroup partagé,
  `colSpan` par jour). ⚠️ **Activation dérivée** : le quart *journée* (détecté sans code en
  dur = quart **sans `creneau` au plus petit `ordre`**) n'a plus de bascule. Son
  `jour_quart.actif` est **maintenu en base = OU(quarts tournants du jour)** par
  `/api/ordonnancement/quart` (à chaque bascule) **et** `/reset-week` (à l'initialisation) →
  Planning / Placement / TV cohérents, sans dérivation dupliquée en lecture.
- **Semaine type** (`/ordonnancement/semaine-type`) : **même trame** sur **7 jours** (Lun→Dim,
  dimanche en rouge), ligne « Activation » (tournants), lignes par atelier, **journée
  dérivée** à part. Gabarit appliqué par « Initialiser ». Gestion des profils inchangée.

## Matrice de polyvalence (`/matrice`)
- Bilan **plié par défaut** (« + Bilan / − Bilan »), alimenté en **une seule passe**
  `useMemo` sur personnes × postes (pas de balayage par cellule).
- Bascule **Actuel / Cible** = `SlideSwitch` à droite du bandeau (bleu = actuel, vert =
  cible). Recherche centrée, légende à droite.
- En-têtes de poste verticaux, **sur une seule ligne** ; ils répètent le nom de la ligne
  (« Conducteur Thermo 1 » sous « Thermo 1 »). Retirer ce suffixe a été **écarté** par
  l'utilisateur (la règle naïve ne couvre que 38 des 82 postes).
- Saisie : clic = +1, clic droit = −1, cycle `0→1→…→N→❌ (restriction)→0`, où **N =
  `site.nb_niveaux`** (2..4, réglé dans `/admin/competences`). ⚠️ Non découvrable,
  impossible au tactile (pas de clic droit) — un popover de choix reste à faire si la
  saisie passe un jour sur tablette.
- **Échelle paramétrable par site** (`/admin/competences`) : nombre de niveaux activés
  (N), seuil « compétent » de la ligne de bilan et des rapports, et **couleur de chaque
  niveau positif** (palette fermée de 4 teintes). La grille lit ces réglages ; le niveau
  0 (blanc) et la restriction sont toujours là. Le camembert est mis à l'échelle sur N
  (le plus haut niveau = disque plein) ; à N=4 le rendu est identique à l'historique.
- La grille vient du module partagé `persongrid` (cf. CLAUDE.md), pas de code local.
- **Postes « en attente » hors matrice** (2026-10-08) : un poste `zone_attente` (0077, ex.
  CDT, Conducteur, Périphériques de « A placer » au Bignon) n'a pas de colonne ; une ligne
  qui n'a que de tels postes disparaît. Ils ne comptent pas non plus pour la pastille « sans
  compétence » ni pour le filtre Conducteurs (`poste.zone_attente = false` sur la jointure),
  ni dans `/matrice/bilan`, les postes fragiles du Cockpit, Polyvalence & compétences et
  Assez de compétences ?. La Feuille de route les garde (besoin et titulaires). Décocher
  « Attente » au Référentiel les fait revenir (rien n'est supprimé).

## Habilitations (`/habilitations`)
- **Même grille que la matrice** (`persongrid.module.css`, `usePersonGrid`). Deux pages
  distinctes car les droits diffèrent : `chef_equipe` écrit dans la matrice, pas ici.
- Vue **Grille** (pastilles) ou **Liste** : `SlideSwitch` en ligne 2 de l'en-tête.
- Pastille 28 px. « Non habilité » = **cercle vide** (comme le niveau 0 de la matrice).
- Accent des en-têtes **neutre** (gris) : pas de mode Actuel/Cible ici, et l'ambre se
  confondrait avec l'orange « bientôt dépassée ».
- En-têtes de formation **non rognés** (bande d'en-tête jusqu'à 243 px).
- Recherche **multi-critères** : matche des personnes → filtre les lignes ; matche des
  formations → filtre les colonnes.
- Saisie **au clic sur une pastille** (`HabMajModal`, pré-remplie) → POST `/api/habilitations`.
- Compteurs globaux dans la cellule d'angle. Marqueur « autorisation de conduite » =
  volant blanc sur pastille bleue (`AutorisationMark`).
- Formation sans durée de validité → échéance « **-** ». Statut : rouge < 30 j · orange
  30–90 j · vert > 90 j. ⚠️ `date_expiration` est **stockée à la saisie** — repli
  `addMonthsIso(date_obtention, duree)` à l'affichage (cf. `lessons.md` L6).
- Paramétrage : `/admin/habilitations-param`.

## Visites médicales (`/visites`, `/admin/visites-param`)
Module RH (droits `visites` et `visites_param`, rôle `rh` seul par défaut). **Deux écrans,
pas de troisième** : la fiche d'une personne est une modale du Suivi.
- **Calcul** : tout est dans `src/lib/visites.ts` (pur, testé) — `regimeDe`,
  `echeancePeriodique`, `echeanceIntermediaire`, `echeanceReprise`, `anciManquants`,
  `evaluerPersonne`. `src/lib/visites-data.ts` lit la base en deux vagues parallèles et
  nourrit le calcul ; rien n'est stocké du résultat.
- **Régime** : le plus exigeant l'emporte entre poste à risque tenu / habilitation à
  risque détenue (`renforce`), quart de nuit ou « suivi adapté » coché (`adapte`). Toutes
  les raisons restent affichées. Un « régime imposé » court-circuite le calcul.
- **Travail de nuit** : équipe à quart fixe → ce quart ; équipe tournante → de nuit dès
  qu'un quart **tournant** est coché `nuit`. La colonne « heures de nuit » du paramétrage
  (`heuresDeNuit`, plage 21 h – 6 h) n'est qu'une **indication** : la coche fait foi.
- **Poste tenu** : titulaire (`poste_fixe_id`) **ou** au moins N placements sur les M
  dernières semaines (réglages, défaut 3 / 12).
- **Échéances** : dernière visite initiale/périodique + plafond du régime, ou
  `prochaine_date` si plus proche ; sans visite → arrivée + 3 mois (simple) ou arrivée
  (avant affectation, adapté/renforcé). **Entrée récente en suivi renforcé**
  (`renforceDepuis` = obtention la plus ancienne d'une habilitation à risque) : si la
  dernière visite est antérieure, l'examen d'aptitude est dû à cette date (R4624-24).
- **ANCI** : usage exigé par un poste ou une habilitation, délivré par une visite, valable
  jusqu'au plafond du régime compté depuis cette visite.
- **Reprise** : périodes reconstruites depuis les jours d'absence (`grouperAbsences`, 18
  mois), durée en jours **calendaires** sur les motifs cochés, échéance = fin + 8 j.
- **Statut** : reprise > retard > RDV pris > à planifier (fenêtre d'alerte) > à jour ;
  un RDV à venir apaise un retard (affiché « RDV pris »).
- **Exclus** : statut `PARTI`, types de contrat avec agence (intérim).
- Écritures : `/api/visites` (visite, suivi, contraintes) et `/api/visites-param`
  (régimes, types, usages, drapeaux des référentiels, réglages). Une visite se
  réécrit avec sa liste d'ANCI (effacer puis poser `visite_anci`).

## Affichage TV (`/affichage`)
- Index : liste des services avec **cases à cocher** (« Tous les services », date de
  référence facultative) → « Imprimer N services » ouvre `/affichage/impression?atelier=…`
  (paramètre répété, impression lancée au chargement). Mêmes règles d'impression que
  l'écran TV (2026-10-08) : A3 portrait, tableau à la **largeur de la feuille**, contenu qui
  coule sur plusieurs pages (rangées entières, en-tête des jours répété), chaque service
  sur une **nouvelle page** (`break-after: page`). Plus de mise à l'échelle mesurée :
  l'ancienne échelle commune, imposée par le service le plus dense, rétrécissait toutes
  les pages (cf. L50).
  Les ids reçus ne font que **filtrer** la liste des services du site. Chaque service garde
  son lien **« Écran TV »** (`/affichage/atelier/[id]`, un service, rafraîchi 5 min).

## Navigation (`AppHeader`)
- **Menu principal** (`MAIN_ORDER`, pastille + icône) : Référentiel → Personnel →
  Absences → Matrice → Habilitations → Visites méd. (cyan) → Ordonnancement → Planning →
  Placement → Bilans. Une entrée n'apparaît que si le module est lisible (Placement :
  inscriptible) et non masqué pour le site.
- Logo « Polaris » (+ pastille `site.nom` en multi-site) → `/` (accueil).
- **Engrenage** (`SettingsMenu`) : tout module de `MODULES` hors `MAIN_ORDER` — Équipes,
  Compétences, Param. Habilitation, Param. RH, Param. Visites, Horaires, Utilisateurs,
  RGPD…
- 🔔 cloche = habilitations à recycler (compteur ≤ 90 j).

## Bilans CODIR (`/bilans`)
`/bilans` = **Cockpit** (KPIs + cartes). Catégories : `/bilans/personnel`,
`/bilans/polyvalence`, `/bilans/couverture`, `/bilans/anticipation`. Composant `Bars`
partagé, styles `.kpi / .report-* / .navcard / .barrow` + `@media print` (PDF).
`OrdoMonthNav` (navigation mensuelle), `ReportAtelierFilter` (filtre atelier).

## Plateforme multi-site (`/platform`)
Réservé aux `app_user.est_super_admin`. Layout dédié (fond gris, header noir, sans
AppHeader), défense en profondeur (middleware + revalidation dans le layout). Doc
complète : `tasks/multi-site.md`.
- `/platform` — liste des sites (nom, slug, statut, KPI). Bouton « Nouveau site ».
- `/platform/nouveau` — form (nom, slug, email + nom du 1er admin, **site source** à
  dupliquer). Server action `createSite` : crée `site`, l'auth user, force
  role=admin/site_id/is_active, copie les référentiels, génère le lien mot de passe.
  Rollback si `createUser` échoue.
- `/platform/[id]` — détail : KPI, Suspendre/Réactiver/Archiver, « Entrer dans le site »
  (impersonation), 10 dernières sessions d'impersonation.
- **Impersonation** : cookie signé HMAC (`polaris-impersonate`, TTL 60 min). Le
  middleware valide et pose le header `x-impersonate-site` ; `current_site_id()` (0048)
  ne l'honore que pour un `est_super_admin`. Bandeau rouge sticky tant que le cookie est
  actif, trace complète dans `audit_impersonation`.
- ⚠️ `est_super_admin` n'est **jamais** exposé dans `/admin/users` : un admin local ne
  peut pas se l'accorder.

## Performance — acquis à préserver
~1,3 s → ~300 ms à chaud. Leviers : région **cdg1** + **Fluid Compute**, options de case
**à la demande**, `prefetch={false}` sur les liens de liste, cache des données de
référence (`lib/refdata.ts`, `unstable_cache` 30 s, segmenté par site), Personnel en
**une vague** de requêtes, `loading.tsx` sur les gros écrans, agrégats du bilan matrice
en une passe.

⚠️ **Plafond structurel** : `/matrice` sans filtre construit ~22 000 cellules
(268 × 82), HTML ~1,8 Mo, hydratation très lourde ; `/habilitations` du même ordre. La
**virtualisation** des grandes grilles est le prochain gros chantier (cf. `tasks/todo.md`).

Redéployer sans changement de code : `git commit --allow-empty`.

## Points ouverts / à recaler
- Sticky/offsets : `--appbar: 40px` ; rangées d'en-tête collantes via `--sub-top` /
  `--col-top` sur `.grid` (matrice 25 px ; habilitations 22 et 44 px).
- Enregistrement d'une cellule de matrice : état **optimiste**, indicateur « Enregistré »
  en haut du panneau (hors champ quand on édite en bas). Rollback en cas d'échec à faire.
- Alerte « > 18 mois » : du début du contrat le plus ancien jusqu'à la fin (ou
  aujourd'hui), hors CDI.
- Backfill SQL des `personne_competence.date_expiration` nulles (compensé à l'affichage).
- ⚠️ **Aucun écran n'est vérifiable visuellement par l'agent** (pages derrière login) :
  validation par `npm run build` + tests. Les retours visuels viennent de l'utilisateur.
