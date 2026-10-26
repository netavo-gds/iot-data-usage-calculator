// The IoT data usage calculator page: reads the form, runs IotDataEngine.estimate and shows the
// result. Recalculates on every input, so there is no submit. The arithmetic lives in
// iot-data-engine.js, shared with the open-source copy of the calculator.
(function () {
    "use strict";
    var E = window.IotDataEngine;
    var form = document.getElementById("iot-calc");
    if (!E || !form) return;

    var protocol = form.elements.protocol;
    Object.keys(E.PROTOCOLS).forEach(function (key) {
        var o = document.createElement("option");
        o.value = key;
        o.textContent = E.PROTOCOLS[key].label;
        protocol.appendChild(o);
    });

    // The application header and reply default to the chosen protocol's preset until edited.
    function applyPreset() {
        var p = E.PROTOCOLS[protocol.value];
        form.elements.requestBytes.value = p.request;
        form.elements.replyBytes.value = p.reply;
    }

    function read() {
        var input = {};
        Object.keys(E.DEFAULTS).forEach(function (k) {
            var el = form.elements[k];
            if (el) input[k] = el.type === "number" ? (el.value === "" ? "" : Number(el.value)) : el.value;
        });
        return input;
    }

    function toggle() {
        var persistent = form.elements.connection.value === "persistent";
        var keepalive = E.PROTOCOLS[protocol.value].keepalive && persistent;
        form.querySelector('[data-when="persistent"]').hidden = !persistent;
        form.querySelector('[data-when="keepalive"]').hidden = !keepalive;
    }

    var rows = [
        ["payload", "Your payload"],
        ["messageOverhead", "Headers and replies"],
        ["connections", "Connections and handshakes"],
        ["keepalives", "Keepalives"],
        ["downlink", "Other downlink"],
        ["billingRounding", "Tariff rounding"],
    ];

    function render() {
        toggle();
        var error = document.getElementById("r-error");
        var r;
        try {
            r = E.estimate(read());
            error.hidden = true;
        } catch (e) {
            error.textContent = e.message;
            error.hidden = false;
            return;
        }
        var f = E.formatBytes;
        var days = E.MONTH_DAYS;
        document.getElementById("r-month").textContent = f(r.monthPerDevice);
        document.getElementById("r-fleet").textContent =
            r.inputs.devices > 1
                ? f(r.monthFleet) + " across " + r.inputs.devices.toLocaleString("en-GB") + " devices"
                : "Including a " + r.inputs.marginPercent + "% margin";

        var body = document.getElementById("r-breakdown");
        body.textContent = "";
        rows.forEach(function (row) {
            var v = r.daily[row[0]] * days;
            if (v <= 0) return;
            var tr = body.insertRow();
            tr.insertCell().textContent = row[1];
            tr.insertCell().textContent = f(v);
        });
        if (r.monthlyLargeTransfers > 0) {
            var tr = body.insertRow();
            tr.insertCell().textContent = "Firmware and file downloads";
            tr.insertCell().textContent = f(r.monthlyLargeTransfers);
        }
        var m = body.insertRow();
        m.insertCell().textContent = "Margin (" + r.inputs.marginPercent + "%)";
        m.insertCell().textContent = f(r.monthPerDevice - r.monthPerDeviceBeforeMargin);

        document.getElementById("r-share").textContent =
            Math.round(r.messagesPerDay).toLocaleString("en-GB") + " messages a day of " +
            f(r.bytesPerMessage) + " each on the wire. Your payload is " +
            Math.round(r.payloadShare * 100) + "% of the traffic before margin.";
    }

    protocol.addEventListener("change", applyPreset);
    form.addEventListener("input", render);
    form.addEventListener("change", render);
    document.getElementById("iot-calc-reset").addEventListener("click", function () {
        form.reset();
        applyPreset();
        render();
    });

    applyPreset();
    render();
})();
