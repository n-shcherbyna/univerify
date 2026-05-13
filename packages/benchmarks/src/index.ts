#!/usr/bin/env node
import { stageDeploy } from "./stages/deploy.js";
import { stageMeasure } from "./stages/measure.js";
import { stagePrice } from "./stages/price.js";
import { stageExport } from "./stages/export.js";
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
      await stageMeasure({ only, resume });
      return;
    }
    case "export": {
      const resultsPath = argValue(rest, "results");
      const pricesPath = argValue(rest, "prices");
      stageExport({ resultsPath, pricesPath });
      return;
    }
    case "all": {
      await stageMeasure({});
      await stagePrice();
      stageExport({});
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
        "Usage: benchmarks {deploy|measure|price|export|all|smoke} [--chain=KEY] [--resume=RUN_ID]"
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
