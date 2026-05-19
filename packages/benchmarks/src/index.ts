#!/usr/bin/env node
import { stageDeploy } from "./stages/deploy.js";
import { stageMeasure } from "./stages/measure.js";
import { stagePrice } from "./stages/price.js";
import { stageExport } from "./stages/export.js";
import { stageAggregate } from "./stages/aggregate.js";
import type { ChainKey } from "./config.js";

function argValue(args: string[], flag: string): string | undefined {
  const match = args.find((a) => a.startsWith(`--${flag}=`));
  return match?.slice(flag.length + 3);
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  switch (command) {
    case "deploy": {
      const only = argValue(rest, "chain") as ChainKey | undefined;
      await stageDeploy(only);
      return;
    }
    case "price": {
      await stagePrice();
      return;
    }
    case "measure": {
      const only = argValue(rest, "chain") as ChainKey | undefined;
      const resume = argValue(rest, "resume");
      const runLabel = argValue(rest, "runLabel");
      await stageMeasure({ only, resume, runLabel });
      return;
    }
    case "export": {
      const resultsPath = argValue(rest, "results");
      const pricesPath = argValue(rest, "prices");
      stageExport({ resultsPath, pricesPath });
      return;
    }
    case "aggregate": {
      const runsDir = argValue(rest, "dir");
      stageAggregate({ runsDir });
      return;
    }
    case "all": {
      const only = argValue(rest, "chain") as ChainKey | undefined;
      const runs = Number(argValue(rest, "runs") ?? "1");
      if (!Number.isInteger(runs) || runs < 1) {
        throw new Error(`--runs must be a positive integer, got ${runs}`);
      }
      await stageDeploy(only);
      for (let r = 1; r <= runs; r++) {
        if (runs > 1) console.log(`[all] run ${r}/${runs}`);
        await stageMeasure({
          only,
          runLabel: runs > 1 ? `run-${r}` : undefined,
        });
      }
      await stagePrice();
      if (runs > 1) {
        const aggregated = stageAggregate({});
        stageExport({ resultsPath: aggregated });
      } else {
        stageExport({});
      }
      return;
    }
    case "smoke": {
      const only = (argValue(rest, "chain") as ChainKey | undefined) ?? "sepolia";
      await stageMeasure({ only });
      await stagePrice();
      stageExport({});
      return;
    }
    default:
      console.error(
        "Usage: benchmarks {deploy|measure|price|export|aggregate|all|smoke} [--chain=KEY] [--resume=RUN_ID] [--runs=N]"
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
