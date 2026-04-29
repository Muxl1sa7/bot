import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type BotDocument = HydratedDocument<Bot>;

@Schema()
export class Bot {
  @Prop({ required: true, unique: true })
  chatId: number;

  @Prop()
  name: string;
}

export const BotSchema = SchemaFactory.createForClass(Bot);