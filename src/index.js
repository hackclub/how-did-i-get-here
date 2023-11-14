import express from 'express'
import { startKtrAgent } from './ktr.js'
import fs from 'node:fs'
import dotenv from 'dotenv'

dotenv.config()

const app = express()
const ktr = startKtrAgent()

app.get('/', (req, res) => {
	const template = fs.readFileSync('src/template.html').toString()
	const [ beforeSplit, afterSplit ] = template.split('<!-- STREAM SPLIT -->')

	let ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()
	if (ip === 'localhost') ip = '76.76.21.21' // kognise.dev
	const trace = ktr.trace(ip)
	const date = new Date().toISOString()

	res.status(200)
	res.contentType('text/html')
	res.write(beforeSplit.replaceAll('<!-- IP -->', ip).replaceAll('<!-- DATE -->', date))

	function hop2html(hop, isDone, isHost) {
		if (!hop.hostname && hop.ip === ip) hop.hostname = 'your device'
		if (!hop.hostname && isHost) hop.hostname = 'ktr.kognise.dev'

		if (hop.kind === 'Pending') {
			if (isDone) {
				return `<li class='no-response'>(no response)</li>`
			} else {
				return `<li class='pending'>(waiting for reply)</li>`
			}
		}
		if (hop.kind === 'FindingAsn') return `
			<li class='row'>
				<div class='host'>${hop.hostname ?? hop.ip}</div>
				<div class='asn'></div>
				<div class='network'></div>
			</li>
		`
		if (hop.kind === 'Done') return `
			<li class='row'>
				<div class='host'>${hop.hostname ?? hop.ip}</div>
				<div class='asn'>AS${hop.networkInfo?.asn ?? '???'}</div>
				<div class='network'>${hop.networkInfo?.network?.name ?? ''}</div>
			</li>
		`
	}

	let setHostIp = false
	trace.on('update', (update) => {
		const isDone = update.kind === 'TraceDone'
		const innerHTML = update.hops
			.reverse()
			.map((hop,i)=>hop2html(hop,isDone,i===update.hops.length-1))
			.join('')
		res.write(`<script>document.getElementById('traceroute').innerHTML = JSON.parse(${JSON.stringify(JSON.stringify(innerHTML))})</script>`)
		if (update.hops.at(-1).kind !== 'Pending' && !setHostIp) {
			setHostIp = true
			res.write(`<script>document.getElementById('thishost').innerText = 'ktr.kognise.dev (${update.hops.at(-1).ip})'</script>`)
		}
		if (isDone) {
			console.log(JSON.stringify(update, null, '\t'))
			res.write(`<noscript>${innerHTML}</noscript>`)
			res.end(afterSplit)
		}
	})
})

const port = parseInt(process.env.PORT || 3000)
app.listen(port, () => console.log(`Listening on http://localhost:${port}`))
