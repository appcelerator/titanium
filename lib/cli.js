/**
 * The main CLI logic. This orchestrates all argument parsing, command loading,
 * validation, and execution.
 *
 * @module cli
 *
 * @copyright
 * Copyright (c) 2009-2015 by Appcelerator, Inc. All Rights Reserved.
 *
 * Copyright (c) 2010 hij1nx <http://www.twitter.com/hij1nx>
 * {@link https://github.com/hij1nx/complete}
 *
 * @license
 * Licensed under the terms of the Apache Public License
 * Please see the LICENSE included with this distribution for details.
 *
 * @requires async
 * @requires fields
 * @requires node-appc
 */
'use strict';

module.exports = CLI;

var	async = require('async'),
	fs = require('fs'),
	path = require('path'),
	util = require('util'),
	fields = require('fields'),
	appc = require('node-appc'),
	Context = require('./context'),
	Hook = require('./hook'),
	__ = appc.i18n(__dirname).__,
	series = appc.async.series,
	afs = appc.fs,
	mix = appc.util.mix;

// set global fields configuration
fields.setup({
	formatters: {
		error: function (err) {
			if (err instanceof Error) {
				return ('[ERROR] ' + err.message).red + '\n';
			}
			err = '' + err;
			return '\n' + (/^(\[ERROR\])/i.test(err) ? err : '[ERROR] ' + err.replace(/^Error:/i, '').trim()).red;
		}
	}
});

/**
 * Creates a CLI object.
 * @class
 * @classdesc Command line interface system.
 * @extends Hook
 * @constructor
 * @param {Object} [params] parameters
 */
function CLI(params) {
	// mixin the params
	mix(this, params);

	// call the Hook constructor
	Hook.call(this);

	// scan for local global hooks
	this.scanHooks(path.join(process.cwd(), 'plugins'), /titanium-global-plugin\.js$/);

	// find all hooks in the user's config paths
	var paths = this.config.paths.hooks;
	(Array.isArray(paths) ? paths : [ paths ]).forEach(function (p) {
		p && this.scanHooks(afs.resolvePath(p));
	}, this);

	// scan all built-in hooks
	this.scanHooks(path.join(__dirname, '..', 'hooks'));

	// define the start time used to measure the execution time.
	// the actual value set prior to executing the command
	this.startTime = null;

	// init the command line arguments
	this.argv = {
		_: [], // parsed arguments (reset each time the context's parse() is called)
		$: null, // resolved node script path
		$_: process.argv.slice(), // original arguments
		$0: process.argv.slice(0, 2).join(' ') // node process and original node script path
	};

	// strip the node executable from the args
	var args = this.argv.$_;
	if (args[0].replace(/\\/g, '/').split('/').pop().replace(/\.exe$/, '') === process.execPath.replace(/\\/g, '/').split('/').pop().replace(/\.exe$/, '')) {
		args.shift();
	}

	// find the executed file which may be symlinked, so need to keep walking symlinks
	var cd = path.dirname(file = args[0]),
		file;
	try {
		while (fs.lstatSync(file).isSymbolicLink()) {
			file = fs.readlinkSync(file);
			cd = path.resolve(cd, path.dirname(file));
			file = path.resolve(cd, path.basename(file));
		}
	} catch (e) {
		file = args[0];
	}
	this.argv.$ = path.basename(file);
	args.shift();

	// set the cli version for all contexts
	Context.prototype.cliVersion = this.version;

	// create the global context
	this.globalContext = new Context({ title: __('Global') });

	// needed for backwards compatibility
	Object.defineProperty(this, 'cmds', {
		enumerable: false,
		value: this.globalContext.commands
	});

	// init scanned command paths lookup
	this.scannedCommandPaths = {};

	// find all built-in commands
	this.scanCommands(path.join(__dirname, 'commands'));

	// find all commands in the config commands paths
	(function (_t, paths) {
		(Array.isArray(paths) ? paths : [ paths ]).forEach(function (p) {
			p && _t.scanCommands(afs.resolvePath(p));
		});
	}(this, this.config.get('paths.commands')));

	// init the tab completion system for non-Windows platforms
	this.completion = (process.platform !== 'win32' && !!this.config.cli.completion);
	if (this.completion) {
		this.initCompletion(this.argv.$);
		var i = this.argv.$_.indexOf('--compgen');
		this.completion = ~i;
		if (this.completion) {
			// doing tab completion, squelch all output
			process.on('uncaughtException', function () {});
			if (this.completion) {
				this.argv.$_ = this.argv.$_.slice(i + 2);
			} else {
				process.exit(0);
			}
		}
	}
}

util.inherits(CLI, Hook);

/**
 * @class
 * @classdesc Used to trigger a graceful shutdown without calling the process.exit()
 * @extends Error
 * @constructor
 */
function GracefulShutdown() {}
util.inherits(GracefulShutdown, Error);
CLI.prototype.GracefulShutdown = GracefulShutdown;

/**
 * Adds an analytics event that gets sent right before the process exits.
 * @param {String} name - The analytics event name
 * @param {*} data - The data payload
 * @param {String} type - The event type
 */
CLI.prototype.addAnalyticsEvent = function addAnalyticsEvent(name, data, type) {
	appc.analytics.addEvent(name, data, type);
};

/**
 * Scans a directory for all commands or a single file.
 * @param {String} dir - The directory to scan
 * @private
 */
CLI.prototype.scanCommands = function scanCommands(dir) {
	if (!this.scannedCommandPaths[dir] && fs.existsSync(dir)) {
		var jsfile = /\.js$/,
			ignore = /^[._]/,
			isDir = fs.statSync(dir).isDirectory();

		(isDir ? fs.readdirSync(dir) : [ dir ]).forEach(function (filename) {
			var file = isDir ? path.join(dir, filename) : filename;
			// we don't allow commands that start with _ or have spaces
			if (fs.existsSync(file) && fs.statSync(file).isFile() && jsfile.test(filename) && (!isDir || !ignore.test(path.basename(file)))) {
				// we don't allow commands that start with _ or have spaces
				var name = filename.replace(jsfile, '').toLowerCase();
				this.globalContext.command({
					name: name,
					path: file
				});
			}
		}, this);
		this.scannedCommandPaths[dir] = 1;
	}
};

/**
 * Configures global context's flags and options.
 * @param {Object} conf - The context's configuration
 * @returns {CLI}
 */
CLI.prototype.configure = function configure(conf) {
	this.globalContext.conf = conf = conf || {};
	conf.flags && this.globalContext.flag(conf.flags);
	conf.options && this.globalContext.option(conf.options);
	return this;
};

/**
 * Initialize tab completion.
 * @param {String} program - The name of the CLI binary being executed
 * @private
 */
CLI.prototype.initCompletion = function initCompletion(program) {
	var bashrc,
		files = [ '.bash_profile', '.bash_login', '.profile' ],
		l = files.length,
		i = 0,
		dir = path.join(process.env.HOME, '.node-completion'),
		file = path.join(dir, program),
		source = [
			'',
			'# {{{',
			'# Node Completion - Auto-generated, do not touch.',
			'shopt -s progcomp',
			'for f in $(command ls ~/.node-completion); do',
			'  f="$HOME/.node-completion/$f"',
			'  test -f "$f" && . "$f"',
			'done',
			'# }}}',
			''
		].join('\n'),
		completion = [
			'__{{NAME}}_comp() {',
			'  COMPREPLY=()',
			'  COMPREPLY=($({{NAME}} --compgen "${COMP_WORDS[@]}"))', // eslint-disable-line no-template-curly-in-string
			'  return 0',
			'}',
			'',
			'complete -F __{{NAME}}_comp {{NAME}} 2>/dev/null',
			''
		].join('\n').replace(/\{\{NAME\}\}/g, program);

	if (process.platform !== 'darwin') {
		bashrc = path.join(process.env.HOME, '.bashrc');
	} else {
		while (i < l) {
			if (fs.existsSync(bashrc = path.join(process.env.HOME, files[i++]))) {
				break;
			} else {
				bashrc = '';
			}
		}

		// If none exist, create a .bash_profile.
		bashrc || (bashrc = path.join(process.env.HOME, '.bash_profile'));
	}

	fs.readFile(bashrc, 'utf8', function (err, data) {
		data = data || '';
		if ((err && err.code === 'ENOENT') || !~data.indexOf('# Node Completion')) {
			data += source;
			fs.writeFile(bashrc, data);
		}
	});

	fs.mkdir(dir, 0o755, function () {
		fs.stat(file, function (err) {
			if (err && err.code === 'ENOENT') {
				fs.writeFile(file, completion);
			}
		});
	});
};

/**
 * Executes the tasks for parsing command line arguments and running the
 * specified command. It runs the following tasks:
 *
 * 1. loadCommand()
 * 2. processCompletion()
 * 3. validate()
 * 4. executeCommand()
 *
 * @param {Function} [done] - Callback when the function finishes
 * @emits CLI#cli:go
 */
CLI.prototype.go = function (done) {
	this.emit('cli:go', { cli: this }, function () {
		series(this, [
			'loadCommand',
			'processCompletion',
			'validate',
			'executeCommand'
		], done || function () {});
	}.bind(this));
};

/**
 * Loads the appropiate command.
 * @param {Function} next - Callback when the function finishes
 * @emits CLI#cli:command-loaded
 * @private
 */
CLI.prototype.loadCommand = function loadCommand(next) {
	// re-parse the cli args, but this time try to find the command and we also
	// want to skip option callbacks since we don't want to cause any issues with
	// callbacks being called more than once
	mix(this.argv, this.globalContext.parse(this.argv.$_, Object.keys(this.globalContext.commands), true));

	// if we didn't find any arguments, then force the help command
	if (!this.argv._.length || this.argv._[0] === 'help' || this.argv.$command === 'help') {
		if (!this.argv._.length || this.argv._[0] !== 'help') {
			this.argv._.unshift('help');
		}
		this.argv.$command === 'help';
	}

	var desiredCommand = this.argv.$command = this.argv._[0],
		command = this.command = this.globalContext.commands[desiredCommand];

	// check if the desired command exists
	if (!command) {
		// if we're doing completion, perhaps we have an incomplete command name?
		if (this.completion) {
			var arg = this.argv.$_.length && this.argv.$_[this.argv.$_.length - 1];
			arg && Object.keys(this.globalContext.commands).forEach(function (cmd) {
				if (cmd.indexOf(arg) === 0) {
					console.log(cmd);
				}
			});
			process.exit(0);
		}

		this.logger.banner();
		this.emit('cli:command-not-found', { cli: this, command: desiredCommand });
		this.logger.error(__('"%s" is an unrecognized command.', desiredCommand) + '\n');
		appc.string.suggest(desiredCommand, Object.keys(this.globalContext.commands), this.logger.log);
		this.logger.log(__('Run \'%s\' for available commands.', (this.argv.$ + ' help').cyan) + '\n');
		process.exit(1);
	}

	// load the command
	command.load(this.logger, this.config, this, function (err, command) {
		if (err) {
			this.logger.banner();
			this.logger.error(__('Failed to load command "%s"', command.name));
			this.logger.error(err.message.trim() + '\n');
			this.logger.log(err.stack.trim().grey + '\n');
			process.exit(1);
		}

		this.emit('cli:command-loaded', { cli: this, command: command }, next);
	}.bind(this));
};

/**
 * Performs tab completion, if enabled.
 * @param {Function} next - Callback when the function finishes
 * @private
 */
CLI.prototype.processCompletion = function processCompletion(next) {
	if (this.completion) {
		// TODO: complete words!
		console.log(this.argv.$_.join('|'));
		throw 'stop'; // eslint-disable-line no-throw-literal
	}
	next();
};

/**
 * Validates the arguments.
 * @param {Function} next - Callback when the function finishes
 * @emits CLI#cli:pre-validate
 * @emits CLI#cli:post-validate
 * @private
 */
CLI.prototype.validate = function validate(next) {
	this.emit('cli:pre-validate', { cli: this, command: this.command }, function () {
		var argv = this.argv;

		// validation master plan
		// 1) determine all invalid or missing options
		// 2) determine all missing arguments
		// 3) run the command's validate() function, if exists
		// 4) fire all option callbacks (note that callbacks on global options are not fired)

		series(this, [
			function handleMissingAndInvalidOptions(nextValidationTask) {
				var options = {};

				// mix the command and platform specific options together
				[ this.command, this.command.platform ].forEach(function (ctx) {
					ctx && ctx.conf && ctx.conf.options && mix(options, ctx.conf.options);
				});

				if (!options || !Object.keys(options).length) {
					// no missing options
					return nextValidationTask();
				}

				var _t = this,
					done = false,
					prompting = argv.prompt,
					globalOptions = Object.keys(this.globalContext.options),
					orderedOptionNames = Object.keys(options).sort(function (a, b) {
						if (options[a].order && options[b].order) {
							return options[a].order < options[b].order ? -1 : options[a].order > options[b].order ? 1 : 0;
						} else if (options[a].order) {
							return -1;
						} else if (options[b].order) {
							return 1;
						}
						return 0;
					});

				function wireupPrePrompt(field, opt, name) {
					field.once('pre-prompt', function () {
						if (!opt._err) {
							_t.logger.error(__('Invalid "%s" value "%s"', (opt.label || '--' + name), argv[name]) + '\n');
						} else if (opt._err instanceof Error) {
							_t.logger.error(opt._err.message + '\n');
						} else if (typeof opt._err === 'string') {
							_t.logger.error(opt._err + '\n');
						}
					});
					return field;
				}

				// we use an async while loop that constantly checks for invalid and missing
				// options per loop. this isn't the most efficient thing in the world, but we
				// need to do this because prompted options may introduce new required options.
				async.whilst(
					function () {
						return !done;
					},
					function (callback) {
						// this is the main body of the while loop where we determine all invalid
						// and missing options

						var invalid = {},
							invalidCount = 0,
							missing = {},
							missingCount = 0;

						// we asynchronously test each option in order and in series
						appc.async.series(this, orderedOptionNames.map(function (name) {
							return function (cb) {
								if (prompting && (missingCount || invalidCount)) {
									return cb();
								}
								if (options[name].validated) {
									return cb();
								}

								// check missing required options and invalid options
								var opt = options[name],
									obj = mix(opt, { name: name }),
									p = globalOptions.indexOf(name);

								// if this command or platform option is the same name as a global option,
								// then we must remove the name from the list of global options so that
								// the real options aren't blacklisted
								if (p !== -1) {
									globalOptions.splice(p, 1);
								}

								if (argv[name] === undefined) {
									// check if the option is required
									if (opt.required || (opt.conf && opt.conf.required)) {
										// ok, we have a required option, but it's possible that this option
										// replaces some legacy option in which case we need to check if the
										// legacy options were defined

										if (typeof opt.verifyIfRequired === 'function') {
											opt.verifyIfRequired(function (stillRequired) {
												if (stillRequired) {
													missing[name] = obj;
													missingCount++;
												}
												cb();
											});
											return;
										}
										missing[name] = obj;
										missingCount++;
									}
								} else if (Array.isArray(opt.values) && !opt.skipValueCheck && opt.values.indexOf(argv[name]) === -1) {
									invalid[name] = obj;
									invalidCount++;
								} else if (!opt.validated && typeof opt.validate === 'function') {
									try {
										opt.validate(argv[name], function (err, value) {
											if (err) {
												obj._err = err;
												invalid[name] = obj;
												invalidCount++;
											} else {
												argv[name] = value;
												opt.validated = true;
												if (opt.callback) {
													var val = opt.callback(argv[name] || '');
													val !== undefined && (argv[name] = val);
													delete opt.callback;
												}
											}
											cb();
										});
									} catch (ex) {
										if (ex instanceof GracefulShutdown) {
											// simply return and cb() is never called which effectively cause the cli
											// to gracefully exit
											return;
										}
										throw ex;
									}
									return;
								} else if (opt.callback) {
									opt.validated = true;
									var val = opt.callback(argv[name] || '');
									val !== undefined && (argv[name] = val);
									delete opt.callback;
								}

								cb();
							};
						}), function () {
							// at this point, we know if we have any invalid or missing options

							if (!invalidCount && !missingCount) {
								done = true;
								return callback();
							}

							// we have an invalid option or missing option

							if (!prompting) {
								// if we're not prompting, output the invalid/missing options and exit
								this.logger.banner();

								if (Object.keys(invalid).length) {
									Object.keys(invalid).forEach(function (name) {
										var opt = invalid[name],
											msg = __('Invalid "%s" value "%s"', (opt.label || '--' + name), argv[opt.name]);

										if (typeof opt.helpNoPrompt === 'function') {
											opt.helpNoPrompt(this.logger, msg);
										} else {
											this.logger.error(msg + '\n');
											if (opt.values) {
												this.logger.log(__('Accepted values:'));
												opt.values.forEach(function (v) {
													this.logger.log('   ' + v.cyan);
												}, this);
												this.logger.log();
											}
										}
									}, this);
								}

								if (Object.keys(missing).length) {
									// if prompting is disabled, then we just print all the problems we encountered
									Object.keys(missing).forEach(function (name) {
										var msg = __('Missing required option: %s', '--' + name + ' <' + (missing[name].hint || __('value')) + '>');
										if (typeof missing[name].helpNoPrompt === 'function') {
											missing[name].helpNoPrompt(this.logger, msg);
										} else {
											this.logger.error(msg + '\n');
										}
									}, this);
								}

								this.logger.log(__('For help, run: %s', (this.argv.$ + ' help ' + this.argv.$command).cyan) + '\n');
								process.exit(1);
							}

							// we are prompting, so find the first invalid or missing option
							var opt;
							if (invalidCount) {
								var name = Object.keys(invalid).shift();
								opt = invalid[name];
								if (opt.prompt) {
									// option has a prompt function that will return us a field
									var fn = opt.prompt;
									opt.prompt = function (callback) {
										fn(function (field) {
											callback(wireupPrePrompt(field, opt, name));
										});
									};
								} else {
									// option doesn't have a prompt, so let's make a generic one
									opt.prompt = function (callback) {
										var field;

										// if the option has values, then display a pretty list
										if (opt.values) {
											field = fields.select({
												title: __('Please select a valid %s value:', name.cyan),
												promptLabel: __('Select a value by number or name'),
												margin: '',
												numbered: true,
												relistOnError: true,
												complete: true,
												suggest: true,
												options: opt.values
											});
										} else {
											var pr = opt.prompt || {};
											field = fields.text({
												promptLabel: __('Please enter a valid %s', name.cyan),
												password: !!opt.password,
												validate: opt.validate || function (value, cb) {
													if (pr.validator) {
														try {
															pr.validator(value);
														} catch (ex) {
															if (ex.type === 'AppcException') {
																ex.dump(_t.logger);
															} else {
																_t.logger.error(ex);
															}
															return false;
														}
													} else if (!value.length || (pr.pattern && !pr.pattern.test(value))) {
														_t.logger.error(pr.error);
														return false;
													}
													return true;
												}
											});
										}

										callback(wireupPrePrompt(field, opt, name));
									};
								}
							} else {
								// must be a missing option
								opt = missing[Object.keys(missing).shift()];
							}

							// do the prompting
							this.prompt(opt, function (errs) {
								if (errs) {
									argv[opt.name] = undefined;
								} else {
									opt._err = null;
									opt.validated = true;
									if (opt.callback) {
										try {
											var val = opt.callback(argv[opt.name] || '');
											val !== undefined && (argv[opt.name] = val);
											delete opt.callback;
										} catch (ex) {
											if (ex instanceof GracefulShutdown) {
												// exit the validation and do NOT run the command
												_t.command.module.run = function () {};
												return next();
											}
											throw ex;
										}
									}
								}
								callback();
							});
						});
					}.bind(this),

					// while loop is done, go to the next validation task
					nextValidationTask
				);
			},

			function detectMissingArguments(nextValidationTask) {
				var args = (this.command.conf || {}).args,
					missingArgs = [];

				// TODO: update this to an async while loop similar to how options are handled above

				// check missing required arguments
				Array.isArray(args) && args.forEach(function (arg, i) {
					// if the arg doesn't have a name, skip it
					if (arg.name) {
						if (i < argv._.length) {
							// map arguments into the argv object
							argv[arg.name] = argv._[i];
						} else if (arg.required) {
							// note: we are going to error even if the arg has a default value
							missingArgs.push(arg);
						} else {
							argv[arg.name] = arg.default || '';
						}
					}
				});

				// if prompting, prompt for missing arguments
				if (!missingArgs.length) {
					return nextValidationTask();
				}

				if (!this.argv.prompt) {
					// if we're not prompting, output the missing arguments and exit
					this.logger.banner();

					missingArgs.forEach(function (arg) {
						this.logger.error(__('Missing required argument "%s"', arg.name) + '\n');
					}, this);

					this.logger.log(__('For help, run: %s', (this.argv.$ + ' help ' + this.argv.$command).cyan) + '\n');
					process.exit(1);
				}

				this.prompt(missingArgs, nextValidationTask);
			},

			function callCommandValidate(nextValidationTask) {
				var validate = this.command.module.validate;
				if (validate && typeof validate === 'function') {
					// call validate()
					var result = validate(this.logger, this.config, this),
						done = 0;
					if (result && typeof result === 'function') {
						result(function (r) {
							if (done++) {
								return;  // if callback is fired more than once, just ignore
							}
							if (r === false) {
								// squelch the run() function
								this.command.module.run = function () {};
							}
							this.emit('cli:post-validate', { cli: this, command: this.command }, nextValidationTask);
						}.bind(this));
						return;
					} else if (result === false) {
						// squelch the run() function
						this.command.module.run = function () {};
					}
				}
				this.emit('cli:post-validate', { cli: this, command: this.command }, nextValidationTask);
			},

			function callOptionCallbacks(nextValidationTask) {
				[ this.command, this.subcommand ].forEach(function (ctx) {
					if (ctx) {
						// call command/subcommand option callbacks
						var options = ctx.options;
						options && Object.keys(options).forEach(function (name) {
							if (options[name].callback) {
								var val = options[name].callback(argv[name] || '');
								val !== undefined && (argv[name] = val);
							}
						});

						// call platform specific option callbacks
						options = ctx.platform && ctx.platform.options;
						options && Object.keys(options).forEach(function (name) {
							if (options[name].callback) {
								var val = options[name].callback(argv[name] || '');
								val !== undefined && (argv[name] = val);
							}
						});
					}
				}, this);
				nextValidationTask();
			}
		], function (err) {
			if (err) {
				if (err.message !== 'cancelled') {
					this.logger.error(__('Failed to complete all validation tasks') + '\n');
					this.logger.error(err);
				}
				this.logger.log();
				process.exit(1);
			}
			next();
		});
	}.bind(this));
};

/**
 * Executes the selected command.
 * @param {Function} next - Callback when the function finishes
 * @emits CLI#cli:pre-execute
 * @emits CLI#cli:post-execute
 * @private
 */
CLI.prototype.executeCommand = function executeCommand(next) {
	this.emit('cli:pre-execute', { cli: this, command: this.command }, function () {
		try {
			this.startTime = Date.now();
			var run = this.command.module.run,
				done = 0;
			if (typeof run === 'function') {
				run(this.logger, this.config, this, function (err, result) {
					if (done++) {
						return; // if callback is fired more than once, just ignore
					}

					// we need to wrap the post-execute emit in a try/catch so that any
					// exceptions it throws aren't confused with command errors
					try {
						this.emit('cli:post-execute', { cli: this, command: this.command, err: err, result: result }, next);
					} catch (ex) {
						this.logger.error(__('Error while firing "%s" event', 'post-execute'));
						if (ex.type === 'AppcException') {
							ex.dump(this.logger.error);
						} else {
							this.logger.error(ex);
						}
						process.exit(1);
					}

					err && process.exit(1);
				}.bind(this));
			}
		} catch (ex) {
			this.logger.error(__('Failed to run command "%s"', this.argv.$command));
			if (ex.type === 'AppcException') {
				ex.dump(this.logger.error);
			} else {
				this.logger.error(ex);
			}
			process.exit(1);
		}
	}.bind(this));
};

/**
 * Prompts the user for the specified items.
 * @param {Array} items
 * @param {Function} done - Callback when the function finishes
 * @private
 */
CLI.prototype.prompt = function prompt(items, done) {
	// sanity check
	if (!items || (Array.isArray(items) && (!items.length || !items.some(i => i)))) {
		return done();
	}

	var _t = this,
		errs = [],
		// create our async queue
		queue = async.queue(function (opt, callback) {
			if (opt.prompt && typeof opt.prompt === 'function') {
				opt.prompt(function (field) {
					if (!field) {
						return callback();
					}

					// if this option had a bad value and caused an error, then disable auto selecting
					if (opt._err && field.autoSelectOne) {
						field.autoSelectOne = false;
					}

					field.prompt(function (err, value) {
						if (err) {
							errs.push(err);
							if (err.message === 'cancelled') {
								return callback(err);
							}
						} else {
							// if we just prompted with a Select field, autoSelectOne is true, and
							// there is exactly one option, then do not display the extra line break
							var items = 0;
							if (field.options && field.autoSelectOne) {
								if (Array.isArray(field.options)) {
									items = field.options.length;
								} else if (typeof field.options === 'object') {
									Object.keys(field.options).forEach(function (key) {
										if (Array.isArray(field.options[key])) {
											items += field.options[key].length;
										}
									});
								}
							}
							items !== 1 && _t.logger.log();
							_t.argv[opt.name] = value;
						}
						callback();
					});
				});
			} else {
				var pr = opt.prompt || {},
					p = (pr.label || appc.string.capitalize(opt.desc || '')).trim().replace(/:$/, ''),
					def = pr.default || opt.default || '';

				if (typeof def === 'function') {
					def = def();
				} else if (Array.isArray(def)) {
					def = def.join(',');
				}

				fields.text({
					promptLabel: p,
					promptValues: opt.values,
					default: def || undefined,
					password: !!opt.password,
					validate: pr.validate || function (value, cb) {
						if (pr.validator) {
							try {
								pr.validator(value);
							} catch (ex) {
								if (ex.type === 'AppcException') {
									ex.dump(_t.logger);
								} else {
									_t.logger.error(ex);
								}
								return false;
							}
						} else if (!value.length || (pr.pattern && !pr.pattern.test(value))) {
							_t.logger.error(pr.error);
							return false;
						}
						return true;
					}
				}).prompt(function (err, value) {
					if (!err) {
						_t.argv[opt.name] = value;
					} else {
						errs.push(err);
					}
					callback(err);
				});
			}
		}, 1);

	// when the queue is drained, then we're done
	queue.drain = function () {
		done(errs.length ? errs : null);
	};

	// queue up items to prompt for
	(Array.isArray(items) ? items : [ items ]).forEach(function (opt) {
		queue.push(opt, function (err) {
			if (err) {
				err.message === 'cancelled' && _t.logger.log(); // add an extra line for ctrl-c
				_t.logger.log();
				process.exit(1);
			}
		});
	});
};

/* Events */

/**
 * Fired before the CLI begins the main process flow.
 * @event CLI#cli:go
 * @type {object}
 * @property {Object} cli - The CLI instance.
 */

/**
 * Fired after the command file has been require()'d.
 * @event CLI#cli:command-loaded
 * @type {object}
 * @property {Object} cli - The CLI instance.
 * @property {Object} command - The command descriptor.
 */

/**
 * Fired before any validation takes place.
 * @event CLI#cli:pre-validate
 * @type {object}
 * @property {Object} cli - The CLI instance.
 * @property {Object} command - The command descriptor.
 */

/**
 * Fired after all validation is done.
 * @event CLI#cli:post-validate
 * @type {object}
 * @property {Object} cli - The CLI instance.
 * @property {Object} command - The command descriptor.
 * @property {Boolean} success - True if the command's validation passed.
 */

/**
 * Fired before the command is executed.
 * @event CLI#cli:pre-execute
 * @type {object}
 * @property {Object} cli - The CLI instance.
 * @property {Object} command - The command descriptor.
 */

/**
 * Fired after the command has been executed.
 * @event CLI#cli:post-execute
 * @type {object}
 * @property {Object} cli - The CLI instance.
 * @property {Object} command - The command descriptor.
 * @property {*} result - The result of the run command, if any.
 */
