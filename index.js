#!/usr/bin/env node

const fs = require('fs');
const osenv = require('osenv');
const Twitter = require('twitter');
const Promise = require("bluebird");
Promise.promisifyAll(Twitter.prototype);
const path = require('path');
const querystring = require('querystring');
const twitterDebug = require('debug')('twitter');
const open = require("open");
const { docopt } = require('docopt');
const maxNumberOfTwittsSearched = 1000;

const doc = `
Usage:
  twitterraffle <query> <user>
  twitterraffle -h | --help | --version
`;

const version = require(path.join(__dirname, 'package.json')).version;
const options = docopt(doc, { version: version, help: true, exit: true });
const query = options['<query>'];
const user = options['<user>'];

const home = osenv.home();
const credentialsFile = path.join(home, '.twitter_credentials.json');
try {
    fs.accessSync(credentialsFile, fs.F_OK);
} catch (e) {
    console.error(`Could not find the credentials file. It was supposed to be on ${credentialsFile}. Go to https://app.twitter.com and create an app. There you will be able to get the keys and secrets.
Here is the expected format:
{
    "consumer_key": "xxx",
    "consumer_secret": "xxx",
    "access_token_key": "xxx",
    "access_token_secret": "xxx"
}
`);
    process.exit(1);
}
const credentials = JSON.parse(fs.readFileSync(credentialsFile, { encoding: 'utf8' }));

const client = Twitter(credentials);

const originalOptions = { q: query, count: 100, result_type: 'recent', include_entities: false };
function clone(original, merge) {
    const clone = { };
    for (const key in original)
        clone[key] = original[key];
    if (merge)
        for (const key in merge)
            clone[key] = merge[key];
    return clone;
}

var tweetPage = 0;
function getTweets(statuses, previousPromise) {
    tweetPage++;
    if (!statuses) {
        twitterDebug('Getting first tweets...');
        return getTweets([], client.getAsync('search/tweets', originalOptions));
    }
    return previousPromise.then(tweets => {
        const newStatuses = statuses.concat(tweets.statuses);
        if (!tweets.search_metadata.next_results || tweetPage > (maxNumberOfTwittsSearched / 100))
            return newStatuses;
        let nextResultsQueryString = tweets.search_metadata.next_results;
        nextResultsQueryString = nextResultsQueryString.substring(0, 1) === '?' ? nextResultsQueryString.substring(1) : nextResultsQueryString;
        const nextResultQuery = querystring.parse(nextResultsQueryString);
        const optionsForNextRequest = clone(originalOptions, { max_id: nextResultQuery.max_id });
        twitterDebug(`Getting more tweets (page ${tweetPage})...`);
        return getTweets(newStatuses, client.getAsync('search/tweets', optionsForNextRequest));
    });
}

function getRandomUserId(userIds) {
    const winnerIndex = Math.floor(Math.random() * userIds.length);
    const possibleWinnerId = userIds[winnerIndex];
    return possibleWinnerId;
}

function getFollower(userIds, previousPromise) {
    if (userIds.length === 0)
        return null;
    const randomUserId = getRandomUserId(userIds);
    if (!previousPromise) {
        twitterDebug(`Getting friendship tweets for user id ${randomUserId}...`);
        return getFollower(userIds, client.getAsync('friendships/show', { source_screen_name: user, target_id: randomUserId }));
    }
    return previousPromise.then(r => {
        if (r.relationship.target.following)
            return r.relationship.target.id_str;
        userIds.splice(userIds.indexOf('c'), 1);
        twitterDebug(`Getting friendship tweets for user id ${randomUserId}...`);
        return getFollower(userIds, client.getAsync('friendships/show', { source_screen_name: user, target_id: randomUserId }));
    }).catch(err => {
        if (err && err[0] && err[0].code === 163) {
            console.log("User does not exist.");
            return null;
        }
        throw err;
    });
}

function getUsers(tweets) {
    console.log("No tweets found.");
    return tweets.map(t => t.user.id_str).filter((userId, index, self) => self.indexOf(userId) === index);
}

function getUser(userId) {
    if (!userId) {
        console.log("No user found.");
        return null;
    }
    twitterDebug(`Getting user details for user id ${userId}...`);
    return client.getAsync('users/show', { user_id: userId });
}

getTweets()
    .then(tweets => getUsers(tweets))
    .then(userIds => getFollower(userIds))
    .then(userId => getUser(userId))
    .then(user => {
        if (!user) return;
        const url = `https://twitter.com/${user.screen_name}`;
        console.log(`User is: ${user.screen_name}\nSee in ${url}`);
        open(url);
    })
    .catch(err => {
        console.log(`Got error: ${err}`);
    });