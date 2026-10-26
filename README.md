# IoT data usage calculator

Estimate how much mobile data an IoT device uses in a month, and what that means across a fleet.

Sizing a SIM tariff from the sensor payload alone undercounts, often badly. A mobile network meters
whole IP packets in both directions, so the bill also carries IP and TCP/UDP headers, TLS or DTLS
record overhead, protocol headers and replies, connection setup and security handshakes,
keepalives, reconnects and firmware downloads. This calculator adds those up.

- **Use it online:** <https://netavo.com/tools/iot-data-usage-calculator>
- **Use it locally:** open `index.html` in a browser. No build step, no dependencies, works offline.
- **Use it in code:** `iot-data-engine.js` works in the browser (`window.IotDataEngine`) and in Node.

```js
const { estimate, formatBytes } = require("./iot-data-engine.js");

const r = estimate({ payloadBytes: 600, intervalMinutes: 5, protocol: "mqtt-tls", devices: 250 });
formatBytes(r.monthPerDevice); // "8.92 MB"
formatBytes(r.monthFleet);     // "2.23 GB"
```

## What it counts

Units are decimal (1 kB = 1,000 bytes, 1 MB = 1,000,000 bytes) and a month is 30 days, so every
figure can be checked by hand.

| Component | How it is counted |
|---|---|
| Each message | payload + IP header (20 bytes IPv4, 40 IPv6) + TCP (32, with timestamps) or UDP (8) header + TLS 1.3 (22) or DTLS 1.2 CCM-8 (29) record overhead + protocol header; plus the reply (MQTT PUBACK, HTTP response, CoAP ACK) and, over TCP, one bare ACK |
| Each connection | DNS lookup (two UDP packets), TCP open and close (7 bare packets), the TLS/DTLS handshake, and protocol setup such as MQTT CONNECT/CONNACK |
| Connections per day | the reconnect count for a persistent connection, or one per message if the device connects each time |
| Keepalives | MQTT PINGREQ/PINGRESP whenever the gap between messages exceeds the keepalive interval |
| Downloads | firmware or file transfers in the month, added in full |
| Tariff rounding | half the per-session billing increment per data session, on average |
| Margin | a percentage on top of the whole month |

Protocol presets (`mqtt-tls`, `mqtt`, `https`, `http`, `coap-dtls`, `udp`) set the application header
and reply sizes; both can be overridden, as can the handshake size (default 5,000 bytes for a full
handshake with a certificate chain; session resumption is closer to 1,000).

**The defaults are starting points, not typical figures for any device.** Measure a representative
device (a packet capture, or the usage your SIM provider reports for a pilot) and replace the
assumptions before committing to a tariff. The worked method is in
[How to estimate IoT data usage](https://netavo.com/insights/iot-data-usage).

## Tests

```sh
node tests/engine.test.js
```

## About

Built by [Netavo](https://netavo.com/services/iot), which provides multi-network IoT SIMs on all four
UK networks with private access to customers' own systems.

## Licence

MIT, see [LICENSE](LICENSE).
