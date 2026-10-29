# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for the Xiaomi / Mi Home / Mijia
Wi-Fi devices (purifiers, humidifiers, fans, plugs, lights, sensors), driven
locally over miIO with the MIoT specifications: a Node.js service (Node 22+,
ESM, no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/hub.test.js              # one file
node --test --test-name-pattern "plug"    # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only (registerHandlers + shutdown)
src/app.js                        every SDK handler, wired to the hub (the tests use it too)
src/hub.js                        MiotHub: records, discovery, polling timer, states, commands,
                                  maintenance trigger, configuration actions, /data
src/devices.js                    record + translation -> Gladys device (ids, params)
src/miio/protocol.js              miIO packets: hello, AES-128-CBC (MD5 of the token), checksum
src/miio/transport.js             UDP exchanges: session (id + stamp), retries, one at a time per host
src/miot/properties.js            get_properties (chunked, cut down when refused) / set_properties
src/miot/spec.js                  miot-spec.org client, cache under /data/specs
src/miot/translate.js             standard MIoT services -> Gladys features (encode/decode)
src/miot/names.js                 feature names, device kinds, value labels (en, fr, de, es)
src/miot/quirks.js                per-model differences (chunk size, water level scale)
src/miot/legacy.js                models deaf to MIoT on the LAN (Yeelight): get_prop and setters
src/cloud/client.js               Xiaomi account login (two-step verification), device list
src/cloud/crypto.js               RC4-drop1024 + SHA signatures of the Xiaomi API
src/cloud/devices.js              which account devices are kept (Wi-Fi, address, token, no vacuum)
src/widgets.js                    the `air_quality` dashboard widget
src/scenes.js                     the `set_property` scene action
src/texts.js                      connection status and action messages, four languages
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/store.js                      /data/xiaomi-miot.json (tokens, mode 0600, atomic writes)
src/problems.js                   repeated failures logged once (start and end)
scripts/probe.mjs                 read-only probe of the real account, specs and devices
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/{en,fr,de,es}.md             user documentation, re-hosted by Gladys (en and fr mandatory)
test/                             node --test, against the SDK's fake Gladys, fake miIO devices,
                                  fake Xiaomi account and fake miot-spec.org (test/helpers)
test/fixtures/specs/              real MIoT specifications (homebridge-miot MIT, hass-xiaomi-miot)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or API keys.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** exists in English, French, German ("du") and Spanish
  ("usted"): action messages, widget texts, feature names, manifest texts, and
  `docs/{en,fr,de,es}.md` with the same sections. `test/i18n.test.js` checks it.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

---

# Notes du mainteneur (guim31)

Ce qui suit complète les règles du template ci-dessus. Ce sont des faits vérifiés dans le code du
cœur Gladys ou payés sur les intégrations déjà publiées par guim31. Ils ne se lisent pas dans le
code de ce dépôt. Compléter ce fichier quand un nouveau piège est découvert.

## Travailler sur ce dépôt

- Mêmes étapes que la CI, dans le même ordre : `npm ci`, `npm run format:check`, `npm run lint`,
  `npm test`. Prettier contrôle **aussi le Markdown** : lancer `npm run format` après avoir
  modifié ce fichier, le README ou la documentation, sinon la CI tombe.
- Une session de code n'a **ni instance Gladys ni appareil réel**. La suite de tests, le lint et
  le validateur du store sont les seules vérifications possibles : le test réel se fait ailleurs.
  Le dire, plutôt que de conclure que « ça marche ».
- **Tout le code de démonstration du template disparaît** : station météo, prise, lampe, caméra,
  capteur de mouvement, `src/weather.js`, leurs tests, leurs entrées du manifeste et de la
  documentation. Il ne reste que ce que l'intégration fait vraiment.
- **Publier n'est jamais le travail d'une session de code** : ni Release, ni tag, ni topic, ni
  version modifiée à la main. L'orchestrateur s'en charge une fois la PR fusionnée. Les workflows
  sont ceux du template : ne pas les modifier.
- Le dépôt est **public** : aucun secret, aucune adresse ni détail d'infrastructure privée, ni
  ici, ni dans les tests, ni dans les captures.

## Pièges du cœur Gladys

**Appareils et fonctionnalités**

- **Polling** : le planificateur n'interroge un appareil que si `should_poll: true` **et**
  `poll_frequency` vaut une valeur de la liste fixe, **en millisecondes** (1000, 2000, 10000,
  15000, 30000, 60000). Le template publie `poll_frequency: 300` sans `should_poll` : c'est faux,
  le cœur répond 400 à la découverte. Pour une cadence hors liste, publier `should_poll: false` et
  pousser les états depuis le conteneur, en gardant un `onPoll` de repli.
  **Piège du 5.2.0** (GladysAssistant/Gladys#3198, correctif #3199, relevé sur gladys-ping-wol) :
  un appareil **créé sans `should_poll`** n'est jamais sondé, même après correction du cœur (valeur
  stockée à la création), et la 5.2.1 du 13/10/2026 ne le corrige pas. **Le conteneur sonde donc
  lui-même** par un minuteur, qui saute un appareil sondé il y a moins d'une demi-période, en gardant
  `onPoll` comme repli ; seuls les appareils ajoutés (`gladys.devices`) sont lus. Un test le prouve
  sans appeler `onPoll`.
- **`min` et `max` sont NOT NULL** dans `t_device_feature`, y compris pour `text/text` : sans eux,
  « Ajouter à Gladys » échoue en HTTP 422. Mettre 0/0, comme Zigbee2MQTT.
- Un état publié sur une fonctionnalité **pas encore ajoutée** dans Gladys reçoit un 200 puis est
  jeté (simple ligne de log) : republier les états dans `onDeviceCreated`.
- `level-sensor/decimal` n'existe pas côté serveur. `light-sensor/binary` n'a pas de libellé dans
  le front (pastille vide) : préférer `input/binary`. Un `text/text` reçoit `{ text }`, jamais
  vide, sinon l'état est ignoré.
- **Détecteur d'ouverture (`opening-sensor`) : 0 = ouvert, 1 = fermé** (`OPENING_SENSOR_STATE`), à
  l'inverse de l'intuition et des autres détecteurs (mouvement, fuite, fumée : 1 = détecté). Une
  porte ouverte publiée à 1 s'affiche « Fermé » et fausse scènes et historique. Le figer par un test.
- **Un `external_id` de fonctionnalité ne change jamais d'appareil** d'une version à l'autre. UniFi
  1.5.2 avait sorti les ports PoE dans un appareil dédié, la 1.6.0 les a remis dans la passerelle avec
  les mêmes identifiants : ceux qui avaient ajouté l'appareil dédié ne peuvent plus « Mettre à jour » la
  passerelle (409 `external_id must be unique`). Pour regrouper, garder l'appareil existant
  (`gladys.getDevices()`) ou changer d'identifiant.
- Les **noms de fonctionnalités sont figés à la création**. Et quand une fonctionnalité est seule
  de son type sur l'appareil, le tableau de bord affiche le libellé générique du type à la place
  du nom publié.
- **Aucune commande d'appareil ne permet un choix multiple** : un `text/select` n'a qu'un choix
  actif.
- Un changement de structure fait proposer « Mettre à jour » dans l'onglet Découverte
  (`structure_changed`). Un changement des seules `supported_options` ne le déclenche pas.
- **Jauge** : l'aiguille se place par `(value - min) / (max - min)` des bornes de la
  fonctionnalité. `gauge_min`/`gauge_max` ne pilotent que les couleurs, et le cœur n'applique
  jamais `min`/`max` en écriture : ce sont des bornes d'affichage. Une valeur signée exige des
  bornes symétriques.
- Le cœur plafonne à **300 états par minute** et réévalue les scènes à chaque état : ne publier
  que les changements.
- Une intégration `device` ne reçoit pas la langue de l'utilisateur, une action de scène non
  plus (un widget, si) : prévoir un champ de config `language` si des textes partent du
  conteneur. Le superviseur injecte `TZ`, le fuseau de Gladys. La sandbox est limitée à 256 Mo.

**Formulaires de configuration et actions**

- Les champs `number` sont rendus **sans `step`** : le navigateur n'accepte alors que `min + k`.
  Min et défaut **entiers** seulement ; une valeur décimale passe par un `select` ou par un
  `string` parsé (virgule acceptée).
- Un champ `secret` dans les `fields` d'une **action** est impossible à remplir, et une action
  n'applique **aucun `default`** tout en exigeant les champs `required` (422). Issues
  GladysAssistant/Gladys#3154 et #3155.

**SDK 0.15 et journaux**

- SDK `@gladysassistant/integration-sdk` **^0.15.0** (12/10/2026) : `DEVICE_POLL_FREQUENCIES`, faux
  Gladys de test (`@gladysassistant/integration-sdk/testing`, à préférer à un faux maison),
  déduplication des états, `parseMdnsTxt`. Lire son README et son CHANGELOG.
- **Journaux calmes** (demande de Guilhem, 13/10/2026) : rien au niveau info pour un cycle normal de
  lecture, un état publié ou un message reçu. L'info ne garde que le cycle de vie : démarrage,
  connexion, perte et retour d'un appareil ou d'un service, erreurs utiles, une ligne par action de
  l'utilisateur. Le reste passe en debug (`LOG_LEVEL=debug`). Une erreur qui se répète écrit une ligne
  au premier échec et une au rétablissement, pas une par tentative. Jamais de secret ni d'adresse
  avec identifiants. Un test vérifie qu'un cycle normal n'écrit rien en info.
- **Heartbeat** : republier au moins toutes les 12 h une valeur qui ne change pas, sinon le front
  affiche « Pas de valeur récente » au-delà de 48 h.

**Widgets, déclencheurs, actions de scène (SDK ≥ 0.14, Gladys ≥ 5.1)**

- **Cibler la dernière version publiée du cœur, pas `master`** : la spec de `master` décrit des
  fonctions non publiées. Les boutons de widget qui ouvrent un formulaire (#3168, commit 3feb2cf8)
  sont absents de la 5.1.4 mais **livrés dans la 5.2.0** (sortie le 12/10/2026) : `gladys_version`
  `>=5.2.0` si on s'en sert, ou un bouton direct en repli. Vérifier par `git tag --contains`.

- Un réglage de widget ne propose en liste que les **appareils** de l'intégration
  (`source: "devices"`, seule source dynamique).
- Budget du cœur : **8 composants par widget, dont 2 textes au plus**, appliqué **avant** la
  résolution des références ; un contenu amputé reste en cache jusqu'au TTL. Appeler
  `requestWidgetRefresh` à la création d'un appareil. `validateWidgetContent` est exporté pour les
  tests, mais ne vérifie pas que les `external_id` liés existent : les croiser avec `buildDevice`.
- Une ligne de `status` exige un `value` (nombre ou texte ≤ 40).
- Le cœur **jette un bouton dont la clé d'action est déjà prise** : clés numérotées.
- Le vocabulaire des widgets n'a ni liste ni curseur, **par choix** du cœur. Seul un bouton
  `device_feature` numérique a un état actif natif.
- **En mode sombre, le style `primary` d'un bouton de widget ne se voit pas** (#3153) : signaler
  un choix courant par l'icône (`check-circle`), jamais par le style.
- Dans une grille `card-list`, la `date` s'affiche **à la place** du sous-titre.
- `onWidgetAction` fait recharger le widget dès la résolution, alors que `requestWidgetRefresh`
  est plafonné à un appel toutes les 10 s. Un toast d'action est tronqué à 200 caractères.
- Le cœur met le contenu d'un widget en cache par (réglages, langue, unités) : pré-localiser
  d'après `language` est correct.
- Les filtres de scène ne font qu'égalité et appartenance : un seuil reste le travail d'un capteur.
- **Les clés de widgets, de déclencheurs et d'actions sont figées une fois publiées.**
- `gladys_version` `>=5.1.0` dès qu'il y a widgets, déclencheurs ou actions de scène.

## Store

- Validateur officiel, depuis la racine : `npx -y github:GladysAssistant/integration-store .`
  (schéma, `description` **100 caractères au plus par langue**, documentation de 300 caractères
  au moins, image Docker, cover de **150 Ko au plus**). Il demande Node ≥ 24 mais tourne sous
  Node 22 avec un avertissement.
- L'indexeur lit le manifeste de la **dernière release**, pas celui de `main` : une correction du
  manifeste (catégorie, description…) n'atteint le store qu'avec une release.
- L'indexeur rejette **en silence** : la raison n'apparaît que dans `rejected.json`, à côté de
  `https://integration-store-storage.gladysassistant.com/index.json`.
- **Image de base** : `FROM mirror.gcr.io/library/node:…` (miroir Docker Hub de Google, même
  empreinte, sans compte) et non `node:…` de Docker Hub ni `public.ecr.aws/docker/library/node:…`
  d'ECR Public : tous deux refusent en 429 les pulls anonymes des runners GitHub dès qu'il y a
  plusieurs builds à la fois (ECR depuis fin octobre 2026). Un échec 429 dans le job « Docker build »
  n'est pas un bug du code. Même parade dans `.github/workflows/build.yml` (posée par
  l'orchestrateur, ne pas la retirer) : QEMU et BuildKit tirés de `mirror.gcr.io`.
- La règle `data/` du `.gitignore` du template (pour le volume `/data`) exclut aussi `src/data/` :
  l'ancrer en `/data/`, dans `.prettierignore` aussi.

### Langues (depuis le 11/10/2026)

Tout texte montré à l'utilisateur existe en **`en`, `fr`, `de` et `es`** : manifeste, contenu des widgets, messages,
noms de fonctionnalités. L'allemand **tutoie** (« du »), l'espagnol **vouvoie** (« usted ») : décision de Guilhem,
appliquée à ses 21 intégrations. `test/i18n.test.js` doit échouer sur une langue manquante, un texte vide ou trop
long, et sur un « Sie »/« Ihr… » de politesse en allemand. Le store exige `docs/en.md` et `docs/fr.md`
(`DOCS_LANGUAGES`) et publie aussi `docs/de.md` et `docs/es.md` quand ils existent
(`DOCS_OPTIONAL_LANGUAGES` d'integration-store) : écrire les quatre, avec les mêmes sections.

## Choix par défaut de Guilhem (12/10/2026)

- Langue par défaut des noms de fonctionnalités et des textes produits par le conteneur : **`fr`**.
- Fichier `LICENSE` Apache-2.0 (texte complet) à la racine.
- `transports` : `local` seul quand le cloud n'est qu'une option annexe.
- Docs `en`, `fr`, `de`, `es` avec les mêmes sections.
- Chauffe, ouverture, sécurité : ne rien rendre pilotable « comme un thermostat » ou par un assistant
  vocal quand une erreur serait dangereuse (leçon d'OctoPrint).

## Xiaomi MIoT (gladys-xiaomi-miot)

**Protocole miIO** (lu dans python-miio, GPL, sans rien recopier ; code écrit avec `node:crypto`)

- UDP **54321**. Paquet = en-tête de 32 octets (`2131`, longueur totale, 4 octets à 0, id de
  l'appareil, horodatage, somme MD5) + JSON-RPC chiffré AES-128-CBC/PKCS#7, clé = MD5(jeton),
  IV = MD5(clé + jeton). Somme = MD5(16 premiers octets + jeton + données).
- Un « hello » (`21310020` + 28 × `ff`) donne l'id et l'horodatage de l'appareil, à renvoyer
  dans chaque requête (session gardée tant qu'il répond, 10 min max). Un appareil non associé
  met son jeton dans la somme de la réponse ; associé, `ff…` ou `00…`.
- **Mauvais jeton = silence** : l'appareil répond au hello mais ignore la requête. D'où
  l'erreur `no-answer` (jeton refusé), distincte de `offline` (pas de hello).
- **Silence ≠ mauvais jeton** (issue #6, 24/10/2026) : les anciennes Yeelight
  (`yeelink.light.color5`…) ont une spec sur miot-spec.org mais **ignorent `get_properties` en
  local** ; elles ne parlent que `get_prop` (valeurs en texte : `"on"`, `"80"`) et leurs
  setters (`set_power`, `set_bright`, `set_ct_abx`, `set_rgb`). Liste tirée de
  `core/miio2miot_specs.py` de hass-xiaomi-miot (`src/miot/legacy.js`). Pour un autre modèle
  muet, `miIO.info` départage : il répond → « ancien protocole miIO seul », pas « jeton
  refusé ». Ne pas conclure au jeton quand l'utilisateur a déjà réimporté.
- Les réponses finissent par des octets NUL ; certains firmwares répondent vide quand ils sont
  occupés. Une requête doit rester sous ~1 Ko : `get_properties` par paquets de 15 au plus ;
  certains modèles n'en acceptent que 1 à 7 (`src/miot/quirks.js`, d'après hass-xiaomi-miot).
  Après un premier échec, une propriété seule distingue un mauvais jeton d'un paquet trop
  gros ; la taille qui marche est gardée dans `/data`.
- Codes MIoT : 0 fait, 1 accepté (asynchrone), négatif = refus (-4001 non lisible, -4002 non
  modifiable, -4003 inexistante…).
- L'unicast traverse le NAT du pont Docker dans les deux sens ; le hello en diffusion passe
  par la découverte médiée du cœur (`udp-active-broadcast`, port 54321 déclaré dans
  `network_discovery`) : il donne l'id → l'adresse, pour suivre le DHCP.

**Compte Xiaomi** (d'après hass-xiaomi-miot, Apache-2.0)

- `GET account.xiaomi.com/pass/serviceLogin?sid=xiaomiio&_json=true` → `_sign` ;
  `POST /pass/serviceLoginAuth2` (MD5 du mot de passe en majuscules) → `location` +
  `ssecurity`, ou `notificationUrl` (vérification en deux étapes) ou `captchaUrl` ; la
  `location` donne le cookie `serviceToken`. Réponses préfixées `&&&START&&&`.
- Deux étapes : l'utilisateur ouvre le lien, y **demande** le code sans le saisir ; on appelle
  `identity/list` (même URL) → cookie `identity_session`, puis
  `identity/auth/verifyPhone` (flag 4) ou `verifyEmail` (8) avec le code → `location` ;
  ensuite `serviceLogin` répond directement avec `ssecurity`. État gardé 15 min en mémoire
  (un redémarrage oblige à recommencer).
- API : `POST https://<région>.api.io.mi.com/app/home/device_list` (`cn` sans préfixe),
  paramètres chiffrés RC4-drop1024 avec le nonce signé (SHA-256 de ssecurity + nonce), signature
  SHA-1 de `POST&/home/device_list&k=v…&nonce signé`, réponse chiffrée de même. Vérifié contre la
  référence Python dans `test/cloud.test.js`.
- Gardés : `did` numérique, `localip`, jeton valide, pas de `parent_id`. Écartés et comptés :
  aspirateurs (intégrations Xiaomi Home, Roborock, Dreame), Bluetooth (`blt.…`), Zigbee
  (`lumi.…`), sous-appareils, appareils partagés sans jeton.
- Le compte n'est appelé qu'à l'import : action, changement des identifiants, premier démarrage
  sans appareil. Jamais à chaque démarrage : Xiaomi multiplie alors captchas et vérifications.

**Spécifications et traduction**

- `miot-spec.org/miot-spec-v2/instances?status=released` (liste réduite à modèle → URN, gardée
  une semaine) puis `instance?type=<urn>` ; tout est mis en cache sous `/data/specs` (une
  spécification ne change jamais pour une URN donnée). Injoignable depuis les sessions de
  développement : fixtures réelles dans `test/fixtures/specs` (homebridge-miot 2.0.0, MIT,
  reconstruites depuis ses fichiers d'appareils, et un fichier de hass-xiaomi-miot).
- Seul l'espace `miot-spec-v2` est traduit (sauf `water-shortage(-fault)`, connu chez deerma) ;
  les services des fabricants (`urn:zhimi-spec:…`) sont listés par l'action de diagnostic et
  restent accessibles par l'action de scène `set_property`.
- Clé de fonctionnalité = `<siid>-<piid>` : permanente. Une liste de valeurs modifiable devient
  un `text/select` (valeurs en texte, libellés traduits pour les courants : Auto, Sleep,
  LevelN…). L'humidité cible devient une liste tous les 5 % : le cœur n'a ni consigne
  d'humidité ni nombre libre modifiable (seuls quelques types ont un curseur, voir
  `ROW_TYPE_BY_FEATURE_TYPE` du front).
- `fan/rock-setting` : le front propose les valeurs entre `min` et `max` de l'énumération
  (0 arrêt, 1 gauche-droite, 2 haut-bas…). L'oscillation horizontale est donc 0..1 ; la
  verticale reste un `switch/binary` (0..2 proposerait aussi « gauche-droite »).
- **Radiateur (`heater`) en lecture seule**, y compris par `set_property` (règle de Guilhem :
  rien de chauffant pilotable comme une lampe ou par un assistant vocal).
- Niveau d'eau des Smartmi `zhimi.humidifier.ca4` : 0-120 (127 = réservoir absent), ramené en %.

**Choix de conception**

- `transports: ["local"]` : le compte ne sert qu'à récupérer les jetons, ce n'est pas un canal
  vers les appareils ; avec `cloud`, Gladys afficherait un interrupteur « préférer le local »
  sans effet.
- Appareils publiés `should_poll: true` + `poll_frequency` (15 s, 30 s ou 1 min selon la config)
  pour le repli du cœur ; le minuteur du conteneur fait le travail et `onPoll` saute un
  appareil lu il y a moins de 90 % d'une période.
- Déclencheur `maintenance_needed` : une fois par début de raison (filtre ≤ 10 %, réservoir
  vide, défaut), raisons en cours gardées dans `/data` pour ne pas redéclencher au redémarrage.
- Widget `air_quality` : pas de texte d'en-tête, pour tenir dans les 8 composants (4 tuiles +
  1 statut + 3 boutons) ; « ne répond pas » est une ligne du statut.
- L'action d'ajout manuel demande `miIO.info` à l'appareil : le modèle vient de lui, et la
  réponse prouve le jeton.
