const fs = require("fs");
const path = require("path");
const { minify } = require("terser");
const JavaScriptObfuscator = require("javascript-obfuscator");

const ROOT_DIR = process.cwd();
const SOURCE_DIR = path.join(ROOT_DIR, "miniprogram", "llplanet-no-fly-zone");
const DIST_ROOT = path.join(ROOT_DIR, "dist");
const OBFUSCATE_FLAG = process.argv.includes("--obfuscate");
const DIST_DIR = path.join(
  DIST_ROOT,
  OBFUSCATE_FLAG ? "llplanet-no-fly-zone-obfuscated" : "llplanet-no-fly-zone"
);

const TEXT_FILE_EXTENSIONS = new Set([
  ".js",
  ".json",
  ".wxml",
  ".wxss",
  ".md"
]);

function assertSourceExists() {
  if (!fs.existsSync(SOURCE_DIR)) {
    throw new Error(`SDK source directory not found: ${SOURCE_DIR}`);
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function cleanDist() {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  ensureDir(DIST_DIR);
}

function walkFiles(dirPath, list = []) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  entries.forEach((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, list);
      return;
    }
    list.push(fullPath);
  });
  return list;
}

function normalizeJson(text) {
  try {
    return `${JSON.stringify(JSON.parse(text))}\n`;
  } catch (error) {
    return text;
  }
}

function normalizeTextByExtension(filePath, content) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") {
    return normalizeJson(content);
  }
  return content;
}

function obfuscateJs(code) {
  return JavaScriptObfuscator.obfuscate(code, {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: false,
    disableConsoleOutput: false,
    identifierNamesGenerator: "hexadecimal",
    renameGlobals: false,
    renameProperties: false,
    selfDefending: false,
    simplify: true,
    splitStrings: false,
    stringArray: true,
    stringArrayCallsTransform: false,
    stringArrayEncoding: [],
    stringArrayThreshold: 0.75,
    transformObjectKeys: false,
    unicodeEscapeSequence: false
  }).getObfuscatedCode();
}

async function buildJs(filePath, outputPath) {
  const source = fs.readFileSync(filePath, "utf8");
  const minified = await minify(source, {
    compress: {
      passes: 2
    },
    mangle: {
      keep_fnames: false,
      keep_classnames: false
    },
    format: {
      comments: false,
      ascii_only: true
    }
  });
  if (!minified.code) {
    throw new Error(`Failed to minify JS: ${filePath}`);
  }
  const finalCode = OBFUSCATE_FLAG ? obfuscateJs(minified.code) : minified.code;
  fs.writeFileSync(outputPath, `${finalCode}\n`, "utf8");
}

function copyFileAsText(filePath, outputPath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const normalized = normalizeTextByExtension(filePath, raw);
  fs.writeFileSync(outputPath, normalized, "utf8");
}

function copyFileAsBinary(filePath, outputPath) {
  fs.copyFileSync(filePath, outputPath);
}

async function buildFile(filePath) {
  const relativePath = path.relative(SOURCE_DIR, filePath);
  const outputPath = path.join(DIST_DIR, relativePath);
  ensureDir(path.dirname(outputPath));
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".js") {
    await buildJs(filePath, outputPath);
    return;
  }

  if (TEXT_FILE_EXTENSIONS.has(ext)) {
    copyFileAsText(filePath, outputPath);
    return;
  }

  copyFileAsBinary(filePath, outputPath);
}

function writeBuildMeta(fileCount) {
  const meta = {
    sdkName: "llplanet-no-fly-zone",
    mode: OBFUSCATE_FLAG ? "obfuscate" : "build",
    fileCount,
    builtAt: new Date().toISOString(),
    source: path.relative(ROOT_DIR, SOURCE_DIR),
    output: path.relative(ROOT_DIR, DIST_DIR)
  };
  fs.writeFileSync(
    path.join(DIST_DIR, "build-meta.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
    "utf8"
  );
}

async function main() {
  assertSourceExists();
  ensureDir(DIST_ROOT);
  cleanDist();
  const files = walkFiles(SOURCE_DIR);
  for (const filePath of files) {
    await buildFile(filePath);
  }
  writeBuildMeta(files.length);
  const mode = OBFUSCATE_FLAG ? "obfuscate" : "build";
  process.stdout.write(
    `llplanet-no-fly-zone ${mode} complete -> ${path.relative(ROOT_DIR, DIST_DIR)}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
