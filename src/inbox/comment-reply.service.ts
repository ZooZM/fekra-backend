// inbox/comment-reply.service.ts
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ClientsService } from '@app/clients/clients.service';
import {
  CommentReplyConfig,
  DmReplyConfig,
} from '@common/zod/json-columns.schema';
import { GraphToken } from '@app/clients/types/client.types';
import { GraphApiService, SendableRequest } from './graph-api.service';
import { CommentCategory } from './comment-classifier.service';

/** Shape of the replies n8n sends back through the callback. */
export type CommentType = 'engagement' | 'question';

export interface CommentReplyInput {
  type: CommentType;
  publicReply?: string; // engagement
  dmText?: string; // question
  publicReplyIfDmSent?: string; // question, DM went through
  publicReplyIfDmClosed?: string; // question, DM failed
}

// Defaults copied from the n8n workflow. Used only when the client's own list is empty.
// Several variants so Facebook doesn't flag identical replies as spam.
const DEFAULT_INQUIRY_CAN_DM = [
  'تم الرد في رسالة خاصة يا فندم 📩',
  'بعتلك كل التفاصيل في رسالة، شيك على الانبوكس ✨',
  'وصلت لحضرتك رسالة بالتفاصيل حالاً 📨',
  'تم التواصل على الخاص يا فندم 🌹',
  'التفاصيل في الانبوكس عند حضرتك 📥',
];
const DEFAULT_INQUIRY_CAN_NOT_DM = [
  'أهلاً بك يا فندم 👋، عشان نقدر نبعتلك التفاصيل كاملة، يا ريت تبعتلنا رسالة على الصفحة 📩.',
  'منورنا ✨.. حاولنا نتواصل مع حضرتك خاص بس الرسايل مقفولة، ممكن تبعتلنا رسالة عشان نرد عليك؟',
  'يا ريت تتواصل معانا عبر رسايل الصفحة عشان نقدر نفيدك بالتفاصيل والأسعار فوراً 📨.',
  'التفاصيل كلها متاحة يا فندم، ابعتلنا رسالة وهنرد عليك حالاً 👇📩',
  'أهلاً بحضرتك 🌹، يرجى مراسلتنا على الخاص لتزويدك بكل التفاصيل المطلوبة.',
];
const DEFAULT_ENGAGEMENT = [
  'نورتنا يا فندم، شكراً لذوقك ❤️',
  'الله يبارك في حضرتك، كلك ذوق ✨',
  'مرورك الأجمل يا فندم 🌹',
  'شكراً لتشجيعك الدائم لينا، نورت الصفحة 🙏',
  'أهلاً بحضرتك، دايماً منورنا ✨',
  '❤️❤️❤️❤️',
  'تسلم يا غالي، شكراً لمحبتك 🌹',
];

/** Random item, so repeated replies don't look automated. */
const pick = (list: readonly string[]): string | undefined =>
  list.length ? list[Math.floor(Math.random() * list.length)] : undefined;

/** Random item from the client's list, or from the defaults if it's empty. */
const pickOr = (list: readonly string[], defaults: readonly string[]) =>
  pick(list.length ? list : defaults);

interface CommentContext {
  req: SendableRequest;
  base: string;
  token: string;
  /** Which Graph API the token is for (see ClientsService.getGraphToken). */
  api: GraphToken['api'];
  config: CommentReplyConfig;
  dm: DmReplyConfig;
}

@Injectable()
export class CommentReplyService {
  private readonly logger = new Logger(CommentReplyService.name);

  constructor(
    private readonly graph: GraphApiService,
    @Inject(forwardRef(() => ClientsService))
    private readonly clients: ClientsService,
  ) {}

  /**
   * Runs the action for the comment's category (same steps as the n8n workflows):
   * - inquiry:            private DM -> public reply (DM sent / DMs closed) -> like
   * - engagement:         public thank-you reply -> like
   * - spam:               like only (nothing on Instagram, it has no comment likes)
   * - complaint / insult: hide the comment (the author and their friends still see it)
   *
   * `commentReplyConfig.enabled` gates every reply and hide, `likes_enabled` gates likes,
   * and `dmReplyConfig.enabled` gates the private DM.
   * Never throws, so callers can use `void commentReply.handle(...)`.
   */
  async handle(req: SendableRequest, category: CommentCategory): Promise<void> {
    try {
      const ctx = await this.context(req);
      switch (category) {
        case 'inquiry':
          return await this.handleInquiry(ctx);
        case 'engagement':
          return await this.handleEngagement(ctx);
        case 'spam':
          return await this.handleSpam(ctx);
        case 'complaint':
        case 'insult':
          return await this.handleHide(ctx, category);
      }
    } catch (err) {
      this.logger.error(
        `Comment ${category} handling failed for ${req.id}: ${(err as Error).message}`,
      );
      await this.graph.deadLetter({
        service: 'comment',
        request: req,
        input: { category },
        error: (err as Error).message,
      });
    }
  }

  /** Private DM, then a public reply that depends on whether the DM went through, then like. */
  private async handleInquiry(ctx: CommentContext) {
    try {
      if (!ctx.config.enabled) return;

      const dmText = ctx.dm.enabled ? pick(ctx.dm.replies) : undefined;
      const dmSent = await this.tryPrivateDm(ctx, dmText);

      const reply = dmSent
        ? pickOr(ctx.config.inquiry_can_dm, DEFAULT_INQUIRY_CAN_DM)
        : pickOr(ctx.config.inquiry_can_not_dm, DEFAULT_INQUIRY_CAN_NOT_DM);
      if (reply) await this.publicReply(ctx, reply);
    } finally {
      await this.like(ctx); // like even if the reply failed
    }
  }

  /** Random thank-you reply, then like. */
  private async handleEngagement(ctx: CommentContext) {
    try {
      if (!ctx.config.enabled) return;
      const reply = pickOr(ctx.config.engagement, DEFAULT_ENGAGEMENT);
      if (reply) await this.publicReply(ctx, reply);
    } finally {
      await this.like(ctx);
    }
  }

  /** Same as the n8n workflow: like only, never reply to spam. */
  private async handleSpam(ctx: CommentContext) {
    await this.like(ctx);
  }

  /**
   * Hidden, not deleted: reversible, and the author still sees their comment,
   * so they don't notice it was moderated.
   * Facebook: POST /{comment-id} is_hidden=true. Instagram: POST /{ig-comment-id} hide=true.
   */
  private async handleHide(
    { req, base, token, config }: CommentContext,
    category: 'complaint' | 'insult',
  ) {
    if (!config.enabled) return;
    const body =
      req.platform === 'instagram' ? { hide: true } : { is_hidden: true };
    await this.graph.post(`${base}/${req.id}`, body, token);
    this.logger.log(`Hid ${category} comment ${req.id} (${req.platform})`);
  }

  /** Applies replies written by n8n (used only for comments sent there). Never throws. */
  async handleN8nReply(
    req: SendableRequest,
    input: CommentReplyInput,
  ): Promise<void> {
    try {
      const ctx = await this.context(req);
      try {
        if (input.type === 'question') {
          const dmSent = await this.tryPrivateDm(ctx, input.dmText);
          const text = dmSent
            ? input.publicReplyIfDmSent
            : input.publicReplyIfDmClosed;
          if (text) await this.publicReply(ctx, text);
        } else if (input.publicReply) {
          await this.publicReply(ctx, input.publicReply);
        }
      } finally {
        await this.like(ctx);
      }
    } catch (err) {
      this.logger.error(
        `Comment handling failed for ${req.id}: ${(err as Error).message}`,
      );
      await this.graph.deadLetter({
        service: 'comment',
        request: req,
        input,
        error: (err as Error).message,
      });
    }
  }

  /**
   * Facebook uses the Page token on graph.facebook.com. Instagram uses the client's Instagram
   * token on graph.instagram.com when one is stored, and otherwise the Page token on
   * graph.facebook.com (Instagram API with Facebook Login, like the n8n workflows).
   * The edges and bodies are the same on both Instagram hosts, except the private reply.
   */
  private async context(req: SendableRequest): Promise<CommentContext> {
    if (!req.client) throw new Error('client is missing');
    const auth = await this.clients.getGraphToken(req.clientId, req.platform);
    if (!auth) throw new Error('No access token stored for this client');
    return {
      req,
      base: this.graph.host(auth.api),
      token: auth.token,
      api: auth.api,
      config: req.client.commentReplyConfig,
      dm: req.client.dmReplyConfig,
    };
  }

  /** Never throws: a failed like must not block anything else. */
  private async like({ req, base, token, config }: CommentContext) {
    if (!config.likes_enabled) return;
    // The Instagram API has no endpoint for liking comments, so it's Facebook only
    if (req.platform !== 'facebook') return;
    try {
      await this.graph.post(`${base}/${req.id}/likes`, {}, token);
    } catch (err) {
      this.logger.warn(`Like failed for ${req.id}: ${(err as Error).message}`);
    }
  }

  /**
   * Private reply to the commenter. True only if the DM was actually sent.
   * A failure here is expected (closed DMs, or the 7-day private reply window passed).
   * Facebook: POST /{page-id}/messages. Instagram with the Page token: POST /me/messages (the
   * Page behind the IG account). Instagram with its own token: POST /{ig-id}/messages, the
   * documented path on graph.instagram.com.
   */
  private async tryPrivateDm(
    { req, base, token, api }: CommentContext,
    text?: string,
  ) {
    if (!text) return false;
    const sender =
      req.platform === 'instagram' && api === 'facebook' ? 'me' : req.accountId;
    try {
      await this.graph.post(
        `${base}/${sender}/messages`,
        {
          recipient: { comment_id: req.id },
          message: { text: text.slice(0, 2000) },
        },
        token,
      );
      return true;
    } catch (err) {
      this.logger.warn(
        `Private reply not sent for ${req.id}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /** Facebook: POST /{comment-id}/comments. Instagram: POST /{ig-comment-id}/replies. */
  private async publicReply(
    { req, base, token }: CommentContext,
    text: string,
  ) {
    const edge = req.platform === 'instagram' ? 'replies' : 'comments';
    await this.graph.post(
      `${base}/${req.id}/${edge}`,
      { message: text },
      token,
    );
  }
}
