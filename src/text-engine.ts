import type { ControllerResult_TraceDone, Hop, Hop_Done, Hop_FindingAsn, NetworkInfo } from './ktr-types.js'

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
		const keyMatches = lastPortion && lastPortion.key.kind === hop.kind && (hop.kind === 'Pending' || lastPortion.key.networkInfo?.asn === hop.networkInfo?.asn)

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

	const linodePortion = portions.at(-1)!
	if (linodePortion?.key.networkInfo?.network?.asn !== 63949) console.error('WARNING: last portion is not Linode')

	const akamaiPortion = portions.at(-2)?.key?.networkInfo?.network?.asn === 20940 ? portions.at(-2)! : null // Second-to-last portion if Akamai, else null

	// Start text generation
	const paragraphs: string[] = []
	const para = (strings: TemplateStringsArray, ...values: unknown[]) => String.raw({ raw: strings }, ...values).trim().replace(/\s+/g, ' ')

	let prevPortion = portions[0]!

	function firstSegment(portion: Portion, includesFirst: boolean, thatRouter: boolean) {
		if (portion.key.networkInfo && portion.key.networkInfo.network) {
			const network = portion.key.networkInfo.network

			let text = ''
			text += includesFirst ? `Starting at ` : `Traveling from `
			text += thatRouter ? 'that router, ' : 'your router, '
			text += 'the first portion of your trip went through '
			text += portion.size === 1 ? 'a device ' : 'devices '
			text += `in ${network.organization.name.trim()}'s network. `

			if (network.networkType === 'ISP') {
				text += `That’s probably your ISP, responsible for connecting you to the Internet in exchange for money.`
			} else {
				text += `That’s the first network we have any info on; chances are whoever handles your Internet is paying them for Internet access.`
			}

			paragraphs.push(text)
		} else if (portion.key.networkInfo) {
			paragraphs.push(para`
				The first portion of your trip went through ${portion.size === 1 ? 'a device' : 'devices'} in the network
				AS${portion.key.networkInfo.asn}. I couldn’t find any information on it aside from its autonomous system number,
				but chances are whoever handles your Internet is paying them for Internet access.
			`)
		} else {
			paragraphs.push(para`
				After ${thatRouter ? 'that' : 'your'} router, you took a trip through ${portion.size === 1 ? 'a device ' : 'some devices'} in an unknown network,
				probably internal to whatever network your computer is connected to.
			`)
		}
	}

	let didClarifyHostname = false
	function clarifyHostname(hop: Hop_Done) {
		if (didClarifyHostname) return
		paragraphs.push(para`
			(By the way, that ${hop.hostname} stuff is a reverse DNS lookup I did by asking our DNS server if there’s any
			name associated with the IP, ${hop.ip}. Since there was, I used the “pretty” human-readable name instead of
			the numbers. Reverse DNS names are usually just designed to make debugging easier, and often don’t even map
			back to the original IP.)
		`)
		didClarifyHostname = true
	}

	function tryEnd() {
		const portion = portions[0]

		if (portion === akamaiPortion) {
			const networkName = prevPortion.key.networkInfo?.network?.organization?.name?.trim?.()
				?? (prevPortion.key.networkInfo?.network?.asn && 'AS' + prevPortion.key.networkInfo.network.asn)
				?? 'that network'

			paragraphs.push(para`
				After a couple of hops, however, you needed to leave the realm of ${networkName} to reach my server.
				You went through Akamai’s network (AS${portion.key.networkInfo!.asn}) — they’re a large CDN with many
				points of presence on the Internet, so it makes sense that you might get routed through them. That
				said, Akamai also bought Linode (our server provider) a couple of years back, so it makes sense that
				they would set themselves up as a good path to Linode’s network.
			`)
			
			prevPortion = portions.shift()!
			tryEnd() // Defer to end segment
			return true
		} else if (portion === linodePortion) {
			const firstHop = portion.hops[0] as Hop_Done

			paragraphs.push(para`
				${prevPortion === akamaiPortion ? 'After Akamai' : 'Eventually'}, you ended up at ${firstHop.hostname ?? firstHop.ip},
				your entrypoint to Linode’s network. From there, you were bounced around Linode’s internal network a bit before finally
				reaching our server.
			`)
			if (firstHop.hostname) clarifyHostname(firstHop)

			return true
		}

		return false
	}

	{
		const portion = portions.shift()!

		const user = portion.hops.shift()!
		if (user.kind === 'Pending') {
			paragraphs.push(para`
				Your journey to load this website started with your computer talking to your router. That router, your entrypoint
				to your ISP’s network, didn’t actually respond to my ping — this is pretty common for public routers — so we just
				have to imagine its existence at the start of the traceroute.
			`)
			// Note: there can never be a second pending hop at the start of the traceroute, they're pruned beforehand.
			prevPortion = portion
			firstSegment(portions.shift()!, false, false)
		} else { // Done
			paragraphs.push(para`
				Your journey to load this website started with your computer talking to your router. That router, your entrypoint
				to your ISP’s network, is the first item you’ll see in the traceroute alongside your public IP: ${user.ip}.
			`)

			if (portion.size === 0) { // Only first hop was in this portion
				prevPortion = portion
				firstSegment(portions.shift()!, false, true)
			} else { // >= 1 remaining
				firstSegment(portion, true, true)
			}
		}

		prevPortion = portion
	}

	while (portions.length > 0) {
		if (tryEnd()) return paragraphs
		const portion = portions.shift()!

		paragraphs.push('[Beep boop! This paragraph needs content written.]')

		prevPortion = portion
	}

	tryEnd()
	return paragraphs
}

// import _lastUpdate from './last-update.js'
// console.log(generateText(_lastUpdate as ControllerResult_TraceDone).join('\n\n'))