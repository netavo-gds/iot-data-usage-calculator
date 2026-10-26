const E = require('../iot-data-engine.js');
const assert = require('assert');
// Article example: 600 B every 5 min, 30 days → 5.184 MB payload.
let r = E.estimate({ protocol: 'udp', dnsLookupBytes: 0, marginPercent: 0, reconnectsPerDay: 0 });
assert.strictEqual(r.messagesPerDay, 288);
assert.strictEqual(r.daily.payload * 30, 5184000);
// raw UDP over IPv4: 28 bytes per message, no reply, no ACK
assert.strictEqual(r.bytesPerMessage, 628);
// MQTT TLS persistent default
r = E.estimate({});
console.log('default mqtt-tls', E.formatBytes(r.monthPerDevice), 'per msg', r.bytesPerMessage, 'pings', r.keepalivesPerDay, 'payload share', (r.payloadShare*100).toFixed(1)+'%');
// keepalive: 5-min interval with 300 s keepalive → no pings; 60 min interval → 11 pings per gap
assert.strictEqual(r.keepalivesPerDay, 0);
assert.strictEqual(E.estimate({ intervalMinutes: 60 }).keepalivesPerDay, 24 * 11);
// per-message HTTPS: a handshake per message dominates
const h = E.estimate({ protocol: 'https', connection: 'per-message' });
console.log('https per-message', E.formatBytes(h.monthPerDevice), 'payload share', (h.payloadShare*100).toFixed(1)+'%');
assert.ok(h.monthPerDevice > 5 * r.monthPerDevice);
// fleet, firmware, rounding
const f = E.estimate({ devices: 100, largeTransfersMB: 40, billingIncrementKB: 1, sessionsPerDay: 4, marginPercent: 0 });
assert.strictEqual(f.daily.billingRounding, 2000);
assert.ok(Math.abs(f.monthFleet - 100 * f.monthPerDevice) < 1e-6);
assert.strictEqual(E.formatBytes(8640000), '8.64 MB');
assert.throws(() => E.estimate({ intervalMinutes: 0 }));
assert.throws(() => E.estimate({ protocol: 'x' }));
console.log('all engine checks pass');
