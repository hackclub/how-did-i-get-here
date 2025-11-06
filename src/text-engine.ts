import './env.js'
import { HETZNER_ASN, SERVER_HOST, SERVER_IP } from './env.js'
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

	// Merge pending portions by sandwiching or favoring the first portion:
	// - <[Comcast]> <[Pending]> <[Comcast]> -> <[Comcast, Pending, Comcast]>)
	// - <[Comcast]> <[Pending]> <[Akamai]> -> <[Comcast, Pending]> <[Akamai]>
	for (let i = 0; i < portions.length - 2; i++) {
		const [ first, middle, last ] = portions.slice(i, i + 3)

		const canMerge = first.key.kind === 'Done' && middle.key.kind === 'Pending'
		const canSandwichMerge = first.key.networkInfo?.asn === last.key.networkInfo?.asn
			|| (first.key.networkInfo?.network && first.key.networkInfo?.network?.organization.id === last.key.networkInfo?.network?.organization.id)

		if (canMerge) {
			if (canSandwichMerge) {
				first.hops.push(...middle.hops)
				first.hops.push(...last.hops)
				portions.splice(i + 1, 2)
				i--
			} else {
				// portions.splice(i + 1, 1)
			}
		}
	}

	// console.log(portions.map(p => p.hops.map(h => h.kind === 'Done' ? h.hostname ?? h.ip : '(pending)')))

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
		Nsp: 0,
		Content: 0,
		Isp: 0,
		NspOrIsp: 0,
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
			case 'Nsp': {
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
			case 'Isp': {
				long = 'an Internet service provider'
				short = 'ISP'
				shortArticle = 'an'
				shortSupportsAnother = true
				break
			}
			case 'NspOrIsp': {
				long = 'either an ISP or a provider that sells Internet access to other companies'
				short = 'NSP/ISP'
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
		isStraightEntryFromIsp = false
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
			text += `in ${network.organization.name.trim()}’s `
			text += uniqueNetworks.size === 1 ? 'network' : 'networks'
			if (!areNamesSimilar(network.name, network.organization.name)) text += `, ${network.name.trim()}`
			text += '. '

			if (network.networkType === 'Isp') {
				networkTypeCounts['Isp']++
				text += `That’s probably your ISP, responsible for connecting you to the Internet in exchange for money.`
			} else if (network.networkType === 'Nsp' || network.networkType === 'NspOrIsp') {
				networkTypeCounts['Isp']++ // Not a typo
				text += `That’s either your ISP, responsible for connecting you to the Internet in exchange for money, or a company your Internet provider contracts.`
			} else {
				text += `
					That’s the first network I have any info on; chances are whoever handles your Internet is paying them
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
			(Side note, that ${hop.hostname} thing is the result of a reverse DNS lookup I did by asking my DNS server
			if there’s any name associated with the IP actually returned in the traceroute, ${hop.ip}. Since there was, I used the “pretty” human-readable
			name instead of the numbers. Reverse DNS names are usually only designed to make debugging easier, and often
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
	let isStraightEntryFromIsp = true
	{
		const portion = portions.shift()!
		
		const user = portion.hops.shift()!
		if (user.kind === 'Pending') {
			pushParagraph(`
				This journey began with your computer talking to your router. That router, your entrypoint to your ISP’s network,
				didn’t actually respond to my ping — this is pretty common for public routers or if you're behind a VPN — so we
				just have to imagine its existence at the start of the traceroute.
			`)
			// Note: there can never be a second pending hop at the start of the traceroute, they're pruned beforehand.
			const nextPortion = portions.shift()
			if (nextPortion) firstSegment(nextPortion, false, false)
		} else { // Done
			if (user.networkInfo?.network?.networkType === 'Isp') {
				pushParagraph(`
					This journey began with your computer talking to your router. That router, your entrypoint to your ISP’s
					network, is the first item you’ll see in the traceroute ${user.hostname ? 'and is associated with' : 'alongside'}
					your public IP: ${user.ip}.
				`)
			} else {
				pushParagraph(`
					This journey began with your computer talking to your router. That router, your entrypoint to the Internet,
					may be the first item you see in the traceroute (${user.hostname ? 'associated with' : 'alongside'} your
					public IP, ${user.ip}). Alternately, you may be behind a VPN of some sort — in that case, the earliest point
					we can track is the Internet-facing router that your packets are being sent through.
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
		if (!isStraightEntryFromIsp && portions[0]?.key?.kind === 'Pending') {
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
			if (!isStraightEntryFromIsp && portion === portions.at(-1)) { // Not the last one yet, because this might be a transition to the end
				clarifyNoResponseIfNeeded(portion.hops, false)
			}
			isStraightEntryFromIsp = false
			if (portion.key.kind === 'Done') prevHop = portion.hops.at(-1)!
		}
	}

	// Ending
	{
		function isServer(hop: Hop): hop is Hop_Done {
			return hop.kind === 'Done' && hop.ip === SERVER_IP && hop.hostname === SERVER_HOST
		}
		function isHetznerEntrypoint(hop: Hop): hop is Hop_Done {
			return hop.kind === 'Done' && hop.networkInfo?.asn === HETZNER_ASN && !isServer(hop)
		}

		const getPrefix = () => isStraightEntryFromIsp
			? 'Anyways, '
			: {
				'0':   `${lastWasSideNote ? 'Anyways, a' : 'A'}fter a couple of hops`,
				'1-3': 'Eventually',
				'4+':  'After all that',
			}[intermediates]
		if (isHetznerEntrypoint(lastHops[0])) {
			// Easy, we have the Hetzner entrypoint
			
			if (!isStraightEntryFromIsp) {
				clarifyNoResponseIfNeeded((portions.at(-1)?.hops ?? []).slice(-1), true)
			}
			clarifyNoResponseIfNeeded(lastHops, false)

			const prevNetworkName = (prevHop.kind === 'Done' && prevHop.networkInfo?.network?.name.trim?.())
				|| (prevHop.kind === 'Done' && prevHop.networkInfo?.network?.asn && 'AS' + prevHop.networkInfo.network.asn)
				|| 'that network'

			pushParagraph(`
				${getPrefix()}, you needed to leave the realm of ${prevNetworkName}
				to reach my server.
				I use Hetzner as a hosting provider, and your entrypoint to their realm was ${lastHops[0].hostname ?? lastHops[0].ip}.
				From there, you were bounced around Hetzner’s internal network a bit before finally reaching my server.
			`)
			if (lastHops[0].hostname) clarifyHostname(lastHops[0])
		} else {
			// We don't have the Hetzner endpoint
			
			let unknownHopCount = 0
			while (lastHops.at(-1 - unknownHopCount)?.kind === 'Pending') unknownHopCount++

			pushParagraph(`
				${getPrefix()}, we have ${didClarifyNoResponse ? 'another' : 'a'} probe that didn't respond.
				${unknownHopCount >= 2 ? 'One of these' : 'This'} is most likely your entrypoint to Hetzner’s network (they're my hosting provider).
				From there, you were bounced around Hetzner’s internal network a bit before finally reaching my server.
			`)
		}
	}

	return paragraphs
}

export function generateEssayTracerouteInfo(hops: Hop[]) {
	const hopAsns = hops
		.map(hop => hop.kind === 'Done' ? hop.networkInfo?.asn ?? null : null)
		.filter(asn => asn !== null) as number[]

	// Calculate frequency of different networks
	const frequency: Record<number, number> = {}
	for (let i = 0; i < hopAsns.length; i++) frequency[hopAsns[i]] = (frequency[hopAsns[i]] ?? 0) + 1

	// Get ASN with highest frequency
	let highestFrequency = 0
	let highestFrequencyAsn: number | null = null
	for (const [ asn, freq ] of Object.entries(frequency)) {
		if (Number(asn) === HETZNER_ASN) continue
		if (freq > highestFrequency) {
			highestFrequency = freq
			highestFrequencyAsn = Number(asn)
		}
	}
	if (highestFrequency <= 2) {
		// Try again but allow Hetzner (yeah I know this is probably bad code)
		for (const [ asn, freq ] of Object.entries(frequency)) {
			if (freq > highestFrequency) {
				highestFrequency = freq
				highestFrequencyAsn = Number(asn)
			}
		}
	}

	// Find the network info of that ASN
	let highestFrequencyNetworkInfo: NetworkInfo | null = null
	for (const hop of hops) {
		if (hop.kind === 'Done' && hop.networkInfo?.asn === highestFrequencyAsn) {
			highestFrequencyNetworkInfo = hop.networkInfo
			break
		}
	}
	const cardinals = [ 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine' ]
	const showHighestFrequencyNetwork = highestFrequency >= 2
	const highestFrequencyNetworkName = highestFrequencyNetworkInfo?.network?.name.trim() ?? ('AS' + highestFrequencyAsn)
	const highestFrequencyNetworkCount = (highestFrequency <= 3 ? 'the ' : 'all ')
		+ (cardinals[highestFrequency - 1] ?? highestFrequency.toString())

	// Deduplicate
	for (let i = 0; i < hopAsns.length - 1; i++) {
		if (hopAsns[i] === hopAsns[i + 1]) {
			hopAsns.splice(i, 1)
			i--
		}
	}
	
	const hopAsnStrings = hopAsns.map(asn => 'AS' + asn)
	
	let connection: [string, string] | null = null
	for (let i = 0; i < hopAsns.length - 1; i++) {
		if (hopAsns[i] && hopAsns[i + 1]) {
			connection = [ 'AS' + hopAsns[i], 'AS' + hopAsns[i + 1] ]
			break
		}
	}

	return {
		hopAsnStrings,
		connection,
		showHighestFrequencyNetwork,
		highestFrequencyNetworkName,
		highestFrequencyNetworkCount
	}
}