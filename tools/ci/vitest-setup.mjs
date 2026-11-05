// Runs in every test file. Property tests are repeatable: the seed is fixed unless FC_SEED is set,
// and the nightly run sets it to the run number (document 09, TS-8: seeds are printed with every result).
import fc from "fast-check";

const seed = Number.parseInt(process.env.FC_SEED ?? "1", 10);
const numRuns = Number.parseInt(process.env.FC_RUNS ?? "100", 10);
fc.configureGlobal({ seed, numRuns });
