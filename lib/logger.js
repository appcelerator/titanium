/**
 * The logger mechanism. Current implementation built on top of Winston.
 *
 * @module logger
 *
 * @copyright
 * Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 *
 * Copyright (c) 2010 Charlie Robbins <https://github.com/flatiron/winston>
 * {@link https://github.com/flatiron/winston}
 *
 * @license
 * Licensed under the terms of the Apache Public License
 * Please see the LICENSE included with this distribution for details.
 *
 * @requires node-appc
 * @requires sprintf
 * @requires winston
 */

var path = require('path'),
	appc = require('node-appc'),
	__ = appc.i18n(__dirname).__,
	winston = require('winston'),
	common = require(path.join(path.dirname(require.resolve('winston')), 'winston', 'common.js')),
	sprintf = require('sprintf').sprintf,
	config = require('./config'),
	consoul = new winston.transports.Console({
		level: config.get('cli.logLevel', 'trace'),
		colorize: !!config.get('cli.colors')
	}),
	logger = exports = module.exports = new winston.Logger({
		transports: [ consoul ],
		silent: !!config.get('cli.quiet')
	}),
	// Windows PowerShell translates magenta to the same blue as the background. So use cyan, instead.
	debugColor = process.platform === 'win32' && process.title.indexOf('PowerShell') >= 0 ? 'cyan' : 'magenta',
	origLoggerLog = logger.log,
	bannerEnabled = true,
	bannerWasRendered = false;

logger.silence = function (val) {
	consoul.silent = val;
};

logger.getLevels = function () {
	return Object.keys(logger.levels).filter(function (x) {
		return x != '_';
	});
};

logger.setLevel = function (n) {
	consoul.level = n;
};

logger.log = function () {
	var args = Array.prototype.slice.call(arguments),
		padLevels = logger.padLevels;

	// if there are no args (i.e. a blank line), we need at least one space
	args.length || args.unshift(' ');

	// if we're not being called from info/warn/error/debug, then set this as a general log entry
	args[0] in logger.levels || args.unshift('_');

	// turn off padding
	logger.padLevels = args[0] != '_';

	// get rid of any null args
	while (args.length && args[args.length-1] == null) args.pop();

	// if we're logging an error, we need to cast to a string so that sprintf doesn't complain
	if (args[1] instanceof Error || Object.prototype.toString.call(args[1]) == '[object Error]') {
		args[1] = (args[1].stack || args[1].toString()) + '\n';
	} else if (args[1] == null || args[1] == undefined) {
		args[1] = '';
	}

	typeof type != 'string' && (args[1] = ''+args[1]);

	// call the original logger with our cleaned up args
	origLoggerLog.apply(logger, [args[0], args.length > 2 ? sprintf.apply(null, args.slice(1)) : args[1]]);

	// restore padding
	logger.padLevels = padLevels;

	return logger;
};

logger.banner = function () {
	var info = appc.pkginfo.package(module, 'version', 'about');
	if (bannerEnabled) {
		logger.log(info.about.name.cyan.bold + ', CLI version ' + info.version + (logger.activeSdk ? ', Titanium SDK version ' + logger.activeSdk : '') + '\n' + info.about.copyright);
		logger.log('\n' + __('Please report bugs to %s', 'http://jira.appcelerator.org/'.cyan) + '\n');
		logger.emit('cli:logger-banner');
		bannerWasRendered = true;
	}
	bannerEnabled = false;
};

logger.bannerEnabled = function (b) {
	if (b !== void 0) {
		bannerEnabled = !!b;
	}
	return bannerEnabled;
};

logger.bannerWasRendered = function () {
	return bannerWasRendered;
};

// override the Console log() function to strip off the ':' after the level
consoul.log = function (level, msg, meta, callback) {
	if (this.silent) {
		return callback(null, true);
	}

	this.colorize || (msg = msg.stripColors);

	if (this.colorize) {
		if (level === 'warn') {
			msg = msg.stripColors.yellow;
		} else if (level === 'error') {
			msg = msg.stripColors.red;
		}
	}

	var output = common.log({
		colorize:    true,
		json:        this.json,
		level:       level,
		message:     msg,
		meta:        meta,
		stringify:   this.stringify,
		timestamp:   this.timestamp,
		prettyPrint: this.prettyPrint,
		raw:         this.raw
	});

	if (level != '_') {
		output = output.replace(/] \:\s?/, '] ');
	}
	else if (/^\: /.test(output)) {
		output = output.substring(2);
	}

	if (level === 'error' || level === 'warn' || level === 'debug') {
		console.error(output);
	} else {
		console.log(output);
	}

	this.emit('logged');
	callback(null, true);
};

// override the colorize() function so we can change the level formatting
winston.config.colorize = function (level) {
	var label = '[' + level.toUpperCase() + '] ';
	return level == '_' ? '' : consoul.colorize ? label[winston.config.allColors[level]] : label;
};

logger.exception = function (ex) {
	if (ex.stack) {
		ex.stack.split('\n').forEach(logger.error);
	} else {
		logger.error(ex.toString());
	}
	logger.log();
};

// init the logger with sensible cli defaults
logger.cli();

// override levels, must be done after calling cli()
logger.setLevels({
	trace: 0,
	debug: 1,
	info: 2,
	warn: 3,
	error: 4,
	_: 5 // generic log() call
});

// override colors, must be done after calling cli()
winston.addColors({
	trace: 'grey',
	debug: debugColor
});
