'use strict';

const joi = require('@hapi/joi');
const fs = require('fs-extra');
const defaultsDeep = require('lodash.defaultsdeep');
const path = require('path');

const defaults = require('./defaults');
const schema = require('./schema');
const { clearRequireCache } = require('./utils');

function loadConfig(projectPath, force = false) {
	const tiConfigPath = path.resolve(projectPath, 'ti.config.js');
	if (!fs.existsSync(tiConfigPath)) {
		throw new Error(`Could not find Titanium config at ${tiConfigPath}`);
	}
	if (force) {
		clearRequireCache(tiConfigPath);
	}
	const config = require(tiConfigPath);
	const pkgPath = path.join(projectPath, 'package.json');
	if (fs.existsSync(pkgPath)) {
		const pkg = fs.readJsonSync(pkgPath);
		config.name = config.name || pkg.name;
		config.description = config.description || pkg.description;
		config.version = config.version || pkg.version;
	}
	validateConfig(config, schema);
	return defaultsDeep(config, defaults());
}

function validateConfig(obj) {
	joi.assert(obj, schema);
}

module.exports = {
	loadConfig,
	validateConfig
};
