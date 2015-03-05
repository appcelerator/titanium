/**
 * The logout command. Ends a user's Appcelerator Network session.
 *
 * @module commands/logout
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
	__ = appc.i18n(__dirname).__;

/** Logout command name. */
exports.name = 'logout';

/** Logout command description. */
exports.desc = __('logs out of the Appcelerator network');

/**
 * Returns the configuration for the logout command.
 * @param {Object} logger - The logger instance
 * @param {Object} config - The CLI config object
 * @param {CLI} cli - The CLI instance
 * @returns {Object} Logout command configuration
 */
exports.config = function (logger, config, cli) {
	return {
		noAuth: true
	};
};

/**
 * Logs the user out of the Appcelerator Network.
 * @param {Object} logger - The logger instance
 * @param {Object} config - The CLI config object
 * @param {CLI} cli - The CLI instance
 * @param {Function} finished - Callback when the command finishes
 */
exports.run = function (logger, config, cli, finished) {
	appc.auth.logout({
		logoutUrl: config.get('cli.auth.logoutUrl'),
		proxy: config.get('cli.httpProxyServer'),
		rejectUnauthorized: config.get('cli.rejectUnauthorized', true),
		callback: function (err, result) {
			if (err) {
				if (err.type == 'AppcException') {
					err.dump(logger.error);
				} else {
					logger.error(err.toString().trim());
				}
				result && result.hasOwnProperty('loggedIn') && logger.error(result.loggedIn ? __('You are still logged in') : __('You are currently logged out'));
			} else if (result.alreadyLoggedOut) {
				logger.log(__('Already logged out'));
			} else {
				logger.log(__('Logged out successfully'));
			}
			logger.log();
			finished();
		}
	});
};
