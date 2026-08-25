# Leçons

Pièges déjà payés une fois. Les relire évite de les repayer.

## L1 — Valider la stack/hébergement AVANT de coder
Le cahier des charges imposait une stack (Docker/Postgres/Prisma, serveur local),
mais l'utilisateur a finalement choisi Supabase + Vercel. Beaucoup de code a été
écrit puis jeté.
**Règle** : en cadrage, confirmer explicitement stack ET hébergement avant tout
scaffolding. Une exigence « imposée » dans un cahier peut être renégociée par le client.

## L2 — PowerShell 5.1 : pas de guillemets `"` dans un message git inline
Un `git commit -m @'...'@` contenant des guillemets doubles a cassé le passage
d'arguments (mots interprétés comme pathspecs).
**Règle** : pour les messages multi-lignes, here-string `@'…'@` avec le `'@` final en
colonne 0, ou écrire le message dans un fichier et faire `git commit -F fichier`.

## L3 — Un `<select>` contrôlé (client) ne se soumet pas dans un `<form action={serverAction}>`
L'enregistrement de la rotation des équipes échouait silencieusement : la grille était un
composant client avec des `<select>` contrôlés à l'intérieur d'un `<form>` server-action
parent ; les valeurs n'étaient pas sérialisées de façon fiable.
**Règle** : pour une grille éditable, ne pas compter sur la sérialisation du formulaire —
poster explicitement l'état en JSON vers une route API (modèle : `/api/ordonnancement/semaine-type`
+ bouton « Enregistrer » côté client). NB : la rotation des équipes, qui illustrait ce piège,
n'utilise plus ce pattern depuis le passage aux références datées (selects non contrôlés rendus
côté serveur dans un `<form action={serverAction}>` — la sérialisation native fonctionne alors).

## L4 — `<input type="color">` fait planter le navigateur
Le sélecteur de couleur natif ouvre une boîte de dialogue OS qui gelait le navigateur.
**Règle** : proposer une palette de pastilles cliquables (`TeamColorPicker`), jamais le
picker natif.

## L5 — Droit « module » ≠ périmètre : le chef d'équipe ne doit jamais recevoir le client admin
En donnant `getAdminClient()` dès que le module était en `write`, le chef d'équipe a pu
éditer hors de son équipe (régression de périmètre).
**Règle** : `canWriteModule()` renvoie `false` pour `chef_equipe`. Écriture « complète »
→ `getAdminClient()` ; sinon `getServerClient()` et on laisse la RLS (`can_edit_personne`)
faire le tri.

## L6 — `personne_competence.date_expiration` est stockée, pas calculée
Une formation passée à 24 mois de validité continuait de s'afficher « à vie » : l'échéance
avait été figée (ou laissée nulle) au moment de la saisie et changer
`competence.duree_validite_mois` ne recalcule rien.
**Règle** : à l'affichage, retomber sur `addMonthsIso(date_obtention, duree_validite_mois)`
quand `date_expiration` est nulle (`src/lib/habilitations.ts`). Se méfier plus largement des
colonnes dérivées figées à l'écriture.

## L7 — Le build échoue sur le code mort
`next build` fait échouer les imports et variables inutilisés. En supprimant une section
d'écran, penser à retirer imports, types, requêtes et props devenus orphelins.

## L8 — PostgREST tronque silencieusement à 1000 lignes
Une modification de la matrice partait bien en base mais ne se réaffichait jamais : la
lecture de `matrice` (1276 lignes) renvoyait `data` de longueur 1000 et `error` à `null`.
Le réglage `db-max-rows` de Supabase plafonne **chaque** réponse, sans le signaler. Toutes
les lectures non paginées de `matrice` et `personne_competence` étaient donc fausses —
matrice, planning, habilitations et les cinq bilans.
Le piège est latent ailleurs : `placement` ne compte que 380 lignes tant que le planning
est vide, mais un mois rempli en produit ~7 000 (231 personnes x 31 jours). `ouverture_quart`
atteint déjà 764 lignes pour un seul mois.
**Règle** : dès qu'une table *peut* dépasser 1000 lignes, passer par `fetchAll()`
(`src/lib/fetch-all.ts`), qui pagine par tranches de 1000. La fabrique de requête doit
poser un `.order(...)` déterministe, sinon deux tranches peuvent se recouvrir. Attention
à la clé de tri : `matrice`, `personne_competence` et `placement` ont un `id`, mais
`ouverture_quart` et `jour_quart` n'en ont pas — il faut y trier sur la clé composite.

## L9 — `scrollbar-gutter: stable` ampute la course sur un axe `overflow: hidden`
Le panneau d'en-têtes de la matrice suit le `scrollLeft` de la liste. Il s'arrêtait
**15 px trop tôt** en fin de course, décalant les noms de poste d'une demi-colonne.
Chrome retranche la gouttière réservée de la zone défilable quand l'axe est en
`overflow: hidden` : `scrollWidth - clientWidth` annonce 331 px, mais `scrollLeft`
plafonne à 316.
**Règle** : sur un panneau dont un axe est masqué et l'autre asservi, utiliser
`overflow-y: scroll` (une vraie piste vide réserve la même largeur) plutôt que
`overflow-y: auto` + `scrollbar-gutter: stable`.

## L10 — La hauteur de ligne d'un tableau dépend de la ligne de base
À contenu identique (une pastille de 28 px), la matrice affichait des lignes de 44 px et
les habilitations de 41 px : la case de la matrice est un `<button>` (`inline-block`, donc
aligné sur la ligne de base, ce qui ajoute la place de la descendante), celle des
habilitations un `<span>` inerte.
**Règle** : pour deux grilles jumelles, fixer explicitement `height` sur la cellule et
`vertical-align: middle` sur son contenu, plutôt que de laisser la typographie décider.
Aujourd'hui : `--row-h: 32px`, `--cell: 28px` dans `persongrid.module.css`.

## L11 — Un `<button>` à fond clair rend son texte invisible
Sur l'écran Placement, les flèches de navigation du jour et les libellés des chips
d'absence étaient **invisibles** : le style global `button` (globals.css) impose
`color: var(--primary-text)` (blanc), et ces boutons ne redéfinissaient que `background: #fff`
→ blanc sur blanc.
**Règle** : tout bouton qui change son `background` pour une teinte claire doit **aussi**
poser un `color` explicite. Symptôme typique : « le bouton est là mais vide ».

## L12 — L'audit n'attribue rien quand on écrit via le service role
Le journal affichait « Système » pour les affectations du planning et la matrice, alors que
les motifs (server action) étaient bien à l'utilisateur. Cause : `audit_trigger` lit
`auth.uid()`, **null** avec `getAdminClient()` (service role, sans session JWT) — or les
écritures « complètes » passent justement par ce client (cf. L5).
**Règle** : ne pas compter sur `auth.uid()` dans un trigger pour du code qui bypasse la RLS.
Repli retenu (migration 0031) : le trigger prend `created_by` / `auteur_app_user_id` de la
ligne. Une table sans colonne d'auteur restera non attribuée.

## L13 — Next.js 16 : `revalidateTag` prend 2 arguments, `updateTag` est fait pour les server actions
`revalidateTag(tag)` ne compile plus (`Expected 2 arguments`) : la signature est
`revalidateTag(tag, profile)`. Depuis une server action, la bonne fonction est
`updateTag(tag)` (sémantique *read-your-own-writes*).
**Règle** : pour qu'un edit se reflète immédiatement dans un cache `unstable_cache`, tagger
le cache (`tags: [...]`) et appeler `updateTag(tag)` dans l'action — `revalidatePath` seul
n'invalide pas un `unstable_cache`.
**Corollaire** : après suppression d'une route API, `.next/dev/types/validator.ts` la
référence encore et fait échouer le build → `rm -rf .next` puis rebuild.

## L14 — JSX/SWC : l'espace après `</strong>` disparaît si le texte contient `&apos;`
Symptôme : « BOY Melvin**n'est** pas habilitée » — l'espace entre le gras et le texte
suivant a disparu, alors qu'il est bien présent dans le source.
**Cause** : SWC (Next.js) supprime les espaces de tête de chaque ligne d'un nœud texte
JSX multi-ligne, y compris la première, **quand ce nœud contient une entité HTML**
(`&apos;`, `&ge;`…). Sans entité, l'espace survit — d'où le caractère intermittent.
Deux formes touchées :
- `<strong>x</strong>\n   texte` (fermeture en fin de ligne) → toujours cassé ;
- `<strong>x</strong> texte\n   suite` → cassé **seulement** si le nœud a une entité.
⚠️ **Ne pas vérifier avec esbuild** : il garde l'espace dans les deux cas et innocente à
tort le code. La seule preuve est le build : `grep -rho '.\{0,10\}mon texte' .next/server`
— on doit y voir `," ","mon texte` et non `,"mon texte`.
**Règle** : dès qu'un texte suit une balise inline fermante, poser un `{" "}` explicite et
faire commencer le texte sans espace. C'est déjà le pattern du projet (cf. `/planning`).
Piège dormant : un texte correct aujourd'hui casse le jour où l'on y ajoute une apostrophe.

## L15 — Lien de récupération : `generateLink` renvoie un `action_link` inutilisable ici
Symptôme : le lien créé depuis `/admin/users` atterrissait sur `/login#access_token=…`,
sans ouvrir de session — donc impossible de définir son mot de passe.
**Deux causes cumulées**, toutes deux dues à `properties.action_link` :
1. il passe par `/auth/v1/verify` avec un `redirect_to` qui doit figurer dans la liste
   blanche « Redirect URLs » du projet ; absent, Supabase retombe **en silence** sur la
   Site URL (le fragment `#` survit aux redirections HTTP, d'où l'URL trompeuse) ;
2. il répond en **flux implicite** : jetons dans le fragment, qu'une route serveur ne voit
   jamais. `/auth/callback` attend un `?code=` (PKCE), **structurellement impossible** ici —
   le `code_verifier` PKCE naît dans le navigateur de qui lance la demande, or c'est
   l'admin qui génère le lien.
**Règle** : utiliser `properties.hashed_token` et fabriquer sa propre URL
`{base}/reset?token_hash=…` ; la page appelle `verifyOtp({ token_hash, type: "recovery" })`
puis nettoie l'URL. Aucune liste blanche à configurer, marche en local comme en ligne.
**Corollaire** : ne pas bâtir le lien sur l'origine de la requête — un admin sur
localhost fabriquerait des liens morts pour ses collègues. Cf. `baseApplication()` dans
`src/lib/password-link.ts` (NEXT_PUBLIC_SITE_URL > VERCEL_PROJECT_PRODUCTION_URL > origine).

## L16 — Impression : `zoom` refait la mise en page, `transform: scale()` non
Pour faire tenir une vue sur **une** page, aucune règle CSS ne sait « réduire jusqu'à ce
que ça rentre » : il faut mesurer puis mettre à l'échelle.
⚠️ `zoom` **relayoute** : la hauteur ne diminue pas proportionnellement. Mesuré sur le plan
de placement — 96 postes, 1377 px de haut, zoom 0,53 → encore **802 px**, soit deux pages.
`transform: scale()` ne change que le rendu : 1377 × 0,53 = 730 exactement.
Il faut alors **borner le conteneur à la hauteur d'une page** (`height` + `overflow:hidden`),
sinon l'impression réserve la hauteur non réduite et sort une feuille blanche.
**Astuce de lisibilité** : réduire à largeur fixe gaspille la page (à 53 %, la moitié de la
largeur reste blanche). Essayer plusieurs largeurs de feuille et garder le meilleur facteur
— une feuille plus large range le contenu sur moins de rangées. Même plan : 1600 px à 66 %
au lieu de 1060 px à 53 %. Cf. `ajusterFeuille()` dans `PlacementBoard`.
**Mesurer avant d'imprimer** suppose que l'élément soit rendu : le garder hors écran
(`position: fixed; left: -20000px`) plutôt que `display: none`, qui donne `scrollHeight = 0`.

## L17 — Anti-escalade ≠ anti-rétrogradation

En interdisant qu'on accorde plus qu'on n'a, on ferme la promotion. Mais on laisse
passer la **dégradation** : un délégué peut *retirer* un droit à l'admin, ce qui n'est
pas une escalade (il ne gagne rien) mais fait autant de dégâts, ramenant tout le monde
à son niveau. Bug remonté sur la matrice des droits : `/api/droits` vérifiait bien
« n'accorde pas plus que soi » et ratait cette voie. Vérifiée par le test
`REGRESSION : un délégué ne peut pas DÉGRADER l'admin` (`permissions.test.ts`).
**Règle** : quand un contrôle porte sur *ce qu'on donne*, il faut son symétrique sur
*ce qu'on retire à quelqu'un qui vous domine*. Formulation générique dans
`droitsCouvertsPar()` : « on ne touche pas à un rôle qui détient des droits qu'on n'a
pas soi-même ».

## L18 — Séquence delete + insert applicative : à passer en fonction SQL

Deux allers-retours HTTP entre un `delete` et son `insert` (rotation de semaine,
rematérialisation d'une absence) ne sont **pas atomiques** : un échec de la seconde
requête laisse la donnée détruite, souvent en silence. Une fonction PL/pgSQL appelée
en RPC s'exécute dans la transaction de l'appelant — tout ou rien. Choisir
`SECURITY INVOKER` (le défaut) préserve la RLS et le modèle d'autorisation. Cf.
migration `0037` : `set_rotation_reference`, `creer_absence`, `maj_absence`.
**Règle** : dès qu'un écran fait « on efface tout, puis on ré-écrit », suspect. Une
fonction SQL est presque toujours la bonne réponse.

## L19 — PostgREST rejette toute la requête si une colonne est absente

Sélectionner `col_qui_nexiste_pas` échoue l'appel **entier**, pas seulement le champ.
Une page qui ajoute une colonne nouvelle avant la migration s'affiche donc **vide**,
pas simplement privée de la colonne. Découvert lors de l'ajout de `date_depart_prevu` :
un repli temporaire a été écrit puis retiré quand j'ai constaté que la colonne existait
déjà. **Règle** : quand une migration est en attente, soit on l'exécute avant le
déploiement, soit la lecture prévoit un repli — jamais « on verra ». Bien vérifier
aussi qu'aucune colonne ne dérive en dehors des migrations (`grep -rw <col>
supabase/migrations/`) : lors de cette vérification, aucune n'a été trouvée sur
`personne`/`poste`/`placement`/`equipe`/`contrat_periode` — l'écart repéré avec
`date_depart_prevu` était donc un cas isolé, mais il valait la peine d'être contrôlé.

## L20 — Composant React défini dans un composant : perte de focus à chaque touche

Le champ Commentaire de la modale Absences devenait inutilisable : chaque touche
faisait perdre le focus. Cause : `LigneEdition` était défini **à l'intérieur** du
composant parent (`function LigneEdition() { ... }` puis `<LigneEdition />`). À
chaque re-render du parent, React voit une nouvelle référence de fonction, donc
un « type de composant différent » → il démonte tout l'arbre et le remonte, et
l'`<input>` perd son focus. Bug vécu **deux fois** (modale Personnel puis éditeur
Planning).
**Règle** : ne jamais définir un composant qui porte des `<input>` à l'intérieur
d'un autre. Deux solutions : extraire au TOP-LEVEL du module (voir `RowsEdit` dans
`AbsencesModal.tsx`), **ou** inliner le JSX directement (`{LigneEdition()}` au
lieu de `<LigneEdition />`) — ce dernier reste un simple appel de fonction pour
React, pas un élément.

## L21 — Popover en `position: absolute` rogné par `overflow: auto`

Les listes déroulantes des modales Absences (motif, personne, calendrier) étaient
tronquées à 2 lignes visibles et déclenchaient un ascenseur : elles étaient en
`position: absolute` dans la cellule, or la carte de la modale est en `overflow:
auto` — le débordement est rogné, exactement comme l'InfoBulle avait connu (L9
variante). Fermeture au moindre scroll par-dessus, y compris quand on essayait
de dérouler la liste.
**Règle** : dans une carte scrollable, un popover doit être en **`position: fixed`**,
coordonnées calculées au clic depuis le rect du bouton (`getBoundingClientRect`),
gauche bornée à `[8, vw - width - 8]`. Fermeture au scroll EXTÉRIEUR uniquement :
si `popRef.current.contains(e.target)`, on ignore — sinon impossible de faire
défiler une liste longue. Cf. `openPop` / `popStyle` dans `AbsencesModal.tsx`.

## L22 — Erreurs Supabase : `e instanceof Error` renvoie false

L'API `/api/personnel` répondait « Erreur » sec sur toute écriture ratée, sans
détail. Le catch faisait `e instanceof Error ? e.message : "Erreur"`. Or les
erreurs Supabase/PostgREST ne sont **pas** des instances de `Error` : ce sont
des objets plats `{ code, message, details, hint }`. Le test échoue toujours,
et le vrai message Postgres (« violates check constraint... ») disparaît.
**Règle** : `const err = e as { message?, details?, hint?, code? }` puis
`err?.message ?? (e instanceof Error ? e.message : "Erreur")` ; joindre
`details` et `hint` pour un message complet. Répliqué dans `messageErreur()`.

## L23 — CHECK enum figé : ajouter une valeur en table ne suffit pas

Ajouter « STAGIAIRE » dans la table `type_contrat` (Param. RH) faisait échouer
l'affectation avec « Erreur » silencieux. Cause : les migrations d'origine
(0002 personne, 0017 contrat_periode) posaient un `CHECK (type_contrat in
('CDI','CDD','INTERIM'))` qui refuse toute autre valeur. La table de référence
gouverne le menu déroulant, mais la colonne portait toujours l'ancien verrou.
**Règle** : dès qu'on transforme un enum en table de référence, **retirer le
CHECK** (migration 0041). La validation passe côté application (liste des
codes actifs). Un test d'inventaire éviterait la récidive : `grep -rn "check.*in (" supabase/migrations/`.

## L24 — `onChange` inline sur `<input>` dans un Server Component

La page `/admin/motifs` (server component) plantait au chargement : mon
`<input type="checkbox" onChange={...}>` inline pour toggler l'actif d'un type
de contrat était rejeté silencieusement par Next 16. Les handlers d'événement
ne peuvent vivre que dans un composant `"use client"`.
**Règle** : toute interaction sur un input passe par un composant client dédié
(cf. `ActifCheckbox`, generalisé pour accepter une PK sous un autre nom via
`keyName`). Le server component ne fait que la mise en page ; il passe le
server action en prop au client — Next.js sait le sérialiser.

## L26 — `useState(prop)` ne se met pas à jour aux changements de props

Bug ordonnancement (2026-08-20) : « j'initialise la semaine 40, je clique
Octobre, les tableaux apparaissent vides ». L'`OrdoMonthNav` fait un
`router.push()` (soft nav), le server component re-rend avec les nouvelles
props, MAIS le client `OrdoGrid` garde son `useState(jourQuartState)`
initialisé sur les props du **mois précédent** — `useState` ne relit son
initialValue **qu'au mount**, jamais quand les props changent. La grille
paraît vide car son état interne est celui d'un autre mois.
**Règle** : dès qu'un composant client dérive son état d'une prop qui peut
changer (URL param, filtre parent), poser un `key={valeur}` sur son
utilisation dans le parent — React démonte/remonte quand la clé change,
`useState` relit l'initialValue fraîche. Alternative : `useEffect` pour
resynchroniser, mais le `key` est plus honnête et le pattern est déjà en
place sur PlacementBoard (`key={atelier|jour|quart}`) et PlanningGrid.

## L27 — Router cache RSC : sans `router.refresh()`, un retour de menu montre l'état pré-mutation

Corollaire de L26. Bug de la même session : la navigation vers un autre
menu puis retour sur `/ordonnancement` montrait un écran vide, alors que
la base avait bien enregistré l'initialisation. Cause : `applyProfil()`
mettait à jour l'état local (checkboxes visibles immédiatement) mais
n'appelait jamais `router.refresh()`. Le router Next met la page en cache
RSC lors du départ **avec les props d'avant l'écriture** ; au retour, il
sert ce cache et `useState` s'initialise à nouveau vide.
**Règle** : toute mutation applicative (POST vers une route API,
`router.push`, etc.) qui doit se refléter au prochain rendu serveur du
même URL exige `router.refresh()` en fin de handler. Le pattern est déjà
en place dans PersonnelEditor / OrdoGrid désormais. Test naturel :
« je fais l'action, je navigue ailleurs, je reviens — c'est là ? ».

## L28 — Ne pas recycler un canal UI pour un sens différent

Bug planning (2026-08-20) : après la refonte cycle de vie, l'écran
affichait « TP » partout, y compris sur des personnes sans temps partiel.
Cause : j'avais recyclé le map `tpBlocked` pour marquer aussi les jours
« hors effectif » (avant arrivée, trou de contrat, après départ) — même
mécanisme de désactivation (case grisée, non-cliquable), pratique. MAIS le
rendu client, lui, interprète toujours `tpBlocked` comme « afficher le
badge TP violet » → toute case marquée hors-effectif recevait le label.
**Règle** : quand deux causes distinctes justifient le même comportement
technique (désactiver une cellule), garder **deux canaux distincts** de
bout en bout, même si le rendu commence identique. Renommer un canal
existant est un piège : l'UI garde en tête l'ancien sens. Ici : canal
`horsEffectif` séparé de `tpBlocked`, fond gris (pas violet), point
discret (pas « TP »), tooltip explicite. Le comportement (case bloquée)
converge côté UX ; le sens sémantique reste séparé.

## L29 — `getAdminClient()` (service_role) : trigger `set_site_id_from_context` tombe en fallback Lebignon

Continuation de L25. Chaque route API qui écrit via `getAdminClient()`
(service_role) sur une table site-locale doit passer `site_id`
explicitement dans la ligne insérée. Sinon le trigger
`set_site_id_from_context` (0043 ligne 583) essaie 3 fallbacks : (1)
`current_site_id()` — NULL car pas d'`auth.uid()` en service_role ; (2) GUC
`app.site_id` — NULL sauf si posé explicitement ; (3) hardcoded Lebignon.
Résultat : les écritures partent dans le site Lebignon quel que soit le
site de l'utilisateur qui a déclenché l'action. Sur un site ≠ Lebignon,
l'écran ne re-voit jamais ses propres écritures (RLS filtre sur son site).
Bug corrigé en 0044 pour les 3 fonctions SQL `creer_absence` / `maj_absence`
/ `set_rotation_reference` (paramètre `p_site`), corrigé en 2026-08-20
pour `/api/ordonnancement/reset-week` + `/api/ordonnancement/quart`
(rows portent `site_id: garde.profile.siteId` explicite, DELETE filtré
sur `site_id`).
**Règle** : ne pas se fier au trigger fallback. La règle a été **étendue aux lectures
et modifications** (2026-08-23, « Sujet 1 ») : dans tout fichier utilisant
`getAdminClient()`, chaque `.select`/`.update`/`.delete` sur une table site-scopée doit
être borné par `.eq("site_id", …)` — sinon, sous service_role, il agit sur la ligne de
n'importe quel site (même classe de faille que `userAdminGuard`). Verrouillé par
`src/lib/isolation-site.test.ts`, qui complète `routes-multi-site` (INSERT/UPSERT) et
`admin-client` (présence de site_id).

## L25 — Composite FKs incompatibles avec les embeds PostgREST

Chantier multi-site (2026-08-20) : la migration 0043 §G a posé des composite
FKs `(child.parent_id, site_id) → parent(id, site_id)` pour interdire à la
base tout mélange inter-sites. Effet immédiat : PostgREST ne trouvait plus la
relation « simple » que ses embeds implicites attendent
(`.select("id, ligne(id, nom)")`), et rejetait la requête avec
`Could not find a relationship between X and Y in the schema cache`.
La 0046 a restauré les FKs simples EN PLUS des composites — nouveau bug :
PostgREST voyait alors DEUX relations et refusait avec
`Could not embed because more than one relationship was found`. **Sans
throw** — Supabase JS retourne juste `data: null`, les pages s'affichent
vides sans erreur. Perdu ~2 h à diagnostiquer parce qu'aucune stack ne
remontait.
**Règle** :
- Ne pas mélanger composite FK et FK simple sur la même colonne. PostgREST
  ne sait pas trancher.
- Choix retenu (0047) : DROP les composite FKs, garder les FKs simples. La
  garantie « aucun mélange inter-sites » est portée par RLS
  (`site_id = current_site_id()`) + trigger `set_site_id_from_context` qui
  auto-remplit `site_id`. Ceinture (composite FK) enlevée, bretelles (RLS +
  trigger) suffisent en V1a.
- **Toujours** vérifier `error` sur un retour Supabase JS, même sur un
  `data ?? []` : un `data: null` avec `error: {...}` est silencieux à
  l'exécution. Pattern : `if (error) throw error;` en amont du `.map()`.
- Pour un jour remettre les composite FKs (V2 multi-sites), il faudra
  ajouter des hints explicites partout : `.select("ligne!ligne_atelier_id_fkey(...)")`.
  Documenté dans `tasks/multi-site.md §3.4`.

## L30 — Impersonation : le « site courant » n'est PAS le site du super_admin, et le header manque sur `/api/`

Incident 2026-08-23 (après application de 0055). Deux régressions en chaîne,
même racine : confondre « qui je suis » (`profile.siteId` = site d'origine) et
« quel site je regarde » (site impersonné).

1. **Boucle `/login ↔ /`** : 0055 a retiré `OR is_super_admin()` de la policy
   `app_user_select`. En impersonation, `current_site_id()` renvoie le site
   cible, donc via `getServerClient` (RLS) la propre ligne `app_user` du
   super_admin (rattachée à un AUTRE site) devient invisible →
   `getCurrentProfile()` null → la page redirige `/login`, le middleware voit un
   user connecté sur `/login` et redirige `/` → boucle infinie. **Fix** :
   `getCurrentProfile` lit sa ligne (clé `user_id`) en **`getAdminClient`**
   (service_role), découplée de la RLS site-scopée. Le profil de l'appelant ne
   doit jamais dépendre du site qu'il consulte.

2. **Écritures sur le mauvais site** : ~20 routes écrivent `site_id:
   profile.siteId`. En impersonation, `profile.siteId` valait le site d'origine
   du super_admin → compte et atelier créés sur Le Bignon depuis LVC. **Fix** :
   rendre `getCurrentProfile().siteId` conscient de l'impersonation, à la source,
   pour réparer les ~20 routes d'un coup. `getServerClient` et `getCurrentSite()`
   suivent.

⚠️ **Piège transverse** : le header `x-impersonate-site` est posé par le
middleware, or **le matcher du middleware exclut `/api/`** → sur une route API le
header est ABSENT. La seule source d'impersonation fiable partout est le
**cookie signé** (`getImpersonatedSiteId()`), pas le header
(`getImpersonatedSiteIdFromHeader()`). Depuis, `getCurrentProfile` et
`getServerClient` lisent le cookie.

**Règle** : pour toute opération site-scopée, « site courant » =
`getCurrentProfile().siteId` (ou `getCurrentSite()` qui en dérive), jamais une
valeur recalculée à partir du header ou d'un site codé en dur. C'est le pendant
applicatif exact de `current_site_id()` en SQL.

## L31 — Whitelist de patch : une clé non prévue est écartée EN SILENCE

Incident 2026-08-24. Désactiver un poste dans le Référentiel n'avait aucun effet :
le poste restait dans la Matrice de polyvalence (et partout où l'on filtre
`poste.actif`). La bascule cochait/décochait bien à l'écran (état local optimiste)
puis « revenait » au rechargement.

**Racine** : `togglePoste` (client) postait `update-poste { patch: { actif } }`,
mais la route `/api/referentiel` normalise chaque clé de patch via un **whitelist**
(`posteValue`) qui n'avait **pas** de `case "actif"` → `default → undefined` →
`if (v !== undefined) patch[k] = v` écartait la clé. Le `UPDATE poste` partait
sans `actif`, sans la moindre erreur (contrairement à L19 où une colonne absente
faisait *rejeter* toute la requête : ici c'est l'inverse, une clé en trop est
silencieusement *ignorée*). Le flag `actif` restait `true`, tous les écrans qui
filtrent `poste.actif` (18 pages : Matrice, Planning, Placement, Ordonnancement,
Bilans, TV…) continuaient de l'afficher.

**Aggravant** : `toggleAtelier` et `toggleLigne` passaient, eux, par l'op dédiée
`toggle` (qui gérait déjà l'entité `poste` + `site_id`). Seul `togglePoste` avait
divergé du motif en réutilisant `posteField`/`update-poste`.

**Fix** : réaligner `togglePoste` sur l'op `toggle` (`post("toggle", { entity:
"poste", id, actif })`), comme atelier et ligne. Une fois le flag réellement écrit,
le masquage marche partout — c'est un *soft-hide* (`actif=false`), aucune donnée
supprimée.

**Règle** : un whitelist de patch qui `return undefined` par défaut masque toute
faute de frappe/oubli de colonne. Quand une écriture « ne prend pas » sans erreur,
suspecter d'abord que la clé n'est pas dans le whitelist. Et une action booléenne
(activer/désactiver) a sa propre op — ne pas la faire transiter par la route
d'édition des champs texte/nombre.

## L32 — Regroupement par jours : deux périodes DÉCLARÉES distinctes se fondaient

Incident 2026-08-25. Deux arrêts maladie saisis séparément (01→10 puis 11→30 juillet)
s'affichaient comme UNE période 01→30 dans la modale Absences. Pire, la « réduction »
d'une de ces périodes était impossible.

**Racine** : `grouperAbsences` (`src/lib/absences-periodes.ts`) part des JOURS (401/421
jours d'absence n'ont pas de période déclarée) et fusionne les jours consécutifs de
même motif à ≤ 3 jours d'écart. Deux absences déclarées contiguës (écart 10→11 = 1 jour)
et de même motif tombaient dans la même période, dont l'`absence_id` passait à `null`
(hétérogène). Conséquence en cascade : la modale, voyant `absence_id` null, traitait
l'édition comme une **re-déclaration** (`creer_absence`) au lieu d'un `update`
(`maj_absence`). Réduire 01→30 en 01→20 créait une nouvelle absence 01→20 mais laissait
la **queue** (21→30) de l'autre absence en place → « impossible de réduire ».

**Fix** : ne jamais fusionner deux jours issus de deux `absence_id` **déclarés
différents** (frontière `!!j.absence_id && !!curDecl && j.absence_id !== curDecl`). Un
jour saisi au planning (`absence_id` null) continue de rejoindre la période voisine.
Chaque période déclarée garde ainsi son `absence_id` → reste éditable via `maj_absence`,
qui supprime puis réinsère la plage réduite proprement.

**Règle** : quand un regroupement d'affichage part des lignes-filles (jours) et non des
entités-mères (périodes déclarées), il doit préserver les **frontières d'entité** — sinon
il perd le détail ET casse l'édition, qui s'appuie sur l'identité de l'entité.

## L33 — `<input type="time">` trop étroit : valeur incomplète = valeur vide

Incident 2026-08-25. Dans le popover « horaire spécifique » du Planning (petite pendule),
l'heure de **fin** « ne s'enregistrait pas », l'heure de début oui — alors que le code
front, l'API et la colonne DB traitent les deux de façon strictement symétrique.

**Racine** : le popover `.exc-pop` faisait 168 px pour DEUX `<input type="time">` côte à
côte (≈ 95 px chacun requis en Chrome). Le second champ (fin) était rogné, ses minutes
inaccessibles. Or un `<input type="time">` dont l'heure est saisie mais **pas** les
minutes renvoie `""` — pas une valeur partielle. Donc `draft.fin` restait vide et
partait `null`. Symptôme trompeur : « la fin ne s'enregistre pas », qui pointe vers le
back alors que le coupable est la **largeur** du contrôle.

**Fix** : popover élargi à 220 px, deux colonnes `flex:1` étiquetées Début/Fin, inputs
en `width:100%`. Chaque champ dispose de la place pour HH:MM.

**Règle** : un `<input type="time">`/`date` doit avoir la largeur d'afficher son masque
complet ; rogné, il paraît fonctionner mais renvoie du vide. Un champ « qui ne sauve
pas » alors que le back est symétrique → suspecter la **saisissabilité** du widget avant
de fouiller l'API.

## L34 — PowerShell 5.1 `Set-Content -Encoding utf8` corrompt les fichiers UTF-8 (mojibake + BOM)

Incident 2026-08-25. Pour swapper deux lignes (`requireModule` → `requireRapportBilan`)
dans 9 pages de Bilans, un remplacement en masse via
`(Get-Content $p -Raw) -replace ... | Set-Content $p -Encoding utf8` a **corrompu tous les
accents** des fichiers (`é` → `Ã©`, `→` → `â†’`, `—` → `â€”`) et ajouté un **BOM** en tête.
Le `npm run build` est passé (le mojibake reste du TS syntaxiquement valide, dans des
chaînes/commentaires), donc le piège survit à la compilation et n'aurait été vu qu'à
l'affichage utilisateur — repéré ici à la relecture du `git diff`.

**Racine** : sous PowerShell 5.1, `Get-Content` lit un fichier UTF-8 en le **réinterprétant
selon l'encodage ANSI par défaut** (les octets multi-octets UTF-8 deviennent des caractères
Latin-1), puis `Set-Content -Encoding utf8` **ré-encode ce texte déjà faux** en UTF-8 —
double-encodage — et pose en plus le BOM que Chrome/Next affiche comme `ï»¿`.

**Fix** : restauration depuis HEAD (`git checkout HEAD -- <fichiers>`, après avoir confirmé
via `git diff HEAD` qu'aucune modif sémantique pré-existante ne serait perdue), puis
remplacement refait via un **script Node** (`fs.readFileSync(p,"utf8")` / `writeFileSync` —
UTF-8 par défaut, sans BOM).

**Règle** : pour éditer un fichier source (UTF-8) sous Windows, **ne jamais** passer par
`Get-Content`/`Set-Content`/`Out-File` de PowerShell 5.1 sur du texte accentué. Utiliser
l'outil **Edit** (préserve l'encodage) ou un **script Node**. Et comme le mojibake ne casse
pas le build, **toujours relire le `git diff`** d'un remplacement en masse avant de commit.

## L35 — Une grille cliente initialisée par `useState(props)` ignore `router.refresh()`

**Symptôme** : après le bouton « Pré-remplir postes fixes » (écriture serveur en masse dans
`placement`), le message de succès s'affiche mais **le tableau du planning ne bouge pas** ;
il faut un **F5** pour voir les nouvelles cases.

**Racine** : `PlanningGrid` porte l'état des cellules dans `const [vals] = useState(initial)`.
Un `useState(x)` ne lit `x` **qu'au montage** : il ignore les rendus suivants. La grille est
ré-montée **uniquement** via sa `key` (qui n'inclut que les filtres : équipe/atelier/quart/
semaine). Un `router.refresh()` ré-exécute bien le Server Component et renvoie un `initial`
frais, mais **la `key` ne change pas** → React réutilise l'instance → `vals` reste **périmé**.
Le F5 marche parce qu'il **remonte tout**.

**Fix retenu** (action de masse ponctuelle) : après succès, `window.location.reload()` — on
affiche d'abord le message, puis recharge (`setTimeout(reload, 650)`). Simple et infaillible.

**Alternatives** (non retenues ici) : (a) un `useEffect` qui resynchronise `vals` depuis
`initial` — mais la grille évite volontairement ce sync pour ne pas écraser les éditions
optimistes en attente ; (b) glisser un *nonce* dans la `key` de la grille pour forcer le
remontage. Les deux sont plus intrusifs qu'un reload pour un bouton occasionnel.

**Règle** : quand une écriture serveur doit se refléter dans un composant client dont l'état
vient de `useState(props)`, `router.refresh()` **ne suffit pas**. Soit remonter le composant
(changer sa `key`), soit recharger la page, soit resynchroniser explicitement l'état.
