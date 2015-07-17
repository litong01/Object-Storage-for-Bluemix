/**
 * Copyright 2014 IBM Corp. SSO admin UI
 */

var request = require('request');
var logger = require('./logger');

function verify(req, res, callback) {
    callback(null);
}

function setup(root_url, result, callback) {
    var res_handler = function(err, res, body) {
        if (err) {
            logger.log(logger.level.error, logger.module.core, "Admin Setup Result Error.", {err: err, status_code: 400});
            result.statusCode = 400;
            result.body = {
                msg: JSON.stringify(err)
            };
        } else {
            try {
                result.body = JSON.parse(body);
                logger.log(logger.level.debug, logger.module.core, "Admin Setup Result Success.");
            } catch (ex) {
                logger.log(logger.level.error, logger.module.core, "Admin Setup Result Error.", {status_code: 503});
                result.statusCode = 503;
            }
        }

        logger.log(logger.level.debug, logger.module.core, "Admin Setup Result.", result);

        callback(result);
    };

    var req_options = {
        url: root_url,
        timeout: 100000,
        method: 'GET'
    };

    logger.log(logger.level.debug, logger.module.core, "Admin Setup Request Options.", req_options);

    request(req_options, res_handler);
}

/* The method to take a request option object and callback, then execute the 
 * http request, once the response comes back, if there is response body, it
 * will parse the response body as json and save the response body in a return
 * object named result. So the object will be something like this
 * 
 *    result.statusCode == 200
 *    result.json_body
 *    result.res_header
 *    result.error
 * 
 * The statusCode should be the statusCode returned from the request.
 */
function doRequest(req_options, callback) {
    var res_handler = function(error, res, body) {
        var result = {
            statusCode: 200,
            error: '',
            body: null,
            headers: null
        };
        if (res.statusCode === 200) {
            result.headers = res.headers;
            result.body = JSON.parse(body);
        } else {
            result.statusCode = res.statusCode;
            result.error = error;
        }
        callback(result);
    };

    request(req_options, res_handler);
}

module.exports = {
    verify: verify,
    doRequest: doRequest,
    setup: setup
};