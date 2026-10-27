import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export enum Day {
  SUNDAY = 'sunday',
  MONDAY = 'monday',
  TUESDAY = 'tuesday',
  WEDNESDAY = 'wednesday',
  THURSDAY = 'thursday',
  FRIDAY = 'friday',
  SATURDAY = 'saturday',
}

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/; // HH:mm, 24-hour

@Schema({
  _id: false,
})
export class WorkingHours {
  @Prop({
    type: String,
    trim: true,
    match: [TIME_REGEX, 'startTime must be in HH:mm format'],
  })
  startTime?: string;

  @Prop({
    type: String,
    trim: true,
    match: [TIME_REGEX, 'endTime must be in HH:mm format'],
  })
  endTime?: string;

  @Prop({
    type: [{ type: String, enum: Object.values(Day) }],
    default: [],
    validate: {
      validator: (days: string[]) => new Set(days).size === days.length,
      message: 'days must not contain duplicates',
    },
  })
  days?: Day[];
}

export const WorkingHoursSchema = SchemaFactory.createForClass(WorkingHours);
