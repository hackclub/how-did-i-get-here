import express from 'express'
import { startKtrAgent, ktrVersion } from './ktr.js'
import ejs from 'ejs'
import fs from 'node:fs'
import { nanoid } from 'nanoid'

const app = express()
const ktr = startKtrAgent()

const serverHost = 'ktr.kognise.dev'
const templatePaths = {
	page:         'src/templates/page.ejs',
	updateStream: 'src/templates/update-stream.ejs',
	traceroute:   'src/templates/traceroute.ejs'
}
const templateSplits = {
	tracerouteStream: '<!-- TRACEROUTE STREAM -->'
}

function readTemplates() {
	return Object.fromEntries(Object.entries(templatePaths).map(([ name, path ]) => [
		name,
		fs.readFileSync(path).toString()
	]))
}

function genStreamId() {
	return 'str' + nanoid(4)
}

function renderTracerouteUpdate({ update, pageGlobals, templates, lastStreamId }) {
	const streamId = genStreamId()
	const isTraceDone = update.kind === 'TraceDone'

	// Improve hop info and prune multiple loading hops
	for (let i = 0; i < update.hops.length; i++) {
		const hop = update.hops[i]
		if (!hop.hostname && hop.ip === pageGlobals.userIp) hop.hostname = 'your device'
		if (!hop.hostname && i === 0) hop.hostname = serverHost

		if (hop.kind === 'Pending' && update.hops[i + 1]?.kind === 'Pending') {
			update.hops.splice(i, 1)
			i--
		}
	}

	// Reverse hops
	update.hops.reverse()

	const html = (lastStreamId ? ejs.render(templates.updateStream, { pageGlobals, streamIds: [ lastStreamId ] }) : '')
		+ ejs.render(templates.traceroute, { hops: update.hops, pageGlobals, streamId, isTraceDone })
	return { streamId, html, isTraceDone }
}

app.use(express.static('src/static'))

app.get('/', (req, res) => {
	const templates = readTemplates()
	const [ beforeSplit, afterSplit ] = templates.page.split(templateSplits.tracerouteStream)

	// Get user IP
	let userIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()
	if (userIp === 'localhost' || userIp === '::1') userIp = '76.76.21.21' // kognise.dev

	// Globals for EJS renders
	const pageGlobals = {
		userIp,
		isoDate: new Date().toISOString(),
		serverHost,
		ktrVersion
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
		const { streamId, html, isTraceDone } = renderTracerouteUpdate({ update, pageGlobals, templates, lastStreamId })
		res.write(html)
		lastStreamId = streamId
		if (isTraceDone) res.end(afterSplit)
	})
})

console.log('starting up...')
console.log(`ktr version: ${ktrVersion}`)

const port = parseInt(process.env.PORT || 3000)
app.listen(port, () => console.log(`listening on http://localhost:${port}`))
