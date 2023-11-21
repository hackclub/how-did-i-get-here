import dotenv from 'dotenv'
dotenv.config()

const requireEnv = (name: string): string => {
	if (process.env[name]) {
		return process.env[name]!
	} else {
		throw new Error(`Missing environment variable: ${name}`)
	}
}

export const KTR_AGENT_PATH = requireEnv('KTR_AGENT_PATH')
export const TRACEROUTE_INTERFACE_NAME = requireEnv('TRACEROUTE_INTERFACE_NAME')
export const PEERINGDB_PATH = requireEnv('PEERINGDB_PATH')
export const PORT = parseInt(process.env.PORT ?? '3000')
export const SERVER_HOST = process.env.SERVER_HOST ?? 'localhost'
export const SERVER_IP = process.env.SERVER_IP ?? '127.0.0.1'
export const LINODE_ASN = 63949
export const AKAMAI_ASN = 20940