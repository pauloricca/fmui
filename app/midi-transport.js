"use strict";
class MidiTransport {
  constructor({
    navigator = globalThis.navigator,
    onMessage = () => {},
    onStatus = () => {},
    onPorts = () => {},
    delay = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = {}) {
    Object.assign(this, { navigator, onMessage, onStatus, onPorts, delay });
    this.access = null;
    this.input = null;
    this.output = null;
    this.queue = [];
    this.generation = 0;
    this.running = false;
    this.notes = new Set();
    this.echoes = [];
    this.lastError = null;
  }
  async connect() {
    if (!this.navigator?.requestMIDIAccess)
      throw Error(
        "Web MIDI is unavailable. Open this app in a browser with Web MIDI support using HTTPS or localhost.",
      );
    this.access = await this.navigator.requestMIDIAccess({ sysex: true });
    if (!this.access.sysexEnabled)
      throw Error("SysEx permission was not granted.");
    this.access.onstatechange = () => {
      if (
        this.input?.state === "disconnected" ||
        this.output?.state === "disconnected"
      ) {
        this.cancel();
        this.onStatus(
          "MIDI device disconnected. Select the reconnected ports to resume.",
        );
      }
      this.onPorts();
    };
    this.onPorts();
    return this.access;
  }
  async select(inputId, outputId) {
    this.cancel();
    const generation = this.generation;
    if (this.input) this.input.onmidimessage = null;
    this.input = this.access?.inputs.get(inputId) || null;
    this.output = this.access?.outputs.get(outputId) || null;
    await Promise.all([this.input?.open(), this.output?.open()]);
    if (generation !== this.generation) return;
    if (this.input)
      this.input.onmidimessage = (e) => {
        const a = Array.from(e.data),
          now = Date.now();
        this.echoes = this.echoes.filter((x) => now - x.time < 1500);
        const key = a.join(",");
        if (this.echoes.some((x) => x.key === key)) return;
        this.onMessage(Uint8Array.from(a));
      };
    this.onStatus(
      this.output ? "MIDI output connected" : "No MIDI output selected",
    );
  }
  cancel() {
    this.generation++;
    this.queue = [];
    this.output?.clear?.();
    this.panic();
  }
  enqueue(messages, { key = null } = {}) {
    if (!this.output || this.output.state === "disconnected")
      throw Error("Select a connected MIDI output.");
    this.lastError = null;
    if (key) this.queue = this.queue.filter((x) => x.key !== key);
    this.queue.push({
      messages: messages.map((m) => Uint8Array.from(m)),
      key,
      generation: this.generation,
      output: this.output,
    });
    this.drain();
    // drain executes its first send synchronously, before its first pacing wait.
    if (this.lastError) throw this.lastError;
  }
  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift();
        for (const bytes of job.messages) {
          if (job.generation !== this.generation || job.output !== this.output)
            break;
          job.output.send(bytes);
          this.echoes = this.echoes
            .filter((entry) => Date.now() - entry.time < 1500)
            .slice(-127);
          this.echoes.push({
            key: Array.from(bytes).join(","),
            time: Date.now(),
          });
          await this.delay(Math.max(25, bytes.length * 0.32 + 30));
        }
      }
    } catch (e) {
      this.lastError = e;
      this.cancel();
      this.onStatus("MIDI send failed: " + e.message);
    } finally {
      this.running = false;
    }
  }
  message(status, data, c = 1) {
    MidiProtocol.channel(c);
    MidiProtocol.seven(data);
    if (!this.output || this.output.state === "disconnected")
      throw Error("Select a connected MIDI output.");
    this.output.send([status | (c - 1), ...data]);
  }
  noteOn(note = 60, velocity = 100, c = 1) {
    this.message(144, [note, velocity], c);
    this.notes.add(c + ":" + note);
  }
  noteOff(note = 60, c = 1) {
    this.message(144, [note, 0], c);
    this.notes.delete(c + ":" + note);
  }
  panic() {
    if (this.output?.state !== "disconnected" && this.output) {
      try {
        for (const item of this.notes) {
          const [c, n] = item.split(":").map(Number);
          this.message(144, [n, 0], c);
        }
        for (let c = 1; c <= 16; c++) {
          this.message(176, [64, 0], c);
          this.message(176, [123, 0], c);
        }
      } catch (e) {
        this.onStatus("MIDI panic: " + e.message);
      }
    }
    this.notes.clear();
  }
}
