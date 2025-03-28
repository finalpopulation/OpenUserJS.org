'use strict';

// Define some pseudo module globals
var isPro = require('../libs/debug').isPro;
var isDev = require('../libs/debug').isDev;
var isDbg = require('../libs/debug').isDbg;

//

//--- Dependency inclusions
var async = require('async');
var _ = require('underscore');
var url = require('url');
var crypto = require('crypto');

//--- Model inclusions
var Discussion = require('../models/discussion').Discussion;
var Group = require('../models/group').Group;
var User = require('../models/user').User;
var Script = require('../models/script').Script;
var Strategy = require('../models/strategy').Strategy;

//--- Controller inclusions
var discussionLib = require('./discussion'); // NOTE: Project tree inconsistency

var getFlaggedListForContent = require('./flag').getFlaggedListForContent;

//--- Library inclusions
// var indexLib = require('../libs/index');

var getRedirect = require('../libs/helpers').getRedirect;

var modelParser = require('../libs/modelParser');
var modelQuery = require('../libs/modelQuery');

var execQueryTask = require('../libs/tasks').execQueryTask;
var removeSession = require('../libs/modifySessions').remove;
var pageMetadata = require('../libs/templateHelpers').pageMetadata;
var orderDir = require('../libs/templateHelpers').orderDir;
var statusCodePage = require('../libs/templateHelpers').statusCodePage;

//--- Configuration inclusions
var strategies = require('./strategies.json');

//---

// The site home page has scriptList, and groups in a sidebar
exports.home = function (aReq, aRes) {
  function preRender() {
    // scriptList
    options.scriptList = _.map(options.scriptList, modelParser.parseScript);

    // popularGroupList
    options.popularGroupList = _.map(options.popularGroupList, modelParser.parseGroup);

    // announcementsDiscussionList
    options.announcementsDiscussionList = _.map(options.announcementsDiscussionList,
      modelParser.parseDiscussion);

    // Pagination
    options.paginationRendered = pagination.renderDefault(aReq);

    // Empty list
    options.scriptListIsEmptyMessage = 'No scripts.';
    if (!!options.isFlagged) {
      if (options.librariesOnly) {
        options.scriptListIsEmptyMessage = 'No flagged libraries.';
      } else {
        options.scriptListIsEmptyMessage = 'No flagged scripts.';
      }
    } else if (options.searchBarValue) {
      if (options.librariesOnly) {
        options.scriptListIsEmptyMessage = 'We couldn\'t find any libraries with this search value.';
      } else {
        options.scriptListIsEmptyMessage = 'We couldn\'t find any scripts with this search value.';
      }
    } else if (options.isUserScriptListPage) {
      options.scriptListIsEmptyMessage = 'This user hasn\'t added any scripts yet.';
    }

    // Heading
    if (options.librariesOnly) {
      options.pageHeading = !!options.isFlagged ? 'Flagged Libraries' : 'Libraries';
    } else {
      options.pageHeading = !!options.isFlagged ? 'Flagged Userscripts' : 'Userscripts';
    }

    // Page metadata
    if (!!options.isFlagged) {
      if (options.librariesOnly) {
        pageMetadata(options, ['Flagged Libraries', 'Moderation']);
      } else {
        pageMetadata(options, ['Flagged Userscripts', 'Moderation']);
      }
    }
  }

  function render() {
    aRes.render('pages/scriptListPage', options);
  }

  function asyncComplete() {

    async.parallel([
      function (aCallback) {
        if (!!!options.isFlagged || !options.isMod) {  // NOTE: Watchpoint
          aCallback();
          return;
        }
        getFlaggedListForContent('Script', options, aCallback);
      }
    ], function (aErr) {
      // WARNING: No err handling

      preRender();
      render();
    });

  }

  //
  var options = {};
  var authedUser = aReq.session.user;
  var scriptListQuery = null;
  var pagination = null;
  var popularGroupListQuery = null;
  var announcementsDiscussionListQuery = null;
  var tasks = [];

  //
  options.librariesOnly = aReq.query.library !== undefined;

  // Page metadata
  pageMetadata(options, options.librariesOnly ? 'Libraries' : '');

  // Order dir
  orderDir(aReq, options, 'name', 'asc');
  orderDir(aReq, options, 'install', 'desc');
  orderDir(aReq, options, 'rating', 'desc');
  orderDir(aReq, options, 'updated', 'desc');

  // Session
  options.authedUser = authedUser = modelParser.parseUser(authedUser);
  options.isMod = authedUser && authedUser.isMod;
  options.isAdmin = authedUser && authedUser.isAdmin;

  // scriptListQuery
  scriptListQuery = Script.find().collation({ locale: 'en', strength: 3 });;

  // scriptListQuery: isLib
  modelQuery.findOrDefaultToNull(scriptListQuery, 'isLib', options.librariesOnly, false);

  // scriptListQuery: Defaults
  if (options.librariesOnly) {
    // Libraries
    modelQuery.applyLibraryListQueryDefaults(scriptListQuery, options, aReq);
  } else {
    // Scripts
    modelQuery.applyScriptListQueryDefaults(scriptListQuery, options, aReq);
  }

  // scriptListQuery: Pagination
  pagination = options.pagination; // is set in modelQuery.apply___ListQueryDefaults

  // popularGroupListQuery
  popularGroupListQuery = Group.find();
  popularGroupListQuery
    .sort('-size')
    .limit(25);

  // Announcements
  options.announcementsCategory = _.findWhere(discussionLib.categories, {slug: 'announcements'});
  options.announcementsCategory = modelParser.parseCategory(options.announcementsCategory);

  // announcementsDiscussionListQuery
  announcementsDiscussionListQuery = Discussion.find();
  announcementsDiscussionListQuery
    .and({category: options.announcementsCategory.slug})
    .sort('-updated')
    .limit(5);

  //--- Tasks

  // Pagination
  tasks.push(pagination.getCountTask(scriptListQuery));

  // scriptListQuery
  tasks.push(execQueryTask(scriptListQuery, options, 'scriptList'));

  // popularGroupListQuery
  tasks.push(execQueryTask(popularGroupListQuery, options, 'popularGroupList'));

  // announcementsDiscussionListQuery
  tasks.push(
    execQueryTask(announcementsDiscussionListQuery, options, 'announcementsDiscussionList'));

  //---
  async.parallel(tasks, asyncComplete);
};

// UI for user registration
exports.register = function (aReq, aRes) {
  //
  var options = {};
  var authedUser = aReq.session.user;
  var tasks = [];

  var SITEKEY = process.env.HCAPTCHA_SITE_KEY;

  // If already logged in, go back.
  if (authedUser) {
    aRes.redirect(getRedirect(aReq));
    return;
  }

  options.hasCaptcha = (SITEKEY ? SITEKEY : '');

  options.redirectTo = getRedirect(aReq);

  // Page metadata
  pageMetadata(options, 'Login');

  // Session
  options.authedUser = authedUser = modelParser.parseUser(authedUser);
  options.isMod = authedUser && authedUser.isMod;
  options.isAdmin = authedUser && authedUser.isAdmin;

  //
  options.wantname = aReq.session.username;
  delete aReq.session.username;
  delete aReq.session.newstrategy;

  //
  options.strategies = [];

  // Get OpenId strategies
  _.each(strategies, function (aStrategy, aStrategyKey) {
    if (!aStrategy.oauth) {
      options.strategies.push({
        'strat': aStrategyKey,
        'display': aStrategy.name,
        'disabled': aStrategy.readonly
      });
    }
  });

  //

  Strategy.find({}, function (aErr, aAvailableStrategies) {
    var SITEKEY = process.env.HCAPTCHA_SITE_KEY;
    var defaultCSP = ' https: \'self\'';
    var captchaCSP = (SITEKEY ? ' hcaptcha.com *.hcaptcha.com' : '');

    if (aErr || !aAvailableStrategies) {
      statusCodePage(aReq, aRes, aNext, {
        statusCode: 503,
        statusMessage:
          'We are experiencing technical difficulties right now. Please try again later.'
      });
    } else {
      // Get the strategies we have OAuth keys for
      aAvailableStrategies.forEach(function (aStrategy) {
        options.strategies.push({
          'strat': aStrategy.name,
          'display': aStrategy.display,
          'disabled': aStrategy.readonly
        });
      });

      options.hasCaptcha = (SITEKEY ? SITEKEY : '');

      options.nonce = crypto.randomBytes(512).toString('base64');
      defaultCSP += ' \'nonce-' + options.nonce + '\'';

      // Insert an empty default strategy at the beginning
      // NOTE: Safari always autoselects an option when disabled
      options.strategies.unshift({'strat': '', 'display': '(default preferred authentication)'});

      // Sort the strategies
      options.strategies = _.sortBy(options.strategies, function (aStrategy) {
        return aStrategy.display;
      });


      aRes.header('Cache-Control', 'no-cache, no-store, must-revalidate');
      aRes.header('Pragma', 'no-cache');
      aRes.header('Expires', '0');

      //
      aRes.header('Content-Security-Policy',
        'default-src \'none\'' +
        '; base-uri'    + defaultCSP +
        '; child-src'   + defaultCSP +
        '; connect-src' + defaultCSP + captchaCSP +
        '; font-src'    + defaultCSP +
        '; frame-src'   + defaultCSP + captchaCSP +
        '; img-src'     + defaultCSP +
        '; script-src'  + defaultCSP + captchaCSP +
        '; style-src'   + defaultCSP + captchaCSP +
        '; form-action' + defaultCSP +
        '; navigate-to' + defaultCSP +
        ''
      );

      aRes.render('pages/loginPage', options);
    }
  });
};

exports.logout = function (aReq, aRes) {
  var authedUser = aReq.session.user;
  var redirectUri = getRedirect(aReq); // NOTE: Watchpoint

  if (!authedUser) {
    aRes.redirect(redirectUri);
    return;
  }

  User.findOne({ _id: authedUser._id }, function (aErr, aUser) {
    // WARNING: No err handling

    removeSession(aReq, aUser, function () {
      aRes.redirect(redirectUri);
    });
  });
};
