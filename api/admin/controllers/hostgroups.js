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
const common = require('../../common');

function canedit(user, hostgroup) {
    if(user) {
        if(user.scopes.mca && ~user.scopes.mca.indexOf('admin')) return true;
        if(~hostgroup.admins.indexOf(user.sub.toString())) return true;
    }
    return false;
}

router.get('/', jwt({secret: config.admin.jwt.pub, credentialsRequired: false}), function(req, res, next) {
    var find = {};
    if(req.query.find) find = JSON.parse(req.query.find);
    
    //we need to select admins , or can't get _canedit set
    var select = req.query.select;
    if(select && !~select.indexOf("admins")) select += " admins";

    db.Hostgroup.find(find)
    .select(select)
    .limit(parseInt(req.query.limit) || 100)
    .skip(parseInt(req.query.skip) || 0)
    .sort(req.query.sort || '_id')
    .lean() //so that I can add _canedit later
    .exec(function(err, hostgroups) {
        if(err) return next(err);
        db.Hostgroup.count(find).exec(function(err, count) { 
            if(err) return next(err);
            hostgroups.forEach(function(hostgroup) {
                hostgroup._canedit = canedit(req.user, hostgroup);
            });
            res.json({hostgroups: hostgroups, count: count});
        });
    }); 
});

router.delete('/:id', jwt({secret: config.admin.jwt.pub}), function(req, res, next) {
    db.Hostgroup.findById(req.params.id, function(err, hostgroup) {
        if(err) return next(err);
        if(!hostgroup) return next(new Error("can't find the hostgroup with id:"+req.params.id));
        
        async.series([
            
            //check access 
            function(cb) {
                if(canedit(req.user, hostgroup)) {
                    cb();
                } else {
                    cb("You don't have access to remove this hostgroup");
                }
            },
            
            //check foreign key dependencies
            function(cb) {
                db.Config.find({$or: [
                        {"tests.agroup": hostgroup._id},
                        {"tests.bgroup": hostgroup._id},
                    ]}, function(err, tests) {
                    if(err) return cb(err);
                    var names = "";
                    tests.forEach(function(test) { names+=test.name+", "; });
                    if(names == "") {
                        cb();
                    } else {
                        cb("You can not remove this hostgroup. It is currently used by "+names);
                    }
                }); 
            }

        ], function(err) {
            if(err) return next(err);
            //all good.. remove
            hostgroup.remove().then(function() {
                res.json({status: "ok"});
            }); 
        });

    });
});

router.put('/:id', jwt({secret: config.admin.jwt.pub}), function(req, res, next) {
    db.Hostgroup.findById(req.params.id, function(err, hostgroup) {
        if(err) return next(err);
        if(!hostgroup) return next(new Error("can't find a hostgroup with id:"+req.params.id));
        //only superadmin or admin of this test spec can update
        if(canedit(req.user, hostgroup)) {
            hostgroup.service_type = req.body.service_type;
            hostgroup.name = req.body.name;
            hostgroup.desc = req.body.desc;
            hostgroup.type = req.body.type; 
            hostgroup.hosts = req.body.hosts;
            hostgroup.host_filter = req.body.host_filter;
            hostgroup.admins = req.body.admins;
            hostgroup.update_date = new Date();
            hostgroup.save(function(err) {
                if(err) return next(err);
                hostgroup = JSON.parse(JSON.stringify(hostgroup));
                hostgroup._canedit = canedit(req.user, hostgroup);
                res.json(hostgroup);
            }).catch(function(err) {
                next(err);
            });
        } else return res.status(401).end();
    }); 
});

router.post('/', jwt({secret: config.admin.jwt.pub}), function(req, res, next) {
    if(!req.user.scopes.mca || !~req.user.scopes.mca.indexOf('user')) return res.status(401).end();
    db.Hostgroup.create(req.body, function(err, hostgroup) {
        if(err) return next(err);
        hostgroup = JSON.parse(JSON.stringify(hostgroup));
        hostgroup._canedit = canedit(req.user, hostgroup);
        res.json(hostgroup);
    });
});

router.get('/dynamic', jwt({secret: config.admin.jwt.pub}), function(req, res, next) {
    //TODO - let's allow anyone who is logged in.. (should limit more?)
    //if(!req.user.scopes.mca || !~req.user.scopes.mca.indexOf('user')) return res.status(401).end();
    common.dynamic.resolve(req.query.js, req.query.type, function(err, resp) {
        if(err) return next(err);
        res.json(resp);
    });
});

module.exports = router;

