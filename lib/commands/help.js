/**
 * The help command. Displays the general help screen listing all available
 * commands as well as detailed information for a specific command.
 *
 * @module commands/help
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
	__ = appc.i18n(__dirname).__,
	fs = require('fs');

/** Help command name. */
exports.name = 'help';

/** Help command description. */
exports.desc = __('displays this help screen');

/**
 * Returns the configuration for the help command.
 * @param {Object} logger - The logger instance
 * @param {Object} config - The CLI config object
 * @param {CLI} cli - The CLI instance
 * @returns {Object} Help command configuration
 */
exports.config = function (logger, config, cli) {
	return {
		noAuth: true,
		skipSendingAnalytics: true
	};
};

/**
 * Displays help information or detailed information about a specific command.
 * @param {Object} logger - The logger instance
 * @param {Object} config - The CLI config object
 * @param {CLI} cli - The CLI instance
 * @param {Function} finished - Callback when the command finishes
 */
exports.run = function (logger, config, cli, finished) {
	if (!fs.existsSync(config.getConfigPath())) {
		logger.log(__('Titanium CLI has not yet been configured.').magenta);
		logger.log(__("Run '%s' to configure the Titanium CLI.", 'titanium setup wizard')
			.split('titanium setup')
			.map(function (s) { return s.magenta; })
			.join('titanium setup'.cyan) + '\n');
	}

	var argv = cli.argv,
		command = argv._.shift(),
		subcommand;

	while (command == 'help') {
		command = argv._.shift();
	}
	subcommand = argv._.shift();

	cli.emit('help:header');
	cli.emit('cli:check-plugins');

	if (argv.exception) {
		logger.exception(argv.exception);
	}

	// check if we even know what the command is
	if (command && !cli.globalContext.commands[command]) {
		logger.log(('[ERROR] ' + __('Unrecognized command "%s"', command)).red + '\n');
		appc.string.suggest(command, Object.keys(cli.globalContext.commands), logger.log);
		command = subcommand = null;
	}

	// print the help starting with the global context
	cli.globalContext.printHelp(logger, config, cli, command, subcommand, finished);
};
