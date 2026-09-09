"use strict";
// Yamaha MIDI appendix layouts. See MIDI_IMPLEMENTATION.md.
const MidiProtocol = (() => {
  const channel = (c) => {
    if (!Number.isInteger(c) || c < 1 || c > 16)
      throw new RangeError("Channel must be 1–16");
    return c - 1;
  };
  const check = (a) => -a.reduce((s, b) => s + b, 0) & 127;
  function seven(a, n) {
    a = Array.from(a);
    if (
      (n !== undefined && a.length !== n) ||
      a.some((b) => !Number.isInteger(b) || b < 0 || b > 127)
    )
      throw Error("Invalid SysEx data length or byte");
    return a;
  }
  function split(data) {
    const result = [];
    let current = null;
    for (const b of data) {
      if (b >= 248 && b <= 255) continue;
      if (b === 240) {
        if (current) throw Error("Nested SysEx message");
        current = [b];
      } else if (b === 247) {
        if (!current) throw Error("Unexpected SysEx end");
        current.push(b);
        result.push(Uint8Array.from(current));
        current = null;
      } else {
        if (!current || !Number.isInteger(b) || b < 0 || b > 127)
          throw Error("Invalid SysEx framing");
        current.push(b);
      }
    }
    if (current || !result.length) throw Error("Incomplete SysEx file");
    return result;
  }
  function frame(format, data, c = 1) {
    data = seven(data);
    return Uint8Array.from([
      240,
      67,
      channel(c),
      format,
      data.length >> 7,
      data.length & 127,
      ...data,
      check(data),
      247,
    ]);
  }
  function read(message) {
    const a = Array.from(message);
    if (a[0] !== 240 || a[1] !== 67 || a.at(-1) !== 247 || a.length < 8)
      throw Error("Not a Yamaha bulk message");
    seven(a.slice(2, -1));
    if (a[2] > 15 || a.length !== a[4] * 128 + a[5] + 8)
      throw Error("Invalid bulk size/channel");
    const data = a.slice(6, -2);
    if (check(data) !== a.at(-2)) throw Error("Yamaha checksum mismatch");
    return { format: a[3], channel: a[2] + 1, data };
  }
  const ascii = (s) => Array.from(s, (c) => c.charCodeAt(0));
  const parameter = (group, address, value, c = 1) =>
    Uint8Array.from([
      240,
      67,
      16 + channel(c),
      ...seven([group, address, value], 3),
      247,
    ]);
  function readParameter(data) {
    const a = Array.from(data);
    if (
      a.length !== 7 ||
      a[0] !== 240 ||
      a[1] !== 67 ||
      a[2] < 16 ||
      a[2] > 31 ||
      a[6] !== 247
    )
      throw Error("Invalid parameter message");
    seven(a.slice(2, 6));
    return {
      channel: (a[2] & 15) + 1,
      group: a[3],
      address: a[4],
      value: a[5],
    };
  }
  return {
    channel,
    check,
    seven,
    split,
    frame,
    read,
    ascii,
    parameter,
    readParameter,
  };
})();
const YS200Codec = (() => {
  const P = MidiProtocol,
    order = [3, 1, 2, 0],
    opKeys = [
      "AR",
      "D1R",
      "D2R",
      "RR",
      "D1L",
      "LEVEL",
      "RATE",
      "EBS",
      "AME",
      "KVS",
      "OUT",
      "CRS",
      "DET",
    ],
    extraKeys = ["FIX", "FIXRG", "FINE", "wave", "SHIFT"],
    globals = [
      "ALG",
      "FBL",
      "SPD",
      "DLY",
      "PMD",
      "AMD",
      "SYNC",
      "LFW",
      "PMS",
      "AMS",
      "TRPS",
      "MONO",
    ];
  const ids = {
    aced: "LM  8976AE",
    aced2: "LM  8023AE",
    effects: "LM  8036EF",
  };
  function validateBlocks(b, a, a2) {
    for (let i = 64; i < 77; i++) {
      const max =
        i === 64 ? 12 : [65, 68, 69, 70].includes(i) ? 1 : i === 75 ? 100 : 99;
      if (b[i] > max) throw Error("Invalid YS200 controller " + i);
    }
    for (let i = 87; i < 93; i++)
      if (b[i] > 99) throw Error("Invalid legacy pitch envelope");
    for (const i of [21, 22])
      if (a[i] > 99) throw Error("Invalid foot controller");
    for (let i = 0; i < 4; i++)
      if (a2[i] > (i === 2 ? 100 : 99))
        throw Error("Invalid aftertouch controller");
  }

  function validate(v) {
    if (
      !v ||
      v.operators?.length !== 4 ||
      !v.global ||
      typeof v.name !== "string" ||
      v.name.length > 10 ||
      /[^\x20-\x7f]/.test(v.name)
    )
      throw Error("Invalid YS200 voice");
    for (const op of v.operators)
      for (const k of [...opKeys, ...extraKeys, "on"]) {
        const [lo, hi] = YS200.ranges[k];
        if (!Number.isInteger(op[k]) || op[k] < lo || op[k] > hi)
          throw Error("Invalid YS200 " + k);
      }
    for (const k of [...globals, "REV"]) {
      const [lo, hi] = YS200.ranges[k];
      if (
        !Number.isInteger(v.global[k]) ||
        v.global[k] < lo ||
        v.global[k] > hi
      )
        throw Error("Invalid YS200 " + k);
    }
    if (v.operators[0].SHIFT !== 0) throw Error("Operator 1 shift must be off");
    return v;
  }
  const wire = (k, v) =>
    k === "DET" ? v + 3 : k === "TRPS" ? v + 24 : k === "ALG" ? v - 1 : v;
  const native = (k, v) =>
    k === "DET" ? v - 3 : k === "TRPS" ? v - 24 : k === "ALG" ? v + 1 : v;
  function encode(v) {
    validate(v);
    const base = v.sysex?.vced ? P.seven(v.sysex.vced, 93) : Array(93).fill(0),
      aced = v.sysex?.aced ? P.seven(v.sysex.aced, 23) : Array(23).fill(0),
      aced2 = v.sysex?.aced2 ? P.seven(v.sysex.aced2, 10) : Array(10).fill(0);
    if (!v.sysex) {
      base[64] = 2;
      base[75] = 50;
      aced2[2] = 50;
    }
    order.forEach((i, n) => {
      opKeys.forEach((k, j) => (base[n * 13 + j] = wire(k, v.operators[i][k])));
      extraKeys.forEach((k, j) => (aced[n * 5 + j] = v.operators[i][k]));
    });
    globals.forEach((k, j) => (base[52 + j] = wire(k, v.global[k])));
    base.splice(77, 10, ...P.ascii(v.name.padEnd(10, " ")));
    aced[20] = v.global.REV;
    const effects = v.effects || { preset: 0, time: 20, balance: 50 };
    Effects.validate(effects);
    validateBlocks(base, aced, aced2);
    return {
      vced: base,
      aced,
      aced2,
      effects: [effects.preset, effects.time, effects.balance],
    };
  }
  function decode(base, extras = {}) {
    base = P.seven(base, 93);
    const v = YS200Profile.createVoice(),
      aced = P.seven(extras.aced || Array(23).fill(0), 23),
      aced2 = P.seven(extras.aced2 || [0, 0, 50, 0, 0, 0, 0, 0, 0, 0], 10);
    order.forEach((i, n) => {
      opKeys.forEach(
        (k, j) => (v.operators[i][k] = native(k, base[n * 13 + j])),
      );
      extraKeys.forEach((k, j) => (v.operators[i][k] = aced[n * 5 + j]));
    });
    globals.forEach((k, j) => (v.global[k] = native(k, base[52 + j])));
    v.global.REV = aced[20];
    v.name = String.fromCharCode(...base.slice(77, 87)).trimEnd();
    validateBlocks(base, aced, aced2);
    v.sysex = { vced: base, aced, aced2 };
    if (extras.effects) {
      const e = P.seven(extras.effects, 3);
      v.effects = { preset: e[0], time: e[1], balance: e[2] };
      Effects.validate(v.effects);
    }
    return validate(v);
  }
  function pack(v) {
    const { vced: b, aced: a, aced2: a2, effects: e } = encode(v),
      p = v.sysex?.packed ? P.seven(v.sysex.packed, 128) : Array(128).fill(0);
    for (let n = 0; n < 4; n++) {
      const o = b.slice(n * 13, n * 13 + 13);
      p.splice(
        n * 10,
        10,
        ...o.slice(0, 6),
        (o[8] << 6) | (o[7] << 3) | o[9],
        o[10],
        o[11],
        (o[6] << 3) | o[12],
      );
      p[73 + n * 2] = (a[n * 5 + 4] << 4) | (a[n * 5] << 3) | a[n * 5 + 1];
      p[74 + n * 2] = (a[n * 5 + 3] << 4) | a[n * 5 + 2];
    }
    p.splice(
      40,
      17,
      (b[58] << 6) | (b[53] << 3) | b[52],
      ...b.slice(54, 58),
      (b[60] << 4) | (b[61] << 2) | b[59],
      b[62],
      b[64],
      (b[70] << 4) | (b[63] << 3) | (b[68] << 2) | (b[69] << 1) | b[65],
      b[66],
      b[67],
      ...b.slice(71, 77),
    );
    p.splice(57, 16, ...b.slice(77, 93));
    p.splice(81, 7, ...a.slice(20, 23), ...a2.slice(0, 4));
    p.splice(91, 3, ...e);
    return Uint8Array.from(p);
  }
  function unpack(data) {
    const p = P.seven(data, 128),
      b = Array(93).fill(0),
      a = Array(23).fill(0);
    for (let n = 0; n < 4; n++) {
      const o = p.slice(n * 10, n * 10 + 10);
      b.splice(
        n * 13,
        13,
        ...o.slice(0, 6),
        (o[9] >> 3) & 3,
        (o[6] >> 3) & 7,
        o[6] >> 6,
        o[6] & 7,
        o[7],
        o[8],
        o[9] & 7,
      );
      a.splice(
        n * 5,
        5,
        (p[73 + n * 2] >> 3) & 1,
        p[73 + n * 2] & 7,
        p[74 + n * 2] & 15,
        p[74 + n * 2] >> 4,
        (p[73 + n * 2] >> 4) & 3,
      );
    }
    b.splice(
      52,
      25,
      p[40] & 7,
      (p[40] >> 3) & 7,
      ...p.slice(41, 45),
      p[40] >> 6,
      p[45] & 3,
      p[45] >> 4,
      (p[45] >> 2) & 3,
      p[46],
      (p[48] >> 3) & 1,
      p[47],
      p[48] & 1,
      p[49],
      p[50],
      (p[48] >> 2) & 1,
      (p[48] >> 1) & 1,
      (p[48] >> 4) & 1,
      ...p.slice(51, 57),
    );
    b.splice(77, 16, ...p.slice(57, 73));
    a.splice(20, 3, ...p.slice(81, 84));
    const v = decode(b, {
      aced: a,
      aced2: [...p.slice(84, 88), 0, 0, 0, 0, 0, 0],
      effects: p.slice(91, 94),
    });
    v.sysex.packed = p;
    return v;
  }
  function bulk(v, c = 1) {
    if (Array.isArray(v)) {
      if (v.length !== 32) throw Error("A bank requires 32 voices");
      return P.frame(
        4,
        v.flatMap((x) => Array.from(pack(x))),
        c,
      );
    }
    const b = encode(v);
    return Uint8Array.from(
      ["effects", "aced2", "aced"]
        .flatMap((k) =>
          Array.from(P.frame(126, [...P.ascii(ids[k]), ...b[k]], c)),
        )
        .concat(Array.from(P.frame(3, b.vced, c))),
    );
  }
  function parse(data) {
    const voices = [];
    let extras = {},
      channel;
    for (const message of P.split(data)) {
      const r = P.read(message);
      if (channel && r.channel !== channel) throw Error("Mixed SysEx channels");
      channel = r.channel;
      if (r.format === 126) {
        const id = String.fromCharCode(...r.data.slice(0, 10)),
          k = Object.keys(ids).find((k) => ids[k] === id);
        if (!k) throw Error("Unsupported YS200 extension");
        if (extras[k]) throw Error("Duplicate YS200 extension");
        extras[k] = P.seven(
          r.data.slice(10),
          { aced: 23, aced2: 10, effects: 3 }[k],
        );
      } else if (r.format === 3) {
        voices.push(decode(r.data, extras));
        extras = {};
      } else if (r.format === 4) {
        P.seven(r.data, 4096);
        for (let i = 0; i < 32; i++)
          voices.push(unpack(r.data.slice(i * 128, i * 128 + 128)));
      } else throw Error("Not a YS200 voice dump");
    }
    if (Object.keys(extras).length || !voices.length)
      throw Error("Incomplete YS200 voice: waiting for VCED");
    return { channel, voices };
  }
  function parameter(v, key, index = 0, c = 1) {
    if (!Number.isInteger(index) || index < 0 || index > 3)
      throw Error("Invalid operator");
    const b = encode(v);
    let group = 18,
      address,
      value;
    if (key === "on") {
      address = 93;
      value = v.operators.reduce((m, o, i) => m | (o.on << (3 - i)), 0);
    } else if (opKeys.includes(key)) {
      address = order.indexOf(index) * 13 + opKeys.indexOf(key);
      value = b.vced[address];
    } else if (extraKeys.includes(key)) {
      group = 19;
      address = order.indexOf(index) * 5 + extraKeys.indexOf(key);
      value = b.aced[address];
    } else if (key === "REV") {
      group = 19;
      address = 20;
      value = b.aced[20];
    } else if (globals.includes(key)) {
      address = 52 + globals.indexOf(key);
      value = b.vced[address];
    } else throw Error("Unknown YS200 parameter");
    return P.parameter(group, address, value, c);
  }
  function apply(v, message) {
    const { group, address, value } = P.readParameter(message),
      b = encode(v);
    if (group === 18 && address === 93) {
      if (value > 15) throw Error("Invalid operator mask");
      v = structuredClone(v);
      v.operators.forEach((o, i) => (o.on = (value >> (3 - i)) & 1));
      return v;
    }
    if (group === 18 && address < 93) b.vced[address] = value;
    else if (group === 19 && address < 23) b.aced[address] = value;
    else if (group === 19 && address < 33) b.aced2[address - 23] = value;
    else if (group === 36 && address >= 4 && address <= 6)
      b.effects[address - 4] = value;
    else throw Error("Unsupported YS200 parameter");
    const out = decode(b.vced, b);
    out.operators.forEach((o, i) => (o.on = v.operators[i].on));
    if (v.sysex?.packed) out.sysex.packed = structuredClone(v.sysex.packed);
    return out;
  }
  const request = (c = 1, bank = false) =>
    Uint8Array.from([
      240,
      67,
      32 + P.channel(c),
      ...(bank ? [4] : [126, ...P.ascii(ids.effects)]),
      247,
    ]);
  return {
    validate,
    encode,
    decode,
    pack,
    unpack,
    bulk,
    parse,
    parameter,
    apply,
    request,
  };
})();
// DX7 live parameter decoding and multi-message files share the framing layer.
const DX7Midi = (() => {
  const P = MidiProtocol;
  function parse(data) {
    const voices = [];
    let channel;
    for (const m of P.split(data)) {
      const r = DX7Codec.parse(m);
      if (channel && channel !== r.channel) throw Error("Mixed DX7 channels");
      channel = r.channel;
      voices.push(...r.voices);
    }
    return { channel, voices };
  }
  function apply(v, message) {
    const { group, address, value } = P.readParameter(message);
    if (group > 1) throw Error("Not a DX7 voice parameter");
    const n = group * 128 + address;
    if (n > 155 || (n === 155 && value > 63))
      throw Error("Invalid DX7 parameter");
    if (n === 155) {
      v = structuredClone(v);
      v.operators.forEach((o, i) => (o.on = (value >> (5 - i)) & 1));
      return v;
    }
    const b = DX7Codec.encode(v);
    b[n] = value;
    const out = DX7Codec.decode(b);
    out.operators.forEach((o, i) => (o.on = v.operators[i].on));
    return out;
  }
  return { ...DX7Codec, parse, apply };
})();

Effects.parse = function (message) {
  const { format, channel, data } = MidiProtocol.read(message);
  if (
    format !== 126 ||
    String.fromCharCode(...data.slice(0, 10)) !== "LM  8036EF"
  )
    throw Error("Not a YS200 effects dump");
  const [preset, time, balance] = MidiProtocol.seven(data.slice(10), 3);
  const effects = { preset, time, balance };
  Effects.validate(effects);
  return { channel, effects };
};
