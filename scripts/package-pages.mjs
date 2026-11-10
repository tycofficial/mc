import { readdir, readFile, writeFile, mkdir, copyFile, lstat, unlink } from 'node:fs/promises';
import { resolve, relative, dirname, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve against the script, so invoking it from another directory is safe.
const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(root, 'dist');
const destination = resolve(root, 'web');
const manifestName = '.generated-files.json';

function within(directory, target) {
  const path = relative(directory, target);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function outputPath(name) {
  if (typeof name !== 'string' || !name || /[\\:\0]/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid generated path: ${String(name)}`);
  }
  const target = resolve(destination, name);
  if (!within(destination, target)) throw new Error('Generated path escapes web/.');
  return target;
}

async function statIfPresent(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function ensureDirectory(path) {
  const info = await statIfPresent(path);
  if (!info) { await mkdir(path); return; }
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Expected a regular directory: ${path}`);
}

async function ensureParent(target) {
  const parts = relative(destination, dirname(target)).split(sep).filter(Boolean);
  let directory = destination;
  for (const part of parts) {
    directory = resolve(directory, part);
    if (!within(destination, directory)) throw new Error('Generated parent escapes web/.');
    await ensureDirectory(directory);
  }
}

async function listFiles(directory) {
  const info = await statIfPresent(directory);
  if (!info?.isDirectory() || info.isSymbolicLink()) throw new Error(`Build directory is missing or unsafe: ${directory}. Run npm run build first.`);
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Build output cannot contain symbolic links: ${path}`);
    if (entry.isDirectory()) found.push(...await listFiles(path));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

const sourceFiles = await listFiles(source);
const builtIndex = resolve(source, 'index.html');
if (!sourceFiles.includes(builtIndex)) throw new Error('dist/index.html is missing. Run npm run build first.');
const html = await readFile(builtIndex, 'utf8');
if (html.includes('import.meta.env') || /(?:src|href)=["']\/(?:src\/|@vite\/)/.test(html)) {
  throw new Error('dist/index.html contains development-only imports; package a production Vite build.');
}

const names = sourceFiles.map(path => relative(source, path).split(sep).join('/')).sort();
if (names.includes(manifestName)) throw new Error(`${manifestName} is reserved for the Pages packager.`);
for (const name of names) outputPath(name);

await ensureDirectory(destination);
const manifestPath = resolve(destination, manifestName);
const manifestInfo = await statIfPresent(manifestPath);
if (manifestInfo && (!manifestInfo.isFile() || manifestInfo.isSymbolicLink())) throw new Error('Generated-file manifest must be a regular file.');

let previous = [];
if (manifestInfo) {
  const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!Array.isArray(parsed) || parsed.some(name => typeof name !== 'string')) throw new Error('Invalid generated-file manifest; no files were removed.');
  for (const name of parsed) outputPath(name);
  previous = parsed;
}

// Install assets first, then the HTML entry that refers to them.
const orderedNames = [...names.filter(name => name !== 'index.html'), 'index.html'];
for (const name of orderedNames) {
  const target = outputPath(name);
  await ensureParent(target);
  const info = await statIfPresent(target);
  if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error(`Refusing to overwrite a non-regular output: ${target}`);
  await copyFile(resolve(source, name), target);
}

// Only remove obsolete, explicitly recorded assets. Keep all user-created files.
const current = new Set(names);
for (const name of previous) {
  if (current.has(name) || !name.startsWith('assets/')) continue;
  const target = outputPath(name);
  await ensureParent(target);
  const info = await statIfPresent(target);
  if (info?.isSymbolicLink() || info && !info.isFile()) throw new Error(`Refusing to remove a non-regular asset: ${target}`);
  if (info) await unlink(target);
}

await writeFile(manifestPath, `${JSON.stringify(names, null, 2)}\n`);
console.log(`Packaged ${names.length} files in web/ for existing branch-based GitHub Pages hosting.`);
