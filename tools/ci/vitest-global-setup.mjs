// Runs once per test run: prints the property-test seed so a failure can be replayed (TS-8).
export default function setup() {
  const seed = process.env.FC_SEED ?? "1";
  const runs = process.env.FC_RUNS ?? "100";
  console.info(`[mandi] property tests: seed=${seed} runs=${runs} (replay with FC_SEED=${seed})`);
}
