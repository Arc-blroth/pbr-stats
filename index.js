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
const zlib = require("node:zlib")
const erlpack = require("erlpack")
const { chain } = require("stream-chain")
const { parser } = require("stream-json")
const { pick } = require("stream-json/filters/Pick")
const { ignore } = require("stream-json/filters/Ignore")
const { streamValues } = require("stream-json/streamers/StreamValues")

const ERLPACK_FORMAT_VERSION = 131

if (process.argv.length < 3 || !process.argv[2]) {
    console.log("\nUsage:\n    node index.mjs <.har file>\n")
    process.exit(1)
}

let usingErlpack = false
let inflateBuffer = Buffer.alloc(0)

chain([
    fs.createReadStream(process.argv[2]),
    parser(),
    pick({filter: /^log\.entries\.\d+\._webSocketMessages\.\d+/}),
    ignore({filter: /^(time)|(opcode)$/}),
    streamValues(),
    ({ value }) => value.type == "receive" ? Buffer.from(value.data, 'base64') : null,
    zlib.createInflate({ flush: zlib.constants.Z_SYNC_FLUSH, finishFlush: zlib.constants.Z_SYNC_FLUSH }),
    function* (data) {
        if (usingErlpack || inflateBuffer[0] == ERLPACK_FORMAT_VERSION) {
            usingErlpack = true
            return erlpack.unpack(data)
        }

        // reassemble long JSON messages
        inflateBuffer = Buffer.concat([inflateBuffer, data])
        try {
            yield JSON.parse(inflateBuffer.toString())
            inflateBuffer = Buffer.alloc(0)
        } catch {
            yield null
        }
    },
    data => console.log(JSON.stringify(data)),
])
