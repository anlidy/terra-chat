import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";

type HashEntry = {
  absolutePath: string;
  relativePath: string;
};

async function collectFiles(
  absolutePath: string,
  relativePath: string
): Promise<HashEntry[]> {
  const stats = await lstat(absolutePath);
  if (stats.isSymbolicLink()) {
    throw new Error(`Corpus paths must not contain symlinks: ${absolutePath}`);
  }
  if (stats.isFile()) {
    return [{ absolutePath, relativePath }];
  }
  if (!stats.isDirectory()) {
    throw new Error(`Corpus path must be a file or directory: ${absolutePath}`);
  }

  const entries = await readdir(absolutePath, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      collectFiles(
        path.join(absolutePath, entry.name),
        path.join(relativePath, entry.name)
      )
    )
  );
  return nested.flat();
}

export async function hashPath(inputPath: string): Promise<string> {
  const absolutePath = path.resolve(inputPath);
  const stats = await lstat(absolutePath);
  const relativePath = stats.isDirectory() ? "" : path.basename(absolutePath);
  const entries = await collectFiles(absolutePath, relativePath);
  const hash = createHash("sha256");

  for (const entry of entries.toSorted((left, right) => {
    if (left.relativePath < right.relativePath) {
      return -1;
    }
    return left.relativePath > right.relativePath ? 1 : 0;
  })) {
    hash.update(entry.relativePath);
    hash.update("\0");
    hash.update(await readFile(entry.absolutePath));
    hash.update("\0");
  }

  return `sha256:${hash.digest("hex")}`;
}

export function resolveSourceRevision(): string {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const dirty = execFileSync("git", ["status", "--short"], {
    encoding: "utf8",
  }).trim();
  return dirty.length === 0 ? commit : `${commit}-dirty`;
}
