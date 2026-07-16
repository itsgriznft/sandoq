# The factory embeds the circle's contract spec via `contractimport!`, so the
# circle wasm has to exist before the factory can be compiled or tested.
#
# `stellar contract build` produces a smaller, metadata-rich wasm and is what
# deployments use. Plain cargo emits an equivalent module — bigger, since it
# skips the optimizer — which is enough to compile and test the factory against.
# CI therefore needs no extra tooling.

CIRCLE_WASM  := target/wasm32v1-none/release/circle.wasm
FACTORY_WASM := target/wasm32v1-none/release/factory.wasm

STELLAR := $(shell command -v stellar 2>/dev/null)
ifdef STELLAR
  BUILD := stellar contract build --package
else
  BUILD := cargo build --locked --target wasm32v1-none --release --package
endif

.PHONY: all build circle factory test fmt clean

all: build

build: factory

circle:
	$(BUILD) circle

factory: circle
	$(BUILD) factory

test: circle
	cargo test --locked

fmt:
	cargo fmt --all

clean:
	cargo clean
