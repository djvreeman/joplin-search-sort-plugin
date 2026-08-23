const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

function copyDir(from, to) {
	fs.mkdirSync(to, { recursive: true });
	for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
		const src = path.join(from, entry.name);
		const dest = path.join(to, entry.name);
		if (entry.isDirectory()) {
			copyDir(src, dest);
		} else {
			fs.copyFileSync(src, dest);
		}
	}
}

function removeDir(dir) {
	if (!fs.existsSync(dir)) return;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const target = path.join(dir, entry.name);
		if (entry.isDirectory()) removeDir(target);
		else fs.unlinkSync(target);
	}
	fs.rmdirSync(dir);
}

const needsTempOutput = rootDir.includes('!');
const tempDist = path.join(os.tmpdir(), `joplin-search-sort-plugin-${process.pid}`);
const srcUiDir = path.join(rootDir, 'src', 'ui');

function copyUiAssets(targetDist) {
	const targetUi = path.join(targetDist, 'ui');
	fs.mkdirSync(targetUi, { recursive: true });
	for (const name of ['panel.js', 'panel.css', 'panel.html']) {
		const from = path.join(srcUiDir, name);
		if (fs.existsSync(from)) {
			fs.copyFileSync(from, path.join(targetUi, name));
		}
	}
}

try {
	if (needsTempOutput) {
		removeDir(tempDist);
		fs.mkdirSync(tempDist, { recursive: true });
		execSync('webpack --mode production', {
			cwd: rootDir,
			stdio: 'inherit',
			env: { ...process.env, JOPLIN_PLUGIN_DIST_DIR: tempDist },
		});
		// Ensure panel assets are exact source copies (webpack prod can stale-cache them).
		copyUiAssets(tempDist);
		removeDir(distDir);
		copyDir(tempDist, distDir);
	} else {
		execSync('webpack --mode production', { cwd: rootDir, stdio: 'inherit' });
		copyUiAssets(distDir);
	}
} finally {
	removeDir(tempDist);
}
