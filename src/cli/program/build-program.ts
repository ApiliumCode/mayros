import { Command } from "commander";
import { registerProgramCommands } from "./command-registry.js";
import { createProgramContext } from "./context.js";
import { configureProgramHelp } from "./help.js";
import { registerPreActionHooks } from "./preaction.js";
import { setProgramContext } from "./program-context.js";

export function buildProgram(argv: string[] = process.argv) {
  const program = new Command();
  const ctx = createProgramContext();

  setProgramContext(program, ctx);
  configureProgramHelp(program, ctx, argv);
  registerPreActionHooks(program, ctx.programVersion, argv);

  registerProgramCommands(program, ctx, argv);

  return program;
}
