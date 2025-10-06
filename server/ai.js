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

router.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE'],
    credentials: true
}));

// Date & Time Calculation
const now = DateTime.now().setZone('Africa/Nairobi');
const weekday = now.weekdayLong;
const month = now.monthLong;
const day = now.day;
const year = now.year;

let hour = now.hour;
const minute = now.minute;
const isPM = hour >= 12;
const period = isPM ? 'in the evening' : 'in the morning';
hour = hour % 12 || 12;

let timePhrase = '';
if (minute === 0) {
    timePhrase = `It's ${toWords(hour)} o'clock ${period}.`;
} else if (minute === 15) {
    timePhrase = `It's quarter past ${toWords(hour)} ${period}.`;
} else if (minute === 30) {
    timePhrase = `It's half past ${toWords(hour)} ${period}.`;
} else if (minute === 45) {
    const nextHour = (hour % 12) + 1;
    timePhrase = `It's quarter to ${toWords(nextHour)} ${period}.`;
} else if (minute < 30) {
    timePhrase = `It's ${toWords(minute)} past ${toWords(hour)} ${period}.`;
} else {
    const minutesTo = 60 - minute;
    const nextHour = (hour % 12) + 1;
    timePhrase = `It's ${toWords(minutesTo)} to ${toWords(nextHour)} ${period}.`;
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
                description: "Body language gestures: 'headTilt' for questions or curiosity, 'headNod' for agreement or affirmation, 'shrug' for uncertainty or 'I don't know', 'wink' for playful or friendly moments"
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
        await new Promise(resolve => setTimeout(resolve, 100));
        
        if (fs.existsSync(outputPath)) {
            const stats = fs.statSync(outputPath);
            console.log('Audio created, Size:', stats.size, 'bytes');
            
            if (stats.size === 0) {
                console.error('Audio file is empty');
                return null;
            }
            
            return outputPath;
        } else {
            console.error('Audio file not created');
            return null;
        }
    } catch (error) {
        console.error("TTS Error:", error.message);
        return null;
    }
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
router.post("/cortex", async (req, res) => {
    try {
        const { message: You, sender, chatId } = req.body;

        if (!You || !sender) {
            return res.status(400).json({ 
                response: "Invalid request. 'message' and 'sender' are required." 
            });
        }

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
            } catch (err) {
                console.error(`Failed to delete chat history for ${sender}:`, err.message);
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
                }
            }
        );

        let aiResponse = "";
        let detectedEmotion = "smile";
        let bodyLanguageCues = [];
        let emotionReasoning = "";

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
                    bodyLanguageCues = args.bodyLanguageCues || [];
                    emotionReasoning = args.reasoning || "";
                    
                    console.log('Gemini Function Call Received:');
                    console.log('  Emotion:', detectedEmotion);
                    console.log('  Body Language:', bodyLanguageCues);
                    console.log('  Reasoning:', emotionReasoning);
                }
            }
        }

        // Fallback if no function call was made
        if (!aiResponse) {
            aiResponse = candidate?.content?.parts?.[0]?.text || "I'm here to help!";
        }

        console.log('AI Response:', aiResponse.substring(0, 100) + '...');
        
        // Step 3: Generate audio using Edge TTS
        let audioBase64 = null;
        
        try {
            const cleanText = stripHtmlAndSpecialChars(aiResponse);
            if (cleanText) {
                const tempPath = path.join(__dirname, './temp', `audio_${Date.now()}.mp3`);
                const tempDir = path.join(__dirname, './temp');
                
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }
                
                const audioFile = await textToSpeechEdgeTTS(cleanText, tempPath);
                
                if (audioFile && fs.existsSync(audioFile)) {
                    const stats = fs.statSync(audioFile);
                    
                    if (stats.size > 0) {
                        const audioBuffer = fs.readFileSync(audioFile);
                        audioBase64 = audioBuffer.toString('base64');
                        console.log('Audio base64 created, length:', audioBase64.length);
                    }
                    
                    fs.unlinkSync(audioFile);
                }
            }
        } catch (audioError) {
            console.error('TTS Error:', audioError.message);
        }

        // Save to database
        await saveChatHistory(chatId, You, aiResponse, sender);

        // Step 4: Send response with emotion data
        res.json({ 
            response: aiResponse,
            text: aiResponse,
            audioBase64: audioBase64,
            emotion: detectedEmotion,
            bodyLanguage: bodyLanguageCues,
            emotionReasoning: emotionReasoning,
            chatId: chatId
        });

    } catch (error) {
        console.error("Error in /cortex route:", error.response?.data || error.message);
        res.status(500).json({ 
            response: "I'm currently unavailable. Please try again later.",
            text: "I'm currently unavailable. Please try again later.",
            audioBase64: null,
            emotion: "sad",
            bodyLanguage: [],
            emotionReasoning: "Error occurred"
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