// This is a JavaScript file because, you know, types actually suck sometimes, especially with the
// wishy washy object manipulation and network stuff happening here. All other files containing
// important business logic (for example, the text engine) are typed.

import { LINODE_ASN, SERVER_HOST, SERVER_IP, PORT } from './env.js'
import express from 'express'
import ejs from 'ejs'
import { AsyncRouter } from 'express-async-router'
import fs from 'node:fs'
import { nanoid } from 'nanoid'
import { startKtrAgent, ktrVersion } from './ktr.js'
import { generateText } from './text-engine.js'

const app = express()
const router = AsyncRouter()
const ktr = startKtrAgent()

const TEMPLATE_PATHS = {
	page:         'src/templates/page.ejs',
	updateStream: 'src/templates/update-stream.ejs',
	traceroute:   'src/templates/traceroute.ejs'
}
const TEMPLATE_SPLITS = {
	tracerouteStream: '<!-- TRACEROUTE STREAM -->'
}

function readTemplates() {
	return Object.fromEntries(Object.entries(TEMPLATE_PATHS).map(([ name, path ]) => [
		name,
		fs.readFileSync(path).toString()
	]))
}

function genStreamId() {
	return 'str' + nanoid(4)
}

function renderTracerouteUpdate({ update, pageGlobals, templates, lastStreamId, linodeInfo }) {
	const streamId = genStreamId()
	const isTraceDone = update.kind === 'TraceDone'

	// Improve hop info and prune multiple loading hops
	for (let i = 0; i < update.hops.length; i++) {
		const hop = update.hops[i]
		if (!hop.hostname && hop.ip === pageGlobals.userIp) hop.hostname = 'your device'

		if (hop.kind === 'Pending' && update.hops[i + 1]?.kind === 'Pending') {
			update.hops.splice(i, 1)
			i--
		}
	}

	// Mark the first couple of internal hops as Linode's ASN
	for (const hop of update.hops) {
		if (!hop.networkInfo && hop.ip?.startsWith?.('10.')) {
			hop.networkInfo = linodeInfo
		} else if (hop.networkInfo) {
			break
		}
	}

	// Reverse hops
	update.hops.reverse()

	// Add localhost
	update.hops.push({
		kind: 'Done',
		ip: SERVER_IP,
		hostname: SERVER_HOST,
		networkInfo: linodeInfo
	})

	const html = (lastStreamId ? ejs.render(templates.updateStream, { pageGlobals, streamIds: [ lastStreamId ] }) : '')
		+ ejs.render(templates.traceroute, { hops: update.hops, pageGlobals, streamId, isTraceDone })
	return { streamId, html, isTraceDone }
}

app.use(express.static('src/static'))
app.use(router)

router.get('/', async (req, res) => {
	try {
		const linodeInfo = {
			asn: LINODE_ASN,
			network: await ktr.lookupAsn(LINODE_ASN)
		}

		const templates = readTemplates()
		const [ beforeSplit, afterSplit ] = templates.page.split(TEMPLATE_SPLITS.tracerouteStream)

		// Get user IP
		let userIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()
		if (userIp === 'localhost' || userIp === '::1') userIp = '76.76.21.21' // kognise.dev
		userIp = userIp.replace(/^::ffff:/, '')

		// Globals for EJS renders
		const pageGlobals = {
			userIp,
			serverHost: SERVER_HOST,
			serverIp: SERVER_IP,
			isoDate: new Date().toISOString(),
			ktrVersion,
			paragraphs: null
		}

		// Start trace
		const trace = ktr.trace(userIp)

		// Begin responding	to request
		res.status(200)
		res.contentType('text/html')
		res.write(ejs.render(beforeSplit, { pageGlobals }))

		// Stream traceroute updates
		let lastStreamId = null
		trace.on('update', (update) => {
			const { streamId, html, isTraceDone } = renderTracerouteUpdate({ update, pageGlobals, templates, lastStreamId, linodeInfo })
			res.write(html)
			lastStreamId = streamId
			if (isTraceDone) {
				pageGlobals.paragraphs = generateText(update)
				res.end(ejs.render(afterSplit, { pageGlobals }))
			}
		})
	} catch (error) {
		console.error(error)
		res.sendStatus(500)
	}
})

console.log('starting up...')
console.log(`ktr version: ${ktrVersion}`)

app.listen(PORT, () => console.log(`listening on http://${SERVER_HOST}:${PORT}`))
