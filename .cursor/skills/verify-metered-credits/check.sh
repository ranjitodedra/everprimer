#!/bin/sh
# Model-check metered credits. One argument: good, drop_close, drop_cap, or drop_ledger.
# good must exit 0. The other three must exit non-zero; a zero exit there means the check cannot fail.
set -eu
cd "$(dirname "$0")"
MODE="${1:-good}"
case "$MODE" in
  good|drop_close|drop_cap|drop_ledger) ;;
  *)
    echo "usage: ./check.sh good|drop_close|drop_cap|drop_ledger" >&2
    exit 2
    ;;
esac

JAR="tools/tla2tools-1.7.4.jar"
if [ ! -f "$JAR" ]; then
  mkdir -p tools
  curl -fsSL -o "$JAR" "https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar"
fi

mkdir -p run
CFG="run/Credits.${MODE}.cfg"
cat > "$CFG" <<EOF
SPECIFICATION Spec
CONSTANTS
  InitialBalance = 100
  Mode = "${MODE}"
CONSTRAINT StepsBound
INVARIANT NonNegative
INVARIANT Conserved
INVARIANT ClosedOnce
CHECK_DEADLOCK FALSE
EOF

java -XX:+UseParallelGC -cp "$JAR" tlc2.TLC -config "$CFG" -workers 1 Credits.tla
