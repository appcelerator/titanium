/**
 * The config command. Displays and manipulates the CLI configuration.
 *
 * @module commands/config
 *
 * @copyright
 * Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 *
 * @license
 * Licensed under the terms of the Apache Public License
 * Please see the LICENSE included with this distribution for details.
 *
 * @requires node-appc
 */

var config = require('../config'),
	appc = require('node-appc'),
	i18n = appc.i18n(__dirname),
	__ = i18n.__,
	__f = i18n.__f;

/** Config command name. */
exports.name = 'config';

/** Config command description. */
exports.desc = __('get and set config options');

/** Config command extended description. */
exports.extendedDesc = __f('commands/config', {
	configPath: config.getConfigPath()
});

/**
 * Returns the configuration for the config command.
 * @param {Object} logger - The logger instance
 * @param {Object} config - The CLI config object
 * @param {CLI} cli - The CLI instance
 * @returns {Object} Config command configuration
 */
exports.config = function (logger, config, cli) {
	return {
		skipBanner: true,
		noAuth: true,
		skipSendingAnalytics: true,
		flags: {
			append: {
				abbr: 'a',
				desc: __('appends a value to a key containing a list of values')
			},
			remove: {
				abbr: 'r',
				desc: __("removes all values and all its descendants or a specific value from a list of values")
			}
		},
		options: {
			output: {
				abbr: 'o',
				default: 'report',
				desc: __('output format'),
				values: ['report', 'json', 'json-object']
			}
		},
		args: [
			{
				name: 'key',
				desc: __('the key to get or set')
			},
			{
				name: 'value',
				desc: __('the value to set the specified key')
			}
		]
	};
};

/**
 * Validates command line arguments.
 * @param {Object} logger - The logger instance
 * @param {Object} config - The CLI config object
 * @param {CLI} cli - The CLI instance
 */
exports.validate = function (logger, config, cli) {
	var len = cli.argv._.length,
		key = cli.argv._[0];

	if (len > 0) {
		if (!/^([A-Za-z_]{1}[A-Za-z0-9-_]*(\.[A-Za-z-_]{1}[A-Za-z0-9-_]*)*)$/.test(key)) {
			logger.banner();
			logger.error(__('Invalid key "%s"', key) + '\n');
			process.exit(1);
		}
	}

	if (cli.argv.remove) {
		if (len == 0) {
			logger.banner();
			logger.error(__('Missing key of the config setting to remove') + '\n');
			logger.log(__('Run %s to remove the config setting.', (cli.argv.$ + ' config --remove <key>').cyan) + '\n');
			process.exit(1);
		}

		// if the key is not a path setting, then we don't allow any values
		if (len > 1 && !/^paths\..*$/.test(key)) {
			logger.banner();
			logger.error(__('Too many arguments for "%s" flag', '--remove') + '\n');
			logger.log(__('Run %s to remove the config setting.', (cli.argv.$ + ' config --remove ' + (key.indexOf(' ') == -1 ? key : '"' + key + '"')).cyan) + '\n');
			process.exit(1);
		}
	}
};

/**
 * Displays config settings or sets a config value.
 * @param {Object} logger - The logger instance
 * @param {Object} config - The CLI config object
 * @param {CLI} cli - The CLI instance
 * @param {Function} finished - Callback when the command finishes
 */
exports.run = function (logger, config, cli, finished) {
	var argv = cli.argv,
		key = argv._.length > 0 && argv._.shift(),
		value = argv._.length > 0 && argv._[0],
		results = {},
		asJson = argv.output == 'json' || argv.output == 'json-object';

	function walk(obj, prefix, parent) {
		Object.keys(obj).forEach(function (name) {
			var p = parent ? parent + '.' + name : name;
			if (Object.prototype.toString.call(obj[name]) == '[object Object]') {
				walk(obj[name], prefix, p);
			} else {
				if (!prefix || !parent || parent.indexOf(prefix) == 0) {
					results[p] = asJson ? obj[name] : JSON.stringify(obj[name]);
				}
			}
		});
	}

	function print(prefix) {
		if (argv.output == 'json-object') {
			logger.log(JSON.stringify(config.get(prefix), null, '\t'));
		} else {
			walk(config, prefix);
			if (asJson) {
				logger.log(JSON.stringify(results, null, '\t'));
			} else {
				var maxlen = Object.keys(results).reduce(function (a, b) {
					return Math.max(a, b.length);
				}, 0);
				Object.keys(results).sort().forEach(function (k) {
					logger.log('%s = %s', appc.string.rpad(k, maxlen), (results[k] || '').cyan);
				});
			}
		}
	}

	if (key) {
		try {
			if (value) {
				// doing a set or removing a list item
				var listMatch = key.match(/^paths\.(.*)$/);
				if (listMatch) {
					var subPath = listMatch[1];
					if (['commands', 'hooks', 'modules', 'plugins', 'sdks', 'codeProcessorPlugins', 'templates', 'xcode'].indexOf(subPath) == -1) {
						logger.error(__('Unsupported key %s', key) + '\n');
						return;
					}
					config.paths || (config.paths = {});

					if (argv.append) {
						Array.isArray(config.paths[subPath]) || (config.paths[subPath] = []);
						argv._.forEach(function (v) {
							v = appc.fs.resolvePath(v);
							config.paths[subPath].indexOf(v) == -1 && config.paths[subPath].push(v);
						});
					} else if (argv.remove) {
						Array.isArray(config.paths[subPath]) || (config.paths[subPath] = []);
						argv._.forEach(function (v) {
							var p = config.paths[subPath].indexOf(v);
							if (p != -1) {
								config.paths[subPath].splice(p, 1);
							}
						});
					} else {
						config.paths[subPath] = argv._;
					}
				} else {
					config.set(key, value);
				}
				config.save();
				logger.log(asJson ? JSON.stringify({ success: true }) : __('%s saved', key.cyan));
			} else {
				var parts = key.split('.'),
					i = 0,
					q = parts.pop(),
					p = parts.length && parts[i++],
					obj = config;

				if (p) {
					do {
						obj = p in obj ? obj[p] : (obj[p] = {});
					} while (obj && (p = parts[i++]));
				}

				if (obj) {
					if (argv.remove) {
						// doing a remove
						if (obj.hasOwnProperty(q)) {
							delete obj[q];
							config.save();
							logger.log(asJson ? JSON.stringify({ success: true }) : __('%s removed', key.cyan));
						} else {
							logger.log(asJson ? JSON.stringify({
								success: false,
								reason: __('key "%s" not found', key)
							}, null, '\t') : __('%s not found', key.cyan));
							process.exit(1);
						}
					} else {
						// doing a get
						if (Object.prototype.toString.call(obj[q]) == '[object Object]') {
							print(key);
						} else if (Array.isArray(obj[q])) {
							if (asJson) {
								logger.log(JSON.stringify(obj[q]));
							} else if (obj[q].length) {
								logger.log(obj[q].join('\n'));
							}
						} else if (obj[q] !== void 0) {
							logger.log('_', asJson ? JSON.stringify(obj[q]) : obj[q]);
						} else {
							logger.log(asJson ? JSON.stringify({
								success: false,
								reason: __('key "%s" not found', key)
							}, null, '\t') : __('%s not found', key.cyan));
							process.exit(1);
						}
					}
				} else {
					logger.log(asJson ? JSON.stringify({
						success: false,
						reason: __('key "%s" not found', key)
					}, null, '\t') : __('%s not found', key.cyan));
					process.exit(1);
				}
			}
		} catch (e) {
			if (asJson) {
				logger.log(JSON.stringify({ success: false, error: e.toString() }));
			} else {
				logger.error(e);
			}
		}
	} else {
		// print all key/values
		print();
	}

	finished();
};
