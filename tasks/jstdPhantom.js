/*
 * grunt-jstestdriver-phantomjs
 * https://github.com/tolu/grunt-jstestdriver-phantomjs
 *
 * Copyright (c) 2013 Tobias Lundin
 * Licensed under the MIT license.
 */
'use strict';
module.exports = function (grunt) {

    var JSTDFLAGS_FLAGS = ['tests', 'verbose', 'captureConsole', 'preloadFiles', 'plugins', 'runnerMode', 'testOutput', 'basePath'];

    var _ = grunt.util._;

    // Nodejs libs.
    var path = require('path');
    var Q = require('q');
    var http = require("http");

    // npm lib
    var phantomjs = require('grunt-lib-phantomjs').init(silentGrunt(grunt));

    function done(success, task) {
        killChildProcesses(task).then(function () {
            if (success === false) {
                grunt.fail.warn(task.taskName +" task failed!");
            }
            task.async.apply(this, arguments);
        });
    }

    function killChildProcesses(task) {
        var deferred = Q.defer();

        // Don't let killed child processes do any logging
        grunt.util.hooker.hook(process.stdout, 'write', {
            pre: function(out) {
                if (/(Running PhantomJS...|ERROR|>>.*0.*\[)/.test(out)) {
                    return grunt.util.hooker.preempt();
                }
            }
        });
        deferred.promise.then(function () {
            setTimeout(function() {
                grunt.util.hooker.unhook(process.stdout, 'write');
            }, 3000);
        });

        function poll () {
            var success = _.every(task.childProcesses, function (cp) {
                return cp.killed || cp.exitCode !== null;
            });

            setTimeout(success ? deferred.resolve : poll, 100);
        }

        // clear all timeouts
        task.timeouts.map(clearTimeout);

        // kill all child processes
        _.invoke(task.childProcesses, 'kill', 'SIGKILL');

        // wait for child processes to finish
        poll();

        // wait no more than 10s
        Q.delay(10000).then(deferred.resolve);

        return deferred.promise;
    }

    function taskComplete(task) {
        grunt.log.writeln('');
        var msg = 'Total Passed: ' + task.numberOfPassedTests + ', Fails: ' + task.numberOfFailedTests;

        if (task.numberOfFailedTests > 0) {
            grunt.log.error(msg);
            setTimeout( function () {
              done(false, task)
            }, 500);
        } else {
            grunt.log.ok(msg);
            setTimeout( function () {
              done(true, task)
            }, 500);
        }
    }

    function itDidntWork (msg) {
        grunt.log.writeln(msg);
        done(false, task);
    }

    function getOptionsArray(options) {
        var names, name, i, l, arr = [];

        names = Object.getOwnPropertyNames(options);
        l = names.length;
        for (i = 0; i < l; i += 1) {
            name = names[i];

            if (JSTDFLAGS_FLAGS.indexOf(name) !== -1) {
                arr.push("--" + name);
                arr.push(options[name]);
            }
        }

        return arr;
    }

    function startServer (task) {
        var deferred = Q.defer();
        
        grunt.log.write('Starting jstd server.');
        deferred.promise.then(function() {
            grunt.log.writeln("");
        });

        var server = grunt.util.spawn({
            cmd: 'java',
            args: [
                "-jar",
                task.jarFile,
                "--port",
                task.options.port
            ]
        }, function(error, result, code){
            grunt.verbose.writeln(error);
        });

        task.childProcesses.push(server);

        function poll () {
            grunt.log.write(".")

            var httpOptions = {
              host: 'localhost',
              port: task.options.port,
              path: '/',
              method: 'GET'
            };

            var req = http.request(httpOptions, function(res) {
                if (200 === res.statusCode) {
                    task.timeouts.push(setTimeout(deferred.resolve, 1000));
                } else {
                    task.timeouts.push(setTimeout(poll, 100));
                }
            });

            req.on('error', function(e) {
                task.timeouts.push(setTimeout(poll, 1000));
            });

            // do request
            req.end();
        }
        poll();

        return deferred.promise;
    }

    function startBrowser (task) {
        var deferred = Q.defer(), resolved = false;

        grunt.log.writeln("Starting PhantomJS...");

        phantomjs.on('onResourceReceived', function(request){

            if(/\/capture$/.test(request.url) && request.status == 404){
                itDidntWork('server did not respond');
            }
            if(/\/heartbeat$/.test(request.url)){
                if (!resolved) {
                  deferred.resolve();
                  resolved = true;
                }
            }

        });

        var phantom = phantomjs.spawn("http://localhost:" + task.options.port + "/capture", {
            options: {},
            done: function () {}
        });
        task.childProcesses.push(phantom);

        return deferred.promise;
    }

    function fireTests (configFileLocation, task) {
        var deferred = Q.defer();

        grunt.log.writeln("Running tests...\n");

        var jstdCmd = {
            cmd: 'java',
            args: ["-jar",
                   task.jarFile,
                   "--config",
                   configFileLocation,
                   '--server',
                   'http://localhost:' + task.options.port].concat(getOptionsArray(task.options))
        };

        var runner = grunt.util.spawn(jstdCmd, function (error, result) {
            if (result && typeof result.stdout === "string") {
                deferred.resolve(result.stdout);
            }
            else {
                done(false, task);
            }
        });

        runner.stdout.pipe(process.stdout);
        if ((task.options.runnerMode || "").indexOf('DEBUG')+1)
          runner.stderr.pipe(process.stderr);

        task.childProcesses.push(runner);

        return deferred.promise;
    }

    function handleTestResults (result, configFileLocation, task) {
        setNumberOfPassesAndFails(result, task);

        if (hasFailedTests(result)) {
            grunt.verbose.writeln('   ONE or MORE tests have failed in:');
        }

        processCompleteTests(configFileLocation, task);
    }

    function setNumberOfPassesAndFails(result, task) {
        var passedReg = /\d+(?=;\sFails)/,
            failsReg = /\d+(?=;\sErrors)/;

        if (result && result.indexOf('RuntimeException') === -1) {
            task.numberOfPassedTests += parseInt(passedReg.exec(result)[0], 10);
            task.numberOfFailedTests += parseInt(failsReg.exec(result)[0], 10);
        }
    }

    function hasFailedTests(result) {
        return result.indexOf("Error:") > -1;
    }

    function processCompleteTests(configFileLocation, task) {
        grunt.log.verbose.writeln('>> Finished running file: ' + configFileLocation);
        grunt.log.verbose.writeln('');

        task.numberOfConfigs -= 1;
        if (task.numberOfConfigs === 0) {
            taskComplete(task);
        }
    }

    function onTimeout (configFileLocation, task) {
        grunt.verbose.writeln("A Timeout has been triggered. Retries left: " + (task.options.retries-1));
        if (0 === task.options.retries--) {
            grunt.log.error("Something took too long");
            done(false, task);
        }
        else {
            killChildProcesses(task).then(function() {
                task.callback(configFileLocation, task.options, task)
            });
        }
    }

    function runServer(configFileLocation, options, task) {

        return startServer(task)
    }

    function runBrowser(configFileLocation, options, task) {

        Q.delay(task.options.timeout).then(function () {
          onTimeout(configFileLocation, task)
        });

        return startBrowser(task).then(function () {
          return fireTests(configFileLocation, task)
        }).then(function (result) {
          return handleTestResults(result, configFileLocation, task)
        });
    }

    function runTests(configFileLocation, options, task) {

        Q.delay(task.options.timeout).then(function () {
          onTimeout(configFileLocation, task)
        });

        return fireTests(configFileLocation, task).then(function (result) {
          return handleTestResults(result, configFileLocation, task)
        });
    }

    function runServerAndBrowser(configFileLocation, options, task) {

        Q.delay(task.options.timeout).then(function () {
          onTimeout(configFileLocation, task)
        });

        return startServer(task).then(function () {
          return startBrowser(task)
        }).then(function () {
          return fireTests(configFileLocation, task)
        }).then(function (result) {
          return handleTestResults(result, configFileLocation, task)
        });
    }

    function silentGrunt(grunt) {
        var clonedGrunt = _.clone(grunt);
        clonedGrunt.warn = function() {};
        return clonedGrunt;
    }



    grunt.registerTask("jstdPhantom", 'Grunt task for unit testing using JS Test Driver.', function () {
        var task = {
          name: this.name, 
          async: this.async(),
          timeouts: [],
          childProcesses: [],
          options: this.options({
              tests: 'all',
              timeout: 60000,
              retries: 3,
              port: _.random(1025, 5000)
          }),
          config: grunt.config.get(this.name),
          numberOfConfigs: null,
          numberOfPassedTests: 0,
          numberOfFailedTests: 0,
          jarFile: path.join(__dirname, '..', 'lib', 'jstestdriver.jar'),
          callback: runServerAndBrowser
        }

        grunt.verbose.writeflags(task.options, 'Options');
        if (typeof task.config.files === 'string') {
            task.config.files = [task.config.files];
        }
        if (task.options.testOutput) {
            grunt.file.mkdir(task.options.testOutput);
        }
        task.numberOfConfigs = task.config.files.length;
        grunt.util.async.forEach(task.config.files, function (filename) {
            task.callback(filename, task.options, task);
        }.bind(this));
    });

    grunt.registerTask("jstdPhantomRun", 'Grunt task for firing JS Test Driver tests using PhantomJS.', function () {
        var task = {
          name: this.name, 
          async: this.async(),
          timeouts: [],
          childProcesses: [],
          options: this.options({
              tests: 'all',
              timeout: 60000,
              retries: 3,
              port: _.random(1025, 5000)
          }),
          config: grunt.config.get(this.name),
          numberOfConfigs: null,
          numberOfPassedTests: 0,
          numberOfFailedTests: 0,
          jarFile: path.join(__dirname, '..', 'lib', 'jstestdriver.jar'),
          callback: runBrowser
        }

        grunt.verbose.writeflags(task.options, 'Options');
        if (typeof task.config.files === 'string') {
            task.config.files = [task.config.files];
        }
        if (task.options.testOutput) {
            grunt.file.mkdir(task.options.testOutput);
        }
        task.numberOfConfigs = task.config.files.length;
        grunt.util.async.forEach(task.config.files, function (filename) {
            task.callback(filename, task.options, task);
        }.bind(this));
    });

    grunt.registerTask("jstdRun", 'Grunt task for firing JS Test Driver tests.', function () {
        var task = {
          name: this.name, 
          async: this.async(),
          timeouts: [],
          childProcesses: [],
          options: this.options({
              tests: 'all',
              timeout: 60000,
              retries: 3,
              port: _.random(1025, 5000)
          }),
          config: grunt.config.get(this.name),
          numberOfConfigs: null,
          numberOfPassedTests: 0,
          numberOfFailedTests: 0,
          jarFile: path.join(__dirname, '..', 'lib', 'jstestdriver.jar'),
          callback: runTests
        }

        grunt.verbose.writeflags(task.options, 'Options');
        if (typeof task.config.files === 'string') {
            task.config.files = [task.config.files];
        }
        if (task.options.testOutput) {
            grunt.file.mkdir(task.options.testOutput);
        }
        task.numberOfConfigs = task.config.files.length;
        grunt.util.async.forEach(task.config.files, function (filename) {
            task.callback(filename, task.options, task);
        }.bind(this));
    });

    grunt.registerTask("jstdServer", 'Grunt task for firing JS Test Driver server.', function () {
        var task = {
          name: this.name, 
          async: this.async(),
          timeouts: [],
          childProcesses: [],
          options: this.options({
              tests: 'all',
              timeout: 60000,
              retries: 3,
              port: _.random(1025, 5000)
          }),
          config: grunt.config.get(this.name),
          numberOfConfigs: null,
          numberOfPassedTests: 0,
          numberOfFailedTests: 0,
          jarFile: path.join(__dirname, '..', 'lib', 'jstestdriver.jar'),
          callback: runServer
        }

        grunt.verbose.writeflags(task.options, 'Options');
        if (typeof task.config.files === 'string') {
            task.config.files = [task.config.files];
        }
        if (task.options.testOutput) {
            grunt.file.mkdir(task.options.testOutput);
        }
        task.numberOfConfigs = task.config.files.length;
        grunt.util.async.forEach(task.config.files, function (filename) {
            task.callback(filename, task.options, task);
        }.bind(this));
    });
};
