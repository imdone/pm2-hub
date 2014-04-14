var hub = require('../');
var worker = hub.worker();

worker.master.on('workHarder', function(message) {
  console.log(message);
});

worker.on('ready', function() {
  worker.master.doSomething("Realy cool data", function(err, data) {
    console.log(data);
  });
})