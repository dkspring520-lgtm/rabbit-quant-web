import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  buildReproducibilityMetadata,
  DEFAULT_FACTOR_REGISTRY,
  FactorBacktestEngine,
  FactorClosureBacktestEngine,
  FactorCombinationBacktestEngine,
  FACTOR_REGISTRY_VERSION,
  persistValidatedFactorLibrary,
  selectValidatedFactors,
  sha256,
  stableStringify,
  writeImmutableJson,
} from "../lib/factor-research/index.mjs";

function argumentsFrom(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    output[key] = next && !next.startsWith("--") ? argv[++index] : true;
  }
  return output;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/run-factor-research.mjs --input <sessions.jsonl|json> --output <directory>",
    "Options:",
    "  --dataset-id <id>       Stable dataset identifier",
    "  --factor <factorId,...>  Run a subset of registered factors",
    "  --combinations           Also run Phase 1B predefined combinations",
    "  --closures               Also run Phase 1C first-touch closure research",
    "  --closure-control <n>     Shadow cost-coverage control (default: 1.5)",
    "  --dataset-manifest <file> Reference the immutable Phase 1D source manifest",
    "  --recipe <recipeId,...>  Run a subset of Phase 1B combinations",
    "  --as-of <timestamp>      Research cutoff recorded in metadata",
  ].join("\n");
}

async function loadSessions(filePath) {
  const contents = await readFile(filePath, "utf8");
  if (path.extname(filePath).toLowerCase() === ".jsonl") {
    return contents.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
  }
  const parsed = JSON.parse(contents);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.sessions)) return parsed.sessions;
  if (parsed.session) return [parsed.session];
  throw new Error("Input must be a session array, {sessions}, {session}, or JSONL sessions");
}

const args = argumentsFrom(process.argv.slice(2));
if (!args.input || !args.output) {
  console.error(usage());
  process.exitCode = 1;
} else {
  const input = path.resolve(String(args.input));
  const output = path.resolve(String(args.output));
  const sessions = await loadSessions(input);
  const inputFileChecksum = sha256(await readFile(input));
  const datasetManifest = args["dataset-manifest"]
    ? JSON.parse(await readFile(path.resolve(String(args["dataset-manifest"])), "utf8"))
    : null;
  const factorIds = args.factor ? String(args.factor).split(",").map(value => value.trim()).filter(Boolean) : null;
  const engine = new FactorBacktestEngine();
  const backtest = engine.run(sessions, { factorIds });
  const combinations = args.combinations
    ? new FactorCombinationBacktestEngine().run(sessions, {
      recipeIds: args.recipe ? String(args.recipe).split(",").map(value => value.trim()).filter(Boolean) : null,
    })
    : null;
  const closures = args.closures
    ? new FactorClosureBacktestEngine().run(sessions, {
      recipeIds: args.recipe ? String(args.recipe).split(",").map(value => value.trim()).filter(Boolean) : null,
    })
    : null;
  const closureControlMultiple = args["closure-control"] === undefined
    ? 1.5
    : Number(args["closure-control"]);
  if (args.closures && (!Number.isFinite(closureControlMultiple) || closureControlMultiple <= 0)) {
    throw new Error("--closure-control must be a positive number");
  }
  const closureControl = args.closures
    ? {
      comparisonId: `cost-coverage-${closureControlMultiple}x`,
      role: "shadow-control-only",
      selectionScope: "rolling-development-only-excludes-locked-test",
      lockedTestMaySelectModel: false,
      result: new FactorClosureBacktestEngine().run(sessions, {
        recipeIds: args.recipe ? String(args.recipe).split(",").map(value => value.trim()).filter(Boolean) : null,
        costCoverageMultiple: closureControlMultiple,
      }),
    }
    : null;
  const metadata = buildReproducibilityMetadata({
    sessions,
    datasetId: args["dataset-id"] ? String(args["dataset-id"]) : path.basename(input),
    engineVersion: [backtest.engineVersion, combinations?.engineVersion, closures?.engineVersion].filter(Boolean).join("+"),
    factorVersion: FACTOR_REGISTRY_VERSION,
    config: combinations || closures
      ? {
        factor: backtest.config,
        combinations: combinations?.config ?? null,
        closures: closures?.config ?? null,
        closureControl: closureControl?.result.config ?? null,
      }
      : backtest.config,
    asOf: args["as-of"] ? String(args["as-of"]) : null,
  });
  if (datasetManifest?.datasetChecksum && datasetManifest.datasetChecksum !== inputFileChecksum) {
    throw new Error(`Dataset manifest checksum mismatch: ${datasetManifest.datasetChecksum} != ${inputFileChecksum}`);
  }
  const datasetManifestReference = datasetManifest ? {
    path: path.resolve(String(args["dataset-manifest"])),
    checksum: sha256(datasetManifest),
    datasetId: datasetManifest.datasetId ?? null,
    datasetChecksum: datasetManifest.datasetChecksum ?? null,
    inputFileChecksum,
    sourceDateRange: datasetManifest.sourceDateRange ?? null,
  } : null;
  const report = {
    metadata,
    datasetManifest: datasetManifestReference,
    registry: DEFAULT_FACTOR_REGISTRY.snapshot(),
    backtest,
    combinations,
    closures,
    closureControl,
  };
  await mkdir(output, { recursive: true });
  const reportPath = path.join(output, `factor-research-${metadata.datasetChecksum.slice(0, 12)}-${metadata.configHash.slice(0, 12)}.json`);
  await writeImmutableJson(reportPath, report);
  const accepted = selectValidatedFactors(backtest, DEFAULT_FACTOR_REGISTRY);
  const library = await persistValidatedFactorLibrary({
    outputDirectory: path.join(output, "factor-library"),
    entries: accepted,
    metadata,
  });
  console.log(stableStringify({
    reportPath,
    datasetId: metadata.datasetId,
    datasetChecksum: metadata.datasetChecksum,
    sessions: backtest.coverage.sessions,
    factors: backtest.coverage.factors,
    evaluations: backtest.coverage.reports,
    combinationEvaluations: combinations?.coverage.reports ?? 0,
    closureEvaluations: closures?.coverage.reports ?? 0,
    closureControlEvaluations: closureControl?.result.coverage.reports ?? 0,
    closureControlMultiple: closureControl?.result.config.costCoverageMultiple ?? null,
    closurePricePathMode: closures?.pricePathMode ?? null,
    minuteOhlcClassification: closures?.dataAudit.ohlc.classification ?? null,
    datasetManifest: datasetManifestReference,
    closureRollingFolds: closures?.reports.reduce((sum, item) => sum + item.rollingOutOfSample.folds.length, 0) ?? 0,
    leakageAuditPassed: backtest.antiOverfitting.futureLeakageAudit.pass,
    validatedLibraryEntries: library.length,
  }, 2));
}
