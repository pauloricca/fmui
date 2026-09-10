FROM rust:1.90-bookworm AS build
WORKDIR /build
COPY . .
RUN cargo build --release --offline --locked && cargo test --offline --locked

FROM debian:bookworm-slim
RUN groupadd --gid 10001 synth && useradd --uid 10001 --gid synth --no-create-home synth \
    && mkdir /data && chown synth:synth /data
COPY --from=build /build/target/release/yamaha-instruments /usr/local/bin/yamaha-instruments
COPY vendor/ymfm/LICENSE /usr/share/licenses/yamaha-instruments/ymfm-LICENSE
COPY vendor/dx7/src/lib.rs /usr/share/licenses/yamaha-instruments/dx7-source-notice
COPY LICENSE THIRD_PARTY.md /usr/share/licenses/yamaha-instruments/
USER synth
EXPOSE 7000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 CMD ["yamaha-instruments", "--health", "127.0.0.1:7000"]
ENTRYPOINT ["yamaha-instruments"]
