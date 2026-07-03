import * as fs from 'node:fs/promises';
import * as fssync from 'node:fs';
import * as path from 'node:path';

export interface DetectedJdk {
  home: string;
  major: number;
}

// ── JDK detection ────────────────────────────────────────────────
// Best-effort, no subprocess: scan the well-known install locations per OS,
// read each candidate's `release` file (or fall back to its folder name) for
// the major version, and return the newest JDK at or above `minMajor`.

export async function detectBestJdk(minMajor = 17): Promise<DetectedJdk | undefined> {
  const candidates = new Set<string>();

  if (process.env.JAVA_HOME) candidates.add(process.env.JAVA_HOME);
  for (const key of ['JDK_HOME', 'JAVA21_HOME', 'JAVA_HOME_21']) {
    if (process.env[key]) candidates.add(process.env[key] as string);
  }

  const roots =
    process.platform === 'darwin'
      ? ['/Library/Java/JavaVirtualMachines', '/opt/homebrew/opt']
      : process.platform === 'win32'
        ? [process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Java') : '', 'C:\\Program Files\\Eclipse Adoptium']
        : ['/usr/lib/jvm', '/usr/java', '/opt/java', '/opt'];

  for (const root of roots.filter(Boolean)) {
    for (const entry of safeReadDir(root)) {
      const dir = path.join(root, entry);
      // macOS bundles the JDK under Contents/Home
      candidates.add(dir);
      candidates.add(path.join(dir, 'Contents', 'Home'));
    }
  }

  let best: DetectedJdk | undefined;
  for (const home of candidates) {
    if (!hasJavaBinary(home)) continue;
    const major = readMajorVersion(home);
    if (major === undefined || major < minMajor) continue;
    if (!best || major > best.major) best = { home, major };
  }
  return best;
}

function safeReadDir(dir: string): string[] {
  try {
    return fssync.readdirSync(dir);
  } catch {
    return [];
  }
}

function hasJavaBinary(home: string): boolean {
  const bin = process.platform === 'win32' ? 'java.exe' : 'java';
  return fssync.existsSync(path.join(home, 'bin', bin));
}

function readMajorVersion(home: string): number | undefined {
  // Preferred: the `release` file ships JAVA_VERSION="21.0.2" / "1.8.0_492"
  try {
    const release = fssync.readFileSync(path.join(home, 'release'), 'utf8');
    const match = release.match(/JAVA_VERSION="?([0-9]+)(?:\.([0-9]+))?/);
    if (match) {
      const first = Number(match[1]);
      // 1.8 → 8, otherwise the leading number is the major (21, 17…)
      return first === 1 && match[2] ? Number(match[2]) : first;
    }
  } catch {
    /* no release file — fall back to the folder name */
  }
  const name = path.basename(home === '' ? home : home.replace(/[/\\](Contents[/\\]Home)$/i, ''));
  const nameMatch = name.match(/(?:java|jdk|jre)[^0-9]*([0-9]+)/i) ?? name.match(/([0-9]+)/);
  if (nameMatch) {
    const n = Number(nameMatch[1]);
    return n === 1 ? undefined : n; // "java-1.8" folder → ambiguous, skip
  }
  return undefined;
}

// ── .vscode/settings.json merge ──────────────────────────────────
// Adds the detected JDK as a Java runtime + points Maven's terminal env at it,
// so VS Code's Java/Maven tooling resolves the multi-module project correctly.
// Non-destructive: merges into an existing file and backs off if it can't be parsed.

export async function ensureVscodeJavaSettings(
  workspaceRoot: string,
  jdk: DetectedJdk,
): Promise<'created' | 'updated' | 'unchanged' | 'skipped'> {
  const vscodeDir = path.join(workspaceRoot, '.vscode');
  const settingsPath = path.join(vscodeDir, 'settings.json');

  let settings: Record<string, unknown> = {};
  let existed = false;
  try {
    const raw = await fs.readFile(settingsPath, 'utf8');
    existed = true;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      settings = parsed as Record<string, unknown>;
    } else {
      return 'skipped';
    }
  } catch (err) {
    // File missing → create it. File present but unparseable (e.g. JSONC with
    // comments) → do NOT clobber the user's settings.
    if (existed) return 'skipped';
  }

  const before = JSON.stringify(settings);
  const runtimeName = `JavaSE-${jdk.major}`;

  const runtimes = Array.isArray(settings['java.configuration.runtimes'])
    ? (settings['java.configuration.runtimes'] as Array<Record<string, unknown>>)
    : [];
  const existingRuntime = runtimes.find((r) => r?.name === runtimeName);
  if (existingRuntime) {
    existingRuntime.path = jdk.home;
    existingRuntime.default = true;
  } else {
    runtimes.push({ name: runtimeName, path: jdk.home, default: true });
  }
  for (const r of runtimes) {
    if (r.name !== runtimeName && r.default) delete r.default; // single default
  }
  settings['java.configuration.runtimes'] = runtimes;
  settings['java.jdt.ls.java.home'] = jdk.home;

  const customEnv = Array.isArray(settings['maven.terminal.customEnv'])
    ? (settings['maven.terminal.customEnv'] as Array<Record<string, unknown>>)
    : [];
  const javaHomeEntry = customEnv.find((e) => e?.environmentVariable === 'JAVA_HOME');
  if (javaHomeEntry) {
    javaHomeEntry.value = jdk.home;
  } else {
    customEnv.push({ environmentVariable: 'JAVA_HOME', value: jdk.home });
  }
  settings['maven.terminal.customEnv'] = customEnv;

  if (JSON.stringify(settings) === before) return 'unchanged';

  await fs.mkdir(vscodeDir, { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return existed ? 'updated' : 'created';
}
