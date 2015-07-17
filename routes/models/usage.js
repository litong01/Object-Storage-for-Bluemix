/**
 * Copyright 2014 IBM Corp.
 */

var request = require('request');
var async = require("async");
var common = require('./common');
var slcommon = require("./slcommon");

exports.gatheringUsageData = function(callback, instance_id) {

    var results = [];
    var saveResults = function(key_number, result) {
        if (key_number !== 0) {
            results.push(result);
        }
        // If the number of results we are getting is same as the keys, then
        // we have gathered all the results.
        if (key_number === results.length) {
            callback(results);
        }
    };

    var a_key = instance_id ? "AB/" + instance_id + "/*" : "AB/*";
    var client = common.getRedisClient();
    if (!client) {
        console.log('Redis service is not ready, will try again later.');
        setTimeout(exports.gatheringUsageData, 500, exports.aggregateUsage);
        return;
    }
    
    //Get all the account binding key and start getting the usage data
    client.keys(a_key, function(err, keys) {
        if (!err && keys) {
            if (keys.length === 0) {
                saveResults(0);
            }
            keys.forEach(function(key) {
                client.get(key, function(err, data) {
                    if (!err && data) {
                        data = JSON.parse(data);
                        var worker = new slcommon.SLWorker(common.getApp());
                        var result = new common.Result();
                        result.id = data.id;
                        result.account = data.account;
                        result.key = key;
                        async.series([ function(callback) {
                            worker.getAccessToken(result, function(tokens) {
                                result.rooturl = tokens.rooturl;
                                result.token = tokens.token;
                                callback();
                            });
                        }, function(callback) {
                            var request_options = {
                                url: result.rooturl,
                                headers: {
                                    'accept': 'application/json',
                                    "X-Auth-Token": result.token
                                },
                                timeout: 100000
                            };
                            result.containers = [];
                            request(request_options, function(error, response, body) {
                                result.bytesUsed = response.headers["x-account-bytes-used"];
                                if (body && body.length > 0) {
                                    JSON.parse(body).forEach(function(container) {
                                        result.containers.push(container);
                                    });
                                }
                                saveResults(keys.length, result);
                            });
                        } ]);

                    }
                });
            });
        }
    });
};

exports.aggregateUsage = function(results, refreshCallback, instance_id) {
    var usages = {};
    var client = common.getRedisClient();
    if (!client) {
        console.log('Redis service is not ready, will try again later.');
        return;
    }

    results.forEach(function(result) {
        if (result.statusCode == null) {
            var bindings = result.key.split('/');
            var serviceInstance = bindings[1], appInstance = bindings[2];
            var binding = usages[serviceInstance];
            var containerUsage = {
                bytesUsed: parseInt(result.bytesUsed, 10),
                containers: result.containers
            };
            var usage_key = "US/" + serviceInstance + "/" + appInstance;
            if(bindings.length > 3) {
                usage_key += "/" + bindings[3];
            }
            client.set(usage_key, JSON.stringify(containerUsage));

            if (!binding) {
                binding = {};
                binding[appInstance] = {
                    bytesUsed: result.bytesUsed
                };
                usages[serviceInstance] = binding;
            } else if (!binding[appInstance]) { // add check to avoid crashing when a service instance is bound by more than 1 app
                binding[appInstance] = {
                    bytesUsed: result.bytesUsed
                };
            } else {
                binding[appInstance].bytesUsed += result.bytesUsed;
            }
        }
    });

    if (refreshCallback) { //If we're just refreshing cache, we're done, no need to post usage
        client.set("US/" + instance_id, new Date().getTime()); //set timestamp of only the service that was refreshed.
        refreshCallback();
        return;
    }
    //set timestamp values of all services
    client.keys("S/*", function(err, reply) {
        reply.forEach(function(key) {
            client.set("US/" + key.split("/")[1], new Date().getTime());
        });
    });
    var start = new Date().getTime();
    var end = start;

    var service_instances = [];
    var service_keys = Object.keys(usages);
    var num_of_services = service_keys.length;
    var service_id = null;
    var saveServiceInstance = function(result) {
        if (result) {
            service_instances.push(result);
        }
        // If the number of results we are getting is same as the keys, then
        // we have gathered all the results.
        if (num_of_services === service_instances.length) {
            console.info('Ready to post');
            doPost(service_id, {
                service_instances: service_instances
            });
        }
    };

    service_keys.forEach(function(instance_id) {
        var redis_key = "S/" + instance_id;
        console.info('redis_key:', redis_key);
        client.get(redis_key, function(err, reply) {
            if (!err && reply) {
                var service = JSON.parse(reply);
                if (!service_id) {
                    service_id = service.service_id;
                }
                var service_instance = {
                    service_instance_id: instance_id,
                    usage: []
                };
                Object.keys(usages[instance_id]).forEach(function(app_id) {
                    var bytesInGB = parseInt(usages[instance_id][app_id].bytesUsed, 10) / 1073741824 | 0;
                    var usage_ins = {
                        start: start,
                        end: end,
                        organization_guid: service.organization_guid,
                        space_guid: service.space_guid,
                        consumer: {
                            type: "cloud_foundry_application",
                            value: app_id
                        },
                        resources: [ {
                            unit: 'GIGABYTE',
                            quantity: bytesInGB
                        } ]
                    };
                    service_instance.usage.push(usage_ins);
                });
                saveServiceInstance(service_instance);
            } else {
                num_of_services -= 1;
                saveServiceInstance(null);
            }
        });
    });
};

var doPost = function(service_id, body) {
    var app = common.getApp(), usageGateway;
    if (app.uris[0].indexOf("stage1.ng") !== -1) {
        usageGateway = "usagedatagateway";
    } else {
        usageGateway = "meteringinterface-provider";
    }
    var res_handler = function(err, res, body) {
        if (err || res.statusCode !== 201) {
            console.log('Usage data posting has failed!', res.statusCode);
        } else {
            console.log('Usage data posting has succeeded!', res.statusCode);
        }
    };
    var authValue = 'Basic ' + new Buffer(app.broker_username + ':' + app.broker_password).toString('base64');
    var endpoint = app.uris[0].replace(app.application_name, usageGateway);
    endpoint = endpoint.replace('mybluemix.net', 'ng.bluemix.net');
    endpoint = 'https://' + endpoint + '/v1/metering/services/' + service_id + '/usage';
    var req_options = {
        url: endpoint,
        headers: {
            'accept': 'application/json',
            'Authentication': authValue,
            'Authorization': authValue
        },
        timeout: 100000,
        body: JSON.stringify(body),
        method: 'POST'
    };

    console.log('Usage data posting request:', req_options);

    request(req_options, res_handler);
};

exports.postUsageData = function() {
    console.log('Setting up the usage posting service!');
    // Kick off the method immediately.
    exports.gatheringUsageData(exports.aggregateUsage);
    // Then set it up to run the method once every 15 minutes.
    setInterval(exports.gatheringUsageData, 1800000, exports.aggregateUsage);
};
