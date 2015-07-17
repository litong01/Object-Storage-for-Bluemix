/**
 * Copyright 2014 IBM Corp.
 */

var request = require('request');
var redis = require("redis");
var crypto = require("crypto");
var async = require("async");
var timedcache = require("./timedcache");
var slcommon = require("./slcommon");
var account_buffer = require('./account_buffer');
var admin = require("./admin");
var logger = require("./logger");

var APP_ENV = null;
var protocol = "https://";

//redis.debug_mode = true;

exports.Result = function(defaultStatusCode) {
    this.statusCode = defaultStatusCode || null;
    this.header = {
        "Content-Type": "application/json:charset=utf-8"
    };
    this.body = {};

    var that = this;
    this.preRender = function(res) {
        res.statusCode = that.statusCode;
        for ( var key in that.header) {
            if (that.header.hasOwnProperty(key)) {
                res.set(key, that.header[key]);
            }
        }
    };
};

exports.Services = function(redis_client) {
    this.client = redis_client;
    this.vcap_app = exports.getApp();
    this.worker = new slcommon.SLWorker(this.vcap_app);
    var that = this;

    var doc_host = this.vcap_app.uris[0].replace(this.vcap_app.application_name, 'www');

    this.services = [ {
	    id: this.vcap_app.service_id || "OSID-" + this.vcap_app.application_name,
	    name: this.vcap_app.service_name || this.vcap_app.application_name,
        version: "1.0",
        description: "The Object Storage service in Bluemix is based on SoftLayer Object Storage which in turn is based on OpenStack Swift. It has built-in support for provisioning independent object stores and it creates an individual subaccount per object store.",
        bindable: true,
        tags: [ "data_management", "ibm_created", "ibm_beta" ],
        metadata: {
            smallImageUrl: protocol + this.vcap_app.uris[0] + "/icons/objectStoreIcon24.png",
            mediumImageUrl: protocol + this.vcap_app.uris[0] + "/icons/objectStoreIcon32.png",
            largeImageUrl: protocol + this.vcap_app.uris[0] + "/icons/objectStoreIcon50.png",
            imageUrl: protocol + this.vcap_app.uris[0] + "/icons/objectStoreIcon64.png",
            featuredImageUrl: protocol + this.vcap_app.uris[0] + "/icons/objectStoreIcon.svg",
            documentationUrl: protocol + doc_host + "/docs/#services/ObjectStorage/index.html#ObjectStorage",
            descriptionUrl: protocol + doc_host + "/docs/#services/ObjectStorage/index.html#ObjectStorage",
            descriptionURL: protocol + doc_host + "/docs/#services/ObjectStorage/index.html#ObjectStorage",
            termsUrl: "https://www.ibm.com/software/sla/sladb.nsf/sla/bm-6620-01",
            version: "1.",
            displayName:"Object Storage - " + this.vcap_app.application_name,
            providerName: "IBM Bluemix"
        },
	    plans: [{id: this.vcap_app.plan_id || this.vcap_app.application_name + "-plan",
            name: "free",
                 metadata : {displayName: "Free Beta"},
                 description: "unlimited use of object storage"}
       ]
    } ];

    this.newCredential = function(result, callback) {
        result.username = crypto.randomBytes(20).toString('hex');
        result.password = crypto.randomBytes(30).toString('hex');
        callback(result);
    };
    this.checkEmptyParams = function(params, commaSeparatedParams, callback) {
        var success = true, result;
        commaSeparatedParams.split(",").some(function(param) {
            if (!params[param] || params[param].length === 0) {
                result = new exports.Result(400);
                result.body = {
                    "msg": "parameter " + param + " missing from parameters"
                };
                success = false;
                callback(result);
                return true;
            }
        });
        return success;
    };

    this.asyncInstanceCheck = function(service_instance_key, result, callback) {
        that.client.get(service_instance_key, function(err, reply) {
            if (err) {
                result.statusCode = 400;
                result.body = {
                    msg: JSON.stringify(err)
                };
            } else if (!reply) {
                result.statusCode = 400;
                result.body = {
                    msg: "Service instance does not exist."
                };
            }
            callback(result.statusCode, result);
        });
    };
    this.newBinding = function(result, callback) {
        this.newCredential(result, function(result) {
            result.binding = {
                credentials: {
                    auth_uri: protocol + that.vcap_app.uris[0] + "/auth/" + result.instance_id + "/" + result.id,
                    global_account_auth_uri: protocol + that.vcap_app.uris[0] + "/global_auth/" + result.instance_id
                            + "/" + result.id,
                    username: result.username,
                    password: result.password
                }
            };
            callback(result);
        });
    };

    this.catalog = function(req, res, callback) {
        var result = new exports.Result(200);
        result.body.services = that.services;
        callback(result);
    };

    // This method is for the app to call to get a token to access SL Swift
    // The token should never be transmitted to end user.
    this.authUser = function(req, res, callback) {
        logger.log(logger.level.debug, logger.module.core, "Auth User Request");
        this._authUser(req, res, callback);
    };
    this.authInstanceWideUser = function(req, res, callback) {
        logger.log(logger.level.debug, logger.module.core, "Auth User Global Request");
        this._authUser(req, res, callback, true);
    };
    this._authUser = function(req, res, callback, global) {
        var result = new exports.Result(), returnResult = new exports.Result(), binding_key, usage_key, account_key;
        var paramsToCheck = global ? "id,instance_id" : "id,instance_id,uid";
        if (!this.checkEmptyParams(req.params, paramsToCheck, callback)) {
            return;
        }

        /* Saves the binding information, like the following:
         * key: "B/<service_instanceid>/<service_bindingid>"
         * 
         * value:
         * 
         * {"credentials": {
         *     "auth_uri":"http://swift.ng.bluemix.net/auth/ed4a14ab-f000-4225-bd1c-dbb9ccbd67ba/dadf4a6c-b5ac-4a08-adf6-8c619b04f854",
         *     "username":"2a36e22efe347fea630d18d67d98e34dc5439fc0",
         *     "password":"47895d7f2fa14c174f85377738170cd5a35c215b21d803fd6001fe19105d"
         *    }
         * }
         */
        binding_key = "B/" + req.params.instance_id + "/" + req.params.id;

        /* Saves the swift storage account id for each individual user.
         * key: "AB/<service_instanceid>/<service_bindingid>/<userid>
         * or for global service instance account
         * key: "AB/<service_instanceid>/GLOBAL
         * 
         * value: 
         *  {"account":"SLOS316624-17",
         *   "orderItemId":"29896488",
         *   "id":2732752,
         *   "bllingItemId":22397112}
         */
        if (global === true) {
            account_key = "AB/" + req.params.instance_id + "/GLOBAL";
            usage_key = "US/" + req.params.instance_id + "/GLOBAL";
        } else {
            account_key = "A" + binding_key + "/" + req.params.uid;
            usage_key = "US/" + req.params.instance_id + "/" + req.params.id + "/" + req.params.uid;
        }

        logger.log(logger.level.debug, logger.module.core, "Auth Request stack about to execute", {account_key: account_key, usage_key: usage_key});

        async.series([
            // Make sure that the basic authentication is all right
            function(callback) {
                logger.log(logger.level.debug, logger.module.core, "Auth User Request: Basic auth check");
                that.client.get(binding_key, function(err, reply) {
                    logger.log(logger.level.debug, logger.module.core, "Auth User Request: Redis getting back keys");
                    if (err || !reply) {
                        result.statusCode = 401;
                        logger.log(logger.level.error, logger.module.core, "Auth User Request: Redis: Error or No Reply", err);
                    } else {
                        var binding = JSON.parse(reply);
                        var authheader = req.headers.authorization;
                        if (authheader) {
                            var code = authheader.trim().substring(5).trim();
                            var decoded = new Buffer(code || '', 'base64').toString('utf8');
                            decoded = decoded.split(":");
                            if (decoded[0] !== binding.credentials.username
                                    || decoded[1] !== binding.credentials.password) {
                                result.statusCode = 401;
                                result.body = {
                                    msg: "No matching id found."
                                };
                                logger.log(logger.level.warn, logger.module.core, "Auth User Request: No matching id found", result);
                            } else {
                                logger.log(logger.level.debug, logger.module.core, "Auth User Request: Basic auth successful");
                            }
                        } else {
                            result.statusCode = 401;
                            result.body = {
                                msg: "No authentication info found."
                            };
                            logger.log(logger.level.warn, logger.module.core, "Auth User Request: No auth info found", result);
                        }
                    }
                    callback(result.statusCode, result);
                });
            },
            // check if the service is enabled.
            function(callback) {
                logger.log(logger.level.debug, logger.module.core, "Auth User Request: Check if service enabled");

                var service_state_key = "SS/" + req.params.instance_id;
                that.client.get(service_state_key, function(err, reply) {
                    if (!err && reply) {
                        var s_enabled = JSON.parse(reply);
                        if (!s_enabled) {
                            result.statusCode = 403;
                            result.body = 'Service is disabled!';
                        }
                    } else {
                        result.statusCode = 403;
                        result.body = err;
                    }

                    logger.log(logger.level.debug, logger.module.core, "Auth User Request: Service Enablement Status", result);
                    callback(result.statusCode, result);
                });
            },
            // check if the account has been created.
            function(callback) {
                logger.log(logger.level.debug, logger.module.core, "Auth User Request: Get account key from redis");
                that.client.get(account_key, function(err, reply) {
                    if (!err && reply) {
                        var account = JSON.parse(reply);
                        result.account = account.account;
                    }
                    logger.log(logger.level.debug, logger.module.core, "Auth User Request: Get account key from redis. Result: ", result);
                    callback(err, result);
                });
            }, function(callback) {
                //If account exists, then move on to next.
                if (result.account) {
                    callback(null, result);
                } else {
                    account_buffer.fetchAccountFromBuffer(function(resultFromCall) {
                        logger.log(logger.level.debug, logger.module.core, "Auth User Request: Fetch Account from Buffer Requested.", result);
                        //console.log("requested account from buffer:", result.accountObj);
                        result = resultFromCall;
                        if (result.accountObj) {
                            result.account = result.accountObj.account;
                            that.client.set(account_key, JSON.stringify(result.accountObj));
                            //Account creation was succesful, create empty usage entry
                            that.client.set(usage_key, JSON.stringify({
                                bytesUsed: 0,
                                containers: []
                            }));
                            callback(null, result);
                        } else {
                            callback(result.statusCode, result);
                        }
                    });
                }
            },
            // call SL API to get access token.
            function(callback) {
                if (result.account) {
                    that.worker.getAccessToken(result, function(resultFromCall) {
                        result = resultFromCall;
                        callback(result.statusCode, result);
                    });
                } else {
                    /* At this point, we've tried everything, so account is
                     * not ready.
                     */
                    result.body = {};
                    result.statusCode = 503;
                    logger.log(logger.level.alert, logger.module.sl, "Auth User Request: Get Access Token Failed!", {result: result, status_code: 503});
                    callback(503, result);
                }
            } ], function(err, results) {
            if (!err) {
                returnResult.header["X-Auth-Token"] = result.token;
                returnResult.header["X-Storage-Url"] = result.rooturl;
                returnResult.statusCode = 200;
                logger.log(logger.level.debug, logger.module.sl, "Auth User Request: Get Access Token Successful", {result: returnResult, status_code: 200});
            } else {
                returnResult.statusCode = result.statusCode;
                returnResult.body = result.body;
                logger.log(logger.level.alert, logger.module.sl, "Auth User Request: Get Access Token Error!", {result: returnResult, err: err});
            }
            callback(returnResult);
        });
    };

    this.bind = function(req, res, callback) {
        var result = new exports.Result(), binding_key;
        if (!this.checkEmptyParams(req.params, "id,instance_id", callback)) {
            return;
        }

        binding_key = "B/" + req.params.instance_id + "/" + req.params.id;
        async.series([
        // create binding body
        function(callback) {
            result.req_body = req.body;
            result.instance_id = req.params.instance_id;
            result.id = req.params.id;
            that.newBinding(result, function(result) {
                result.body = result.binding;
                callback(result.statusCode, result);
            });
        },
        // persist the binding
        function(callback) {
            that.client.set(binding_key, JSON.stringify(result.binding));
            callback(result.statusCode, result);
        } ], function(err, results) {
            if (!err) {
                results[0].statusCode = 201;
                logger.log(logger.level.debug, logger.module.core, "Bind successful", results);
            } else {
                logger.log(logger.level.alert, logger.module.core, "Bind failed", results);
            }
            callback(results[0]);
        });
    };
    this.deleteAccount = function(req, res, callback) {
        logger.log(logger.level.debug, logger.module.sl, "Delete Softlayer Account");
        if (!this.checkEmptyParams(req.params, "account_id", callback)
                || !this.checkEmptyParams(req.body, "account_key,account_name", callback)) {
            return;
        }
        that.deleteSoftlayerAccount(req.params.account_id, req.body.account_key, function(result) {
            callback(result);
        }, req.body.account_name, true);
    };

    this.deleteSoftlayerAccount = function(billingItemId, accountKey, callback, account, forceCleanup) {
        logger.log(logger.level.debug, logger.module.sl, "Delete Softlayer Account", {billingItemId: billingItemId, accountKey: accountKey, account: account});
        var result = new exports.Result();
        callback = callback || function() {};
        account = account || "";
        result.billingItemId = billingItemId;
        that.worker.removeSLAccount(result, function(result) {
            var success = false;
            logger.log(logger.level.debug, logger.module.sl, "Delete Softlayer Account Result", result);
            if (result.statusCode) {
                logger.log(logger.level.alert, logger.module.sl, "Delete Softlayer Account Failed.", {account: account, billingItemId: billingItemId});
            } else {
                success = true;
                logger.log(logger.level.debug, logger.module.sl, "Delete Softlayer Account Successful.", {account: account, billingItemId: billingItemId});
            }
            if(forceCleanup === true || success === true) {
                // remove the account under A key
                that.client.del(accountKey);
                //remove the usage under US key
                that.client.del("US/" + accountKey.substring(3));
                // remove the order under O key
                that.client.del('O' + accountKey);
            }
            callback(result);
        });
    };
    this.unbind = function(req, res, callback) {
        var result = new exports.Result(), binding_key, usage_key, account_key;
        if (!this.checkEmptyParams(req.params, "id,instance_id", callback)) {
            return;
        }

        binding_key = "B/" + req.params.instance_id + "/" + req.params.id;
        account_key = "A" + binding_key + "/*";
        // Find all the account under this binding and remove the accounts
        //TODO: wait for this to finish before returning, because doing an unbind + deprovision at the same time will attempt to delete S/L accounts twice, due to lag.
        this.client.keys(account_key, function(err, reply) {
            reply.forEach(function(value) {
                that.client.get(value, function(err, reply) {
                    if (!err && reply) {
                        var account = JSON.parse(reply);
                        that.deleteSoftlayerAccount(account.billingItemId || account.bllingItemId, value, null,
                                account.account);
                    }
                });
            });
        });

        // Remove the binding itself.
        this.client.del(binding_key, function(err, reply) {
            if (!err && reply) {
                result.body = {};
                result.statusCode = 200;
                logger.log(logger.level.debug, logger.module.core, "Unbind successful", result);
            } else {
                result.statusCode = 410;
                result.body = {
                    "msg": "Bad request!"
                };
                logger.log(logger.level.error, logger.module.core, "Unbind failed", result);
            }

            callback(result);
        });
    };

    this.provision = function(req, res, callback) {
        var result = new exports.Result();
        if (!this.checkEmptyParams(req.params, "instance_id", callback)) {
            return;
        }
        var service_instance_key = "S/" + req.params.instance_id;
        async.series([ function(callback) {
            result.req_body = req.body;
            that.client.get(service_instance_key, function(err, reply) {
                if (err) {
                    result.statusCode = 400;
                    result.body = {
                        msg: JSON.stringify(err)
                    };
                } else if (reply) {
                    result.statusCode = 409;
                    result.body = {
                        msg: "Service already exists."
                    };
                }
                callback(result.statusCode, result);
            });
        }, function(callback) {
            that.client.set(service_instance_key, JSON.stringify(result.req_body), function(err, reply) {
                callback(result.statusCode, result);
            });
        }, function(callback) {
            var service_state_key = "SS/" + req.params.instance_id;
            that.client.set(service_state_key, JSON.stringify(true), function(err, reply) {
                callback(result.statusCode, result);
            });
        } ], function(err, results) {
            if (!err) {
                results[0].statusCode = 201;
                results[0].body = {
                    dashboard_url: protocol + that.vcap_app.uris[0] + "/v2/service_instances/" + req.params.instance_id
                };
                logger.log(logger.level.debug, logger.module.core, "Provision successful", results);
            } else {
                logger.log(logger.level.alert, logger.module.core, "Provision failed", {results: results, err: err});
            }
            callback(results[0]);
        });
    };

    this.getAllRedisInfo = function(wildcard, callback, result, isList) {
        var keys_processed = 0, lastCall = function(l_callback) {
            if (--keys_processed === 0) {
                l_callback();
            }
        };
        var processObject = function(key, reply) {
            var value = JSON.parse(reply), splitKey = key.split("/"), exists, object;
            if (wildcard === "S/*") {
                result.body.services.push({
                    id: splitKey[1],
                    plan: value.plan_id,
                    org: value.organization_guid,
                    space: value.space_guid,
                    status: "unkwnown" //initialize with bad default in case SS key is missing for this service.
                });
            } else if (wildcard === "AB/*") { //we have value, now check what object we're dealing with, and save pertinent information in result obj
                exists = result.body.bindings.some(function(binding) {
                    return binding.id === splitKey[1] && binding.app === splitKey[2];
                });
                object = {
                    account_key: key,
                    id: splitKey[1],
                    app: splitKey[2],
                    user: splitKey[3],
                    account: value.account,
                    orderItem: value.orderItemId,
                    accountId: value.id,
                    billingItem: value.billingItemId || value.bllingItemId
                };
                if (exists) {
                    result.body.instances.push(object);
                } else if (splitKey[2] === "GLOBAL") {
                    result.body.global_accounts.push(object);
                } else {
                    result.body.orphaned_accounts.push(object);
                }
            } else if (wildcard === "SL_BUFFER") { //we have value, now check what object we're dealing with, and save pertinent information in result obj
                result.body.buffer_accounts.push({
                    account: value.account,
                    orderItem: value.orderItemId,
                    accountId: value.id,
                    billingItem: value.billingItemId || value.bllingItemId
                });
            } else if (wildcard === "B/*") { //we have value, now check what object we're dealing with, and save pertinent information in result obj
                result.body.bindings.push({
                    id: splitKey[1],
                    app: splitKey[2]
                });
            } else if (wildcard === "OAB/*") {
                exists = result.body.orphaned_accounts.some(function(service) {
                    return service.id === splitKey[1] && service.app === splitKey[2];
                });
                if (!exists) {
                    exists = result.body.instances.some(function(service) {
                        return service.id === splitKey[1] && service.app === splitKey[2]
                                && service.user === splitKey[3];
                    });
                }
                if (!exists) {
                    result.body.orders_pending.push({
                        id: splitKey[1],
                        app: splitKey[2],
                        user: splitKey[3],
                        orderItem: value
                    });
                }
            } else if (wildcard === "SS/*") {
                result.body.services.some(function(service) {
                    if (service.id === splitKey[1]) {
                        service.status = value;
                    }
                });
            }
            lastCall(callback); //signal that we processed one key.
        };
        //Get all keys for given wildcard
        if (isList === true) {
            that.client.lrange(wildcard, 0, -1, function(err, reply) {
                keys_processed = reply.length;
                reply.forEach(function(value) { //loop through all objects in list
                    processObject(wildcard, value);
                });
            });
        } else {
            that.client.keys(wildcard, function(err, reply) {
                if (!err && reply) {
                    keys_processed = reply.length;
                    if (keys_processed === 0) { //special case, need to call callback if there are no keys since we won't enter the forEach loop
                        callback();
                    }
                    reply.forEach(function(key) { //loop through all keys and get their values
                        that.client.get(key, function(err, reply) {
                            processObject(key, reply);
                        });
                    });
                }
            });
        }
    };

    this.getadmin = function(req, res, callback) {
        var result = new exports.Result();
        result.header['Content-Type'] = 'text/html; charset=UTF-8';
        result.statusCode = 200;
        result.body = {
            instances: [],
            global_accounts: [],
            services: [],
            bindings: [],
            orders_pending: [],
            buffer_accounts: [],
            orphaned_accounts: []
        };
        var instances = "AB/*";
        var bindings = "B/*";
        var orders = "OAB/*";
        var services = "S/*";
        var status = "SS/*";
        var buffer_instances = "SL_BUFFER";
        async.series([ function(callback) {
            that.getAllRedisInfo(services, callback, result);
        }, function(callback) {
            that.getAllRedisInfo(bindings, callback, result);
        }, function(callback) {
            that.getAllRedisInfo(instances, callback, result);
        }, function(callback) {
            that.getAllRedisInfo(orders, callback, result);
        }, function(callback) {
            that.getAllRedisInfo(status, callback, result);
        }, function(callback) {
            that.getAllRedisInfo(buffer_instances, callback, result, true);
        } ], function(err) {
            if (err) {
                result.statusCode = 400;
                logger.log(logger.level.alert, logger.module.core, "Error getting Redis information", {result: result, err: err});
            }

            logger.log(logger.level.debug, logger.module.core, "Get Admin", result);
            callback(result);
        });

    };

    this.getprovision = function(req, res, callback) {
        var result = new exports.Result();
        if (req.params.instance_id === "") {
            result.statusCode = 400;
            result.body = {
                "msg": "No service id found in the request."
            };
            logger.log(logger.level.debug, logger.module.core, "Get Provision", result);
            callback(result);
            return;
        }

        var service_instance_key = "S/" + req.params.instance_id, bindings = [];
        var account_key = "AB/" + req.params.instance_id + "/*";
        var usage_key = "US/" + req.params.instance_id + "/*";
        var usage_timestamp_key = "US/" + req.params.instance_id;

        async.series([ function(callback) {
            that.client.get(service_instance_key, function(err, reply) {
                logger.log(logger.level.debug, logger.module.core, "Get Provision: Service instance retrieved:", reply);
                if (err) {
                    result.statusCode = 400;
                    result.body = {
                        msg: JSON.stringify(err)
                    };
                } else if (!reply) {
                    result.statusCode = 404;
                    result.body = {
                        msg: 'Instance can not be found.'
                    };
                } else {
                    result.body = {
                        msg: reply
                    };
                }
                callback(result.statusCode, result);
            });
        }, function(callback) {
            result.body.accounts = [];
            result.body.apps = {};
            result.body.appSize = 0;
            that.client.keys(account_key, function(err, reply) {
                if (!err && reply.length > 0) {
                    var keys_processed = reply.length;
                    var lastCall = function() {
                        keys_processed--;
                        if (keys_processed === 0) {
                            callback(result.statusCode, result);
                        }
                    };

                    reply.forEach(function(value) {
                        that.client.get(value, function(err, reply) {
                            var splitValue = value.split('/'), account_id;
                            if (splitValue[2] !== "GLOBAL") { //don't process instance wide shared account named GLOBAL
                                account_id = splitValue[3];
                                if (!err && reply) {
                                    var account = JSON.parse(reply);
                                    account.account_id = account_id;
                                    result.body.accounts.push(account);
                                }
                            }
                            lastCall();
                        });
                    });
                } else if (err) {
                    result.statusCode = 400;
                    callback(result.statusCode, result);
                } else {
                    // no error, the service does not have anything yet
                    logger.log(logger.level.debug, logger.module.core, "Get Provision: No accounts yet", result);
                    callback(null, result);
                }
            });
        }, function(callback) {
            that.client.get(usage_timestamp_key, function(err, reply) {
                if (!err && reply) {
                    result.body.timestamp = reply;
                }
                callback();
            });
        }, function(callback) {
            result.body.gbUsed = 0;
            that.client.keys(usage_key, function(err, reply) {
                if (!err && reply.length > 0) {
                    var keys_processed = reply.length;
                    var lastCall = function() {
                        keys_processed--;
                        if (keys_processed === 0) {
                            result.body.gbUsed = result.body.gbUsed.toFixed(2);
                            for ( var key in result.body.apps) {
                                if (result.body.apps.hasOwnProperty(key)) {
                                    result.body.apps[key].usage = result.body.apps[key].usage.toFixed(2);
                                }
                            }
                            callback(result.statusCode, result);
                        }
                    };
                    reply.forEach(function(value) {
                        that.client.get(value, function(err, reply) {
                            var splitValue = value.split('/'), usageJson = JSON.parse(reply), objects = 0;
                            var app_id = splitValue[2], gb = (usageJson.bytesUsed / 1073741824.0), account_id;
                            if (app_id === "GLOBAL") {
                                result.body.globalUserUsage = gb.toFixed(2);
                            } else {
                                account_id = splitValue[3];
                                if (!result.body.apps[app_id]) {
                                    result.body.apps[app_id] = {
                                        users: 0,
                                        usage: 0,
                                        name: app_id
                                    };
                                    result.body.appSize++;
                                }
                                result.body.apps[app_id].users++;
                                result.body.apps[app_id].usage += gb;
                                // result.body.containers = usageJson.containers;
                                usageJson.containers.forEach(function(container) {
                                    objects += container.count;
                                });
                                result.body.accounts.some(function(account) {
                                    if (account.account_id === account_id) {
                                        account.gbUsed = gb.toFixed(2);
                                        account.containers = usageJson.containers.length;
                                        account.objects = objects;
                                        result.body.gbUsed += gb;
                                        return true;
                                    }
                                });
                            }
                            lastCall();
                        });
                    });
                } else if (err) {
                    result.statusCode = 400;
                    callback(result.statusCode, result);
                } else {
                    // no error, the service does not have anything yet
                    logger.log(logger.level.debug, logger.module.core, "Get Provision: No accounts yet", result);
                    callback(null, result);
                }
            });
        } ], function(err, results) {
            if (!err) {
                results[0].header['Content-Type'] = 'text/html; charset=UTF-8';
                results[0].statusCode = 200;
                logger.log(logger.level.debug, logger.module.core, "Get Provision Successful", results);
            } else {
                logger.log(logger.level.error, logger.module.core, "Get Provision Failed", {results: results, err: err});
            }
            callback(results[0]);
        });
    };

    this.deprovision = function(req, res, callback) {
        var result = new exports.Result();
        if (!this.checkEmptyParams(req.params, "instance_id", callback)) {
            return;
        }
        var service_instance_key = 'S/' + req.params.instance_id;
        var account_key = "AB/" + req.params.instance_id + "/*";
        var usage_key = "US/" + req.params.instance_id + "*";

        // Find all the account under this service instance and remove those accounts
        this.client.keys(account_key, function(err, reply) {
            reply.forEach(function(value) {
                that.client.get(value, function(err, reply) {
                    if (!err && reply) {
                        var account = JSON.parse(reply);
                        that.deleteSoftlayerAccount(account.billingItemId || account.bllingItemId, value, null,
                                account.account);
                    }
                });
            });
        });
        this.client.keys(usage_key, function(err, reply) {
            reply.forEach(function(key) {
                logger.log(logger.level.debug, logger.module.core, "Deprovision: Delete usage key", {key: key});
                that.client.del(key);
            });
        });

        async.series([
        // retrieve the orderItemId from redis.
        function(callback) {
            that.client.get(service_instance_key, function(err, reply) {
                if (err) {
                    result.statusCode = 400;
                    result.body = {
                        msg: JSON.stringify(err)
                    };
                } else {
                    if (!reply) {
                        result.statusCode = 410;
                        result.body = {
                            msg: "Service does not exist."
                        };
                    } else {
                        result.order = JSON.parse(reply);
                    }
                }
                callback(result.statusCode, result);
            });
        },
        // remove the provisioned order from redis.
        function(callback) {
            that.client.del(service_instance_key, function(err, reply) {
                callback(err, result);
            });
        },
        // remove the instance state
        function(callback) {
            var service_state_key = 'SS/' + req.params.instance_id;
            that.client.del(service_state_key, function(err, reply) {
                callback(err, result);
            });
        } ], function(err, results) {
            if (!err) {
                results[0].statusCode = 200;
                logger.log(logger.level.debug, logger.module.core, "Deprovision Successful", results);
            } else {
                logger.log(logger.level.error, logger.module.core, "Deprovision Failed", {results: results, err: err});
            }
            callback(results[0]);
        });
    };

    this.changestate = function(req, res, callback) {
        var result = new exports.Result();
        if (!this.checkEmptyParams(req.params, "instance_id", callback)) {
            return;
        }

        var service_instance_key = "S/" + req.params.instance_id;
        async.series([
            function(callback) {
                result.req_body = req.body;
                if (result.req_body.enabled !== undefined
                        && (result.req_body.enabled === true || result.req_body.enabled === false)) {
                    that.asyncInstanceCheck(service_instance_key, result, callback);
                } else {
                    throw new Error('bad request body');
                }
            }, function(callback) {
                var service_state_key = "SS/" + req.params.instance_id;
                that.client.set(service_state_key, JSON.stringify(result.req_body.enabled), function(err, reply) {
                    callback(result.statusCode, result);
                });
            } ], function(err, results) {
            if (!err) {
                results[0].statusCode = 204;
                results[0].body = {};
                logger.log(logger.level.debug, logger.module.core, "Service instance state changed successfully!", results);
            } else {
                logger.log(logger.level.error, logger.module.core, "Service instance state change failed!", {results: results, err: err});
            }
            callback(results[0]);
        });
    };

    this.getstate = function(req, res, callback) {
        var result = new exports.Result();
        if (!this.checkEmptyParams(req.params, "instance_id", callback)) {
            return;
        }
        var service_state_key = "SS/" + req.params.instance_id;
        async.series([ function(callback) {
            that.client.get(service_state_key, function(err, reply) {
                if (err) {
                    result.statusCode = 400;
                    result.body = {
                        msg: JSON.stringify(err)
                    };
                } else if (!reply) {
                    result.statusCode = 404;
                    result.body = {
                        msg: 'Instance can not be found.'
                    };
                } else {
                    if (reply === 'true') {
                        result.body = {
                            'enabled': true,
                            'state': 'STARTED'
                        };
                    } else if (reply === 'false') {
                        result.body = {
                            'enabled': false,
                            'state': 'STOPPED'
                        };
                    }
                }
                callback(result.statusCode, result);
            });
        } ], function(err, results) {
            if (!err) {
                results[0].header['Content-Type'] = 'application/json; charset=UTF-8';
                results[0].statusCode = 200;
                logger.log(logger.level.debug, logger.module.core, "Get service instance state completed successfully!", results);
            } else {
                logger.log(logger.level.error, logger.module.core, "Get service instance state failed", {results: results, err: err});
            }
            callback(results[0]);
        });
    };

};

var REDIS_AUTH = null;

exports.getCredentials = function(name) {

    if (REDIS_AUTH) {
        return REDIS_AUTH;
    }

    if (process.env.VCAP_SERVICES) {
        var vcap_services = JSON.parse(process.env.VCAP_SERVICES);

        var vcap_service = vcap_services[name];

        if (vcap_service) {
            REDIS_AUTH = vcap_service[0].credentials;
        }
    }

    return REDIS_AUTH;
};

exports.getApp = function() {
    if (APP_ENV) {
        return APP_ENV;
    }
    var vcap_app = {};
    if (process.env.VCAP_APPLICATION) {
        vcap_app = JSON.parse(process.env.VCAP_APPLICATION);
        vcap_app['broker_username'] = process.env.broker_username || "swift";
        vcap_app['broker_password'] = process.env.broker_password || "secret";
        vcap_app['sso_clientid'] = process.env.sso_clientid || 'SwiftOnSoftLayer';
        vcap_app['sso_secret'] = process.env.sso_secret || 'Y7XY2acyEuL53vbj';
        vcap_app['api_key'] = process.env.api_key || "";
        vcap_app['user_name'] = process.env.user_name || "";
        vcap_app['access_point'] = process.env.access_point || "";
        vcap_app['redis_hostname'] = process.env.redis_hostname || "";
        vcap_app['redis_password'] = process.env.redis_password || "";
        vcap_app['redis_port'] = process.env.redis_port || "";
        vcap_app['service_name'] = process.env.service_name || "";
        vcap_app['service_id'] = process.env.service_id || "";
        vcap_app['plan_id'] = process.env.plan_id || "";
        return vcap_app;
    }
    APP_ENV = vcap_app;
    return APP_ENV;
};

var SSO_AUTH = null;

exports.getSSO = function() {
    return SSO_AUTH;
};

exports.setupSSO = function() {
    if (SSO_AUTH) {
        return SSO_AUTH;
    }
    var result = new exports.Result();
    var app = exports.getApp();
    var root_url = "";
    if (app) {
        //Add user-defined bluemix info endpoint to override -  'bluemix_info'
        if(process.env.bluemix_info_url && process.env.bluemix_info_url !== "") {
            root_url = process.env.bluemix_info_url;
        } else {
            root_url = "https://" + app.uris[0].replace(app.application_name, 'api') + "/info";
        }
    } else {
        setTimeout(exports.setupSSO, 500);
        return;
    }

    admin.setup(root_url, result, function(result) {
        if (!result.statusCode) {
            SSO_AUTH = result.body;
        } else {
            //Did not get the information, try again in 500ms.
            setTimeout(exports.setupSSO, 500);
        }
    });
};

var REDIS_CLIENT = null;
var LAST_REQUEST_TIME = Date.now();

exports.resetRedis = function() {
    var current_time = Date.now();
    if (current_time - LAST_REQUEST_TIME > 180000 && REDIS_CLIENT) {
        //console.log("Close redis client");
        REDIS_CLIENT.end();
        REDIS_CLIENT = null;
    }
    LAST_REQUEST_TIME = current_time;
};

exports.getRedisClient = function() {
    if (REDIS_CLIENT && REDIS_CLIENT.connected) {
        logger.log(logger.level.debug, logger.module.redis, "Redis client is connected.");
        return REDIS_CLIENT;
    } else if (REDIS_CLIENT) {
        logger.log(logger.level.debug, logger.module.redis, "Redis client was disconnected.");
        REDIS_CLIENT.end();
        REDIS_CLIENT = null;
    }
	var vcap_app = exports.getApp();
	auth = {
			"hostname": vcap_app.redis_hostname,
			"password": vcap_app.redis_password,
			"port": vcap_app.redis_port	
	};
    try {
        var redis_client = redis.createClient(auth.port, auth.hostname, {
            retry_max_delay: 250,
            connect_timeout: 50,
            max_attempts: 5,
            enable_offline_queue: false
        });
        if (auth.password !== '') {
            redis_client.auth(auth.password);
        }
        redis_client.on("error", function(err) {
            logger.log(logger.level.alert, logger.module.redis, "Redis service has encounted error.", {err: err});
            redis_client.end();
            REDIS_CLIENT = null;
        });
        redis_client.on("ready", function(err) {
            REDIS_CLIENT = redis_client;
            logger.log(logger.level.debug, logger.module.redis, "Redis is ready.");
        });
        redis_client.on("end", function(err) {
            //Potentially log err
            logger.log(logger.level.debug, logger.module.redis, "Redis ended connection.");
            REDIS_CLIENT = null;
        });
        redis_client.on("idle", function(err) {
            logger.log(logger.level.debug, logger.module.redis, "Redis is idle.");
        });
    } catch (ex) {
        REDIS_CLIENT = null;
        logger.log(logger.level.alert, logger.module.redis, "Redis service has encounted exception.", {ex: ex});
    }
    return REDIS_CLIENT;
};

exports.checkRedis = function(req, res, next) {
    exports.resetRedis();
    exports.getRedisClient();

    var tryNo = 4;
    function do_check() {
        tryNo--;
        if (tryNo > 0) {
            if (REDIS_CLIENT && REDIS_CLIENT.connected) {
                //console.log('Redis is ready and connected.');
                next();
            } else {
                setTimeout(do_check, 100);
            }
        } else {
            logger.log(logger.level.alert, logger.module.redis, "Redis is not ready!", {status_code: 503});
            res.send(503, 'Redis service is not available!');
        }
    }

    do_check();
};

/* This is the method to use basic authentication to authenticate the request
 * for CloudFoundry V2 API, such as provisioning, binding, unprovision, 
 * unbinding, etc. The username and password are kept in the vcap app since
 * these username and password can change based on the configuration.
 */
exports.basicAuthUser = function(req, callback) {
    var authheader = req.headers["authorization"];
    var vcap_app = exports.getApp();
    var authenticated = false;
    if (authheader) {
        var code = authheader.trim().substring(5).trim();
        var decoded = new Buffer(code || '', 'base64').toString('utf8');
        decoded = decoded.split(":");
        if (decoded[0] === vcap_app.broker_username && decoded[1] === vcap_app.broker_password) {
            authenticated = true;
        }
    }
    callback(authenticated);
};

// the token should expire in 20 minutes without activity
var bearerTokens = new timedcache.TimedCache(1200000);
// We setup the cleanup cache here, so that the cached items can be cleaned up.
// the cleanup method should run every 25 minutes.
setInterval(bearerTokens.cleanup, 1500000);

exports.setBearerToken = function(req, value) {
    bearerTokens.set(req.sessionID, value);
};

/* This is the method to use SSO to authenticate users already on Bluemix
 * Users who have Bluemix account can manage the service instances they own.
 * Here are the steps of doing that:
 *   Check if the bearer token exists in the session, if yes, it has been
 *   authenticated, return true. else return false.
 */
exports.SSOAuthUser = function(req, instance_id, callback) {
    if (bearerTokens.get(req.sessionID) === instance_id) {
        callback(true);
    } else {
        callback(false);
    }
};
