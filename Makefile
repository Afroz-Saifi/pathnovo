# Pathnovo — task shortcuts. Thin wrappers over pnpm/tsx.
# Targets land as slices do; unimplemented ones announce themselves.

.PHONY: install delta synth run chat eval markup demo

install:
	corepack enable && pnpm install

# Slice 1: compute a delta between two native PDFs.
#   make delta A=path/to/revA.pdf B=path/to/revB.pdf
delta:
	pnpm --filter @pathnovo/api delta -- "$(A)" "$(B)"

# Synthesize sample rev-B docs from a seed + emit ground truth.
synth:
	pnpm tsx scripts/synthesize-pairs.ts

run:   ; @echo "run: lands with slice 2 (API + docker)."
chat:  ; @echo "chat: lands with slice 4."
eval:  ; @echo "eval: lands with slice 5."
markup:; @echo "markup: lands with slice 3 (bonus)."
demo:  ; @echo "demo: lands with slice 3."
