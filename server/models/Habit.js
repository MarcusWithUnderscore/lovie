import mongoose from 'mongoose';

const habitSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  description: String,
  color: { type: String, default: '#FF6B9D' },
  icon: String,
  frequency: { type: String, enum: ['daily', 'weekly'], default: 'daily' },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('Habit', habitSchema);