/**
 * The info command. Displays information about the current system including
 * Xcode installations, iOS SDKs, Android SDKs, and so on.
 *
 * @module commands/info
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
	env = appc.environ,
	fs = require('fs'),
	humanize = require('humanize'),
	mix = appc.util.mix,
	path = require('path'),
	__ = appc.i18n(__dirname).__,

	typesList = ['all', 'os', 'nodejs', 'titanium', 'osx', 'jdk', 'haxm'];

/** Info command name. */
exports.name = 'info';

/** Info command description. */
exports.desc = __('display development environment information');

/**
 * Returns the configuration for the info command.
 * @param {Object} logger - The logger instance
 * @param {Object} config - The CLI config object
 * @param {CLI} cli - The CLI instance
 * @returns {Object} Info command configuration
 */
exports.config = function (logger, config, cli) {
	if (cli.sdk && cli.sdk.platforms) {
		Object.keys(cli.sdk.platforms).sort().forEach(function (platform) {
			var p = platform == 'iphone' ? 'ios' : platform,
				info = path.join(cli.sdk.platforms[platform].path, 'cli', 'lib', 'info.js');
			if (typesList.indexOf(p) == -1 && fs.existsSync(info)) {
				typesList.push(platform);
			}
		});
	}

	if (typesList.indexOf('android') == -1) {
		typesList.push('android');
	}
	if (typesList.indexOf('ios') == -1) {
		typesList.push('ios');
	}

	return {
		noAuth: true,
		skipBanner: true,
		skipSendingAnalytics: true,
		options: {
			output: {
				abbr: 'o',
				default: 'report',
				desc: __('output format'),
				values: ['report', 'json']
			},
			types: {
				abbr: 't',
				default: 'all',
				desc: __('information types to display; you may select one or more'),
				skipValueCheck: true, // we want to allow comma-separated values (i.e. "os,nodejs")
				values: typesList
			}
		}
	};
};

/**
 * Displays information about the current system.
 * @param {Object} logger - The logger instance
 * @param {Object} config - The CLI config object
 * @param {CLI} cli - The CLI instance
 * @param {Function} finished - Callback when the command finishes
 */
exports.run = function (logger, config, cli, finished) {
	var busy,
		indent = 27;

	if (cli.argv.output != 'json') {
		logger.banner();
		if (!cli.argv.quiet && !!cli.argv['progress-bars']) {
			busy = new appc.busyindicator;
			busy.start();
		}
	}

	// determine the types to display
	var types = {},
		i = 0;
	(cli.argv.types || 'all').toLowerCase().split(',').forEach(function (t) {
		t = t.trim();
		if (typesList.indexOf(t) >= 0) {
			types[t] = ++i;
		}
	});
	i == 0 && (types.all = 1);

	// the section object
	function Section(opts) {
		this.name = opts.name;
		this.title = opts.title;
		this.data = null;
		this.issues = [];
		this.detect = opts.detect && opts.detect.bind(this);
		this.render = opts.render && opts.render.bind(this);
	}

	// construct all of the built-in sections
	var sections = [],
		osInfo;

	// os info
	sections.push(new Section({
		name: 'os',
		title: __('Operating System'),
		render: function (logger, config, rpad, styleHeading, styleValue, styleBad) {
			if ((types.all || types[this.name]) && osInfo && osInfo.os) {
				logger.log(
					styleHeading(this.title) + '\n' +
					'  ' + rpad(__('Name'))         + ' = ' + styleValue(osInfo.os.name) + '\n' +
					'  ' + rpad(__('Version'))      + ' = ' + styleValue(osInfo.os.version) + '\n' +
					'  ' + rpad(__('Architecture')) + ' = ' + styleValue(osInfo.os.architecture) + '\n' +
					'  ' + rpad(__('# CPUs'))       + ' = ' + styleValue(osInfo.os.numcpus) + '\n' +
					'  ' + rpad(__('Memory'))       + ' = ' + styleValue((osInfo.os.memory / 1024 / 1024 / 1024).toFixed(1) + 'GB') + '\n'
				);
			}
		}
	}));

	// nodejs info
	sections.push(new Section({
		name: 'nodejs',
		title: __('Node.js'),
		render: function (logger, config, rpad, styleHeading, styleValue, styleBad) {
			if ((types.all || types[this.name]) && osInfo && osInfo.node && osInfo.npm) {
				logger.log(
					styleHeading(this.title) + '\n' +
					'  ' + rpad(__('Node.js Version')) + ' = ' + styleValue(osInfo.node.version) + '\n' +
					'  ' + rpad(__('npm Version'))     + ' = ' + styleValue(osInfo.npm.version) + '\n'
				);
			}
		}
	}));

	// titanium info
	sections.push(new Section({
		name: 'titanium',
		title: __('Titanium CLI'),
		detect: function (types, config, next) {
			if (types.all || types[this.name]) {
				var result = {
					titanium: {},
					titaniumCLI: {
						version: cli.version,
						nodeAppcVer: null,
						selectedSDK: cli.sdk && cli.sdk.name
					}
				};

				// get the node-appc info
				try {
					result.titaniumCLI.nodeAppcVer = require('node-appc/package.json').version;
				} catch (e) {}

				Object.keys(env.sdks).forEach(function (name) {
					var n = env.sdks[name],
						ver = n.manifest && n.manifest.version || name,
						v = result.titanium[name] = {
							version: ver,
							path: n.path,
							platforms: Object.keys(n.platforms),
							githash: n.manifest ? n.manifest.githash : null,
							timestamp: n.manifest ? n.manifest.timestamp : null,
							nodeAppcVer: null
						};
					try {
						v.nodeAppcVer = require(path.join(v.path, 'node_modules', 'node-appc', 'package.json')).version;
					} catch (e) {}
				});

				next(null, this.data = result);
			} else {
				next();
			}
		},
		render: function (logger, config, rpad, styleHeading, styleValue, styleBad) {
			if (this.data) {
				logger.log(
					styleHeading(this.title) + '\n' +
					'  ' + rpad(__('CLI Version'))       + ' = ' + styleValue(this.data.titaniumCLI.version) + '\n' +
					'  ' + rpad(__('node-appc Version')) + ' = ' + styleValue(this.data.titaniumCLI.nodeAppcVer || 'unknown') + '\n'
				);

				logger.log(styleHeading(__('Titanium SDKs')));
				if (Object.keys(this.data.titanium).length) {
					Object.keys(this.data.titanium).sort().reverse().forEach(function (name) {
						var x = this.data.titanium[name];
						logger.log(
							'  ' + name.cyan + '\n' +
							'  ' + rpad('  ' + __('Version'))           + ' = ' + styleValue(x.version) + '\n' +
							'  ' + rpad('  ' + __('Install Location'))  + ' = ' + styleValue(x.path) + '\n' +
							'  ' + rpad('  ' + __('Platforms'))         + ' = ' + styleValue(x.platforms.join(', ')) + '\n' +
							'  ' + rpad('  ' + __('git Hash'))          + ' = ' + styleValue(x.githash || 'unknown') + '\n' +
							'  ' + rpad('  ' + __('git Timestamp'))     + ' = ' + styleValue(x.timestamp || 'unknown') + '\n' +
							'  ' + rpad('  ' + __('node-appc Version')) + ' = ' + styleValue(appc.version.lt(x.version, '3.0.0') ? 'n/a' : x.nodeAppcVer || 'unknown')
						);
					}, this);
					logger.log();
				} else {
					logger.log('  ' + __('None').grey + '\n');
				}
			}
		}
	}));

	// mac os x info
	sections.push(new Section({
		name: 'osx',
		title: __('Mac OS X'),
		detect: function (types, config, next) {
			if (process.platform == 'darwin' && (types.all || types[this.name])) {
				appc.clitools.detect(config, function (clitools) {
					if (clitools.issues.length) {
						this.issues = this.issues.concat(clitools.issues);
					}
					next(null, this.data = {
						osx: {
							title: __(''),
							clitools: clitools
						}
					});
				}.bind(this));
			} else {
				next();
			}
		},
		render: function (logger, config, rpad, styleHeading, styleValue, styleBad) {
			if (this.data) {
				logger.log(styleHeading(this.title));
				logger.log('  ' + rpad(__('Command Line Tools')) + ' = ' + styleValue(this.data.osx.clitools && this.data.osx.clitools.installed ? __('installed') : __('not found')) + '\n');
			}
		}
	}));

	// haxm info
	sections.push(new Section({
		name: 'haxm',
		title: __('Intel® Hardware Accelerated Execution Manager (HAXM)'),
		detect: function (types, config, next) {
			if (types.all || types[this.name]) {
				appc.haxm.detect(config, function (data) {
					next(null, this.data = {
						haxm: data
					});
				}.bind(this));
			} else {
				next();
			}
		},
		render: function (logger, config, rpad, styleHeading, styleValue, styleBad) {
			if (this.data) {
				logger.log(styleHeading(this.title));
				if (!this.data.haxm.compatible) {
					logger.log('  ' + __('Not compatible; Intel® CPU required').grey + '\n');
				} else if (this.data.haxm.installed) {
					logger.log(
						'  ' + rpad(__('Installed'))    + ' = ' + styleValue('yes') + '\n' +
						'  ' + rpad(__('Memory Limit')) + ' = ' + styleValue(humanize.filesize((this.data.haxm.memlimit | 0) * 1024 * 1024, 1024, 0).toUpperCase()) + '\n'
					);
				} else {
					logger.log('  ' + __('Not installed').grey + '\n');
				}
			}
		}
	}));

	// jdk info
	sections.push(new Section({
		name: 'jdk',
		title: __('Java Development Kit'),
		detect: function (types, config, next) {
			if (types.all || types[this.name]) {
				appc.jdk.detect(config, function (data) {
					if (data.issues.length) {
						this.issues = this.issues.concat(data.issues);
					}
					next(null, this.data = {
						jdk: data
					});
				}.bind(this));
			} else {
				next();
			}
		},
		render: function (logger, config, rpad, styleHeading, styleValue, styleBad) {
			if (this.data) {
				logger.log(styleHeading(this.title));
				if (this.data.jdk.version) {
					logger.log('  ' + rpad(__('Version')) + ' = ' + styleValue(this.data.jdk.version + '_' + this.data.jdk.build));
					logger.log('  ' + rpad(__('Java Home')) + ' = ' + styleValue(this.data.jdk.home) + '\n');
				} else {
					logger.log('  ' + __('Not found').grey + '\n');
				}
			}
		}
	}));

	// general sdk-level info (Windows, Visual Studio, Genymotion, etc)
	if (cli.sdk) {
		var sdkInfoFile = path.join(cli.sdk.path, 'cli', 'lib', 'info.js');

		if ((types.all || types.mobileweb) && fs.existsSync(sdkInfoFile)) {
			sections.push(new Section(require(sdkInfoFile)));

		} else if (config.get('genymotion.enabled')) {
			// legacy genymotion info which was moved in Titanium SDK 3.5.0 into the info.js
			// file being included above
			var genymotionFile = path.join(cli.sdk.path, 'cli', 'lib', 'genymotion.js');
			if ((types.all || types.genymotion) && fs.existsSync(genymotionFile)) {
				sections.push(new Section(require(genymotionFile)));
			}
		}
	}

	// for each platform, go get its info
	if (cli.sdk && cli.sdk.platforms) {
		Object.keys(cli.sdk.platforms).sort().forEach(function (platform) {
			var p = platform == 'iphone' ? 'ios' : platform,
				info = path.join(cli.sdk.platforms[platform].path, 'cli', 'lib', 'info.js');
			if ((types.all || types[p]) && fs.existsSync(info)) {
				sections.push(new Section(require(info)));
			}
		});
	}

	// if we're displaying android info, but the android platform doesn't have an info.js, then use node-appc's legacy android detection
	if ((types.all || types.android) && !sections.some(function (s) { return s.name == 'android'; })) {
		sections.push(new Section({
			name: 'android',
			title: 'Android',
			detect: function (types, config, next) {
				appc.android.detect(function (result) {
					result || (result = {});
					result.androidDetectVersion || (result.androidDetectVersion = '1.0');
					next(null, this.data = { android: result });
				}.bind(this), config.android && config.android.sdkPath, config.android && config.android.ndkPath);
			},
			render: function (logger, config, rpad, styleHeading, styleValue, styleBad) {
				if (this.data) {
					var data = this.data;

					// legacy warning
					logger.log(
						appc.string.wrap(
							__('NOTE: The following Android information has been determined using deprecated detection logic. To display more accurate information, install and select a Titanium SDK 3.2 or newer.'),
							config.get('cli.width', 100)
						).yellow + '\n'
					);

					logger.log(styleHeading(__('Android SDK')) + '\n' +
						'  ' + rpad(__('Android Executable')) + ' = ' + styleValue(data.android.exe || __('not found')) + '\n' +
						'  ' + rpad(__('SDK Path'))           + ' = ' + styleValue(data.android.sdkPath || __('not found')) + '\n'
					);

					logger.log(styleHeading(__('Android NDK')) + '\n' +
						'  ' + rpad(__('NDK Path'))           + ' = ' + styleValue(data.android.ndk && data.android.ndk.path || __('not found')) + '\n' +
						'  ' + rpad(__('NDK Version'))        + ' = ' + styleValue(data.android.ndk && data.android.ndk.version || __('not found')) + '\n'
					);

					var androidPlatforms = '',
						androidAddons = '';

					(function (targets) {
						if (targets && Object.keys(targets).length) {
							Object.keys(targets).forEach(function (targetId) {
								var target = targets[targetId];
								if (target.type == 'Platform') {
									androidPlatforms += (targetId + ') ' + target.id).grey + '\n' +
										'  ' + rpad(__('Name'))        + ' = ' + styleValue(target.name) + '\n' +
										'  ' + rpad(__('API Level'))   + ' = ' + styleValue(target['api-level']) + '\n' +
										'  ' + rpad(__('Revision'))    + ' = ' + styleValue(target.revision) + '\n' +
										'  ' + rpad(__('Skins'))       + ' = ' + styleValue(target.skins.join(', ')) + '\n' +
										'  ' + rpad(__('ABIs'))        + ' = ' + styleValue(target.abis && target.abis.join(', ') || target['tag/abis'] || __('none')) + '\n' +
										'  ' + rpad(__('Path'))        + ' = ' + styleValue(target.path) + '\n';
								} else if (target.type == 'Add-On') {
									androidAddons += (targetId + ') ' + target.id).grey + '\n' +
										'  ' + rpad(__('Name'))        + ' = ' + styleValue(target.name) + '\n' +
										'  ' + rpad(__('Vendor'))      + ' = ' + styleValue(target.vendor) + '\n' +
										'  ' + rpad(__('Revision'))    + ' = ' + styleValue(target.revision) + '\n' +
										'  ' + rpad(__('Description')) + ' = ' + styleValue(target.description) + '\n' +
										'  ' + rpad(__('Skins'))       + ' = ' + styleValue(target.skins.join(', ')) + '\n' +
										'  ' + rpad(__('ABIs'))        + ' = ' + styleValue(target.abis && target.abis.join(', ') || target['tag/abis'] || __('none')) + '\n' +
										'  ' + rpad(__('Path'))        + ' = ' + styleValue(target.path) + '\n' +
										'  ' + rpad(__('Based On'))    + ' = ' + styleValue(target['based-on'] ? __('Android %s (API level %s)', target['based-on']['android-version'], target['based-on']['api-level']) : __('unknown')) + '\n' +
										'  ' + rpad(__('Libraries'))   + ' = ' + styleValue(target.libraries && Object.keys(target.libraries).length
											? Object.keys(target.libraries).map(function (lib) {
													return lib + ': ' + target.libraries[lib].description + ' (' + target.libraries[lib].jar + ')';
												}).join(', ')
											: 'none') + '\n';
								}
							});
						}
					}(data.android.targets));

					logger.log(styleHeading(__('Android Platforms')) + '\n' + (androidPlatforms ? androidPlatforms : '  ' + __('None').grey + '\n'));
					logger.log(styleHeading(__('Android Add-Ons')) + '\n' + (androidAddons ? androidAddons : '  ' + __('None').grey + '\n'));

					logger.log(styleHeading(__('Android AVDs')));
					(function (avds) {
						if (avds && avds.length) {
							logger.log(avds.map(function (avd) {
								return avd.name.grey + '\n' +
									'  ' + rpad(__('Path'))     + ' = ' + styleValue(avd.path) + '\n' +
									'  ' + rpad(__('Target'))   + ' = ' + styleValue(avd.target) + '\n' +
									'  ' + rpad(__('ABI'))      + ' = ' + styleValue(avd.abi) + '\n' +
									'  ' + rpad(__('Skin'))     + ' = ' + styleValue(avd.skin) + '\n' +
									'  ' + rpad(__('SD Card'))  + ' = ' + styleValue(avd.sdcard || __('no sd card')) + '\n' +
									'  ' + rpad(__('Based On')) + ' = ' + styleValue(avd['based-on'] ? __('Android %s (API level %s)', avd['based-on']['android-version'], avd['based-on']['api-level']) : __('unknown'));
								}).join('\n') + '\n');
						} else {
							logger.log('  ' + __('None').grey + '\n');
						}
					}(data.android.avds));
				}
			}
		}));
	}

	// if we're displaying ios info, but the ios platform doesn't have an info.js, then use node-appc's legacy ios detection
	if (process.platform == 'darwin' && (types.all || types.ios) && !sections.some(function (s) { return s.name == 'ios'; })) {
		sections.push(new Section({
			name: 'ios',
			title: 'iOS',
			detect: function (types, config, next) {
				appc.ios.detect(function (info) {
					var result = { xcode: {}, iosDetectVersion: '1.0' };

					if (Object.keys(info.xcode).length) {
						Object.keys(info.xcode).forEach(function (ver) {
							if (ver != '__selected__') {
								mix(result.xcode[ver] = {}, info.xcode[ver]);
							}
						});
					}

					result.iosCerts = {
						devNames: info.certs.devNames,
						distNames: info.certs.distNames,
						wwdr: info.certs.wwdr
					};

					result.keychains = info.certs.keychains;

					var pp = result.iOSProvisioningProfiles = {};
					Object.keys(info.provisioningProfiles).forEach(function (type) {
						pp[type] || (pp[type] = []);
						info.provisioningProfiles[type].forEach(function (profile) {
							pp[type].push(mix({}, profile));
						});
					});

					result.iosKeychains = ['System Default'].concat(info.keychains);

					next(null, this.data = result);
				}.bind(this), config.android && config.android.sdkPath, config.android && config.android.ndkPath);
			},
			render: function (logger, config, rpad, styleHeading, styleValue, styleBad) {
				if (this.data) {
					var data = this.data;

					logger.log(
						appc.string.wrap(
							__('NOTE: The following Xcode and iOS information has been determined using deprecated detection logic. To display more accurate information, install and select a Titanium SDK 3.2 or newer.'),
							config.get('cli.width', 100)
						).yellow + '\n'
					);

					// Xcode
					logger.log(styleHeading(__('Xcode')));
					if (Object.keys(data.xcode).length) {
						Object.keys(data.xcode).sort().reverse().forEach(function (ver) {
							var x = data.xcode[ver];
							logger.log(
								(x.version + ' (build ' + x.build + ')' + (x.selected ? ' - Xcode default' : '')).cyan + '\n' +
								'  ' + rpad(__('Install Location'))                  + ' = ' + styleValue(x.path) + '\n' +
								'  ' + rpad(__('iOS SDKs'))                          + ' = ' + styleValue(x.sdks.length ? x.sdks.join(', ') : 'none') + '\n' +
								'  ' + rpad(__('iOS Simulators'))                    + ' = ' + styleValue(x.sims.length ? x.sims.join(', ') : 'none')
							);
							data.tisdk && logger.log('  ' + rpad(__('Supported by TiSDK %s', data.tisdk)) + ' = ' + styleValue(x.supported == 'maybe' ? 'maybe' : x.supported ? 'yes' : 'no'));
						});
						logger.log();
					} else {
						logger.log('  ' + __('None').grey + '\n');
					}

					// ios keychains
					logger.log(
						styleHeading(__('iOS Keychains')) + '\n' +
						data.iosKeychains.sort().reverse().map(function (keychain) {
							return '  ' + rpad(path.basename(keychain)) + ' = ' + styleValue(keychain);
						}).join('\n') + '\n');

					// ios certs
					logger.log(styleHeading(__('iOS Certificates')));
					if (Object.keys(data.keychains).length) {
						Object.keys(data.keychains).forEach(function (keychain) {
							if (data.keychains[keychain].developer) {
								logger.log(__('Developer').grey);
								data.keychains[keychain].developer.forEach(function (d) {
									logger.log('  ' + styleValue(d));
								});
							}
							if (data.keychains[keychain].distribution) {
								logger.log(__('Distribution').grey);
								data.keychains[keychain].distribution.forEach(function (d) {
									logger.log('  ' + styleValue(d));
								});
							}
							logger.log();
						});
					} else {
						logger.log('  ' + __('None').grey + '\n');
					}

					// wwdr cert
					logger.log(styleHeading(__('Apple WWDR Certificate')) + '\n' +
						'  ' + rpad(__('Apple WWDR')) + ' = ' + styleValue(data.iosCerts.wwdr ? __('installed') : __('not found')) + '\n');

					function printProfiles(profiles) {
						if (profiles.length) {
							profiles.sort(function (a, b) {
								return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
							}).forEach(function (profile) {
								logger.log(
									profile.name.grey + (profile.expired ? ' ' + styleBad(__('**EXPIRED**')) : '') + '\n' +
									'  ' + rpad(__('UUID'))       + ' = ' + styleValue(profile.uuid) + '\n' +
									'  ' + rpad(__('App Prefix')) + ' = ' + styleValue(profile.appPrefix) + '\n' +
									'  ' + rpad(__('App Id'))     + ' = ' + styleValue(profile.appId)
								);
							});
							logger.log();
						} else {
							logger.log('  ' + __('None').grey + '\n');
						}
					}

					// provisioning profiles
					logger.log(styleHeading(__('Development iOS Provisioning Profiles')));
					printProfiles(data.iOSProvisioningProfiles.development);

					logger.log(styleHeading(__('Distribution iOS Provisioning Profiles')));
					printProfiles(data.iOSProvisioningProfiles.distribution);

					logger.log(styleHeading(__('Ad Hoc iOS Provisioning Profiles')));
					printProfiles(data.iOSProvisioningProfiles.adhoc);
				}
			}
		}));
	}

	// copy all sections into tasks
	var detectTasks = [
		function (next) {
			if (types.all || types.os || types.nodejs || types.npm) {
				env.getOSInfo(function (data) {
					osInfo = {};
					if (types.all || types.os) {
						osInfo.os = {
							name: data.os,
							version: data.osver,
							architecture: data.ostype,
							numcpus: data.oscpu,
							memory: data.memory
						};
					}
					if (types.all || types.nodejs) {
						osInfo.node = {
							version: data.node.replace(/^v/, '')
						};
						osInfo.npm = {
							version: data.npm
						};
					}
					next(null, osInfo);
				});
			} else {
				next();
			}
		}
	];

	sections.forEach(function (section) {
		if (section && section.detect) {
			detectTasks.push(function (next) {
				section.detect(types, config, next);
			});
		}
	});

	async.parallel(detectTasks, function (err, results) {
		var data = mix.apply(null, results);

		if (cli.argv.output == 'json') {
			logger.log(JSON.stringify(data, null, '\t'));
		} else {
			busy && busy.stop();

			if (process.platform == 'darwin' && (types.all || types.ios) && (!data.ios || appc.version.lt(data.ios.detectVersion || data.iosDetectVersion, '2.0'))) {
				// the keychain names are the only left side label that isn't fixed length, so
				// if we're displaying ios info, find the longest keychain name
				data.iosKeychains.forEach(function (keychain) {
					var len = path.basename(keychain).length + 2;
					if (len > indent) {
						indent = len;
					}
				});
			}

			function styleHeading(s) {
				return ('' + s).bold;
			}

			var issues = {};

			// render each section
			sections.forEach(function (section) {
				if (section) {
					if (section.issues.length) {
						issues[section.name] = section.issues;
					}

					section.render(
						logger,
						config,
						function rpad(s) { return appc.string.rpad(s, indent); },
						styleHeading,
						function styleValue(s) { return ('' + s).magenta; },
						function styleBad(s) { return ('' + s).red; }
					);
				}
			});

			// render issues
			if (Object.keys(issues).length) {
				Object.keys(issues).forEach(function (type) {
					if (types.all || types[type]) {
						logger.log(styleHeading(__('%s Issues', sections.filter(function (s) { return s.name == type; }).shift().title)));
						issues[type].forEach(function (issue) {
							var msg = issue.message.split('\n\n').map(function (chunk) {
								return appc.string.wrap(chunk.split('\n').map(function (line) {
									return line.replace(/(__(.+?)__)/g, '$2'.bold);
								}).join('\n'), config.get('cli.width', 120) - 5).replace(/\n/g, '\n     ') + '\n';
							}).join('\n     ');

							if (issue.type == 'error') {
								logger.log(('  ' + (process.platform == 'win32' ? '\u00D7' : '\u2715') + '  ' + msg).red);
							} else if (issue.type == 'warning') {
								logger.log('  !  '.yellow.bold + msg.yellow);
							} else {
								logger.log(('  ' + (process.platform == 'win32' ? '*' : '\u25CF') + '  ' + msg).magenta);
							}
						});
					}
				});
			} else {
				logger.log(__('Issues').bold);
				logger.log('  ' + __('No issues detected! Your development environment should be working perfectly!') + '\n');
			}
		}

		finished();
	});
};
