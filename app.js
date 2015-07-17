/**
 * Copyright 2014 IBM Corp.
 */
require('newrelic');

var express = require('express');
var http = require('http');
var path = require('path');
var fs = require('fs');

var service = require('./routes/service');
var common = require('./routes/models/common');
var account_buffer = require('./routes/models/account_buffer');
var usage = require('./routes/models/usage');
var logger = require('./routes/models/logger');

var app = express();

// all environments
var port = (process.env.VCAP_APP_PORT || 3000);
var host = (process.env.VCAP_APP_HOST || 'localhost');
app.use(function(req, res, next){
	console.log(req.method, ' ', req.path);
	next();
});
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');
app.use(express.json());
app.use(express.urlencoded());
app.use(express.cookieParser('softlayerswift'));
app.use(express.session());
app.use(app.router);
app.use(express["static"](path.join(__dirname, 'public')));


app.use(function(err, req, res, next){
	if (err) {
		res.send(500, err.message);
	}
	else {
		next();
	}
});


app.all("/*", common.checkRedis);
app.all('/v2/*', service.authenticate);
app.all('/bluemix_v1/*', service.authenticate);


app.options('/', function(req, res) {
    res.writeHeader(400, {"Content-Length": 0});
    res.end();
});

app.get('/', service.welcome);
app.get('/v2/catalog', service.catalog);

app.put('/v2/service_instances/:instance_id/service_bindings/:id', service.bind);
app["delete"]('/v2/service_instances/:instance_id/service_bindings/:id', service.unbind);

app.get('/v2/service_instances/:instance_id', service.getprovision);

app.put('/v2/service_instances/:instance_id', service.provision);
app["delete"]('/v2/service_instances/:instance_id', service.deprovision);


app.put('/bluemix_v1/service_instances/:instance_id', service.changestate);
app.get('/bluemix_v1/service_instances/:instance_id', service.getstate);

//ADMIN only paths, can only be accessed by the owner of the object storage broker application (SSO enforced)

app.get('/v2/admin/services', service.getadmin);
app["delete"]('/v2/admin/services/account/:account_id', service.deleteAccount);

//the request to get an access token from SoftLayer for app users, the request
//should be sent by applications.
app.get('/auth/:instance_id/:id/:uid', service.authUser);

//the request to get an access token from SoftLayer for app users, the request
//should be sent by applications. This gets the global S/L account shared for all app bindings of single instance
app.get('/global_auth/:instance_id/:id', service.globalAuthUser);

//the request to refresh the usage cache that is being shown in the admin UI
app.post('/v2/service_instances/:instance_id/action/refresh', service.refreshcache);

//serve the docs request.
app.get('/docs', service.docs);

//the redirect back url for SSO provider to callback.
//this is the request which must have request query parameter named state.
app.get('/verify', service.verify);

if (host === 'localhost') {
	host = '0.0.0.0';
}

//Get redis client going.
common.getRedisClient();
//Setup SSO
common.setupSSO();
//Start up usage data posting task
//usage.postUsageData();

//Start up usage data posting task
account_buffer.setup();

//Log Level Environment
console.log("Log Level Activated: " + logger.getLevel());

//Log Environment
logger.log(logger.level.debug, logger.module.core, 'Process Environment Variables', process.env);

http.createServer(app).listen(port, host, function(){
	logger.log(logger.level.info, logger.module.core, 'Express server running on host: ' + host);
	logger.log(logger.level.info, logger.module.core, 'Express server listening on port: ' + port);
});
