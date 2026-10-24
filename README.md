# Xiaomi MIoT for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for the
**Xiaomi / Mi Home / Mijia Wi-Fi devices**, driven on the local network:
air purifiers, humidifiers, dehumidifiers, fans, smart plugs and switches,
lights, air quality monitors and their sensors. Robot vacuums are left to
the Xiaomi Home, Roborock and Dreame integrations of the store.

> **Developed without the hardware: feedback welcome.** Everything was built
> and tested against real MIoT specifications and simulated devices, without
> a Xiaomi device nor a Xiaomi account. Please report what works and what
> does not in the [issues](https://github.com/guim31/gladys-xiaomi-miot/issues)
> or on the [Gladys forum](https://community.gladysassistant.com).

Not affiliated with Xiaomi. Xiaomi, Mi Home and Mijia are trademarks of their
owners.

## Features

- **Local control** over miIO (UDP port 54321, AES-128-CBC encrypted with the
  token of each device), one grouped `get_properties` per device every 30 s
  by default (15 s to 2 min). The older Yeelight lights, deaf to MIoT on the
  LAN, are read with `get_prop` and driven with their own methods
  (`src/miot/legacy.js`, after hass-xiaomi-miot's table).
- **No model coded by hand**: the public [MIoT specification](https://miot-spec.org)
  of each model is downloaded once and cached; its standard services are
  translated into Gladys features:

  | MIoT service                                   | Gladys features                                                                 |
  | ---------------------------------------------- | ------------------------------------------------------------------------------- |
  | air-purifier, humidifier, dehumidifier, fan    | power, mode (list), fan speed, fault, target humidity, water level, oscillation |
  | switch, outlet                                 | power (one per switch), power draw (W)                                          |
  | light                                          | on/off, brightness, colour temperature, colour                                  |
  | environment, air-monitor, temperature-humidity | temperature, humidity, PM2.5, PM10, CO2, illuminance                            |
  | filter, battery, physical-controls-locked      | filter life and time left, battery, child lock                                  |
  | heater                                         | power, setpoint, temperature — **read only**                                    |

  Everything else is listed by the diagnosis action and stays reachable with
  a scene action.

- **Tokens from the Xiaomi account**, once (Mi Home login, two-step
  verification by link and code), or typed by hand (IP address and token).
- **Mediated discovery**: a miIO hello broadcast sent by the Gladys core
  follows the devices that change address.
- **Dashboard widget** "Air quality": live air tiles, filter gauge, state,
  power and mode buttons.
- **Scene trigger** "Xiaomi device needs attention": filter at 10 %, empty
  water tank, fault — once per occurrence.
- **Scene action** "Set a MIoT property": any writable property by its
  `siid.piid` (buzzer, display, LED...).
- Four languages (English, French, German, Spanish) for the feature names,
  the messages and the documentation.

## Requirements

- Gladys Assistant **5.1.0** or later.
- Xiaomi Wi-Fi devices set up in the Mi Home app, on the same network as
  Gladys; the Mi Home account (and its region) or each device's token.
- Internet access at setup (Xiaomi account, miot-spec.org).

## Installation

In Gladys: **Integrations → Install from GitHub**, with
`https://github.com/guim31/gladys-xiaomi-miot`. Then open the
**Configuration**, fill in the account and save: the devices are imported
and appear in the **Discover** tab. The full guide is in
[`docs/en.md`](docs/en.md) ([fr](docs/fr.md), [de](docs/de.md),
[es](docs/es.md)).

## How it works

```
Xiaomi account (once) ──► did, model, local IP, token ──► /data/xiaomi-miot.json (0600)
miot-spec.org (once/model) ──► specification ──► /data/specs/<model>.json
                                     │
                         translation (src/miot/translate.js)
                                     │
Gladys ◄── devices, states ── hub ── miIO UDP 54321 ──► the devices on the LAN
       ◄── hello replies ──── core broadcast (udp-active-broadcast, port 54321)
```

- `src/miio/`: the packet format (MD5-derived AES key and IV, checksum) and
  the UDP exchanges (hello, stamp, retries, one request at a time).
- `src/miot/`: specifications, translation, value labels, per-model quirks
  (the few that hass-xiaomi-miot documents and that change what is read).
- `src/cloud/`: the Mi Home login and the RC4-signed device list.
- `src/hub.js`: discovery, polling timer (the core's `onPoll` is a fallback,
  see GladysAssistant/Gladys#3198), states, commands, trigger, actions.

## Checked, and what was not

Checked in this repository (`npm test`, about a hundred tests): the packet format
against packets built by hand, the RC4 signatures against the Python
reference, the login and two-step verification flows against a fake account
following the real answers, the translation of 14 real specifications, every
published device against the feature table of the Gladys core, the widget
against `validateWidgetContent`, quiet logs and no secret in them.

Not checked (no hardware, no account, no network to Xiaomi from the
development session): a real device on a real LAN, the real Xiaomi login
(captcha and verification pages change), the real miot-spec.org answers.
`scripts/probe.mjs` exercises all three, read only, from a machine with the
network:

```bash
XIAOMI_USERNAME=... XIAOMI_PASSWORD=... XIAOMI_REGION=de PROBE_LOCAL=1 node scripts/probe.mjs
```

It prints models, counts and features, never a password, a token or an
address.

## Limitations

- Wi-Fi devices only: Bluetooth and Zigbee devices behind a Xiaomi gateway
  have no address of their own.
- Air conditioners, thermostats, kitchen appliances and other kinds are not
  translated yet.
- Polling only (miIO pushes nothing on the LAN): a change made in Mi Home
  shows up at the next reading.
- A heater is never driven from Gladys (safety): shown only.
- Old miIO-only models (before MIoT) have no specification and are not
  supported. Those that have one but ignore the MIoT requests are said
  "older miIO protocol only" by the diagnosis, except the Yeelight lights
  (above).

## Development

```bash
npm install
npm test
npm run lint
npm run format:check
```

Rules for contributors and coding assistants are in [`CLAUDE.md`](CLAUDE.md).

## Credits

- [hass-xiaomi-miot](https://github.com/al-one/hass-xiaomi-miot) (Apache
  License 2.0, © al-one and contributors): the Xiaomi account login and
  two-step verification, the RC4 API signatures, the MIoT-to-entities
  approach, the per-model quirks, and a specification used as fixture.
- [homebridge-miot](https://github.com/merdok/homebridge-miot) (MIT License,
  © merdok): the MIoT specifications of 13 models used as test fixtures.
- [python-miio](https://github.com/rytilahti/python-miio) (GPL-3.0): read to
  understand the miIO protocol; no code copied.
- [miot-spec.org](https://miot-spec.org): the public MIoT specifications.
- Built from the official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js).

## Disclaimer

This project is not affiliated with, endorsed by or connected to Xiaomi. Use
your Xiaomi account at your own risk: the login reproduces the one of the
Mi Home app.

## License

[Apache License 2.0](LICENSE)
