import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import ai from './ai.js';
import connectDB from './config/db.js';
import authRoutes from './routes/authRoutes.js';

dotenv.config();

const app = express();

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/', ai);

app.get('/', (req, res) => {
  res.json({ message: 'Welcome to Habit Tracker API 💖' });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT,'0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});




