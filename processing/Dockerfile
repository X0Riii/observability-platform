FROM rust:1.96-slim-bookworm AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src/ src/
RUN cargo build --release

FROM gcr.io/distroless/cc-debian12
COPY --from=builder /app/target/release/observability-processor /usr/local/bin/
EXPOSE 9100
ENV LISTEN_ADDR=0.0.0.0:9100
CMD ["observability-processor"]
