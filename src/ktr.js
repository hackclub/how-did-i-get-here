import childProcess from 'node:child_process'
import EventEmitter from 'node:events'
import split from 'split'

export function startKtrAgent() {
	const agent = childProcess.spawn(process.env.KTR_AGENT_PATH, [
		'--interface-name', process.env.TRACEROUTE_INTERFACE_NAME,
		'--peeringdb-path', process.env.PEERINGDB_PATH,
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

	const exec = (command) => agent.stdin.write(`${JSON.stringify(command)}\n`)
	const genCommandId = () => Math.floor(Math.random() * 1000000)

	const startedTraces = {} // Association between commandId and function that takes traceId
	const traceHandlers = [] // Association between traceId and update handler

	const splitter = split(JSON.parse, undefined, { trailing: false /* don't crash on EOF, we handle it in "exit" event */ })
	agent.stdout.pipe(splitter).on('data', (output) => {
		if (output.kind === 'StartedTrace') {
			startedTraces[output.commandId]?.(output.traceId)
		} else if (output.id !== undefined) {
			traceHandlers[output.id]?.(output)
		} else {
			console.error('Unknown output', output)
		}
	})

	function trace(ip) {
		const emitter = new EventEmitter()
		const commandId = genCommandId()
		startedTraces[commandId] = (traceId) => {
			delete startedTraces[commandId]
			traceHandlers[traceId] = (update) => emitter.emit('update', update)
		}
		exec({ kind: 'StartTrace', commandId, ip })
		return emitter
	}

	return { trace }
}

function getKtrVersion() {
	const res = childProcess.spawnSync(process.env.KTR_AGENT_PATH, [ '--version' ], { stdio: [ 'ignore', 'pipe', 'inherit' ] })
	if (res.error) throw res.error
	return res.stdout.toString().split(' ').at(-1).trim()
}

export const ktrVersion = getKtrVersion()