/**
 * Main entry point for the Titanium CLI. Responsible for loading the CLI
 * configuration, initializing the i18n system, wiring up analytics, defining
 * global options and flags, and running the main CLI logic.
 *
 * @module titanium
 *
 * @copyright
 * Copyright (c) 2009-2015 by Appcelerator, Inc. All Rights Reserved.
 *
 * @license
 * Licensed under the terms of the Apache Public License
 * Please see the LICENSE included with this distribution for details.
 *
 * @requires colors
 * @requires node-appc
 * @requires semver
 */
'use strict';

var fs = require('fs'),
	path = require('path'),
	colors = require('colors'),
	semver = require('semver'),
	pkgJson = require('../package.json');

// set path.existsSync to make old modules designed for <=0.6 happy
path.existsSync = fs.existsSync || path.existsSync;

// check that we're using supported Node.js version.
try {
	if (!semver.satisfies(process.version, pkgJson.engines.node)) {
		console.error(pkgJson.about.name.cyan.bold + ', CLI version ' + pkgJson.version + '\n' + pkgJson.about.copyright + '\n\n'
			+ ('ERROR: Titanium requires Node.js ' + semver.validRange(pkgJson.engines.node) + '.').red + '\n\n'
			+ 'Visit ' + 'http://nodejs.org/'.cyan + ' to download a newer version.\n');
		process.exit(1);
	}
} catch (e) {}

// read the locale and bootstrap the CLI as necessary
(function () {
	var configFilePath = path.join(process.env[process.platform === 'win32' ? 'USERPROFILE' : 'HOME'], '.titanium', 'config.json');

	function detectLocale(callback) {
		// eslint-disable-next-line security/detect-child-process
		const exec = require('child_process').exec;
		if (process.platform === 'win32') {
			exec('reg query "HKCU\\Control Panel\\International" /v Locale', function (err, stdout, _stderr) {
				if (err) {
					return callback();
				}
				var m = stdout.match(/Locale\s+REG_SZ\s+(.+)/);
				if (m) {
					m = m[1].substring(m[1].length - 4, m[1].length);
					exec('reg query "HKLM\\SOFTWARE\\Classes\\MIME\\Database\\Rfc1766" /v ' + m, function (err, stdout, _stderr) {
						if (!err) {
							var m = stdout.match(/REG_SZ\s+([^;,\n]+?);/);
							if (m) {
								return callback(m[1]);
							}
						}
						callback();
					});
					return;
				}
			});
		} else {
			exec('locale', function (err, stdout, _stderr) {
				callback(stdout.split('\n').shift().replace(/(LANG=["']?([^."']+).*)/m, '$2'));
			});
		}
	}

	if (fs.existsSync(configFilePath)) {
		try {
			var config = JSON.parse(fs.readFileSync(configFilePath));
			if (config && config.user && config.user.locale) {
				resolveNode(config.user.locale);
				return;
			}
		} catch (e) {}
	}
	detectLocale(resolveNode);
}());

function getArg(name) {
	var p = process.argv.indexOf(name);
	if (p !== -1 && p + 1 < process.argv.length) {
		return process.argv[p + 1];
	}
	return null;
}

function resolveNode(locale) {
	// we need to resolve the real node executable path such that it matches
	// process.execPath, then the cli arg parser will know whether or not the first
	// arg is "node" executable name.
	//
	// in some environments, such as Linux, the "node" executable is not called
	// "node", so we must resolve symlinks.
	require('node-appc').subprocess.findExecutable(process.argv[0], function (err, node) {
		if (!err && node) {
			process.argv[0] = fs.realpathSync(node);
		}
		run(locale);
	});
}

function run(locale) {
	// try to load the config file
	var appc = require('node-appc'),
		config = require('./config');

	process.env.locale = locale;
	config.setDefault('user.locale', locale);

	try {
		config.load(getArg('--config-file'));
	} catch (ex) {
		console.error(('[ERROR] ' + (ex.message || ex.toString()).trim()).red);
		try {
			var backup = config.getConfigPath() + '.' + Date.now() + '.json';
			fs.writeFileSync(backup, fs.readFileSync(config.getConfigPath()));
			fs.unlinkSync(config.getConfigPath());
			console.error(('[ERROR] The bad config file has been renamed to ' + backup).red);
		} catch (ex2) {
			console.error('[ERROR] Failed to backup the config file, please manually rename/remove it'.red);
			process.exit(1);
		}
		console.error('[ERROR] Using default config'.red);
		console.error('[ERROR] Run "titanium setup" to reconfigure'.red + '\n');
	}

	// if there's a --config, mix it into our config
	try {
		var json = JSON.parse('' + getArg('--config') + '');
		if (json && typeof json === 'object') {
			appc.util.mixObj(config, json);
		}
	} catch (ex) {
		console.log(ex);
	}

	var __ = appc.i18n(__dirname).__,
		env = appc.environ,
		afs = appc.fs,
		logger = require('./logger'),
		pkginfo = appc.pkginfo.package(module, 'version', 'about'),
		defaultInstallLocation = config.get('sdk.defaultInstallLocation'),
		sdkPaths = config.get('paths.sdks');

	config.cli.colors || (colors.mode = 'none');

	process.setMaxListeners(666);

	if (defaultInstallLocation) {
		defaultInstallLocation = afs.resolvePath(defaultInstallLocation);
	}

	// make sure our sdk paths are good to go
	Array.isArray(sdkPaths) || (sdkPaths = []);
	if (defaultInstallLocation && !sdkPaths.some(function (p) {
		return afs.resolvePath(p) === defaultInstallLocation;
	})) {
		sdkPaths.push(defaultInstallLocation);
		config.paths || (config.paths = {});
		config.paths.sdks = sdkPaths;
		config.save();
	}

	// find all Titanium sdks
	env.detectTitaniumSDKs(sdkPaths);

	// this is really used anymore, but best to set it to the configured install location
	env.installPath = defaultInstallLocation || env.installPath;

	// initialize the cli processor
	const CLI = require('./cli');
	var cli = new CLI({
		config: config,
		env: env,
		logger: logger,
		version: pkginfo.version
	});

	// determine the default color.
	// if we have a TTY, then use config default
	// if we don't have a TTY and the explicit command line --colors is passed in, use this so
	// that programs that want to include the color codes (such as a pipe) in the output, still get them
	var defaultColor = process.argv.indexOf('--color') !== -1;
	if (!defaultColor) {
		defaultColor = process.stdout.isTTY ? config.get('cli.colors', true) : false;
	}

	// define the global flags
	var conf = {
		flags: {
			help: {
				abbr: 'h',
				callback: function (value) {
					if (value) {
						cli.argv.$command = 'help';
					}
				},
				desc: __('displays help')
			},
			version: {
				abbr: 'v',
				callback: function (value) {
					if (value) {
						console.log(pkginfo.version);
						process.exit(0);
					}
				},
				desc: __('displays the current version')
			},
			colors: {
				callback: function (value) {
					colors.mode = value ? 'console' : 'none';
					Object.keys(logger.transports).forEach(function (name) {
						logger.transports[name].colorize = value;
					});
					if (!value) {
						// since this function is called whenever --no-color or --no-colors is set
						// and we don't know which one it was, we set whichever is not set and the
						// parser will correctly set --no-colors
						cli.argv.$_.indexOf('--no-color') === -1 && cli.argv.$_.push('--no-color');
						cli.argv.$_.indexOf('--no-colors') === -1 && cli.argv.$_.push('--no-colors');
					}
				},
				default: defaultColor,
				desc: __('disable colors'),
				hideDefault: true,
				negate: true
			},
			quiet: {
				abbr: 'q',
				callback: function (value) {
					logger.silence(!!value);
				},
				default: config.get('cli.quiet', false),
				desc: __('suppress all output'),
				hideDefault: true
			},
			prompt: {
				default: config.get('cli.prompt', true),
				desc: __('disable interactive prompting'),
				hideDefault: true,
				negate: true
			},
			'progress-bars': {
				default: process.stdout.isTTY ? config.get('cli.progressBars', true) : false,
				desc: __('disable progress bars'),
				hideDefault: true,
				negate: true
			},
			banner: {
				callback: function (value) {
					logger.bannerEnabled(!!value);
				},
				default: true,
				desc: __('disable Titanium version banner'),
				hideDefault: true,
				negate: true
			}
		},
		options: {
			config: {
				desc: __('serialized JSON string to mix into CLI config'),
				hint: 'json'
			},
			'config-file': {
				default: config.getConfigPath(),
				desc: __('path to CLI config file'),
				hint: __('file')
			},
			sdk: {
				abbr: 's',
				default: 'latest',
				desc: __('Titanium SDK version to use to bootstrap SDK-level commands and parse the tiapp.xml; actual Titanium SDK used determined by %s in the tiapp.xml', '<sdk-version>'.cyan),
				hint: __('version')
			}
		}
	};

	// duplicate the 'colors' options so we can make a hidden 'color' option
	// just in case some does --no-color instead of --no-colors
	conf.flags.color = appc.util.mix({}, conf.flags.colors);
	conf.flags.color.hidden = true;

	// set the config options and flags
	cli.configure(conf);

	// get a list of all valid sdks 3.0 and newer
	var sdks = Object.keys(env.sdks).filter(function (v) {
		try {
			return appc.version.gte(env.sdks[v].manifest && env.sdks[v].manifest.version || v, '3.0.0');
		} catch (e) {
			return false;
		}
	});

	// wire up the titanium sdk check
	function checkTitaniumSdk() {
		if (!sdks.length) {
			if (Object.keys(env.sdks).length) {
				logger.error(__('No selectable Titanium SDKs are installed'));
				logger.error(__('You need at least one Titanium SDK 3.0 or newer'));
			} else {
				logger.error(__('No Titanium SDKs are installed'));
			}
			logger.error(__('You can download the latest Titanium SDK by running: %s', cli.argv.$ + ' sdk install') + '\n');
		} else if (!argv.sdk) {
			var sdkName = config.get('sdk.selected', config.get('app.sdk')),
				sdk = sdkName && cli.env.getSDK(sdkName);
			if (sdkName && !sdk) {
				logger.error(__('Invalid selected Titanium SDK "%s"', sdkName));
				logger.error(__('Run "%s" to set the selected Titanium SDK', cli.argv.$ + ' sdk select') + '\n');
			} else if (sdk && appc.version.lt(sdk.manifest && sdk.manifest.version || sdk.name, '3.0.0')) {
				logger.error(__('The selected Titanium SDK "%s" is too old', sdkName) + '\n');
			}
		}
	}
	cli.on('cli:command-not-found', checkTitaniumSdk);
	cli.on('help:header', checkTitaniumSdk);

	cli.on('cli:check-plugins', function (data) {
		if (cli.hooks.incompatibleFilenames.length) {
			// display all hooks for debugging
			logger.banner();
			logger.warn(__('Incompatible plugin hooks:').yellow.bold);
			cli.hooks.incompatibleFilenames.forEach(function (f) {
				logger.warn(f);
			});
			!data || !data.compact && logger.log();
		}

		if (Object.keys(cli.hooks.errors).length) {
			logger.banner();
			logger.warn(__('Bad plugin hooks that failed to load:').yellow.bold);
			Object.keys(cli.hooks.errors).forEach(function (f) {
				logger.warn(f);
				var ex = cli.hooks.errors[f];
				(ex.stack || ex.toString()).trim().split('\n').forEach(function (s) {
					logger.warn('  ' + s);
				});
			});
			!data || !data.compact && logger.log();
		}

		if (Object.keys(cli.hooks.ids).some(id => cli.hooks.ids[id].length > 1)) {
			logger.banner();
			logger.warn(__('Conflicting plugins that were not loaded:').yellow.bold);
			Object.keys(cli.hooks.ids).forEach(function (id) {
				logger.warn(__('Hook ID: %s', id.cyan));
				cli.hooks.ids[id].forEach(function (c, i) {
					if (i === 0) {
						logger.warn('  ' + __('Loaded: %s', (cli.hooks.ids[id][i].file + ' ' + (cli.hooks.ids[id][i].version ? __('(version %s)', cli.hooks.ids[id][i].version) : '')).cyan));
					} else {
						logger.warn('  ' + __('Didn\'t load: %s', (cli.hooks.ids[id][i].file + ' ' + (cli.hooks.ids[id][i].version ? __('(version %s)', cli.hooks.ids[id][i].version) : '')).cyan));
					}
				});
			});
			!data || !data.compact && logger.log();
		}
	});

	// just before validation begins is the earliest we know whether the banner
	// should be displayed, so we hook into the pre-validate hook
	cli.on('cli:pre-validate', function (data, finished) {
		if (!cli.command.conf.skipBanner) {
			logger.banner();
			if (logger.bannerWasRendered()) {
				// check if the analytics files are writable
				var pp = [ '~/.titanium/analytics.json', '~/.titanium/analytics_session.json' ].filter(function (p) {
					return fs.existsSync(p) && !afs.isFileWritable(p);
				}).shift();
				if (pp) {
					console.warn(__('Required file %s is not writable.', pp).split(pp).map(p => p.magenta).join(pp.cyan));
					console.warn(__('Please ensure the Titanium CLI has access to modify this file.').magenta + '\n');
				}

				// check that the terminal has the correct encoding
				var enc = process.env.LANG;
				if (enc && !config.cli.hideCharEncWarning) {
					enc = enc.split('.');
					if (enc.length > 1 && enc[enc.length - 1].toLowerCase() !== 'utf-8') {
						console.warn(__('Detected terminal character encoding as "%s". Some characters may not render properly.', enc[enc.length - 1]).magenta);
						console.warn(__('It is recommended that you change the character encoding to UTF-8.').magenta + '\n');
					}
				}
			}
		}
		finished();
	});

	// parse the command line args looking for --sdk and do not fire callbacks
	var argv = cli.globalContext.parse(cli.argv.$_),
		sdkName = argv.sdk || config.get('sdk.selected', config.get('app.sdk')),
		sdk = cli.sdk = env.getSDK(sdkName),
		tooOld = sdk && appc.version.lt(sdk.manifest && sdk.manifest.version || sdk.name, '3.0.0');

	// check if --sdk not found, either a bad --sdk, bad config, or first time
	if (!sdk && sdks.length && argv.sdk) {
		logger.banner();
		logger.error(__('Invalid selected Titanium SDK "%s"', sdkName) + '\n');
		appc.string.suggest(sdkName, sdks, logger.log);
		logger.log(__('Available Titanium SDKs:'));
		logger.log(appc.string.renderColumns(sdks, '    ', config.get('cli.width', 100)).cyan + '\n');
		process.exit(1);
	}

	if (sdk && !tooOld) {
		// check if the sdk is compatible with our version of node
		try {
			var supported = appc.version.satisfies(process.version.replace(/^v/, ''), sdk.packageJson.vendorDependencies.node, true);
			if (supported === false) {
				logger.banner();
				logger.error(__('Titanium SDK %s is incompatible with Node.js %s', sdk.name, process.version) + '\n');
				logger.log(__('You will need to install Node.js %s or higher in order to use this version of the Titanium SDK. However, we recommend to install maximum supported version Node.js %s.', 'v' + appc.version.parseMin(sdk.packageJson.vendorDependencies.node),'v' + appc.version.parseMax(sdk.packageJson.vendorDependencies.node)));
				logger.log(__('You can download and install from here - https://nodejs.org/en/download/'));
				logger.log();
				process.exit(1);
			} else if (supported === 'maybe' && !config.get('cli.hideNodejsWarning')) {
				logger.on('cli:logger-banner', function () {
					logger.warn(__('Support for Node.js %s has not been verified for Titanium SDK %s', process.version, sdk.name).yellow);
					logger.warn(__('If you run into issues, try downgrading to Node.js %s', 'v' + appc.version.parseMax(sdk.packageJson.vendorDependencies.node)).yellow + '\n');
				});
			}
		} catch (e) {}

		// scan the sdk commands
		cli.scanCommands(path.join(sdk.path, 'cli', 'commands'));
		Object.keys(sdk.platforms).forEach(function (platform) {
			cli.scanCommands(path.join(sdk.platforms[platform].path, 'cli', 'commands'));
		});

		// scan for hooks in the sdk
		cli.scanHooks(afs.resolvePath(sdk.path, 'cli', 'hooks'));

		// inject the sdk into the argv command line options
		cli.argv.$_.unshift('--sdk', sdk.name);

		// tell the logger the sdk name so it can display it in the banner
		logger.activeSdk = sdk.name;

	} else if (tooOld && !cli.globalContext.commands[argv._[0]]) {
		// if the --sdk is too old and the command we're running is not a built-in command, error
		logger.banner();
		logger.error(__('The selected Titanium SDK "%s" is too old', sdkName) + '\n');
		process.exit(1);
	}

	// run the cli
	cli.go(function () {
		if (config.get('cli.analytics', true) !== false && cli.command && cli.command.conf && !cli.command.conf.skipSendingAnalytics) {
			// send the analytics
			appc.analytics.send({
				appId: pkginfo.about.id,
				appName: pkginfo.about.name,
				appGuid: 'cf5c67ed-1c3b-494b-afe0-01b958ef0f40',
				titaniumHomeDir: path.join('~', '.titanium'),
				version: pkginfo.version,
				deployType: 'production',
				httpProxyServer: config.cli.httpProxyServer,
				rejectUnauthorized: config.get('cli.rejectUnauthorized', true),
				analyticsUrl: config.get('cli.analytics.url'),
				logger: logger,
				debug: config.get('cli.analytics.debug', false)
			});
		}
	});
}
