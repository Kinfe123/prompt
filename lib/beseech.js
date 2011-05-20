/*
 * beseech.js: Simple prompt for beseeching information from the command line 
 *
 * (C) 2010, Nodejitsu Inc.
 *
 */

var async = require('async'),
    colors = require('colors'),
    winston = require('winston'),
    stdio = process.binding('stdio');

//
// ### @private function capitalize (str)
// #### str {string} String to capitalize
// Capitalizes the string supplied.
//
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

var beseech = exports;

var logger = beseech.logger = new winston.Logger({
  transports: [
    new (winston.transports.Console)()
  ]
});
    
var started = false,
    paused = false,
    stdin, stdout;

//
// Create an empty object for the properties 
// known to the beseech prompt
//
beseech.properties = {};

//
// Setup the default winston logger to use 
// the `cli` levels and colors.
//
logger.cli();

//
// ### function start (stream)
// #### @stream {ReadableStream} **Optional** Readable stream to use for beseech
// Starts the prompt by listening to the appropriate events on the `stream` 
// supplied. If no `stream` is supplied, then `process.stdin` is used.
//
beseech.start = function (inStream, outStream) {
  if (started) {
    return;
  }
  
  stdin = inStream || process.openStdin();
  stdout = outStream || process.stdout;
  
  process.on('SIGINT', function () {
    stdout.write('\n');
    process.exit(1);
  })
    
  started = true;
  return beseech;
};

//
// ### function pause ()
// Pauses input coming in from stdin
//
beseech.pause = function () {
  if (!started || paused) {
    return;
  }
  
  stdin.pause();
  paused = true;
  return beseech;
};

//
// ### function resume ()
// Resumes input coming in from stdin 
//
beseech.resume = function () {
  if (!started || !paused) {
    return;
  }
  
  stdin.resume();
  paused = false;
  return beseech;
};

//
// ### function get (msg, [validator,] callback)
// #### @msg {Array|Object|string} Set of variables to get input for.
// #### @callback {function} Continuation to pass control to when complete.
// Gets input from the user via stdin for the specified message(s) `msg`.
//
beseech.get = function (msg, callback) {
  var vars = !Array.isArray(msg) ? [msg] : msg,
      result = {};
  
  vars = vars.map(function (v) {
    if (typeof v === 'string') {
      v = v.toLowerCase();
    }
    
    return beseech.properties[v] || v;
  });
  
  function get(target, next) {
    beseech.getInput(target, function (err, line) {
      if (err) {
        return next(err);
      }
      
      var name = target.name || target;
      result[name] = line;
      next();
    });
  }
  
  async.forEachSeries(vars, get, function (err) {
    return err ? callback(err) : callback(null, result);
  });
};

//
// ### function getInput (msg, validator, callback)
// #### @msg {Object|string} Variable to get input for.
// #### @callback {function} Continuation to pass control to when complete.
// Gets input from the user via stdin for the specified message `msg`.
//
beseech.getInput = function (prop, callback) {
  var name   = prop.message || prop.name || prop,
      raw    = ['prompt', ': ' + name.grey, ': '.grey],
      read   = prop.hidden ? beseech.readLineHidden : beseech.readLine,
      length, msg;
  
  if (prop.default) {
    raw.splice(2, -1, ' (' + prop.default + ')');
  }
  
  // Calculate the raw length and colorize the prompt
  length = raw.join('').length;
  raw[0] = raw[0];
  msg = raw.join('');
  
  if (prop.help) {
    prop.help.forEach(function (line) {
      logger.help(line);
    });
  }
  
  // Writes default message to the terminal?
  stdout.write(msg); 
  read.call(null, function (err, line) {
    if (err) {
      return callback(err);
    }
    
    if (!line || line === '') {
      line = prop.default || line;
    }
    
    if (prop.validator) {
      var valid = prop.validator.test 
        ? prop.validator.test(line)
        : prop.validator(line);
      
      if (!valid) {
        logger.error('Invalid input for ' + name.grey);
        if (prop.warning) {
          logger.error(prop.warning);
        }

        return beseech.getInput(prop, callback);
      }
    }
        
    logger.input(line.yellow);
    callback(null, line);
  });

  return beseech;
};

//
// ### function addProperties (obj, properties, callback) 
// #### @obj {Object} Object to add properties to
// #### @properties {Array} List of properties to get values for
// #### @callback {function} Continuation to pass control to when complete.
// Prompts the user for values each of the `properties` if `obj` does not already
// have a value for the property. Responds with the modified object.  
//
beseech.addProperties = function (obj, properties, callback) {
  properties = properties.filter(function (prop) {
    return typeof obj[prop] === 'undefined';
  });
  
  if (properties.length === 0) {
    return callback(obj);
  }
  
  beseech.get(properties, function (err, results) {
    if (err) {
      return callback(err);
    }
    else if (!results) {
      return callback(null, obj);
    }
    
    function putNested (obj, path, value) {
      var last = obj, key; 
      
      while (path.length > 1) {
        key = path.shift();
        if (!last[key]) {
          last[key] = {};
        }
        
        last = last[key];
      }
      
      last[path.shift()] = value;
    }
    
    Object.keys(results).forEach(function (key) {
      putNested(obj, key.split('.'), results[key]);
    });
    
    callback(null, obj);
  });
};

//
// ### function readLine (callback)
// #### @callback {function} Continuation to respond to when complete
// Gets a single line of input from the user. 
//
beseech.readLine = function (callback) {
  var value = '', buffer = '';
  beseech.resume();
  stdin.setEncoding('utf8');
  stdin.on('error', callback);
  stdin.on('data', function data (chunk) {
    value += buffer + chunk;
    buffer = '';
    value = value.replace(/\r/g, '');
    if (value.indexOf('\n') !== -1) {
      if (value !== '\n') {
        value = value.replace(/^\n+/, '');
      }
      
      buffer = value.substr(value.indexOf('\n'));
      val = value.substr(0, value.indexOf('\n'));
      beseech.pause();
      stdin.removeListener('data', data);
      stdin.removeListener('error', callback);
      value = value.trim();
      callback(null, value);
    }
  });
};

//
// ### function readLineHiggen (callback)
// #### @callback {function} Continuation to respond to when complete
// Gets a single line of hidden input (i.e. `rawMode = true`) from the user. 
//
beseech.readLineHidden = function (callback) {
  var value = '', buffer = '';
  stdio.setRawMode(true);
  beseech.resume();
  stdin.on('error', callback);
  stdin.on('data', function data (c) {
    c = '' + c;
    switch (c) {
      case '\n': case '\r': case '\r\n': case '\u0004':
        stdio.setRawMode(false);
        stdin.removeListener('data', data);
        stdin.removeListener('error', callback);
        value = value.trim();
        stdout.write('\n');
        stdout.flush();
        beseech.pause();
        return callback(null, value)
      case '\u0003': case '\0':
        stdout.write('\n');
        process.exit(1);
        break;
      default:
        value += buffer + c
        buffer = '';
        break;
    }
  });
};