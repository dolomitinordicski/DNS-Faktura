import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const key = '@dolomitinordicski/dns-shared-data';
const repository = 'https://github.com/dolomitinordicski/dns-shared-data.git';
const prefix = 'github:dolomitinordicski/dns-shared-data#';

export function releaseVersion(tag) {
  if (!/^foundation-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag ?? '')) {
    throw new Error('Expected an immutable foundation-vX.Y.Z release tag');
  }
  return tag.slice('foundation-v'.length);
}

export function verifyState(pkg, lock, tag, sha, installed) {
  const version = releaseVersion(tag);
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('Invalid Foundation commit SHA');
  const section = pkg.dependencies?.[key] !== undefined ? 'dependencies' : 'devDependencies';
  const spec = prefix + tag;
  if (pkg[section]?.[key] !== spec) throw new Error('Foundation manifest does not match ' + tag);
  if (lock.packages?.['']?.[section]?.[key] !== spec) throw new Error('Foundation lockfile root is stale');
  const entry = lock.packages?.['node_modules/' + key];
  if (entry?.version !== version) throw new Error('Foundation locked version does not match ' + version);
  const expected = /^(?:git\+ssh:\/\/git@github\.com\/|git\+https:\/\/github\.com\/)dolomitinordicski\/dns-shared-data(?:\.git)?#([a-f0-9]{40})$/;
  if (entry.link || entry.resolved?.match(expected)?.[1] !== sha) {
    throw new Error('Foundation lockfile must resolve to release commit ' + sha);
  }
  if (installed && (installed.name !== key || installed.version !== version)) {
    throw new Error('Installed Foundation does not match ' + version);
  }
  return { version, sha };
}

export function needsUpdate(pkg, lock, tag, sha) {
  try { verifyState(pkg, lock, tag, sha); return false; }
  catch { return true; }
}

export function resolveCommit(tag) {
  releaseVersion(tag);
  // Dereference annotated tags: the tag object SHA is not the package commit SHA.
  const lines = execFileSync('git', ['ls-remote', '--tags', repository,
    'refs/tags/' + tag, 'refs/tags/' + tag + '^{}'], { encoding: 'utf8' })
    .trim().split('\n').map(line => line.trim().split(/\s+/));
  const peeled = lines.find(([, ref]) => ref === 'refs/tags/' + tag + '^{}');
  const direct = lines.find(([, ref]) => ref === 'refs/tags/' + tag);
  const sha = (peeled ?? direct)?.[0];
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('Foundation release tag was not found: ' + tag);
  return sha;
}

const read = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const write = (path, value) => fs.writeFileSync(path, JSON.stringify(value, null, 2) + '\n');

export async function main(args = process.argv.slice(2)) {
  const pkg = read('package.json');
  let lock = read('package-lock.json');
  const section = pkg.dependencies?.[key] !== undefined ? 'dependencies' : 'devDependencies';
  let tag;
  if (args.includes('--update')) {
    tag = process.env.FOUNDATION_TAG;
    if (!tag) {
      const headers = { Accept: 'application/vnd.github+json' };
      if (process.env.GH_TOKEN) headers.Authorization = 'Bearer ' + process.env.GH_TOKEN;
      const response = await fetch('https://api.github.com/repos/dolomitinordicski/dns-shared-data/releases/latest', { headers });
      if (!response.ok) throw new Error('Cannot read latest stable Foundation release: ' + response.status);
      const release = await response.json();
      if (release.draft || release.prerelease) throw new Error('Expected a published stable Foundation release');
      tag = release.tag_name;
    }
  } else {
    const dep = pkg[section]?.[key];
    if (!dep?.startsWith(prefix)) throw new Error('Foundation must use an immutable GitHub release tag');
    tag = dep.slice(prefix.length);
  }
  const version = releaseVersion(tag);
  const sha = resolveCommit(tag);
  if (args.includes('--update')) {
    const changed = needsUpdate(pkg, lock, tag, sha);
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, 'tag=' + tag + '\nneeds_update=' + changed + '\n');
    }
    if (!changed) { console.log('Foundation already resolves to ' + tag + ' at ' + sha); return; }
    if (pkg[section]?.[key] === undefined) throw new Error('Missing Foundation dependency');
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pkg.version)) {
      throw new Error('Consumer version must use plain SemVer');
    }
    const parts = pkg.version.split('.');
    parts[2] = String(Number(parts[2]) + 1);
    pkg.version = parts.join('.');
    pkg[section][key] = prefix + tag;
    lock.version = pkg.version;
    if (!lock.packages?.['']) throw new Error('Expected an npm lockfile with a root package');
    lock.packages[''].version = pkg.version;
    lock.packages[''][section] ??= {};
    lock.packages[''][section][key] = prefix + tag;
    // Invalidate ONLY Foundation, preserving unrelated locked dependencies.
    delete lock.packages['node_modules/' + key];
    write('package.json', pkg);
    write('package-lock.json', lock);
    execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
      { stdio: 'inherit' });
    lock = read('package-lock.json');
  }
  const installed = args.includes('--installed') ? read('node_modules/' + key + '/package.json') : undefined;
  verifyState(pkg, lock, tag, sha, installed);
  console.log('Verified Foundation ' + version + ' at ' + sha);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
