import './env.js'
import { AKAMAI_ASN, LINODE_ASN, SERVER_HOST, SERVER_IP } from './env.js'
import type { ControllerResult_TraceDone, Hop, Hop_Done, Hop_FindingAsn, NetworkInfo, NetworkType } from './ktr-types.js'

interface Portion {
	key: {
		kind: 'Pending' | 'Done'
		networkInfo: NetworkInfo | null
	}
	hops: Exclude<Hop, Hop_FindingAsn>[]
	size: number
}

export function generateText(lastUpdate: ControllerResult_TraceDone) {
	const portions: Portion[] = []

	for (const hop of lastUpdate.hops) {
		const lastPortion = portions.at(-1)
		// Merge networks that are both pending, both the same ASN, or both the same organization
		const keyMatches = lastPortion && lastPortion.key.kind === hop.kind
			&& (hop.kind === 'Pending'
				|| lastPortion.key.networkInfo?.asn === hop.networkInfo?.asn
				|| lastPortion.key.networkInfo?.network?.organization.id === hop.networkInfo?.network?.organization.id)

		if (keyMatches) {
			lastPortion.hops.push(hop)
		} else {
			portions.push({
				key: {
					kind: hop.kind,
					networkInfo: hop.kind === 'Done' ? hop.networkInfo : null
				},
				hops: [hop],
				get size() { return this.hops.length }
			})
		}
	}

	// Merge portion gaps (ex: <[Comcast]> <[Pending]> <[Comcast]> -> <[Comcast, Pending, Comcast]>)
	for (let i = 0; i < portions.length - 2; i++) {
		const [ first, middle, last ] = portions.slice(i, i + 3)
		const canSandwich = first.key.kind === 'Done' && middle.key.kind === 'Pending' && last.key.kind === 'Done'
			&& (first.key.networkInfo?.asn === last.key.networkInfo?.asn
				|| (first.key.networkInfo?.network && first.key.networkInfo?.network?.organization.id === last.key.networkInfo?.network?.organization.id))
		if (canSandwich) {
			first.hops.push(...middle.hops)
			first.hops.push(...last.hops)
			portions.splice(i + 1, 2)
			i--
		}
	}

	console.log(portions.map(p => p.hops.map(h => h.kind === 'Done' ? h.hostname ?? h.ip : '(pending)')))

	// Yeet the last portion into its own variable
	const lastHops = portions.pop()!.hops
	let prevHop = portions[0].hops[0]

	// Start text generation
	const paragraphs: string[] = []
	let lastWasSideNote = false
	function pushParagraph(text: string) {
		lastWasSideNote = false
		paragraphs.push(text.trim().replace(/\s+/g, ' '))
	}

	const networkTypeCounts: Record<NetworkType, number> = {
		NSP: 0,
		Content: 0,
		ISP: 0,
		Enterprise: 0,
		Educational: 0,
		NonProfit: 0,
		Government: 0,
		RouteServer: 0,
		NetworkServices: 0,
		RouteCollector: 0,
		Other: 0
	}
	function describeNetworkType(networkType: NetworkType, needsArticle: boolean) {
		const count = networkTypeCounts[networkType]
		networkTypeCounts[networkType]++
		
		let long: string  // Full name, including the article ("an" or "a")
		let short: string // Abbreviation or single word only
		let shortArticle: string | null   // The article that would accompany short, or null if long is required
		let shortSupportsAnother: boolean // Whether short works with "another" as a prefix

		switch (networkType) {
			case 'NSP': {
				long = 'a network service provider, a company that sells Internet access to other companies'
				short = 'NSP'
				shortArticle = 'a'
				shortSupportsAnother = true
				break
			}
			case 'Content': {
				long = 'a content delivery network'
				short = 'CDN'
				shortArticle = 'a'
				shortSupportsAnother = true
				break
			}
			case 'ISP': {
				long = 'an Internet service provider'
				short = 'ISP'
				shortArticle = 'an'
				shortSupportsAnother = true
				break
			}

			case 'Enterprise': {
				long = `a big enterprise network`
				short = 'enterprise'
				shortArticle = 'an'
				shortSupportsAnother = false
				break
			}
			case 'Educational': {
				long = 'some educational establishment'
				short = 'edu'
				shortArticle = null
				shortSupportsAnother = false
				if (needsArticle && count === 1) return 'another educational establishment'
				break
			}
			case 'NonProfit': {
				long = 'a nonprofit-owned network'
				short = 'nonprofit'
				shortArticle = 'a'
				shortSupportsAnother = false
				break
			}
			case 'Government': {
				long = 'a government-owned network'
				short = 'government'
				shortArticle = null
				shortSupportsAnother = false
				if (needsArticle && count === 1) return 'another government network'
				break
			}

			case 'RouteServer': {
				long = 'associated with a route server, which helps manage BGP sessions but doesn’t necessarily have its own network'
				short = 'route server'
				shortArticle = 'a'
				shortSupportsAnother = true
				break
			}
			case 'NetworkServices': {
				long = 'a network infrastructure provider'
				short = 'infrastructure'
				shortArticle = null
				shortSupportsAnother = false
				if (needsArticle && count === 1) return 'another infrastructure provider'
				break
			}
			case 'RouteCollector': {
				long = 'a route collector, a network that just tries to ingest all BGP routes'
				short = 'route collector'
				shortArticle = 'a'
				shortSupportsAnother = true
				break
			}

			case 'Other': {
				if (needsArticle) {
					return `which I couldn't find much about`
				} else {
					return '???'
				}
			}
		}

		if (count === 0) {
			return long
		} else if (count === 1 && shortSupportsAnother) {
			return 'another ' + short
		} else if (needsArticle) {
			return shortArticle + ' ' + short
		} else {
			return short
		}
	}

	let unknownNetworkCount = 0
	function describePortionTersely(portion: Portion) {
		const network = portion.key.networkInfo?.network
		if (network) {
			return `${network.name.trim()} (${describeNetworkType(network.networkType, false)})`
		} else if (portion.key.networkInfo) {
			return `AS${portion.key.networkInfo.asn} (???)`
		} else {
			unknownNetworkCount++
			if (unknownNetworkCount === 1) {
				return 'an unidentified network'
			} else {
				return 'another unidentified network'
			}
		}
	}

	function areNamesSimilar(a: string, b: string): boolean {
		return a.trim() === b.trim()
			|| b.includes(a.trim())
			|| a.includes(b.trim())
	}

	function firstSegment(portion: Portion, includesFirst: boolean, thatRouter: boolean) {
		prevHop = portion.hops.at(-1)!
		if (portion.key.networkInfo && portion.key.networkInfo.network) {
			const network = portion.key.networkInfo.network

			const uniqueNetworks = new Set<number>()
			for (const hop of portion.hops) if (hop.kind === 'Done' && hop.networkInfo?.network) uniqueNetworks.add(hop.networkInfo.network.id)

			let text = ''
			text += includesFirst ? `Starting at ` : `Traveling from `
			text += thatRouter ? 'that router, ' : 'your router, '
			text += 'the first portion of your trip went through '
			text += portion.size === 1 ? 'a device ' : 'devices '
			text += `in ${network.organization.name.trim()}'s `
			text += uniqueNetworks.size === 1 ? 'network' : 'networks'
			if (!areNamesSimilar(network.name, network.organization.name)) text += `, ${network.name.trim()}`
			text += '. '

			if (network.networkType === 'ISP') {
				networkTypeCounts['ISP']++
				text += `That’s probably your ISP, responsible for connecting you to the Internet in exchange for money.`
			} else if (network.networkType === 'NSP') {
				networkTypeCounts['ISP']++ // Not a typo
				text += `That’s either your ISP, responsible for connecting you to the Internet in exchange for money, or a company your Internet provider contracts.`
			} else {
				text += `
					That’s the first network we have any info on; chances are whoever handles your Internet is paying them
					for Internet access or they're your VPN provider.
				`
			}

			pushParagraph(text)
		} else if (portion.key.networkInfo) {
			pushParagraph(`
				The first portion of your trip went through ${portion.size === 1 ? 'a device' : 'devices'} in the network
				AS${portion.key.networkInfo.asn}. I couldn’t find any information on it aside from its autonomous system number,
				but chances are whoever handles your Internet is paying them for Internet access or they're your VPN provider.
			`)
		} else {
			pushParagraph(`
				After ${thatRouter ? 'that' : 'your'} router, you took a trip through ${portion.size === 1 ? 'a device ' : 'some devices'} in an unidentified network,
				probably internal to whatever network your computer is connected to.
			`)
		}
		clarifyNoResponseIfNeeded(portion.hops, false)
	}

	let didClarifyHostname = false
	function clarifyHostname(hop: Hop_Done) {
		if (didClarifyHostname) return
		pushParagraph(`
			(By the way, that ${hop.hostname} thing is the result of a reverse DNS lookup I did by asking our DNS server
			if there’s any name associated with the IP, ${hop.ip}. Since there was, I used the “pretty” human-readable
			name instead of the numbers. Reverse DNS names are usually just designed to make debugging easier, and often
			don’t even map back to the original IP.)
		`)
		lastWasSideNote = true
		didClarifyHostname = true
	}

	let didClarifyNoResponse = false
	function clarifyNoResponseIfNeeded(hops: Hop[], isNextProbe: boolean) {
		if (didClarifyNoResponse) return
		if (hops.some(h => h.kind === 'Pending')) {
			pushParagraph(`
				${isNextProbe ? `We didn’t actually get a response from the next probe.` : `By the way, see that “(no response)”?`}
				There will often be a couple of those in the traceroute — not every server will consistently respond to us
				and the Internet is unreliable! It’s a shame, but we can still get a pretty good idea of what’s going on
				from the servers that do respond.
			`)
			lastWasSideNote = true
			didClarifyNoResponse = true
		}
	}
	
	// Beginning and first segment
	{
		const portion = portions.shift()!
		
		const user = portion.hops.shift()!
		if (user.kind === 'Pending') {
			pushParagraph(`
				Your journey to load this website started with your computer talking to your router. That router, your entrypoint
				to your ISP’s network, didn’t actually respond to my ping — this is pretty common for public routers or if you're
				behind a VPN — so we just have to imagine its existence at the start of the traceroute.
			`)
			// Note: there can never be a second pending hop at the start of the traceroute, they're pruned beforehand.
			const nextPortion = portions.shift()
			if (nextPortion) firstSegment(nextPortion, false, false)
		} else { // Done
			if (user.networkInfo?.network?.networkType === 'ISP') {
				pushParagraph(`
					Your journey to load this website started with your computer talking to your router. That router, your entrypoint
					to your ISP's network, is the first item you’ll see in the traceroute ${user.hostname ? 'and is associated with' : 'alongside'}
					your public IP: ${user.ip}.
				`)
			} else {
				pushParagraph(`
					Your journey to load this website started with your computer talking to your router. That router, your entrypoint
					to the Internet, may be the first item you see in the traceroute (${user.hostname ? 'associated with' : 'alongside'}
					your public IP, ${user.ip}). Alternately, you may be behind a VPN of some sort — in that case, the earliest point we
					can track is the Internet-facing router that your packets are being sent through.
				`)
			}
			
			if (portion.size === 0) { // Only first hop was in this portion
				const nextPortion = portions.shift()
				if (nextPortion) firstSegment(nextPortion, false, true)
			} else { // >= 1 remaining
				firstSegment(portion, true, true)
			}
		}
	}

	// This is stupid, but from now on we only care about network-level, not org-level,
	// so we have to re-chunk the portions by ASN
	for (let i = 0; i < portions.length; i++) {
		for (let j = 1; j < portions[i].hops.length; j++) {
			const hop = portions[i].hops[j]
			if (hop.kind === 'Done' && hop.networkInfo?.asn !== portions[i].key.networkInfo?.asn) {
				const remainingHops = portions[i].hops.splice(j)
				portions.splice(i + 1, 0, {
					key: hop,
					hops: remainingHops,
					get size() { return this.hops.length }
				})
			}
		}
	}
	
	// Intermediate segments
	let intermediates: '0' | '1-3' | '4+' = '0'
	{
		if (portions[0]?.key?.kind === 'Pending') {
			clarifyNoResponseIfNeeded(portions.shift()!.hops, true)
		}

		const doneRemaining = portions.filter(portion => portion.key.kind === 'Done')
		if (doneRemaining.length === 1) {
			intermediates = '1-3'
			const network = doneRemaining[0].key.networkInfo?.network

			let prefix
			let description
			if (network) {
				const [ netName, orgName ] = [ network.name.trim(), network.organization.name.trim() ]
				if (areNamesSimilar(netName, orgName)) {
					prefix = `You took an intermediate jump through ${netName}`
					description = describeNetworkType(network.networkType, true)
				} else {
					prefix = `You took an intermediate jump through ${netName}, a network owned by ${orgName}`
					description = describeNetworkType(network.networkType, true)
				}
			} else {
				prefix = `You took an intermediate jump through AS${doneRemaining[0].key.networkInfo!.asn}`
				description = describeNetworkType('Other', true)
			}

			if (description.includes(',')) {
				pushParagraph(`${prefix}. They're ${description}.`)
			} else {
				pushParagraph(`${prefix}, ${description}.`)
			}
		} else if (doneRemaining.length === 2) {
			intermediates = '1-3'
			pushParagraph(`
				Next, you jumped through two networks: ${describePortionTersely(doneRemaining[0])} and ${describePortionTersely(doneRemaining[1])}.
			`)
		} else if (doneRemaining.length >= 3) {
			intermediates = '1-3'
			if (doneRemaining.length >= 4) intermediates = '4+'
			pushParagraph(`
				Next, you took a long and meandering path through ${doneRemaining.slice(0, -1).map(describePortionTersely).join(', ')},
				${doneRemaining.length >= 4 ? 'and finally' : 'and'} ${describePortionTersely(doneRemaining.at(-1)!)}.
			`)
		}

		for (const portion of portions) {
			if (portion === portions.at(-1)) { // Not the last one yet, because this might be a transition to the end
				clarifyNoResponseIfNeeded(portion.hops, false)
			}
			if (portion.key.kind === 'Done') prevHop = portion.hops.at(-1)!
		}
	}

	// Ending
	{
		function isAkamai(hop: Hop): hop is Hop_Done {
			return hop.kind === 'Done' && hop.networkInfo?.asn === AKAMAI_ASN
		}
		function isLinodeInternal(hop: Hop): hop is Hop_Done {
			return hop.kind === 'Done' && hop.ip.startsWith('10.') && hop.networkInfo?.asn === LINODE_ASN
		}
		function isServer(hop: Hop): hop is Hop_Done {
			return hop.kind === 'Done' && hop.ip === SERVER_IP && hop.hostname === SERVER_HOST
		}
		function isLinodeEntrypoint(hop: Hop): hop is Hop_Done {
			return hop.kind === 'Done' && hop.networkInfo?.asn === LINODE_ASN && !isLinodeInternal(hop) && !isServer(hop)
		}

		let reachedAkamai = false

		let hopsBeforeLinode: Hop[]
		if (isAkamai(lastHops[0])) {
			// Somewhat easy, we at least have Akamai
			
			reachedAkamai = true
			if (portions.at(-1)) {
				const transitionIsPending = portions.at(-1)!.hops.at(-1)?.kind === 'Pending'
				clarifyNoResponseIfNeeded(portions.at(-1)!.hops, transitionIsPending)
			}

			const prevNetworkName = (prevHop.kind === 'Done' && prevHop.networkInfo?.network?.name.trim?.())
				?? (prevHop.kind === 'Done' && prevHop.networkInfo?.network?.asn && 'AS' + prevHop.networkInfo.network.asn)
				?? 'that network'

			networkTypeCounts['Content']++
			const prefix = {
				'0':   `After a couple of hops${lastWasSideNote ? '' : ', however'}`,
				'1-3': 'Eventually',
				'4+':  'After all that'
			}[intermediates]
			pushParagraph(`
				${prefix}, you needed to leave the realm of ${prevNetworkName}
				to reach my server. You went through Akamai’s network (AS${AKAMAI_ASN}) — they’re a large CDN with
				many points of presence on the Internet, so it makes sense that you might get routed through them.
				That said, Akamai also bought Linode (our server provider) a couple of years back, so it makes sense
				that they would set themselves up as a good path to Linode’s network.
			`)

			hopsBeforeLinode = []
			while (!(isLinodeEntrypoint(lastHops[0]) || isLinodeInternal(lastHops[0]) || isServer(lastHops[0]))) {
				hopsBeforeLinode.push(lastHops.shift()!)
			}
		} else {
			hopsBeforeLinode = portions.at(-1)?.hops ?? []
		}

		const prefix = {
			'0':   reachedAkamai ? 'After Akamai' : 'Eventually',
			'1-3': reachedAkamai ? 'After Akamai' : 'Finally',
			'4+':  reachedAkamai ? 'Finally'      : 'After all that'
		}[intermediates]
		if (isLinodeEntrypoint(lastHops[0])) {
			// Easy, we have the Linode entrypoint
			
			clarifyNoResponseIfNeeded(hopsBeforeLinode.slice(-1), true)
			clarifyNoResponseIfNeeded(lastHops, false)

			pushParagraph(`
				${prefix}, you ended up at ${lastHops[0].hostname ?? lastHops[0].ip}, your entrypoint to Linode’s network.
				From there, you were bounced around Linode’s internal network a bit before finally reaching our server.
			`)
			if (lastHops[0].hostname) clarifyHostname(lastHops[0])
		} else {
			// We don't have the Linode endpoint
			
			let unknownHopCount = 0
			while (lastHops.at(-1 - unknownHopCount)?.kind === 'Pending') unknownHopCount++

			pushParagraph(`
				${prefix}, we have ${didClarifyNoResponse ? 'another' : 'a'} probe that didn't respond.
				${unknownHopCount >= 2 ? 'One of these' : 'This'} is most likely your entrypoint to Linode's network.
				From there, you were bounced around Linode’s internal network a bit before finally reaching our server.
			`)
		}
	}

	return paragraphs
}