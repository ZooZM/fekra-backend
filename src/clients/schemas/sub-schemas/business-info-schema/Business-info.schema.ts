import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({
  _id: false,
})
export class ScoialMedia {
  @Prop({
    type: String,
    trim: true,
  })
  instagram?: string;

  @Prop({
    type: String,
    trim: true,
  })
  twitter?: string;

  @Prop({
    type: String,
    trim: true,
  })
  facebook?: string;

  @Prop({
    type: String,
    trim: true,
  })
  linkedin?: string;

  @Prop({
    type: String,
    trim: true,
  })
  tiktok?: string;

  @Prop({
    type: String,
    trim: true,
  })
  snapchat?: string;
}

export const ScoialMediaSchema = SchemaFactory.createForClass(ScoialMedia);

@Schema({
  _id: false,
})
export class ContactInfo {
  @Prop({
    type: String,
    trim: true,
  })
  phone?: string;

  @Prop({
    type: String,
    trim: true,
  })
  email?: string;

  @Prop({
    type: String,
    trim: true,
  })
  whatsapp?: string;

  @Prop({
    type: String,
    trim: true,
  })
  website?: string;
}

export const ContactInfoSchema = SchemaFactory.createForClass(ContactInfo);

@Schema({ _id: false })
export class Link {
  @Prop({
    type: String,
    trim: true,
  })
  url?: string;

  @Prop({
    type: String,
    trim: true,
  })
  description?: string;
}
export const LinkSchema = SchemaFactory.createForClass(Link);

@Schema({
  _id: false,
})
export class location {
  @Prop({
    type: String,
    trim: true,
  })
  city?: string;

  @Prop({
    type: String,
    trim: true,
  })
  district?: string;

  @Prop({
    type: String,
    trim: true,
  })
  full_address?: string;

  @Prop({
    type: [LinkSchema],
    default: [],
  })
  links?: Link[];
}

export const locationSchema = SchemaFactory.createForClass(location);
