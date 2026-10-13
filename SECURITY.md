# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**:
  - the e-mail (or phone number) and the password of the Xiaomi account, in
    the configuration of the integration (a `secret` field, kept by Gladys);
    the password is only sent to `account.xiaomi.com`, as the MD5 hash the
    Mi Home app sends. The Xiaomi session (service token, `ssecurity`) lives
    in memory for the import only and is never stored;
  - the **device tokens**, 32 hexadecimal characters: whoever has one can
    drive the device on the local network.
- **Stored in `/data`**: `xiaomi-miot.json` (mode 0600), the devices known:
  device id, model, local IP address, token, Mi Home name, and the
  maintenance alerts in progress; `specs/`, the public MIoT specifications.
  Nothing is written anywhere else (the root filesystem is read only).
- **Logs**: no password, token, session cookie nor verification code, at any
  level (`test/logs.test.js` checks it).
- **Network**:
  - miIO datagrams on UDP port 54321, in unicast to the devices of the local
    network, encrypted with their token. The discovery broadcast (a miIO
    "hello", which carries no secret) is emitted by the Gladys core on the
    integration's behalf, on that port only (manifest `network_discovery`).
    The integration opens no listening port;
  - HTTPS to `account.xiaomi.com`, `sts.api.io.mi.com` and
    `<region>.api.io.mi.com` when the devices are imported (an action, or a
    change of the account details), and to `miot-spec.org` once per model.

Anyone on the local network who knows a device token can drive that device
the same way: this is how the miIO protocol works, not something the
integration adds. Keep the tokens as private as passwords.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the Xiaomi devices, app and cloud, and the other devices of your network.
