/*
 * IoT data usage estimator: the arithmetic behind netavo.com/tools/iot-data-usage-calculator.
 * Published as https://github.com/netavo-gds/iot-data-usage-calculator (MIT). Keep both copies
 * identical; the page and the repo's tests both load this file unchanged.
 *
 * Everything is counted in bytes on the wire as a mobile network meters it: whole IP packets in
 * both directions. Units are decimal (1 kB = 1,000 bytes, 1 MB = 1,000,000 bytes) and a month is
 * 30 days, so the arithmetic can be checked by hand. Every overhead is an input with a stated
 * default; the defaults are reasonable starting points to replace with measurements, not typical
 * figures for any particular device.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.IotDataEngine = factory();
    }
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    var DAY_SECONDS = 86400;
    var MONTH_DAYS = 30;

    // Header sizes in bytes. TCP assumes the timestamp option (20 + 12), which most stacks send.
    var IP_HEADER = { 4: 20, 6: 40 };
    var TCP_HEADER = 32;
    var UDP_HEADER = 8;

    // Bytes a security layer adds to each record it protects. TLS 1.3 with AES-GCM: 5-byte header,
    // 1-byte inner content type, 16-byte tag. DTLS 1.2 with AES-CCM-8: 13-byte header, 8-byte
    // explicit nonce, 8-byte tag.
    var RECORD_OVERHEAD = { none: 0, tls: 22, dtls: 29 };

    /**
     * Protocol presets. `request` is the application header added to each uplink message, `reply`
     * the application bytes that come back for it (0 means no reply), `setup` the application bytes
     * exchanged when a connection opens (MQTT CONNECT/CONNACK, for example). All editable.
     */
    var PROTOCOLS = {
        "mqtt-tls": { label: "MQTT over TLS", transport: "tcp", security: "tls", request: 36, reply: 4, setup: 90, keepalive: true },
        mqtt: { label: "MQTT (no TLS)", transport: "tcp", security: "none", request: 36, reply: 4, setup: 90, keepalive: true },
        https: { label: "HTTPS POST", transport: "tcp", security: "tls", request: 350, reply: 250, setup: 0, keepalive: false },
        http: { label: "HTTP POST (no TLS)", transport: "tcp", security: "none", request: 350, reply: 250, setup: 0, keepalive: false },
        "coap-dtls": { label: "CoAP over DTLS", transport: "udp", security: "dtls", request: 18, reply: 8, setup: 0, keepalive: false },
        udp: { label: "Raw UDP", transport: "udp", security: "none", request: 0, reply: 0, setup: 0, keepalive: false },
    };

    var DEFAULTS = {
        devices: 1,
        payloadBytes: 600,
        intervalMinutes: 5,
        protocol: "mqtt-tls",
        connection: "persistent", // "persistent" or "per-message"
        reconnectsPerDay: 1,
        keepaliveSeconds: 300, // MQTT only; 0 for none
        ipVersion: 4,
        handshakeBytes: 5000, // full TLS/DTLS handshake incl. certificate chain; ~1000 with resumption
        dnsLookupBytes: 100, // DNS query + response payload, before IP/UDP headers
        requestBytes: null, // null = protocol preset
        replyBytes: null,
        downlinkBytesPerDay: 0, // commands, configuration, acknowledgements you know about
        largeTransfersMB: 0, // firmware or file downloads in the month, counted in full
        sessionsPerDay: 1, // mobile data sessions (attaches / PDP contexts) per day
        billingIncrementKB: 0, // per-session rounding on your tariff, e.g. 1 for 1 kB
        marginPercent: 20,
    };

    function num(v, fallback) {
        var n = Number(v);
        return isFinite(n) && n >= 0 ? n : fallback;
    }

    function normalise(input) {
        var o = {};
        var src = input || {};
        Object.keys(DEFAULTS).forEach(function (k) {
            o[k] = src[k] === undefined || src[k] === "" ? DEFAULTS[k] : src[k];
        });
        if (!PROTOCOLS[o.protocol]) throw new Error("Unknown protocol: " + o.protocol);
        if (o.connection !== "persistent" && o.connection !== "per-message") {
            throw new Error("connection must be 'persistent' or 'per-message'");
        }
        if (o.ipVersion !== 4 && o.ipVersion !== 6 && o.ipVersion !== "4" && o.ipVersion !== "6") {
            throw new Error("ipVersion must be 4 or 6");
        }
        o.ipVersion = Number(o.ipVersion);
        o.intervalMinutes = num(o.intervalMinutes, DEFAULTS.intervalMinutes);
        if (o.intervalMinutes <= 0) throw new Error("intervalMinutes must be greater than 0");
        [
            "devices", "payloadBytes", "reconnectsPerDay", "keepaliveSeconds", "handshakeBytes",
            "dnsLookupBytes", "downlinkBytesPerDay", "largeTransfersMB", "sessionsPerDay",
            "billingIncrementKB", "marginPercent",
        ].forEach(function (k) {
            o[k] = num(o[k], DEFAULTS[k]);
        });
        var p = PROTOCOLS[o.protocol];
        o.requestBytes = o.requestBytes === null ? p.request : num(o.requestBytes, p.request);
        o.replyBytes = o.replyBytes === null ? p.reply : num(o.replyBytes, p.reply);
        return o;
    }

    /**
     * Estimate data usage. Returns per-device daily figures by component, per-device and fleet
     * monthly totals (with and without margin), and the payload's share of the traffic.
     */
    function estimate(input) {
        var o = normalise(input);
        var p = PROTOCOLS[o.protocol];
        var tcp = p.transport === "tcp";
        var ip = IP_HEADER[o.ipVersion];
        var hdr = ip + (tcp ? TCP_HEADER : UDP_HEADER);
        var rec = RECORD_OVERHEAD[p.security];

        var messagesPerDay = (DAY_SECONDS / 60) / o.intervalMinutes;

        // One message: the uplink packet, the reply if there is one, and on TCP one bare ACK (the
        // reply carries the ACK for the request; the device ACKs the reply, or the server ACKs the
        // request when nothing comes back).
        var uplink = hdr + rec + o.requestBytes + o.payloadBytes;
        var reply = o.replyBytes > 0 ? hdr + rec + o.replyBytes : 0;
        var ack = tcp ? hdr : 0;
        var perMessage = uplink + reply + ack;

        // Opening a connection: DNS lookup (two UDP packets), TCP handshake and close (3 + 4 bare
        // packets), the security handshake, and any application setup in one record each way.
        var connectionsPerDay = o.connection === "per-message" ? messagesPerDay : o.reconnectsPerDay;
        var dns = o.dnsLookupBytes > 0 ? 2 * (ip + UDP_HEADER) + o.dnsLookupBytes : 0;
        var tcpOpenClose = tcp ? 7 * hdr : 0;
        var handshake = p.security === "none" ? 0 : o.handshakeBytes;
        var setup = p.setup > 0 ? 2 * (hdr + rec) + p.setup + (tcp ? hdr : 0) : 0;
        var perConnection = dns + tcpOpenClose + handshake + setup;

        // MQTT keepalive: a PINGREQ/PINGRESP pair (2 bytes each) whenever a gap between messages is
        // longer than the keepalive interval, plus the ACK for the response.
        var pingsPerDay = 0;
        if (p.keepalive && o.connection === "persistent" && o.keepaliveSeconds > 0) {
            var gapSeconds = o.intervalMinutes * 60;
            pingsPerDay = messagesPerDay * Math.max(0, Math.ceil(gapSeconds / o.keepaliveSeconds) - 1);
        }
        var perPing = 2 * (hdr + rec + 2) + hdr;

        // Rounding up each data session to the tariff's billing increment wastes half an increment
        // on average.
        var roundingPerDay = o.sessionsPerDay * (o.billingIncrementKB * 1000) / 2;

        var daily = {
            payload: messagesPerDay * o.payloadBytes,
            messageOverhead: messagesPerDay * (perMessage - o.payloadBytes),
            connections: connectionsPerDay * perConnection,
            keepalives: pingsPerDay * perPing,
            downlink: o.downlinkBytesPerDay,
            billingRounding: roundingPerDay,
        };
        var dailyTotal = Object.keys(daily).reduce(function (s, k) { return s + daily[k]; }, 0);

        var largeTransfers = o.largeTransfersMB * 1e6;
        var monthBeforeMargin = dailyTotal * MONTH_DAYS + largeTransfers;
        var monthPerDevice = monthBeforeMargin * (1 + o.marginPercent / 100);

        return {
            inputs: o,
            protocolLabel: p.label,
            messagesPerDay: messagesPerDay,
            connectionsPerDay: connectionsPerDay,
            keepalivesPerDay: pingsPerDay,
            bytesPerMessage: perMessage,
            bytesPerConnection: perConnection,
            daily: daily,
            dailyTotal: dailyTotal,
            monthlyLargeTransfers: largeTransfers,
            monthPerDeviceBeforeMargin: monthBeforeMargin,
            monthPerDevice: monthPerDevice,
            monthFleet: monthPerDevice * o.devices,
            payloadShare: monthBeforeMargin > 0 ? (daily.payload * MONTH_DAYS) / monthBeforeMargin : 0,
        };
    }

    /** Format bytes in decimal units, e.g. 8640000 → "8.64 MB". */
    function formatBytes(bytes) {
        var units = ["bytes", "kB", "MB", "GB", "TB"];
        var i = 0;
        var v = bytes;
        while (v >= 1000 && i < units.length - 1) {
            v /= 1000;
            i++;
        }
        var digits = i === 0 ? 0 : v < 10 ? 2 : v < 100 ? 1 : 0;
        return v.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + " " + units[i];
    }

    return {
        PROTOCOLS: PROTOCOLS,
        DEFAULTS: DEFAULTS,
        MONTH_DAYS: MONTH_DAYS,
        estimate: estimate,
        formatBytes: formatBytes,
    };
});
