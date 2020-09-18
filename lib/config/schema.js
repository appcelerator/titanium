'use strict';

const joi = require('@hapi/joi');

const schema = joi.object({
	// General app info
	id: joi.string()
		.required(),
	name: joi.string()
		.required(),
	description: joi.string(),
	version: joi.string(),
	guid: joi.string()
		.required()
		.guid(),
	publisher: joi.string(),
	url: joi.string(),
	copyright: joi.string(),

	// App configuration
	icon: joi.string(),
	fullscreen: joi.boolean(),
	navbarHidden: joi.boolean(),
	statusbarHidden: joi.boolean(),
	analytics: joi.boolean(),
	properties: joi.object(),
	android: joi.object({
		manifest: joi.forbidden(),
		abi: joi.string(),
		// FIXME. How to handle this? Automatically read in a file similar to the manifest
		// under platform/android/activities.xml ?
		activities: joi.forbidden(),
		services: joi.forbidden()
	}),
	ios: joi.object({
		teamId: joi.string()
			.when('extensions', {
				is: joi.exist(),
				then: joi.required()
			}),
		entitlements: joi.forbidden(),
		extensions: joi.array().items(joi.object({
			projectPath: joi.string(),
			targets: joi.array().items(joi.object({
				name: joi.string().required(),
				provisioningProfiles: joi.object({
					devices: joi.string(),
					distAppstore: joi.string(),
					disAdhoc: joi.string()
				})
			}))
		})),
		plist: joi.forbidden(),
		enableLaunchScreenStoryboard: joi.boolean(),
		useAppThinning: joi.boolean(),
		useAutolayout: joi.boolean(),
		useJscoreFramework: joi.boolean(),
		minIosVersion: joi.string(),
		minSdkVersion: joi.string(),
		logServerPort: joi.number()
	}).unknown(),
	windows: joi.object({
		id: joi.string(),
		manifest: joi.forbidden()
	}),
	sdkVersion: joi.string()
		.required(),
	deploymentTargets: joi.array().valid('android', 'ipad', 'iphone'),

	// Webpack
	webpack: joi.object({
		type: joi.string().valid('angular', 'classic', 'vue'),
		transpileDependencies: joi.array().items(
			joi.string(),
			joi.object().instance(RegExp)
		)
	}),

	// Modules and Plugins
	modules: joi.array().items(
		joi.string(),
		joi.array().ordered(
			joi.string(),
			joi.object({
				version: joi.string().required(),
				platform: joi.string().valid('android', 'iphone', 'commonjs'),
				deployType: joi.string().valid('development', 'test', 'production')
			})
		)
	),
	plugins: joi.array().items(
		joi.string(),
		joi.array().ordered(
			joi.string(),
			joi.object({
				version: joi.string().required()
			})
		)
	)
}).unknown();

module.exports = schema;
