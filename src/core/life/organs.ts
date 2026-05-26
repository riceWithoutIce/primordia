import type { GridPoint } from "../types";

export const ORGAN_CAPABILITIES = ["sense-pulse", "trace-mark", "resource-probe", "micro-repair"] as const;

export type OrganCapabilityId = (typeof ORGAN_CAPABILITIES)[number];

export type OrganActionIntent = "sense" | "mark-trace" | "probe-resource" | "repair-pressure";

export type OrganTarget =
  | {
      kind: "cell";
      point: GridPoint;
      radius: number;
    }
  | {
      kind: "agent";
      agentId: number;
    };

export type OrganRefusalReason =
  | "unknown-capability"
  | "unsafe-request"
  | "missing-capability"
  | "insufficient-budget"
  | "invalid-target"
  | "out-of-range"
  | "blocked-terrain"
  | "rate-limited"
  | "inactive-agent";

export interface OrganActionCost {
  energy: number;
  organBudget: number;
  pressure: number;
  trace: number;
}

export interface OrganActionRequest {
  capabilityId: OrganCapabilityId;
  agentId: number;
  intent: OrganActionIntent;
  target: OrganTarget;
  cost: OrganActionCost;
}

export interface OrganActionAccepted {
  accepted: true;
  capabilityId: OrganCapabilityId;
  agentId: number;
  intent: OrganActionIntent;
  target: OrganTarget;
  cost: OrganActionCost;
}

export interface OrganActionRefused {
  accepted: false;
  capabilityId: OrganCapabilityId | "unknown";
  agentId: number | null;
  intent: OrganActionIntent | "unknown";
  target: OrganTarget | null;
  refusalReason: OrganRefusalReason;
}

export type OrganActionOutcome = OrganActionAccepted | OrganActionRefused;

export interface OrganAuditRecord {
  tick: number;
  accepted: boolean;
  capabilityId: OrganCapabilityId | "unknown";
  agentId: number | null;
  intent: OrganActionIntent | "unknown";
  targetKind: OrganTarget["kind"] | "none";
  refusalReason: OrganRefusalReason | null;
  budgetSpent: number;
}

export function isOrganCapabilityId(value: string): value is OrganCapabilityId {
  return (ORGAN_CAPABILITIES as readonly string[]).includes(value);
}

export function createOrganCost(cost: Partial<OrganActionCost> = {}): OrganActionCost {
  return {
    energy: Math.max(0, cost.energy ?? 0),
    organBudget: Math.max(0, cost.organBudget ?? 0),
    pressure: Math.max(0, cost.pressure ?? 0),
    trace: Math.max(0, cost.trace ?? 0)
  };
}

export function refuseOrganAction(
  reason: OrganRefusalReason,
  request?: Partial<OrganActionRequest>
): OrganActionRefused {
  return {
    accepted: false,
    capabilityId: request?.capabilityId ?? "unknown",
    agentId: request?.agentId ?? null,
    intent: request?.intent ?? "unknown",
    target: request?.target ?? null,
    refusalReason: reason
  };
}

export function auditOrganOutcome(tick: number, outcome: OrganActionOutcome): OrganAuditRecord {
  if (outcome.accepted) {
    return {
      tick,
      accepted: true,
      capabilityId: outcome.capabilityId,
      agentId: outcome.agentId,
      intent: outcome.intent,
      targetKind: outcome.target.kind,
      refusalReason: null,
      budgetSpent: outcome.cost.organBudget
    };
  }

  return {
    tick,
    accepted: false,
    capabilityId: outcome.capabilityId,
    agentId: outcome.agentId,
    intent: outcome.intent,
    targetKind: outcome.target?.kind ?? "none",
    refusalReason: outcome.refusalReason,
    budgetSpent: 0
  };
}
