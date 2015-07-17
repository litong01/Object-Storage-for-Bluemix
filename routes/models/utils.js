/**
 * Copyright 2014 IBM Corp.
 */

var crypto = require("crypto");
var request = require("request");

exports.addToken = function(headers, token) {
    if (!headers) {
        headers = {};
    }
    headers['X-Auth-Token'] = token;
    return headers;
};

exports.encrypt = function(text) {
    var shasum = crypto.createHash('sha1');
    shasum.update(text);
    return shasum.digest('hex');
};

var admin_requests = {};

exports.saveRequest = function(req) {
    var req_key = exports.getReqKey(req);
    if (!admin_requests[req_key]) {
        admin_requests[req_key] = {
            path: req.path,
            query: req.query,
            sessionID: req.sessionID
        };
    }
    return req_key;
};

exports.getReqText = function(req) {
    return req.path + '==' + req.sessionID;
};

exports.getReqKey = function(req) {
    return exports.encrypt(exports.getReqText(req));
};

exports.getRequest = function(req) {
    return admin_requests[exports.getReqKey(req)];
};

exports.getReqByState = function(state) {
    return admin_requests[state];
};

/*
 * this method is to verify the request to make sure that the request has been
 * authenticated with SSO. It checks the following:
 *    1. request coming with a state parameter
 *    2. parameter state value is used to retrieve the saved request state.
 *    3. the string of saved request state and the sessionID combination are
 *       encrypted by using an encryption key, the results matches the state as
 *       a string.
 *    4. the sessionID of the current request is the same as the saved request
 *       sessionID.
 */
exports.verifyState = function(req, state) {
    //Notice that the req below is not the true request object. It is an
    //object saved from earlier request for that request state.
    var saved_req = admin_requests[state];
    if (saved_req && req) {
        var encrypted = exports.getReqKey(saved_req);
        if (state === encrypted && req.sessionID === saved_req.sessionID) {
            return true;
        } else {
            return false;
        }
    } else {
        return false;
    }
};
