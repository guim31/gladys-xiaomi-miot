# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.2] - 2026-10-24

### Fixed

- The older Yeelight lights (bulbs such as `yeelink.light.color5`, strips,
  ceiling and bedside lamps) went "unreachable" at once: they ignore the MIoT
  requests on the LAN and only speak the older miIO protocol. They are now
  read with `get_prop` and driven with their own methods: on/off,
  brightness, colour temperature, colour (#6).
- A device that ignores the MIoT requests but answers with its token is no
  longer said to refuse its token: the logs and the diagnosis say "older miIO
  protocol only, not supported yet" instead of asking for an import that
  changes nothing.

## [1.0.1] - 2026-10-13

### Added

- Local control of the Xiaomi, Mi Home and Mijia Wi-Fi devices over miIO:
  air purifiers, humidifiers, dehumidifiers, fans, smart plugs and switches,
  lights, air quality monitors and their sensors. One Gladys device per
  Xiaomi device.
- The public MIoT specification of each model is downloaded once from
  miot-spec.org and its standard services are translated into Gladys
  features: power, mode, fan speed, oscillation, target humidity, water
  level, fault, temperature, humidity, PM2.5, PM10, CO2, filter life, battery,
  child lock, power draw, brightness, colour temperature, colour. A heater is
  shown, never driven.
- The devices and their tokens are imported from the Xiaomi account (two-step
  verification included), or added by IP address and token. Robot vacuums,
  Bluetooth and Zigbee devices are left out.
- The devices are read every 30 seconds by default (15 s to 2 min), and
  found again by a discovery broadcast through Gladys when their address
  changes.
- An "Air quality" dashboard widget, a "Xiaomi device needs attention" scene
  trigger (filter to replace, water tank empty, fault), a "Set a MIoT
  property" scene action, and a diagnosis action.
- Feature names, messages and documentation in English, French, German and
  Spanish.

[Unreleased]: https://github.com/guim31/gladys-xiaomi-miot/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/guim31/gladys-xiaomi-miot/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/guim31/gladys-xiaomi-miot/releases/tag/v1.0.1
