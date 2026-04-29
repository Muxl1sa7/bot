import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Bot, BotDocument } from './entities/bot.entity';
import TelegramBot from 'node-telegram-bot-api';

interface TestState {
  qNum: number;
  correct: number;
  wrong: number;
  skip: number;
  answer: number;
  phase: 'idle' | 'question' | 'result';
  timer: NodeJS.Timeout | null;
}

@Injectable()
export class BotService {
  private bot: TelegramBot;
  private sessions: Map<number, TestState> = new Map();

  constructor(@InjectModel(Bot.name) private botModel: Model<BotDocument>) {
    this.bot = new TelegramBot(process.env.BOT_TOKEN as string, {
      polling: true,
    });

    this.bot.setMyCommands([
      { command: '/start', description: 'Matematik testni boshlash' },
    ]);

    this.bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      const found = await this.botModel.findOne({ chatId });
      if (!found) {
        await this.botModel.create({ chatId, name: msg.from?.first_name });
      }

      this.bot.sendMessage(chatId, '👋 Salom! Matematik test botiga xush kelibsiz!', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '▶️ Testni boshlash', callback_data: 'start_test' }],
          ],
        },
      });
    });

    this.bot.on('callback_query', async (query) => {
      const chatId = query.message?.chat.id!;
      const data = query.data;

      try {
        await this.bot.answerCallbackQuery(query.id);
      } catch (e) {
        // eski query, e'tibor bermaslik
      }

      if (data === 'start_test') {
        this.startTest(chatId);
      } else if (data === 'restart_yes') {
        this.startTest(chatId);
      } else if (data === 'restart_no') {
        this.bot.sendMessage(chatId, '👋 Rahmat! Yana test ishlash uchun /start deb yozing.');
        const session = this.sessions.get(chatId);
        if (session) session.phase = 'idle';
      }
    });

    this.bot.on('message', (msg) => {
      const chatId = msg.chat.id;
      const text = msg.text;

      if (!text || text === '/start') return;

      const session = this.sessions.get(chatId);
      if (!session) return;

      if (session.phase === 'question') {
        this.handleAnswer(chatId, text, session);
      }
    });
  }

  private startTest(chatId: number) {
    const old = this.sessions.get(chatId);
    if (old?.timer) clearTimeout(old.timer);

    const session: TestState = {
      qNum: 0,
      correct: 0,
      wrong: 0,
      skip: 0,
      answer: 0,
      phase: 'idle',
      timer: null,
    };
    this.sessions.set(chatId, session);

    this.bot.sendMessage(
      chatId,
      '🧮 Matematik test boshlandi!\nSizga 10 ta savol beriladi.\n⏱ Har bir savolga 10 soniya vaqt bor.',
    );

    setTimeout(() => this.askQuestion(chatId), 1000);
  }

  private askQuestion(chatId: number) {
    const session = this.sessions.get(chatId);
    if (!session) return;

    session.qNum += 1;
    session.phase = 'question';

    const { text, answer } = this.generateQuestion(session.qNum);
    session.answer = answer;

    this.bot.sendMessage(chatId, text);

    session.timer = setTimeout(() => {
      this.bot.sendMessage(chatId, "⏰ Vaqt tugadi! Savol o'tkazib yuborildi.");
      session.skip += 1;
      this.nextStep(chatId);
    }, 10000);
  }

  private handleAnswer(chatId: number, text: string, session: TestState) {
    const num = parseInt(text.trim(), 10);

    if (isNaN(num) || String(num) !== text.trim()) {
      this.bot.sendMessage(chatId, '⚠️ Faqat son kiriting.');
      return;
    }

    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }

    if (num === session.answer) {
      this.bot.sendMessage(chatId, "✅ To'g'ri!");
      session.correct += 1;
    } else {
      this.bot.sendMessage(chatId, `❌ Noto'g'ri! To'g'ri javob: ${session.answer}`);
      session.wrong += 1;
    }

    this.nextStep(chatId);
  }

  private nextStep(chatId: number) {
    const session = this.sessions.get(chatId);
    if (!session) return;

    if (session.qNum >= 10) {
      setTimeout(() => this.showResult(chatId), 600);
    } else {
      setTimeout(() => this.askQuestion(chatId), 800);
    }
  }

  private showResult(chatId: number) {
    const session = this.sessions.get(chatId);
    if (!session) return;

    session.phase = 'result';
    const percent = Math.round((session.correct / 10) * 100);

    let emoji = '😔';
    if (percent >= 80) emoji = '🏆';
    else if (percent >= 60) emoji = '👍';
    else if (percent >= 40) emoji = '😐';

    this.bot.sendMessage(
      chatId,
      `${emoji} Test tugadi!\n\n` +
      `✅ To'g'ri: ${session.correct}\n` +
      `❌ Noto'g'ri: ${session.wrong}\n` +
      `⏭ O'tkazilgan: ${session.skip}\n\n` +
      `📊 Natijangiz: ${percent}%`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔄 Ha, qayta boshlash', callback_data: 'restart_yes' },
              { text: '❌ Yo\'q', callback_data: 'restart_no' },
            ],
          ],
        },
      },
    );
  }

  private generateQuestion(qNum: number): { text: string; answer: number } {
    const a = Math.floor(Math.random() * 20) + 1;
    const b = Math.floor(Math.random() * 20) + 1;
    const ops = ['+', '-', '*'] as const;
    const op = ops[Math.floor(Math.random() * 3)];

    let answer: number;
    let symbol: string;

    if (op === '+') { answer = a + b; symbol = '+'; }
    else if (op === '-') { answer = a - b; symbol = '-'; }
    else { answer = a * b; symbol = '×'; }

    return {
      text: `${qNum}-savol: ${a} ${symbol} ${b} = ?\n⏱ 10 soniya`,
      answer,
    };
  }
}