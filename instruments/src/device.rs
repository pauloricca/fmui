use crate::{
    sound::Synth,
    voice::{EXTENSIONS, Model, Voice, checksum, frame},
};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::Path,
    time::{Duration, Instant},
};

struct Pending {
    voice: Voice,
    seen: u8,
    at: Instant,
}
pub struct Device {
    pub synth: Synth,
    pub channel: u8,
    pub tx_channel: u8,
    pub bank: Vec<Voice>,
    pub program: usize,
    pub bank_start: usize,
    pub changed: bool,
    pub received: u64,
    pub rejected: u64,
    pending: HashMap<u64, Pending>,
    sense: HashMap<u64, Instant>,
}
impl Device {
    pub fn new(model: Model, channel: u8, tx_channel: u8) -> Self {
        let v = Voice::init(model);
        Self {
            synth: Synth::new(v.clone()),
            channel,
            tx_channel,
            bank: vec![v; if model == Model::Dx7 { 32 } else { 100 }],
            program: 0,
            bank_start: 0,
            changed: false,
            received: 0,
            rejected: 0,
            pending: HashMap::new(),
            sense: HashMap::new(),
        }
    }
    pub fn expire(&mut self) {
        self.pending
            .retain(|_, p| p.at.elapsed() < Duration::from_secs(3));
        if self
            .sense
            .values()
            .any(|t| t.elapsed() > Duration::from_millis(300))
        {
            self.synth.panic();
            self.sense.clear();
        }
    }
    pub fn disconnect(&mut self, id: u64) {
        self.pending.remove(&id);
        if self.sense.remove(&id).is_some() {
            self.synth.panic();
        }
    }
    pub fn receive(&mut self, id: u64, m: &[u8]) -> Result<Vec<Vec<u8>>, String> {
        self.received += 1;
        if let Some(t) = self.sense.get_mut(&id) {
            *t = Instant::now();
        }
        let result = self.handle(id, m);
        if result.is_err() {
            self.pending.remove(&id);
            self.rejected += 1;
        }
        result
    }
    fn handle(&mut self, id: u64, m: &[u8]) -> Result<Vec<Vec<u8>>, String> {
        if m.is_empty() {
            return Ok(vec![]);
        }
        if m[0] == 254 {
            self.sense.insert(id, Instant::now());
            return Ok(vec![]);
        }
        if m[0] == 255 {
            self.synth.panic();
            return Ok(vec![]);
        }
        if m[0] == 240 {
            return self.sysex(id, m);
        }
        let status = m[0] & 0xf0;
        if m[0] & 15 != self.channel || !(128..240).contains(&m[0]) {
            return Ok(vec![]);
        }
        let len = if status == 192 || status == 208 { 2 } else { 3 };
        if m.len() != len || m[1..].iter().any(|x| *x > 127) {
            return Err("invalid channel message".into());
        }
        match status {
            128 => self.synth.note_off(m[1]),
            144 => self.synth.note_on(m[1], m[2]),
            176 => self.synth.control(m[1], m[2]),
            192 => {
                let p = m[1] as usize;
                if p < self.bank.len() {
                    self.program = p;
                    self.synth.panic();
                    self.synth.set_voice(self.bank[p].clone());
                    self.changed = true;
                }
            }
            208 => {
                self.synth.controllers.pressure = m[1] as f32 / 127.;
                self.synth.refresh();
            }
            224 => {
                self.synth.controllers.bend =
                    ((m[1] as i32 + 128 * m[2] as i32) - 8192) as f32 / 8192.;
            }
            _ => {}
        }
        Ok(vec![])
    }
    fn sysex(&mut self, id: u64, m: &[u8]) -> Result<Vec<Vec<u8>>, String> {
        if m.len() < 5 || m[1] != 67 {
            return Ok(vec![]);
        }
        if m[m.len() - 1] != 247 || m[2..m.len() - 1].iter().any(|x| *x > 127) {
            return Err("invalid Yamaha framing".into());
        }
        if m[2] & 15 != self.channel {
            return Ok(vec![]);
        }
        let model = self.synth.voice.model;
        match m[2] >> 4 {
            1 => {
                if m.len() != 7 {
                    return Err("invalid parameter size".into());
                }
                let (group, address, value) = (m[3], m[4] as usize, m[5]);
                if model == Model::Dx7 && group == 8 {
                    let maximum = match address {
                        64 | 67 | 68 => 1,
                        65 | 66 => 12,
                        69 | 70 | 72 | 74 | 76 => 99,
                        71 | 73 | 75 | 77 => 7,
                        _ => return Err("unsupported DX7 function".into()),
                    };
                    if value > maximum {
                        return Err("DX7 function out of range".into());
                    }
                    self.synth.functions[address] = value;
                    self.synth.refresh();
                    self.changed = true;
                    return Ok(vec![]);
                }
                let mut v = self.synth.voice.clone();
                if model == Model::Dx7 {
                    let address = group as usize * 128 + address;
                    if address == 155 {
                        v.mask = value;
                    } else if address < 155 {
                        v.base[address] = value;
                    } else {
                        return Err("unsupported DX7 parameter".into());
                    }
                } else {
                    match (group, address) {
                        (18, 93) => v.mask = value,
                        (18, 0..=92) => v.base[address] = value,
                        (19, 0..=22) => v.aced[address] = value,
                        (19, 23..=32) => v.aced2[address - 23] = value,
                        (36, 4..=6) => v.effects[address - 4] = value,
                        _ => return Err("unsupported YS200 parameter".into()),
                    }
                }
                v.validate()?;
                self.pending.remove(&id);
                self.synth.set_voice(v);
                self.changed = true;
            }
            2 => {
                if model == Model::Dx7 {
                    return Ok(vec![]);
                } // Original DX7 requires a manual dump.
                if m.len() == 5 {
                    return match m[3] {
                        3 => Ok(self.synth.voice.dumps(self.tx_channel)),
                        4 => Ok(vec![self.bank_dump()]),
                        _ => Err("unsupported YS200 request".into()),
                    };
                }
                if m.len() == 15 && m[3] == 126 {
                    let index = EXTENSIONS
                        .iter()
                        .position(|name| name.as_slice() == &m[4..14])
                        .ok_or("unknown extension request")?;
                    // EFEDS request starts the complete current-voice sequence.
                    let dumps = self.synth.voice.dumps(self.tx_channel);
                    return Ok(dumps[index..].to_vec());
                }
                return Err("unsupported request size".into());
            }
            0 => {
                if m.len() < 8 || m.len() != m[4] as usize * 128 + m[5] as usize + 8 {
                    return Err("bulk length mismatch".into());
                }
                let data = &m[6..m.len() - 2];
                if checksum(data) != m[m.len() - 2] {
                    return Err("bulk checksum mismatch".into());
                }
                match (model, m[3]) {
                    (Model::Dx7, 0) | (Model::Ys200, 3) => {
                        let mut v = if let Some(p) = self.pending.remove(&id) {
                            if p.at.elapsed() < Duration::from_secs(3) {
                                p.voice
                            } else {
                                Voice::init(model)
                            }
                        } else {
                            Voice::init(model)
                        };
                        v.base = data.to_vec();
                        v.validate()?;
                        self.synth.set_voice(v);
                        self.changed = true;
                    }
                    (Model::Dx7, 9) | (Model::Ys200, 4) => {
                        if data.len() != 4096 {
                            return Err("bank must contain 32 voices".into());
                        }
                        let voices = data
                            .chunks_exact(128)
                            .map(|d| Voice::unpack(model, d))
                            .collect::<Result<Vec<_>, _>>()?;
                        self.bank[self.bank_start..self.bank_start + 32].clone_from_slice(&voices);
                        self.changed = true;
                        self.pending.remove(&id);
                    }
                    (Model::Ys200, 126) => {
                        if data.len() < 10 {
                            return Err("short extension".into());
                        }
                        let index = EXTENSIONS
                            .iter()
                            .position(|name| name.as_slice() == &data[..10])
                            .ok_or("unknown YS200 extension")?;
                        let data = &data[10..];
                        if data.len() != [3, 10, 23][index] {
                            return Err("extension length mismatch".into());
                        }
                        if self
                            .pending
                            .get(&id)
                            .is_some_and(|p| p.at.elapsed() >= Duration::from_secs(3))
                        {
                            self.pending.remove(&id);
                        }
                        let p = self.pending.entry(id).or_insert_with(|| Pending {
                            voice: Voice::init(model),
                            seen: 0,
                            at: Instant::now(),
                        });
                        if p.seen & (1 << index) != 0 {
                            return Err("duplicate extension in voice sequence".into());
                        }
                        match index {
                            0 => p.voice.effects.copy_from_slice(data),
                            1 => p.voice.aced2.copy_from_slice(data),
                            _ => p.voice.aced.copy_from_slice(data),
                        };
                        p.voice.validate()?;
                        p.seen |= 1 << index;
                        p.at = Instant::now();
                        if index == 0 {
                            // EFEDS is also a standalone effects dump. Like hardware,
                            // it affects the effects unit independently of the voice.
                            let mut v = self.synth.voice.clone();
                            v.effects.copy_from_slice(data);
                            self.synth.set_voice(v);
                            self.changed = true;
                        }
                    }
                    _ => return Err("unsupported bulk format for this instrument".into()),
                }
            }
            _ => return Err("unsupported Yamaha substatus".into()),
        }
        Ok(vec![])
    }
    pub fn bank_dump(&self) -> Vec<u8> {
        frame(
            if self.synth.voice.model == Model::Dx7 {
                9
            } else {
                4
            },
            &self.bank[self.bank_start..self.bank_start + 32]
                .iter()
                .flat_map(|v| v.pack())
                .collect::<Vec<_>>(),
            self.tx_channel,
        )
    }
    pub fn store(&mut self, slot: usize) -> Result<(), String> {
        if slot >= self.bank.len() {
            return Err("memory slot outside instrument range".into());
        }
        let mut v = self.synth.voice.clone();
        v.mask = if v.model == Model::Dx7 { 63 } else { 15 };
        self.bank[slot] = v;
        self.changed = true;
        Ok(())
    }
    pub fn status(&self) -> String {
        format!(
            "{{\"model\":\"{}\",\"sample_rate\":48000,\"channels\":2,\"polyphony\":{},\"active_notes\":{},\"receive_channel\":{},\"transmit_channel\":{},\"program\":{},\"bank_start\":{},\"memory_slots\":{},\"received\":{},\"rejected\":{},\"fidelity\":\"emulation; hardware calibration pending\"}}",
            self.synth.voice.model.name(),
            self.synth.voice.model.polyphony(),
            self.synth.active_notes(),
            self.channel + 1,
            self.tx_channel + 1,
            self.program,
            self.bank_start,
            self.bank.len(),
            self.received,
            self.rejected
        )
    }
    pub fn save(&mut self, path: &Path) -> std::io::Result<()> {
        let mut bytes = b"YINST001".to_vec();
        bytes.push(if self.synth.voice.model == Model::Dx7 {
            0
        } else {
            1
        });
        bytes.extend([self.program as u8, self.bank_start as u8]);
        bytes.extend(self.synth.functions);
        for v in self.bank.iter().chain(std::iter::once(&self.synth.voice)) {
            bytes.extend(&v.base);
            bytes.extend(v.aced);
            bytes.extend(v.aced2);
            bytes.extend(v.effects);
            bytes.push(v.mask);
            bytes.extend(v.reserved);
        }
        let tmp = path.with_extension("tmp");
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        std::fs::rename(tmp, path)?;
        self.changed = false;
        Ok(())
    }
    pub fn load(&mut self, path: &Path) -> Result<(), String> {
        let mut bytes = Vec::new();
        std::fs::File::open(path)
            .map_err(|e| e.to_string())?
            .take(100_000)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        let model = self.synth.voice.model;
        let size = self.synth.voice.base.len();
        let stride = size + 23 + 10 + 3 + 1 + 128;
        if bytes.len() != 139 + (self.bank.len() + 1) * stride
            || &bytes[..8] != b"YINST001"
            || bytes[8] != if model == Model::Dx7 { 0 } else { 1 }
        {
            return Err("incompatible state file".into());
        }
        let program = bytes[9] as usize;
        let bank_start = bytes[10] as usize;
        if program >= self.bank.len() || bank_start + 32 > self.bank.len() {
            return Err("invalid state memory selection".into());
        }
        let mut voices = Vec::new();
        for b in bytes[139..].chunks_exact(stride) {
            let mut v = Voice::init(model);
            v.base.copy_from_slice(&b[..size]);
            v.aced.copy_from_slice(&b[size..size + 23]);
            v.aced2.copy_from_slice(&b[size + 23..size + 33]);
            v.effects.copy_from_slice(&b[size + 33..size + 36]);
            v.mask = b[size + 36];
            v.reserved.copy_from_slice(&b[size + 37..]);
            v.validate()?;
            voices.push(v);
        }
        // Function parameters are range-checked by replay into a temporary device.
        let mut check = Device::new(model, self.channel, self.tx_channel);
        if model == Model::Dx7 {
            for i in 64..78 {
                check.receive(
                    0,
                    &[240, 67, 16 + self.channel, 8, i as u8, bytes[11 + i], 247],
                )?;
            }
        }
        self.synth.functions.copy_from_slice(&bytes[11..139]);
        self.synth.set_voice(voices.pop().unwrap());
        self.bank = voices;
        self.program = program;
        self.bank_start = bank_start;
        self.changed = false;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sysex_checksums_channels_and_atomic_bank() {
        let mut d = Device::new(Model::Dx7, 0, 0);
        let original = d.synth.voice.clone();
        assert!(d.receive(1, &[240, 67, 16, 1, 6, 32, 247]).is_err());
        assert_eq!(d.synth.voice, original);
        d.receive(1, &[240, 67, 17, 0, 16, 22, 247]).unwrap();
        assert_eq!(d.synth.voice, original);
        let mut m = d.bank_dump();
        m[6 + 128 + 14] = 127;
        let end = m.len() - 2;
        m[end] = checksum(&m[6..end]);
        let bank = d.bank.clone();
        assert!(d.receive(1, &m).is_err());
        assert_eq!(d.bank, bank);
    }
    #[test]
    fn ys_extensions_requests_and_hidden_bytes() {
        let mut d = Device::new(Model::Ys200, 2, 2);
        let mut v = Voice::init(Model::Ys200);
        v.aced2[7] = 79;
        v.base[77] = b'X';
        for m in v.dumps(2) {
            d.receive(10, &m).unwrap();
        }
        assert_eq!(d.synth.voice.base, v.base);
        assert_eq!(d.synth.voice.aced2[7], 79);
        let reply = d
            .receive(
                10,
                &[vec![240, 67, 34, 126], EXTENSIONS[0].to_vec(), vec![247]].concat(),
            )
            .unwrap();
        assert_eq!(reply, v.dumps(2));
    }
    #[test]
    fn interleaved_clients_do_not_mix_extensions() {
        let mut d = Device::new(Model::Ys200, 0, 0);
        let mut v = Voice::init(Model::Ys200);
        v.aced[3] = 7;
        d.receive(1, &v.dumps(0)[2]).unwrap();
        d.receive(2, &v.dumps(0)[3]).unwrap();
        assert_eq!(d.synth.voice.aced[3], 0);
        d.receive(1, &v.dumps(0)[3]).unwrap();
        assert_eq!(d.synth.voice.aced[3], 7);
    }
}
