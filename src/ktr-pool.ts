import { startKtrAgent } from './ktr.js'

const KTR_POOL = Array.from({ length: 15 }, () => startKtrAgent())
let poolIndex = 0

export function getKtr(): ReturnType<typeof startKtrAgent> {
	const ktr = KTR_POOL[poolIndex]
	poolIndex = (poolIndex + 1) % KTR_POOL.length
	return ktr
}
