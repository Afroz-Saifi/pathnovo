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

# Delta P/R/F1 always; chat metrics too when the API is running.
eval:
	pnpm --filter @pathnovo/eval eval

# Compare two eval result files for regressions.
#   make eval-compare A=eval/results/<a>.json B=eval/results/<b>.json
eval-compare:
	pnpm --filter @pathnovo/eval eval:compare -- "$(A)" "$(B)"

markup:; @echo "markup: lands with slice 3 (bonus)."
demo:  ; @echo "demo: lands with slice 3."
