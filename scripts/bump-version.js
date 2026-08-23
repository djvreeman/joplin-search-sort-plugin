const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const manifestPath = path.join(rootDir, 'src', 'manifest.json');

function bumpPatch(version) {
	const parts = String(version).split('.');
	if (parts.length < 3) throw new Error(`Expected semver x.y.z, got ${version}`);
	parts[parts.length - 1] = String(Number(parts[parts.length - 1]) + 1);
	return parts.join('.');
}

const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const next = bumpPatch(pkg.version);
pkg.version = next;
manifest.version = next;

fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`, 'utf8');

console.log(next);
