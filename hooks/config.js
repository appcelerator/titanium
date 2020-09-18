'use strict';

const fs = require('fs');
const path = require('path');

const { loadConfig } = require('../lib/config/index');
const { normalizeConfig } = require('../lib/config/utils');

exports.id = 'ti.config.js';
exports.init = (logger, config, cli) => {
	cli.on('build.config', {
		post(data) {
			const command = data.result[1];
			const projectDirOption = command.options['project-dir'];
			if (!projectDirOption) {
				return;
			}

			const originalCallback = projectDirOption.callback;
			projectDirOption.callback = function (projectDir) {
				if (projectDir === '') {
					// no option value was specified
					// set project dir to current directory
					projectDir = projectDirOption.default;
				}
				projectDir = path.resolve(projectDir);

				const tiConfigPath = path.resolve(projectDir, 'ti.config.js');
				if (!fs.existsSync(tiConfigPath) || fs.existsSync(path.join(projectDir, 'timodule.xml'))) {
					return originalCallback.call(null, projectDir);
				}

				const tiConfig = loadConfig(projectDir);
				const tiapp = normalizeConfig(tiConfig);
				cli.argv.type = 'app';
				cli.tiapp = tiapp;

				// make sure the tiapp config is sane
				const tiModulePath = require.resolve('node-titanium-sdk', { paths: [ cli.sdk.path ] });
				const ti = require(tiModulePath);
				ti.validateTiappXml(logger, config, tiapp);

				cli.scanHooks(path.join(projectDir, 'hooks'));

				return projectDir;
			};

			const originalValidate = projectDirOption.validate;
			projectDirOption.validate = function (projectDir, callback) {
				projectDir = path.resolve(projectDir);
				const configPath = path.join(projectDir, 'ti.config.js');
				if (fs.existsSync(configPath)) {
					return callback(null, projectDir);
				}

				originalValidate(projectDir, callback);
			};
		},
		// prio of 900 to run before tisdk3fixes.js
		priority: 900
	});
};
