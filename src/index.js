// This is a JavaScript file because, you know, types actually suck sometimes, especially with the
// wishy washy object manipulation and network stuff happening here. All other files containing
// important business logic (for example, the text engine) are typed.

import { LINODE_ASN, SERVER_HOST, SERVER_IP, PORT, STUB_TRACEROUTE, ADMIN_PASSWORD } from './env.js'
import express from 'express'
import ejs from 'ejs'
import { AsyncRouter } from 'express-async-router'
import fs from 'node:fs'
import { nanoid } from 'nanoid'
import { startKtrAgent, ktrVersion } from './ktr.js'
import { generateText, generateEssayTracerouteInfo } from './text-engine.js'
import { parse as renderMarkdown } from 'marked'

const app = express()
const router = AsyncRouter()
const ktr = startKtrAgent()

const TEMPLATE_PATHS = {
	page:         'src/templates/page.ejs',
	updateStream: 'src/templates/update-stream.ejs',
	content:      'src/templates/content.ejs',
	essayMd:      'src/templates/essay.md',
	admin:		  'src/templates/admin.ejs',
	logoSvg:      'src/static/logo.svg'
}
const TEMPLATE_SPLITS = {
	contentStream: '<!-- CONTENT STREAM -->'
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
		// if (!hop.hostname && hop.ip === pageGlobals.userIp) hop.hostname = 'your device'

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

	// Deduplicate sequential hops
	// TODO: This is a bug on the ktr side and should be fixed there.
	for (let i = 0; i < update.hops.length - 1; i++) {
		const hop = update.hops[i]
		const nextHop = update.hops[i + 1]

		if (hop.ip === nextHop.ip) {
			update.hops.splice(i, 1)
			i--
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

	try {
		if (update.kind === 'TraceDone' && update.reason.kind === 'Error') {
			pageGlobals.error = output.reason.error
		} else {
			pageGlobals.paragraphs = generateText(update)
		}
	} catch {}

	const tracerouteInfo = generateEssayTracerouteInfo(update.hops)
	pageGlobals.essayHtml = renderMarkdown(ejs.render(templates.essayMd, { pageGlobals, tracerouteInfo }))

	let html = ejs.render(templates.content, { hops: update.hops, pageGlobals, streamId, isTraceDone })
	if (lastStreamId) {
		html = ejs.render(templates.updateStream, { pageGlobals, lastStreamId, streamId, html })
	}
	
	return { streamId, html, isTraceDone }
}

app.use(express.static('src/static'))
app.use(router)

router.get('/', async (req, res) => {
	const linodeInfo = {
		asn: LINODE_ASN,
		network: await ktr.lookupAsn(LINODE_ASN)
	}

	const templates = readTemplates()
	const [ beforeSplit, afterSplit ] = templates.page.split(TEMPLATE_SPLITS.contentStream)

	// Get user IP
	let userIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()
	if (userIp === 'localhost' || userIp === '::1' || userIp === '127.0.0.1') userIp = '76.76.21.21' // kognise.dev
	userIp = userIp.replace(/^::ffff:/, '')

	// Globals for EJS renders
	const pageGlobals = {
		userIp,
		serverHost: SERVER_HOST,
		serverIp: SERVER_IP,
		isoDate: new Date().toISOString().slice(0, -5),
		ktrVersion,
		paragraphs: null,
		error: null,
		logoSvg: templates.logoSvg,
		essayHtml: '' // Rendered when traceroute is done
	}

	// Start trace
	let trace
	if (!STUB_TRACEROUTE) trace = ktr.trace(userIp)

	// Begin responding	to request
	res.status(200)
	res.contentType('text/html')
	res.write(ejs.render(beforeSplit, { pageGlobals }))

	// Stream traceroute updates
	if (!STUB_TRACEROUTE) {
		let lastStreamId = null
		let refreshInterval = null

		try {
			const { streamId, html } = renderTracerouteUpdate({
				update: {
					kind: 'TraceUpdate',
					id: 0,
					hops: []
				},
				pageGlobals, templates, lastStreamId, linodeInfo
			})
			res.write(html)
			lastStreamId = streamId
		} catch (error) {
			console.error(error)
		}

		trace.on('update', (update) => {
			clearInterval(refreshInterval)

			function render() {
				try {
					const cloned = JSON.parse(JSON.stringify(update))
					const { streamId, html, isTraceDone } = renderTracerouteUpdate({ update: cloned, pageGlobals, templates, lastStreamId, linodeInfo })
					res.write(html)
					lastStreamId = streamId
					if (isTraceDone) res.end(ejs.render(afterSplit, { pageGlobals }))
					return isTraceDone
				} catch (error) {
					clearInterval(refreshInterval)
					console.error(error)
					return false
				}
			}
			
			const isTraceDone = render()
			if (!isTraceDone) refreshInterval = setInterval(render, 100)
		})
	}

	if (STUB_TRACEROUTE) {
		const _testUpdate = {"kind":"TraceDone","id":0,"hops":[{"kind":"Pending","id":31674},{"kind":"Done","ip":"68.87.149.98","hostname":null,"networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","aka":"Comcast","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"162.151.149.162","hostname":"po-325-rur02.williston.vt.boston.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","aka":"Comcast","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"96.110.42.198","hostname":"be-32021-ar01.woburn.ma.boston.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","aka":"Comcast","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Pending"},{"kind":"Done","ip":"96.110.32.222","hostname":"be-303-cr12.newark.nj.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","aka":"Comcast","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"68.86.85.66","hostname":"be-1113-cr13.beaumeade.va.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","aka":"Comcast","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"68.86.84.17","hostname":"be-1111-cs01.beaumeade.va.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Coemcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","aka":"Comcast","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"96.110.32.77","hostname":"be-304-cr11.beaumeade.va.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","aka":"Comcast","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"96.110.34.194","hostname":"be-1113-cr13.doraville.ga.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","aka":"Comcast","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"96.110.34.161","hostname":"be-1111-cs01.doraville.ga.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","aka":"Comcast","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"96.110.39.222","hostname":"be-303-cr11.doraville.ga.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","aka":"Comcast","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"96.110.34.226","hostname":"be-1113-cr13.56marietta.ga.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","aka":"Comcast","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"96.110.34.241","hostname":"be-1114-cs01.56marietta.ga.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"96.110.32.217","hostname":"be-301-cr14.56marietta.ga.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"96.110.46.134","hostname":"be-1312-cr12.houston.tx.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"96.110.46.129","hostname":"be-1311-cs03.houston.tx.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"96.110.36.173","hostname":"be-302-cr11.houston.tx.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"68.86.166.98","hostname":"be-1111-cr11.dallas.tx.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"96.110.34.97","hostname":"be-3112-cs01.dallas.tx.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"66.208.233.141","hostname":"be-105-pe12.1950stemmons.tx.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"23.203.147.40","hostname":"ae62.r12.dfw01.ien.netarch.akamai.com","networkInfo":{"asn":20940,"network":{"id":2,"name":"Akamai Technologies","organization":{"id":14,"name":"Akamai Technologies, Inc","url":"https://www.akamai.com/"},"url":"https://www.akamai.com/","geographicScope":"Global","asn":20940,"networkType":"Content","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"45.79.12.102","hostname":"lo0-0.gw2.rin1.us.linode.com","networkInfo":{"asn":63949,"network":{"id":8182,"name":"Linode AS63949","organization":{"id":14,"name":"Akamai Technologies, Inc","url":"https://www.akamai.com/"},"url":"https://www.linode.com/","geographicScope":"Global","asn":63949,"networkType":"Content","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"10.202.32.1","hostname":null,"networkInfo":{"asn":63949,"network":{"id":8182,"name":"Linode AS63949","organization":{"id":14,"name":"Akamai Technologies, Inc","url":"https://www.akamai.com/"},"url":"https://www.linode.com/","geographicScope":"Global","asn":63949,"networkType":"Content","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"10.202.32.4","hostname":null,"networkInfo":{"asn":63949,"network":{"id":8182,"name":"Linode AS63949","organization":{"id":14,"name":"Akamai Technologies, Inc","url":"https://www.akamai.com/"},"url":"https://www.linode.com/","geographicScope":"Global","asn":63949,"networkType":"Content","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"10.202.35.93","hostname":null,"networkInfo":{"asn":63949,"network":{"id":8182,"name":"Linode AS63949","organization":{"id":14,"name":"Akamai Technologies, Inc","url":"https://www.akamai.com/"},"url":"https://www.linode.com/","geographicScope":"Global","asn":63949,"networkType":"Content","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"10.202.10.6","hostname":"198.58.104.130","networkInfo":{"asn":63949,"network":{"id":8182,"name":"Linode AS63949","organization":{"id":14,"name":"Akamai Technologies, Inc","url":"https://www.akamai.com/"},"url":"https://www.linode.com/","geographicScope":"Global","asn":63949,"networkType":"Content","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}}],"reason":{"kind":"Termination","reason":"DestinationTimeout"}}
		pageGlobals.paragraphs = generateText(_testUpdate)
		const { html } = renderTracerouteUpdate({ update: _testUpdate, pageGlobals, templates, lastStreamId: null, linodeInfo })
		res.write(html)
		res.end(ejs.render(afterSplit, { pageGlobals }))
	}
})

router.get('/admin', async (req, res) => {
	if (req.query.password !== ADMIN_PASSWORD) return res.sendStatus(401)
	const html = ejs.render(readTemplates().admin, { traces: ktr.traces })
	res.status(200).end(html)
})

console.log('starting up...')
console.log(`ktr version: ${ktrVersion}`)

app.listen(PORT, () => console.log(`listening on http://${SERVER_HOST}:${PORT}`))
