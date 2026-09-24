const { z } = require('zod');
const { isSafeStructuredValue } = require('./lifeSchemas');

const idSchema = z.string().uuid();
const timestampSchema = z.union([z.date(), z.string().datetime({ offset: true })]);
const boundedText = (maximum) => z.string().trim().min(1).max(maximum);
const optionalId = idSchema.nullable().optional();

function jsonBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function safeJsonSchema(maximumBytes, expectedType = null) {
  return z.unknown().refine((value) => {
    if (expectedType === 'object' && (!value || Array.isArray(value) || typeof value !== 'object')) return false;
    if (expectedType === 'array' && !Array.isArray(value)) return false;
    return isSafeStructuredValue(value) && jsonBytes(value) <= maximumBytes;
  }, 'value contains disallowed or oversized data');
}

const opaqueReferenceSchema = z.string().trim().min(1).max(256)
  .regex(/^[a-z0-9][a-z0-9_.:-]*$/i, 'resource reference must be opaque');

module.exports = {
  boundedText,
  idSchema,
  jsonBytes,
  opaqueReferenceSchema,
  optionalId,
  safeJsonSchema,
  timestampSchema,
  z,
};
