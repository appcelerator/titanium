/**
 * The setup command. Walks the user through a series of questions to help them
 * configure their Titanium environment.
 *
 * @module commands/setup
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

var appc = require('node-appc'),
	async = require('async'),
	fields = require('fields'),
	fs = require('fs'),
	path = require('path'),
	proxyDetector = require('./lib/proxy_detect'),
	request = require('request'),
	temp = require('temp'),
	url = require('url'),
	wrench = require('wrench'),
	afs = appc.fs,
	AppcException = appc.exception,
	mixObj = appc.util.mixObj,
	i18n = appc.i18n(__dirname),
	__ = i18n.__,
	__f = i18n.__f,
	proxy = [];

/** Setup command name. */
exports.name = 'setup';

/** Setup command description. */
exports.desc = __('sets up the Titanium CLI');

/** Config command extended description. */
exports.extendedDesc = __f('commands/setup');

/**
 * Returns the configuration for the setup command.
 * @param {Object} logger - The logger instance
 * @param {Object} config - The CLI config object
 * @param {CLI} cli - The CLI instance
 * @returns {Object} Setup command configuration
 */
exports.config = function (logger, config, cli) {
	fields.setup({ colors: cli.argv.colors });
	proxyDetector.detect(function(prxy) {
		// this may be async depending on platform
		// so detecting done here during config
		proxy.push(prxy);
	});

	return {
		noAuth: true,
		args: [
			{
				name: 'screen',
				default: 'mainmenu',
				desc: __('initial screen'),
				values: Object.keys(SetupScreens.prototype).filter(function (f) {
					return !/^_|exit/.test(f) && (process.platform === 'darwin' || f !== 'ios') && (process.platform === 'win32' || f !== 'windows');
				})
			}
		]
	};
};

/**
 * Steps the user through the configuration of their Titanium environment.
 * @param {Object} logger - The logger instance
 * @param {Object} config - The CLI config object
 * @param {CLI} cli - The CLI instance
 * @param {Function} finished - Callback when the command finishes
 */
exports.run = function (logger, config, cli, finished) {
	logger.log(__('Enter %s at any time to quit.', 'ctrl-c'.cyan));

	var screens = new SetupScreens(logger, config, cli);

	var queue = async.queue(function (screen, callback) {
		try {
			screen.call(screens, callback);
		} catch (ex) {
			if (ex) {
				var s = ex.stack.toString().split('\n');
				logger.error(s.shift());
				logger.log('\n' + s.join('\n').grey);
			}
			callback(ex);
		}
	}, 1);

	queue.drain = finished;

	function post(err, next) {
		logger.log();
		if (err && err.message === 'cancelled') {
			logger.log();
			process.exit(1);
		}
		screens[next] || (next = 'mainmenu');
		queue.push(screens[next], post);
	}

	if (cli.argv.screen && !screens[cli.argv.screen]) {
		logger.log();
		logger.error(__('Invalid setup screen "%s"', cli.argv.screen));
	}
	queue.push(cli.argv.screen && screens[cli.argv.screen] || screens.mainmenu, post);
};

/**
 * Detects the Android environment using either the new or old detection code.
 * @param {Object} logger - The logger instance
 * @param {Object} config - The CLI config object
 * @param {CLI} cli - The CLI instance
 * @param {Function} callback - A function to call when finished
 */
function detectAndroid(logger, config, cli, callback) {
	if (cli.sdk) {
		// try to find a Titanium SDK 3.2 or newer for the detection stuff
		var tisdk = cli.sdk.manifest && cli.sdk.manifest.version || cli.sdk.name,
			file;

		// check if we have a titanium sdk 3.2 or newer that has the new fancy detection system
		if (appc.version.gte(tisdk, '3.2.0')
			&& cli.sdk.platforms
			&& cli.sdk.platforms.android
			&& fs.existsSync(file = path.join(cli.sdk.platforms.android.path, 'cli', 'lib', 'detect.js'))
		) {
			require(file).detect(config, cli, callback);
			return;
		}
	}

	// the old legacy node-appc detection code
	appc.android.detect(function (result) {
		result || (result = {});
		result.detectVersion = '1.0';
		callback(result);
	}, config.android && config.android.sdkPath, config.android && config.android.ndkPath);
}

/**
 * Detects the iOS environment using either the new or old detection code.
 * @param {Object} logger - The logger instance
 * @param {Object} config - The CLI config object
 * @param {CLI} cli - The CLI instance
 * @param {Function} callback - A function to call when finished
 */
function detectIos(logger, config, cli, callback) {
	if (cli.sdk) {
		var tisdk = cli.sdk.manifest && cli.sdk.manifest.version || cli.sdk.name,
			file;

		// check if we have a titanium sdk 3.2 or newer that has the new fancy detection system
		if (appc.version.gte(tisdk, '3.2.0')
			&& cli.sdk.platforms
			&& (
				(cli.sdk.platforms.ios && fs.existsSync(file = path.join(cli.sdk.platforms.ios.path, 'cli', 'lib', 'detect.js')))
				|| (cli.sdk.platforms.iphone && fs.existsSync(file = path.join(cli.sdk.platforms.iphone.path, 'cli', 'lib', 'detect.js')))
			)
		) {
			require(file).detect(config, {}, function (result) {
				callback(result);
			});
			return;
		}
	}

	appc.ios.detect(function (result) {
		result || (result = {});
		result.detectVersion = '1.0';
		callback(result);
	});
}

/**
 * The setup command screens.
 * @class
 * @classdesc The setup command screens.
 * @param {Object} logger - The logger instance
 * @param {Object} config - The CLI config object
 * @param {CLI} cli - The CLI instance
 * @constructor
 */
function SetupScreens(logger, config, cli) {
	this._logger = logger;
	this._config = config;
	this._cli = cli;

	var activeSdk = cli.env.getSDK(config.get('sdk.selected', config.get('app.sdk', 'latest'))),
		activeSdkLabel = ' [' + __('active') + ']',
		sdkVersions = Object.keys(cli.env.sdks).filter(function (v) {
			return appc.version.gte(cli.env.sdks[v].manifest && cli.env.sdks[v].manifest.version || v, '3.0.0');
		}).sort().reverse();

	this._registry = {
		'user': {
			'name': fields.text({
				default: config.get('user.name', ''),
				title: __('What do you want as your "author" name?'),
				validate: function (value) {
					if (!value) {
						throw new Error(__('Invalid name'));
					}
					return true;
				}
			}),
			'email': fields.text({
				default: config.get('user.email', ''),
				title: __('What is your email address used for logging into the Appcelerator Network?'),
				validate: function (value) {
					if (!value) {
						throw new Error(__('Invalid e-mail address'));
					}
					return true;
				}
			}),
			'locale': fields.text({
				default: config.get('user.locale', ''),
				title: __('What would you like as your default locale?'),
				desc: __('(examples: "en", "en-us", "de", "fr")'),
				validate: function (value) {
					if (!value || !/^[A-Za-z]{2}[A-Za-z]?(([-_][A-Za-z0-9]{4})?[-_][A-Za-z0-9]{2}[A-Za-z0-9]?)?$/.test(value)) {
						throw new Error(__('Invalid locale format'));
					}
					return true;
				}
			})
		},
		'app': {
			'workspace': fields.file({
				default: config.get('app.workspace', ''),
				title: __('Path to your workspace where your projects should be created:'),
				complete: true,
				showHidden: true,
				ignoreDirs: new RegExp(config.get('cli.ignoreDirs')),
				ignoreFiles: new RegExp(config.get('cli.ignoreFiles')),
				validate: function (value, callback) {
					if (!value) {
						throw new Error(__('Please specify a workspace directory'));
					}
					value = afs.resolvePath(value);
					if (!fs.existsSync(value)) {
						throw new Error(__('Invalid workspace directory'));
					}
					callback(null, value);
				}.bind(this)
			})
		},
		'sdk': {
			'selected': function () {
				var selectedSdk = cli.env.getSDK(config.get('sdk.selected', config.get('app.sdk', 'latest'))),
					sdkVersionMaxlen = sdkVersions.reduce(function (a, b) {
						return Math.max(a, b.length + (activeSdk && b == activeSdk.name ? activeSdkLabel.length : 0));
					}, 0);

				return sdkVersions.length && fields.select({
					default: selectedSdk && selectedSdk.name || 'latest',
					label: __('What Titanium SDK would you like to use by default?'),
					complete: true,
					completeIgnoreCase: true,
					suggest: true,
					suggestThreshold: 2,
					numbered: true,
					margin: '',
					formatters: {
						option: function (opt, idx, num) {
							var d = selectedSdk && opt.value == selectedSdk.name ? activeSdkLabel : '',
								n = sdkVersionMaxlen + 2 - opt.value.length - d.length;
							return num + opt.value.cyan + d.grey + new Array(n + 1).join(' ') + opt.path;
						}
					},
					promptLabel: __('Enter # or SDK name'),
					optionLabel: 'value',
					options: sdkVersions.map(function (sdk) {
						return { path: cli.env.sdks[sdk].path, value: sdk };
					}),
					validate: function (value) {
						if (sdkVersions.indexOf(value) == -1) {
							throw new Error(__('Invalid Titanium SDK'));
						}
						// set the new sdk
						cli.sdk = cli.env.sdks[value];
						return true;
					}
				});
			}
		},
		'android': {
			'sdkPath': function (defaultValue) {
				return fields.file({
					default: defaultValue || undefined,
					title: __('Path to the Android SDK'),
					desc: __("Enter \"none\" if you don't want to build for Android."),
					complete: true,
					showHidden: true,
					ignoreDirs: new RegExp(config.get('cli.ignoreDirs')),
					ignoreFiles: new RegExp(config.get('cli.ignoreFiles')),
					validate: function (value, callback) {
						if (value.toLowerCase() == 'none') {
							callback(null, '');
							return;
						}

						if (value && (!fs.existsSync(afs.resolvePath(value) || fs.statSync(value).isDirectory()))) {
							throw new Error(__('Invalid Android SDK path'));
						}

						if (process.platform === 'win32' && value.indexOf('&') != -1) {
							throw new Error(__('The Android SDK path must not contain ampersands (&) on Windows'));
						}

						var androidExecutable = path.join(value, 'tools', 'android' + (process.platform === 'win32' ? '.bat' : ''));
						if (!fs.existsSync(androidExecutable)) {
							throw new Error(__('Invalid Android SDK path') + '\n' + __('Required file does not exist: "%s"', androidExecutable));
						}

						var adbExecutable = path.join(value, 'platform-tools', 'adb' + (process.platform === 'win32' ? '.exe' : ''));
						if (!fs.existsSync(adbExecutable)) {
							throw new Error(__('Invalid Android SDK path') + '\n' + __('Required file does not exist: %s"', adbExecutable));
						}

						return true;
					}.bind(this)
				});
			}
		}
	};
}

/**
 * Renders the screen title.
 * @param {String} title - The screen title
 * @private
 */
SetupScreens.prototype._title = function _title(title) {
	var width = 50,
		margin = width - title.length + 4
		pad = Math.floor(margin / 2),
		left = pad ? (new Array(pad + 1)).join('─') : '',
		right = pad ? (new Array(margin - pad + 1)).join('─') : '';
	this._logger.log('\n' + (left + '┤ ').grey + title.bold + (' ├' + right).grey + '\n');
};

/**
 * Saves the configuration to disk.
 * @param {Object} data - The config data to save
 * @private
 */
SetupScreens.prototype._save = function _save(data) {
	if (data) {
		// we reload the config to always make sure we have a clean state
		this._config.load();
		mixObj(this._config, data);
		this._config.save();
		this._logger.log('\n' + __('Configuration saved!'));
	}
};

/**
 * Displays the main menu and prompts for selection.
 * @param {Function} callback - Function to be called when the prompting finishes
 */
SetupScreens.prototype.mainmenu = function mainmenu(callback) {
	this._title(__('Main Menu'));
	fields.select({
		numbered: true,
		promptLabel: __('Where do you want to go?'),
		optionLabel: 'key',
		separator: ' ',
		margin: '',
		complete: true,
		completeIgnoreCase: true,
		formatters: {
			option: function (opt, idx, num) {
				return '  ' + num + this._format(opt.key + (new Array(10 - opt.key.replace(/__(.+?)__/g, '?').length)).join(' '), 'option') + opt.label;
			}
		},
		options: [
			{ key: '__q__uick',   	value: 'quick',   label: __('Quick Setup') },
			{ key: 'chec__k__',   	value: 'check',   label: __('Check Environment') },
			{ key: '__u__ser',    	value: 'user',    label: __('User Information') },
			{ key: 'a__p__p',     	value: 'app',     label: __('New App Defaults') },
			{ key: '__n__etwork', 	value: 'network', label: __('Network Settings') },
			{ key: '__c__li',     	value: 'cli',     label: __('Titanium CLI Settings') },
			{ key: '__s__dk',     	value: 'sdk',     label: __('Titanium SDK Settings') },
			{ key: '__i__os',     	value: 'ios',     label: __('iOS Settings') },
			{ key: '__a__ndroid', 	value: 'android', label: __('Android Settings') },
			{ key: '__w__indows',   value: 'windows', label: __('Windows Settings') },
			//{ key: 'pa__t__hs',   value: 'paths', label: __('Search Paths') },
			{ key: 'e__x__it',   value: 'exit', label: __('Exit') }
		].filter(function (o) {
			return !((o.value === 'ios' && process.platform !== 'darwin') || (o.value === 'windows' && process.platform !== 'win32'));
		})
	}).prompt(callback);
};

/**
 * Prompts for essential config options.
 * @param {Function} callback - Function to be called when the prompting finishes
 */
SetupScreens.prototype.quick = function quick(callback) {
	var busy = new appc.busyindicator;
	busy.start();

	detectAndroid(this._logger, this._config, this._cli, function (results) {
		busy.stop();

		this._title(__('Quick Setup'));

		var androidSdkPath = this._config.get('android.sdkPath', results && (results.sdk && results.sdk.path || results.sdkPath));

		fields.set({
			'name': this._registry.user.name,
			'email': this._registry.user.email,
			'locale': this._registry.user.locale,
			'sdk': this._registry.sdk.selected(),
			'workspace': this._registry.app.workspace,
			'using android': !androidSdkPath && fields.select({
				promptLabel: __('Do you plan to build your app for Android?'),
				display: 'prompt',
				default: 'yes',
				options: [ 'yes', 'no' ],
				next: function (err, value) {
					return value == 'no' ? false : null;
				}
			}),
			'androidSdkPath': this._registry.android.sdkPath(androidSdkPath)
		}).prompt(function (err, data) {
			if (!err) {
				var values = {
					user: {
						name: data.name,
						email: data.email,
						locale: data.locale
					},
					sdk: {
						selected: data.sdk
					},
					app: {
						workspace: data.workspace
					}
				};
				if (androidSdkPath || data['using android'] === 'yes') {
					values.android = {
						sdkPath: data.androidSdkPath
					};
				}
				this._save(values);
			}
			callback();
		}.bind(this));
	}.bind(this));
};

/**
 * Checks if your development environment is correctly setup.
 * @param {Function} callback - Function to be called when the prompting finishes
 */
SetupScreens.prototype.check = function check(callback) {
	this._title(__('Check Environment'));

	var logger = this._logger,
		config = this._config,
		cli = this._cli,
		log = logger.log,
		busy = new appc.busyindicator;

	busy.start();

	try {
		async.parallel({
			'nodejs': function (next) {
				cli.env.getOSInfo(function (results) {
					var r = {
							node: {
								current: results.node,
								latest: null
							},
							npm: {
								current: results.npm,
								latest: null
							}
						};

					appc.net.online(function (err, online) {
						if (err || !online) {
							return next(null, r);
						}

						async.parallel([
							function nodejs(cb) {
								request({
									url: 'http://nodejs.org/dist/',
									proxy: config.get('cli.httpProxyServer'),
									rejectUnauthorized: config.get('cli.rejectUnauthorized', true)
								}, function (error, response, body) {
									if (!error && response.statusCode == 200) {
										var vers, i, l,
											re = /(\d+\.\d+.\d+)/;
										for (i = 0, vers = body.split('\n'), l = vers.length; i < l; i++) {
											var m = vers[i].match(re);
											// we only want stable releases
											if (m && m[1] && m[1].split('.')[1] % 2 != 1 && appc.version.gt(m[1], r.node.latest)) {
												r.node.latest = m[1];
											}
										}
									}
									cb();
								});
							},
							function npm(cb) {
								appc.subprocess.findExecutable('npm' + (process.platform === 'win32' ? '.cmd' : ''), function (err, npm) {
									if (err) return cb();
									appc.subprocess.run(npm, ['info', 'npm', '--json'], function (err, stdout, stderr) {
										if (!err) {
											try {
												var info = JSON.parse(stdout);
												if (info && info.versions) {
													for (var i = 0, vers = info.versions, l = vers.length; i < l; i++) {
														if (appc.version.gt(vers[i], r.npm.latest)) {
															r.npm.latest = vers[i];
														}
													}
												}
											} catch (ex) {
												console.log(ex);
											}
										}
										cb();
									});
								});
							}
						], function () {
							next(null, r);
						});
					});
				});
			},
			'ios': function (next) {
				if (process.platform !== 'darwin') {
					return next(null, null);
				}
				detectIos(logger, config, cli, function (results) {
					next(null, results);
				});
			},
			'clitools': function (next) {
				if (process.platform !== 'darwin') {
					return next(null, null);
				}
				appc.clitools.detect(config, function (results) {
					next(null, results);
				});
			},
			'android': function (next) {
				detectAndroid(logger, config, cli, function (results) {
					next(null, results);
				});
			},
			'java': function (next) {
				appc.jdk.detect(config, function (results) {
					next(null, results);
				});
			},
			'haxm': function (next) {
				appc.haxm.detect(config, function (results) {
					next(null, results);
				});
			},
			'network': function (next) {
				appc.net.online(function (err, online) {
					var r = {
						online: err ? null : online,
						proxy: config.get('cli.httpProxyServer'),
						unreachable: [],
						javaResults: []
					};

					if (!r.online) {
						return next(null, r);
					}

					/*
						Test network access and proxy permissions via
						node, cURL, and Java through an async series
						of tests. Start by attempting to access a set
						of necessary http and https endpoints.
					*/
					async.parallel(JSON.parse(fs.readFileSync(path.resolve(__dirname, 'lib', 'urls_to_check.json'))).map(function (testUrl) {
							return function (cb) {
								request({
									url: testUrl,
									proxy: config.get('cli.httpProxyServer', ''),
									rejectUnauthorized: config.get('cli.rejectUnauthorized', true)
								}, function (error, response, body) {
									if (error || (response.statusCode && response.statusCode != 200 && response.statusCode != 401)) {
										// if there's an error, response will be null, treat it as a 404
										var statCode = (response && response.statusCode) ? response.statusCode : '404'
										r.unreachable.push(testUrl + ' (HTTP status: ' + statCode + ')');
									}
								});
								cb();
							}
						}),
					function () {
						// test access via Java for Studio
						var javaArgs = [],
							outObj;
						if (config.get('cli.httpProxyServer')) {
							var proxyParts = config.get('cli.httpProxyServer').split(':');
							if (proxyParts && proxyParts.length) {
								if (proxyParts.length === 2) {
									javaArgs.push('-D' + proxyParts[0] + ".proxyHost=" + proxyParts[1].replace('\/\/', ''));
								}
								else if (proxyParts.length > 2) {
									javaArgs.push('-D' + proxyParts[0] + ".proxyHost=" + proxyParts[1].replace('\/\/', ''));
									javaArgs.push('-D' + proxyParts[0] + ".proxyPort=" + proxyParts[2]);
								}
							}
						}
						javaArgs.push('-jar', path.resolve(__dirname, 'lib/dashboard-login-1.0.0.jar'));
						appc.subprocess.findExecutable(config.get('executables.java', 'java'), function (err, executable) {
							if (err) {
								// skip java tests
							} else {
								appc.subprocess.run(executable, javaArgs, function (code, out, err) {
									if (err) {
										r.javaResults.push('dashboard.appcelerator.com');
									} else if (code && code !== '400') {
										r.javaResults.push('dashboard.appcelerator.com');
									}
								});
							}
						});
						next(null, r);
					}, function () {
						next(null, r);
					});
				});
			},
			'cli': function (next) {
				appc.net.online(function (err, online) {
					var r = {
						current: cli.version,
						latest: null
					};

					if (err || !online) {
						return next(null, r);
					}

					request({
						url: 'http://registry.npmjs.org/titanium',
						proxy: config.get('cli.httpProxyServer'),
						rejectUnauthorized: config.get('cli.rejectUnauthorized', true)
					}, function (error, response, body) {
						if (!error && response.statusCode == 200) {
							try {
								var v = JSON.parse(body),
									re = /(?:alpha|beta|rc|cr)/;
								r.latest = Object.keys(v.versions).sort().filter(function (v) { return !re.test(v); }).pop();
							} catch (ex) {}
						}
						next(null, r);
					});
				});
			},
			'cliDeps': function (next) {
				var cwd = process.mainModule && process.mainModule.filename,
					root = path.resolve('/');

				if (!cwd) {
					return next(null, {});
				}

				while (cwd != root && !fs.existsSync(path.join(cwd, 'package.json'))) {
					cwd = path.dirname(cwd);
				}

				if (cwd == root) {
					return next(null, {});
				}

				appc.net.online(function (err, online) {
					var results = {};

					try {
						var pkginfo = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json')));
						Object.keys(pkginfo.dependencies).forEach(function (name) {
							var p = path.join(cwd, 'node_modules', name, 'package.json');
							results[name] = {};
							if (fs.existsSync(p)) {
								try {
									var pkginfo = JSON.parse(fs.readFileSync(p));
									results[name].current = pkginfo.version;
									results[name].latest = null;
								} catch (ex2) {}
							}
						});
					} catch (ex) {}

					if (err || !online) {
						return next(null, results);
					}

					appc.subprocess.findExecutable('npm' + (process.platform === 'win32' ? '.cmd' : ''), function (err, npm) {
						if (err) return next(null, results);

						appc.subprocess.run(npm, ['outdated'], { cwd: cwd }, function (err, stdout, stderr) {
							if (!err) {
								stdout.split('\n').forEach(function (line) {
									var parts = line.split(' '),
										m, x, y;
									if (parts.length >= 3) {
										x = parts[0].split('@');
										y = parts[1].split(/\/|\\/);
										if (y.length == 2) {
											m = parts[2].match(/\=(.+)$/);
											results[x[0]] = {
												latest: x[1],
												current: m && m[1] && m[1].toLowerCase() !== 'missing' ? m[1] : null
											};
										}
									}
								});
							}

							Object.keys(results).forEach(function (module) {
								results[module].latest || (results[module].latest = results[module].current);
							});

							next(null, results);
						});
					});
				});
			},
			'tisdk': function (next) {
				appc.net.online(function (err, online) {
					var results = {
						current: Object.keys(cli.env.sdks).sort().pop(),
						latest: null
					};

					if (err || !online) {
						return next(null, results);
					}

					request({
						url: 'http://api.appcelerator.com/p/v1/release-list',
						proxy: config.get('cli.httpProxyServer'),
						rejectUnauthorized: config.get('cli.rejectUnauthorized', true)
					}, function (error, response, body) {
						if (!error && response.statusCode == 200) {
							try {
								var os = process.platform === 'darwin' ? 'osx' : process.platform,
									releases = {};
								JSON.parse(body).releases.forEach(function (r) {
									if (r.os == os && r.name === 'mobilesdk') {
										releases[r.version] = r.url;
									}
								});
								results.latest = Object.keys(releases).sort().pop();
								if (cli.env.sdks[results.latest]) {
									results.current = results.latest;
								}
							} catch (ex) {}
						}
						next(null, results);
					});
				});
			}
		}, function (err, results) {
			busy.stop();

			var labelPadding = 18,
				checkmark = process.platform === 'win32' ? '\u221A' : '✓',
				starmark = process.platform === 'win32' ? '*' : '\u2605',
				xmark = process.platform === 'win32' ? '\u00D7' : '\u2715';

			function ok(label, status, extra) {
				log('  ' + checkmark.green + '  ' + appc.string.rpad(label, labelPadding) + ' ' + (status ? status.green : '') + (extra ? ' ' + extra.grey : ''));
			}

			function warn(label, status, extra) {
				log('  !'.yellow.bold + '  ' + appc.string.rpad(label, labelPadding) + ' ' + (status ? status.yellow : '') + (extra ? ' ' + extra.grey : ''));
			}

			function bad(label, status, extra) {
				log('  ' + xmark.red + '  ' + appc.string.rpad(label, labelPadding) + ' ' + (status ? status.red : '') + (extra ? ' ' + extra.grey : ''));
			}

			function update(label, status, extra) {
				log('  ' + starmark.magenta + '  ' + appc.string.rpad(label, labelPadding) + ' ' + (status ? status.magenta : '') + (extra ? ' ' + extra.grey : ''));
			}

			function note(label, status, extra) {
				log('  ' + '-'.grey.bold + '  ' + appc.string.rpad(label, labelPadding) + ' ' + (status ? status.grey : '') + (extra ? ' ' + extra.grey : ''));
			}

			(function (r) {
				log('Node.js');
				if (r.node.latest === null) {
					note('node', '(v' + r.node.current + ')');
				} else if (r.node.current == r.node.latest) {
					ok('node', __('up-to-date'), '(v' + r.node.current + ')');
				} else if (appc.version.gt(r.node.current, r.node.latest)) {
					ok('node', __('bleeding edge'), '(v' + r.node.current + ')');
				} else {
					update('node', __('new version v%s available!', r.node.latest), __('(currently v%s)', r.node.current));
				}
				if (r.npm.latest === null) {
					note('npm', '(v' + r.npm.current + ')');
				} else if (r.npm.current == r.npm.latest) {
					ok('npm', __('up-to-date'), '(v' + r.npm.current + ')');
				} else if (appc.version.gt(r.npm.current, r.npm.latest)) {
					ok('npm', __('bleeding edge'), '(v' + r.npm.current + ')');
				} else {
					update('npm', __('new version v%s available!', r.npm.latest), __('(currently v%s)', r.npm.current));
				}
				log();
			}(results.nodejs));

			(function (r) {
				log('Titanium CLI');
				if (r.latest === null) {
					note('cli', '(v' + r.current + ')');
				} else if (r.latest == r.current) {
					ok('cli', __('up-to-date'), '(v' + r.current + ')');
				} else if (appc.version.gt(r.current, r.latest)) {
					ok('cli', __('bleeding edge'), '(v' + r.current + ')');
				} else {
					update('cli', __('new version v%s available', r.latest), __('(currently v%s)', r.current));
				}
				log();
			}(results.cli));

			(function (r) {
				log('Titanium CLI Dependencies');
				Object.keys(r).sort().forEach(function (name) {
					if (r[name].latest === null) {
						note(name, '(v' + r[name].current + ')');
					} else if (r[name].current) {
						if (appc.version.gt(r[name].latest, r[name].current)) {
							update(name, __('new version v%s available!', r[name].latest), __('(currently v%s)', r[name].current));
						} else if (appc.version.gt(r[name].current, r[name].latest)) {
							ok(name, __('bleeding edge'), '(v' + r[name].current + ')');
						} else {
							ok(name, __('up-to-date'), '(v' + r[name].current + ')');
						}
					} else {
						bad(name, 'missing');
					}
				});
				log();
			}(results.cliDeps));

			(function (r) {
				log('Titanium SDK');
				if (r.latest === null) {
					note(__('latest sdk'), __('unknown (offline)'));
				} else if (!r.current) {
					bad(__('latest sdk'), __('no Titanium SDKs found'));
				} else if (appc.version.gt(r.latest, r.current)) {
					update(__('latest sdk'), __('new version v%s available!', r.latest), __('(currently v%s)', r.current));
				} else {
					ok(__('latest sdk'), __('installed'), '(v' + r.current + ')');
				}
				var selectedSdk = config.get('sdk.selected');
				if (r.current) {
					var selected = cli.env.sdks[selectedSdk],
						current = cli.env.sdks[r.current];
					if (!selected) {
						// bad, invalid selected sdk, select an sdk
						bad(__('selected sdk'), __('selected Titanium SDK "v%s" is not installed', selectedSdk));
					} else if (selectedSdk) {
						// make sure the selected is >= current
						if (appc.version.gte(selected.manifest && selected.manifest.version || selected.name, current.manifest && current.manifest.version || current.name)) {
							ok(__('selected sdk'), __('up-to-date'),'(v' + r.current + ')');
						} else {
							warn(__('selected sdk'), __('latest Titanium SDK "v%s" is not the selected SDK', r.latest), __('(currently v%s)', selectedSdk));
						}
					} else {
						// bad, no selected sdk, select an sdk
						bad(__('selected sdk'), __('no selected Titanium SDK'));
					}
				} else {
					bad('selected sdk', __('no Titanium SDKs found'));
				}
				log();
			}(results.tisdk));

			process.platform === 'darwin' && (function (r) {
				log(__('Mac OS X Environment'));
				if (r.installed) {
					ok(__('CLI Tools'), __('installed'));
				} else {
					warn(__('CLI Tools'), __('not found'));
				}
				log();
			}(results.clitools));

			process.platform === 'darwin' && (function (r) {
				log(__('iOS Environment'));

				var distPPLabel = __('dist provisioning'),
					len = distPPLabel.length;

				if (Object.keys(r.xcode).length) {
					ok(appc.string.rpad('Xcode', len), __('installed'), '(' + Object.keys(r.xcode).filter(function (ver) {
						return ver !== '__selected__';
					}).map(function (ver) {
						return r.xcode[ver].version;
					}).sort().join(', ') + ')');

					var iosSdks = {};
					Object.keys(r.xcode).forEach(function (ver) {
						if (ver !== '__selected__') {
							r.xcode[ver].sdks.forEach(function (v) {
								iosSdks[v] = 1;
							});
						}
					});
					if (Object.keys(iosSdks).length) {
						ok(appc.string.rpad(__('iOS SDK'), len), __('installed'), '(' + Object.keys(iosSdks).sort().join(', ') + ')');
					} else {
						warn(appc.string.rpad(__('iOS SDK'), len), __('no iOS SDKs found'));
					}
				} else {
					warn(appc.string.rpad('Xcode', len), __('no Xcode installations found'));
					warn(appc.string.rpad(__('iOS SDK'), len), __('no Xcode installations found'));
				}

				if (r.certs.wwdr) {
					ok(appc.string.rpad(__('WWDR cert'), len), __('installed'));
				} else {
					warn(appc.string.rpad(__('WWDR cert'), len), __('not found'));
				}

				var devCerts = 0,
					distCerts = 0;

				Object.keys(r.certs.keychains).forEach(function (keychain) {
					if (r.certs.keychains[keychain].developer) {
						r.certs.keychains[keychain].developer.forEach(function (i) {
							if (!i.hasOwnProperty('invalid') || i.invalid === false) {
								devCerts++;
							}
						});
					}
					if (r.certs.keychains[keychain].distribution) {
						r.certs.keychains[keychain].distribution.forEach(function (i) {
							if (!i.hasOwnProperty('invalid') || i.invalid === false) {
								distCerts++;
							}
						});
					}
				});

				if (devCerts) {
					ok(appc.string.rpad(__('developer cert'), len), __('installed'), __('(%s found)', devCerts));
				} else {
					warn(appc.string.rpad(__('developer cert'), len), __('not found'));
				}

				if (distCerts) {
					ok(appc.string.rpad(__('distribution cert'), len), __('installed'), __('(%s found)', distCerts));
				} else {
					warn(appc.string.rpad(__('distribution cert'), len), __('not found'));
				}

				var devPP = r.provisioningProfiles.development.filter(function (i) {
					return !i.hasOwnProperty('expired') || i.expired == false;
				}).length;
				if (devPP) {
					ok(appc.string.rpad(__('dev provisioning'), len), __('installed'), __('(%s found)', devPP));
				} else {
					warn(appc.string.rpad(__('dev provisioning'), len), __('not found'));
				}

				var distPP = r.provisioningProfiles.distribution.filter(function (i) {
					return !i.hasOwnProperty('expired') || i.expired == false;
				}).length + r.provisioningProfiles.adhoc.filter(function (i) {
					return !i.hasOwnProperty('expired') || i.expired == false;
				}).length;
				if (distPP) {
					ok(distPPLabel, __('installed'), __('(%s found)', distPP));
				} else {
					warn(distPPLabel, __('not found'));
				}

				log();
			}(results.ios));

			(function (r) {
				log(__('Android Environment'));

				if (r.sdkPath) {
					ok('sdk', __('installed'), '(' + r.sdkPath + ')');
				} else if (r.sdk) {
					ok('sdk', __('installed'), '(' + r.sdk.path + ')');

					if (r.sdk.tools && r.sdk.tools.path) {
						if (r.sdk.tools.supported === 'maybe') {
							warn('tools', __('untested version %s; may or may not work', r.sdk.tools.version));
						} else if (r.sdk.tools.supported) {
							ok('tools', __('installed'), '(v' + r.sdk.tools.version + ')');
						} else {
							bad('tools', __('unsupported version %s', r.sdk.tools.version));
						}
					}

					if (r.sdk.platformTools && r.sdk.platformTools.path) {
						if (r.sdk.platformTools.supported === 'maybe') {
							warn('platform tools', __('untested version %s; may or may not work', r.sdk.platformTools.version));
						} else if (r.sdk.platformTools.supported) {
							ok('platform tools', __('installed'), '(v' + r.sdk.platformTools.version + ')');
						} else {
							bad('platform tools', __('unsupported version %s', r.sdk.platformTools.version));
						}
					}

					if (r.sdk.buildTools && r.sdk.buildTools.path) {
						if (r.sdk.buildTools.supported === 'maybe') {
							warn('build tools', __('untested version %s; may or may not work', r.sdk.buildTools.version));
						} else if (r.sdk.buildTools.supported) {
							ok('build tools', __('installed'), '(v' + r.sdk.buildTools.version + ')');
						} else {
							bad('build tools', __('unsupported version %s', r.sdk.buildTools.version));
						}
					}

					if (r.sdk.executables) {
						if (r.sdk.executables.adb) {
							ok('adb', __('installed'), r.sdk.executables.adb);
						} else {
							bad('adb', __('"adb" executable not found; please reinstall Android SDK'));
						}
						if (r.sdk.executables.android) {
							ok('android', __('installed'), r.sdk.executables.android);
						} else {
							bad('android', __('"android" executable not found; please reinstall Android SDK'));
						}
						if (r.sdk.executables.emulator) {
							ok('emulator', __('installed'), r.sdk.executables.emulator);
						} else {
							bad('emulator', __('"emulator" executable not found; please reinstall Android SDK'));
						}
						if (r.sdk.executables.mksdcard) {
							ok('mksdcard', __('installed'), r.sdk.executables.mksdcard);
						} else {
							bad('mksdcard', __('"mksdcard" executable not found; please reinstall Android SDK'));
						}
						if (r.sdk.executables.zipalign) {
							ok('zipalign', __('installed'), r.sdk.executables.zipalign);
						} else {
							bad('zipalign', __('"zipalign" executable not found; please reinstall Android SDK'));
						}
						if (r.sdk.executables.aapt) {
							ok('aapt', __('installed'), r.sdk.executables.aapt);
						} else {
							bad('aapt', __('"aapt" executable not found; please reinstall Android SDK'));
						}
						if (r.sdk.executables.aidl) {
							ok('aidl', __('installed'), r.sdk.executables.aidl);
						} else {
							bad('aidl', __('"aidl" executable not found; please reinstall Android SDK'));
						}
					}
				} else {
					warn('sdk', __('Android SDK not found'));
				}

				if (r.targets && Object.keys(r.targets).length) {
					ok(__('targets'), __('installed'), __('(%s found)', Object.keys(r.targets).length));
				} else {
					warn(__('targets'), __('no targets found'));
				}

				if (r.avds && r.avds.length) {
					ok(__('avds'), __('installed'), __('(%s found)', r.avds.length));
				} else {
					warn(__('avds'), __('no avds found'));
				}

				if (r.ndk) {
					ok('ndk', __('installed'), '(' + r.ndk.version + ')');
					if (r.ndk.executables) {
						ok('ndk-build', __('installed'), '(' + r.ndk.executables.ndkbuild + ')');
					}
				} else {
					warn('ndk', __('Android NDK not found'));
				}

				log();
			}(results.android));

			(function (r) {
				log('Java Development Kit');
				if (r.version == null) {
					bad('jdk', __('JDK not found!'));
				} else {
					ok('jdk', __('installed'), '(v' + r.version + ')');

					if (r.executables.java) {
						ok('java', __('installed'), r.executables.java);
					} else {
						bad('java', __('"java" executable not found; please reinstall JDK 1.6'));
					}
					if (r.executables.javac) {
						ok('javac', __('installed'), r.executables.javac);
					} else {
						bad('javac', __('"javac" executable not found; please reinstall JDK 1.6'));
					}
					if (r.executables.keytool) {
						ok('keytool', __('installed'), r.executables.keytool);
					} else {
						bad('keytool', __('"keytool" executable not found; please reinstall JDK 1.6'));
					}
					if (r.executables.jarsigner) {
						ok('jarsigner', __('installed'), r.executables.jarsigner);
					} else {
						bad('jarsigner', __('"jarsigner" executable not found; please reinstall JDK 1.6'));
					}
				}
				log();
			}(results.java));

			(function (r) {
				log('Intel® Hardware Accelerated Execution Manager (HAXM)');
				if (!r.compatible) {
					note(__('compatible'), __('unsupported, requires an Intel® CPU'));
				} else if (r.installed) {
					ok(__('compatible'));
					ok(__('installed'));
				} else {
					ok(__('compatible'));
					warn(__('installed'), __('not found; install HAXM to use Android x86 emulator'));
				}
				log();
			}(results.haxm));

			(function (r) {
				log(__('Network'));
				if (r.online) {
					ok(__('online'));
				} else {
					warn(__('offline'));
				}
				if (r.proxy) {
					ok(__('proxy server enabled'));
				} else {
					note(__('no proxy server configured'));
				}
				if (r.online) {
					if (r.unreachable.length) {
						r.unreachable.forEach(function(unreachableUrl) {
							bad(unreachableUrl + __(' is unreachable'));
						});
					} else {
						ok(__('Network connection test'));
					}
					if (r.javaResults.length) {
						r.javaResults.forEach(function(javaURL) {
							bad(javaURL + __(' is unreachable via Java'));
						});
					} else {
						ok(__('Java-based connection test'));
					}
				} else {
					note(__('Network connection test'));
					note(__('Java-based connection test'));
				}
				log();
			}(results.network));

			(function () {
				log(__('Directory Permissions'));
				[
					[ '~', __('home directory') ],
					[ '~/.titanium', __('titanium config directory') ],
					[ cli.env.installPath, __('titanium sdk install directory') ],
					[ config.get('app.workspace'), __('workspace directory') ],
					[ temp.dir, __('temp directory') ]
				].forEach(function (info) {
					if (info[0]) {
						var dir = afs.resolvePath(info[0]);
						if (fs.existsSync(dir)) {
							if (afs.isDirWritable(dir)) {
								ok(info[1]);
							} else {
								bad(info[1], __('"%s" not writable, check permissions and owner', dir));
							}
						} else {
							warn(info[1], __('"%s" does not exist', dir));
						}
					}
				});
				log();
			}());

			callback();
		});
	} catch (ex) {
		busy.stop();
		throw ex;
	}
};

/**
 * Configures user-related settings.
 * @param {Function} callback - Function to be called when the prompting finishes
 */
SetupScreens.prototype.user = function user(callback) {
	this._title(__('User Information'));
	fields.set({
		'name': this._registry.user.name,
		'email': this._registry.user.email,
		'locale': this._registry.user.locale
	}).prompt(function (err, data) {
		!err && this._save({ user: data });
		callback();
	}.bind(this));
};

/**
 * Configures new app default settings.
 * @param {Function} callback - Function to be called when the prompting finishes
 */
SetupScreens.prototype.app = function app(callback) {
	this._title(__('New App Defaults'));
	fields.set({
		'workspace': this._registry.app.workspace,
		'idprefix': fields.text({
			default: this._config.get('app.idprefix'),
			title: __('What is your prefix for application IDs?'),
			desc: __('(example: com.mycompany)')
		}),
		'publisher': fields.text({
			default: this._config.get('app.publisher'),
			title: __('Used for populating the "publisher" field in new projects:')
		}),
		'url': fields.text({
			default: this._config.get('app.url'),
			title: __('Used for populating the "url" field in new projects:')
		})
	}).prompt(function (err, data) {
		!err && this._save({ app: data });
		callback();
	}.bind(this));
};

/**
 * Configures network settings.
 * @param {Function} callback - Function to be called when the prompting finishes
 */
SetupScreens.prototype.network = function app(callback) {
	var defaultProxy = '';
	if (this._config.get('cli.httpProxyServer')) {
		defaultProxy = this._config.get('cli.httpProxyServer');
	} else if (proxy.length > 0) {
		var i = 0, len = proxy.length;
		for(; i < len; i++) {
			if (proxy[i] && proxy[i].valid) {
				defaultProxy = proxy[i].fullAddress;
				console.log(defaultProxy)
				break;
			}
		}
	}
	var httpProxyServer = {
		promptLabel: __('Proxy server URL'),
		default: defaultProxy,
		validate: function (value) {
			var u = url.parse(value);
			if (!/^https?\:$/.test(u.protocol)) {
				throw new Error(__('HTTP proxy url protocol must be either "http" or "https" (ex: http://user:pass@example.com)'));
			}
			if (!(u.host || '')) {
				throw new Error(__('HTTP proxy url must contain a host name (ex: http://user:pass@example.com)'));
			}
			return true;
		}
	};
	httpProxyServer.default || delete httpProxyServer.default;

	this._title(__('Network Settings'));

	fields.set({
		'hasProxy': fields.select({
			promptLabel: __('Are you behind a proxy server?'),
			display: 'prompt',
			default: this._config.get('cli.httpProxyServer') ? 'yes' : 'no',
			options: [ 'yes', 'no' ],
			next: function (err, value) {
				return value == 'yes' ? 'httpProxyServer' : 'rejectUnauthorized';
			}
		}),
		'httpProxyServer': fields.text(httpProxyServer),
		'rejectUnauthorized': fields.select({
			promptLabel: __('Verify server (SSL) certificates against known certificate authorities?'),
			display: 'prompt',
			default: this._config.get('cli.rejectUnauthorized', true) === false ? 'no' : 'yes',
			options: [ 'yes', 'no' ]
		})
	}).prompt(function (err, data) {
		if (!err) {
			// reset httpProxyServer
			if (data.hasProxy === 'no') {
				data.httpProxyServer = "";
			}

			delete data.hasProxy;
			this._save({ cli: data });
		}
		callback();
	}.bind(this));
};

/**
 * Configures CLI settings.
 * @param {Function} callback - Function to be called when the prompting finishes
 */
SetupScreens.prototype.cli = function cli(callback) {
	this._title(__('Titanium CLI Settings'));

	fields.set({
		'colors': fields.select({
			promptLabel: __('Enable colors?'),
			display: 'prompt',
			default: this._config.get('cli.colors', true) === false ? 'no' : 'yes',
			options: [ 'yes', 'no' ]
		}),
		'prompt': fields.select({
			promptLabel: __('Enable interactive prompting for missing options and arguments?'),
			display: 'prompt',
			default: this._config.get('cli.prompt', true) === false ? 'no' : 'yes',
			options: [ 'yes', 'no' ]
		}),
		'progressBars': fields.select({
			promptLabel: __('Display progress bars when downloading or installing?'),
			display: 'prompt',
			default: this._config.get('cli.progressBars', true) === false ? 'no' : 'yes',
			options: [ 'yes', 'no' ]
		}),
		/*'completion': fields.select({
			promptLabel: __('Enable bash completion? (Mac OS X and Linux only)'),
			display: 'prompt',
			default: this._config.get('cli.completion', false) === false ? 'no' : 'yes',
			options: [ 'yes', 'no' ]
		}),*/
		'logLevel': fields.select({
			title: __('Output log level'),
			promptLabel: __('Enter # or log level'),
			style: {
				option: 'cyan'
			},
			complete: true,
			completeIgnoreCase: true,
			numbered: true,
			suggest: true,
			suggestThreshold: 2,
			default: this._config.get('cli.logLevel', 'trace'),
			options: this._logger.getLevels()
		}),
		'width': fields.text({
			title: __('What is the width of the Titanium CLI output?'),
			description: __('Enter 0 for max width of the terminal.'),
			promptLabel: __('CLI width'),
			default: this._config.get('cli.width', 100),
			validate: function (value, callback) {
				value = parseInt(value);
				if (isNaN(value) || value < 0) {
					throw new Error(__('Width must be greater than or equal to zero'));
				}
				callback(null, value);
			}
		}),
		'failOnWrongSDK': fields.select({
			promptLabel: __('Fail if selected Titanium SDK differs from <sdk-version> in tiapp.xml?'),
			display: 'prompt',
			default: this._config.get('cli.failOnWrongSDK', false) === false ? 'no' : 'yes',
			options: [ 'yes', 'no' ]
		})
	}).prompt(function (err, data) {
		if (!err) {
			data.colors = (data.colors == 'yes');
			data.prompt = (data.prompt == 'yes');
			data.progressBars = (data.progressBars == 'yes');
			//data.completion = (data.completion == 'yes');
			data.failOnWrongSDK = (data.failOnWrongSDK == 'yes');
			this._save({ cli: data });
		}
		callback();
	}.bind(this));
};

/**
 * Configures Titanium SDK settings.
 * @param {Function} callback - Function to be called when the prompting finishes
 */
SetupScreens.prototype.sdk = function sdk(callback) {
	this._title(__('Titanium SDK Settings'));
	fields.set({
		'selected': this._registry.sdk.selected(),
		'defaultInstallLocation': fields.file({
			default: this._config.get('sdk.defaultInstallLocation', this._cli.env.installPath),
			title: __('Path to find and install Titanium SDKs:'),
			complete: true,
			showHidden: true,
			ignoreDirs: new RegExp(this._config.get('cli.ignoreDirs')),
			ignoreFiles: new RegExp(this._config.get('cli.ignoreFiles')),
			validate: function (value) {
				if (!value || (fs.existsSync(afs.resolvePath(value)) && !fs.statSync(value).isDirectory())) {
					throw new Error(__('Invalid directory'));
				} else if (!fs.existsSync(afs.resolvePath(value))) {
					if (afs.isDirWritable(afs.resolvePath(value, '..'))) {
						wrench.mkdirSyncRecursive(value);
					} else {
						throw new Error(__('Invalid path or insufficient permissions'));
					}
				}
				return true;
			}.bind(this)
		})
	}).prompt(function (err, data) {
		!err && this._save({ sdk: data });
		callback();
	}.bind(this));
};

/**
 * Configures iOS-related settings.
 * @param {Function} callback - Function to be called when the prompting finishes
 */
SetupScreens.prototype.ios = function ios(callback) {
	if (process.platform !== 'darwin') {
		return callback();
	}

	var busy = new appc.busyindicator;
	busy.start();

	detectIos(this._logger, this._config, this._cli, function (results) {
		busy.stop();

		this._title(__('iOS Settings'));

		var devList = [],
			devNames = {}
			currentDevName = this._config.get('ios.developerName'),
			distList = [],
			distNames = {},
			currentDistName = this._config.get('ios.distributionName');

		if (results.detectVersion === '1.0') {
			results.certs.devNames.forEach(function (n) {
				if (!devNames[n]) {
					devList.push({ name: n });
					devNames[n] = 1;
				}
			});

			results.certs.distNames.forEach(function (n) {
				if (!distNames[n]) {
					distList.push({ name: n });
					distNames[n] = 1;
				}
			});
		} else {
			Object.keys(results.certs.keychains).forEach(function (keychain) {
				(results.certs.keychains[keychain].developer || []).forEach(function (dev) {
					var n = dev.name;
					if ((n === currentDevName || !dev.invalid) && !devNames[n]) {
						devList.push(dev);
						devNames[n] = 1;
					}
				});

				(results.certs.keychains[keychain].distribution || []).forEach(function (dist) {
					var n = dist.name;
					if ((n === currentDistName || !dist.invalid) && !distNames[n]) {
						distList.push(dist);
						distNames[n] = 1;
					}
				});
			});
		}

		fields.set({
			'developerName': devList.length && fields.select({
				default: currentDevName,
				title: __('What do you want to be your default iOS developer cert for device builds?'),
				desc: __('(only valid, non-expired developer certs are listed)'),
				promptLabel: __('Enter # or cert name'),
				display: devList.length > 5 ? 'grid' : 'list',
				complete: true,
				completeIgnoreCase: true,
				zeroSkip: true,
				numbered: true,
				suggest: true,
				optionLabel: 'name',
				optionValue: 'name',
				formatters: {
					option: function (opt, i) {
						return '  ' + (i+1) + ') ' + opt.name.cyan + (opt.expired ? ' ' + __('**EXPIRED**').red : opt.invalid ? ' ' + __('**NOT VALID**').red : '');
					}
				},
				options: devList.sort(function (a, b) {
					return a.name > b.name ? 1 : a.name < b.name ? -1 : 0;
				}),
				validate: function (value, callback) {
					if (value) {
						var i, l;

						// try to find an exact match
						for (i = 0, l = devList.length; i < l; i++) {
							if (devList[i].name == value) {
								callback(null, value);
								return;
							}
						}

						value += ' (';

						// no match, try partial match without the id
						for (i = 0, l = devList.length; i < l; i++) {
							if (devList[i].name.indexOf(value) == 0) {
								callback(null, devList[i].name);
								return;
							}
						}
					}

					throw new Error(__('Invalid iOS developer certificate'));
				}.bind(this)
			}),
			'distributionName': distList.length && fields.select({
				default: currentDistName,
				title: __('What do you want to be your default iOS distribution cert for App Store and Ad Hoc builds?'),
				desc: __('(only valid, non-expired distribution certs are listed)'),
				promptLabel: __('Enter # or cert name'),
				display: distList.length > 5 ? 'grid' : 'list',
				complete: true,
				completeIgnoreCase: true,
				zeroSkip: true,
				numbered: true,
				suggest: true,
				optionLabel: 'name',
				optionValue: 'name',
				formatters: {
					option: function (opt, i) {
						return '  ' + (i+1) + ') ' + opt.name.cyan + (opt.expired ? ' ' + __('**EXPIRED**').red : opt.invalid ? ' ' + __('**NOT VALID**').red : '');
					}
				},
				options: distList.sort(function (a, b) {
					return a.name > b.name ? 1 : a.name < b.name ? -1 : 0;
				}),
				validate: function (value, callback) {
					if (value) {
						// try to find an exact match
						for (var i = 0, l = distList.length; i < l; i++) {
							if (distList[i].name == value) {
								callback(null, value);
								return;
							}
						}
					}

					throw new Error(__('Invalid iOS distribution certificate'));
				}.bind(this)
			})
		}).prompt(function (err, data) {
			!err && this._save({ ios: data });
			callback();
		}.bind(this));
	}.bind(this));
};

/**
 * Configures Android-related settings.
 * @param {Function} callback - Function to be called when the prompting finishes
 */
SetupScreens.prototype.android = function android(callback) {
	this._title(__('Android Settings'));

	var busy = new appc.busyindicator;
		busy.start();

	detectAndroid(this._logger, this._config, this._cli, function (results) {
		busy.stop();

		fields.set({
			'sdkPath': this._registry.android.sdkPath(this._config.get('android.sdkPath', results && results.sdk && results.sdk.path)),
			'ndkPath': fields.file({
				default: this._config.get('android.ndkPath'),
				title: __('Path to the Android NDK'),
				desc: __('Only required for building native Titainum Modules.'),
				complete: true,
				showHidden: true,
				ignoreDirs: new RegExp(this._config.get('cli.ignoreDirs')),
				ignoreFiles: new RegExp(this._config.get('cli.ignoreFiles')),
				validate: function (value) {
					if (value) {
						if (!fs.existsSync(afs.resolvePath(value) || fs.statSync(value).isDirectory())) {
							throw new appc.exception(__('Invalid Android NDK path'));
						}

						var releasetxtExecutable = path.join(value, 'RELEASE.txt');
						if (!fs.existsSync(releasetxtExecutable)) {
							throw new Error(__('Invalid Android NDK path') + '\n' + __('Required file does not exist: "%s"', releasetxtExecutable));
						}

						var ndkbuildExecutable = path.join(value, 'ndk-build' + (process.platform == 'win32' ? '.cmd' : ''));
						if (!fs.existsSync(ndkbuildExecutable)) {
							throw new Error(__('Invalid Android NDK path') + '\n' + __('Required file does not exist: "%s"', ndkbuildExecutable));
						}
					}

					return true;
				}.bind(this)
			})
		}).prompt(function (err, data) {
			!err && this._save({ android: data });
			callback();
		}.bind(this));
	}.bind(this));
};

/**
 * Configures Windows Phone/Store settings.
 * @param {Function} callback - Function to be called when the prompting finishes
 */
SetupScreens.prototype.windows = function windows(callback) {
	this._title(__('Windows Settings'));

	fields.set({
		'publisherGuid': fields.text({
			promptLabel: __('What is your Windows Publisher ID?'),
			default: this._config.get('windows.phone.publisherGuid')
		})
	}).prompt(function (err, data) {
		!err && this._save({ windows: { phone: { publisherGuid: data['publisherGuid'] } } });
		callback();
	}.bind(this));
};

/**
 * Configures search paths.
 * @param {Function} callback - Function to be called when the prompting finishes
 */
SetupScreens.prototype.paths = function paths(callback) {
	this._title(__('Search Paths'));
	// TODO
	// "commands": [],
	// "hooks": [
	// 	"/Users/chris/appc/liveview/hook",
	// 	"/Users/chris/appc/titanium-code-processor/hooks"
	// ],
	// "modules": [
	// 	"/Users/chris/Library/Application Support/Titanium"
	// ],
	// "plugins": [
	// 	"~/appc/ti.alloy"
	// ],
	// "sdks": [
	// 	"/Users/chris/Desktop"
	// ],
	// "xcode": []
	callback();
};

/**
 * Exits the setup command.
 * @param {Function} callback - Function to be called when the prompting finishes
 */
SetupScreens.prototype.exit = function exit() {
	process.exit(0);
};
