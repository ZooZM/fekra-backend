// inbox/inbox.constants.ts
export { REDIS } from '../redis/redis.constants';
export const REDIS_SUB = 'REDIS_SUB';

export const MESSAGE_QUEUE_KEY = 'inbox:messages'; // messages and finished DM batches
export const COMMENT_QUEUE_KEY = 'inbox:comments';
export const COMMENT_RETRY_KEY = 'inbox:comments:retry'; // score = when the LLM retry is due (ms)
export const PENDING_HASH = 'n8n:pending'; // field = request id, value = data
export const REQ_TTL = 'n8n:ttl:'; // + request id
export const DEAD_LIST = 'n8n:dead';
export const LEAD_RECOVERY_LOCK = 'n8n:lead-recovery:lock';
export const DM_DATA = 'dmbuf:data:'; // + platform:account:sender
export const DM_TTL = 'dmbuf:ttl:'; // + platform:account:sender

// Reply runs on a post's unreplied comments (see data-model.md in specs/002-client-posts-backfill)
export const BACKFILL_RUN = 'backfill:run:'; // + run id: hash with the run's state and counters
export const BACKFILL_LOCK = 'backfill:lock:'; // + platform:postId: run id; one run per post, expires on its own
export const BACKFILL_POST = 'backfill:post:'; // + platform:postId: id of the latest run on the post
