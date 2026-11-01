// inbox/inbox.constants.ts
export const REDIS = 'REDIS';
export const REDIS_SUB = 'REDIS_SUB';

export const INBOX_KEY = 'inbox:queue';
export const PENDING_HASH = 'n8n:pending'; // field = request id, value = data
export const REQ_TTL = 'n8n:ttl:'; // + request id
export const DEAD_LIST = 'n8n:dead';
export const DM_DATA = 'dmbuf:data:'; // + platform:account:sender
export const DM_TTL = 'dmbuf:ttl:'; // + platform:account:sender
