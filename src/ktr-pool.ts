import { startKtrAgent } from './ktr.js'

const POOL_SIZE = 40
const pool: Array<ReturnType<typeof startKtrAgent>> = []
const waiting: Array<(value: ReturnType<typeof startKtrAgent>) => void> = []

for (let i = 0; i < POOL_SIZE; i++) {
	pool.push(startKtrAgent())
}

export function getKtrAgent(): Promise<ReturnType<typeof startKtrAgent>> {
	return new Promise((resolve) => {
		if (pool.length > 0) {
			resolve(pool.pop()!)
		} else {
			waiting.push(resolve)
		}
	})
}

export function releaseKtrAgent(ktr: ReturnType<typeof startKtrAgent>) {
	if (waiting.length > 0) {
		waiting.shift()!(ktr)
	} else {
		pool.push(ktr)
	}
}