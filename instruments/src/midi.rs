//! Stateful byte-stream decoder, also accepts complete Web MIDI packets.
#[derive(Default)]
pub struct Decoder {
    running: u8,
    needed: usize,
    bytes: Vec<u8>,
    sysex: bool,
}
impl Decoder {
    pub fn feed(&mut self, data: &[u8]) -> Vec<Vec<u8>> {
        let mut messages = Vec::new();
        for &b in data {
            if b >= 248 {
                messages.push(vec![b]);
                continue;
            }
            if self.sysex {
                if b == 247 {
                    self.bytes.push(b);
                    messages.push(std::mem::take(&mut self.bytes));
                    self.sysex = false;
                    continue;
                }
                if b < 128 {
                    if self.bytes.len() < 65535 {
                        self.bytes.push(b);
                    } else {
                        self.bytes.clear();
                        self.sysex = false;
                    }
                    continue;
                }
                self.bytes.clear();
                self.sysex = false;
            }
            if b == 240 {
                self.running = 0;
                self.bytes = vec![b];
                self.sysex = true;
                continue;
            }
            if b >= 128 {
                self.bytes.clear();
                self.running = if b < 240 { b } else { 0 };
                self.needed = match b {
                    128..=191 | 224..=239 => 2,
                    192..=223 | 241 | 243 => 1,
                    242 => 2,
                    _ => 0,
                };
                if self.needed == 0 {
                    messages.push(vec![b]);
                } else {
                    self.bytes.push(b);
                }
            } else {
                if self.bytes.is_empty() {
                    if self.running == 0 {
                        continue;
                    }
                    self.bytes.push(self.running);
                }
                self.bytes.push(b);
                if self.bytes.len() == self.needed + 1 {
                    messages.push(std::mem::take(&mut self.bytes));
                }
            }
        }
        messages
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn running_status_and_realtime() {
        let mut d = Decoder::default();
        assert!(d.feed(&[144, 60]).is_empty());
        assert_eq!(
            d.feed(&[248, 100, 61, 0]),
            vec![vec![248], vec![144, 60, 100], vec![144, 61, 0]]
        );
        assert_eq!(
            d.feed(&[240, 67, 0, 248, 247]),
            vec![vec![248], vec![240, 67, 0, 247]]
        );
        assert!(d.feed(&[60, 127]).is_empty());
    }
}
