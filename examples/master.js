var hub     = require('../'),
    path   = require('path');

var master = hub.master({
 app_js : {
      "name"       : "hub-worker",
      "script"     : path.resolve(process.cwd(),"worker.js"),
      "instances"  : "max",
      "exec_mode"  : "cluster_mode",
      "env"        : { DEBUG : "*" }
  },
  rpc_methods :{
    doSomething: function(data, cb) {
      cb(null, "Doing something with... " + data);
    }
  }
});

master.on('ready', function(data) {
  console.log("Master-ready!", data);
  master.publish("workHarder", {one: 1, two:2, three:3});
});
