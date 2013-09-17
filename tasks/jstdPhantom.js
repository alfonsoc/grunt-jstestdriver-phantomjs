/*
 * grunt-jstestdriver-phantomjs
 * https://github.com/tolu/grunt-jstestdriver-phantomjs
 *
 * Copyright (c) 2013 Tobias Lundin
 * Licensed under the MIT license.
 */
'use strict';
module.exports = function (grunt) {

    var JSTDFLAGS_FLAGS = ['tests', 'verbose', 'captureConsole', 'preloadFiles', 'plugins', 'runnerMode', 'testOutput'];

    var taskName = "jstdPhantom";

    // Nodejs libs.
    var path = require('path');
    var Q = require('q');
    var http = require("http");

    // npm lib
    var phantomjs = require('grunt-lib-phantomjs').init(silentGrunt(grunt));

    grunt.registerTask(taskName, 'Grunt task for unit testing using JS Test Driver.', function () {

        var options = this.options({
                tests: 'all',
                timeout: 60000,
                retries: 1,
                port: 1025+Math.round(Math.pow(2, 12)*Math.random()) // [1025-5121]
            }),
            config = grunt.config.get(taskName),
            async = this.async(),
            numberOfConfigs,
            numberOfPassedTests = 0,
            numberOfFailedTests = 0,
            timeouts = [],
            childProcesses = [],
            jarFile = path.join(__dirname, '..', 'lib', 'jstestdriver.jar');

        grunt.verbose.writeflags(options, 'Options');

        function done(success) {
            // Don't let killed child processes do any logging
            grunt.util.hooker.hook(process.stdout, 'write', {
                pre: function(out) {
                    if (/(Running PhantomJS...|ERROR|>>.*0.*\[)/.test(out)) {
                        return grunt.util.hooker.preempt();
                    }
                }
            });
            killChildProcesses().then(function () {
                setTimeout(function() {
                    grunt.util.hooker.unhook(process.stdout, 'write');
                }, 3000);
                if (success === false) {
                    grunt.fail.warn(taskName +" task failed!");
                }
                async.apply(this, arguments);
            });
        }

        function killChildProcesses() {
            var deferred = Q.defer();

            function poll () {
                var killed = true;
                
                childProcesses.forEach(function (cp) {
                    killed = killed && (cp.killed || cp.exitCode !== null);
                });

                setTimeout(killed ? deferred.resolve : poll, 100);
            }

            // clear all timeouts
            timeouts.map(clearTimeout);

            // kill all child processes
            childProcesses.forEach(function (childProcess) {
                childProcess.kill('SIGKILL');
            });

            // wait for child processes to finish
            poll();

            // wait no more than 10s
            Q.delay(10000).then(deferred.resolve);

            return deferred.promise;
        }


        function taskComplete() {
            grunt.log.writeln('');
            var msg = 'Total Passed: ' + numberOfPassedTests + ', Fails: ' + numberOfFailedTests;

            if (numberOfFailedTests > 0) {
                grunt.log.error(msg);
                done(false);
            } else {
                grunt.log.ok(msg);
                done();
            }
        }

        function runJSTestDriver(configFileLocation, options) {

            function itDidntWork (msg) {
                grunt.log.writeln(msg);
                done(false);
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

            function startServer () {
                var deferred = Q.defer();

                grunt.log.write('Starting jstd server.');
                deferred.promise.then(function() {
                    grunt.log.writeln("");
                });

                var server = grunt.util.spawn({
                    cmd: 'java',
                    args: [
                        "-jar",
                        jarFile,
                        "--port",
                        options.port
                    ]
                }, function(error, result, code){
                    grunt.verbose.writeln(error);
                });

                childProcesses.push(server);

                function poll () {
                    grunt.log.write(".")

                    var httpOptions = {
                      host: 'localhost',
                      port: options.port,
                      path: '/',
                      method: 'GET'
                    };

                    var req = http.request(httpOptions, function(res) {
                        if (200 === res.statusCode) {
                            timeouts.push(setTimeout(deferred.resolve, 1000));
                        } else {
                            timeouts.push(setTimeout(poll, 100));
                        }
                    });

                    req.on('error', function(e) {
                        timeouts.push(setTimeout(poll, 1000));
                    });

                    // do request
                    req.end();
                }
                poll();

                return deferred.promise;
            }

            function startBrowser () {
                var deferred = Q.defer();

                grunt.log.writeln("Starting PhantomJS...");

                phantomjs.on('onResourceReceived', function(request){

                    if(/\/capture$/.test(request.url) && request.status == 404){
                        itDidntWork('server did not respond');
                    }
                    if(/\/heartbeat$/.test(request.url)){
                        deferred.resolve();
                    }

                });

                var phantom = phantomjs.spawn("http://localhost:" + options.port + "/capture", {
                    options: {},
                    done: function () {}
                });
                childProcesses.push(phantom);

                return deferred.promise;
            }

            function runTests () {
                var deferred = Q.defer();

                grunt.log.writeln("Running tests...\n");

                var jstdCmd = {
                    cmd: 'java',
                    args: ["-jar",
                           jarFile,
                           "--config",
                           configFileLocation,
                           '--reset',
                           '--server',
                           'http://localhost:' + options.port].concat(getOptionsArray(options))
                };

                var runner = grunt.util.spawn(jstdCmd, function (error, result) {
                    if (result && typeof result.stdout === "string") {
                        deferred.resolve(result.stdout);
                    }
                    else {
                        done(false);
                    }
                });

                runner.stdout.pipe(process.stdout);
                runner.stderr.pipe(process.stderr);

                childProcesses.push(runner);

                return deferred.promise;
            }

            function handleTestResults (result) {
                setNumberOfPassesAndFails(result);

                if (hasFailedTests(result)) {
                    grunt.verbose.writeln('   ONE or MORE tests have failed in:');
                }

                processCompleteTests();
            }

            function setNumberOfPassesAndFails(result) {
                var passedReg = /\d+(?=;\sFails)/,
                    failsReg = /\d+(?=;\sErrors)/;

                if (result && result.indexOf('RuntimeException') === -1) {
                    numberOfPassedTests += parseInt(passedReg.exec(result)[0], 10);
                    numberOfFailedTests += parseInt(failsReg.exec(result)[0], 10);
                }
            }

            function hasFailedTests(result) {
                return result.indexOf("Error:") > -1;
            }

            function processCompleteTests() {
                grunt.log.verbose.writeln('>> Finished running file: ' + configFileLocation);
                grunt.log.verbose.writeln('');

                numberOfConfigs -= 1;
                if (numberOfConfigs === 0) {
                    taskComplete();
                }
            }

            function onTimeout () {
                grunt.verbose.writeln("A Timeout has been triggered. Retries left: " + (options.retries-1));
                if (0 === options.retries--) {
                    grunt.log.error("Something took too long");
                    done(false);
                }
                else {
                    killChildProcesses().then(function() {
                        runJSTestDriver(configFileLocation, options)
                    });
                }
            }

            Q.delay(options.timeout).then(onTimeout);

            startServer().then(startBrowser).then(runTests).then(handleTestResults);
        }

        if (typeof config.files === 'string') {
            config.files = [config.files];
        }

        if (options.testOutput) {
            grunt.file.mkdir(options.testOutput);
        }

        numberOfConfigs = config.files.length;

        grunt.util.async.forEach(config.files, function (filename) {
            runJSTestDriver(filename, options);
        }.bind(this));
    });

    function silentGrunt(grunt) {
        var clonedGrunt = {};
        for (var key in grunt) {
            clonedGrunt[key] = grunt[key];
            if ("warn" === key) {
                clonedGrunt[key] = function() {};
            }
        }
        return clonedGrunt;
    }
};
