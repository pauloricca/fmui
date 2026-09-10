use std::{
    collections::{HashMap, HashSet},
    net::{Shutdown, TcpListener, TcpStream},
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
        mpsc::{self, SyncSender, TrySendError},
    },
    thread,
    time::{Duration, Instant},
};
use yamaha_instruments::{
    device::Device,
    midi::Decoder,
    sound::{BLOCK, RATE},
    voice::Model,
    wire,
};

type Packet = (u8, Vec<u8>);
enum Event {
    Connect(u64, SyncSender<Packet>, TcpStream),
    Packet(u64, u8, Vec<u8>),
    Disconnect(u64),
}
struct Peer {
    sender: SyncSender<Packet>,
    socket: TcpStream,
    subscription: u8,
    decoder: Decoder,
    keys: HashSet<u8>,
    sustain: bool,
}

fn main() {
    if let Err(e) = run() {
        eprintln!("instrument: {e}");
        std::process::exit(1);
    }
}
fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    if args.get(1).is_some_and(|x| x == "--health") {
        let mut stream = TcpStream::connect_timeout(
            &args.get(2).ok_or("health address missing")?.parse()?,
            Duration::from_secs(2),
        )?;
        stream.set_read_timeout(Some(Duration::from_secs(2)))?;
        let (kind, _) = wire::read(&mut stream)?;
        if kind != 5 {
            return Err("unexpected greeting".into());
        }
        return Ok(());
    }
    let mut model = Model::Dx7;
    let mut address = "0.0.0.0:7000".to_string();
    let mut channel = 0;
    let mut tx_channel = None;
    let mut state = None;
    let mut i = 1;
    while i < args.len() {
        let value = args.get(i + 1).ok_or("each option requires a value")?;
        match args[i].as_str() {
            "--model" => {
                model = match value.as_str() {
                    "dx7" => Model::Dx7,
                    "ys200" => Model::Ys200,
                    _ => return Err("model must be dx7 or ys200".into()),
                }
            }
            "--listen" => address = value.clone(),
            "--channel" => channel = parse_channel(value)?,
            "--tx-channel" => tx_channel = Some(parse_channel(value)?),
            "--state" => state = Some(PathBuf::from(value)),
            _ => return Err(format!("unknown option {}", args[i]).into()),
        }
        i += 2;
    }
    let mut device = Device::new(
        model,
        channel,
        tx_channel.unwrap_or(if model == Model::Dx7 { 0 } else { channel }),
    );
    if let Some(path) = &state
        && path.exists()
    {
        device
            .load(path)
            .map_err(|e| format!("{}: {e}; state was not overwritten", path.display()))?;
    }
    let listener = TcpListener::bind(&address)?;
    eprintln!(
        "{} ready on {}; MIDI RX {} / TX {}, 48 kHz stereo, {} voices",
        model.name(),
        address,
        channel + 1,
        device.tx_channel + 1,
        model.polyphony()
    );
    let (sender, events) = mpsc::sync_channel::<Event>(1024);
    thread::spawn(move || {
        let count = Arc::new(AtomicUsize::new(0));
        let mut next_id = 0;
        for stream in listener.incoming() {
            let Ok(mut input) = stream else { continue };
            if count.load(Ordering::Relaxed) >= 16 {
                let _ = input.shutdown(Shutdown::Both);
                continue;
            }
            count.fetch_add(1, Ordering::Relaxed);
            next_id += 1;
            let id = next_id;
            let _ = input.set_nodelay(true);
            let _ = input.set_read_timeout(Some(Duration::from_secs(30)));
            let mut output = input.try_clone().unwrap();
            let socket = input.try_clone().unwrap();
            let _ = output.set_write_timeout(Some(Duration::from_secs(2)));
            let (tx, rx) = mpsc::sync_channel::<Packet>(64);
            if sender.send(Event::Connect(id, tx, socket)).is_err() {
                break;
            }
            thread::spawn(move || {
                while let Ok((kind, payload)) = rx.recv() {
                    if wire::write(&mut output, kind, &payload).is_err() {
                        break;
                    }
                }
                let _ = output.shutdown(Shutdown::Both);
            });
            let sender = sender.clone();
            let count = count.clone();
            thread::spawn(move || {
                while let Ok((kind, data)) = wire::read(&mut input) {
                    if sender.send(Event::Packet(id, kind, data)).is_err() {
                        break;
                    }
                }
                let _ = input.shutdown(Shutdown::Both);
                let _ = sender.send(Event::Disconnect(id));
                count.fetch_sub(1, Ordering::Relaxed);
            });
        }
    });
    let mut peers: HashMap<u64, Peer> = HashMap::new();
    let mut next = Instant::now();
    let mut last_save = Instant::now();
    let period = Duration::from_secs_f64(BLOCK as f64 / RATE as f64);
    let mut audio = [[0.; 2]; BLOCK];
    loop {
        for event in events.try_iter().take(256) {
            match event {
                Event::Connect(id, sender, socket) => {
                    let _ = sender.try_send((5, device.status().into_bytes()));
                    peers.insert(
                        id,
                        Peer {
                            sender,
                            socket,
                            subscription: 1,
                            decoder: Decoder::default(),
                            keys: HashSet::new(),
                            sustain: false,
                        },
                    );
                }
                Event::Disconnect(id) => {
                    if let Some(peer) = peers.remove(&id) {
                        if peer.sustain && !peers.values().any(|p| p.sustain) {
                            device.synth.control(64, 0);
                        }
                        for key in peer.keys {
                            if !peers.values().any(|p| p.keys.contains(&key)) {
                                device.synth.note_off(key);
                            }
                        }
                        let _ = peer.socket.shutdown(Shutdown::Both);
                    }
                    device.disconnect(id);
                }
                Event::Packet(id, kind, data) => {
                    let Some(peer) = peers.get_mut(&id) else {
                        continue;
                    };
                    let result: Result<Vec<Vec<u8>>, String> = match kind {
                        1 => {
                            let mut replies = Vec::new();
                            let mut error = None;
                            for message in peer.decoder.feed(&data) {
                                if message[0] & 15 == device.channel && message.len() == 3 {
                                    match message[0] & 0xf0 {
                                        0x90 if message[2] > 0 => {
                                            peer.keys.insert(message[1]);
                                        }
                                        0x80 | 0x90 => {
                                            peer.keys.remove(&message[1]);
                                        }
                                        0xb0 if message[1] == 64 => peer.sustain = message[2] >= 64,
                                        _ => {}
                                    }
                                }
                                match device.receive(id, &message) {
                                    Ok(m) => replies.extend(m),
                                    Err(e) => {
                                        error = Some(e);
                                        break;
                                    }
                                }
                            }
                            if let Some(e) = error {
                                Err(e)
                            } else {
                                Ok(replies)
                            }
                        }
                        4 => {
                            if data.len() == 1 && data[0] <= 3 {
                                peer.subscription = data[0];
                                Ok(vec![])
                            } else {
                                Err("subscription requires one mask byte (0–3)".into())
                            }
                        }
                        3 => command(&mut device, &data),
                        _ => Err("unsupported packet kind".into()),
                    };
                    match result {
                        Ok(messages) => {
                            for message in messages {
                                broadcast(&mut peers, 1, &message, 1);
                            }
                            if kind == 3 || kind == 4 {
                                send(&mut peers, id, 5, device.status().into_bytes());
                            }
                        }
                        Err(error) => {
                            send(&mut peers, id, 6, error.into_bytes());
                        }
                    }
                }
            }
        }
        device.expire();
        device.synth.render(&mut audio);
        if peers.values().any(|p| p.subscription & 2 != 0) {
            let data: Vec<u8> = audio
                .iter()
                .flat_map(|f| f.iter().flat_map(|x| x.to_le_bytes()))
                .collect();
            broadcast(&mut peers, 2, &data, 2);
        }
        if device.changed && last_save.elapsed() > Duration::from_millis(250) {
            if let Some(path) = &state
                && let Err(e) = device.save(path)
            {
                eprintln!("state save failed: {e}");
            }
            last_save = Instant::now();
        }
        next += period;
        let now = Instant::now();
        if next > now {
            thread::sleep(next - now);
        } else if now.duration_since(next) > period * 4 {
            next = now;
        }
    }
}
fn parse_channel(s: &str) -> Result<u8, Box<dyn std::error::Error>> {
    let c: u8 = s.parse()?;
    if !(1..=16).contains(&c) {
        return Err("channel must be 1–16".into());
    }
    Ok(c - 1)
}
fn command(d: &mut Device, data: &[u8]) -> Result<Vec<Vec<u8>>, String> {
    match data {
        [0]=>Ok(d.synth.voice.dumps(d.tx_channel)),[1]=>Ok(vec![d.bank_dump()]),
        [2,slot]=>{d.store(*slot as usize)?;Ok(vec![])},[3]=>{d.synth.panic();Ok(vec![])},[4]=>Ok(vec![]),
        [5,start] if *start as usize+32<=d.bank.len()=>{d.bank_start=*start as usize;d.changed=true;Ok(vec![])},
        [6] if d.synth.voice.model==Model::Dx7=>Ok((64..78).map(|i|vec![240,67,16+d.tx_channel,8,i,d.synth.functions[i as usize],247]).collect()),
        _=>Err("command: 0 dump voice, 1 dump bank, 2+slot store, 3 panic, 4 status, 5+start bank window, 6 DX7 functions".into()),
    }
}
fn send(peers: &mut HashMap<u64, Peer>, id: u64, kind: u8, data: Vec<u8>) {
    if peers
        .get(&id)
        .is_some_and(|p| p.sender.try_send((kind, data)).is_err())
        && let Some(p) = peers.get(&id)
    {
        let _ = p.socket.shutdown(Shutdown::Both);
    }
}
fn broadcast(peers: &mut HashMap<u64, Peer>, kind: u8, data: &[u8], mask: u8) {
    peers.retain(|_, p| {
        if p.subscription & mask == 0 {
            return true;
        }
        match p.sender.try_send((kind, data.to_vec())) {
            Ok(()) => true,
            Err(TrySendError::Full(_)) if kind == 2 => true,
            Err(_) => {
                let _ = p.socket.shutdown(Shutdown::Both);
                // Keep note ownership until the reader posts Disconnect.
                true
            }
        }
    });
}
