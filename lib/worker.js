var cluster   = require('cluster'),
    axon      = require('axon'),
    rpc       = require('axon-rpc'),
    log       = require('debug')('Worker'),
    util      = require('util'),
    events    = require('events'),
    constants = require('./constants');

axon.codec.define('json', {
  encode: JSON.stringify,
  decode: JSON.parse
});

module.exports = function(opts) {
  var rpc_port = opts && opts.rpc_port || constants.RPC_PORT;
  var sub_port = opts && opts.sub_port || constants.PUB_PORT;
  return new Worker(rpc_port, sub_port);
};

// [Worker should send interface to master on ready look to [dnode](https://www.npmjs.org/package/dnode) for inspiration](#doing:0)
function Worker(rpcPort, subPort) {
  events.EventEmitter.call(this);

  var self = this;

  this.master = new events.EventEmitter();

  var sub_sock = this.sub_sock = axon.socket('sub');
  sub_sock.format('json');
  sub_sock.connect(subPort);
  sub_sock.on('message', function(msg) {
    self.master.emit(msg.type, msg.data);
  });

  var rpc_sock = this.req = axon.socket('req');
  this.client = new rpc.Client(rpc_sock);
  rpc_sock.connect(rpcPort);

  var generateMethods = function(cb) {
    log('Requesting and generating RPC methods');
    self.client.methods(function(err, methods) {
      Object.keys(methods).forEach(function(key) {
        var method_signature, md;
        method_signature = md = methods[key];

        log('+-- Creating %s method', md.name);

        (function(name) {
          self.master[name] = function() {
            log("calling:%s",name);
            var args = Array.prototype.slice.call(arguments);
            args.unshift(name);
            log("with args:%j", args);
            self.client.call.apply(self.client, args);
          };
        })(md.name);

      });
      return cb();
    });
  };

  var ready = function() {
    if (self.connected()) {
      generateMethods(function() {
        self.sendToPM2("process:ready","Ready to roll!");
        self.emit('ready');
      });
    }
  };

  rpc_sock.on('connect', function() {
    log('rpc_sock:ready');
    self.emit('rpc_sock:ready');
    ready();
  });

  rpc_sock.on('close', function() {
    log('rpc_sock:closed');
    self.emit('close');
  });

  rpc_sock.on('reconnect attempt', function() {
    log('rpc_sock:reconnecting');
    self.emit('reconnecting');
  });

  sub_sock.on('connect', function() {
    log('sub_sock ready');
    self.emit('sub_sock:ready');
    ready();
  });

  sub_sock.on('close', function() {
    log('sub_sock:closed');
    self.emit('closed');
  });

  sub_sock.on('reconnect attempt', function() {
    log('sub_sock:reconnecting');
    self.emit('reconnecting');
  });

  var gracefulShutdown = function() {
    try {
      sub_sock.close();
      rpc_sock.close();
    } catch (e) {}
  };

  // listen for TERM signal .e.g. kill 
  process.on ('SIGTERM', gracefulShutdown);

  // listen for INT signal e.g. Ctrl-C
  process.on ('SIGINT', gracefulShutdown);   
}

util.inherits(Worker, events.EventEmitter);

Worker.prototype.sendToPM2 = function(type, msg) {
  if (cluster.isWorker) process.send({type:type, msg:msg});
};

Worker.prototype.connected = function() {
  return (this.req.connected && this.sub_sock.connected);
};
