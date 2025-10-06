import express from "express";
import fs from "fs";
import path from "path";
import axios from "axios";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { DateTime } from "luxon";
import pkg from 'number-to-words';
import mongoose from "mongoose";
import Chat from "./models/Chat.js";
import dotenv from "dotenv";
import cors from "cors";
import { EdgeTTS } from "node-edge-tts";

dotenv.config();

const { toWords } = pkg;
const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Constants
const MAX_MESSAGE_LENGTH = 5000;
const AUDIO_WRITE_DELAY = 500; // Increased for reliability
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];

router.use(cors({
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST', 'DELETE'],
    credentials: true
}));

// Date & Time Calculation - FIXED
const now = DateTime.now().setZone('Africa/Nairobi');
const weekday = now.weekdayLong;
const month = now.monthLong;
const day = now.day;
const year = now.year;

let hour = now.hour;
const minute = now.minute;

// Fixed: Proper period determination
let period;
if (hour >= 0 && hour < 12) {
    period = 'in the morning';
} else if (hour >= 12 && hour < 17) {
    period = 'in the afternoon';
} else {
    period = 'in the evening';
}

const displayHour = hour % 12 || 12;

// Fixed: More natural time phrasing
let timePhrase = '';
if (minute === 0) {
    timePhrase = `It's ${toWords(displayHour)} o'clock ${period}.`;
} else if (minute === 15) {
    timePhrase = `It's quarter past ${toWords(displayHour)} ${period}.`;
} else if (minute === 30) {
    timePhrase = `It's half past ${toWords(displayHour)} ${period}.`;
} else if (minute === 45) {
    // Fixed: Handle period change when going to next hour
    let nextHour = displayHour === 12 ? 1 : displayHour + 1;
    let nextPeriod = period;
    if (hour === 11) nextPeriod = 'in the afternoon';
    if (hour === 23) nextPeriod = 'in the morning';
    timePhrase = `It's quarter to ${toWords(nextHour)} ${nextPeriod}.`;
} else if (minute < 30) {
    timePhrase = `It's ${toWords(minute)} minutes past ${toWords(displayHour)} ${period}.`;
} else {
    const minutesTo = 60 - minute;
    let nextHour = displayHour === 12 ? 1 : displayHour + 1;
    let nextPeriod = period;
    if (hour === 11) nextPeriod = 'in the afternoon';
    if (hour === 23) nextPeriod = 'in the morning';
    timePhrase = `It's ${toWords(minutesTo)} minutes to ${toWords(nextHour)} ${nextPeriod}.`;
}

const daySuffix = (n) => ['th', 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1 && n % 10) || 0] || 'th';
const fullDate = `Today is ${weekday}, ${month} ${day}${daySuffix(day)}, ${toWords(year)}.`;

// Gemini Function Declaration for Avatar Emotions
const setAvatarEmotionDeclaration = {
    name: "set_avatar_emotion",
    description: "Sets the facial expression and body language for the AI avatar to match the emotional tone and content of your response. ALWAYS call this function after generating your response text to ensure the avatar displays appropriate non-verbal communication.",
    parameters: {
        type: "object",
        properties: {
            emotion: {
                type: "string",
                enum: ["smile", "sad", "angry", "surprised", "funnyFace", "default"],
                description: "Primary facial expression: 'smile' for positive/happy/helpful responses, 'sad' for apologies/unfortunate news/empathy, 'angry' for frustrated/negative content, 'surprised' for shocking/amazing/exciting news, 'funnyFace' for jokes and humor, 'default' for neutral"
            },
            bodyLanguageCues: {
                type: "array",
                items: {
                    type: "string",
                    enum: ["headTilt", "headNod", "shrug", "wink", "talking_0","talking_1","talking_2"]
                },
                description: "Body language gestures: 'headTilt' for questions or curiosity, 'headNod' for agreement or affirmation, 'shrug' for uncertainty or 'I don't know', 'wink' for playful or friendly moments, talking_0 1 or 2 at random everytime you are communicating"
            },
            reasoning: {
                type: "string",
                description: "Brief explanation of why you chose this emotion and body language"
            }
        },
        required: ["emotion", "bodyLanguageCues", "reasoning"]
    }
};

// Utility Functions
async function saveChatHistory(chatId, You, Cortex, userId) {
    try {
        const existing = await Chat.findOne({ chatId });
        const newMessage = { You, Cortex, timestamp: new Date() };

        if (existing) {
            existing.messages.push(newMessage);
            existing.lastInteraction = new Date();
            await existing.save();
        } else {
            await Chat.create({
                chatId,
                userId,
                messages: [newMessage]
            });
        }
    } catch (err) {
        console.error("Error saving chat:", err);
        throw err; // Re-throw to handle upstream
    }
}

async function getChatHistory(chatId) {
    const chat = await Chat.findOne({ chatId });
    return Array.isArray(chat?.messages) ? chat.messages : [];
}

function stripHtmlAndSpecialChars(text) {
    if (typeof text !== 'string') return '';
    
    return text
        .replace(/<[^>]+>/g, '')
        .replace(/[*_#`~>]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

async function textToSpeechEdgeTTS(text, outputPath) {
    try {
        const cleanText = stripHtmlAndSpecialChars(text);
        if (!cleanText) {
            console.warn('No text to convert to speech');
            return null;
        }

        console.log('Generating TTS for:', cleanText.substring(0, 50));
        
        const tts = new EdgeTTS({
            voice: 'en-US-AvaNeural',
            lang: 'en-US',
            outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
        });
        
        await tts.ttsPromise(cleanText, outputPath);
        
        // Increased delay and added verification loop
        await new Promise(resolve => setTimeout(resolve, AUDIO_WRITE_DELAY));
        
        // Wait for file to be ready with retries
        let attempts = 0;
        while (attempts < 5) {
            if (fs.existsSync(outputPath)) {
                const stats = fs.statSync(outputPath);
                if (stats.size > 0) {
                    console.log('Audio created, Size:', stats.size, 'bytes');
                    return outputPath;
                }
            }
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        
        console.error('Audio file not ready after retries');
        return null;
    } catch (error) {
        console.error("TTS Error:", error.message);
        return null;
    }
}

// Input validation middleware
function validateChatInput(req, res, next) {
    const { message, sender, chatId } = req.body;
    
    if (!message || !sender) {
        return res.status(400).json({ 
            error: "Invalid request. 'message' and 'sender' are required." 
        });
    }
    
    if (message.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({ 
            error: `Message too long. Maximum ${MAX_MESSAGE_LENGTH} characters.` 
        });
    }
    
    if (chatId && typeof chatId !== 'string') {
        return res.status(400).json({ 
            error: "Invalid chatId format." 
        });
    }
    
    next();
}

// Admin Routes
router.get("/debug/collections", async (req, res) => {
    try {
        const collections = await mongoose.connection.db.listCollections().toArray();
        res.json(collections.map(c => c.name));
    } catch (err) {
        console.error("Error listing collections:", err);
        res.status(500).json({ error: "Failed to list collections" });
    }
});

router.get("/admin/chats", async (req, res) => {
    try {
        const allChats = await Chat.find({})
            .select("-__v")
            .sort({ lastInteraction: -1 })
            .lean();

        res.json({
            total: allChats.length,
            chats: allChats
        });
    } catch (err) {
        console.error("Error fetching all chats:", err);
        res.status(500).json({ error: "Failed to fetch chats" });
    }
});

router.post('/chat/history', async (req, res) => {
    const { chatId, You, Cortex, sender } = req.body;

    if (!chatId || !You || !Cortex) {
        return res.status(400).json({ error: 'Missing chatId, You, or Cortex' });
    }

    try {
        await saveChatHistory(chatId, You, Cortex, sender);
        res.status(200).json({ message: 'Chat saved successfully.' });
    } catch (err) {
        console.error('Error saving chat history:', err);
        res.status(500).json({ error: 'Failed to save chat history.' });
    }
});

// Main AI Chat Route with Gemini Function Calling
router.post("/cortex", validateChatInput, async (req, res) => {
    let tempAudioPath = null;
    
    try {
        const { message: You, sender, chatId } = req.body;

        const chatHistory = await getChatHistory(chatId) || [];

        const messageContext = chatHistory.length > 0
            ? chatHistory.map(m => {
                const userMessage = m.You || '';
                const cortexReply = typeof m.Cortex === "string"
                    ? m.Cortex.replace(/^Cortex:\s*/, '').replace(/<[^>]+>/g, '')
                    : '';
                return `${userMessage}\n${cortexReply}`;
            }).join("\n")
            : "";

        if (You.toLowerCase().includes('/start')) {
            try {
                await Chat.findOneAndDelete({ chatId });
                console.log(`Chat history deleted for ${sender}`);
            } catch (err) {
                console.error(`Failed to delete chat history for ${sender}:`, err.message);
                // Continue execution even if deletion fails
            }
        }

        const filePath = path.join(__dirname, './DATA/Cortex_System_Prompt.txt');
        const dataset = await fs.promises.readFile(filePath, 'utf8');
        const model = "gemini-2.5-flash";

        // Step 1: Call Gemini with function declaration
        console.log('Sending request to Gemini with function calling...');
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
            {
                contents: [{
                    parts: [{
                        text: `${dataset}

* Current time: ${timePhrase}, Date: ${fullDate}. You are talking to ${sender}
* Don't mention the user, date and time unless necessary
* Keep responses concise and natural for voice output
* CRITICAL: After generating your response text, you MUST call the set_avatar_emotion function to set the avatar's facial expression and body language based on your response content and tone

Chat history:
${messageContext}

User: ${You}
Cortex:`
                    }]
                }],
                tools: [{
                    function_declarations: [setAvatarEmotionDeclaration]
                }],
                tool_config: {
                    function_calling_config: {
                        mode: "AUTO"
                    }
                }
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": process.env.GEMINI_API_KEY
                },
                timeout: 30000
            }
        );

        let aiResponse = "";
        let detectedEmotion = "smile";
        let bodyLanguageCues = ["talking_1"];
        let emotionReasoning = "Default response";

        const candidate = response.data?.candidates?.[0];
        
        // Step 2: Extract text and function call from response
        if (candidate?.content?.parts) {
            for (const part of candidate.content.parts) {
                // Extract text response
                if (part.text) {
                    aiResponse += part.text;
                }
                
                // Extract function call
                if (part.functionCall && part.functionCall.name === "set_avatar_emotion") {
                    const args = part.functionCall.args;
                    detectedEmotion = args.emotion || "smile";
                    bodyLanguageCues = args.bodyLanguageCues || ["talking_1"];
                    emotionReasoning = args.reasoning || "";
                    
                    console.log('Gemini Function Call Received:');
                    console.log('  Emotion:', detectedEmotion);
                    console.log('  Body Language:', bodyLanguageCues);
                    console.log('  Reasoning:', emotionReasoning);
                }
            }
        }

        // Fallback if no response
        if (!aiResponse) {
            aiResponse = candidate?.content?.parts?.[0]?.text || "I'm here to help!";
        }

        console.log('AI Response:', aiResponse.substring(0, 100) + '...');
        
        // Step 3: Generate audio using Edge TTS
        let audioBase64 = null;
        
        try {
            const cleanText = stripHtmlAndSpecialChars(aiResponse);
            if (cleanText) {
                const tempDir = path.join(__dirname, './temp');
                
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }
                
                tempAudioPath = path.join(tempDir, `audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp3`);
                
                const audioFile = await textToSpeechEdgeTTS(cleanText, tempAudioPath);
                
                if (audioFile && fs.existsSync(audioFile)) {
                    const stats = fs.statSync(audioFile);
                    
                    if (stats.size > 0) {
                        const audioBuffer = fs.readFileSync(audioFile);
                        audioBase64 = audioBuffer.toString('base64');
                        console.log('Audio base64 created, length:', audioBase64.length);
                    }
                }
            }
        } catch (audioError) {
            console.error('TTS Error:', audioError.message);
            // Continue without audio
        } finally {
            // Clean up temp file
            if (tempAudioPath && fs.existsSync(tempAudioPath)) {
                try {
                    fs.unlinkSync(tempAudioPath);
                } catch (cleanupError) {
                    console.error('Failed to cleanup temp audio file:', cleanupError.message);
                }
            }
        }

        // Save to database
        try {
            await saveChatHistory(chatId, You, aiResponse, sender);
        } catch (dbError) {
            console.error('Failed to save chat history:', dbError.message);
            // Continue - don't fail the request
        }

        // Step 4: Send response with emotion data
        res.json({ 
            response: aiResponse,
            audioBase64: audioBase64,
            emotion: detectedEmotion,
            bodyLanguage: bodyLanguageCues,
            emotionReasoning: emotionReasoning,
            chatId: chatId
        });

    } catch (error) {
        console.error("Error in /cortex route:", error.message);
        
        // Clean up temp file on error
        if (tempAudioPath && fs.existsSync(tempAudioPath)) {
            try {
                fs.unlinkSync(tempAudioPath);
            } catch (e) {
                console.error('Cleanup failed:', e.message);
            }
        }
        
        res.status(500).json({ 
            response: "I'm currently unavailable. Please try again later.",
            audioBase64: null,
            emotion: "sad",
            bodyLanguage: [],
            emotionReasoning: "Service error",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Chat History Routes
router.get("/cortex/chat/history/:chatId", async (req, res) => {
    const id = req.params.chatId;
    let chat = await Chat.findOne({ chatId: id }).lean();
    if (!chat && mongoose.Types.ObjectId.isValid(id)) {
        chat = await Chat.findById(id).lean();
    }
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    res.json({ messages: chat.messages || [] });
});

router.delete('/cortex/chat/history/:chatId', async (req, res) => {
    try {
        const { chatId } = req.params;
        const deleted = await Chat.findOneAndDelete({ chatId });

        if (!deleted) {
            return res.status(404).json({ message: 'No chat history found' });
        }

        res.status(200).json({ message: 'Chat history deleted' });
    } catch (error) {
        console.error('Error deleting chat history:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;