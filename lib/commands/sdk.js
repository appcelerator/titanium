/**
 * Displays installed Titanium SDKs and installs new SDKs.
 *
 * @module commands/sdk
 *
 * @see SdkSubcommands
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

var async = require('async'),
	fs = require('fs'),
	http = require('http'),
	request = require('request'),
	temp = require('temp'),
	wrench = require('wrench'),
	humanize = require('humanize'),
	moment = require('moment'),
	path = require('path'),
	fields = require('fields'),
	appc = require('node-appc'),
	afs = appc.fs,
	__ = appc.i18n(__dirname).__,
	urls = {
		branches: 'http://builds.appcelerator.com.s3.amazonaws.com/mobile/branches.json',
		branch: 'http://builds.appcelerator.com.s3.amazonaws.com/mobile/$BRANCH/index.json',
		build: 'http://builds.appcelerator.com.s3.amazonaws.com/mobile/$BRANCH/$FILENAME',
		releases: 'http://api.appcelerator.com/p/v1/release-list'
	};

/** SDK command title. */
exports.title = __('SDK');

/** SDK command name. */
exports.name = 'sdk';

/** SDK command description. */
exports.desc = __('manages installed Titanium SDKs');

/** @namespace SdkSubcommands */
var SdkSubcommands = {};

/**
 * Returns the configuration for the SDK command.
 * @param {Object} logger - The logger instance
 * @param {Object} config - The CLI config object
 * @param {CLI} cli - The CLI instance
 * @returns {Object} SDK command configuration
 */
exports.config = function (logger, config, cli) {
	var subcommands = {};
	Object.keys(SdkSubcommands).forEach(function (s) {
		subcommands[s] = SdkSubcommands[s].conf(logger, config, cli);
	});
	return {
		skipBanner: true,
		defaultSubcommand: 'list',
		noAuth: true,
		skipSendingAnalytics: true,
		subcommands: subcommands
	};
};

/**
 * Displays all installed Titanium SDKs or installs a new SDK.
 * @param {Object} logger - The logger instance
 * @param {Object} config - The CLI config object
 * @param {CLI} cli - The CLI instance
 * @param {Function} finished - Callback when the command finishes
 */
exports.run = function (logger, config, cli, finished) {
	var action = cli.argv._.shift();
	action || (action = 'list');
	action != 'list' && logger.banner();

	if (SdkSubcommands[action]) {
		SdkSubcommands[action].fn.apply(SdkSubcommands[action].fn, arguments);
	} else {
		logger.error(__('Invalid subcommand "%s"', action) + '\n');
		appc.string.suggest(action, Object.keys(SdkSubcommands), logger.log);
		logger.log(__('Available subcommands:'));
		Object.keys(SdkSubcommands).forEach(function (a) {
			logger.log('    ' + a.cyan);
		});
		logger.log();
		finished();
	}
};

/**
 * Displays a list of all installed Titanium SDKs.
 * @memberof SdkSubcommands
 * @param {Object} logger - The logger instance
 * @param {Object} config - The CLI config object
 * @param {CLI} cli - The CLI instance
 * @param {Function} finished - Callback when the command finishes
 */
SdkSubcommands.list = {
	conf: function (logger, config, cli) {
		return {
			desc: __('print a list of installed SDK versions'),
			noAuth: true,
			flags: {
				branches: {
					abbr: 'b',
					desc: __('retreive and print all branches')
				},
				releases: {
					abbr: 'r',
					desc: __('retreive and print all releases')
				}
			},
			options: {
				branch: {
					desc: __('branch to fetch CI builds')
				},
				output: {
					abbr: 'o',
					default: 'report',
					desc: __('output format'),
					values: ['report', 'json']
				}
			}
		};
	},
	fn: function list(logger, config, cli, finished) {
		var tasks = {},
			osName = cli.env.os.name;

		cli.argv.releases && (tasks.releases = function (next) {
			getReleases(config, cli.env.os.name, function (err, data) {
				next(err, data);
			});
		});

		cli.argv.branches && (tasks.branches = function (next) {
			fetch(urls.branches, config, function (err, data) {
				next(err, data);
			});
		});

		cli.argv.branch && (tasks.branchBuilds = function (next) {
			getBranchBuilds(config, cli.argv.branch, osName, next);
		});

		async.parallel(tasks, function (err, results) {
			var defaultInstallLocation = cli.env.installPath,
				locations = cli.env.os.sdkPaths.map(function (p) { return afs.resolvePath(p); }),
				customLocations = config.get('paths.sdks'),
				activeSDK = config.get('sdk.selected', config.get('app.sdk')),
				sdks = cli.env.sdks,
				vers = Object.keys(sdks).sort().reverse(),
				branchBuilds = results.branchBuilds && results.branchBuilds.filter(function (f) {
					return f.filename.indexOf(osName) != -1;
				}).map(function (f) {
					var p = f.filename.match(/^mobilesdk\-(.+)(?:\.v|\-)((\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2}))\-([^\.]+)/);
					f.version = p[1];
					f.ts = p[2];
					f.date = new Date(p.slice(4, 6).join('/') + '/' + p[3] + ' ' + p.slice(6, 9).join(':'));
					f.dateFormatted = moment(f.date).format('l LT');
					return f;
				}).sort(function (a, b) {
					return b.ts - a.ts;
				});

			if ((!activeSDK || activeSDK == 'latest') && vers.length) {
				activeSDK = vers[0];
			}

			locations.indexOf(defaultInstallLocation) == -1 && locations.push(defaultInstallLocation);

			if (customLocations) {
				Array.isArray(customLocations) || (customLocations = [customLocations]);
				customLocations.forEach(function (location) {
					location = afs.resolvePath(location);
					if (location && fs.existsSync(location) && locations.indexOf(location) == -1) {
						locations.push(location);
					}
				});
			}

			if (cli.argv.output == 'json') {
				var obj = {
					activeSDK: activeSDK,
					defaultInstallLocation: defaultInstallLocation,
					installLocations: locations,
					installed: {},
					releases: results.releases
				};

				if (branchBuilds) {
					obj.branch = {};
					obj.branch[cli.argv.branch] = branchBuilds;
				}

				vers.forEach(function (v) {
					obj.installed[v] = sdks[v].path;
				});

				appc.util.mix(obj, results.branches);

				logger.log(JSON.stringify(obj, null, '\t'));
			} else {
				logger.banner()
				if (!vers.length) {
					logger.log(__('No Titanium SDKs are installed') + '\n');
					logger.log(__("You can download the latest Titanium SDK by running: %s", (cli.argv.$ + ' sdk install').cyan) + '\n');
					return;
				}

				logger.log(__('SDK Install Locations:'));
				locations.sort().forEach(function (p) {
					logger.log('   ' + p.cyan + (p == defaultInstallLocation ? (' [' + __('default') + ']').grey : ''));
				});
				logger.log();

				var activeLabel = ' [' + __('selected') + ']',
					maxlen = vers.reduce(function (a, b) {
						return Math.max(a, b.length + (b == activeSDK ? activeLabel.length : 0));
					}, 0),
					activeValid = false;

				logger.log(__('Installed SDKs:'));
				vers.forEach(function (v) {
					var d = v == activeSDK ? activeLabel : '',
						n = maxlen + 2 - v.length - d.length;
					activeValid = activeValid || v == activeSDK;
					logger.log('   ' + v.cyan + d.grey + new Array(n + 1).join(' ') + sdks[v].path);
				});
				logger.log();

				if (results.releases) {
					logger.log(__('Releases:'));
					if (results.releases instanceof Error) {
						logger.log('   ' + results.releases.message.red);
					} else {
						var i = 0;
						Object.keys(results.releases).sort().reverse().forEach(function (r) {
							logger.log('   ' + r.cyan + (sdks.hasOwnProperty(r) ? ' [' + __('installed') + ']' : '') + (i++ == 0 ? ' [' + __('latest') + ']' : ''));
						});
						i || logger.log('   ' + __('No releases found'));
					}
					logger.log();
				}

				if (results.branches !== void 0) {
					logger.log(__('Branches:'));
					if (results.branches instanceof Error) {
						logger.log('   ' + results.branches.message.red);
					} else {
						var data = results.branches;
						if (data && data.branches.length) {
							data.branches.sort().reverse().forEach(function (b) {
								logger.log('   ' + b.cyan + (b == data.defaultBranch ? (' [' + __('default') + ']').grey: ''));
							});
						} else {
							logger.log('   ' + __('No branches found'));
						}
					}
					logger.log();
				}

				if (cli.argv.branch) {
					if (branchBuilds) {
						logger.log(__("'%s' Branch Builds:", cli.argv.branch));
						if (branchBuilds.length) {
							var maxdate = branchBuilds.reduce(function (a, b) {
									return Math.max(a, b.dateFormatted.length);
								}, 0);
							branchBuilds.forEach(function (f) {
								// sample data:
								//	{	sha1: '334a347c109c9a92e6f270b738024f4891580bdd',
								//		build_url: 'http://jenkins.appcelerator.org/job/titanium_mobile_master/2437/',
								//		git_revision: '745801f5610d4e82769b084cad40b9628b02ae05',
								//		filename: 'mobilesdk-3.2.0.v20130612114042-osx.zip',
								//		git_branch: 'master',
								//		build_type: 'mobile',
								//		size: 162594820,
								//		version: '3.2.0',
								//		name: '3.2.0.v20130612114042',
								//		ts: '20130612114042',
								//		date: Wed Jun 12 2013 11:40:42 GMT-0700 (PDT),
								//		dateFormatted: '6/12/2013 11:40 AM'
								//	}
								logger.log('   ' + (f.version + '.v' + f.ts).cyan + '  '
									+ appc.string.rpad(f.dateFormatted, maxdate) + '  '
									+ ('(' + humanize.filesize(f.size, 1024, 1).toUpperCase() + ')').grey);
							});
							logger.log(__('** NOTE: these builds not recommended for production use **').grey);
						} else {
							logger.log('   ' + __('No builds found'));
						}
						logger.log();
					} else if (err) {
						logger.error(__('Invalid branch "%s"', cli.argv.branch) + '\n');
						logger.log(__("Run '%s' for a list of available branches.", (cli.argv.$ + ' sdk --branches').cyan) + '\n');
					}
				}

				if (!activeValid) {
					logger.error(__("Selected Titanium SDK '%s' not found", activeSDK) + '\n');
					logger.log(__("Run '%s' to set the selected Titanium SDK.", (cli.argv.$ + ' sdk select <sdk-version>').cyan) + '\n');
				}
			}

			finished();
		});
	}
};

/**
 * Selects the specified Titanium SDK as the selected SDK.
 * @memberof SdkSubcommands
 * @param {Object} logger - The logger instance
 * @param {Object} config - The CLI config object
 * @param {CLI} cli - The CLI instance
 * @param {Function} finished - Callback when the command finishes
 */
SdkSubcommands.select = {
	conf: function (logger, config, cli) {
		return {
			desc: __('used to select which installed Titanium SDK is the selected SDK'),
			noAuth: true,
			args: [
				{
					desc: __('the version to select'),
					name: 'version',
					required: !config.get('cli.prompt')
				}
			]
		};
	},
	fn: function select(logger, config, cli, finished) {
		var selectedSDK = cli.argv.version,
			invalidSDKCount = 0,
			// we only care about SDKs that are 3.0 or newer
			// also we sort before filter so that the invalid SDKs print in some order
			vers = Object.keys(cli.env.sdks).sort().filter(function (v) {
				var s = cli.env.sdks[v],
					name = s.manifest && s.manifest.version || s.name;
				try {
					return appc.version.gte(name, '3.0.0');
				} catch (e) {
					// the sdk is pre-3.3.0 and doesn't have a version number in the manifest and the name is not a version number
					logger.error(__('Found invalid Titanium SDK "%s" [%s]', name, s.path));
					invalidSDKCount++;
					return false;
				}
			// sort the SDKs by their actual version so we know that the first one is the 'latest'
			}).sort(function (a, b) {
				var as = cli.env.sdks[a],
					av = as.manifest && as.manifest.version || as.name,
					bs = cli.env.sdks[b],
					bv = bs.manifest && bs.manifest.version || bs.name;
				try {
					if (appc.version.lt(av, bv)) {
						return -1;
					} else if (appc.version.eq(av, bv)) {
						return 0;
					}
				} catch (ex) {}
				return 1;
			}).reverse(),
			activeSDK = config.get('sdk.selected', config.get('app.sdk', 'latest')) == 'latest' && vers.length ? vers[0] : config.get('sdk.selected', config.get('app.sdk')),
			activeLabel = ' [' + __('selected') + ']',
			maxlen = vers.reduce(function (a, b) {
				return Math.max(a, b.length + (b == activeSDK ? activeLabel.length : 0));
			}, 0);

		invalidSDKCount && logger.log();

		// check we even have any SDKs installed
		if (!vers.length) {
			logger.log(__('No suitable Titanium SDKs installed') + '\n');
			return;
		}

		// if they specified 'latest' or 'stable', then determine the latest/stable version
		if (vers.length) {
			if (selectedSDK === 'latest') {
				selectedSDK = vers[0];
			} else if (selectedSDK === 'stable') {
				for (var i = 0, re = /GA$/i; i < vers.length; i++) {
					if (re.test(vers[i])) {
						selectedSDK = vers[i];
						break;
					}
				}
			}
		}

		if (selectedSDK) {
			// we have a version, see if it's valid
			if (vers.indexOf(selectedSDK) != -1) {
				// need to force the config to reload
				config.load();
				config.set('sdk.selected', selectedSDK);
				config.save();
				logger.log(__('Configuration saved') + '\n');
				finished();
				return;
			} else {
				logger.error(__('Invalid Titanium SDK "%s"', selectedSDK) + '\n');
				appc.string.suggest(selectedSDK, vers, logger.log);
				// if prompting is disabled, then we're done
				if (!cli.argv.prompt) {
					process.exit(1);
				}
			}
		} else if (!cli.argv.prompt) {
			// no version supplied, no prompting, show error and exit
			logger.error(__('No SDK version specified') + '\n');
			logger.log(__('Usage: %s', (cli.argv.$ + ' sdk select <version>').cyan) + '\n');
			process.exit(1);
		}

		// prompt for the sdk version to select
		fields.select({
			default: cli.env.sdks[activeSDK] ? activeSDK : undefined,
			promptLabel: __('Titanium SDK version to select'),
			complete: true,
			completeIgnoreCase: true,
			numbered: true,
			margin: '',
			options: {
				'Installed SDKs:': vers.map(function (v) {
					return {
						path: cli.env.sdks[v].path,
						value: v
					};
				})
			},
			formatters: {
				option: function (opt, idx, num) {
					var d = opt.value == activeSDK ? activeLabel : '',
						n = maxlen + 2 - opt.value.length - d.length;
					return '  ' + num + opt.value.cyan + d.grey + new Array(n + 1).join(' ') + opt.path;
				}
			},
			validate: function (value) {
				if (!cli.env.sdks[value]) {
					logger.error(__('Invalid Titanium SDK "%s"', value));
					return false;
				}
				if (appc.version.lt(value, '3.2.0')) {
					logger.log('');
					logger.warn(__('Titanium SDK ' + value + ' has been deprecated and will not work with future releases.'));
					logger.warn(__('Please use Titanium SDK 3.2 or newer.'));
				}
				return true;
			}
		}).prompt(function (err, value) {
			if (err && err.message == 'cancelled') {
				logger.log('\n');
				process.exit(1);
			}

			// need to force the config to reload
			config.load();
			config.set('sdk.selected', value);
			config.save();

			logger.log('\n' + __('Configuration saved') + '\n');
			finished();
		});
	}
};

/**
 * Installs the specified Titanium SDK.
 * @memberof SdkSubcommands
 * @param {Object} logger - The logger instance
 * @param {Object} config - The CLI config object
 * @param {CLI} cli - The CLI instance
 * @param {Function} finished - Callback when the command finishes
 */
SdkSubcommands.install = {
	conf: function (logger, config, cli) {
		return {
			// command examples:
			// ti sdk install
			// ti sdk install --default
			// ti sdk install --branch master
			// ti sdk install --branch master --default
			// ti sdk install something.zip
			// ti sdk install something.zip --default
			// ti sdk install http://builds.appcelerator.com/mobile/master/mobilesdk-3.2.0.v20130612114042-osx.zip
			// ti sdk install 3.1.0.GA
			// ti sdk install 3.1.0.GA --default
			// ti sdk install 3.2.0.v20130612114042 --branch master
			// ti sdk install 3.2.0.v20130612114042 --branch master --default
			desc: __('download the latest Titanium SDK or a specific version'),
			noAuth: false,
			args: [
				{
					desc: __('the version to install, "latest", URL, or zip file'),
					name: 'version',
					required: true
				}
			],
			flags: {
				default: {
					abbr: 'd',
					desc: __('set as default SDK'),
				},
				force: {
					abbr: 'f',
					desc: __('force re-install')
				},
				'keep-files': {
					abbr: 'k',
					desc: __('keep downloaded files after install'),
				}
			},
			options: {
				branch: {
					abbr: 'b',
					desc: __('the branch to install from or "latest" (stable)'),
					hint: __('branch name')
				}
			}
		};
	},
	fn: function install(logger, config, cli, finished) {
		var installLocation = afs.resolvePath(cli.env.installPath),
			osName = cli.env.os.name,
			version = cli.argv.version,
			branch = cli.argv.branch;

		// make sure the install location exists
		if (!fs.existsSync(installLocation)) {
			try {
				wrench.mkdirSyncRecursive(installLocation);
			} catch (ex) {
				logger.error(__('Unable to create installation location: %s', installLocation) + '\n');
				if (e.code == 'EACCES') {
					logger.error(__('Permission denied') + '\n');
				} else {
					e.toString().split('\n').forEach(function (line) {
						line.trim() && logger.error(line);
					});
					logger.log();
				}
				process.exit(1);
			}
		}

		// make sure sdk folder is writable when installing an sdk
		if (!afs.isDirWritable(installLocation)) {
			logger.error(__('Installation location is not writable: %s', installLocation) + '\n');
			process.exit(1);
		}

		function scanBranches(version, callback) {
			getBranches(config, function (err, data) {
				if (err || !data || !Array.isArray(data.branches)) return callback(true);

				branch = null;

				async.parallel(
					data.branches.map(function (branchName) {
						return function (next) {
							if (branch) return next();
							getBranchBuilds(config, branchName, osName, function (err, data) {
								if (!branch && !err && Array.isArray(data)) {
									for (var i = 0, l = data.length; i < l; i++) {
										if (data[i].name == version) {
											data.branches = [];
											branch = branchName;
											break;
										}
									}
								}
								next();
							});
						};
					}),
					function () {
						callback(!branch);
					}
				);
			});
		}

		function doReleases(callback) {
			// check if it's a valid release
			getReleases(config, osName, function (err, releases) {
				if (err || !releases || !Object.keys(releases).length) {
					logger.error(__('No releases found!') + '\n');
					process.exit(1);
				}

				var isLatest = !version || version == 'latest',
					rels = Object.keys(releases).sort().reverse();

				isLatest && (version = rels[0]);

				function foundVersion() {
					if (!cli.argv.force && cli.env.sdks[version]) {
						if (isLatest) {
							logger.log(__("You're up-to-date. Version %s is currently the newest version available.", version.cyan) + '\n');
						} else {
							logger.log(__("Titanium SDK %s is already installed!", version.cyan) + '\n');
						}
						logger.log(__("Run '%s' to re-install.", (cli.argv.$ + ' sdk install ' + version + ' --force').cyan) + '\n');
						process.exit(0);
					}

					isLatest && !cli.argv.force && logger.log(__('New version available! %s', version.cyan) + '\n');

					callback(null, {
						url: releases[version],
						version: version,
						setDefault: isLatest
					});
				}

				if (releases[version]) {
					foundVersion();
				} else {
					logger.log(__('Did not find a release %s, scanning branches...', version.cyan));

					scanBranches(version, function (err) {
						if (err) {
							logger.log();
							logger.error(__('Release "%s" does not exist', version) + '\n');
							if (!cli.argv.branch && version.indexOf('.v') != -1) {
								logger.log(__('Did you forget to specify the branch?') + '\n')
							}
							appc.string.suggest(version, rels, logger.log, 1);
							logger.log(__('Available Releases:'));
							logger.log(appc.string.renderColumns(rels, '    ', 100).cyan + '\n');
							process.exit(1);
						}

						logger.log(__('Found release %s in branch %s', version.cyan, branch.cyan) + '\n');

						doBranch(version, callback)
					});
				}
			});
		}

		function doBranch(version, callback) {
			// check that the branch is valid
			fetch(urls.branches, config, function (err, data) {
				if (err || !data || !data.branches.length) {
					logger.error(__('No branches found!') + '\n');
					process.exit(1);
				}

				if (branch == 'latest') {
					branch = data.defaultBranch;
				}

				if (data.branches.indexOf(branch) == -1) {
					logger.error(__('Branch "%s" does not exist', branch) + '\n');
					appc.string.suggest(branch, data.branches, logger.log, 2);
					logger.log(__('Available Branches:'));
					logger.log(appc.string.renderColumns(data.branches.sort().reverse(), '    ', 100).cyan + '\n');
					process.exit(1);
				}

				getBranchBuilds(config, branch, osName, function (err, builds) {
					if (err || !builds || !builds.length) {
						logger.log(__("Branch '%s' does not have any builds", branch) + '\n');
						process.exit(1);
					}

					var isLatest = !version || version == 'latest',
						build = isLatest ? builds[0] : builds.filter(function (b) { return b.name == version; }).shift();

					if (!build) {
						var buildNames = builds.map(function (b) { return b.name; }).sort().reverse();
						logger.error(__('Build "%s" does not exist', version) + '\n');
						appc.string.suggest(version, buildNames, logger.log, 2);
						logger.log(__('Available Builds:'));
						logger.log(appc.string.renderColumns(buildNames, '    ', 100).cyan + '\n');
						process.exit(1);
					}

					version = build.name;

					if (!cli.argv.force && cli.env.sdks[version]) {
						if (isLatest) {
							logger.log(__("You're up-to-date. Version %s is currently the newest version available.", version.cyan) + '\n');
						} else {
							logger.log(__("Titanium SDK %s is already installed!", version.cyan) + '\n');
						}
						logger.log(__("Run '%s' to re-install.", (cli.argv.$ + ' sdk install ' + version + ' --force --branch ' + branch).cyan) + '\n');
						process.exit(0);
					}

					callback(null, {
						url: urls.build.replace(/\$BRANCH/, branch).replace(/\$FILENAME/, build.filename),
						version: version,
						branch: branch
					});
				});
			});
		}

		function downloadSDK(url, callback) {
			logger.log(__('Downloading %s', url.cyan));

			var tempName = temp.path({ suffix: '.zip' }),
				tempDir = path.dirname(tempName);
			fs.existsSync(tempDir) || wrench.mkdirSyncRecursive(tempDir);

			var tempStream = fs.createWriteStream(tempName),
				req = request({
					url: url,
					proxy: config.get('cli.httpProxyServer'),
					rejectUnauthorized: config.get('cli.rejectUnauthorized', true)
				});

			req.pipe(tempStream);

			req.on('error', function (err) {
				fs.existsSync(tempName) && fs.unlinkSync(tempName);
				logger.log();
				logger.error(__('Failed to download SDK: %s', err.toString()) + '\n');
				process.exit(1);
			});

			req.on('response', function (req) {
				if (req.statusCode >= 400) {
					// something went wrong, abort
					logger.log();
					logger.error(__('Request failed with HTTP status code %s %s', req.statusCode, http.STATUS_CODES[req.statusCode] || '') + '\n');
					process.exit(1);
				} else if (req.headers['content-length']) {
					// we know how big the file is, display the progress bar
					var total = parseInt(req.headers['content-length']),
						bar;

					if (!cli.argv.quiet && !!cli.argv['progress-bars']) {
						bar = new appc.progress('  :paddedPercent [:bar] :etas', {
							complete: '='.cyan,
							incomplete: '.'.grey,
							width: 40,
							total: total
						});

						req.on('data', function (buffer) {
							bar.tick(buffer.length);
						});
					}

					tempStream.on('close', function () {
						if (bar) {
							bar.tick(total);
							logger.log('\n');
						}
						callback(tempName);
					});
				} else {
					// we don't know how big the file is, display a spinner
					var busy;

					if (!cli.argv.quiet && !!cli.argv['progress-bars']) {
						busy = new appc.busyindicator;
						busy.start();
					}

					tempStream.on('close', function () {
						busy && busy.stop();
						logger.log();
						callback(tempName);
					});
				}
			});
		}

		function extractSDK(filename, keepFiles, version, callback) {
			logger.log(__('Extracting SDK to %s', installLocation.cyan));

			var bar;

			appc.zip.unzip(filename, installLocation, {
				visitor: function (entry, i, total) {
					if (i == 0 && !cli.argv.quiet && !!cli.argv['progress-bars']) {
						bar = new appc.progress('  :paddedPercent [:bar]', {
							complete: '='.cyan,
							incomplete: '.'.grey,
							width: 40,
							total: total
						});
					}

					bar && bar.tick();

					if (!version) {
						var m = entry.entryName.match(/^mobilesdk\/[^\/]+\/([^\/]+)\/(version\.txt|manifest\.json)$/);
						if (m) {
							version = m[1];
						}
					}
				}
			}, function (err, extracted, total) {
				if (err) {
					keepFiles || fs.unlinkSync(filename);
					logger.log();
					if (version) {
						logger.error(__('Failed to unzip Titanium SDK %s', version));
					} else {
						logger.error(__('Failed to unzip Titanium SDK'));
					}
					String(err).trim().split('\n').forEach(logger.error);
					logger.log();
					process.exit(1);
				} else {
					if (bar) {
						bar.tick(total);
						logger.log('\n');
					}
					keepFiles || fs.unlinkSync(filename);
					callback(version);
				}
			});
		}

		async.series([
			function (next) {
				if (version) {
					var versionPath;
					if (/^http(s)?:\/\/.+/.test(version)) {
						// version is a URL
						next(null, { url: version });
					} else if (/.+\.zip$/.test(version) && fs.existsSync(versionPath = afs.resolvePath(version)) && fs.statSync(versionPath).isFile()) {
						// version is a file
						next(null, { file: versionPath });
					} else {
						var match = version.match(/^([A-Za-z0-9_]+?)\:(.+)$/)
						if (match) {
							// version is a git hash
							branch = match[1];
							doBranch(match[2], next);
						} else if (branch) {
							doBranch(version, next);
						} else {
							doReleases(next);
						}
					}
				} else if (branch) {
					doBranch(version, next);
				} else {
					doReleases(next);
				}
			}
		], function (err, data) {
			data = data.shift();

			var vers = Object.keys(cli.env.sdks).filter(function (v) {
					return appc.version.gte(v, '3.0.0');
				}).sort().reverse(),
				newestInstalledSdk = config.get('sdk.selected', config.get('app.sdk', 'latest')) == 'latest' ? (vers.length ? vers[0] : null) : config.get('sdk.selected', config.get('app.sdk')),
				setDefault = (data.setDefault || cli.argv.default) && appc.version.gte(data.version, '3.0.0') && (cli.argv.default || newestInstalledSdk === null || appc.version.gt(data.version, newestInstalledSdk)),
				analyticsPayload = {};

			data.version && (analyticsPayload.version = data.version);
			data.branch && (analyticsPayload.branch = data.branch);

			function finish(version) {
				analyticsPayload.version = version;
				cli.addAnalyticsEvent('sdk.install', analyticsPayload);

				if (version) {
					if (setDefault) {
						logger.log(__('Setting Titanium SDK %s as the default.', version.cyan) + '\n');
						config.load();
						config.set('sdk.selected', version);
						config.save();
					}

					logger.log(__('Titanium SDK %s successfully installed!', version.cyan) + '\n');
				} else {
					logger.log(__('Successfully installed!') + '\n');
				}

				finished();
			}

			if (data.file) {
				extractSDK(data.file, true, null, finish);
			} else if (data.url) {
				downloadSDK(data.url, function (filename) {
					extractSDK(filename, cli.argv['keep-files'], data.version, finish);
				});
			}
		});
	}
};

/**
 * Uninstalls the specified Titanium SDK.
 * @memberof SdkSubcommands
 * @param {Object} logger - The logger instance
 * @param {Object} config - The CLI config object
 * @param {CLI} cli - The CLI instance
 * @param {Function} finished - Callback when the command finishes
 */
SdkSubcommands.uninstall = {
	conf: function (logger, config, cli) {
		return {
			desc: __('uninstall a specific Titanium SDK version'),
			args: [
				{
					desc: __('the version to uninstall'),
					name: 'version',
					required: true
				}
			],
			flags: {
				force: {
					abbr: 'f',
					desc: __('force uninstall without confirmation')
				}
			}
		}
	},
	fn: function uninstall(logger, config, cli, finished) {
		var vers = Object.keys(cli.env.sdks).sort().reverse(),
			activeSDK = config.get('sdk.selected', config.get('app.sdk', 'latest')) == 'latest' && vers.length ? vers[0] : config.get('sdk.selected', config.get('app.sdk')),
			activeLabel = ' [' + __('selected') + ']',
			maxlen = vers.reduce(function (a, b) {
				return Math.max(a, b.length + (b == activeSDK ? activeLabel.length : 0));
			}, 0),
			version = cli.argv.version;

		async.series([
			function (next) {
				// if they didn't specify a version and prompting is disabled, then exit
				if (!version) {
					if (!cli.argv.prompt) {
						logger.error(__('No SDK version specified') + '\n');
						logger.log(__('Usage: %s', (cli.argv.$ + ' sdk uninstall <version>').cyan) + '\n');
						process.exit(1);
					}

					// prompt for which sdk to remove
					fields.select({
						promptLabel: __('Titanium SDK version to uninstall'),
						complete: true,
						numbered: true,
						margin: '',
						options: {
							'Installed SDKs:': vers.map(function (v) {
								return {
									path: cli.env.sdks[v].path,
									value: v
								};
							})
						},
						formatters: {
							option: function (opt, idx, num) {
								var d = opt.value == activeSDK ? activeLabel : '',
									n = maxlen + 2 - opt.value.length - d.length;
								return '  ' + num + opt.value.cyan + d.grey + new Array(n + 1).join(' ') + opt.path;
							}
						},
						validate: function (value) {
							if (!cli.env.sdks[value]) {
								logger.error(__('Invalid Titanium SDK "%s"', value));
								return false;
							}
							return true;
						}
					}).prompt(function (err, value) {
						if (err && err.message == 'cancelled') {
							logger.log('\n');
							process.exit(1);
						}

						logger.log();
						version = value;
						next();
					});
				} else {
					if (vers.indexOf(version) == -1) {
						logger.error(__('Titanium SDK "%s" is not found', version) + '\n');
						appc.string.suggest(version, vers, logger.log);
						process.exit(1);
					}
					next();
				}
			},
			function (next) {
				if (cli.argv.force) {
					next();
				} else if (!cli.argv.prompt) {
					logger.error(__('To uninstall a Titanium SDK in non-interactive mode, you must use %s', '--force'.cyan) + '\n');
					logger.log(__('Usage: %s', (cli.argv.$ + ' sdk uninstall ' + version + ' --force').cyan) + '\n');
					process.exit(1);
				} else {
					logger.log(__('WARNING! This will permanently remove Titanium SDK %s!', version).red + '\n');
					fields.text({
						promptLabel: __("Enter '%s' to confirm uninstall", version.cyan),
						validate: function (value) {
							if (value != version) {
								logger.error(__('Incorrect, try again'));
								return false;
							}
							return true;
						}
					}).prompt(function (err) {
						logger.log();
						if (err) {
							logger.log();
							process.exit(1);
						}
						next();
					});
				}
			}
		], function (err, data) {
			if (err) {
				logger.log('\n');
				process.exit(1);
			}

			try {
				logger.log(__('Removing SDK directory: %s', cli.env.sdks[version].path.cyan) + '\n');
				wrench.rmdirSyncRecursive(cli.env.sdks[version].path);
			} catch (e) {
				logger.error(__('An error occurred trying to remove the Titanium SDK folder:'));
				if (e.code == 'EACCES') {
					logger.error(__('Permission denied') + '\n');
				} else {
					e.toString().split('\n').forEach(function (line) {
						line.trim() && logger.error(line);
					});
					logger.log();
				}
				process.exit(1);
			}

			vers.splice(vers.indexOf(version), 1);

			if (config.get('sdk.selected', config.get('app.sdk')) == version) {
				// need to force the config to reload
				config.load();
				config.set('sdk.selected', vers.shift() || 'latest');
				config.save();
				logger.log(__('Updated selected Titanium SDK to %s', config.sdk.selected.cyan) + '\n');
			}

			logger.log(__('Successfully uninstalled Titanium SDK %s', version.cyan) + '\n');
			finished();
		});

	}
};

/**
 * Fetches the specified URL and returns the JSON parsed response.
 * @param {String} url - The URL to connect to
 * @param {Object} config - The CLI config object
 * @param {Function} callback - Callback when the command finishes
 */
function fetch(url, config, callback) {
	request({
		url: url,
		proxy: config.get('cli.httpProxyServer'),
		rejectUnauthorized: config.get('cli.rejectUnauthorized', true)
	}, function (error, response, body) {
		if (error) {
			callback(error, null);
		} else if (response.statusCode != 200) {
			callback(new Error(__('Request failed with HTTP status code %s %s', response.statusCode, http.STATUS_CODES[response.statusCode] || '')), null);
		} else {
			try {
				var json = JSON.parse(body) || null;
			} catch (ex) {
				return callback(ex, null);
			}
			callback(null, json);
		}
	});
}

/**
 * Retrieves the list of releases.
 * @param {Object} config - The CLI config object
 * @param {String} os - The name of the OS (osx, linux, win32)
 * @param {Function} callback - Callback when the command finishes
 */
function getReleases(config, os, callback) {
	fetch(urls.releases, config, function (err, data) {
		var releases = {};
		!err && data && data.releases && data.releases.forEach(function (r) {
			r.os == os && r.name == 'mobilesdk' && (releases[r.version] = r.url);
		});
		callback && callback(err, err ? new Error(__('Failed to get releases: %s', err.message || err.toString())) : releases);
	});
}

/**
 * Retrieves the list of branches.
 * @param {Object} config - The CLI config object
 * @param {Function} callback - Callback when the command finishes
 */
function getBranches(config, callback) {
	fetch(urls.branches, config, function (err, branches) {
		callback && callback(err, err ? new Error(__('Failed to get branches: %s', err.message || err.toString())) : branches);
	});
}

/**
 * Retrieves the list of builds for a given branch.
 * @param {Object} config - The CLI config object
 * @param {String} branch - The name of the branch
 * @param {String} osName - The name of the current OS (osx, linux, win32)
 * @param {Function} callback - Callback when the command finishes
 */
function getBranchBuilds(config, branch, osName, callback) {
	fetch(urls.branch.replace(/\$BRANCH/, branch), config, function (err, builds) {
		if (!err && builds) {
			builds = builds.filter(function (f) {
				return f.filename.indexOf(osName) != -1;
			}).map(function (f) {
				var p = f.filename.match(/^mobilesdk\-(.+)(?:\.v|\-)((\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2}))\-([^\.]+)/);
				f.version = p[1];
				f.name = p[1] + '.v' + p[2];
				f.ts = p[2];
				f.date = new Date(p.slice(4, 6).join('/') + '/' + p[3] + ' ' + p.slice(6, 9).join(':'));
				f.dateFormatted = moment(f.date).format('l LT');
				return f;
			}).sort(function (a, b) {
				return b.ts - a.ts;
			});
		}
		callback(err, builds);
	});
}
