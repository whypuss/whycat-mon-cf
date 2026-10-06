import type { ProbeLabels, ProbeTarget } from '@/types/cfsm'

export const LEGACY_PROBE_TARGETS = ['ct', 'cu', 'cm', 'bd'] as const
export const NODE_PROBE_TARGETS = ['node_1', 'node_2', 'node_3', 'node_4'] as const
export const PROBE_TARGETS = [
  ...LEGACY_PROBE_TARGETS,
  ...NODE_PROBE_TARGETS,
] as const satisfies readonly ProbeTarget[]

export const DEFAULT_PROBE_LABELS: Readonly<ProbeLabels> = Object.freeze({
  ct: '电信',
  cu: '联通',
  cm: '移动',
  bd: 'BGP',
  node_1: 'Node 1',
  node_2: 'Node 2',
  node_3: 'Node 3',
  node_4: 'Node 4',
})
