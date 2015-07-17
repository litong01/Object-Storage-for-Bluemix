/**
 * Copyright 2014 IBM Corp.
 */


exports.level = {
	alert: "alert",
	error: "error",
	warn: "warn",
	info: "info",
	debug: "debug",
	off: "off",
	all: "all"
};

exports.module = {
	sl: "softlayer",
	redis: "redis",
	core: "broker",
	bluemix: "bluemix"
};

//Comma separated, no space, lowercase log levels to enable
var ENV_LOG_LEVELS = process.env.log_levels || exports.level.info;

function isEnabled(level) {
	return ENV_LOG_LEVELS.indexOf(level) !== -1;
}

function isOff() {
	return ENV_LOG_LEVELS.indexOf(exports.level.off) !== -1;
}

function isAll() {
	return ENV_LOG_LEVELS.indexOf(exports.level.all) !== -1;
}

function getLogMessage(severity, module, message, details) {
	var log_message = {};

	log_message.severity = severity || "";
	log_message.module = module || "";
	log_message.body = message || "";
	log_message.details = details || {};

	return log_message;
}

exports.getLevel = function() {
	return ENV_LOG_LEVELS;
};


/**
 * Main logger function that outputs to console
 *
 * @param  {[String]} severity Refer to exports.level (ie. alert, error, warn..)
 * @param  {[String]} module   Refer to exports.module (ie. softlayer, redis, broker)
 * @param  {[String]} message  Log message body
 * @param  {[JSON]}   details  Any additional detail to describe the message such as json properties
 */
exports.log = function(severity, module, message, details) {
    if(! isOff()) {
    	if(isAll() || isEnabled(severity)) {
	    	var log_message = getLogMessage(severity, module, message, details);
	    	log_message.caller_function = arguments.callee.caller.name;

	    	console.log(JSON.stringify(log_message));
    	}
    }
};