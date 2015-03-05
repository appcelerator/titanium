/**
 * The login command. Authenticates a user against the Appcelerator Network.
 *
 * @module commands/login
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

/** Login command name. */
exports.name = 'login';

/** Login command description. */
exports.desc = __('logs into the Appcelerator network');

/**
 * Returns the configuration for the login command.
 * @param {Object} logger - The logger instance
 * @param {Object} config - The CLI config object
 * @param {CLI} cli - The CLI instance
 * @returns {Object} Login command configuration
 */
exports.config = function (logger, config, cli) {
	return {
		noAuth: true,
		args: [
			{
				name: 'username',
				desc: __('user to log in as, if not already logged in'),
				prompt: {
					default: config.user && config.user.email,
					label: __('Username'),
					error: __('Invalid username'),
					pattern: /\S+/
				},
				required: true
			},
			{
				name: 'password',
				desc: __('the password to log in with'),
				prompt: {
					label: __('Password'),
					error: __('Invalid password'),
					pattern: /\S+/
				},
				password: true,
				required: true
			}
		]
	};
};

/**
 * Authenticates the user into the Appcelerator Network.
 * @param {Object} logger - The logger instance
 * @param {Object} config - The CLI config object
 * @param {CLI} cli - The CLI instance
 * @param {Function} finished - Callback when the command finishes
 */
exports.run = function (logger, config, cli, finished) {
	appc.auth.login({
		username: cli.argv.username,
		password: cli.argv.password,
		loginUrl: config.get('cli.auth.loginUrl'),
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
			} else {
				logger.log(__('Logged in successfully'));
			}
			logger.log();
			finished();
		}
	});
};
