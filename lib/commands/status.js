/**
 * The status command. Indicates if you are logged into the Appcelerator
 * Network and the account you are logged in as.
 *
 * @module commands/status
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
	__ = appc.i18n(__dirname).__,
	async = require('async');

/** Status command name. */
exports.name = 'status';

/** Status command description. */
exports.desc = __('displays session information');

/**
 * Returns the configuration for the status command.
 * @param {Object} logger - The logger instance
 * @param {Object} config - The CLI config object
 * @param {CLI} cli - The CLI instance
 * @returns {Object} Status command configuration
 */
exports.config = function (logger, config, cli) {
	return {
		skipBanner: true,
		noAuth: true,
		skipSendingAnalytics: true,
		options: {
			output: {
				abbr: 'o',
				default: 'report',
				desc: __('output format'),
				values: ['report', 'json']
			}
		}
	};
};

/**
 * Displays the status of the current session.
 * @param {Object} logger - The logger instance
 * @param {Object} config - The CLI config object
 * @param {CLI} cli - The CLI instance
 * @param {Function} finished - Callback when the command finishes
 */
exports.run = function (logger, config, cli, finished) {
	async.parallel({
		auth: function (next) {
			next(null, appc.auth.status());
		},
		project: function (next) {
			// TODO: Implement project status
			next(null, {});
		}
	}, function (err, results) {
		switch (cli.argv.output) {
			case 'report':
				logger.banner();
				if (results.auth.loggedIn) {
					logger.log(__('You are currently %s as %s', 'logged in'.cyan, results.auth.email.cyan) + '\n');
				} else {
					logger.log(__('You are currently %s', 'logged out'.cyan) + '\n');
				}
				break;
			case 'json':
				logger.log(JSON.stringify(results.auth));
				break;
		}
		finished();
	});
};
