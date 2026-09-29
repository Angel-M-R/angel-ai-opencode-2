import * as fs from "node:fs";
import { randomUUID } from "node:crypto";

export function readGlobalConfigFile(configPath: string): any {
  try {
    if (!fs.existsSync(configPath)) return {};
    return JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
  } catch (cause) {
    throw new Error(`Cannot read global config ${configPath}; leaving it unchanged`, { cause });
  }
}

export function writeGlobalConfigFile(configPath: string, config: any): void {
  try {
    if (fs.existsSync(configPath)) configPath = fs.realpathSync(configPath);
  } catch (cause) {
    throw new Error(`Cannot resolve global config ${configPath}; leaving it unchanged`, { cause });
  }
  const current = readGlobalConfigFile(configPath);
  if (current.agents || config.agents) {
    throw new Error("Native v2 agent config is not supported by this SDD profile format");
  }
  const suffix = `${Date.now()}-${process.pid}-${randomUUID()}`;
  if (fs.existsSync(configPath)) fs.copyFileSync(configPath, `${configPath}.bak-${suffix}`);
  const temporary = `${configPath}.tmp-${suffix}`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(config, null, 2), { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, configPath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
