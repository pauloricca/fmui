use crate::voice::{Model, Voice};
use dx7::fm::{
    lfo::Lfo,
    voice::{Parameters, Voice as DxVoice},
};
use std::ffi::c_void;

pub const RATE: usize = 48_000;
pub const BLOCK: usize = 480;

#[derive(Clone)]
pub struct Controllers {
    pub volume: f32,
    pub expression: f32,
    pub wheel: f32,
    pub foot: f32,
    pub breath: f32,
    pub pressure: f32,
    pub bend: f32,
    pub sustain: bool,
    pub portamento: bool,
}
impl Default for Controllers {
    fn default() -> Self {
        Self {
            volume: 1.,
            expression: 1.,
            wheel: 0.,
            foot: 0.,
            breath: 0.,
            pressure: 0.,
            bend: 0.,
            sustain: false,
            portamento: false,
        }
    }
}

struct Note {
    key: u8,
    velocity: u8,
    held: bool,
    gate: bool,
    age: u64,
    pitch: f32,
    dx: Option<DxVoice>,
    quiet: usize,
}

pub struct Synth {
    pub voice: Voice,
    pub controllers: Controllers,
    pub functions: [u8; 128],
    notes: Vec<Option<Note>>,
    keys: Vec<(u8, u8)>,
    counter: u64,
    lfo: Lfo,
    opz: Option<Opz>,
    effects: Effects,
    lfo_age: usize,
    dx_phases: [[u32; 6]; 16],
}

impl Synth {
    pub fn new(voice: Voice) -> Self {
        let mut lfo = Lfo::new();
        lfo.init(RATE as f32);
        let mut functions = [0; 128];
        functions[65] = 2;
        functions[70] = 50;
        functions[71] = 1;
        let mut s = Self {
            notes: (0..voice.model.polyphony()).map(|_| None).collect(),
            keys: Vec::new(),
            opz: if voice.model == Model::Ys200 {
                Some(Opz::new())
            } else {
                None
            },
            voice,
            controllers: Controllers::default(),
            functions,
            counter: 0,
            lfo,
            effects: Effects::new(),
            lfo_age: 0,
            dx_phases: std::array::from_fn(|slot| {
                std::array::from_fn(|op| ((slot * 6 + op + 1) as u32).wrapping_mul(2654435761))
            }),
        };
        s.refresh();
        s
    }
    fn dx_patch(&self) -> dx7::Patch {
        let mut p = dx7::Patch::new(&self.voice.pack());
        p.active_operators = self.voice.mask;
        p
    }
    pub fn set_voice(&mut self, voice: Voice) {
        self.voice = voice;
        self.refresh();
    }
    pub fn refresh(&mut self) {
        if self.voice.model == Model::Dx7 {
            let mut p = self.dx_patch();
            let (pitch, amp, _) = self.dx_controller_amounts();
            p.modulations.pitch_mod_depth =
                ((p.modulations.pitch_mod_depth as f32 + pitch * 99.).min(99.)) as u8;
            p.modulations.amp_mod_depth =
                ((p.modulations.amp_mod_depth as f32 + amp * 99.).min(99.)) as u8;
            self.lfo.set(&p.modulations);
            for n in self.notes.iter_mut().flatten() {
                n.dx.as_mut().unwrap().set_patch(p);
            }
        } else {
            let c = self.controllers.clone();
            let delay = self.ys_delay();
            let chip = self.opz.as_mut().unwrap();
            chip.globals(&self.voice, &c, delay);
            for (i, n) in self.notes.iter().enumerate() {
                if let Some(n) = n {
                    chip.patch(i, &self.voice, n.velocity, n.key, &c);
                }
            }
        }
    }
    fn mono(&self) -> bool {
        if self.voice.model == Model::Dx7 {
            self.functions[64] != 0
        } else {
            self.voice.base[63] != 0
        }
    }
    fn dx_controller_amounts(&self) -> (f32, f32, f32) {
        let c = &self.controllers;
        let mut out = [0.; 3];
        for (i, value) in [c.wheel, c.foot, c.breath, c.pressure].iter().enumerate() {
            let amount = *value * self.functions[70 + i * 2] as f32 / 99.;
            let mask = self.functions[71 + i * 2];
            for (bit, o) in out.iter_mut().enumerate() {
                if mask & (1 << bit) != 0 {
                    *o += if bit == 2 {
                        (1. - *value) * self.functions[70 + i * 2] as f32 / 99.
                    } else {
                        amount
                    };
                }
            }
        }
        (out[0].min(1.), out[1].min(1.), out[2].min(1.))
    }
    pub fn note_on(&mut self, key: u8, velocity: u8) {
        if velocity == 0 {
            self.note_off(key);
            return;
        }
        self.counter += 1;
        self.keys.retain(|(k, _)| *k != key);
        self.keys.push((key, velocity));
        let previous = self
            .notes
            .iter()
            .flatten()
            .max_by_key(|n| n.age)
            .map(|n| n.pitch);
        let legato = self.mono() && self.notes[0].as_ref().is_some_and(|n| n.gate);
        let slot = if self.mono() {
            0
        } else {
            self.notes
                .iter()
                .position(Option::is_none)
                .unwrap_or_else(|| {
                    self.notes
                        .iter()
                        .enumerate()
                        .min_by_key(|(_, n)| {
                            let n = n.as_ref().unwrap();
                            (n.gate, n.age)
                        })
                        .unwrap()
                        .0
                })
        };
        if self.mono() {
            for i in 1..self.notes.len() {
                self.stop_slot(i);
            }
        }
        if legato {
            let n = self.notes[slot].as_mut().unwrap();
            n.key = key;
            n.velocity = velocity;
            n.held = true;
            n.gate = true;
            n.age = self.counter;
        } else {
            self.stop_slot(slot);
            let dx = if self.voice.model == Model::Dx7 {
                let mut v = DxVoice::new(self.dx_patch(), RATE as f32);
                v.set_phases(self.dx_phases[slot]);
                Some(v)
            } else {
                None
            };
            self.notes[slot] = Some(Note {
                key,
                velocity,
                held: true,
                gate: true,
                age: self.counter,
                pitch: if self.controllers.portamento {
                    previous.unwrap_or(key as f32)
                } else {
                    key as f32
                },
                dx,
                quiet: 0,
            });
        }
        self.lfo.reset();
        self.lfo_age = 0;
        self.refresh();
        if let Some(chip) = &mut self.opz {
            let n = self.notes[slot].as_ref().unwrap();
            chip.pitch(slot, n.pitch + self.voice.base[62] as f32 - 24.);
            chip.gate(slot, true, &self.voice);
        }
    }
    pub fn note_off(&mut self, key: u8) {
        self.keys.retain(|(k, _)| *k != key);
        if self.mono()
            && self.notes[0].as_ref().is_some_and(|n| n.key == key)
            && let Some(&(k, v)) = self.keys.last()
        {
            let n = self.notes[0].as_mut().unwrap();
            n.key = k;
            n.velocity = v;
            n.held = true;
            self.refresh();
            return;
        }
        for (i, n) in self.notes.iter_mut().enumerate() {
            if let Some(n) = n
                && n.key == key
                && n.held
            {
                n.held = false;
                if !self.controllers.sustain {
                    n.gate = false;
                    if let Some(chip) = &mut self.opz {
                        chip.gate(i, false, &self.voice);
                    }
                }
            }
        }
    }
    fn stop_slot(&mut self, i: usize) {
        if let Some(dx) = self.notes[i].as_ref().and_then(|n| n.dx.as_ref()) {
            self.dx_phases[i] = dx.phases();
        }
        if self.notes[i].is_some()
            && let Some(chip) = &mut self.opz
        {
            chip.silence(i, &self.voice);
        }
        self.notes[i] = None;
    }
    pub fn panic(&mut self) {
        for n in &mut self.notes {
            *n = None;
        }
        self.keys.clear();
        self.controllers.sustain = false;
        if let Some(chip) = &mut self.opz {
            chip.reset();
        }
        self.effects.clear();
        self.refresh();
    }
    pub fn control(&mut self, cc: u8, value: u8) {
        let v = value as f32 / 127.;
        match cc {
            1 => self.controllers.wheel = v,
            2 => self.controllers.breath = v,
            4 => self.controllers.foot = v,
            7 => self.controllers.volume = v,
            11 => self.controllers.expression = v,
            64 => {
                self.controllers.sustain = value >= 64;
                if !self.controllers.sustain {
                    for (i, n) in self.notes.iter_mut().enumerate() {
                        if let Some(n) = n
                            && !n.held
                        {
                            n.gate = false;
                            if let Some(chip) = &mut self.opz {
                                chip.gate(i, false, &self.voice);
                            }
                        }
                    }
                }
            }
            65 => self.controllers.portamento = value >= 64,
            120 => self.panic(),
            121 => {
                self.controllers = Controllers::default();
                self.control(64, 0);
            }
            123..=127 => {
                let keys: Vec<_> = self.notes.iter().flatten().map(|n| n.key).collect();
                for key in keys {
                    self.note_off(key);
                }
            }
            _ => {}
        }
        self.refresh();
    }
    pub fn active_notes(&self) -> usize {
        self.notes.iter().flatten().filter(|n| n.gate).count()
    }
    fn ys_delay(&self) -> f32 {
        let d = self.voice.base[55] as f32 / 99.;
        if d == 0. {
            1.
        } else {
            ((self.lfo_age as f32 / RATE as f32 - d * d * 3.) / (0.05 + d * 2.)).clamp(0., 1.)
        }
    }
    pub fn render(&mut self, out: &mut [[f32; 2]]) {
        out.fill([0.; 2]);
        let c = &self.controllers;
        let range = if self.voice.model == Model::Dx7 {
            self.functions[65]
        } else {
            self.voice.base[64]
        };
        let mut bend = c.bend * range as f32;
        if self.voice.model == Model::Dx7 && self.functions[66] > 0 {
            let step = self.functions[66] as f32;
            bend = (bend / step).round() * step;
        }
        let porta = if self.voice.model == Model::Dx7 {
            self.functions[69]
        } else {
            self.voice.base[66]
        };
        let glide = if c.portamento && porta > 0 {
            1. - (-(out.len() as f32) / (RATE as f32 * (0.005 + porta as f32 / 99.).powi(3) * 5.))
                .exp()
        } else {
            1.
        };
        if self.voice.model == Model::Dx7 {
            let (_, _, bias) = self.dx_controller_amounts();
            let block_len = out.len() as f32;
            for chunk in out.chunks_mut(dx7::MAX_BLOCK_SIZE) {
                let step = 1. - (1. - glide).powf(chunk.len() as f32 / block_len);
                self.lfo.step(chunk.len() as f32);
                for n in self.notes.iter_mut().flatten() {
                    n.pitch += (n.key as f32 - n.pitch) * step;
                    let p = Parameters {
                        gate: n.gate,
                        note: n.pitch + bend,
                        velocity: n.velocity as f32 / 127.,
                        pitch_mod: self.lfo.pitch_mod(),
                        amp_mod: self.lfo.amp_mod(),
                        envelope_bias: bias,
                        ..Parameters::default()
                    };
                    let mut temp = [0.; dx7::MAX_BLOCK_SIZE * 3];
                    n.dx.as_mut()
                        .unwrap()
                        .render_temp(&p, &mut temp[..chunk.len() * 3]);
                    let mut peak = 0f32;
                    for (frame, sample) in chunk.iter_mut().zip(temp) {
                        peak = peak.max(sample.abs());
                        frame[0] += sample * 0.15;
                        frame[1] += sample * 0.15;
                    }
                    n.quiet = if !n.gate && peak < 1e-6 {
                        n.quiet + chunk.len()
                    } else {
                        0
                    };
                }
            }
            for i in 0..self.notes.len() {
                if self.notes[i].as_ref().is_some_and(|n| n.quiet > RATE / 2) {
                    self.stop_slot(i);
                }
            }
        } else {
            self.lfo_age += out.len();
            let delay = self.ys_delay();
            let chip = self.opz.as_mut().unwrap();
            chip.globals(&self.voice, &self.controllers, delay);
            let c = &self.controllers;
            let b = &self.voice.base;
            let bias = c.breath * (b[75] as f32 - 50.) * 0.48
                + c.pressure * (self.voice.aced2[2] as f32 - 50.) * 0.48;
            for (i, n) in self.notes.iter_mut().enumerate() {
                if let Some(n) = n {
                    n.pitch += (n.key as f32 - n.pitch) * glide;
                    chip.pitch(i, n.pitch + bend + bias + b[62] as f32 - 24.);
                }
            }
            for frame in out.iter_mut() {
                *frame = chip.sample();
                frame[0] *= 0.55;
                frame[1] *= 0.55;
            }
            self.effects.process(out, self.voice.effects);
        }
        let foot = if self.voice.model == Model::Ys200 {
            let depth = self.voice.base[67] as f32 / 99.;
            1. - depth + self.controllers.foot * depth
        } else {
            1.
        };
        let gain = self.controllers.volume * self.controllers.expression * foot;
        for frame in out {
            for x in frame {
                *x = (*x * gain).clamp(-1., 1.);
                if !x.is_finite() {
                    *x = 0.;
                }
            }
        }
    }
}

unsafe extern "C" {
    fn opz_new() -> *mut c_void;
    fn opz_free(p: *mut c_void);
    fn opz_reset(p: *mut c_void);
    fn opz_steal(p: *mut c_void, channel: u32);
    fn opz_write(p: *mut c_void, r: u8, v: u8);
    fn opz_sample(p: *mut c_void, out: *mut f32);
}
struct Opz {
    ptr: *mut c_void,
    coarse: [(u8, u8); 64],
    phase: f64,
    history: [[f32; 2]; 64],
    cursor: usize,
    coefficients: Vec<[f32; 32]>,
}
impl Drop for Opz {
    fn drop(&mut self) {
        unsafe { opz_free(self.ptr) }
    }
}
impl Opz {
    const NATIVE: f64 = 3_579_545.0 / 64.;
    fn new() -> Self {
        let mut ratios = Vec::new();
        for multiple in 0..16 {
            for (dt, ratio) in [1., 1.41, 1.57, 1.73].iter().enumerate() {
                ratios.push((
                    if multiple == 0 { 0.5 } else { multiple as f32 } * ratio,
                    multiple,
                    dt as u8,
                ));
            }
        }
        ratios.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        let coarse = std::array::from_fn(|i| (ratios[i].1, ratios[i].2));
        let cutoff = 0.44 * RATE as f64 / Self::NATIVE;
        let coefficients = (0..256)
            .map(|p| {
                let mut c = std::array::from_fn(|k| {
                    let x = k as f64 - 15. + p as f64 / 256.;
                    let y = std::f64::consts::PI * x;
                    let sinc = if x.abs() < 1e-9 {
                        2. * cutoff
                    } else {
                        (2. * cutoff * y).sin() / y
                    };
                    (sinc * (0.5 + 0.5 * (std::f64::consts::PI * x / 16.).cos())) as f32
                });
                let sum: f32 = c.iter().sum();
                for x in &mut c {
                    *x /= sum;
                }
                c
            })
            .collect();
        Self {
            ptr: unsafe { opz_new() },
            coarse,
            phase: 0.,
            history: [[0.; 2]; 64],
            cursor: 0,
            coefficients,
        }
    }
    fn write(&mut self, r: u8, v: u8) {
        unsafe { opz_write(self.ptr, r, v) }
    }
    fn reset(&mut self) {
        unsafe { opz_reset(self.ptr) }
        self.history.fill([0.; 2]);
        self.phase = 0.;
    }
    fn gate(&mut self, i: usize, on: bool, v: &Voice) {
        // Register 08 selects the channel whose next control write keys it.
        self.write(8, i as u8);
        self.write(
            0x20 + i as u8,
            0x80 | if on { 0x40 } else { 0 } | v.base[53] << 3 | v.base[52],
        );
    }
    fn silence(&mut self, i: usize, v: &Voice) {
        self.gate(i, false, v);
        unsafe {
            opz_steal(self.ptr, i as u32);
        }
    }
    fn globals(&mut self, v: &Voice, c: &Controllers, delay: f32) {
        let b = &v.base;
        // Firmware mapping is approximate; the YM2414 LFO itself is chip-derived.
        let hz = 0.01 * 2f64.powf(b[54] as f64 / 99. * 12.45);
        let reg = (0u16..256)
            .min_by(|a, b| {
                let f = |r: u16| {
                    ((16 + (r & 15)) as f64) * 2f64.powi((r >> 4) as i32) * Self::NATIVE
                        / 2f64.powi(30)
                };
                (f(*a) - hz).abs().partial_cmp(&(f(*b) - hz).abs()).unwrap()
            })
            .unwrap() as u8;
        self.write(0x18, reg);
        self.write(0x1b, b[59] | b[58] << 4);
        let pm = b[56] as f32 * delay
            + c.wheel * b[71] as f32
            + c.breath * b[73] as f32
            + c.foot * v.aced[21] as f32
            + c.pressure * v.aced2[0] as f32;
        let am = b[57] as f32 * delay
            + c.wheel * b[72] as f32
            + c.breath * b[74] as f32
            + c.foot * v.aced[22] as f32
            + c.pressure * v.aced2[1] as f32;
        self.write(0x19, 0x80 | (pm * 127. / 99.).min(127.) as u8);
        self.write(0x19, (am * 127. / 99.).min(127.) as u8);
        for i in 0..8 {
            self.write(0x38 + i, b[60] << 4 | b[61]);
        }
    }
    fn patch(&mut self, i: usize, v: &Voice, velocity: u8, key: u8, c: &Controllers) {
        for n in 0..4 {
            let b = &v.base[n * 13..n * 13 + 13];
            let a = &v.aced[n * 5..n * 5 + 5];
            let slot = n as u8 * 8 + i as u8;
            let (multiple, dt2) = self.coarse[b[11] as usize];
            let detune = match b[12] {
                0 => 7,
                1 => 6,
                2 => 5,
                x => x - 3,
            };
            let fine = if multiple == 0 && a[0] == 0 {
                a[2].min(7)
            } else {
                a[2]
            };
            self.write(0x80 + slot, b[6] << 6 | a[0] << 5 | b[0]);
            // Fixed mode ignores the two low bits of the 0–63 coarse index.
            self.write(
                0x40 + slot,
                if a[0] != 0 {
                    a[1] << 4 | (b[11] >> 2)
                } else {
                    detune << 4 | multiple
                },
            );
            self.write(0x40 + slot, 0x80 | a[3] << 4 | fine);
            self.write(0xa0 + slot, b[8] << 7 | b[1]);
            self.write(0xc0 + slot, if a[0] != 0 { b[2] } else { dt2 << 6 | b[2] });
            let shift = [0, 1, 2, 3][a[4] as usize];
            self.write(0xc0 + slot, 0x20 | shift << 6 | v.aced[20]);
            self.write(0xe0 + slot, (15 - b[4]) << 4 | b[3]);
            // Yamaha OP4,OP2,OP3,OP1 => mask bits 0,2,1,3.
            let bit = [0, 2, 1, 3][n];
            let enabled = v.mask & (1 << bit) != 0;
            let level = if b[10] >= 20 {
                b[10] as f32 + 28.
            } else {
                (b[10] as f32 * 2.4).round()
            };
            let velocity_loss = (1. - velocity as f32 / 127.).powf(0.7) * b[9] as f32 * 5.;
            let key_loss = (key as f32 - 48.).max(0.) / 48. * b[5] as f32 * 0.75;
            let bias = ((1. - c.breath) * v.base[76] as f32
                + (1. - c.pressure) * v.aced2[3] as f32)
                * b[7] as f32
                / 7.;
            let tl = if !enabled || b[10] == 0 {
                127
            } else {
                ((127. - level) + velocity_loss + key_loss + bias).clamp(0., 127.) as u8
            };
            self.write(0x60 + slot, tl);
        }
        // Change algorithm/feedback without generating a key transition.
        // The selected channel is moved away before this control register write.
        self.write(8, ((i + 1) % 8) as u8);
        self.write(0x20 + i as u8, 0x80 | v.base[53] << 3 | v.base[52]);
    }
    fn pitch(&mut self, i: usize, note: f32) {
        // OPM keycode 0 is C#-1 at the nominal clock; skipped codes 3,7,11,15.
        let n = (note - 13.).clamp(0., 95.984375);
        let whole = n.floor() as u8;
        let semitone = whole % 12;
        let kc = ((whole / 12) << 4) | (semitone + semitone / 3);
        self.write(0x28 + i as u8, kc);
        self.write(0x30 + i as u8, ((n.fract() * 64.) as u8) << 2 | 1);
    }
    fn sample(&mut self) -> [f32; 2] {
        self.phase += Self::NATIVE / RATE as f64;
        while self.phase >= 1. {
            self.phase -= 1.;
            self.cursor = (self.cursor + 1) % 64;
            unsafe {
                opz_sample(self.ptr, self.history[self.cursor].as_mut_ptr());
            }
        }
        let coeff = &self.coefficients[(self.phase * 256.) as usize];
        let mut out = [0.; 2];
        for (k, c) in coeff.iter().enumerate() {
            let s = self.history[(self.cursor + 64 - k) % 64];
            out[0] += s[0] * c;
            out[1] += s[1] * c;
        }
        out
    }
}

struct Effects {
    delay: Vec<[f32; 2]>,
    position: usize,
    comb: Vec<Vec<f32>>,
    indices: [usize; 8],
    filter: [f32; 8],
    age: usize,
}
impl Effects {
    fn new() -> Self {
        Self {
            delay: vec![[0.; 2]; RATE * 4 + 1],
            position: 0,
            comb: [1557, 1617, 1491, 1422, 1580, 1640, 1514, 1445]
                .iter()
                .map(|n| vec![0.; *n * RATE / 44100])
                .collect(),
            indices: [0; 8],
            filter: [0.; 8],
            age: 0,
        }
    }
    fn clear(&mut self) {
        self.delay.fill([0.; 2]);
        for b in &mut self.comb {
            b.fill(0.);
        }
        self.filter.fill(0.);
        self.age = 0;
    }
    fn process(&mut self, out: &mut [[f32; 2]], effect: [u8; 3]) {
        let [preset, time, balance] = effect;
        // Approximate post-DAC effects. Preset 10 has no documented algorithm.
        if balance == 0 || preset == 10 {
            return;
        }
        let wet = balance as f32 / 99.;
        let seconds = 0.025 + time as f32 / 40. * 1.975;
        let length = (seconds * RATE as f32) as usize;
        for frame in out {
            let dry = *frame;
            let mut input = dry;
            if preset == 6 || preset == 7 {
                input = [(dry[0] * 6.).tanh() * 0.3, (dry[1] * 6.).tanh() * 0.3];
            }
            let mut result = [0.; 2];
            if [3, 4, 5, 7].contains(&preset) {
                let left =
                    self.delay[(self.position + self.delay.len() - length) % self.delay.len()];
                let right = self.delay
                    [(self.position + self.delay.len() - length * 3 / 2) % self.delay.len()];
                result = [left[0], if preset == 4 { right[1] } else { left[1] }];
                let feedback = if preset == 3 { 0. } else { 0.45 };
                self.delay[self.position] = [
                    input[0] + result[if preset == 5 { 1 } else { 0 }] * feedback,
                    input[1] + result[if preset == 5 { 0 } else { 1 }] * feedback,
                ];
            } else {
                let gain = if preset == 1 { 0.5 } else { 0.68 } + time as f32 / 40. * 0.22;
                for j in 0..8 {
                    let idx = self.indices[j];
                    let value = self.comb[j][idx];
                    self.filter[j] = value * 0.7 + self.filter[j] * 0.3;
                    self.comb[j][idx] =
                        (input[0] + input[1]) * 0.25 + self.filter[j] * gain.min(0.93);
                    self.indices[j] = (idx + 1) % self.comb[j].len();
                    result[j / 4] += value * 0.25;
                }
                if input[0].abs() + input[1].abs() > 0.02 {
                    self.age = 0;
                } else {
                    self.age += 1;
                }
                if preset >= 8 {
                    let t = (self.age as f32 / (RATE as f32 * seconds)).min(1.);
                    let gate = if t >= 1. {
                        0.
                    } else if preset == 9 {
                        t
                    } else {
                        1.
                    };
                    result[0] *= gate;
                    result[1] *= gate;
                }
                if preset == 2 {
                    result = [
                        result[0] * 0.8 + result[1] * 0.2,
                        result[1] * 0.8 + result[0] * 0.2,
                    ];
                }
            }
            self.position = (self.position + 1) % self.delay.len();
            *frame = [
                dry[0] * (1. - wet) + result[0] * wet,
                dry[1] * (1. - wet) + result[1] * wet,
            ];
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn both_engines_sound_and_release() {
        for model in [Model::Dx7, Model::Ys200] {
            let mut s = Synth::new(Voice::init(model));
            let mut out = [[0.; 2]; BLOCK];
            s.note_on(69, 127);
            let mut peak = 0f32;
            for _ in 0..20 {
                s.render(&mut out);
                for f in out {
                    peak = peak.max(f[0].abs());
                    assert!(f[0].is_finite());
                }
            }
            assert!(peak > 0.01, "{model:?}: peak {peak}");
            s.note_off(69);
            for _ in 0..500 {
                s.render(&mut out);
            }
            assert!(
                out.iter().all(|f| f[0].abs() < 0.002),
                "{model:?} did not release"
            );
        }
    }
    #[test]
    fn sustain_and_panic() {
        for model in [Model::Dx7, Model::Ys200] {
            let mut s = Synth::new(Voice::init(model));
            s.control(64, 127);
            s.note_on(60, 100);
            s.note_off(60);
            assert_eq!(s.active_notes(), 1);
            s.control(64, 0);
            assert_eq!(s.active_notes(), 0);
            s.panic();
            let mut out = [[0.; 2]; BLOCK];
            s.render(&mut out);
            assert!(out.iter().all(|f| f[0].abs() < 0.001));
        }
    }
}
