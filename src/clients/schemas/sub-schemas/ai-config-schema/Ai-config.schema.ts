import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export enum Language {
  ENGLISH = 'ENGLISH',
  ARABIC = 'ARABIC',
  ENGLISH_ARABIC = 'ENGLISH_ARABIC',
}

@Schema({
  _id: false,
})
export class AiConfig {
  @Prop({
    type: String,
    trim: true,
    maxlength: 400,
  })
  brandVoice?: string;

  @Prop({
    type: String,
    enum: Object.values(Language),
    default: Language.ARABIC,
  })
  language!: Language;
}

export const AiConfigSchema = SchemaFactory.createForClass(AiConfig);
