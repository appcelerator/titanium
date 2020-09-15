/**
 * Hook management system. Performs hook detection, registration, and emitting.
 *
 * @module hook
 *
 * @copyright
 * Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 *
 * @license
 * Licensed under the terms of the Apache Public License
 * Please see the LICENSE included with this distribution for details.
 *
 * @requires async
 * @requires node-appc
 * @requires semver
 */
'use strict';

module.exports = Hook;

var fs = require('fs'),
	path = require('path'),
	vm = require('vm'),
	async = require('async'),
	semver = require('semver'),
	appc = require('node-appc'),
	mix = appc.util.mix;

/**
 * Creates hook system.
 * @class
 * @classdesc Hook registry and dispatcher.
 * @constructor
 */
function Hook() {
	// legacy interface for Titanium SDK <3.2
	this.hooks = {
		scannedPaths: {},
		pre: {},
		post: {},
		ids: {},
		loadedFilenames: [],
		incompatibleFilenames: [],
		erroredFilenames: [],
		errors: {}
	};
}

function findInDir (dir, include = /\.js$/, exclude = /^[._]/, fileList = []) {
	const files = fs.readdirSync(dir);
	for (const file of files) {
		const filePath = path.join(dir, file);
		const fileStat = fs.statSync(filePath);

		if (fileStat.isDirectory()) {
			findInDir(filePath, include, exclude, fileList);
		} else if (include.test(filePath) && !exclude.test(filePath)) {
			fileList.push(filePath);
		}
	}

	return fileList;
}

/**
 * @constant
 * @type {Number}
 * @default
 */
Hook.HOOK_PRIORITY_DEFAULT = 1000;

/**
 * Scans the specified path for hooks. Each hook is identified by a JavaScript
 * file.
 * @param {String} dir - A directory or JavaScript file to be scanned.
 * @param {RegExp} include - Regular expression to match for included filenames.
 * @param {RegExp} exclude - Regular expression to match for excluded filenames.
 */
Hook.prototype.scanHooks = function scanHooks(dir, include, exclude) {
	if (!this.hooks.scannedPaths[dir] && fs.existsSync(dir)) {
		const fileList = findInDir(dir, include, exclude);

		fileList.forEach(function (file) {
			try {
				vm.runInThisContext('(function (exports, require, module, __filename, __dirname) { ' + fs.readFileSync(file).toString() + '\n});', file, 0, false);
				var mod = require(file); // eslint-disable-line security/detect-non-literal-require
				if (mod.id) {
					Array.isArray(this.hooks.ids[mod.id]) || (this.hooks.ids[mod.id] = []);
					this.hooks.ids[mod.id].push({
						file: file,
						version: mod.version || null
					});
					// don't load duplicate ids
					if (this.hooks.ids[mod.id].length > 1) {
						return;
					}
				}
				if (!this.version || !mod.cliVersion || semver.satisfies(appc.version.format(this.version, 0, 3, true), mod.cliVersion)) {
					mod.init && mod.init(this.logger, this.config, this, appc);
					this.hooks.loadedFilenames.push(file);
				} else {
					this.hooks.incompatibleFilenames.push(file);
				}
			} catch (ex) {
				this.hooks.erroredFilenames.push(file);
				this.hooks.errors[file] = ex;
			}
		}, this);
		this.hooks.scannedPaths[dir] = 1;
	}
};

/**
 * Registers a callback to a hook.
 * @param {String} name - The event name
 * @param {Function|Object} callback - The function/object fired
 * @returns {Object} this
 * @example
 * cli.on('build.post.compile', {
 *     priority: 8000,
 *     post: function (build, finished) {
 *         // do awesome stuff here
 *         finished();
 *     }
 * });
 */
Hook.prototype.on = function on(name, callback) {
	var priority = Hook.HOOK_PRIORITY_DEFAULT;

	if (typeof callback === 'function') {
		callback = { post: callback };
	} else if (Object.prototype.toString.call(callback) === '[object Object]') {
		priority = parseInt(callback.priority) || priority;
	}

	if (callback.pre) {
		var preHooks = this.hooks.pre[name] || (this.hooks.pre[name] = []),
			i = 0;
		callback.pre.priority = priority;
		for (i = 0; i < preHooks.length && priority >= preHooks[i].priority; i++) {}
		preHooks.splice(i, 0, callback.pre);
	}

	if (callback.post) {
		var postHooks = this.hooks.post[name] || (this.hooks.post[name] = []),
			j = 0;
		callback.post.priority = priority;
		for (j = 0; j < postHooks.length && priority >= postHooks[j].priority; j++) {}
		postHooks.splice(j, 0, callback.post);
	}

	return this;
};

/**
 * Calls on().
 * @deprecated
 */
Hook.prototype.addHook = Hook.prototype.on;

/**
 * Fires an hook event. This function creates a 'function hook', then immediately
 * calls it, thus making it an 'event hook'.
 * @param {String|Array<String>} hookNames - The hook name or an array of many hook names
 * @param {Object} [data] - The event payload
 * @param {Function} callback - A callback when the event has finished firing
 * @returns {Object} this
 */
Hook.prototype.emit = function emit(hookNames, data, callback) {
	if (typeof data === 'function') {
		callback = data;
		data = null;
	}

	// make sure hookNames is an array
	Array.isArray(hookNames) || (hookNames = [ hookNames ]);

	// create each hook and immediately fire them
	async.each(hookNames, function (name, next) {
		if (!name) {
			return next();
		}
		this.createHook(name, data)(next);
	}.bind(this), callback);

	return this;
};

/**
 * Calls emit().
 * @deprecated
 */
Hook.prototype.fireHook = Hook.prototype.emit;

/**
 * Creates a hook. This is a multipurpose function that is capable of creating
 * 'event hooks' and 'function hooks'.
 * @param {String} name - The hook name
 * @param {Object} ctx - A context to bind the 'fn' param
 * @param {Function} fn - The function to call when the hook is running
 * @returns {Function} A new 'function hook'
 */
Hook.prototype.createHook = function createHook(name, ctx, fn) {
	var dataPayload = {},
		hooks = this.hooks,
		_t = this;

	if (typeof ctx === 'function') {
		fn = ctx;
		ctx = null;
	} else if (Object.prototype.toString.call(ctx) === '[object Object]' && !fn) {
		dataPayload = ctx;
		ctx = null;
	}

	return function () {
		var data = mix(dataPayload, {
				type: name,
				args: Array.prototype.slice.call(arguments),
				fn: fn,
				ctx: ctx
			}),
			callback = data.args.pop(),
			pres = hooks.pre[name] || [],
			posts = hooks.post[name] || [];

		// call all pre filters
		async.series(pres.map(function (pre) {
			return function (cb) {
				if (pre.length >= 2) {
					pre.call(ctx, data, function (err, _data) {
						_data && (data = _data);
						cb(err);
					});
				} else {
					pre.call(ctx, data);
					cb();
				}
			};
		}), function (preErr) {
			if (preErr) {
				callback && callback(preErr);
				return;
			}

			function next() {
				data.result = Array.prototype.slice.call(arguments);
				// call all post filters
				async.series(posts.map(function (post) {
					return function (cb) {
						if (post.length >= 2) {
							post.call(ctx, data, function (err, _data) {
								if (!err && _data && typeof _data === 'object' && _data.type) {
									data = _data;
								}
								cb(err);
							});
						} else {
							post.call(ctx, data);
							cb();
						}
					};
				}), function (postErr) {
					if (callback) {
						_t._fireHookCallback(callback, postErr, data);
					}
				});
			}

			if (data.fn) {
				// call the function
				data.args.push(next);
				data.fn.apply(data.ctx, data.args);
			} else {
				// just fire the event
				next();
			}
		});
	};
};

Hook.prototype._fireHookCallback = function _fireHookCallback(callback, err, data) {
	if (err) {
		callback(err);
	} else {
		callback.apply(data, data.result);
	}
};
