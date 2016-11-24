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
const credentials = JSON.parse(fs.readFileSync(path.join(home, '.twitter_credentials.json'), { encoding: 'utf8' }));
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
    });
}

function getUsers(tweets) {
    return tweets.map(t => t.user.id_str).filter((userId, index, self) => self.indexOf(userId) === index);
}

function getUser(userId) {
    twitterDebug(`Getting user details for user id ${userId}...`);
    return client.getAsync('users/show', { user_id: userId });
}

getTweets()
    .then(tweets => getUsers(tweets))
    .then(userIds => getFollower(userIds))
    .then(userId => getUser(userId))
    .then(user => {
        const url = `https://twitter.com/${user.screen_name}`;
        console.log(`User is: ${user.screen_name}\nSee in ${url}`);
        open(url);

    })
    .catch(err => {
        console.log(`Got error: ${err}`);
    });