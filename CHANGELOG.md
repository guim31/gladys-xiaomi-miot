# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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

[Unreleased]: https://github.com/guim31/gladys-xiaomi-miot/commits/main
