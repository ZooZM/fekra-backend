// inbox/inbox.constants.ts
export const REDIS = 'REDIS';
export const REDIS_SUB = 'REDIS_SUB';

export const MESSAGE_QUEUE_KEY = 'inbox:messages'; // messages and finished DM batches
export const COMMENT_QUEUE_KEY = 'inbox:comments';
export const COMMENT_RETRY_KEY = 'inbox:comments:retry'; // score = when the LLM retry is due (ms)
export const PENDING_HASH = 'n8n:pending'; // field = request id, value = data
export const REQ_TTL = 'n8n:ttl:'; // + request id
export const DEAD_LIST = 'n8n:dead';
export const DM_DATA = 'dmbuf:data:'; // + platform:account:sender
export const DM_TTL = 'dmbuf:ttl:'; // + platform:account:sender
