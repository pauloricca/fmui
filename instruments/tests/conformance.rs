use yamaha_instruments::{
    device::Device,
    midi::Decoder,
    sound::{BLOCK, RATE, Synth},
    voice::{Model, Voice},
};

fn deliver(d: &mut Device, bytes: &[u8]) {
    let mut parser = Decoder::default();
    // Arbitrary fragmentation exercises SysEx transport framing too.
    for chunk in bytes.chunks(17) {
        for m in parser.feed(chunk) {
            d.receive(1, &m).unwrap();
        }
    }
}
#[test]
fn editor_generated_voices_parameters_and_banks() {
    for (model, original, edits, final_voice, bank) in [
        (
            Model::Dx7,
            include_bytes!("fixtures/dx7-original.syx").as_slice(),
            include_bytes!("fixtures/dx7-edits.syx").as_slice(),
            include_bytes!("fixtures/dx7-final.syx").as_slice(),
            include_bytes!("fixtures/dx7-bank.syx").as_slice(),
        ),
        (
            Model::Ys200,
            include_bytes!("fixtures/ys200-original.syx").as_slice(),
            include_bytes!("fixtures/ys200-edits.syx").as_slice(),
            include_bytes!("fixtures/ys200-final.syx").as_slice(),
            include_bytes!("fixtures/ys200-bank.syx").as_slice(),
        ),
    ] {
        let mut d = Device::new(model, 0, 0);
        deliver(&mut d, original);
        assert_eq!(d.synth.voice.dumps(0).concat(), original);
        deliver(&mut d, edits);
        assert_eq!(d.synth.voice.dumps(0).concat(), final_voice);
        deliver(&mut d, bank);
        assert_eq!(d.bank_dump(), bank);
        d.receive(1, &[192, 17]).unwrap();
        assert_eq!(
            d.synth.voice.base,
            Voice::unpack(model, &bank[6 + 17 * 128..6 + 18 * 128])
                .unwrap()
                .base
        );
    }
}

fn render(v: Voice, key: u8, seconds: f32) -> Vec<f32> {
    let mut s = Synth::new(v);
    s.note_on(key, 127);
    let mut out = [[0.; 2]; BLOCK];
    let mut result = Vec::new();
    for _ in 0..(seconds * RATE as f32 / BLOCK as f32).ceil() as usize {
        s.render(&mut out);
        result.extend(out.map(|x| x[0]));
    }
    result
}
fn frequency(samples: &[f32]) -> f32 {
    let s = &samples[samples.len() / 2..];
    let mut crossings = Vec::new();
    for (i, w) in s.windows(2).enumerate() {
        if w[0] <= 0. && w[1] > 0. {
            crossings.push(i as f32 - w[0] / (w[1] - w[0]));
        }
    }
    if crossings.len() < 2 {
        return 0.;
    }
    (crossings.len() - 1) as f32 * RATE as f32 / (crossings.last().unwrap() - crossings[0])
}
#[test]
fn concert_pitch_ratio_fixed_and_bend() {
    for model in [Model::Dx7, Model::Ys200] {
        let v = Voice::init(model);
        let f = frequency(&render(v.clone(), 69, 0.5));
        assert!((f - 440.).abs() < 2., "{model:?} A4 measured {f}");
        let high = frequency(&render(v.clone(), 81, 0.5));
        assert!((high / f - 2.).abs() < 0.01);
        let mut fixed = v;
        let expected = if model == Model::Dx7 {
            fixed.base[122] = 1;
            fixed.base[123] = 2;
            fixed.base[124] = 0;
            100.
        } else {
            fixed.aced[15] = 1;
            fixed.aced[16] = 2;
            fixed.aced[17] = 4;
            fixed.base[50] = 24;
            400.
        };
        let a = frequency(&render(fixed.clone(), 48, 0.5));
        let b = frequency(&render(fixed, 84, 0.5));
        assert!(
            (a - expected).abs() < 2.,
            "{model:?} fixed {a}, expected {expected}"
        );
        assert!((a - b).abs() < 0.1);
        let mut s = Synth::new(Voice::init(model));
        s.note_on(69, 127);
        s.controllers.bend = 1.;
        let mut out = [[0.; 2]; BLOCK];
        let mut bent = Vec::new();
        for _ in 0..50 {
            s.render(&mut out);
            bent.extend(out.map(|x| x[0]));
        }
        assert!(
            (frequency(&bent) - 493.88).abs() < 2.,
            "{model:?} bend {}",
            frequency(&bent)
        );
    }
}

#[test]
fn all_algorithm_carriers_match_yamaha_diagrams() {
    // Human operator numbering, with OP1 represented by bit zero.
    let dx_carriers = [
        0b000101, 0b000101, 0b001001, 0b001001, 0b010101, 0b010101, 0b000101, 0b000101, 0b000101,
        0b001001, 0b001001, 0b000101, 0b000101, 0b000101, 0b000101, 0b000001, 0b000001, 0b000001,
        0b011001, 0b001011, 0b011011, 0b011101, 0b011011, 0b011111, 0b011111, 0b001011, 0b001011,
        0b100101, 0b010111, 0b100111, 0b011111, 0b111111,
    ];
    let ys_carriers = [1, 1, 1, 1, 5, 7, 7, 15];
    for model in [Model::Dx7, Model::Ys200] {
        let count = if model == Model::Dx7 { 6 } else { 4 };
        let carriers = if model == Model::Dx7 {
            dx_carriers.as_slice()
        } else {
            ys_carriers.as_slice()
        };
        for (alg, expected) in carriers.iter().enumerate() {
            for op in 0..count {
                let mut v = Voice::init(model);
                v.mask = 1 << (count - 1 - op);
                if model == Model::Dx7 {
                    v.base[134] = alg as u8;
                    for n in 0..6 {
                        v.base[n * 21 + 16] = 99;
                    }
                } else {
                    v.base[52] = alg as u8;
                    for n in 0..4 {
                        v.base[n * 13 + 10] = 99;
                    }
                }
                let samples = render(v, 69, 0.03);
                let peak = samples.iter().fold(0f32, |a, b| a.max(b.abs()));
                assert_eq!(
                    peak > 0.005,
                    expected & (1 << op) != 0,
                    "{model:?} algorithm {} OP{} peak {peak}",
                    alg + 1,
                    op + 1
                );
            }
        }
    }
}

#[test]
fn ys_waveforms_are_distinct_and_decay_zero_holds() {
    let mut waves = Vec::new();
    for wave in 0..8 {
        let mut v = Voice::init(Model::Ys200);
        v.aced[18] = wave;
        waves.push(render(v, 69, 0.1));
    }
    for i in 0..8 {
        for j in i + 1..8 {
            let distance: f32 = waves[i]
                .iter()
                .zip(&waves[j])
                .map(|(a, b)| (a - b).abs())
                .sum();
            assert!(distance > 1., "waves {i}/{j} are identical");
        }
    }
    let mut v = Voice::init(Model::Ys200);
    v.base[43] = 1;
    v.base[40] = 0;
    let held = render(v, 69, 1.);
    assert!(held[40000..].iter().any(|x| x.abs() > 0.02));
}

#[test]
fn memory_persistence_and_bad_state_rejection() {
    for model in [Model::Dx7, Model::Ys200] {
        let path = std::env::temp_dir().join(format!(
            "yamaha-test-{}-{}.bin",
            std::process::id(),
            model.name()
        ));
        let mut d = Device::new(model, 0, 0);
        d.synth.voice.base[0] = 12;
        d.store(3).unwrap();
        d.save(&path).unwrap();
        let mut restored = Device::new(model, 0, 0);
        restored.load(&path).unwrap();
        assert_eq!(d.synth.voice, restored.synth.voice);
        assert_eq!(d.bank, restored.bank);
        std::fs::write(&path, b"broken").unwrap();
        assert!(restored.load(&path).is_err());
        std::fs::remove_file(path).unwrap();
    }
}
