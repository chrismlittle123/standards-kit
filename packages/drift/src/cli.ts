#!/usr/bin/env node

import { program } from "commander";
import { version } from "./version.js";
import { registerCodeCommands } from "./commands/code/index.js";
import { registerProcessCommands } from "./commands/process/index.js";
import { registerInfraCommands } from "./commands/infra/index.js";

program
  .name("drift")
  .description(
    "Monitor repository standards and detect drift across your GitHub organization"
  )
  .version(version);

// Domain command groups
const codeCmd = program
  .command("code")
  .description("Code quality and integrity");

registerCodeCommands(codeCmd);

const processCmd = program
  .command("process")
  .description("Process standards and compliance");

registerProcessCommands(processCmd);

const infraCmd = program
  .command("infra")
  .description("Infrastructure drift detection");

registerInfraCommands(infraCmd);

program.parse();
