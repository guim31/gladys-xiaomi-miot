// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status and the results of the Configuration screen actions. Four
// languages, the four of the Gladys interface; German says "du", Spanish
// "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { LANGUAGES } from './miot/names.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// Shown by Gladys under the integration name when it is not connected.
export const CONNECTION_TEXT = {
  noDevice: {
    en: 'No device yet: import them from your Xiaomi account, or add one by its IP address and token.',
    fr: 'Aucun appareil pour l’instant : importez-les depuis votre compte Xiaomi, ou ajoutez-en un par son adresse IP et son jeton.',
    de: 'Noch kein Gerät: Importiere sie aus deinem Xiaomi-Konto oder füge eines mit IP-Adresse und Token hinzu.',
    es: 'Todavía no hay ningún dispositivo: impórtelos desde su cuenta Xiaomi o añada uno con su dirección IP y su token.',
  },
  noAnswer: {
    en: 'No Xiaomi device answers on the local network.',
    fr: 'Aucun appareil Xiaomi ne répond sur le réseau local.',
    de: 'Kein Xiaomi-Gerät antwortet im lokalen Netzwerk.',
    es: 'Ningún dispositivo Xiaomi responde en la red local.',
  },
  verification: {
    en: 'Xiaomi asks for a two-step verification: run “Import the devices of the Xiaomi account” to see what to do.',
    fr: 'Xiaomi demande une vérification en deux étapes : lancez « Importer les appareils du compte Xiaomi » pour savoir quoi faire.',
    de: 'Xiaomi verlangt eine Bestätigung in zwei Schritten: Starte „Geräte des Xiaomi-Kontos importieren“, um zu sehen, was zu tun ist.',
    es: 'Xiaomi pide una verificación en dos pasos: ejecute «Importar los dispositivos de la cuenta Xiaomi» para saber qué hacer.',
  },
};

const MAX_LISTED = 10;
const list = (items) =>
  `${items.slice(0, MAX_LISTED).join(', ')}${items.length > MAX_LISTED ? '…' : ''}`;

// The pieces of the action results, one table per language. Functions take
// the values; the URL of the verification is the one Xiaomi gave.
export const ACTION_TEXT = {
  en: {
    notConfigured:
      'Fill in the e-mail (or phone number) and the password of your Xiaomi account in the configuration first, and save.',
    verification: (url) =>
      'Xiaomi asks for a two-step verification.\n' +
      `1. Open this link in a browser: ${url}\n` +
      '2. Ask for the code there (SMS or e-mail), but do NOT type it on that page.\n' +
      '3. Run this action again within 15 minutes, with the code in the “Verification code” field.',
    badCode: 'Xiaomi refused this code. Run the action again without a code to receive a new one.',
    captcha:
      'Xiaomi asks for a captcha, which Gladys cannot show. Log in once to the Mi Home app from the same network, wait a few minutes and try again, or add the devices by hand (IP address and token).',
    credentials:
      'Xiaomi refused the e-mail or the password. Check them, and the region of the account.',
    unreachable: (detail) => `The Xiaomi account cannot be reached (${detail}).`,
    refused: (detail) => `Xiaomi refused the request (${detail}).`,
    imported: (count, names) => `${count} device(s) imported: ${list(names)}.`,
    noneImported: (region) =>
      `No Wi-Fi device with a local address on this account, in the region “${region}”. A Xiaomi account is tied to a region: check it in the configuration.`,
    leftOut: (vacuums, noAddress, noToken) =>
      `Left out: ${vacuums} robot vacuum(s) (the Xiaomi Home, Roborock and Dreame integrations drive them), ${noAddress} Bluetooth or Zigbee device(s) without an address of their own, ${noToken} shared device(s) without a token.`,
    nextStep: 'The devices are in the Discovery tab of the integration.',
    invalidIp: 'Enter the IPv4 address of the device, e.g. 192.168.1.20.',
    invalidToken: 'The token is 32 hexadecimal characters (0-9, a-f).',
    noAnswerAt: (ip) =>
      `No Xiaomi device answers at ${ip}. Check the address, and that the device is on the same network as Gladys.`,
    wrongToken: (ip) => `The device at ${ip} answers, but does not accept this token.`,
    vacuum: (model) =>
      `${model} is a robot vacuum: the Xiaomi Home, Roborock and Dreame integrations of the store drive them.`,
    added: (model, ip) => `${model} added (${ip}). It is in the Discovery tab of the integration.`,
    noSpec: (model) =>
      `but miot-spec.org has no specification for ${model}: it cannot be translated yet.`,
    forgotten: (name) =>
      `${name} is forgotten, with its token. Delete it in Gladys too if you no longer use it.`,
    unknownDevice: 'This device is not known to the integration.',
    diagnosisEmpty: 'No device known yet.',
    answers: 'answers',
    noAnswer: 'does not answer',
    tokenRefused: 'token refused',
    specMissing: 'specification missing',
    features: (count) => `${count} feature(s)`,
    ignored: (services) => `left out: ${list(services)}`,
    unknownOnNetwork: (hosts) =>
      `Found on the network, unknown to the integration (no token): ${list(hosts)}.`,
    scanUnavailable:
      'The discovery through Gladys is unavailable (Gladys 5.1 or later): the addresses come from the Xiaomi account or from you.',
  },
  fr: {
    notConfigured:
      'Renseignez d’abord l’e-mail (ou le numéro de téléphone) et le mot de passe de votre compte Xiaomi dans la configuration, puis enregistrez.',
    verification: (url) =>
      'Xiaomi demande une vérification en deux étapes.\n' +
      `1. Ouvrez ce lien dans un navigateur : ${url}\n` +
      '2. Demandez-y le code (SMS ou e-mail), mais ne le saisissez PAS sur cette page.\n' +
      '3. Relancez cette action dans les 15 minutes, avec le code dans le champ « Code de vérification ».',
    badCode: 'Xiaomi a refusé ce code. Relancez l’action sans code pour en recevoir un nouveau.',
    captcha:
      'Xiaomi demande un captcha, que Gladys ne peut pas afficher. Connectez-vous une fois à l’application Mi Home depuis le même réseau, patientez quelques minutes et réessayez, ou ajoutez les appareils à la main (adresse IP et jeton).',
    credentials:
      'Xiaomi a refusé l’e-mail ou le mot de passe. Vérifiez-les, ainsi que la région du compte.',
    unreachable: (detail) => `Le compte Xiaomi est injoignable (${detail}).`,
    refused: (detail) => `Xiaomi a refusé la demande (${detail}).`,
    imported: (count, names) => `${count} appareil(s) importé(s) : ${list(names)}.`,
    noneImported: (region) =>
      `Aucun appareil Wi-Fi avec une adresse locale sur ce compte, dans la région « ${region} ». Un compte Xiaomi est lié à une région : vérifiez-la dans la configuration.`,
    leftOut: (vacuums, noAddress, noToken) =>
      `Laissés de côté : ${vacuums} aspirateur(s) robot (les intégrations Xiaomi Home, Roborock et Dreame les pilotent), ${noAddress} appareil(s) Bluetooth ou Zigbee sans adresse propre, ${noToken} appareil(s) partagé(s) sans jeton.`,
    nextStep: 'Les appareils sont dans l’onglet Découverte de l’intégration.',
    invalidIp: 'Saisissez l’adresse IPv4 de l’appareil, par exemple 192.168.1.20.',
    invalidToken: 'Le jeton compte 32 caractères hexadécimaux (0-9, a-f).',
    noAnswerAt: (ip) =>
      `Aucun appareil Xiaomi ne répond à ${ip}. Vérifiez l’adresse, et que l’appareil est sur le même réseau que Gladys.`,
    wrongToken: (ip) => `L’appareil à ${ip} répond, mais n’accepte pas ce jeton.`,
    vacuum: (model) =>
      `${model} est un aspirateur robot : les intégrations Xiaomi Home, Roborock et Dreame du store les pilotent.`,
    added: (model, ip) =>
      `${model} ajouté (${ip}). Il est dans l’onglet Découverte de l’intégration.`,
    noSpec: (model) =>
      `mais miot-spec.org n’a pas de spécification pour ${model} : il ne peut pas encore être traduit.`,
    forgotten: (name) =>
      `${name} est oublié, avec son jeton. Supprimez-le aussi dans Gladys si vous ne l’utilisez plus.`,
    unknownDevice: 'Cet appareil est inconnu de l’intégration.',
    diagnosisEmpty: 'Aucun appareil connu pour l’instant.',
    answers: 'répond',
    noAnswer: 'ne répond pas',
    tokenRefused: 'jeton refusé',
    specMissing: 'spécification manquante',
    features: (count) => `${count} fonctionnalité(s)`,
    ignored: (services) => `laissés de côté : ${list(services)}`,
    unknownOnNetwork: (hosts) =>
      `Trouvés sur le réseau, inconnus de l’intégration (sans jeton) : ${list(hosts)}.`,
    scanUnavailable:
      'La découverte par Gladys est indisponible (Gladys 5.1 ou plus récent) : les adresses viennent du compte Xiaomi ou de vous.',
  },
  de: {
    notConfigured:
      'Gib zuerst die E-Mail-Adresse (oder Telefonnummer) und das Passwort deines Xiaomi-Kontos in der Konfiguration ein und speichere.',
    verification: (url) =>
      'Xiaomi verlangt eine Bestätigung in zwei Schritten.\n' +
      `1. Öffne diesen Link in einem Browser: ${url}\n` +
      '2. Fordere dort den Code an (SMS oder E-Mail), gib ihn aber NICHT auf dieser Seite ein.\n' +
      '3. Starte diese Aktion innerhalb von 15 Minuten erneut, mit dem Code im Feld „Bestätigungscode“.',
    badCode:
      'Xiaomi hat diesen Code abgelehnt. Starte die Aktion ohne Code erneut, um einen neuen zu erhalten.',
    captcha:
      'Xiaomi verlangt ein Captcha, das Gladys nicht anzeigen kann. Melde dich einmal aus demselben Netzwerk in der Mi-Home-App an, warte ein paar Minuten und versuche es erneut, oder füge die Geräte von Hand hinzu (IP-Adresse und Token).',
    credentials:
      'Xiaomi hat die E-Mail-Adresse oder das Passwort abgelehnt. Prüfe sie und die Region des Kontos.',
    unreachable: (detail) => `Das Xiaomi-Konto ist nicht erreichbar (${detail}).`,
    refused: (detail) => `Xiaomi hat die Anfrage abgelehnt (${detail}).`,
    imported: (count, names) => `${count} Gerät(e) importiert: ${list(names)}.`,
    noneImported: (region) =>
      `Kein WLAN-Gerät mit lokaler Adresse in diesem Konto, in der Region „${region}“. Ein Xiaomi-Konto gehört zu einer Region: Prüfe sie in der Konfiguration.`,
    leftOut: (vacuums, noAddress, noToken) =>
      `Ausgelassen: ${vacuums} Saugroboter (die Integrationen Xiaomi Home, Roborock und Dreame steuern sie), ${noAddress} Bluetooth- oder Zigbee-Gerät(e) ohne eigene Adresse, ${noToken} geteilte(s) Gerät(e) ohne Token.`,
    nextStep: 'Die Geräte stehen im Reiter „Erkennung“ der Integration.',
    invalidIp: 'Gib die IPv4-Adresse des Geräts ein, z. B. 192.168.1.20.',
    invalidToken: 'Das Token besteht aus 32 hexadezimalen Zeichen (0-9, a-f).',
    noAnswerAt: (ip) =>
      `Unter ${ip} antwortet kein Xiaomi-Gerät. Prüfe die Adresse und ob das Gerät im selben Netzwerk wie Gladys ist.`,
    wrongToken: (ip) => `Das Gerät unter ${ip} antwortet, akzeptiert aber dieses Token nicht.`,
    vacuum: (model) =>
      `${model} ist ein Saugroboter: Die Integrationen Xiaomi Home, Roborock und Dreame im Store steuern sie.`,
    added: (model, ip) =>
      `${model} hinzugefügt (${ip}). Es steht im Reiter „Erkennung“ der Integration.`,
    noSpec: (model) =>
      `aber miot-spec.org hat keine Spezifikation für ${model}: Es kann noch nicht übersetzt werden.`,
    forgotten: (name) =>
      `${name} ist vergessen, mit seinem Token. Lösche es auch in Gladys, wenn du es nicht mehr nutzt.`,
    unknownDevice: 'Dieses Gerät ist der Integration unbekannt.',
    diagnosisEmpty: 'Noch kein Gerät bekannt.',
    answers: 'antwortet',
    noAnswer: 'antwortet nicht',
    tokenRefused: 'Token abgelehnt',
    specMissing: 'Spezifikation fehlt',
    features: (count) => `${count} Funktion(en)`,
    ignored: (services) => `ausgelassen: ${list(services)}`,
    unknownOnNetwork: (hosts) =>
      `Im Netzwerk gefunden, der Integration unbekannt (ohne Token): ${list(hosts)}.`,
    scanUnavailable:
      'Die Erkennung über Gladys ist nicht verfügbar (Gladys 5.1 oder neuer): Die Adressen kommen aus dem Xiaomi-Konto oder von dir.',
  },
  es: {
    notConfigured:
      'Introduzca primero el correo electrónico (o el número de teléfono) y la contraseña de su cuenta Xiaomi en la configuración, y guarde.',
    verification: (url) =>
      'Xiaomi pide una verificación en dos pasos.\n' +
      `1. Abra este enlace en un navegador: ${url}\n` +
      '2. Solicite allí el código (SMS o correo electrónico), pero NO lo introduzca en esa página.\n' +
      '3. Vuelva a ejecutar esta acción antes de 15 minutos, con el código en el campo «Código de verificación».',
    badCode:
      'Xiaomi ha rechazado este código. Vuelva a ejecutar la acción sin código para recibir uno nuevo.',
    captcha:
      'Xiaomi pide un captcha, que Gladys no puede mostrar. Inicie sesión una vez en la aplicación Mi Home desde la misma red, espere unos minutos y vuelva a intentarlo, o añada los dispositivos a mano (dirección IP y token).',
    credentials:
      'Xiaomi ha rechazado el correo electrónico o la contraseña. Compruébelos, así como la región de la cuenta.',
    unreachable: (detail) => `No se puede contactar con la cuenta Xiaomi (${detail}).`,
    refused: (detail) => `Xiaomi ha rechazado la solicitud (${detail}).`,
    imported: (count, names) => `${count} dispositivo(s) importado(s): ${list(names)}.`,
    noneImported: (region) =>
      `Ningún dispositivo Wi-Fi con dirección local en esta cuenta, en la región «${region}». Una cuenta Xiaomi está ligada a una región: compruébela en la configuración.`,
    leftOut: (vacuums, noAddress, noToken) =>
      `Descartados: ${vacuums} robot(s) aspirador(es) (las integraciones Xiaomi Home, Roborock y Dreame los controlan), ${noAddress} dispositivo(s) Bluetooth o Zigbee sin dirección propia, ${noToken} dispositivo(s) compartido(s) sin token.`,
    nextStep: 'Los dispositivos están en la pestaña Descubrimiento de la integración.',
    invalidIp: 'Introduzca la dirección IPv4 del dispositivo, p. ej. 192.168.1.20.',
    invalidToken: 'El token tiene 32 caracteres hexadecimales (0-9, a-f).',
    noAnswerAt: (ip) =>
      `Ningún dispositivo Xiaomi responde en ${ip}. Compruebe la dirección y que el dispositivo está en la misma red que Gladys.`,
    wrongToken: (ip) => `El dispositivo en ${ip} responde, pero no acepta este token.`,
    vacuum: (model) =>
      `${model} es un robot aspirador: las integraciones Xiaomi Home, Roborock y Dreame del store los controlan.`,
    added: (model, ip) =>
      `${model} añadido (${ip}). Está en la pestaña Descubrimiento de la integración.`,
    noSpec: (model) =>
      `pero miot-spec.org no tiene especificación para ${model}: todavía no se puede traducir.`,
    forgotten: (name) =>
      `${name} se ha olvidado, con su token. Elimínelo también en Gladys si ya no lo utiliza.`,
    unknownDevice: 'Este dispositivo no es conocido por la integración.',
    diagnosisEmpty: 'Todavía no se conoce ningún dispositivo.',
    answers: 'responde',
    noAnswer: 'no responde',
    tokenRefused: 'token rechazado',
    specMissing: 'falta la especificación',
    features: (count) => `${count} función(es)`,
    ignored: (services) => `descartados: ${list(services)}`,
    unknownOnNetwork: (hosts) =>
      `Encontrados en la red, desconocidos para la integración (sin token): ${list(hosts)}.`,
    scanUnavailable:
      'El descubrimiento a través de Gladys no está disponible (Gladys 5.1 o posterior): las direcciones vienen de la cuenta Xiaomi o de usted.',
  },
};

/** One text in every language: `pick(table => table.key(...))`. */
export function localized(build) {
  return Object.fromEntries(
    LANGUAGES.map((language) => [language, build(ACTION_TEXT[language], language)]),
  );
}

/**
 * A thrown message reaches the screen as a plain string: the core cannot
 * localize it, the languages are joined.
 */
export function thrown(text) {
  return LANGUAGES.map((language) => text[language]).join(' / ');
}
