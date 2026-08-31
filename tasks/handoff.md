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
  **409** si on pose la personne sur un autre quart le même jour ; le board la libère
  d'abord (delete puis upsert).
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
- **Bouton PDF** : A4 paysage, mise à l'échelle **mesurée** (cf. `lessons.md` L16).

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

Priorité d'affichage de l'horaire (TV) : **exception ponctuelle > temps partiel > standard**.

## Planning (`/planning`)
- Filtres, dans l'ordre : **Quart / Atelier / Équipe**. Choisir un quart auto-sélectionne
  l'équipe de la rotation de la semaine (`rotationForWeek()` depuis `rotation_reference`,
  sinon `equipe.quart_fixe`) ; le filtre Équipe force une autre équipe. Aucune équipe
  associée → équipe vide (toutes les personnes).
- Panneau d'affectation (`.cellpick`) : ateliers en colonnes côte à côte, **sans
  ascenseur** ; les ateliers longs (ex. CONDI) sont répartis sur jusqu'à 3 colonnes.
- Options de case construites **à l'ouverture seulement** (`onMouseDown`/`onFocus`) :
  sinon ~110k `<option>` dans le DOM.
- Colonne des noms : largeur `nb car. × 8 px + 46` (160–480 px), **pas de troncature**.
- Pendule 🕐 (horaire spécifique, `horaire_exception`) : sur une case affectée, sur le
  motif **Formation**, et tant qu'une exception subsiste. Champ libre = **commentaire**
  (colonne `motif` réutilisée) affiché sur la TV. L'infobulle propose l'horaire par
  défaut (`horaire_poste`).
- Flèche `»` de recopie : lundi→jeudi = fin de semaine en cours ; à partir du vendredi =
  jours affichés de la semaine suivante.

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

## Navigation (`AppHeader`)
- **Menu principal** (`MAIN_ORDER`, pastille + icône) : Référentiel (vert) → Personnel
  (bleu) → Matrice (violet) → Ordonnancement (orange) → Planning (teal) → Bilans (rose).
- Logo « Polaris » (+ pastille `site.nom` en multi-site) → `/` (accueil).
- **Engrenage** (`SettingsMenu`) : Équipes, Compétences, Param. Habilitation, Motifs,
  Horaires, Affichage, Journal, RGPD, Rotation des équipes, Droits.
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
