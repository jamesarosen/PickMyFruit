/**
 * Public API surface for @pickmyfruit/kokoto.
 *
 * The runtime itself (`DurableRuntime`, `createRuntime`) lives in
 * `./runtime.server` so callers that only need the type-level definitions
 * (e.g. `defineWorkflow`) can import them from the client graph.
 */

export { defineQueue, defineWorkflow, WorkflowRegistry } from './registry.ts'

export {
	BootIntegrityError,
	DurableCancelledError,
	DurableTimeoutError,
	KokotoError,
	PayloadTooLargeError,
	ReplayedStepError,
	UnknownWorkflowError,
} from './errors.ts'

export {
	KOKOTO_DDL,
	KOKOTO_TABLES,
	PAYLOAD_BYTE_CAP,
	PROTOCOL_VERSION,
	createSchemaSQL,
} from './schema.server.ts'

export { Metrics } from './telemetry.server.ts'

export type {
	DefineQueueOptions,
	DefineWorkflowOptions,
	KokotoTelemetry,
	QueueDefinition,
	RuntimeConfig,
	RuntimeStartConfig,
	SqlClient,
	SqlResult,
	SqlTransaction,
	StartWorkflowOptions,
	StepStatus,
	WorkflowContext,
	WorkflowDefinition,
	WorkflowFn,
	WorkflowHandle,
	WorkflowStatus,
} from './types.ts'
