'use strict';

function normalizeConfig(jsConfig) {
	const config = normalizePropertyNames(jsConfig);

	config.modules = config.modules.filter(m => m).map(m => normalizeDependency(m));
	config.plugins = config.plugins.filter(p => p).map(p => normalizeDependency(p, 'plugin'));

	return config;
}

function normalizePropertyNames(obj) {
	if (Array.isArray(obj)) {
		return obj.map(v => normalizePropertyNames(v));
	} else if (typeof obj === 'object' && obj !== null) {
		const result = {};
		Object.getOwnPropertyNames(obj).forEach(propertyName => {
			let value = obj[propertyName];
			value = normalizePropertyNames(value);
			result[propertyName] = value;
			const kebabCasePropertyName = camelCaseToKebabCase(propertyName);
			if (kebabCasePropertyName !== propertyName) {
				Object.defineProperty(result, kebabCasePropertyName, {
					get() {
						return result[propertyName];
					},
					set(value) {
						result[propertyName] = value;
					},
					enumerable: true
				});
			}
		});
		return result;
	} else {
		return obj;
	}
}

function camelCaseToKebabCase(value) {
	return value.replace(/([a-zA-Z])(?=[A-Z])/g, '$1-').toLowerCase();
}

function normalizeDependency(dep, type = 'module') {
	if (Array.isArray(dep)) {
		const moduleId = dep[0];
		const moduleOptions = dep[1] || {};
		return Object.assign({ id: moduleId }, moduleOptions);
	} else if (typeof dep === 'string') {
		return { id: dep };
	} else if (typeof dep === 'object') {
		return dep;
	} else {
		throw new TypeError(`Invalid ${type} configuration. Expected a type of "array", "string" or "object". Received ${typeof dep}`);
	}
}

function clearRequireCache (id, map = new Map()) {
	const module = require.cache[id];
	if (module) {
		map.set(id, true);
		// Clear children modules
		module.children.forEach(child => {
			if (!map.get(child.id)) {
				clearRequireCache(child.id, map);
			}
		});
		delete require.cache[id];
	}
}

module.exports = {
	normalizeConfig,
	clearRequireCache
};
