import childProcess from 'node:child_process'
import EventEmitter from 'node:events'
import split from 'split'
import type { Command, ControllerResult, Output } from './ktr-types.ts'

export interface TraceEmitter extends EventEmitter {
	on(event: 'update', listener: (update: ControllerResult) => void): this
	emit(event: 'update', update: ControllerResult): boolean
}

export function startKtrAgent() {
	const agent = childProcess.spawn(process.env.KTR_AGENT_PATH!, [
		'--interface-name', process.env.TRACEROUTE_INTERFACE_NAME!,
		'--peeringdb-path', process.env.PEERINGDB_PATH!,
		'--disable-ipv6',
		'--completion-timeout', '1s',
		'--wait-time-per-hop', '100ms'
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

	const splitter = split(JSON.parse, undefined, { trailing: false /* don't crash on EOF, we handle it in "exit" event */ })
	agent.stdout.pipe(splitter).on('data', (output: Output) => {
		if (output.kind === 'StartedTrace') {
			startedTraces[output.commandId]?.(output.traceId)
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

	return { trace }
}

function getKtrVersion() {
	const res = childProcess.spawnSync(process.env.KTR_AGENT_PATH!, [ '--version' ], { stdio: [ 'ignore', 'pipe', 'inherit' ] })
	if (res.error) throw res.error
	return res.stdout.toString().split(' ').at(-1)!.trim()
}

export const ktrVersion = getKtrVersion()