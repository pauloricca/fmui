//! Native edit-buffer layouts. Wire order is DX7: 6,5,4,3,2,1;
//! YS200: 4,2,3,1. Preserve fields the editor does not expose.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Model {
    Dx7,
    Ys200,
}
impl Model {
    pub fn name(self) -> &'static str {
        match self {
            Self::Dx7 => "dx7",
            Self::Ys200 => "ys200",
        }
    }
    pub fn polyphony(self) -> usize {
        if self == Self::Dx7 { 16 } else { 8 }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Voice {
    pub model: Model,
    pub base: Vec<u8>,
    pub aced: [u8; 23],
    pub aced2: [u8; 10],
    pub effects: [u8; 3],
    pub mask: u8,
    pub reserved: [u8; 128],
}
pub const EXTENSIONS: [&[u8; 10]; 3] = [b"LM  8036EF", b"LM  8023AE", b"LM  8976AE"];

impl Voice {
    pub fn init(model: Model) -> Self {
        let mut v = Self {
            model,
            base: vec![0; if model == Model::Dx7 { 155 } else { 93 }],
            aced: [0; 23],
            aced2: [0; 10],
            effects: [0, 20, 0],
            mask: if model == Model::Dx7 { 63 } else { 15 },
            reserved: [0; 128],
        };
        if model == Model::Dx7 {
            for n in 0..6 {
                let b = &mut v.base[n * 21..n * 21 + 21];
                b[..4].fill(99);
                b[4..7].fill(99);
                b[8] = 39;
                b[16] = if n == 5 { 99 } else { 0 };
                b[18] = 1;
                b[20] = 7;
            }
            v.base[126..130].fill(99);
            v.base[130..134].fill(50);
            v.base[136] = 1;
            v.base[137] = 35;
            v.base[141] = 1;
            v.base[143] = 3;
            v.base[144] = 24;
            v.base[145..155].copy_from_slice(b"INIT DX7  ");
        } else {
            for n in 0..4 {
                let b = &mut v.base[n * 13..n * 13 + 13];
                b[0] = 31;
                b[3] = 8;
                b[4] = 15;
                b[10] = if n == 3 { 99 } else { 0 };
                b[11] = 4;
                b[12] = 3;
            }
            v.base[54] = 35;
            v.base[62] = 24;
            v.base[64] = 2;
            v.base[75] = 50;
            v.aced2[2] = 50;
            v.base[77..87].copy_from_slice(b"INIT YS200");
        }
        v
    }

    pub fn validate(&self) -> Result<(), String> {
        let bound = |slice: &[u8], maxima: &[u8]| -> Result<(), String> {
            if slice.len() != maxima.len() || slice.iter().zip(maxima).any(|(x, m)| x > m) {
                Err("parameter outside native range".into())
            } else {
                Ok(())
            }
        };
        if self
            .base
            .iter()
            .chain(self.aced.iter())
            .chain(self.aced2.iter())
            .chain(self.effects.iter())
            .chain(self.reserved.iter())
            .any(|x| *x > 127)
        {
            return Err("non-seven-bit data".into());
        }
        if self.model == Model::Dx7 {
            if self.base.len() != 155 || self.mask > 63 {
                return Err("invalid DX7 voice length/mask".into());
            }
            for b in self.base[..126].chunks_exact(21) {
                bound(
                    b,
                    &[
                        99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 3, 3, 7, 3, 7, 99, 1, 31, 99,
                        14,
                    ],
                )?;
            }
            bound(
                &self.base[126..145],
                &[
                    99, 99, 99, 99, 99, 99, 99, 99, 31, 7, 1, 99, 99, 99, 99, 1, 5, 7, 48,
                ],
            )?;
        } else {
            if self.base.len() != 93 || self.mask > 15 {
                return Err("invalid YS200 voice length/mask".into());
            }
            for b in self.base[..52].chunks_exact(13) {
                bound(b, &[31, 31, 31, 15, 15, 99, 3, 7, 1, 7, 99, 63, 6])?;
            }
            bound(
                &self.base[52..77],
                &[
                    7, 7, 99, 99, 99, 99, 1, 3, 7, 3, 48, 1, 12, 1, 99, 99, 1, 1, 1, 99, 99, 99,
                    99, 100, 99,
                ],
            )?;
            bound(&self.base[87..93], &[99; 6])?;
            for b in self.aced[..20].chunks_exact(5) {
                bound(b, &[1, 7, 15, 7, 3])?;
            }
            bound(&self.aced[20..23], &[7, 99, 99])?;
            bound(&self.aced2[..4], &[99, 99, 100, 99])?;
            bound(&self.effects, &[10, 40, 99])?;
            if self.aced[19] != 0 {
                return Err("YS200 operator 1 EG shift must be off".into());
            }
        }
        Ok(())
    }

    pub fn pack(&self) -> [u8; 128] {
        let b = &self.base;
        let mut p = self.reserved;
        if self.model == Model::Dx7 {
            for n in 0..6 {
                let o = &b[n * 21..n * 21 + 21];
                let d = &mut p[n * 17..n * 17 + 17];
                d[..11].copy_from_slice(&o[..11]);
                d[11] = o[11] | o[12] << 2;
                d[12] = o[13] | o[20] << 3;
                d[13] = o[14] | o[15] << 2;
                d[14] = o[16];
                d[15] = o[17] | o[18] << 1;
                d[16] = o[19];
            }
            p[102..110].copy_from_slice(&b[126..134]);
            p[110] = b[134];
            p[111] = b[135] | b[136] << 3;
            p[112..116].copy_from_slice(&b[137..141]);
            p[116] = b[141] | b[142] << 1 | b[143] << 4;
            p[117..128].copy_from_slice(&b[144..155]);
        } else {
            for n in 0..4 {
                let o = &b[n * 13..n * 13 + 13];
                let d = &mut p[n * 10..n * 10 + 10];
                d[..6].copy_from_slice(&o[..6]);
                d[6] = o[8] << 6 | o[7] << 3 | o[9];
                d[7] = o[10];
                d[8] = o[11];
                d[9] = o[6] << 3 | o[12];
                let a = &self.aced[n * 5..n * 5 + 5];
                p[73 + n * 2] = a[4] << 4 | a[0] << 3 | a[1];
                p[74 + n * 2] = a[3] << 4 | a[2];
            }
            p[40] = b[58] << 6 | b[53] << 3 | b[52];
            p[41..45].copy_from_slice(&b[54..58]);
            p[45] = b[60] << 4 | b[61] << 2 | b[59];
            p[46] = b[62];
            p[47] = b[64];
            p[48] = b[70] << 4 | b[63] << 3 | b[68] << 2 | b[69] << 1 | b[65];
            p[49] = b[66];
            p[50] = b[67];
            p[51..57].copy_from_slice(&b[71..77]);
            p[57..73].copy_from_slice(&b[77..93]);
            p[81..84].copy_from_slice(&self.aced[20..23]);
            p[84..88].copy_from_slice(&self.aced2[..4]);
            p[91..94].copy_from_slice(&self.effects);
        }
        p
    }

    pub fn unpack(model: Model, p: &[u8]) -> Result<Self, String> {
        if p.len() != 128 || p.iter().any(|x| *x > 127) {
            return Err("invalid packed voice".into());
        }
        let mut v = Self::init(model);
        v.reserved.copy_from_slice(p);
        let b = &mut v.base;
        if model == Model::Dx7 {
            for n in 0..6 {
                let o = &p[n * 17..n * 17 + 17];
                let d = &mut b[n * 21..n * 21 + 21];
                if o[11] > 15 || o[13] > 31 || o[15] > 63 {
                    return Err("reserved DX7 bits set".into());
                }
                d[..11].copy_from_slice(&o[..11]);
                d[11] = o[11] & 3;
                d[12] = o[11] >> 2;
                d[13] = o[12] & 7;
                d[14] = o[13] & 3;
                d[15] = o[13] >> 2;
                d[16] = o[14];
                d[17] = o[15] & 1;
                d[18] = o[15] >> 1;
                d[19] = o[16];
                d[20] = o[12] >> 3;
            }
            if p[110] > 31 || p[111] > 15 {
                return Err("reserved DX7 bits set".into());
            }
            b[126..134].copy_from_slice(&p[102..110]);
            b[134] = p[110];
            b[135] = p[111] & 7;
            b[136] = p[111] >> 3;
            b[137..141].copy_from_slice(&p[112..116]);
            b[141] = p[116] & 1;
            b[142] = (p[116] >> 1) & 7;
            b[143] = p[116] >> 4;
            b[144..155].copy_from_slice(&p[117..128]);
        } else {
            for n in 0..4 {
                let o = &p[n * 10..n * 10 + 10];
                let d = &mut b[n * 13..n * 13 + 13];
                d[..6].copy_from_slice(&o[..6]);
                d[6] = (o[9] >> 3) & 3;
                d[7] = (o[6] >> 3) & 7;
                d[8] = o[6] >> 6;
                d[9] = o[6] & 7;
                d[10] = o[7];
                d[11] = o[8];
                d[12] = o[9] & 7;
                v.aced[n * 5..n * 5 + 5].copy_from_slice(&[
                    (p[73 + n * 2] >> 3) & 1,
                    p[73 + n * 2] & 7,
                    p[74 + n * 2] & 15,
                    p[74 + n * 2] >> 4,
                    (p[73 + n * 2] >> 4) & 3,
                ]);
            }
            b[52] = p[40] & 7;
            b[53] = (p[40] >> 3) & 7;
            b[54..58].copy_from_slice(&p[41..45]);
            b[58] = p[40] >> 6;
            b[59] = p[45] & 3;
            b[60] = p[45] >> 4;
            b[61] = (p[45] >> 2) & 3;
            b[62] = p[46];
            b[63] = (p[48] >> 3) & 1;
            b[64] = p[47];
            b[65] = p[48] & 1;
            b[66] = p[49];
            b[67] = p[50];
            b[68] = (p[48] >> 2) & 1;
            b[69] = (p[48] >> 1) & 1;
            b[70] = (p[48] >> 4) & 1;
            b[71..77].copy_from_slice(&p[51..57]);
            b[77..93].copy_from_slice(&p[57..73]);
            v.aced[20..23].copy_from_slice(&p[81..84]);
            v.aced2[..4].copy_from_slice(&p[84..88]);
            v.effects.copy_from_slice(&p[91..94]);
        }
        v.validate()?;
        Ok(v)
    }

    pub fn dumps(&self, channel: u8) -> Vec<Vec<u8>> {
        let mut result = Vec::new();
        if self.model == Model::Ys200 {
            for (id, data) in EXTENSIONS.iter().zip([
                self.effects.as_slice(),
                self.aced2.as_slice(),
                self.aced.as_slice(),
            ]) {
                result.push(frame(126, &[id.as_slice(), data].concat(), channel));
            }
        }
        result.push(frame(
            if self.model == Model::Dx7 { 0 } else { 3 },
            &self.base,
            channel,
        ));
        result
    }
}

pub fn checksum(data: &[u8]) -> u8 {
    (0u8.wrapping_sub(data.iter().fold(0u8, |a, b| a.wrapping_add(*b)))) & 127
}
pub fn frame(format: u8, data: &[u8], channel: u8) -> Vec<u8> {
    let mut m = vec![
        240,
        67,
        channel,
        format,
        (data.len() >> 7) as u8,
        (data.len() & 127) as u8,
    ];
    m.extend(data);
    m.extend([checksum(data), 247]);
    m
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_roundtrip() {
        for model in [Model::Dx7, Model::Ys200] {
            let v = Voice::init(model);
            v.validate().unwrap();
            let u = Voice::unpack(model, &v.pack()).unwrap();
            assert_eq!(v.base, u.base);
            assert_eq!(v.aced, u.aced);
        }
    }
    #[test]
    fn packed_fields_are_independent() {
        let mut p = Voice::init(Model::Ys200).pack();
        p[6] = 0b1_101_011;
        p[9] = 0b10_110;
        p[73] = 0b10_1101; // SHIFT=2, FIX=1, range=5
        p[74] = 0b101_1100;
        p[100] = 111;
        let v = Voice::unpack(Model::Ys200, &p).unwrap();
        assert_eq!(&v.base[6..10], &[2, 5, 1, 3]);
        assert_eq!(&v.aced[..5], &[1, 5, 12, 5, 2]);
        assert_eq!(v.pack(), p);
    }
}
