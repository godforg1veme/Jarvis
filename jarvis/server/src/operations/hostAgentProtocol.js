const { z } = require('zod');

const PROTOCOL_VERSION = 1;
const MAX_ENVELOPE_BYTES = 64 * 1024;
const MAX_ERROR_CODE_LENGTH = 80;

const REQUEST_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SERVICE_ID = /^[a-z][a-z0-9_-]{0,63}$/;

const operationArguments = {
  'host.snapshot': z.object({}).strict(),
  'inventory.snapshot': z.object({}).strict(),
  'services.snapshot': z.object({}).strict(),
  'service.logs.read': z.object({
    serviceId: z.string().regex(SERVICE_ID),
    after: z.string().datetime({ offset: true }).optional(),
    before: z.string().datetime({ offset: true }).optional(),
    maxLines: z.number().int().min(1).max(500).default(200),
  }).strict(),
  'service.start': z.object({ serviceId: z.string().regex(SERVICE_ID) }).strict(),
  'service.stop': z.object({ serviceId: z.string().regex(SERVICE_ID) }).strict(),
  'service.restart': z.object({ serviceId: z.string().regex(SERVICE_ID) }).strict(),
  'backup.status': z.object({}).strict(),
  'backup.run': z.object({}).strict(),
  'parser.snapshot': z.object({}).strict(),
  'operation.status': z.object({ requestId: z.string().regex(REQUEST_ID) }).strict(),
  'vpn.status': z.object({}).strict(),
  'vpn.clients.list': z.object({}).strict(),
  'vpn.client.issue': z.object({
    label: z.string().trim().min(1).max(40).regex(/^[A-Za-zА-Яа-яЁё0-9_. -]+$/).refine((value) => !value.includes('..')),
  }).strict(),
  'vpn.client.revoke': z.object({ clientId: z.string().regex(/^vpn-[a-f0-9]{12}$/) }).strict(),
  'vpn.client.rotate': z.object({ clientId: z.string().regex(/^vpn-[a-f0-9]{12}$/) }).strict(),
  'vpn.client.export': z.object({ clientId: z.string().regex(/^vpn-[a-f0-9]{12}$/) }).strict(),
  'vpn.restart': z.object({}).strict(),
  'vpn.hysteria2.status': z.object({}).strict(),
  'vpn.hysteria2.clients.list': z.object({}).strict(),
  'vpn.hysteria2.client.issue': z.object({
    label: z.string().trim().min(1).max(40).regex(/^[A-Za-zА-Яа-яЁё0-9_. -]+$/).refine((value) => !value.includes('..')),
  }).strict(),
  'vpn.hysteria2.client.revoke': z.object({ clientId: z.string().regex(/^vpn-[a-f0-9]{12}$/) }).strict(),
  'vpn.hysteria2.client.rotate': z.object({ clientId: z.string().regex(/^vpn-[a-f0-9]{12}$/) }).strict(),
  'vpn.hysteria2.client.export': z.object({ clientId: z.string().regex(/^vpn-[a-f0-9]{12}$/) }).strict(),
  'vpn.hysteria2.restart': z.object({}).strict(),
  'vpn.health.snapshot': z.object({}).strict(),
  'vpn.external_probe.snapshot': z.object({ targetNode: z.enum(['de', 'nl']) }).strict(),
  'vpn.external_probe.credential.install': z.object({
    targetNode: z.enum(['de', 'nl']),
    protocol: z.enum(['vless', 'hysteria2']),
    credential: z.string().min(1).max(2048),
  }).strict(),
  'vpn.external_probe.run': z.object({ targetNode: z.enum(['de', 'nl']) }).strict(),
  'vpn.external_probe.monitor.enable': z.object({ targetNode: z.enum(['de', 'nl']) }).strict(),
  'vpn.external_probe.monitor.disable': z.object({ targetNode: z.enum(['de', 'nl']) }).strict(),
};

const operationNames = Object.keys(operationArguments);

const requestSchema = z.object({
  version: z.literal(PROTOCOL_VERSION),
  requestId: z.string().regex(REQUEST_ID),
  operation: z.enum(operationNames),
  arguments: z.object({}).passthrough(),
  sentAt: z.string().datetime({ offset: true }),
}).strict();

const resultSchema = z.object({
  state: z.enum(['succeeded', 'failed', 'unknown', 'accepted']),
  data: z.object({}).passthrough().optional(),
  errorCode: z.string().regex(/^[A-Z0-9_]{1,80}$/).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.state === 'succeeded' && value.errorCode) {
    ctx.addIssue({ code: 'custom', message: 'successful results cannot have an error code' });
  }
  if (value.state === 'failed' && !value.errorCode) {
    ctx.addIssue({ code: 'custom', message: 'failed results require an error code' });
  }
});

const responseSchema = z.object({
  version: z.literal(PROTOCOL_VERSION),
  requestId: z.string().regex(REQUEST_ID),
  operation: z.enum(operationNames),
  receivedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  result: resultSchema,
}).strict();

function encodedSize(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function protocolError(message) {
  const error = new Error(message);
  error.code = 'HOST_AGENT_PROTOCOL_INVALID';
  return error;
}

function assertEnvelopeSize(value) {
  if (encodedSize(value) > MAX_ENVELOPE_BYTES) throw protocolError('host-agent envelope is too large');
}

function validateRequest(value) {
  assertEnvelopeSize(value);
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) throw protocolError('host-agent request is invalid');
  const args = operationArguments[parsed.data.operation].safeParse(parsed.data.arguments);
  if (!args.success) throw protocolError('host-agent request arguments are invalid');
  return { ...parsed.data, arguments: args.data };
}

function validateResponse(value, request = null) {
  assertEnvelopeSize(value);
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) throw protocolError('host-agent response is invalid');
  if (request && (parsed.data.requestId !== request.requestId || parsed.data.operation !== request.operation)) {
    throw protocolError('host-agent response does not match request');
  }
  return parsed.data;
}

module.exports = {
  MAX_ENVELOPE_BYTES,
  MAX_ERROR_CODE_LENGTH,
  PROTOCOL_VERSION,
  SERVICE_ID,
  operationNames,
  protocolError,
  validateRequest,
  validateResponse,
};
