use std::{env, path::PathBuf, process::Command};

fn run(command: &mut Command) {
    assert!(
        command.status().expect("start native compiler").success(),
        "native build failed"
    );
}

fn main() {
    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let compiler = env::var("CXX").unwrap_or_else(|_| "c++".into());
    let sources = ["vendor/ymfm/ymfm_opz.cpp", "native/opz.cpp"];
    let mut objects = Vec::new();
    for (i, source) in sources.iter().enumerate() {
        let object = out.join(format!("opz{i}.o"));
        run(Command::new(&compiler)
            .args([
                "-std=c++14",
                "-O2",
                "-fPIC",
                "-Ivendor/ymfm",
                "-c",
                source,
                "-o",
            ])
            .arg(&object));
        objects.push(object);
    }
    run(Command::new("ar")
        .arg("crs")
        .arg(out.join("libopz.a"))
        .args(&objects));
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=opz");
    println!(
        "cargo:rustc-link-lib={}",
        if env::var("CARGO_CFG_TARGET_OS").unwrap() == "macos" {
            "c++"
        } else {
            "stdc++"
        }
    );
    println!("cargo:rerun-if-changed=native");
    println!("cargo:rerun-if-changed=vendor/ymfm");
}
