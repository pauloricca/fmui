"use strict";
const MidiUI = (() => {
  const P = MidiProtocol;
  YS200Profile.midi.voiceCodec = YS200Codec;
  DX7Profile.midi.voiceCodec = DX7Midi;
  const settings = {
    ys200: { input: "", output: "", tx: 1, rx: 1 },
    dx7: { input: "", output: "", tx: 1, rx: 1 },
  };
  const audition = {note: 60, velocity: 100, program: 1, mod: 0, breath: 0, foot: 0, volume: 100, pressure: 0, bend: 8192, sustain: false};
  const banks = new Map(),
    functionsState = { dx7: {}, ys200: {} };
  let last = structuredClone(shown()),
    engine = synth.id,
    suppress = false,
    pending = [],
    pendingChannel = null,
    pendingTimer = null,
    receiveTimer = null,
    receiveArmed = false;
  const config = () => settings[synth.id],
    codec = () => synth.midi.voiceCodec;
  const notify = (text) => {
    const el = $("#midi-status");
    if (el) el.textContent = text;
    $("#status").textContent = text;
  };
  const transport = new MidiTransport({
    onMessage: receive,
    onStatus: (text) => {
      notify(text);
    },
    onPorts: () => {
      if (
        transport.input?.state === "disconnected" ||
        transport.output?.state === "disconnected"
      ) {
        receiveArmed = false;
        pending = [];
        clearTimeout(receiveTimer);
        clearTimeout(pendingTimer);
      }
      refreshPorts();
    },
  });
  const safe =
    (fn) =>
    async (...args) => {
      try {
        return await fn(...args);
      } catch (e) {
        notify(e.message);
      }
    };
  function current() {
    const v = structuredClone(shown());
    if (synth.effects) v.effects = EffectsUI.getState();
    return v;
  }
  function reset() {
    transport.cancel();
    clearTimeout(pendingTimer);
    clearTimeout(receiveTimer);
    pending = [];
    pendingChannel = null;
    receiveArmed = false;
    last = current();
  }
  function changed() {
    if (suppress) return;
    if (engine !== synth.id) {
      reset();
      engine = synth.id;
      if (transport.access)
        safe(() => transport.select(config().input, config().output))();
      last = current();
      return;
    }
    const v = current();
    if (transport.output && transport.output.state !== "disconnected") {
      try {
        const messages = [];
        const a =
            synth.id === "dx7"
              ? { vced: Array.from(DX7Codec.encode(last)) }
              : YS200Codec.encode(last),
          b =
            synth.id === "dx7"
              ? { vced: Array.from(DX7Codec.encode(v)) }
              : YS200Codec.encode(v);
        for (const k of Object.keys(b)) {
          b[k].forEach((value, i) => {
            if (value === a[k][i]) return;
            let group, address;
            if (synth.id === "dx7") {
              group = i >> 7;
              address = i & 127;
            } else {
              group = k === "vced" ? 18 : k === "effects" ? 36 : 19;
              address = i + (k === "aced2" ? 23 : k === "effects" ? 4 : 0);
            }
            messages.push(P.parameter(group, address, value, config().tx));
          });
        }
        if (v.operators.some((o, i) => o.on !== last.operators[i].on))
          messages.push(codec().parameter(v, "on", 0, config().tx));
        for (const m of messages)
          transport.enqueue([m], { key: m[3] + ":" + m[4] });
      } catch (e) {
        notify(e.message);
      }
    }
    last = v;
  }
  function load(v, fromMidi = false) {
    reset();
    suppress = true;
    try {
      remember(true);
      voice = structuredClone(v);
      initial = structuredClone(v);
      comparing = false;
      selected = 0;
      if (synth.effects)
        EffectsUI.setState(v.effects || { preset: 0, time: 20, balance: 50 });
      render();
      last = current();
    } finally {
      suppress = false;
    }
    if (transport.output && transport.output.state !== "disconnected" && !fromMidi) sendVoice();
    notify(synth.shortName + " VOICE RECEIVED / IMPORTED · ⌘Z TO RESTORE");
  }
  function arm(bank = false) {
    if (!transport.input) throw Error("Select a MIDI input first.");
    if (transport.input.state === "disconnected")
      throw Error("MIDI input is disconnected.");
    clearTimeout(pendingTimer);
    clearTimeout(receiveTimer);
    pending = [];
    pendingChannel = null;
    receiveArmed = false;
    if (
      synth.id === "ys200" &&
      transport.output &&
      transport.output.state !== "disconnected"
    ) {
      transport.enqueue([YS200Codec.request(config().tx, bank)]);
      notify("Waiting for YS200 " + (bank ? "bank" : "voice") + "…");
    } else
      notify(
        "Listening: send " +
          (bank ? "a bank" : "the voice") +
          " from the " +
          synth.shortName +
          " front-panel MIDI bulk dump function.",
      );
    receiveArmed = true;
    receiveTimer = setTimeout(() => {
      receiveArmed = false;
      pending = [];
      notify(
        "No complete dump received. Check MIDI IN, receive channel and synth SysEx settings; press RECEIVE to retry.",
      );
    }, 30000);
  }
  function receive(message) {
    if (message[0] !== 240) return;
    try {
      const ch = (message[2] & 15) + 1;
      if (ch !== config().rx || message[1] !== 67) return;
      if (message[2] >= 16 && message[2] <= 31) {
        const p = P.readParameter(message);
        if (synth.id === "dx7" && p.group === 8) {
          const spec = dxFunctions.find((s) => s[1] === p.address);
          if (!spec || p.value > spec[2])
            throw Error("Invalid DX7 function parameter");
          functionsState.dx7[p.address] = p.value;
          return;
        }
        const next = codec().apply(
          synth.effects ? { ...voice, effects: EffectsUI.getState() } : voice,
          message,
        );
        // A hardware edit supersedes any unsent local edit of that address.
        transport.queue = transport.queue.filter(
          (job) => job.key !== p.group + ":" + p.address,
        );
        suppress = true;
        try {
          remember(!!next.effects);
          voice = next;
          comparing = false;
          if (next.effects && synth.effects)
            EffectsUI.setState(next.effects, false);
          render();
          last = current();
        } finally {
          suppress = false;
        }
        notify("MIDI PARAMETER RECEIVED");
        return;
      }
      if (!receiveArmed) return;
      P.read(message);
      if (synth.id === "ys200" && message[3] === 126) {
        if (pendingChannel !== null && pendingChannel !== ch) pending = [];
        pendingChannel = ch;
        if (pending.length >= 3) throw Error("Too many YS200 extension blocks");
        pending.push(message);
        clearTimeout(pendingTimer);
        pendingTimer = setTimeout(() => {
          pending = [];
          pendingChannel = null;
          receiveArmed = false;
          clearTimeout(receiveTimer);
          notify(
            "Incomplete YS200 extension sequence discarded. Retry RECEIVE.",
          );
        }, 3000);
        return;
      }
      const data = Uint8Array.from(
        [...pending, message].flatMap((m) => Array.from(m)),
      );
      const result = codec().parse(data);
      clearTimeout(receiveTimer);
      clearTimeout(pendingTimer);
      receiveArmed = false;
      pending = [];
      if (result.voices.length === 1) load(result.voices[0], true);
      else {
        banks.set(synth.id, result.voices);
        openDialog("file");
        showBank();
        notify(
          result.voices.length +
            " voices received. Choose one in the file menu.",
        );
      }
    } catch (e) {
      pending = [];
      pendingChannel = null;
      receiveArmed = false;
      clearTimeout(receiveTimer);
      clearTimeout(pendingTimer);
      notify("MIDI receive: " + e.message);
    }
  }
  function sendVoice() {
    transport.enqueue(
      P.split(codec().bulk(current(), config().tx)).concat([
        codec().parameter(current(), "on", 0, config().tx),
      ]),
    );
    notify("Voice queued for MIDI output; store it on the synth to retain it.");
    last = current();
  }
  function refreshPorts() {
    for (const [id, ports, k] of [
      ["midi-input", transport.access?.inputs, "input"],
      ["midi-output", transport.access?.outputs, "output"],
    ]) {
      const el = $("#" + id);
      if (!el) continue;
      el.replaceChildren();
      const none = document.createElement("option");
      none.value = "";
      none.textContent = "None";
      el.append(none);
      for (const port of ports?.values() || []) {
        const option = document.createElement("option");
        option.value = port.id;
        option.textContent =
          port.name + (port.state === "disconnected" ? " (disconnected)" : "");
        el.append(option);
      }
      el.value = config()[k];
    }
    if (typeof RetroSelect !== "undefined") RetroSelect.enhance(document);
  }
  const button = (id, label) =>
    `<button type="button" id="${id}">${label}</button>`;
  const channelOptions = Array.from(
    { length: 16 },
    (_, i) => `<option value="${i + 1}">${i + 1}</option>`,
  ).join("");
  function dialog() {
    return `<p>MIDI runs in your browser. Choose the interface connected to your ${synth.shortName}.</p>${button("midi-connect", "ENABLE MIDI / SYSEX")}<div class="midi-fields"><label>MIDI INPUT <select id="midi-input"></select></label><label>MIDI OUTPUT <select id="midi-output"></select></label><label>SEND CHANNEL <select id="midi-tx">${channelOptions}</select></label><label>RECEIVE CHANNEL <select id="midi-rx">${channelOptions}</select></label></div><p>Edits are sent automatically to the connected MIDI output.</p><p>${button("midi-send", "SEND VOICE")} ${button("midi-receive", "RECEIVE VOICE")} ${button("midi-bank", "RECEIVE BANK")} ${button("midi-cancel", "CANCEL TRANSFER")}</p><p>${synth.id === "dx7" ? "Original DX7: receive channel defaults to 1. Enable SYS INFO on the synth. Receive listens for a front-panel dump." : "YS200: use the matching device channels and enable exclusive reception. Receive requests effects and all voice blocks."}</p><fieldset><legend>HARDWARE AUDITION</legend><label>NOTE <input id="midi-note" type="number" min="1" max="127" value="60"></label><label>VELOCITY <input id="midi-velocity" type="number" min="1" max="127" value="100"></label>${button("midi-test", "PLAY 1 SECOND")} ${button("midi-panic", "PANIC")}<label>PROGRAM (1–128) <input id="midi-program" type="number" min="1" max="128" value="1"></label>${button("midi-program-send", "SELECT PROGRAM")}<label>MOD WHEEL <input id="midi-mod" type="range" min="0" max="127" value="0"></label><label>BREATH <input id="midi-breath" type="range" min="0" max="127" value="0"></label><label>FOOT <input id="midi-foot" type="range" min="0" max="127" value="0"></label><label>VOLUME <input id="midi-volume" type="range" min="0" max="127" value="100"></label><label>PRESSURE <input id="midi-pressure" type="range" min="0" max="127" value="0"></label><label>PITCH BEND <input id="midi-bend" type="range" min="0" max="16383" value="8192"></label><label><input id="midi-sustain" type="checkbox"> SUSTAIN</label></fieldset><p id="midi-status" role="status"></p>`;
  }
  function setup() {
    refreshPorts();
    for (const [key, value] of Object.entries(audition)) {
      const el = $('#midi-' + key);
      if (key === 'sustain') el.checked = value;
      else el.value = value;
      el.addEventListener?.('input', () => {audition[key] = key === 'sustain' ? el.checked : Number(el.value);});
    }
    $("#midi-connect").onclick = safe(async () => {
      await transport.connect();
      await transport.select(config().input, config().output);
      notify("MIDI enabled. Select your input and output.");
    });
    for (const k of ["input", "output"])
      $("#midi-" + k).onchange = safe(async (e) => {
        reset();
        config()[k] = e.target.value;
        await transport.select(config().input, config().output);
      });
    for (const k of ["tx", "rx"]) {
      const el = $("#midi-" + k);
      el.value = config()[k];
      el.onchange = () => {
        reset();
        config()[k] = Number(el.value);
      };
    }
    $("#midi-send").onclick = safe(sendVoice);
    $("#midi-receive").onclick = safe(() => arm());
    $("#midi-bank").onclick = safe(() => arm(true));
    $("#midi-cancel").onclick = () => {
      reset();
      notify("Transfer cancelled.");
    };
    $("#midi-panic").onclick = () => {
      transport.cancel();
      transport.panic();
    };
    $("#midi-test").onclick = safe(() => {
      const n = Number($("#midi-note").value),
        v = Number($("#midi-velocity").value),
        c = config().tx;
      if (
        !Number.isInteger(n) ||
        n < 1 ||
        n > 127 ||
        !Number.isInteger(v) ||
        v < 1 ||
        v > 127
      )
        throw Error("Note and velocity must be 1–127");
      const output = transport.output,
        generation = transport.generation;
      transport.noteOn(n, v, c);
      setTimeout(
        safe(() => {
          if (
            transport.output === output &&
            transport.generation === generation
          )
            transport.noteOff(n, c);
        }),
        1000,
      );
    });
    $("#midi-program-send").onclick = safe(() => {
      const p = Number($("#midi-program").value);
      if (!Number.isInteger(p) || p < 1 || p > 128)
        throw Error("Program must be 1–128");
      reset();
      transport.message(192, [p - 1], config().tx);
    });
    for (const [id, cc] of [
      ["mod", 1],
      ["breath", 2],
      ["foot", 4],
      ["volume", 7],
    ])
      $("#midi-" + id).oninput = safe((e) =>
        transport.message(176, [cc, Number(e.target.value)], config().tx),
      );
    $("#midi-pressure").oninput = safe((e) =>
      transport.message(208, [Number(e.target.value)], config().tx),
    );
    $("#midi-bend").oninput = safe((e) => {
      const n = Number(e.target.value);
      transport.message(224, [n & 127, n >> 7], config().tx);
    });
    $("#midi-bend").onchange = safe((e) => {
      e.target.value = 8192;
      transport.message(224, [0, 64], config().tx);
    });
    $("#midi-sustain").onchange = safe((e) =>
      transport.message(176, [64, e.target.checked ? 127 : 0], config().tx),
    );
  }
  const fileHtml = `<p>Import native voice or bank SysEx; select a bank slot to edit. Effects travel with YS200 voices.</p><p>${button("save-json", "SAVE JSON")} ${button("save-syx", "SAVE VOICE .SYX")}</p><label>SYSEX CHANNEL <select id="syx-channel">${channelOptions}</select></label><p><label>OPEN .SYX / .JSON <input id="load-syx" type="file" accept=".syx,.json"></label></p><p>${button("bank-new", "NEW BANK FROM CURRENT VOICE")} ${button("bank-save", "SAVE BANK .SYX")}</p><label><input id="bank-confirm" type="checkbox"> Replace the connected synth’s 32-voice bank</label> ${button("bank-send", "SEND BANK")}<div id="bank-voices"></div><p id="file-result" role="status"></p>`;
  function showBank() {
    const bank = banks.get(synth.id) || [];
    $("#bank-save").disabled = bank.length !== 32;
    $("#bank-send").disabled = bank.length !== 32;
    $("#bank-voices").replaceChildren(
      ...bank.map((v, i) => {
        const row = document.createElement("div"),
          b = document.createElement("button"),
          replace = document.createElement("button");
        b.type = replace.type = "button";
        b.textContent = i + 1 + ". " + v.name;
        b.onclick = () => {
          load(v);
          $("#dialog").close();
        };
        replace.textContent = "REPLACE WITH EDIT";
        replace.onclick = () => {
          bank[i] = current();
          showBank();
        };
        row.append(b, replace);
        return row;
      }),
    );
  }
  function files() {
    const profile = synth;
    $("#syx-channel").value = config().tx;
    $("#save-syx").onclick = safe(() => {
      downloadVoice(
        codec().bulk(current(), Number($("#syx-channel").value)),
        ".syx",
      );
      $("#file-result").textContent =
        "Voice saved. Operator switches are temporary; JSON retains them.";
    });
    $("#load-syx").onchange = async (e) => {
      try {
        const f = e.target.files[0];
        if (!f) return;
        const bytes = new Uint8Array(await f.arrayBuffer());
        if (profile !== synth) return;
        if (/\.json$/i.test(f.name)) {
          const snapshot = JSON.parse(new TextDecoder().decode(bytes));
          if (
            snapshot.format !== "fm-editor-voice" ||
            snapshot.version !== 1 ||
            snapshot.synthId !== synth.id
          )
            throw Error(
              "Open a version 1 JSON snapshot for the selected synth.",
            );
          const v = snapshot.voice;
          if (synth.id === "dx7") DX7.validate(v);
          else YS200Codec.encode(v);
          load(v);
          $("#dialog").close();
          return;
        }
        const messages = P.split(bytes);
        if (
          synth.id === "ys200" &&
          messages.length === 1 &&
          messages[0][3] === 126
        ) {
          const { effects } = Effects.parse(messages[0]);
          remember(true);
          EffectsUI.setState(effects);
          changed();
          notify("YS200 EFFECTS IMPORTED · ⌘Z TO RESTORE");
          $("#dialog").close();
          return;
        }
        const r = codec().parse(bytes);
        if (r.voices.length === 1) {
          load(r.voices[0]);
          $("#dialog").close();
        } else {
          if (r.voices.length !== 32)
            throw Error(
              "Select a file containing exactly 32 voices for bank editing.",
            );
          banks.set(synth.id, r.voices);
          showBank();
          $("#file-result").textContent = "Bank validated. Select a voice.";
        }
      } catch (e) {
        $("#file-result").textContent = e.message;
      }
    };
    $("#bank-new").onclick = () => {
      banks.set(
        synth.id,
        Array.from({ length: 32 }, () => current()),
      );
      showBank();
    };
    $("#bank-save").onclick = safe(() =>
      downloadVoice(
        codec().bulk(banks.get(synth.id), Number($("#syx-channel").value)),
        ".syx",
      ),
    );
    $("#bank-send").onclick = safe(() => {
      if (!$("#bank-confirm").checked)
        throw Error("Check the bank replacement box before sending.");
      transport.enqueue(
        P.split(codec().bulk(banks.get(synth.id), config().tx)),
      );
      $("#bank-confirm").checked = false;
      notify("32-voice bank queued for transmission.");
    });
    showBank();
  }
  const dxFunctions = [
    ["Mono / poly", 64, 1],
    ["Pitch bend range", 65, 12],
    ["Pitch bend step", 66, 12],
    ["Portamento mode", 67, 1],
    ["Glissando", 68, 1],
    ["Portamento time", 69, 99],
    ["Mod wheel range", 70, 99],
    ["Mod wheel assignment", 71, 7],
    ["Foot range", 72, 99],
    ["Foot assignment", 73, 7],
    ["Breath range", 74, 99],
    ["Breath assignment", 75, 7],
    ["Aftertouch range", 76, 99],
    ["Aftertouch assignment", 77, 7],
  ];
  const ysFunctions = [
    ["Pitch bend range", "vced", 64, 12],
    ["Portamento mode", "vced", 65, 1],
    ["Foot volume", "vced", 67, 99],
    ["Mod wheel pitch", "vced", 71, 99],
    ["Mod wheel amplitude", "vced", 72, 99],
    ["Breath pitch", "vced", 73, 99],
    ["Breath amplitude", "vced", 74, 99],
    ["Breath pitch bias (50 neutral)", "vced", 75, 100],
    ["Breath envelope bias", "vced", 76, 99],
    ["Foot pitch", "aced", 21, 99],
    ["Foot amplitude", "aced", 22, 99],
    ["Aftertouch pitch", "aced2", 0, 99],
    ["Aftertouch amplitude", "aced2", 1, 99],
    ["Aftertouch pitch bias (50 neutral)", "aced2", 2, 100],
    ["Aftertouch envelope bias", "aced2", 3, 99],
  ];
  function controlPanel() {
    const host = $("#dialog-content");
    $("#dialog-title").textContent = synth.shortName + " CONFIG";
    host.innerHTML =
      synth.id === "dx7"
        ? "<p>Changes send immediately. These settings are separate from voice files. Settings marked Not received have not been read from the synth.</p>"
        : "<p>Enable destinations and set their amounts. Multiple destinations can be active. New assignments start at 1. These settings are stored with the voice; enable Live Edit or use SEND VOICE to transmit changes.</p>";
    const list = synth.id === "dx7" ? dxFunctions : ysFunctions;
    const controllerGroups = new Map();
    for (const spec of list) {
      const assignmentLabels = [
        "None",
        "Pitch",
        "Amplitude",
        "Pitch + Amplitude",
        "Envelope bias",
        "Pitch + Envelope bias",
        "Amplitude + Envelope bias",
        "Pitch + Amplitude + Envelope bias",
      ];
      const choices = spec[0].endsWith("assignment")
        ? assignmentLabels
        : spec[0] === "Mono / poly"
          ? ["Polyphonic", "Monophonic"]
          : spec[0] === "Glissando"
            ? ["Off", "On"]
            : spec[0] === "Portamento mode"
              ? synth.id === "dx7"
                ? ["Retain", "Follow"]
                : ["Full-time", "Fingered (legato)"]
              : spec[0] === "Pitch bend range"
                ? Array.from({ length: 13 }, (_, n) =>
                    n === 0
                      ? "Off"
                      : n + (n === 1 ? " semitone" : " semitones"),
                  )
                : spec[0] === "Pitch bend step"
                  ? Array.from({ length: 13 }, (_, n) =>
                      n === 0
                        ? "Continuous"
                        : n + (n === 1 ? " semitone" : " semitones"),
                    )
                  : null;
      const label = document.createElement("label"),
        input = document.createElement(choices ? "select" : "input");
      label.textContent = spec[0] + " ";
      input.setAttribute("aria-label", spec[0]);
      input.disabled = comparing;
      if (choices) {
        if (synth.id === "dx7") {
          const unknown = document.createElement("option");
          unknown.value = "";
          unknown.textContent = "Not received";
          unknown.disabled = true;
          input.append(unknown);
        }
        choices.forEach((text, value) => {
          const option = document.createElement("option");
          option.value = String(value);
          option.textContent = text;
          input.append(option);
        });
      } else {
        input.type = "number";
        input.min = 0;
        input.max = spec.at(-1);
      }
      if (synth.id === "dx7") {
        input.placeholder = "Unknown";
        input.value = functionsState.dx7[spec[1]] ?? "";
      } else input.value = YS200Codec.encode(current())[spec[1]][spec[2]];
      input.onchange = safe(() => {
        const value = Number(input.value);
        if (
          input.value === "" ||
          !Number.isInteger(value) ||
          value < 0 ||
          value > spec.at(-1)
        )
          throw Error("Invalid " + spec[0]);
        if (synth.id === "dx7") {
          transport.enqueue([P.parameter(8, spec[1], value, config().tx)]);
          functionsState.dx7[spec[1]] = value;
        } else {
          remember();
          const b = YS200Codec.encode(voice);
          b[spec[1]][spec[2]] = value;
          const next = YS200Codec.decode(b.vced, b);
          next.operators.forEach((o, i) => (o.on = voice.operators[i].on));
          if (voice.sysex?.packed)
            next.sysex.packed = structuredClone(voice.sysex.packed);
          voice = next;
          render();
          changed();
        }
        notify(spec[0] + " updated");
      });
      label.append(input);
      const controller =
        synth.id === "ys200" &&
        ["Mod wheel", "Foot", "Breath", "Aftertouch"].find((name) =>
          spec[0].startsWith(name + " "),
        );
      if (controller) {
        if (!controllerGroups.has(controller)) {
          const group = document.createElement("fieldset");
          group.className = "controller-assignments";
          const legend = document.createElement("legend");
          legend.textContent = controller + " assignments";
          group.append(legend);
          controllerGroups.set(controller, group);
          host.append(group);
        }
        const group = controllerGroups.get(controller);
        if (!spec[0].includes("pitch bias")) {
          const row = document.createElement("div");
          row.className = "assignment-route";
          const toggleLabel = document.createElement("label");
          const toggle = document.createElement("input");
          toggle.type = "checkbox";
          toggle.id = "config-" + spec[1] + "-" + spec[2] + "-enabled";
          toggle.setAttribute("aria-label", spec[0] + " assignment");
          toggle.checked = Number(input.value) !== 0;
          toggle.disabled = comparing;
          let rememberedAmount = Number(input.value) || 1;
          const text = document.createElement("span");
          text.textContent = spec[0].slice(controller.length + 1);
          toggleLabel.append(toggle, text);
          label.textContent = "Amount";
          label.append(input);
          input.disabled = comparing || !toggle.checked;
          const setAmount = input.onchange;
          input.onchange = async () => {
            await setAmount();
            toggle.checked = Number(input.value) !== 0;
            if (toggle.checked) rememberedAmount = Number(input.value);
            input.disabled = comparing || !toggle.checked;
          };
          toggle.onchange = async () => {
            if (comparing) return;
            input.value = String(toggle.checked ? rememberedAmount : 0);
            await input.onchange();
          };
          row.append(toggleLabel, label);
          group.append(row);
        } else group.append(label);
      } else host.append(label);
    }
    host.classList.add("midi-fields");
  }
  for (const profile of [YS200Profile, DX7Profile]) {
    profile.dialogs.file = [
      profile.shortName + " VOICE / BANK FILES",
      fileHtml,
    ];
    profile.dialogs.midi = [profile.shortName + " MIDI", ""];
    profile.dialogs.about[1] = profile.dialogs.about[1]
      .replace(
        /This is a local interface prototype; MIDI and sound synthesis are not connected\./,
        "Browser MIDI and SysEx editing are available. Audio comes from your connected synthesizer.",
      )
      .replace(
        "Audio synthesis and live MIDI transport are not connected.",
        "Live MIDI is available through the MIDI connection panel.",
      );
  }
  const originalDialog = openDialog;
  openDialog = function (type) {
    if ($("#dialog").open) $("#dialog").close();
    $("#dialog-content").classList.remove("midi-fields");
    if (type === "midi") synth.dialogs.midi[1] = dialog();
    originalDialog(type);
    if (type === "file")
      $("#save-json").onclick = () =>
        downloadVoice(
          JSON.stringify(Synths.snapshot(synth, current()), null, 2),
          ".json",
        );
    if (type === "midi") setup();
    if (type === "control") controlPanel();
    if (typeof RetroSelect !== "undefined") RetroSelect.enhance(document);
  };
  setupVoiceFiles = files;
  $("#receive").onclick = safe(() => {
    if (!transport.input) {
      openDialog("midi");
      return;
    }
    arm();
  });
  $("#transmit").onclick = safe(() => {
    if (!transport.output) {
      openDialog("midi");
      return;
    }
    sendVoice();
  });
  $("#midi-settings").onclick = () => openDialog("midi");
  $("#device-controls").onclick = () => openDialog("control");
  window.addEventListener("blur", () => transport.panic());
  window.addEventListener("pagehide", () => {
    transport.cancel();
    transport.panic();
  });
  if (typeof RetroSelect !== "undefined") RetroSelect.enhance(document);
  return {
    snapshot: () => structuredClone({settings, banks: Array.from(banks), functionsState, audition}),
    restore(saved) {
      if (!saved || typeof SessionStorage === 'undefined') return;
      Object.assign(settings, SessionStorage.merge(settings, saved.settings));
      Object.assign(audition, SessionStorage.merge(audition, saved.audition));
      for (const cfg of Object.values(settings)) {
        for (const key of ['tx', 'rx']) if (!Number.isInteger(cfg[key]) || cfg[key] < 1 || cfg[key] > 16) cfg[key] = 1;
      }
      for (const id of ['ys200', 'dx7']) {
        const values = saved.functionsState?.[id];
        if (values && typeof values === 'object') for (const [key, value] of Object.entries(values))
          if (/^\d+$/.test(key) && Number.isInteger(value) && value >= 0 && value <= 127) functionsState[id][key] = value;
      }
      for (const [id, voices] of Array.isArray(saved.banks) ? saved.banks.filter(Array.isArray) : []) {
        try {
          const profile = Synths.get(id);
          if (!Array.isArray(voices) || voices.length > 32) continue;
          voices.forEach(v => profile.midi.voiceCodec.bulk(v, 1));
          banks.set(id, structuredClone(voices));
        } catch {}
      }
      engine = synth.id;
      last = current();
    },
    changed,
    get transport() {
      return transport;
    },
    load,
    receive,
    config,
    sendVoice,
    arm,
    files,
  };
})();
