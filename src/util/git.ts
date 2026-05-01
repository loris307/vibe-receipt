import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export async function currentBranchOf(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      timeout: 1500,
    });
    const branch = stdout.trim();
    return branch && branch !== "HEAD" ? branch : null;
  } catch {
    return null;
  }
}
