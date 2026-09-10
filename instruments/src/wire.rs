//! Local bridge protocol: u32 big-endian length, u8 kind, payload.
//! Kinds: 1 raw MIDI; 2 interleaved stereo f32 LE audio; 3 command;
//! 4 subscription mask (MIDI=1/audio=2); 5 status JSON; 6 error UTF-8.
use std::io::{self, Read, Write};
pub const MAX_PACKET: usize = 65536;
pub fn read(reader: &mut impl Read) -> io::Result<(u8, Vec<u8>)> {
    let mut header = [0; 4];
    reader.read_exact(&mut header)?;
    let len = u32::from_be_bytes(header) as usize;
    if !(1..=MAX_PACKET).contains(&len) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "packet length outside bounds",
        ));
    }
    let mut data = vec![0; len];
    reader.read_exact(&mut data)?;
    Ok((data[0], data[1..].to_vec()))
}
pub fn write(writer: &mut impl Write, kind: u8, payload: &[u8]) -> io::Result<()> {
    if payload.len() + 1 > MAX_PACKET {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "oversize packet",
        ));
    }
    writer.write_all(&((payload.len() + 1) as u32).to_be_bytes())?;
    writer.write_all(&[kind])?;
    writer.write_all(payload)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn framing() {
        let mut b = Vec::new();
        write(&mut b, 1, &[144, 60, 99]).unwrap();
        assert_eq!(read(&mut b.as_slice()).unwrap(), (1, vec![144, 60, 99]));
        assert!(read(&mut [255, 255, 255, 255].as_slice()).is_err());
    }
}
