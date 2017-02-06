'use strict';

//contrib
const express = require('express');
const router = express.Router();
const winston = require('winston');
const jwt = require('express-jwt');
const async = require('async');

//mine
const config = require('../../config');
const logger = new winston.Logger(config.logger.winston);
const db = require('../../models');

function canedit(user, testspec) {
    if(user) {
        if(user.scopes.mca && ~user.scopes.mca.indexOf('admin')) return true; 
        if(~testspec.admins.indexOf(user.sub.toString())) return true;
    }
    return false;
}

router.get('/', jwt({secret: config.admin.jwt.pub, credentialsRequired: false}), function(req, res, next) {
    var find = {};
    if(req.query.find) find = JSON.parse(req.query.find);
    
    //we need to select admins , or can't get _canedit set
    var select = req.query.select;
    if(select && !~select.indexOf("admins")) select += " admins";

    db.Testspec.find(find)
    .select(select)
    .limit(parseInt(req.query.limit) || 100)
    .skip(parseInt(req.query.skip) || 0)
    .sort(req.query.sort || '_id')
    .lean() //so that I can add _canedit later
    .exec(function(err, testspecs) {
        if(err) return next(err);
        db.Testspec.count(find).exec(function(err, count) { 
            if(err) return next(err);
            //set _canedit flag for each specs
            testspecs.forEach(function(testspec) {
                testspec._canedit = canedit(req.user, testspec);
            });
            res.json({testspecs: testspecs, count: count});
        });
    }); 
});

router.delete('/:id', jwt({secret: config.admin.jwt.pub}), function(req, res, next) {
    //var id = parseInt(req.params.id);
    db.Testspec.findById(req.params.id, function(err, testspec) {
        if(err) return next(err);
        if(!testspec) return next(new Error("can't find a testspec with id:"+req.params.id));
        
        async.series([
            //check access 
            function(cb) {
                if(canedit(req.user, testspec)) {
                    cb();
                } else {
                    cb("You don't have access to remove this testspec");
                }
            },
            
            //check foreign key dependencies on test
            function(cb) {
                db.Config.find({"tests.testspec": testspec._id}, function(err, tests) {
                    if(err) return cb(err);
                    var names = "";
                    tests.forEach(function(test) {
                        names+=test.name+", ";
                    });
                    if(names == "") {
                        cb();
                    } else {
                        cb("You can not remove this testspec. It is currently used by "+names);
                    }
                }); 
            }

        ], function(err) {
            if(err) return next(err);
            //all good.. remove
            testspec.remove().then(function() {
                res.json({status: "ok"});
            }); 
        });
    });
});

//update
router.put('/:id', jwt({secret: config.admin.jwt.pub}), function(req, res, next) {
    db.Testspec.findById(req.params.id, function(err, testspec) {
        if(err) return next(err);
        if(!testspec) return next(new Error("can't find a testspec with id:"+req.params.id));
        if(!canedit(req.user, testspec)) return res.status(401).end();
        
        //do update fields
        testspec.service_type = req.body.service_type;
        testspec.name = req.body.name;
        testspec.desc = req.body.desc;
        testspec.specs = req.body.specs;
        testspec.admins = req.body.admins;
        testspec.update_date = new Date();
        testspec.save(function(err) {
            if(err) return next(err);
            testspec = JSON.parse(JSON.stringify(testspec));
            testspec._canedit = canedit(req.user, testspec);
            res.json(testspec);
        }).catch(function(err) {
            next(err);
        });
    }); 
});

router.post('/', jwt({secret: config.admin.jwt.pub}), function(req, res, next) {
    if(!req.user.scopes.mca || !~req.user.scopes.mca.indexOf('user')) return res.status(401).end();
    db.Testspec.create(req.body, function(err, testspec) {
        if(err) return next(err);
        testspec = JSON.parse(JSON.stringify(testspec));
        testspec._canedit = canedit(req.user, testspec);
        res.json(testspec);
    });
});

module.exports = router;

