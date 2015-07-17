/**
 * Copyright 2014 IBM Corp.
 */
var request = require('request');
var async = require("async");
var logger = require("./logger");

exports.SLWorker = function(vcap_app) {
    this.api_key = vcap_app.api_key;
    this.user_name = vcap_app.user_name;
    this.access_point = vcap_app.access_point;
    var that = this;

    this.getAccessToken = function(result, callback) {
        var response_handler = function(err, response, body) {
            if (err || response.statusCode !== 200) {
                result.statusCode = 401;
                result.body = {
                    msg: JSON.stringify(err)
                };

                logger.log(logger.level.error, logger.module.sl, "Softlayer Get Access Token Response Error1", result);

            } else {
                try {
                    result.rooturl = response.headers["x-storage-url"];
                    result.token = response.headers["x-auth-token"];
                    result.statusCode = null;
                } catch (e) {
                    result.statusCode = 401;
                    result.body = {
                        msg: JSON.stringify(e)
                    };

                    logger.log(logger.level.alert, logger.module.sl, "Softlayer Get Access Token Response Error2", result);

                }
            }

            logger.log(logger.level.debug, logger.module.sl, "Softlayer Get Access Token Response", result);

            callback(result);
        };

        //Validation, this method need account to proceed.
        if(this.isMissingParams("account", result, callback, 401)) {
            return;
        }


        var request_options = {
            url: that.access_point,
            headers: {
                'accept': 'application/json',
                'X-Auth-Key': that.api_key,
                'X-Auth-User': result.account + ":" + that.user_name
            },
            timeout: 100000
        };

        logger.log(logger.level.debug, logger.module.sl, "Softlayer Get Access Token Request", request_options);
        request(request_options, response_handler);
    };

    /**
     * Obsoleted by the account buffer refill microservices
     */
    // this.createSLAccount = function(result, callback) {
    //    var response_handler = function(err, response, body) {
    //         if (err) {
    //             result.statusCode = 202;
    //             result.body = {
    //                 msg: JSON.stringify(err)
    //             };

    //             logger.log(logger.level.alert, logger.module.sl, "Softlayer Create Account Error1", result);
    //         } else {
    //             try {
    //                 var order = JSON.parse(body);
    //                 result.orderItemId = null;
    //                 var items = order.placedOrder.items;
    //                 for ( var i = 0; i < items.length; i++) {
    //                     if (items[i].categoryCode === 'hub') {
    //                         result.orderItemId = items[i].id;
    //                         logger.log(logger.level.debug, logger.module.sl, "Softlayer Create Account Order Id Found", result);
    //                         break;
    //                     }
    //                 }
    //                 if (!result.orderItemId) {
    //                     result.statusCode = 202;
    //                     result.body = {
    //                         msg: "Provision orderItemID can not be found."
    //                     };
    //                 }
    //             } catch (e) {
    //                 result.statusCode = 400;
    //                 result.body = {
    //                     "msg": JSON.stringify(e)
    //                 };

    //                 logger.log(logger.level.error, logger.module.sl, "Softlayer Create Account Error2", result);
    //             }
    //         }

    //         logger.log(logger.level.debug, logger.module.sl, "Softlayer Create Account Result", result);

    //         callback(result);
    //     };

    //     var data = {
    //         "parameters": [ {
    //             "complexType": "SoftLayer_Container_Product_Order_Network_Storage_Hub",
    //             "quantity": 1,
    //             "packageId": "0",
    //             "prices": [ {
    //                 "id": 30920
    //             } ]
    //         } ]
    //     };

    //     var request_options = {
    //         url: "https://api.softlayer.com/rest/v3/SoftLayer_Product_Order/placeOrder.json",
    //         auth: {
    //             user: that.user_name,
    //             pass: that.api_key
    //         },
    //         headers: {
    //             'accept': 'application/json'
    //         },
    //         timeout: 100000,
    //         method: 'POST',
    //         body: JSON.stringify(data)
    //     };

    //     logger.log(logger.level.debug, logger.module.sl, "Softlayer Create Account Request", request_options);
    //     request(request_options, response_handler);
    // };

    this.removeSLAccount = function(result, callback) {
        var response_handler = function(err, response, body) {
            if (err) {
                result.statusCode = 400;
                result.body = {
                    msg: JSON.stringify(err)
                };

                logger.log(logger.level.error, logger.module.sl, "Softlayer Remove Account Response Error1", result);
            } else if (response.statusCode !== 200) {
                result.statusCode = response.statusCode;
                logger.log(logger.level.error, logger.module.sl, "Softlayer Remove Account Response Error2", result);
            }

            logger.log(logger.level.debug, logger.module.sl, "Softlayer Remove Account Response", result);
            callback(result);
        };

        //Validation, this method need billingItemId to proceed.
        if(this.isMissingParams("billingItemId", result, callback, 400)) {
            return;
        }

        var request_options = {
            url: "https://api.softlayer.com/rest/v3/SoftLayer_Billing_Item/" + result.billingItemId + "/cancelService",
            auth: {
                user: that.user_name,
                pass: that.api_key
            },
            headers: {
                'accept': 'application/json'
            },
            timeout: 100000,
            method: 'GET'
        };

        logger.log(logger.level.debug, logger.module.sl, "Softlayer Remove Account Request", request_options);
        request(request_options, response_handler);
    };

    /**
     * Obsoleted by the account buffer refill microservices
     */
    // this.getSLBillingItemId = function(result, callback) {
    //     var response_handler = function(err, response, body) {
    //         if (err) {
    //             result.statusCode = 202;
    //             result.body = {
    //                 msg: JSON.stringify(err)
    //             };

    //             logger.log(logger.level.alert, logger.module.sl, "Softlayer Get Billing Item Id Response Error1", result);
    //         } else {
    //             var items = JSON.parse(body);
    //             result.billingItemId = null;
    //             for ( var i = 0; i < items.length; i++) {
    //                 var item = items[i];
    //                 if (item.billingItem && result.orderItemId === item.billingItem.orderItemId) {
    //                     result.billingItemId = item.billingItem.id;
    //                     result.account = item.username;
    //                     result.id = item.id;
    //                     break;
    //                 }
    //             }
    //             if (!result.billingItemId) {
    //                 result.statusCode = 202;
    //                 result.body = {
    //                     msg: "billingItemId can not be found."
    //                 };
    //             }
    //         }
    //         logger.log(logger.level.debug, logger.module.sl, "Softlayer Get Billing Item Id Response Error1", result);
    //         callback(result);
    //     };

    //     //Validation, this method need orderItemId to proceed.
    //     if(this.isMissingParams("orderItemId", result, callback, 202)) {
    //         return;
    //     }

    //     var request_options = {
    //         url: 'https://api.softlayer.com/rest/v3.1/SoftLayer_Account'
    //                 + '/getHubNetworkStorage.json'
    //                 + '?objectMask=mask[id,username,billingItem[id,orderItemId]]'
    //                 + '&objectFilter={"hubNetworkStorage":{"billingItem":{"orderItemId":{"operation":"' + result.orderItemId + '"}}}}',
    //         auth: {
    //             user: that.user_name,
    //             pass: that.api_key
    //         },
    //         headers: {
    //             'accept': 'application/json'
    //         },
    //         timeout: 100000,
    //         method: 'GET'
    //     };

    //     logger.log(logger.level.debug, logger.module.sl, "Softlayer Get Billing Item Id Request", request_options);
    //     request(request_options, response_handler);
    // };

    //Replaced this by querying usage using token, comment out until we decide we fully don't need it
    /*this.getAccountUsage = function(result, callback) {
        var response_handler = function(err, response, body) {
            if (err) {
                result.statusCode = 400;
                result.body = {
                    msg: JSON.stringify(err)
                };
            } else {
                try {
                    result.bytesUsed = parseInt(body);
                } catch (ex) {
                    result.bytesUsed = 0;
                }
            }
            callback(result);
        };

        //Validation, this method need billingItemId to proceed.

        if (!result.id) {
            result.statusCode = 404;
            result.body = {
                msg: "billing item id was not set."
            };
            callback(result);
            return;
        }

        var request_options = {
            url: "https://api.softlayer.com/rest/v3/SoftLayer_Network_Storage/" + result.id + "/collectBytesUsed",
            auth: {
                user: that.user_name,
                pass: that.api_key
            },
            timeout: 100000,
            method: 'GET'
        };

        request(request_options, response_handler);
    };*/
    this.isMissingParams = function(param, result, callback, code) {
        if (!result[param]) {
            result.statusCode = code;
            result.body = {
                msg: param + " was not set"
            };
            logger.log(logger.level.error, logger.module.sl, "Softlayer Missing Param", result);
            callback(result);
            return true;
        }
    };
};
