/**
 * Main entry point for the Titanium CLI. Responsible for loading the CLI
 * configuration, initializing the i18n system, wiring up analytics, defining
 * global options and flags, and running the main CLI logic.
 *
 * @module titanium
 *
 * @copyright
 * Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 *
 * @license
 * Licensed under the terms of the Apache Public License
 * Please see the LICENSE included with this distribution for details.
 *
 * @requires colors
 * @requires node-appc
 * @requires semver
 */

var fs = require('fs'),
	path = require('path'),
	colors = require('colors'),
	semver = require('semver'),
	pkgJson = require('../package.json');

// set path.existsSync to make old modules designed for <=0.6 happy
path.existsSync = fs.existsSync || path.existsSync;

// check that we're using Node.js 0.8 or newer
try {
	if (semver.lt(process.version, '0.8.0')) {
		console.error(pkgJson.about.name.cyan.bold + ', CLI version ' + pkgJson.version + '\n' + pkgJson.about.copyright + '\n\n' +
			'ERROR: Titanium requires Node.js 0.8 or newer.'.red + '\n\n' +
			'Visit ' + 'http://nodejs.org/'.cyan + ' to download a newer version.\n');
		process.exit(1);
	}
} catch (e) {}

// check that node-appc is up-to-date
try {
	var nodeAppcPkgJson = require('node-appc/package.json');
	if (!semver.satisfies(nodeAppcPkgJson.version, pkgJson.dependencies['node-appc'])) {
		console.error(pkgJson.about.name.cyan.bold + ', CLI version ' + pkgJson.version + '\n' + pkgJson.about.copyright + '\n\n' +
			('ERROR: node-appc version ' + nodeAppcPkgJson.version + ' too old; version ' + pkgJson.dependencies['node-appc'] + ' required').red + '\n\n' +
			'Run ' + ('cd ' + path.dirname(__dirname) + ' && npm update').cyan + ' to update to the latest version.\n');
		process.exit(1);
	}
} catch (e) {
	console.log(e);
}

require('longjohn');

// read the locale and bootstrap the CLI as necessary
(function() {
	var configFilePath = path.join(process.env[process.platform == 'win32' ? 'USERPROFILE' : 'HOME'], '.titanium', 'config.json');

	function detectLocale(callback) {
		var exec = require('child_process').exec;
		if (process.platform == 'win32') {
			exec('reg query "HKCU\\Control Panel\\International" /v Locale', function(err, stdout, stderr) {
				if (err) return callback();
				var m = stdout.match(/Locale\s+REG_SZ\s+(.+)/);
				if (m) {
					m = m[1].substring(m[1].length - 4, m[1].length);
					exec('reg query "HKLM\\SOFTWARE\\Classes\\MIME\\Database\\Rfc1766" /v ' + m, function(err, stdout, stderr) {
						if (!err) {
							var m = stdout.match(/REG_SZ\s+([^;,\n]+?);/);
							if (m) return callback(m[1]);
						}
						callback();
					});
					return;
				}
			});
		} else {
			exec('locale', function (err, stdout, stderr) {
				callback(stdout.split('\n').shift().replace(/(LANG=["']?([^\."']+).*)/m, '$2'));
			});
		}
	}

	if (fs.existsSync(configFilePath)) {
		try {
			var config = JSON.parse(fs.readFileSync(configFilePath));
			if (config && config.user && config.user.locale) {
				run(config.user.locale);
				return;
			}
		} catch(e) {}
	}
	detectLocale(run);
}());

function getArg(name) {
	var p = process.argv.indexOf(name);
	if (p != -1 && p + 1 < process.argv.length) {
		return process.argv[p + 1];
	}
	return null;
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
		console.error(('FATAL ERROR: ' + ex.toString().trim()).red + '\n');
		process.exit(1);
	}

	// if there's a --config, mix it into our config
	try {
		var json = eval('(' + getArg('--config') + ')');
		if (json && typeof json == 'object') {
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

	// when the app exits, submit analytics
	process.setMaxListeners(666);
	process.on('exit', function () {
		// sadly, this will never be called on Windows if the user presses ctrl+c
		appc.analytics.send(appc.util.mix({
			appId: pkginfo.about.id,
			appName: pkginfo.about.name,
			appGuid: 'cf5c67ed-1c3b-494b-afe0-01b958ef0f40',
			titaniumHomeDir: path.join('~', '.titanium'),
			version: pkginfo.version,
			deployType: 'production',
			httpProxyServer: config.cli.httpProxyServer,
			analyticsUrl: config.get('cli.analytics.url'),
			showErrors: config.get('cli.analytics.showErrors', false)
		}, appc.auth.status()));
	});

	// make sure our sdk paths are good to go
	Array.isArray(sdkPaths) || (sdkPaths = []);
	if (defaultInstallLocation && !sdkPaths.some(function (p) {
			return afs.resolvePath(p) == defaultInstallLocation;
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
	var cli = new (require('./cli'))({
		config: config,
		env: env,
		logger: logger,
		version: pkginfo.version
	});

	// define the global flags
	cli.configure({
		'flags': {
			'help': {
				abbr: 'h',
				callback: function (value) {
					if (value) {
						cli.argv.$command = 'help';
					}
				},
				desc: __('displays help')
			},
			'version': {
				abbr: 'v',
				callback: function (value) {
					if (value) {
						console.log(pkginfo.version);
						process.exit(0);
					}
				},
				desc: __('displays the current version')
			},
			'colors': {
				callback: function (value) {
					var c = value !== false;
					colors.mode = c ? 'console' : 'none';
					Object.keys(logger.transports).forEach(function (name) {
						logger.transports[name].colorize = c;
					});
				},
				default: config.get('cli.colors', true),
				desc: __('disable colors'),
				negate: true
			},
			'quiet': {
				abbr: 'q',
				callback: function (value) {
					logger.silence(config.cli.quiet = !!value);
				},
				default: config.get('cli.quiet', false),
				desc: __('suppress all output')
			},
			'prompt': {
				callback: function (value) {
					config.cli.prompt = !!value;
				},
				default: config.get('cli.prompt', true),
				desc: __('disable interactive prompting'),
				negate: true
			},
			'progress-bars': {
				callback: function (value) {
					config.cli.progressBars = !!value;
				},
				default: config.get('cli.progressBars', true),
				desc: __('disable progress bars'),
				negate: true
			},
			'banner': {
				callback: function (value) {
					logger.bannerEnabled(!!value);
				},
				default: true,
				desc: __('disable Titanium version banner'),
				negate: true
			}
		},
		'options': {
			'config': {
				desc: __('serialized JSON string to mix into CLI config'),
				hint: 'json'
			},
			'config-file': {
				default: config.getConfigPath(),
				desc: __('path to CLI config file'),
				hint: __('file')
			},
			'sdk': {
				abbr: 's',
				default: 'latest',
				desc: __('Titanium SDK version to use to bootstrap SDK-level commands and parse the tiapp.xml; actual Titanium SDK used determined by %s in the tiapp.xml', '<sdk-version>'.cyan),
				hint: __('version')
			}
		}
	});

	// just before validation begins is the earliest we know whether the banner
	// should be displayed, so we hook into the pre-validate hook
	cli.on('cli:pre-validate', function (data, finished) {
		if (!cli.command.conf.skipBanner) {
			logger.banner();
			if (logger.bannerWasRendered()) {
				// check if the analytics files are writable
				var pp = ['~/.titanium/analytics.json', '~/.titanium/analytics_session.json'].filter(function (p) {
					return fs.existsSync(p) && !afs.isFileWritable(p);
				}).shift();
				if (pp) {
					console.warn(__('Required file %s is not writable.', pp).split(pp).map(function (p) { return p.magenta; }).join(pp.cyan));
					console.warn(__('Please ensure the Titanium CLI has access to modify this file.').magenta + '\n');
				}

				// check that the terminal has the correct encoding
				var enc = process.env.LANG;
				if (enc && !config.cli.hideCharEncWarning) {
					enc = enc.split('.');
					if (enc.length > 1 && enc[enc.length-1].toLowerCase() != 'utf-8') {
						console.warn(__('Detected terminal character encoding as "%s". Some characters may not render properly.', enc[enc.length-1]).magenta);
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
		// get a list of all valid sdks 3.0 and newer
		sdks = Object.keys(env.sdks).filter(function (v) {
			try {
				return appc.version.gte(v, '3.0.0');
			} catch (e) {
				return false;
			}
		});

	// if we don't have an sdk, let them through if it's a built-in command
	if (!sdk && (!argv._.length || cli.globalContext.commands[argv._[0]])) {
		// run the cli
		cli.go();

	} else {
		// check that we have an sdk
		if (!sdk) {
			logger.banner();
			if (sdks.length) {
				logger.error(__('Invalid Titanium SDK "%s"', sdkName) + '\n');
				appc.string.suggest(sdkName, sdks, logger.log);
				logger.log(__('Available Titanium SDKs:'));
				logger.log(appc.string.renderColumns(sdks, '    ', config.get('cli.width', 100)).cyan + '\n');
			} else {
				// you need to install an sdk!
				logger.log(__('No Titanium SDKs found!') + '\n');
				logger.log(__("You can download the latest Titanium SDK by running '%s'", (cli.argv.$ + ' sdk install --default').cyan) + '\n');
			}
			process.exit(1);
		}

		// scan the sdk commands
		cli.scanCommands(path.join(sdk.path, 'cli', 'commands'));
		Object.keys(sdk.platforms).forEach(function (platform) {
			cli.scanCommands(path.join(sdk.platforms[platform].path, 'cli', 'commands'));
		});

		// check that the sdk isn't too old
		if (appc.version.lt(sdk.manifest && sdk.manifest.version || sdk.name, '3.0.0')) {
			logger.banner();
			if (sdkName) {
				logger.error(__('Specified Titanium SDK "%s" is too old', sdkName) + '\n');
			} else {
				logger.error(__('The most recent installed Titanium SDK "%s" is too old', sdk.name) + '\n');
			}
			logger.log(__("You can download the latest Titanium SDK by running '%s'", (cli.argv.$ + ' sdk install --default').cyan) + '\n');
			process.exit(1);
		}

		// scan for hooks in the sdk
		cli.scanHooks(afs.resolvePath(sdk.path, 'cli', 'hooks'));

		// inject the sdk into the argv command line options
		cli.argv.$_.unshift('--sdk', sdk.name);

		// tell the logger the sdk name so it can display it in the banner
		logger.activeSdk = sdk.name;

		// run the cli
		cli.go();
	}
}