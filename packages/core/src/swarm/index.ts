/**
 * Swarm Module
 *
 * Multi-agent orchestration using specialized subagents.
 */

export * from './types';
export { SwarmCoordinator } from './coordinator';
export type { SwarmCoordinatorContext } from './coordinator';
export {
  TaskGraph,
  TaskGraphScheduler,
  aggregateTaskResults,
  DEFAULT_SCHEDULER_OPTIONS,
} from './task-graph';
export type {
  TaskDefinition,
  TaskExecutionResult,
  SchedulerOptions,
} from './task-graph';
export { SwarmMemory, createSwarmMemoryTools } from './memory';
export type {
  SwarmMemoryCategory,
  SwarmMemoryEntry,
  SwarmMemoryQuery,
  SwarmMemoryStats,
} from './memory';
export { SwarmDecisionPolicy, DEFAULT_DECISION_POLICY } from './decision-policy';
export type {
  ComplexityLevel,
  RiskLevel,
  SwarmTriggerReason,
  SwarmDecision,
  TaskAnalysis,
  DecisionPolicyConfig,
} from './decision-policy';
export { SwarmPolicyEnforcer } from './policy-enforcer';
export type {
  EnforcementContext,
  EnforcementResult,
  EnforcementCheckType,
} from './policy-enforcer';
export { TaskGraphBuilder, DEFAULT_BUILDER_OPTIONS } from './graph-builder';
export {
  SwarmAgentSelector,
  createSwarmAgentSelector,
  DEFAULT_SELECTOR_CONFIG,
} from './agent-selector';
export type {
  TaskAgentAssignment,
  AgentRequirements,
  AssignmentPlan,
  AssignmentStats,
  AgentSelectorConfig,
} from './agent-selector';
export {
  SwarmDispatcher,
  createSwarmDispatcher,
  DEFAULT_DISPATCHER_CONFIG,
} from './dispatcher';
export type {
  DispatchTask,
  DispatchTaskStatus,
  DispatcherEvent,
  DispatcherEventType,
  DispatcherEventListener,
  DispatcherConfig,
  DispatcherStats,
  DispatchResult,
} from './dispatcher';
export {
  SwarmResultsAggregator,
  createSwarmAggregator,
  quickAggregate,
  DEFAULT_AGGREGATOR_CONFIG,
} from './aggregator';
export type {
  AggregationStrategy,
  ConflictResolution,
  TaskResultInput,
  AggregatedSection,
  AggregationMetadata,
  AggregatedResult,
  AggregatorConfig,
} from './aggregator';
export type {
  TaskOutput,
  ExtendedTaskDefinition,
  PlannerOutput,
  GraphBuilderOptions,
} from './graph-builder';
