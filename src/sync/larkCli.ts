import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export type LarkCliRunner = (
  argv: string[],
) => Promise<{
  stdout: string;
  stderr: string;
}>;

export const defaultLarkCliRunner: LarkCliRunner = (argv) =>
  execFile("lark-cli", argv, {
    maxBuffer: 1024 * 1024 * 10,
  });

export function maskTokenInMessage(message: string, baseToken: string) {
  return message.split(baseToken).join("<base-token>");
}
