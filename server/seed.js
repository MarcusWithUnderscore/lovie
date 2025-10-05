import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import User from './models/User.js';
const userName = "Boss";
const email = "onyangomarcus54@gmail.com";
const password = "marc";
dotenv.config();

const seedUser = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected');

    // Check if user already exists
    const existingUser = await User.findOne({ email: email});
    
    if (existingUser) {
      console.log('User already exists!');
      process.exit();
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const user = new User({
      name: userName,
      email: email,
      password: hashedPassword
    });

    await user.save();
    console.log('✅ User created successfully!');
    console.log('Email: ', email);
  
    process.exit();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

seedUser();