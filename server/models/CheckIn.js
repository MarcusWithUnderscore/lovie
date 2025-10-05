import mongoose from 'mongoose';

const checkInSchema = new mongoose.Schema({
  habitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Habit', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: Date, required: true },
  completed: { type: Boolean, default: true },
  mood: { type: String, enum: ['great', 'good', 'okay', 'bad', 'terrible'] },
  notes: String,
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('CheckIn', checkInSchema);