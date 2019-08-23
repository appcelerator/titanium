// istanbul ignore if
if (!Error.prepareStackTrace) {
	require('source-map-support/register');
}

import Bridge from './bridge';

(async () => {
	try {
		const bridge = new Bridge();
		await bridge.exec({ argv: process.argv.slice(2), console, env: process.env });
	} catch (err) {
		const exitCode = err.exitCode || 1;

		if (err.json) {
			console.log(JSON.stringify({
				code: exitCode,
				result: err.toString()
			}, null, 2));
		} else {
			console.error(err.stack || err);
		}

		process.exit(exitCode);
	}
})();
