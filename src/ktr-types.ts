export interface Organization {
	id: number
	name: string
	url: string
}

export type GeographicScope = 'Regional' | 'NorthAmerica' | 'AsiaPacific' | 'Europe' | 'SouthAmerica' | 'Africa' | 'Australia' | 'MiddleEast' | 'Global' | 'Other'

export type NetworkType = 'NSP' | 'Content' | 'ISP' | 'Enterprise' | 'Educational' | 'NonProfit' | 'RouteServer' | 'NetworkServices' | 'RouteCollector' | 'Government' | 'Other'

export interface NetworkProtocols {
	unicastIpv4: boolean
	multicast: boolean
	ipv6: boolean
	neverViaRouteServers: boolean
}

export interface Network {
	id: number
	name: string
	organization: Organization
	url: string
	geographicScope: GeographicScope
	asn: number
	networkType: NetworkType
	protocols: NetworkProtocols
}

export interface NetworkInfo {
	asn: number
	network: Network | null
}

export interface Hop_Pending {
	kind: 'Pending'
	id: number
}

export interface Hop_FindingAsn {
	kind: 'FindingAsn'
	id: number
	ip: string
}

export interface Hop_Done {
	kind: 'Done'
	id: number
	ip: string
	hostname: string | null
	networkInfo: NetworkInfo | null
}

export type Hop = Hop_Pending | Hop_FindingAsn | Hop_Done

export type TerminationReason = 'Done' | 'DestinationUnreachable' | 'DestinationTimeout' | 'CompletionTimeout'

interface TraceError {
	kind: 'Traceroute' | 'AsnLookup' | 'PeeringDb' | 'Rdns'
	message: string
}

export interface SafeTerminationReason_Termination {
	kind: 'Termination'
	reason: TerminationReason
}

export interface SafeTerminationReason_Error {
	kind: 'Error'
	error: TraceError
}

export type SafeTerminationReason = SafeTerminationReason_Termination | SafeTerminationReason_Error

export interface ControllerResult_TraceUpdate {
	kind: 'TraceUpdate'
	id: number
	hops: Hop[]
}

export interface ControllerResult_TraceDone {
	kind: 'TraceDone'
	id: number
	hops: Exclude<Hop, Hop_FindingAsn>[]
	reason: SafeTerminationReason
}

export type ControllerResult = ControllerResult_TraceUpdate | ControllerResult_TraceDone

export interface Output_StartedTrace {
	kind: 'StartedTrace'
	commandId: number
	traceId: number
}

export type Output = Output_StartedTrace | ControllerResult

export interface Command_StartTrace {
	kind: 'StartTrace'
	commandId: number
	ip: string
}

export type Command = Command_StartTrace