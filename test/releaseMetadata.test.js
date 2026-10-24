// One release contract replaces feature tests pinning an unrelated old version.
// The visible game version and both npm metadata records must ship together.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSION } from '../public/js/config.js';

const read = name => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));

test('release version is major.minor.patch and matches package and lockfile metadata', () => {
  const packageInfo = read('package.json'), lock = read('package-lock.json');
  assert.match(VERSION, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'release version must use numeric major.minor.patch');
  assert.equal(packageInfo.version, VERSION, 'package.json version must match the game');
  assert.equal(lock.version, VERSION, 'lockfile version must match the game');
  assert.equal(lock.packages[''].version, VERSION, 'lockfile root-package version must match the game');
});
