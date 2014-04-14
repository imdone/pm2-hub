// requires two entry points master and worker
// master should be started with pm2 and will start workers with given name
// master is the shared data store and can monitor workers
var util      = require('util'),
    events    = require('events'),
    _         = require('lodash'),
    log       = require('debug')('Master'),
    rpc       = require('axon-rpc'),
    axon      = require('axon'),
    constants = require('./constants');

try {
    console.log(require.resolve("pm2"));
    axon.codec.define('json', {
      encode: JSON.stringify,
      decode: JSON.parse
    });
} catch(e) {
    console.error("pm2 is not found");
    process.exit(e.code);
}

function Master(app_js, rpcInterface, rpcPort, pubPort) {

  events.EventEmitter.call(this);

  this.name =  app_js && app_js.name;

  var self    = this,
      ipm2    = this.ipm2   = require('pm2-interface')(),
      rep     = this.rep    = axon.socket('rep'),
      pub     = this.pub    = axon.socket('pub'),
      server  = this.server = new rpc.Server(rep);
      this.up = 0;

  // Connect to pm2 and start clustered app
  ipm2.on('ready', function() {
    log('Connected to pm2');
    
    // Start rpc server
    rep.bind(rpcPort);
    server.expose(rpcInterface);

    // Start the pub-sub server
    pub.format('json');
    pub.bind(pubPort);

    // Check if app with this.name is online
    if (app_js) {
      log('Checking for status of: ', self.name);
      ipm2.rpc.getMonitorData({}, function(err, dt) {
        var appData = _.find(dt, {name:self.name});
        if (appData) {
          log("appData:")
          log(JSON.stringify(appData, null, 5));
          log(appData.pm2_env.status);
        }

        if (appData && appData.pm2_env && appData.pm2_env.status == "online") {
          self.publish("master.ready", "Hub master is ready for action!");          
        } else if (appData && appData.pm2_env && appData.pm2_env.status == "stopped") {
          ipm2.rpc.restartProcessName(self.name, function(err, dt) {
            if (err) {
              log("Error encountered while starting app:", err);
              process.exit();
            }
          }); 
        } else {
          log("Starting app with pm2 json:", app_js);
          // Start the app
          ipm2.rpc.prepareJson(app_js, process.cwd(), function(err, dt) {
            if (err) {
              log("Error encountered while starting app:", err);
              process.exit();
            }
          });        
        }
      });
    }
  });

  // Wait for workers to be ready and emit ready when they are
  ipm2.bus.on('process:ready', function(data) {
    var pm2_env = data.process.pm2_env;
    var name = pm2_env.name;
    var msg = data.data.msg;
    var process = data.process.process;
    
    if (name == self.name) {
      self.up++;
    }
    if (self.up === pm2_env.instances) self.emit("ready", {pid:process.pid, msg:msg});
  });

  var gracefulShutdown = function() {
    try {
      rep.close();
      pub.close();
    } catch(e) {}
  };

  // listen for TERM signal .e.g. kill 
  process.on ('SIGTERM', gracefulShutdown);

  // listen for INT signal e.g. Ctrl-C
  process.on ('SIGINT', gracefulShutdown);   
}

util.inherits(Master, events.EventEmitter);

Master.prototype.publish = function(type, msg) {
  this.pub.send({type:type, data:msg});
};

module.exports = function(opts) {
  var app_js      = opts && opts.app_js      || null;
  var rpc_methods = opts && opts.rpc_methods || {} 
  var rpc_port    = opts && opts.rpc_port    || constants.RPC_PORT;
  var pub_port    = opts && opts.pub_port    || constants.PUB_PORT;

  return new Master(app_js, rpc_methods, rpc_port, pub_port);
};
