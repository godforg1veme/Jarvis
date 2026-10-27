const { createHash } = require('node:crypto');
const { z } = require('zod');
const { accessError } = require('../access/accessPolicy');
const { safeDisplayName, fileExtension } = require('../knowledge/fileTypes');

const uuid = z.uuid();
const revision = z.string().regex(/^[a-f0-9]{64}$/);
const supportedMedia = Object.freeze({
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
});
const uploadInput = z.strictObject({
  name: z.string().min(1).max(255),
  mediaType: z.string().min(1).max(100),
  sha256: revision,
  byteSize: z.number().int().positive(),
});
const uploadCommand = z.strictObject({
  operationId: uuid, kind: z.literal('upload'), targetId: z.null(), revision: z.null(), input: uploadInput,
});
const deleteCommand = z.strictObject({
  operationId: uuid, kind: z.literal('delete'), targetId: uuid, revision, input: z.strictObject({}),
});
const commandSchema = z.discriminatedUnion('kind', [uploadCommand, deleteCommand]);

function documentRevision(document) {
  return createHash('sha256')
    .update(JSON.stringify([document.id, document.original_name, document.media_type]))
    .digest('hex');
}

function safeDocument(document) {
  return {
    id: document.id,
    title: document.original_name,
    revision: documentRevision(document),
  };
}

function actorUserId(actor) {
  if (!actor || !actor.userId) throw accessError('forbidden');
  return actor.userId;
}

function createDocumentActions({ knowledgeService }) {
  if (!knowledgeService || !knowledgeService.repository || !knowledgeService.storage) {
    throw new Error('knowledge service is required');
  }
  const repository = knowledgeService.repository;

  return {
    kinds: ['upload', 'delete'],
    permission: 'documents',

    validate(raw) {
      const parsed = commandSchema.safeParse(raw);
      if (!parsed.success) throw accessError('invalid_request');
      const command = parsed.data;
      if (command.kind === 'upload') {
        const { name, mediaType, byteSize } = command.input;
        if (name !== safeDisplayName(name)
          || (supportedMedia[fileExtension(name)] !== mediaType
            && !(fileExtension(name) === '.md' && mediaType === 'text/plain'))
          || byteSize > knowledgeService.maxBytes) throw accessError('invalid_request');
      }
      return command;
    },

    describe() {
      return { kinds: ['upload', 'delete'], maxUploadBytes: knowledgeService.maxBytes };
    },

    async target({ db, actor, targetId }) {
      if (!uuid.safeParse(targetId).success) throw accessError('invalid_request');
      const document = await repository.getActiveForUser({
        userId: actorUserId(actor), documentId: targetId, db,
      });
      if (!document) throw accessError('not_found');
      return safeDocument(document);
    },

    async prepare({ actor, command, data }) {
      if (command.kind !== 'upload') return null;
      const input = command.input;
      if (!Buffer.isBuffer(data) || data.length !== input.byteSize
        || data.length > knowledgeService.maxBytes
        || createHash('sha256').update(data).digest('hex') !== input.sha256) {
        throw accessError('invalid_request');
      }
      return knowledgeService.prepareIngest({
        userId: actorUserId(actor), operationId: command.operationId, data,
        attachment: { name: input.name, mimeType: input.mediaType, byteSize: input.byteSize },
      });
    },

    async execute({ db, actor, command, prepared }) {
      const userId = actorUserId(actor);
      if (command.kind === 'upload') {
        const input = command.input;
        if (!prepared) throw accessError('invalid_request');
        const document = await knowledgeService.ingest({
          userId, db, prepared, operationId: command.operationId, expectedSha256: input.sha256,
          attachment: { name: input.name, mimeType: input.mediaType, byteSize: input.byteSize },
        });
        return {
          result: safeDocument(document),
          onRollback: prepared.onRollback,
        };
      }
      if (command.kind === 'delete') {
        const current = await repository.getActiveForUser({
          userId, documentId: command.targetId, db, forUpdate: true,
        });
        if (!current) throw accessError('not_found');
        if (documentRevision(current) !== command.revision) throw accessError('revision_conflict');
        const deleted = await knowledgeService.remove({
          userId, documentId: command.targetId, db, deferStorageRemoval: true,
        });
        if (!deleted) throw accessError('revision_conflict');
        return {
          result: { id: command.targetId, deleted: true },
          afterCommit: async () => knowledgeService.storage.remove(deleted.storage_key).catch(() => {}),
        };
      }
      throw accessError('invalid_request');
    },
  };
}

module.exports = { createDocumentActions };
