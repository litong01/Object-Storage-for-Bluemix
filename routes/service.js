/**
 * Copyright 2014 IBM Corp.
 */

var common = require('./models/common');
var usage = require('./models/usage');
var admin = require('./models/admin');
var utils = require('./models/utils');
var async = require("async");
var logger = require("./models/logger");


exports.welcome = function(req, res) {
    logger.log(logger.level.debug, logger.module.core, "Received request for welcome service.");

    var vcap_app = common.getApp();
    var doc_host = vcap_app.uris[0].replace(vcap_app.application_name, 'www');
    var doc_path = "https://" + doc_host + "/docs/#services/ObjectStorage/index.html#ObjectStorage";

    res.redirect(301, doc_path);
};

exports.renderPage = function(req, res, method, page) {
    var service = new common.Services(common.getRedisClient());
    var callback = function(result) {
        result.preRender(res);
        res.render(page, result);
    };
    service[method](req, res, callback);
};

exports.docs = function(req, res) {
    logger.log(logger.level.debug, logger.module.core, "Received request for docs service.");

    res.render('docs', {});
};

exports.catalog = function(req, res) {
    logger.log(logger.level.debug, logger.module.core, "Received request for catalog service.");

    exports.renderPage(req, res, "catalog", "catalog");
};

//XXX: Is this a bug, routing isn't correct?
exports.provision = function(req, res) {
    logger.log(logger.level.debug, logger.module.core, "Received request for provison service, which routes to catalog.");

    exports.renderPage(req, res, "catalog", "catalog");
};

exports.getprovision = function(req, res) {
    logger.log(logger.level.debug, logger.module.core, "Received request for getProvision service.");

    exports.renderPage(req, res, "getprovision", "getprovision");
};

exports.provision = function(req, res) {
    logger.log(logger.level.debug, logger.module.core, "Received request for provision service.");

    exports.renderPage(req, res, "provision", "json");
};

exports.deprovision = function(req, res) {
    logger.log(logger.level.debug, logger.module.core, "Received request for deProvision service.");

    exports.renderPage(req, res, "deprovision", "json");
};

exports.bind = function(req, res) {
    logger.log(logger.level.debug, logger.module.core, "Received request for bind service.");

    exports.renderPage(req, res, "bind", "json");
};

exports.unbind = function(req, res) {
    logger.log(logger.level.debug, logger.module.core, "Received request for unbind service.");

    exports.renderPage(req, res, "unbind", "json");
};

exports.changestate = function(req, res) {
    logger.log(logger.level.debug, logger.module.core, "Received request for changeState service.");

    exports.renderPage(req, res, "changestate", "json");
};

exports.getstate = function(req, res) {
    logger.log(logger.level.debug, logger.module.core, "Received request for getState service.");

    exports.renderPage(req, res, "getstate", "json");
};

exports.getadmin = function(req, res) {
    logger.log(logger.level.debug, logger.module.core, "Received request for getAdmin service.");

    exports.renderPage(req, res, "getadmin", "admin");
};

exports.deleteAccount = function(req, res) {
    logger.log(logger.level.debug, logger.module.core, "Received request for deleteAccount service.");

    exports.renderPage(req, res, "deleteAccount", "json");
};

exports.refreshcache = function(req, res) {
    logger.log(logger.level.debug, logger.module.core, "Received request for refreshCache service.");

    var result = new common.Result(201);
    usage.gatheringUsageData(function(usages) {
        usage.aggregateUsage(usages, function() {
            result.body.message = "Success";
            result.preRender(res);
            res.render("json", result);
        });
    }, req.params.instance_id);

};

/* This method is used to authenticate an app user so that the user can
 * login and start using Swift. If this is the very first time a user is
 * trying to get authenticated, then the account will be created, otherwise
 * the user will get a new access token from SoftLayer Swift.
 */
exports.authUser = function(req, res) {
    logger.log(logger.level.debug, logger.module.core, "Received request for authUser service.");

    exports.renderPage(req, res, "authUser", "auth");
};

/*
 * Same as auth user, but it's a shared, service instance wide account.
 */
exports.globalAuthUser = function(req, res) {
    logger.log(logger.level.debug, logger.module.core, "Received request for globalAuth service.");

    exports.renderPage(req, res, "authInstanceWideUser", "auth");
};
/* This method is used to authenticate CloudFoundry V2 API and admin web UI
 * request. For request to the admin web ui, the authentication will be SSO.
 * For request to the V2 API, the authentication will be Basic Authentication.
 */
exports.authenticate = function(req, res, next) {
    logger.log(logger.level.debug, logger.module.core, "Received request for authenticate service.");

    var is_admin_path = req.path.indexOf('/v2/service_instances') === 0;
    var is_action_path = is_admin_path && req.path.indexOf('action/') !== -1;
    var is_admin_page_path = req.path.indexOf('/v2/admin') === 0;
    var combined_admin = (req.method.toUpperCase() === 'GET' && is_admin_path ) || is_admin_page_path;
    if (combined_admin || is_action_path) {
        var elements = req.path.split('/');
        var instance_id = is_admin_page_path ? "ADMIN" : elements[3];
        common.SSOAuthUser(req, instance_id, function(result) {
            if (result) {
                next();
            } else {
                var state = utils.saveRequest(req);
                //Need to figure out the ace_config as in the request parameter
                var ace_config = {};
                if (req.query.ace_config) {
                    ace_config = JSON.parse(req.query.ace_config);
                }
                //need to redirect to the SSO login information
                var sso_info = common.getSSO();
                var vcap_app = common.getApp();
                if (sso_info && vcap_app) {
                    if (ace_config) {
                        var the_url = sso_info.authorization_endpoint;
                        var redirect_url = 'https://' + vcap_app.uris[0] + '/verify';
                        the_url += '/oauth/authorize?' + 'state=' + state + '&response_type=code&scope=openid' + '&client_id=' + vcap_app.sso_clientid + '&redirect_uri=' + redirect_url;
                        if (ace_config.spaceGuid) {
                            the_url += '&spaceid=' + ace_config.spaceGuid;
                        }
                        res.redirect(the_url);
                        logger.log(logger.level.debug, logger.module.core, "SSO Authorize Redirect URI" + the_url, {redirect_uri: the_url, status_code: 302});
                    } else {
                        logger.log(logger.level.warn, logger.module.core, "SSO Authorize URL cannot be constructed no ace config.", {status_code: 400});
                        res.send(400, 'Bad request');
                    }
                } else {
                    // Have not got the information yet. retry.
                    logger.log(logger.level.error, logger.module.core, "SSO info and VCAP information not available yet.", {status_code: 503});
                    res.send(503, 'Service was not ready, try again');
                }
            }
        });
    } else {
        common.basicAuthUser(req, function(result) {
            if (result) {
                logger.log(logger.level.debug, logger.module.core, "V2 API Authentication", {status_code: 200});
                next();
            } else {
                logger.log(logger.level.debug, logger.module.core, "V2 API Authentication", {status_code: 401});
                res.statusCode = 401;
                res.end("401");
            }
        });
    }
};

/* This method is the callback method for SSO. A user should be redirected to
 * SSO login site, once the user logs in, the user will be redirected back
 * at this method. In this method, we will check if the user has been
 * authenticated and have developer role. If the user does, then the session
 * gets validated.
 */
exports.verify = function(req, res) {
    logger.log(logger.level.debug, logger.module.core, "Received request for verify service (SSO Callback).");

    // We got the state back.
    if (req.query.state && utils.verifyState(req, req.query.state)) {
        // state is fine and verified. So we should be able to move on.
        // here according to the process, we need to get a bearer token.
        var sso_info = common.getSSO();
        var vcap = common.getApp();
        var access_token = null;
        var ori_req = utils.getReqByState(req.query.state);
        var isAdminUI = ori_req.path && ori_req.path.indexOf("/v2/admin") !== -1;
        var ace_config = {};
        if (ori_req.query.ace_config) {
            ace_config = JSON.parse(ori_req.query.ace_config);
        }
        async.series([
        //getSSOAccessToken
        function(callback) {
            var the_url = sso_info.token_endpoint + '/oauth/token';
            var auth_header = 'Basic ' + (new Buffer(vcap.sso_clientid + ':' + vcap.sso_secret).toString('base64'));
            var req_options = {
                uri: the_url,
                headers: {
                    'accept': 'application/json',
                    'content-type': 'application/x-www-form-urlencoded',
                    'authorization': auth_header
                },
                timeout: 100000,
                method: 'POST',
                form: {
                    client_id: vcap.sso_clientid,
                    grant_type: 'authorization_code',
                    code: req.query.code,
                    redirect_uri: 'https://' + vcap.uris[0] + '/verify'
                }
            };

            logger.log(logger.level.debug, logger.module.bluemix, "Getting SSO Token Request Options.", req_options);

            admin.doRequest(req_options, function(result) {

                logger.log(logger.level.debug, logger.module.bluemix, "Getting SSO Token Result.", result);

                if (result.statusCode === 200 && result.body.access_token) {
                    access_token = result.body.access_token;
                    callback(null, result);
                } else {
                    logger.log(logger.level.error, logger.module.bluemix, "Getting SSO Token: Failed.", result);
                    callback(true, {
                        body: result.error
                    });
                }
            });
        },
        //UserRoleCheck
        function(callback) {

            var the_url = sso_info.authorization_endpoint + '/rolecheck';
            the_url += '?space_guid=' + (isAdminUI ? vcap.space_id : ace_config.spaceGuid);
            the_url += '&role=developers';
            var auth_header = 'bearer ' + access_token;
            var req_options = {
                uri: the_url,
                headers: {
                    'accept': 'application/json',
                    'authorization': auth_header
                },
                timeout: 10000,
                method: 'GET'
            };

            logger.log(logger.level.debug, logger.module.bluemix, "User Role Check Request Options.", req_options);

            admin.doRequest(req_options, function(result) {

                logger.log(logger.level.debug, logger.module.bluemix, "User Role Check Result.", result);

                if (result.statusCode === 200 && result.body.hasaccess) {
                    if (ace_config.id) {
                        common.setBearerToken(req, ace_config.id);
                    } else if (isAdminUI) {
                        common.setBearerToken(req, "ADMIN");
                    }
                    callback(null, result);
                } else {
                    logger.log(logger.level.error, logger.module.bluemix, "User Role Check Failed.", result);
                    callback(true, {
                        body: result.error
                    });
                }
            });
        } ], function(err, results) {
            if (!err) {
                var originalUrl = 'https://' + vcap.uris[0] + ori_req.path;
                if (ori_req.query && ori_req.query.ace_config) {
                    originalUrl += "?ace_config=" + ori_req.query.ace_config;
                }
                res.redirect(originalUrl); //redirect back to initial URL, which will just load this time since we're SSO'd
            } else {
                logger.log(logger.level.error, logger.module.bluemix, "Get SSO Token and User Role Check Failed.", err);
                res.render('json', {
                    body: "You do not have permission!"
                });
            }
        });
    } else {
        //can not verify, show error.
        logger.log(logger.level.error, logger.module.bluemix, "SSO Callback failed, missing state.");
        res.render('json', {
            body: "Your credential can not be verified!"
        });
    }
};
