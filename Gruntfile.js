/*
 * grunt-jstestdriver-phantomjs
 * https://github.com/tolu/grunt-jstestdriver-phantomjs
 *
 * Copyright (c) 2013 Tobias Lundin
 * Licensed under the MIT license.
 */
'use strict';
module.exports = function (grunt) {

    // Project configuration.
    grunt.initConfig({
        jshint: {
            all: [
                'tasks/*.js',
                'Gruntfile.js'
            ],
            options: {
                reporter: require('jshint-stylish'),
                jshintrc: '.jshintrc'
            }
        },
        jstdPhantom: {
            options: {
                useLatest: true
            },
            files: ["task-test/jsTestDriver_jstd.conf"]
        },
        watch: {
            scripts: {
                files: ['**/*.js'],
                tasks: ['jshint']
            },
            plugin: {
                files: ['tasks/*.js', 'task-test/*.js'],
                tasks: ['jstdPhantom']
            }
        }
    });

    grunt.loadTasks('tasks');

    grunt.loadNpmTasks('grunt-contrib-jshint');
    
    grunt.loadNpmTasks('grunt-contrib-watch');

    grunt.registerTask('default', ['jshint', 'jstdPhantom']);
};
