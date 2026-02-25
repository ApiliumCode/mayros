import chalk, { Chalk } from "chalk";
import { MAYROS_PALETTE } from "./palette.js";

const hasForceColor =
  typeof process.env.FORCE_COLOR === "string" &&
  process.env.FORCE_COLOR.trim().length > 0 &&
  process.env.FORCE_COLOR.trim() !== "0";

const baseChalk = process.env.NO_COLOR && !hasForceColor ? new Chalk({ level: 0 }) : chalk;

const hex = (value: string) => baseChalk.hex(value);

export const theme = {
  accent: hex(MAYROS_PALETTE.accent),
  accentBright: hex(MAYROS_PALETTE.accentBright),
  accentDim: hex(MAYROS_PALETTE.accentDim),
  info: hex(MAYROS_PALETTE.info),
  success: hex(MAYROS_PALETTE.success),
  warn: hex(MAYROS_PALETTE.warn),
  error: hex(MAYROS_PALETTE.error),
  muted: hex(MAYROS_PALETTE.muted),
  heading: baseChalk.bold.hex(MAYROS_PALETTE.accent),
  command: hex(MAYROS_PALETTE.accentBright),
  option: hex(MAYROS_PALETTE.warn),
} as const;

export const isRich = () => Boolean(baseChalk.level > 0);

export const colorize = (rich: boolean, color: (value: string) => string, value: string) =>
  rich ? color(value) : value;
