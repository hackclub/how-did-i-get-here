import { KTR_AGENT_PATH, TRACEROUTE_INTERFACE_NAME, PEERINGDB_PATH } from './env.js'
import childProcess from 'node:child_process'
import EventEmitter from 'node:events'
import split from 'split'
import semver from 'semver'
import type { Command, ControllerResult, Network, Output } from './ktr-types.js'

// Update this if when you add code relying on new ktr features
const KTR_VERSION_SPEC = '^0.5.2'

export interface TraceEmitter extends EventEmitter {
	on(event: 'update', listener: (update: ControllerResult) => void): this
	emit(event: 'update', update: ControllerResult): boolean
}

export function startKtrAgent() {
	const agent = childProcess.spawn(KTR_AGENT_PATH, [
		'--interface-name', TRACEROUTE_INTERFACE_NAME,
		'--peeringdb-path', PEERINGDB_PATH,
		'--disable-ipv6',
		'--completion-timeout', '1s',
		'--destination-timeout', '1s',
		'--wait-time-per-hop', '150ms'
	], { stdio: [ 'pipe', 'pipe', 'inherit' ] })

	agent.on('error', (err) => {
		console.error('KTR agent error', err)
		process.exit(1)
	})

	agent.on('exit', (code) => {
		console.error(`KTR agent exited with code ${code}`)
		process.exit(1)
	})

	const exec = (command: Command) => agent.stdin.write(`${JSON.stringify(command)}\n`)
	const genCommandId = () => Math.floor(Math.random() * 1000000)

	const startedTraces: Record<number, (traceId: number) => void> = {} // commandId -> trace handler adder
	const traceHandlers: ((result: ControllerResult) => void)[] = [] // traceId -> update handler
	const asnHandlers: Record<number, (network: Network | null) => void> = {} // asn -> asn handler

	const splitter = split(JSON.parse, undefined, { trailing: false /* don't crash on EOF, we handle it in "exit" event */ })
	agent.stdout.pipe(splitter).on('data', (output: Output) => {
		if (output.kind === 'StartedTrace') {
			startedTraces[output.commandId]?.(output.traceId)
		} else if (output.kind === 'LookupAsnResult') {
			asnHandlers[output.commandId]?.(output.network)
			delete asnHandlers[output.commandId]
		} else if (output.id !== undefined) {
			traceHandlers[output.id]?.(output)
		} else {
			console.error('Unknown output', output)
		}
	})

	function trace(ip: string): TraceEmitter {
		const emitter: TraceEmitter = new EventEmitter()
		const commandId = genCommandId()
		startedTraces[commandId] = (traceId: number) => {
			delete startedTraces[commandId]
			traceHandlers[traceId] = (update) => emitter.emit('update', update)
		}
		exec({ kind: 'StartTrace', commandId, ip })
		return emitter
	}

	function lookupAsn(asn: number): Promise<Network | null> {
		return new Promise((resolve) => {
			const commandId = genCommandId()
			asnHandlers[commandId] = resolve
			exec({ kind: 'LookupAsn', commandId, asn })
		})
	}

	return { trace, lookupAsn }
}

function getKtrVersion() {
	const res = childProcess.spawnSync(KTR_AGENT_PATH, [ '--version' ], { stdio: [ 'ignore', 'pipe', 'inherit' ] })
	if (res.error) throw res.error
	return res.stdout.toString().split(' ').at(-1)!.trim()
}

export const ktrVersion = getKtrVersion()
if (!semver.satisfies(ktrVersion, KTR_VERSION_SPEC)) {
	console.error(`Invalid ktr version ${ktrVersion} (does not satisfy ${KTR_VERSION_SPEC})`)
	process.exit(1)
}