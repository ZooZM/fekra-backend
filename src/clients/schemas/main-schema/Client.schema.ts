import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ClientDocument = HydratedDocument<Client>;

@Schema({
  timestamps: true,
})
export class Client {
  @Prop({
    type: String,
    trim: true,
  })
  name?: string;

  @Prop({})
  business_category?: string;

  @Prop({
    type: [Object],
    default: [],
  })
  services?: object[];

  @Prop({
    type: Object,
    default: {},
  })
  business_info?: object;

  @Prop({
    type: Object,
    default: {},
  })
  ai_config?: object;

  @Prop({
    type: [Object],
    default: [],
  })
  offers?: object[];

  @Prop({
    trim: true,
  })
  fb_page_id?: string;

  @Prop({
    trim: true,
  })
  instagram_account_id?: string;

  @Prop({
    trim: true,
  })
  access_token?: string;

  @Prop({
    type: String,
  })
  brand_logo?: string;

  @Prop({
    type: [String],
    default: [],
  })
  private_messages?: string[];

  @Prop({
    type: [Object],
    default: [],
  })
  public_comments?: object[];
}

export const ClientSchema = SchemaFactory.createForClass(Client);

const strip = (_doc: unknown, ret: any) => {
  const { __v, ...safe } = ret;
  return safe;
};

ClientSchema.set('toJSON', { transform: strip });
ClientSchema.set('toObject', { transform: strip });
