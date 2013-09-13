/*
 * grunt-jstestdriver-phantomjs
 * https://github.com/tolu/grunt-jstestdriver-phantomjs
 *
 * Copyright (c) 2013 Tobias Lundin
 * Licensed under the MIT license.
 */
'use strict';
module.exports = function (grunt) {

    var INVALID_FLAGS = ['browser', 'config', 'dryRunFor', 'port', 'server', 'serverHandlerPrefix', 'canFail'];

    var taskName = "jstdPhantom";

    // Nodejs libs.
    var path = require('path');
    var Q = require('q');

    // npm lib
    var phantomjs = require('grunt-lib-phantomjs').init(silentGrunt(grunt));

    grunt.registerTask(taskName, 'Grunt task for unit testing using JS Test Driver.', function () {

        var options = this.options({
                tests: 'all'
            }),
            config = grunt.config.get(taskName),
            async = this.async(),
            numberOfConfigs,
            numberOfPassedTests = 0,
            numberOfFailedTests = 0,
            failedTests = [],
            childProcesses = [],
            jarFile = path.join(__dirname, '..', 'lib', 'jstestdriver.jar');

        grunt.verbose.writeflags(options, 'Options');

        function done() {
            // Don't let killed child processes do any logging
            grunt.log.muted = true;
            killChildProcesses();
            setTimeout(function() {
                grunt.log.muted = false;
                async.apply(this, arguments);
            }, 1000);
        }

        function killChildProcesses() {
            childProcesses.forEach(function (childProcess) {
                childProcess.kill();
            });

        }

        function taskComplete() {

            grunt.log.writeln('');
            grunt.log.ok('Total Passed: ' + numberOfPassedTests + ', Fails: ' + numberOfFailedTests);

            if (failedTests.length > 0) {
                //grunt.fail.fatal(failedTests.join('\n\n'));
                done(false);
            } else {
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

                    if (INVALID_FLAGS.indexOf(name) === -1) {
                        arr.push("--" + name);
                        arr.push(options[name]);
                    } else {
                        grunt.verbose.writeln('WARNING - ' +
                            name + ' is not a valid config for use with the grunt-jstestdriver!');
                    }
                }

                return arr;
            }

            function startServer () {
                var deferred = Q.defer();

                grunt.log.writeln('Starting jstd server...');

                var server = grunt.util.spawn({
                    cmd: 'java',
                    args: [
                        "-jar",
                        jarFile,
                        "--port",
                        "4224"
                    ]
                }, function(error, result, code){
                    grunt.verbose.writeln(error);
                });

                childProcesses.push(server);

                // TODO: find a better way of knowing when the server is started. For now, just wait ...
                setTimeout(function(){
                    if (!server.killed && !server.exitCode) {

                        deferred.resolve();

                    } else {
                        itDidntWork('failed to start server');
                    }
                }, 5000);

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

                var phantom = phantomjs.spawn("http://localhost:4224/capture", {
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
                           'http://localhost:4224'].concat(getOptionsArray(options))
                };

                var runner = grunt.util.spawn(jstdCmd, function (error, result) {
                    if (error) {
                        done(false);
                    }
                    else {
                        deferred.resolve(result.stdout);
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
                    failedTests.push(result);
                    grunt.verbose.writeln('   ONE or MORE tests have failed in:');
                } else {
                    grunt.verbose.writeln(result);
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
