const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

const rootDir = path.resolve(__dirname);
const distDir = process.env.JOPLIN_PLUGIN_DIST_DIR || path.join(rootDir, 'dist');
const srcDir = path.join(rootDir, 'src');

module.exports = {
	mode: 'production',
	target: 'node',
	entry: './src/index.ts',
	stats: 'errors-only',
	cache: false,
	module: {
		rules: [
			{
				test: /\.tsx?$/,
				use: 'ts-loader',
				exclude: /node_modules/,
			},
		],
	},
	resolve: {
		alias: {
			api: path.join(rootDir, 'api'),
		},
		extensions: ['.ts', '.js'],
	},
	output: {
		filename: 'index.js',
		path: distDir,
		clean: true,
	},
	optimization: {
		minimize: true,
	},
	plugins: [
		new CopyPlugin({
			patterns: [
				{
					from: '**/*',
					context: srcDir,
					to: '.',
					force: true,
					globOptions: {
						ignore: ['**/*.ts', '**/*.tsx'],
					},
					info: { minimized: true },
				},
			],
		}),
	],
};
