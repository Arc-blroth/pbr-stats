/*
 *   _  _  _  ___              _____ _        _
 *  | || || |/ _ \            / ____| |      | | 
 *  | \| |/ | |_) ) ___      | (___ | |_ __ _| |_ ___
 *   \_   _/|  _ < / _ \      \___ \| __/ _` | __/ __|
 *     | |  | |_) ) |_) )     ____) | || (_| | |_\__ \
 *     |_|  |  __/|  __/     |_____/ \__\__,_|\__|___/
 *          | |   | |
 *          |_|   |_|
 */

const fs = require("node:fs")
const process = require("node:process")
const { chain } = require("stream-chain")
const { parser } = require("stream-json")
const { pick } = require("stream-json/filters/Pick")
const { streamValues } = require("stream-json/streamers/StreamValues")
import("discord-snowflake").then(({ getTimestamp }) => globalThis.getTimestamp = getTimestamp)

if (process.argv.length < 5 || !process.argv[2] || !process.argv[3] || !process.argv[4]) {
    console.log("\nUsage:\n    node index.js <config.json> <.har file> <output.json>\n")
    process.exit(1)
}

const TOTALS_KEY = "_All CTFs_"
const MIN_POSTS_FOR_SIGNIFICANCE = 2

/** @typedef {string} snowflake, @type {{thread: snowflake, exclude: array<snowflake>, ctfs: Object.<string, snowflake>}} */
let config = JSON.parse(fs.readFileSync(process.argv[2]))

let channels = []
let messages = []

function initOrInc(object, key, initialVal = 1) {
    if (object[key] === undefined) {
        object[key] = initialVal
    } else {
        object[key]++
    }
}

chain([
    fs.createReadStream(process.argv[3]),
    parser(),
    pick({filter: /^log\.entries\.\d+/}),
    streamValues(),
    ({ value }) => {
        if (value.request.method == "GET") {
            if (/^https:\/\/discord\.com\/api\/v\d*?\/channels\/\d*?\/threads\/search/.test(value.request.url)) {
                let threads = JSON.parse(value.response.content.text).threads
                for (channel of threads) {
                    if (channel.parent_id && channel.parent_id == config.thread && !config.exclude.includes(channel.id)) {
                        channels.push(channel.id)
                    }
                }
            } else if (value.request.url.split("?")[0].endsWith("messages")) {
                let theseMessages = JSON.parse(value.response.content.text)
                messages = messages.concat(theseMessages.map(x => ({ id: x.id, channel_id: x.channel_id, author: x.author.id })))
            }
        }
    },
]).on("finish", () => {
    let postStats = {}
    let processedMessages = []
    messages
        .filter(x => channels.includes(x.channel_id) && !processedMessages.includes(x.id))
        .forEach(x => {
            processedMessages.push(x.id)

            if (postStats[x.channel_id] === undefined) {
                postStats[x.channel_id] = {}
            }
            if (postStats[x.channel_id][x.author] == undefined) {
                postStats[x.channel_id][x.author] = 1
            } else {
                postStats[x.channel_id][x.author]++
            }
        })
    console.log(postStats)

    let ctfStats = Object.fromEntries(Object.keys(config.ctfs).map(x => [x, {}]))
    ctfStats[TOTALS_KEY] = {}
    for (const [channel_id, authors] of Object.entries(postStats)) {
        let channel_timestamp = getTimestamp(channel_id)
        let thisCTF = null
        for (const [ctf, firstPostId] of Object.entries(config.ctfs)) {
            if (channel_timestamp >= getTimestamp(firstPostId)) {
                thisCTF = ctf
            }
        }

        if (thisCTF == null) {
            console.warn("Couldn't assign a CTF to thread " + channel_id)
        } else {
            for (const author of Object.keys(authors)) {
                initOrInc(ctfStats[thisCTF], author)
                initOrInc(ctfStats[TOTALS_KEY], author)
            }
        }
    }
    console.log(ctfStats)

    let totalStats = { byPlayer: {}, byCTF: {}, byCTFSignificant: {} }
    for (const [name, ctf] of Object.entries(ctfStats)) {
        if (name != TOTALS_KEY) {
            let numBricks = 0
            let numSignificantBricks = 0

            for (const [brick, posts] of Object.entries(ctf)) {
                initOrInc(totalStats.byPlayer, brick)

                numBricks++
                if (posts >= MIN_POSTS_FOR_SIGNIFICANCE) {
                    numSignificantBricks++
                }
            }

            totalStats.byCTF[name] = numBricks
            totalStats.byCTFSignificant[name] = numSignificantBricks
        }
    }
    console.log(totalStats)

    fs.writeFileSync(process.argv[4], JSON.stringify({ postStats, ctfStats, totalStats }, null, 2))
})
