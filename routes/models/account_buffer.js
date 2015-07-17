/**
 * Copyright 2014 IBM Corp.
 */

var request = require('request');
var async = require("async");
var common = require('./common');
var slcommon = require("./slcommon");
var logger = require("./logger");

//var buffer_size = 5; //how many "standby" account to keep in buffer to ensure rapid processing of new accounts
//after creating S/L account, need to fetch billing item info which takes time, need to poll
//var billing_item_retry = 10;  //how many times to poll
//var billing_item_poll_msecs = 12000; //how long to wait between polls

exports.fetchAccountFromBuffer = function(callback) {
    logger.log(logger.level.debug, logger.module.redis, "Fetch Account From Buffer.");

    var client = common.getRedisClient(), result = new common.Result(201);

    client.blpop("SL_BUFFER", 10, function(err, reply) {

        if(err) {
            logger.log(logger.level.error, logger.module.redis, "Popping SL Account from SL_Buffer Error.", err);
        } else {
            logger.log(logger.level.debug, logger.module.redis, "Popping SL Account from SL_Buffer.", reply);
        }

        if (!err && reply !== null && reply !== undefined) {
            //Buffer account found in reply variable
            //setTimeout(exports.setup, 0); //we assigned an account to an app, reprocess buffer
            result.statusCode = 200;
            result.accountObj = JSON.parse(reply[1]);
        }

        logger.log(logger.level.debug, logger.module.redis, "Popping SL Account from SL_Buffer Result.", result);
        callback(result);
    });

};

/**
 * This is replaced by the dedicated create buffer account microservice
 */
// exports.createBufferAccount = function(callback, account) {
//     logger.log(logger.level.debug, logger.module.sl, "Create Buffer Account.", account);

//     var client = common.getRedisClient(), result = new common.Result();
//     account = account || {};
//     callback = callback || function(account) {
//         logger.log(logger.level.debug, logger.module.sl, "Created Account.", account);
//     };
//     if (!client) {
//         logger.log(logger.level.error, logger.module.redis, "Redis service is not ready - Create Buffer Account.");
//         return;
//     }

//     var worker = new slcommon.SLWorker(common.getApp()), retries = 0;
//     var pollForAccountDetails = function(result) {
//         // account should have been created above, getting account id
//         worker.getSLBillingItemId(result, function(result) {
//             logger.log(logger.level.debug, logger.module.sl, "Getting billing item id result.", result);
//             if (result.billingItemId) {
//                 account = {
//                     account: result.account,
//                     orderItemId: result.orderItemId,
//                     id: result.id,
//                     billingItemId: result.billingItemId
//                 };
//                 client.lpush("SL_BUFFER", JSON.stringify(account));
//                 logger.log(logger.level.debug, logger.module.redis, "Push account to SL_BUFFER", account);
//                 //client.del("SL_BUFFER_ACCOUNTS/" + result.orderItemId);
//             } else if (++retries < billing_item_retry) {
//                 setTimeout(pollForAccountDetails, billing_item_poll_msecs, result);
//                 return;
//             } /* else {
//                 client.lpush("SL_BUFFER_PENDING_ORDERS", JSON.stringify(account));
//             } */
//             callback(result);
//         });
//     };
//     if (!account.orderItemId) {
//         worker.createSLAccount(result, function(result) {
//             logger.log(logger.level.debug, logger.module.sl, "Creating Softlayer Account.", result);
//             if (result.orderItemId) {
//                 account.orderItemId = result.orderItemId;
//                 //client.set("SL_BUFFER_ACCOUNTS/" + result.orderItemId, true);
//                 pollForAccountDetails(result);
//             } else {
//                 callback(result);
//             }
//         });
//     } else if (!account.billingItemId) {
//         result.orderItemId = account.orderItemId;
//         pollForAccountDetails(result);
//     } else {
//         callback(result);
//     }

// };

exports.setup = function() {
    var client = common.getRedisClient();
    
    if (!client) {
        logger.log(logger.level.warn, logger.module.redis, "Redis service is not ready - Account Buffer - Setup.");
        setTimeout(exports.setup, 500);
        return;
    }

    //var buffer_key = "SL_BUFFER", idx;
    /**
    client.llen(buffer_key, function(err, length) {
        logger.log(logger.level.debug, logger.module.redis, "Inspecting SL_BUFFER for accounts.", {keys: length});
        if (length < buffer_size) {
            logger.log(logger.level.warn, logger.module.redis, "Not enough SL_BUFFER accounts. Creating more.", {keys_to_create: (buffer_size - length)});
            for (idx = length; idx < buffer_size; idx++) {
                setTimeout(exports.createBufferAccount, 0, function(result) {
                    logger.log(logger.level.warn, logger.module.redis, "SL_BUFFER Account Create Status.", result);
                });
            }
        }/* else { //we are up to date on accounts, make sure they are setup correctly
            client.lrange(buffer_key, 0, -1, function(err, keys) {
                keys.forEach(function(key, index) {
                    setTimeout(exports.createBufferAccount, 0, function(result) {
                        console.log("HEY created buffer?", result);
                    }, JSON.parse(key), index);
                });
            });

        }*/
    //});
};
