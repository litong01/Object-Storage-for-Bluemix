/**
 * Copyright 2014 IBM Corp.
 */

var logger = require("./logger");

/** The module which allow a cache to be timed. The items put in the cache will
 * disappear after specified the time in milliseconds. Default is 1 minute.
 */
function TimedCache(expire_time) {
	this._cache = {};
	this._timer = {};
	if (typeof expire_time === 'number' && expire_time > 0)
		this._expire_time = expire_time;
	else
		this._expire_time = 60000;

	this.set = function(name, value) {
		this._cache[name] = value;
		this._timer[name] = new Date().getTime();
	};

	this.get = function(name) {
		if (this._cache[name]) {
			var right_now = new Date().getTime();
			if (this._timer[name] + this._expire_time > right_now) {
				this._timer[name] = right_now;
				return this._cache[name];
			}
			else {
				delete this._cache[name];
				delete this._timer[name];
				return '';
			}
		}
		else {
			return '';
		}
	};
	
	this.del = function(name) {
		delete this._cache[name];
		delete this._timer[name];
	};
	
	this.keys = function() {
		var _keys = [];
		for (var key in this._cache) {
			_keys.push(key);
		}
	};
	
	this.size = function() {
		return this.keys().length;
	};
	
	this.cleanup = function() {
		var _expired_keys = [];
		var right_now = new Date().getTime();
		
		// Figure out all the keys should be expired by now.
		for (var key in this._cache) {
			if (this._timer[key] + this._expire_time < right_now) {
				_expired_keys.push(key);
			}
		};

		// remove these keys.
		for (var key in _expired_keys) {
			this.del(key);
		};

		logger.log(logger.level.debug, logger.module.core, "Keys removed from TimedCache.", _expired_keys);
	};
};

module.exports = {
	TimedCache: TimedCache
};