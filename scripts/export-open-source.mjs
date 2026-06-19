import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(scriptDir, "..");
const defaultTarget = "/Users/mac/Documents/开源/AI保顾问";

const rootFiles = [
  ".gitignore",
  "AGENTS.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "SPEC.md",
  "package-lock.json",
  "package.json",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts",
];

const includedDirs = ["docs", "scripts", "src", "tests"];

const excludedPathPrefixes = [
  "data/",
  "data",
  ".omx/",
  ".omx",
  "node_modules/",
  "node_modules",
  "dist/",
  "dist",
  "src/web/dist/",
  "src/web/dist",
  "示范文件/",
  "示范文件",
  "docs/brand/",
  "docs/brand",
  "docs/plans/",
  "docs/plans",
  "src/web/public/icons/",
  "src/web/public/icons",
];

const excludedNames = new Set([".DS_Store"]);

function parseArgs(argv) {
  const options = {
    target: defaultTarget,
    clean: false,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--target") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--target requires a directory path.");
      }
      options.target = value;
      index += 1;
      continue;
    }
    if (arg === "--clean") {
      options.clean = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  options.target = path.resolve(options.target);
  return options;
}

function printHelp() {
  console.log(`Export the public open-source copy with a conservative whitelist.

Usage:
  npm run export:open-source
  npm run export:open-source -- --clean
  npm run export:open-source -- --target /path/to/public/repo --clean
  npm run export:open-source -- --dry-run

Options:
  --target <dir>  Destination directory. Default: ${defaultTarget}
  --clean         Remove existing destination files except .git before copying.
  --dry-run       Print the planned file list without writing.
`);
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function isExcluded(relativePath) {
  const posixPath = toPosix(relativePath);
  const name = path.basename(posixPath);
  if (excludedNames.has(name)) {
    return true;
  }
  return excludedPathPrefixes.some((prefix) => {
    return posixPath === prefix || posixPath.startsWith(prefix);
  });
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function assertTargetSafe(target) {
  const relative = path.relative(sourceRoot, target);
  if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error(`Refusing to export into the source tree: ${target}`);
  }
}

async function ensureCleanTarget(target, clean) {
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(target);
  const nonGitEntries = entries.filter((entry) => entry !== ".git");

  if (!clean && nonGitEntries.length > 0) {
    throw new Error(
      `Target is not empty: ${target}\nRun with --clean to refresh it while preserving .git.`,
    );
  }

  if (!clean) {
    return;
  }

  for (const entry of nonGitEntries) {
    await fs.rm(path.join(target, entry), { recursive: true, force: true });
  }
}

async function collectFiles() {
  const files = [];

  for (const file of rootFiles) {
    if (await pathExists(path.join(sourceRoot, file))) {
      files.push(file);
    }
  }

  for (const directory of includedDirs) {
    await collectDirectory(directory, files);
  }

  return files.sort((left, right) => left.localeCompare(right));
}

async function collectDirectory(relativeDir, files) {
  if (isExcluded(relativeDir)) {
    return;
  }

  const absoluteDir = path.join(sourceRoot, relativeDir);
  if (!(await pathExists(absoluteDir))) {
    return;
  }

  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (isExcluded(relativePath)) {
      continue;
    }
    if (entry.isDirectory()) {
      await collectDirectory(relativePath, files);
      continue;
    }
    if (entry.isFile()) {
      files.push(toPosix(relativePath));
    }
  }
}

async function copyFiles(files, target) {
  for (const file of files) {
    const sourcePath = path.join(sourceRoot, file);
    const targetPath = path.join(target, file);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
  }
}

function assertNoSensitiveFiles(files) {
  const offenders = files.filter((file) => {
    return (
      file.startsWith("data/") ||
      file.startsWith(".omx/") ||
      file.startsWith("示范文件/") ||
      file.endsWith(".sqlite") ||
      file.includes(".sqlite-") ||
      file.endsWith(".env") ||
      file.includes("/.env")
    );
  });

  if (offenders.length > 0) {
    throw new Error(`Sensitive files matched export whitelist:\n${offenders.join("\n")}`);
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  await assertTargetSafe(options.target);
  const files = await collectFiles();
  assertNoSensitiveFiles(files);

  if (options.dryRun) {
    console.log(`Source: ${sourceRoot}`);
    console.log(`Target: ${options.target}`);
    console.log(`Files: ${files.length}`);
    for (const file of files) {
      console.log(file);
    }
    process.exit(0);
  }

  await ensureCleanTarget(options.target, options.clean);
  await copyFiles(files, options.target);

  console.log(`Exported ${files.length} public files.`);
  console.log(`Source: ${sourceRoot}`);
  console.log(`Target: ${options.target}`);
  console.log("\nNext steps:");
  console.log(`  cd "${options.target}"`);
  console.log("  npm install");
  console.log("  npm run typecheck");
  console.log("  npm test");
  console.log("  npm run build");
  console.log("  npm audit --omit=dev");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
