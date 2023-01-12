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

if (process.argv.length < 5 || !process.argv[2] || !process.argv[3] || !process.argv[4]) {
    console.log("\nUsage:\n    node index.js <config.json> <.har file> <output.json>\n")
    process.exit(1)
}

/** @typedef {string} snowflake, @type {{thread: snowflake, exclude: array<snowflake>, ctfs: Object.<string, snowflake>}} */
let config = JSON.parse(fs.readFileSync(process.argv[2]))

let channels = []
let messages = []

chain([
    fs.createReadStream(process.argv[3]),
    parser(),
    pick({filter: /^log\.entries\.\d+/}),
    streamValues(),
    ({ value }) => {
        if (value.request.method == "GET") {
            if (/^https:\/\/discord\.com\/api\/v\d*?\/channels\/\d*?$/.test(value.request.url)) {
                let channel = JSON.parse(value.response.content.text)
                if (channel.parent_id && channel.parent_id == config.thread && !config.exclude.includes(channel.id)) {
                    channels.push(channel.id)
                }
            } else if (value.request.url.split("?")[0].endsWith("messages")) {
                let theseMessages = JSON.parse(value.response.content.text)
                messages = messages.concat(theseMessages.map(x => ({ channel_id: x.channel_id, author: x.author.id })))
            }
        }
    },
]).on("finish", () => {
    let postStats = {}
    messages
        .filter(x => channels.includes(x.channel_id))
        .forEach(x => {
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

    let ctfStats = Object.fromEntries(Object.keys(config.ctfs).map(x => [x, []]))
    for (const [channel_id, authors] of Object.entries(postStats)) {
        let channel_number_id = BigInt(channel_id)
        let thisCTF = null
        for (const [ctf, firstPostId] of Object.entries(config.ctfs)) {
            if (channel_number_id >= BigInt(firstPostId)) {
                thisCTF = ctf
            }
        }

        if (thisCTF == null) {
            console.warn("Couldn't assign a CTF to thread " + channel_id)
        } else {
            for (const author of authors) {
                if (ctfStats[thisCTF][author] == undefined) {
                    ctfStats[thisCTF][author] = 1
                } else {
                    ctfStats[thisCTF][author]++
                }
            }
        }
    }
    console.log(ctfStats)

    fs.writeFileSync(process.argv[4], JSON.stringify({ postStats, ctfStats }))
})
