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
	let refreshInterval = null
	trace.on('update', (update) => {
		clearInterval(refreshInterval)

		function render() {
			try {
				const cloned = JSON.parse(JSON.stringify(update))
				const { streamId, html, isTraceDone } = renderTracerouteUpdate({ update: cloned, pageGlobals, templates, lastStreamId, linodeInfo })
				res.write(html)
				lastStreamId = streamId
				if (isTraceDone) {
					pageGlobals.paragraphs = generateText(cloned)
					res.end(ejs.render(afterSplit, { pageGlobals }))
				}
				return isTraceDone
			} catch (error) {
				console.error(error)
				return false
			}
		}
		
		const isTraceDone = render()
		if (!isTraceDone) refreshInterval = setInterval(render, 1000)
	})

	// const _testUpdate = {"kind":"TraceDone","id":0,"hops":[{"kind":"Pending","id":31674},{"kind":"Done","ip":"68.87.149.98","hostname":null,"networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","aka":"Comcast","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"162.151.149.162","hostname":"po-325-rur02.williston.vt.boston.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","aka":"Comcast","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"96.110.42.198","hostname":"be-32021-ar01.woburn.ma.boston.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","aka":"Comcast","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Pending"},{"kind":"Done","ip":"96.110.32.222","hostname":"be-303-cr12.newark.nj.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","aka":"Comcast","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"68.86.85.66","hostname":"be-1113-cr13.beaumeade.va.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","aka":"Comcast","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"68.86.84.17","hostname":"be-1111-cs01.beaumeade.va.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","aka":"Comcast","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"96.110.32.77","hostname":"be-304-cr11.beaumeade.va.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","aka":"Comcast","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"96.110.34.194","hostname":"be-1113-cr13.doraville.ga.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","aka":"Comcast","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"96.110.34.161","hostname":"be-1111-cs01.doraville.ga.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","aka":"Comcast","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"96.110.39.222","hostname":"be-303-cr11.doraville.ga.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","aka":"Comcast","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"96.110.34.226","hostname":"be-1113-cr13.56marietta.ga.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","aka":"Comcast","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"96.110.34.241","hostname":"be-1114-cs01.56marietta.ga.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"96.110.32.217","hostname":"be-301-cr14.56marietta.ga.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"96.110.46.134","hostname":"be-1312-cr12.houston.tx.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"96.110.46.129","hostname":"be-1311-cs03.houston.tx.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"96.110.36.173","hostname":"be-302-cr11.houston.tx.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"68.86.166.98","hostname":"be-1111-cr11.dallas.tx.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"96.110.34.97","hostname":"be-3112-cs01.dallas.tx.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"66.208.233.141","hostname":"be-105-pe12.1950stemmons.tx.ibone.comcast.net","networkInfo":{"asn":7922,"network":{"id":822,"name":"Comcast","organization":{"id":1061,"name":"Comcast Cable Communications, LLC","url":""},"url":"https://corporate.comcast.com/","geographicScope":"NorthAmerica","asn":7922,"networkType":"ISP","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"23.203.147.40","hostname":"ae62.r12.dfw01.ien.netarch.akamai.com","networkInfo":{"asn":20940,"network":{"id":2,"name":"Akamai Technologies","organization":{"id":14,"name":"Akamai Technologies, Inc","url":"https://www.akamai.com/"},"url":"https://www.akamai.com/","geographicScope":"Global","asn":20940,"networkType":"Content","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"45.79.12.102","hostname":"lo0-0.gw2.rin1.us.linode.com","networkInfo":{"asn":63949,"network":{"id":8182,"name":"Linode AS63949","organization":{"id":14,"name":"Akamai Technologies, Inc","url":"https://www.akamai.com/"},"url":"https://www.linode.com/","geographicScope":"Global","asn":63949,"networkType":"Content","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"10.202.32.1","hostname":null,"networkInfo":{"asn":63949,"network":{"id":8182,"name":"Linode AS63949","organization":{"id":14,"name":"Akamai Technologies, Inc","url":"https://www.akamai.com/"},"url":"https://www.linode.com/","geographicScope":"Global","asn":63949,"networkType":"Content","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"10.202.32.4","hostname":null,"networkInfo":{"asn":63949,"network":{"id":8182,"name":"Linode AS63949","organization":{"id":14,"name":"Akamai Technologies, Inc","url":"https://www.akamai.com/"},"url":"https://www.linode.com/","geographicScope":"Global","asn":63949,"networkType":"Content","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"10.202.35.93","hostname":null,"networkInfo":{"asn":63949,"network":{"id":8182,"name":"Linode AS63949","organization":{"id":14,"name":"Akamai Technologies, Inc","url":"https://www.akamai.com/"},"url":"https://www.linode.com/","geographicScope":"Global","asn":63949,"networkType":"Content","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}},{"kind":"Done","ip":"10.202.10.6","hostname":"198.58.104.130","networkInfo":{"asn":63949,"network":{"id":8182,"name":"Linode AS63949","organization":{"id":14,"name":"Akamai Technologies, Inc","url":"https://www.akamai.com/"},"url":"https://www.linode.com/","geographicScope":"Global","asn":63949,"networkType":"Content","protocols":{"unicastIpv4":true,"multicast":false,"ipv6":true,"neverViaRouteServers":false}}}}],"reason":{"kind":"Termination","reason":"DestinationTimeout"}}
	// const { html } = renderTracerouteUpdate({ update: _testUpdate, pageGlobals, templates, lastStreamId: null, linodeInfo })
	// res.write(html)
	// pageGlobals.paragraphs = generateText(_testUpdate)
	// res.end(ejs.render(afterSplit, { pageGlobals }))
})

console.log('starting up...')
console.log(`ktr version: ${ktrVersion}`)

app.listen(PORT, () => console.log(`listening on http://${SERVER_HOST}:${PORT}`))
