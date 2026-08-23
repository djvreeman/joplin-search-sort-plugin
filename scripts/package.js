const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const publishDir = path.join(rootDir, 'publish');
const packageJsonPath = path.join(rootDir, 'package.json');
const manifestPath = path.join(distDir, 'manifest.json');

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fileSha256(filePath) {
	return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function currentGitInfo() {
	try {
		let branch = execSync('git rev-parse --abbrev-ref HEAD', {
			cwd: rootDir,
			stdio: ['ignore', 'pipe', 'ignore'],
		}).toString().trim();
		const commit = execSync('git rev-parse HEAD', {
			cwd: rootDir,
			stdio: ['ignore', 'pipe', 'ignore'],
		}).toString().trim();
		if (branch === 'HEAD') branch = 'master';
		return `${branch}:${commit}`;
	} catch {
		return '';
	}
}

function validatePackageJson(pkg) {
	if (!pkg.name || !pkg.name.startsWith('joplin-plugin-')) {
		throw new Error(`package.json name must start with "joplin-plugin-" (found "${pkg.name}")`);
	}
	if (!Array.isArray(pkg.keywords) || !pkg.keywords.includes('joplin-plugin')) {
		throw new Error('package.json keywords must include "joplin-plugin"');
	}
}

if (!fs.existsSync(distDir)) {
	throw new Error('dist/ not found. Run npm run build first.');
}

const manifest = readJson(manifestPath);
const pkg = readJson(packageJsonPath);
validatePackageJson(pkg);

if (!manifest.id) {
	throw new Error('dist/manifest.json is missing plugin id');
}

if (manifest.version !== pkg.version) {
	console.warn(`Warning: version mismatch package.json=${pkg.version} manifest.json=${manifest.version}`);
}

fs.mkdirSync(publishDir, { recursive: true });

const jplPath = path.join(publishDir, `${manifest.id}.jpl`);
const infoPath = path.join(publishDir, `${manifest.id}.json`);

if (fs.existsSync(jplPath)) fs.unlinkSync(jplPath);

execSync(`tar -cf '${jplPath}' -C '${distDir}' .`, { stdio: 'inherit' });

const pluginInfo = {
	...manifest,
	_publish_hash: `sha256:${fileSha256(jplPath)}`,
	_publish_commit: currentGitInfo(),
	_npm_package_name: pkg.name,
};

fs.writeFileSync(infoPath, `${JSON.stringify(pluginInfo, null, '\t')}\n`, 'utf8');

console.log(`Created ${jplPath}`);
console.log(`Created ${infoPath}`);
console.log(`Version ${manifest.version}`);
