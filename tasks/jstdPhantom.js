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

    // npm lib
    var phantomjs = require('grunt-lib-phantomjs').init(grunt);

    grunt.registerTask(taskName, 'Grunt task for unit testing using JS Test Driver.', function () {

        var options = this.options({
                tests: 'all'
            }),
            config = grunt.config.get(taskName),
            done = this.async(),
            numberOfConfigs,
            numberOfPassedTests = 0,
            numberOfFailedTests = 0,
            failedTests = [];

        grunt.verbose.writeflags(options, 'Options');

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
            var cp;

            function setNumberOfPassesAndFails(result) {
                var resultAsStr = result.toString(),
                    passedReg = /\d+(?=;\sFails)/,
                    failsReg = /\d+(?=;\sErrors)/;

                if (resultAsStr && resultAsStr.indexOf('RuntimeException') === -1) {
                    numberOfPassedTests += parseInt(passedReg.exec(resultAsStr)[0], 10);
                    numberOfFailedTests += parseInt(failsReg.exec(resultAsStr)[0], 10);
                }
            }

            function hasFailedTests(result) {
                var prop, resultStr = "";

                for (prop in result) {
                    if (result.hasOwnProperty(prop)) {
                        resultStr += result[prop];
                    }
                }

                return resultStr.indexOf("Error:") > -1;
            }

            function processCompleteTests() {
                grunt.log.verbose.writeln('>> Finished running file: ' + configFileLocation);
                grunt.log.verbose.writeln('');

                numberOfConfigs -= 1;
                if (numberOfConfigs === 0) {
                    taskComplete();
                }
            }

            function onTestRunComplete(error, result) {

                setNumberOfPassesAndFails(result.stdout);

                if (error || hasFailedTests(result)) {
                    failedTests.push(result);
                    grunt.verbose.writeln('   ONE or MORE tests have failed in:');
                } else {
                    grunt.verbose.writeln(result);
                }

                processCompleteTests();
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

            var jarFile = __dirname + '\\..\\lib\\jstestdriver.jar';
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

            grunt.log.writeln('Starting jstd server...\n');
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

            function itDidntWork (msg) {
                grunt.log.writeln(msg);
                done(false);
            }

            function initPhantom (callback) {
                grunt.log.writeln("Starting PhantomJS...");

                var gotHeartbeat = false;
                phantomjs.on('onResourceReceived', function(request){

                    if(/\/capture$/.test(request.url) && request.status == 404){
                        itDidntWork('server did not respond');
                    }
                    if(/\/heartbeat$/.test(request.url) && !gotHeartbeat){
                        gotHeartbeat = true;
                        callback();
                    }

                });

                phantomjs.spawn("http://localhost:4224/capture", { options: {} });
            }

            function startTestRunner () {
                grunt.log.writeln("Running tests...\n");
                cp = grunt.util.spawn(jstdCmd, onTestRunComplete);
                cp.stdout.pipe(process.stdout);
                cp.stderr.pipe(process.stderr);
            }

            setTimeout(function(){

                if (!server.killed && !server.exitCode) {

                    initPhantom(startTestRunner);

                } else {
                    itDidntWork('failed to start server');
                }
            }, 5000);
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

};
